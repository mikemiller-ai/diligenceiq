import type { QueryAnalysis } from '../query/analyze';
import type { PeriodBucket } from '../query/periods';

/**
 * Deterministic planner (SPEC §27.2; architecture §6.6; DD-05): turns the analysis into
 * retrieval lanes, each a metadata-filtered hybrid search with a quota in the context.
 *
 * - Named companies: one lane per company, so one company cannot dominate global top-K.
 * - Longitudinal (change intent and at least two period buckets): company × period lanes,
 *   so the newest filing cannot dominate a question about change over time.
 * - Sector: one lane per member (kind `sector_member`), with the quota rule below.
 * - Otherwise: one global lane with a per-company cap.
 *
 * Quotas: the context targets `TARGET_CONTEXT_CHUNKS` blocks (~24K tokens at ~900 tokens a
 * chunk). Every lane gets quota = max(1, ⌊target / lanes⌋) blocks before any filling by
 * score. So 3 lanes get 7 each, 11 lanes get 2 each, and 12 or more lanes get 1 each.
 *
 * Companies before periods (H2). Each lane carries a `tier`: the context builder fills
 * quotas pass by pass, and inside a pass visits every tier-0 lane (one per company) before any
 * tier-1 lane. Company and sector lanes are all tier 0. In company × period lanes, the
 * company's latest annual period is tier 0, its earliest period tier 1, and the rest tier 2. So
 * when the budget runs out, every company has its latest period first, then its earliest,
 * and only then the periods in between.
 *
 * Endpoint reduction: when company × period lanes would exceed `MAX_PERIOD_LANES`
 * (⌊target / MIN_LANE_QUOTA⌋ = 11, the most lanes that still get 2 blocks each), each company
 * with three or more periods keeps only its endpoints: the earliest period and the latest
 * annual (10-K) period, or the latest period when it has no later annual one. Middle years and
 * later YTD quarters are dropped from the plan, and a plan note says which. If the endpoints
 * alone still outnumber the target (more than 11 companies), each lane gets 1 block and a note
 * says that not every company's earliest period may fit.
 */
export const TARGET_CONTEXT_CHUNKS = 22;
/** Blocks a lane should get at least; sets the endpoint-reduction threshold. */
export const MIN_LANE_QUOTA = 2;
export const MAX_PERIOD_LANES = Math.floor(TARGET_CONTEXT_CHUNKS / MIN_LANE_QUOTA);
/** Candidates kept per lane (for quota and fill), as a multiple of its quota, at least this many. */
export const LANE_CANDIDATE_MULTIPLE = 4;
export const MIN_LANE_CANDIDATES = 24;
/** Global lane: at most this many blocks per company. */
export const GLOBAL_PER_COMPANY_CAP = 4;

export type LaneKind = 'company' | 'company_period' | 'sector_member' | 'global';

export interface Lane {
  id: string;
  kind: LaneKind;
  label: string;
  ticker: string | null;
  periodLabel: string | null;
  /** Hard metadata filter: only chunks of these filings. */
  documentIds: string[];
  quota: number;
  /** Quota fill order: every tier-0 lane gets a block before any tier-1 lane (companies before periods). */
  tier: number;
  candidates: number;
  perCompanyCap: number | null;
}

export interface RetrievalPlan {
  strategy: 'single_company' | 'multi_company' | 'longitudinal' | 'sector' | 'global';
  lanes: Lane[];
  targetChunks: number;
  /** Stated, never silent: endpoint reductions and other planning limits (shown with the interpretation). */
  notes: string[];
}

const ANNUAL = /^FY\d{4}$/;

/** Earliest bucket and latest annual bucket (or the latest bucket when none is later). */
function endpoints(buckets: readonly PeriodBucket[]): { first: PeriodBucket; last: PeriodBucket } {
  const first = buckets[0]!;
  const annual = buckets.filter((b) => ANNUAL.test(b.label));
  const lastAnnual = annual.at(-1);
  const last = lastAnnual && lastAnnual !== first ? lastAnnual : buckets.at(-1)!;
  return { first, last };
}

export function planLanes(a: QueryAnalysis, targetChunks = TARGET_CONTEXT_CHUNKS): RetrievalPlan {
  const notes: string[] = [];
  const scopes = a.scopes.filter((s) => s.documentIds.length > 0);
  if (!a.scoped) {
    const docs = scopes.flatMap((s) => s.documentIds);
    const lanes: Lane[] = docs.length
      ? [{ id: 'global', kind: 'global', label: 'All companies', ticker: null, periodLabel: null, documentIds: docs, quota: targetChunks, tier: 0, candidates: targetChunks * LANE_CANDIDATE_MULTIPLE * 2, perCompanyCap: GLOBAL_PER_COMPANY_CAP }]
      : [];
    return { strategy: 'global', lanes, targetChunks, notes };
  }

  const viaSector = new Set(a.companies.filter((c) => c.via === 'sector').map((c) => c.ticker));
  const longitudinal = a.changeIntent && scopes.some((s) => s.buckets.length >= 2);
  const maxPeriodLanes = Math.floor(targetChunks / MIN_LANE_QUOTA);
  const periodLaneCount = scopes.reduce((n, s) => n + (s.buckets.length >= 2 ? s.buckets.length : 1), 0);
  const reduce = longitudinal && periodLaneCount > maxPeriodLanes;
  const dropped: string[] = [];

  const raw: Array<Omit<Lane, 'quota' | 'candidates'>> = [];
  for (const s of scopes) {
    const kind: LaneKind = viaSector.has(s.ticker) ? 'sector_member' : 'company';
    if (longitudinal && s.buckets.length >= 2) {
      const { first, last } = endpoints(s.buckets);
      let buckets = s.buckets;
      if (reduce && buckets.length >= 3) {
        buckets = s.buckets.filter((b) => b === first || b === last);
        dropped.push(`${s.ticker} ${s.buckets.filter((b) => b !== first && b !== last).map((b) => b.label).join(', ')}`);
      }
      for (const b of buckets) {
        const tier = b === last ? 0 : b === first ? 1 : 2;
        raw.push({ id: `${s.ticker}:${b.label}`, kind: 'company_period', label: `${s.ticker} ${b.label}`, ticker: s.ticker, periodLabel: b.label, documentIds: b.documentIds, tier, perCompanyCap: null });
      }
    } else {
      const periodLabel = s.buckets.map((b) => b.label).join(' + ');
      raw.push({ id: s.ticker, kind, label: `${s.ticker} ${periodLabel}`, ticker: s.ticker, periodLabel, documentIds: s.documentIds, tier: 0, perCompanyCap: null });
    }
  }
  if (dropped.length) {
    notes.push(
      `${scopes.length} companies × their periods would need ${periodLaneCount} period lanes (limit ${maxPeriodLanes}), so each company is compared at its endpoints (earliest period and latest annual report). Not searched: ${dropped.join('; ')}.`,
    );
  }
  if (raw.length > targetChunks) {
    notes.push(
      longitudinal
        ? `${raw.length} lanes for a ${targetChunks}-block context: every company gets its latest period first, then its earliest as the ~24K-token budget allows, so some earliest periods may be missing.`
        : `${raw.length} companies for a ${targetChunks}-block context: each gets one block in turn as the ~24K-token budget allows, so some companies may be missing.`,
    );
  }

  const quota = raw.length ? Math.max(1, Math.floor(targetChunks / raw.length)) : 0;
  const lanes = raw.map((l) => ({ ...l, quota, candidates: Math.max(MIN_LANE_CANDIDATES, quota * LANE_CANDIDATE_MULTIPLE) }));
  const companies = new Set(scopes.map((s) => s.ticker));
  const strategy: RetrievalPlan['strategy'] = longitudinal
    ? 'longitudinal'
    : viaSector.size > 0 && companies.size > 1
      ? 'sector'
      : companies.size > 1
        ? 'multi_company'
        : 'single_company';
  return { strategy, lanes, targetChunks, notes };
}

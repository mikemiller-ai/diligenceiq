import { classifyRiskHeading } from '@diligenceiq/core';
import type { DetectorId, SignalCandidate } from './detect';

/**
 * Signal-quality evaluation against hand labels (Phase 3 go/no-go; DD-18; SPEC §10, §41.3).
 * Precision: share of decided candidates that are real per the labels. Recall sanity: share of
 * labeled real changes the detector found. Bar: precision ≥ 0.8, recall ≥ 0.5, and at least
 * MIN_DECIDED decided candidates. A null recall FAILS the bar unless the detector is listed in
 * RECALL_NOT_APPLICABLE (none is): a detector whose misses cannot be counted is not measured.
 */
export const PRECISION_BAR = 0.8;
export const RECALL_BAR = 0.5;
/** Fewer decided candidates than this is too little evidence for a Go. */
export const MIN_DECIDED = 5;
/** Detectors whose recall is documented as not applicable (a null recall may pass). Empty by decision. */
export const RECALL_NOT_APPLICABLE: ReadonlySet<DetectorId> = new Set<DetectorId>();

export interface LabelPair {
  ticker: string;
  earlierFiscalLabel: string;
  laterFiscalLabel: string;
  laterHeadings: ReadonlyArray<{ later: string; earlier: string | null }>;
  removed: readonly string[];
  emphasis: Readonly<Record<string, { label: 'expanded' | 'reduced' | 'similar' }>>;
}

/** A found heading matches a labeled prefix when it starts with it (the golden-file convention), ignoring whitespace runs. */
export function headingMatches(found: string, prefix: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, ' ').trim();
  const f = n(found);
  const p = n(prefix);
  return f.startsWith(p) || (p.length > f.length && p.startsWith(f));
}

export interface LinkCount {
  /** Links (consecutive-period matches) in the candidate's chain. */
  total: number;
  /** Links whose 10-K pair is hand-labeled. */
  labeled: number;
  /** Labeled links the labels confirm. */
  held: number;
}

export interface Judged {
  candidate: SignalCandidate;
  correct: boolean | null;
  why: string;
  /** PERSISTENT only: link-level verification of the chain. */
  links?: LinkCount;
}

export interface DetectorScore {
  detector: DetectorId;
  emitted: number;
  judged: number;
  correct: number;
  precision: number | null;
  labeledPositives: number;
  found: number;
  recall: number | null;
  pass: boolean;
  /** Why the bar is met or missed, in words. */
  verdict: string;
  /** PERSISTENT: chain links over all candidates (gating: link precision ≥ PRECISION_BAR). */
  links?: LinkCount & { precision: number | null };
  /** PERSISTENT, diagnostic (not gating): precision over candidates whose every link is labeled. */
  fullyVerified?: { judged: number; correct: number; precision: number | null };
  /**
   * PERSISTENT, diagnostic (not gating): recall over ALL labeled persistent headings of the latest
   * labeled 10-K. The gating `recall` is over those the heading classifier categorizes, because
   * PERSISTENT by design emits only categorized headings (uncategorized ones are current risks).
   */
  recallAll?: { found: number; labeledPositives: number; recall: number | null };
}

function pairFor(labels: readonly LabelPair[], c: SignalCandidate): LabelPair | undefined {
  const [a, b] = [c.periods.at(-2), c.periods.at(-1)];
  return labels.find((l) => l.ticker === c.ticker && l.earlierFiscalLabel === a && l.laterFiscalLabel === b);
}

/**
 * PERSISTENT: each link of the chain is judged on its own. A labeled link holds when the later
 * heading is a labeled heading whose labeled earlier counterpart is the chain's earlier heading.
 * Unlabeled links (FY2022→FY2023 here) are counted, never assumed correct. The candidate is
 * correct when every LABELED link holds; `links` says how much of the claim that covers.
 */
function judgePersistent(c: SignalCandidate, labels: readonly LabelPair[]): Judged {
  const chain = c.chain ?? [];
  const links: LinkCount = { total: Math.max(0, c.periods.length - 1), labeled: 0, held: 0 };
  let failure: string | null = null;
  for (let i = 1; i < c.periods.length; i++) {
    const p = labels.find((l) => l.ticker === c.ticker && l.earlierFiscalLabel === c.periods[i - 1] && l.laterFiscalLabel === c.periods[i]);
    if (!p) continue;
    links.labeled++;
    const entry = p.laterHeadings.find((h) => headingMatches(chain[i] ?? '', h.later));
    let why: string | null = null;
    if (!entry) why = `${c.periods[i]} heading is not a labeled heading`;
    else if (entry.earlier === null) why = `labeled new in ${p.laterFiscalLabel}`;
    else if (!headingMatches(chain[i - 1] ?? '', entry.earlier)) why = `${c.periods[i]} heading is labeled as the same risk as a different ${c.periods[i - 1]} heading`;
    if (why) failure ??= why;
    else links.held++;
  }
  if (!links.labeled) return { candidate: c, correct: null, why: 'no labeled link', links };
  const coverage = `${links.held}/${links.labeled} labeled link(s) hold; ${links.total - links.labeled} of ${links.total} link(s) unlabeled`;
  return failure ? { candidate: c, correct: false, why: `${failure} (${coverage})`, links } : { candidate: c, correct: true, why: coverage, links };
}

export function judge(c: SignalCandidate, labels: readonly LabelPair[], trendLabels: readonly TrendLabel[] = []): Judged {
  switch (c.detector) {
    case 'risk_new': {
      const p = pairFor(labels, c);
      if (!p) return { candidate: c, correct: null, why: 'pair not labeled' };
      const entry = p.laterHeadings.find((h) => headingMatches(c.subject, h.later));
      if (!entry) return { candidate: c, correct: false, why: 'not a labeled heading (extractor false positive)' };
      return { candidate: c, correct: entry.earlier === null, why: entry.earlier === null ? 'labeled new' : `labeled as the same risk as “${entry.earlier.slice(0, 60)}…”` };
    }
    case 'risk_removed': {
      const p = pairFor(labels, c);
      if (!p) return { candidate: c, correct: null, why: 'pair not labeled' };
      const hit = p.removed.some((r) => headingMatches(c.subject, r));
      return { candidate: c, correct: hit, why: hit ? 'labeled removed' : 'not labeled removed (still present, merged, or not a heading)' };
    }
    case 'risk_persistent':
      return judgePersistent(c, labels);
    case 'emphasis_up':
    case 'emphasis_down':
    case 'outlook': {
      const p = pairFor(labels, c);
      if (!p) return { candidate: c, correct: null, why: 'pair not labeled' };
      const label = p.emphasis[c.subject]?.label;
      if (!label) return { candidate: c, correct: null, why: `no label for ${c.subject}` };
      const want = c.detector === 'emphasis_up' ? 'expanded' : c.detector === 'emphasis_down' ? 'reduced' : c.headline.includes('says less') ? 'reduced' : 'expanded';
      return { candidate: c, correct: label === want, why: `labeled ${label}` };
    }
    case 'trend':
      return judgeTrend(c, trendLabels);
  }
}

// ---------------------------------------------------------------------------------------------
// TREND_CHANGE ground truth: derived from hand-read income-statement values
// (testing/trend-labels.ts), never from the extraction the detector consumes.

/** DD-17 definitions, restated for the labels: growth change ≥ 5 pp, decline below −2%, margin move ≥ 1 pp. */
export const TREND_LABEL_GROWTH_PP = 0.05;
export const TREND_LABEL_DECLINE = -0.02;
export const TREND_LABEL_MARGIN_PP = 0.01;

export type TrendDirection = 'accelerating' | 'slowing' | 'turned_to_decline' | 'improving' | 'declining' | 'none';

export interface TrendTruthYear {
  fiscalLabel: string;
  revenue: { value: number };
  grossProfit?: { value: number };
  operatingIncome?: { value: number };
  netIncome?: { value: number };
}

export interface TrendLabel {
  ticker: string;
  /** The latest fiscal year of the comparison (the candidate's last period). */
  asOf: string;
  metric: 'revenue_growth' | 'gross_margin' | 'operating_margin' | 'net_margin';
  direction: TrendDirection;
  basis: string;
}

const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;

/** True direction labels for every as-of year that has the years it needs (growth: three; margins: two). */
export function deriveTrendLabels(rows: Readonly<Record<string, readonly TrendTruthYear[]>>): TrendLabel[] {
  const out: TrendLabel[] = [];
  for (const [ticker, years] of Object.entries(rows)) {
    const ys = [...years].sort((a, b) => a.fiscalLabel.localeCompare(b.fiscalLabel));
    for (let i = 2; i < ys.length; i++) {
      const [a, b, c] = [ys[i - 2]!, ys[i - 1]!, ys[i]!];
      const g1 = (b.revenue.value - a.revenue.value) / a.revenue.value;
      const g0 = (c.revenue.value - b.revenue.value) / b.revenue.value;
      let direction: TrendDirection = 'none';
      if (g0 < TREND_LABEL_DECLINE) direction = g1 < TREND_LABEL_DECLINE ? 'none' : 'turned_to_decline';
      else if (g0 - g1 >= TREND_LABEL_GROWTH_PP) direction = 'accelerating';
      else if (g0 - g1 <= -TREND_LABEL_GROWTH_PP) direction = 'slowing';
      out.push({ ticker, asOf: c.fiscalLabel, metric: 'revenue_growth', direction, basis: `hand-read revenue growth ${pct1(g1)} (${b.fiscalLabel}) → ${pct1(g0)} (${c.fiscalLabel})` });
      for (const [metric, key] of [
        ['gross_margin', 'grossProfit'],
        ['operating_margin', 'operatingIncome'],
        ['net_margin', 'netIncome'],
      ] as const) {
        const nb = b[key]?.value;
        const nc = c[key]?.value;
        if (nb === undefined || nc === undefined) continue;
        const mb = nb / b.revenue.value;
        const mc = nc / c.revenue.value;
        const d = mc - mb;
        const dir: TrendDirection = d >= TREND_LABEL_MARGIN_PP ? 'improving' : d <= -TREND_LABEL_MARGIN_PP ? 'declining' : 'none';
        out.push({ ticker, asOf: c.fiscalLabel, metric, direction: dir, basis: `hand-read ${metric.replace('_', ' ')} ${pct1(mb)} (${b.fiscalLabel}) → ${pct1(mc)} (${c.fiscalLabel}), ${(d * 100).toFixed(2)} pp` });
      }
    }
  }
  return out;
}

/** The direction a TREND_CHANGE candidate claims, read from its headline. */
export function trendCandidateDirection(c: Pick<SignalCandidate, 'headline'>): TrendDirection {
  const h = c.headline;
  if (h.includes('turned to decline')) return 'turned_to_decline';
  if (h.includes('slowed')) return 'slowing';
  if (h.includes('accelerated')) return 'accelerating';
  if (h.includes('improved')) return 'improving';
  if (h.includes('declined')) return 'declining';
  return 'none';
}

/** TREND_CHANGE: correct when the hand-read label for (ticker, metric, as-of year) has the claimed direction. */
export function judgeTrend(c: SignalCandidate, trendLabels: readonly TrendLabel[]): Judged {
  const label = trendLabels.find((l) => l.ticker === c.ticker && l.metric === c.subject && l.asOf === c.periods.at(-1));
  if (!label) return { candidate: c, correct: null, why: 'no hand-read label for this company, metric and year' };
  const claimed = trendCandidateDirection(c);
  return { candidate: c, correct: claimed === label.direction, why: `${label.basis}: labeled ${label.direction}, claimed ${claimed}` };
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function scoreDetectors(
  judged: readonly Judged[],
  labels: readonly LabelPair[],
  detectors: readonly DetectorId[],
  allCandidates: readonly SignalCandidate[],
  trendLabels: readonly TrendLabel[] = [],
): DetectorScore[] {
  return detectors.map((detector) => {
    const mine = judged.filter((j) => j.candidate.detector === detector);
    const decided = mine.filter((j) => j.correct !== null);
    const correct = decided.filter((j) => j.correct).length;
    const cands = allCandidates.filter((c) => c.detector === detector);
    let labeledPositives = 0;
    let found = 0;
    const extra: Partial<DetectorScore> = {};
    for (const p of labels) {
      const inPair = (c: SignalCandidate) => c.ticker === p.ticker && c.periods.at(-2) === p.earlierFiscalLabel && c.periods.at(-1) === p.laterFiscalLabel;
      if (detector === 'risk_new') {
        for (const h of p.laterHeadings.filter((x) => x.earlier === null)) {
          labeledPositives++;
          if (cands.some((c) => inPair(c) && headingMatches(c.subject, h.later))) found++;
        }
      } else if (detector === 'risk_removed') {
        for (const r of p.removed) {
          labeledPositives++;
          if (cands.some((c) => inPair(c) && headingMatches(c.subject, r))) found++;
        }
      } else if (detector === 'emphasis_up' || detector === 'emphasis_down') {
        const want = detector === 'emphasis_up' ? 'expanded' : 'reduced';
        for (const [key, v] of Object.entries(p.emphasis)) {
          if (key.startsWith('mda_') || v.label !== want) continue;
          labeledPositives++;
          if (cands.some((c) => inPair(c) && c.subject === key)) found++;
        }
      } else if (detector === 'outlook') {
        for (const [key, v] of Object.entries(p.emphasis)) {
          if (!key.startsWith('mda_') || v.label === 'similar') continue;
          labeledPositives++;
          if (cands.some((c) => inPair(c) && c.subject === key)) found++;
        }
      }
    }
    if (detector === 'risk_persistent') {
      // Gating recall: labeled persistent headings of the latest labeled 10-K that the heading
      // classifier categorizes (PERSISTENT's scope). Diagnostic: over every labeled persistent heading
      // (the labels carry no category), so the scope restriction is visible.
      let allPositives = 0;
      let allFound = 0;
      for (const p of labels.filter((l) => !labels.some((m) => m.ticker === l.ticker && m.earlierFiscalLabel === l.laterFiscalLabel))) {
        for (const h of p.laterHeadings.filter((x) => x.earlier !== null)) {
          const hit = cands.some((c) => c.ticker === p.ticker && c.periods.at(-1) === p.laterFiscalLabel && headingMatches(c.subject, h.later));
          allPositives++;
          if (hit) allFound++;
          if (classifyRiskHeading(h.later) !== null) {
            labeledPositives++;
            if (hit) found++;
          }
        }
      }
      extra.recallAll = { found: allFound, labeledPositives: allPositives, recall: ratio(allFound, allPositives) };
      const links = mine.reduce<LinkCount>((acc, j) => ({ total: acc.total + (j.links?.total ?? 0), labeled: acc.labeled + (j.links?.labeled ?? 0), held: acc.held + (j.links?.held ?? 0) }), { total: 0, labeled: 0, held: 0 });
      extra.links = { ...links, precision: ratio(links.held, links.labeled) };
      const full = decided.filter((j) => j.links && j.links.labeled === j.links.total);
      const fullCorrect = full.filter((j) => j.correct).length;
      extra.fullyVerified = { judged: full.length, correct: fullCorrect, precision: ratio(fullCorrect, full.length) };
    } else if (detector === 'trend') {
      for (const l of trendLabels.filter((x) => x.direction !== 'none')) {
        labeledPositives++;
        if (cands.some((c) => c.ticker === l.ticker && c.subject === l.metric && c.periods.at(-1) === l.asOf && trendCandidateDirection(c) === l.direction)) found++;
      }
    }
    const precision = ratio(correct, decided.length);
    const recall = ratio(found, labeledPositives);
    const reasons: string[] = [];
    if (decided.length < MIN_DECIDED) reasons.push(`only ${decided.length} decided candidate(s) (minimum ${MIN_DECIDED})`);
    if (precision !== null && precision < PRECISION_BAR) reasons.push(`precision ${precision.toFixed(2)} < ${PRECISION_BAR}`);
    if (recall === null && !RECALL_NOT_APPLICABLE.has(detector)) reasons.push('recall not measurable (no labeled positives)');
    if (recall !== null && recall < RECALL_BAR) reasons.push(`recall ${recall.toFixed(2)} < ${RECALL_BAR}`);
    if (extra.links?.precision != null && extra.links.precision < PRECISION_BAR) reasons.push(`labeled-link precision ${extra.links.precision.toFixed(2)} < ${PRECISION_BAR}`);
    const pass = reasons.length === 0;
    return { detector, emitted: mine.length, judged: decided.length, correct, precision, labeledPositives, found, recall, pass, verdict: pass ? 'meets the bar' : reasons.join('; '), ...extra };
  });
}

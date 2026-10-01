import type { Citation } from './domain';
import {
  SIGNAL_CATEGORIES,
  SIGNAL_CATEGORY_LABELS,
  type CompanyIntelligenceProfile,
  type CoverageTier,
  type SignalCategory,
  type Trajectory,
} from './intelligence';

/**
 * Compare (SPEC §13, DD-19): composed deterministically from stored profiles. No model
 * call. Phase 1 runs it in the browser over fixture profiles; Phase 5 moves the same
 * function behind GET /api/compare.
 */

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 5;

/** The trajectory rows Compare shows side by side (SPEC §13.1). */
export const COMPARE_METRICS = ['Revenue', 'Operating margin', 'Operating income', 'Operating cash flow'] as const;

export interface CompareCompany {
  ticker: string;
  company: string;
  tier: CoverageTier;
  /** Period end of the latest annual report; fiscal years are shown as reported, never aligned. */
  fiscalYearEnd: string;
  categories: SignalCategory[];
}

export interface CompareTheme {
  category: SignalCategory;
  label: string;
  tickers: string[];
  /** Risk headings and signals behind the theme, per company, for the tooltip and evidence. */
  citationIds: string[];
}

export interface AttentionRow extends CompareTheme {
  rank: number;
  signalCount: number;
  /** Best (lowest) rank of a matching latest-10-K risk heading across the companies. */
  bestRiskRank: number | null;
}

export interface CompareRecommendation {
  ref: string;
  question: string;
  why: string;
  tickers: string[];
}

export interface CompareTrajectoryRow {
  metric: string;
  values: Array<{ ticker: string; trajectory: Trajectory; chunkIds: string[] }>;
}

/** Per company, what its latest management discussion emphasizes (SPEC §13.1); null until extracted. */
export interface ManagementEmphasis {
  ticker: string;
  summary: string | null;
  citationIds: string[];
}

/** The architecture §9 GET /api/compare body. */
export interface CompareResult {
  companies: CompareCompany[];
  missing: string[];
  trajectories: CompareTrajectoryRow[];
  common: CompareTheme[];
  distinctive: CompareTheme[];
  diverging: Array<{ metric: string; up: string[]; down: string[] }>;
  managementEmphasis: ManagementEmphasis[];
  attentionRanking: AttentionRow[];
  recommendedDiligence: CompareRecommendation[];
  notes: string[];
  citations: Citation[];
}

export type CompareOutcome =
  | { ok: true; result: CompareResult }
  | { ok: false; code: 'PROFILE_MISSING'; missing: string[] }
  /** Fewer than two or more than five distinct tickers requested (architecture §9: 2–5). */
  | { ok: false; code: 'VALIDATION_ERROR'; message: string };

/*
 * Direction of a trajectory. "Slowing" means growth continues at a lower rate, so the metric
 * is still rising; it is neither up nor down for divergence, and only "declining" is falling.
 */
const UP: ReadonlySet<Trajectory> = new Set(['accelerating', 'growing', 'improving']);
const DOWN: ReadonlySet<Trajectory> = new Set(['declining']);

function categoriesOf(p: CompanyIntelligenceProfile): SignalCategory[] {
  const set = new Set<SignalCategory>([...p.currentRisks.map((r) => r.category), ...p.signals.map((s) => s.category)]);
  return SIGNAL_CATEGORIES.filter((c) => set.has(c));
}

function themeEvidence(p: CompanyIntelligenceProfile, category: SignalCategory): string[] {
  return [
    ...p.currentRisks.filter((r) => r.category === category).flatMap((r) => r.citationIds),
    ...p.signals.filter((s) => s.category === category).flatMap((s) => s.citationIds),
  ];
}

function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

export function composeCompare(
  requested: readonly string[],
  profiles: ReadonlyMap<string, CompanyIntelligenceProfile>,
): CompareOutcome {
  const tickers = [...new Set(requested)];
  if (tickers.length < COMPARE_MIN || tickers.length > COMPARE_MAX) {
    return { ok: false, code: 'VALIDATION_ERROR', message: `Choose ${COMPARE_MIN} to ${COMPARE_MAX} different companies.` };
  }
  const missing = tickers.filter((t) => !profiles.has(t));
  const present = tickers.flatMap((t) => {
    const p = profiles.get(t);
    return p ? [p] : [];
  });
  if (present.length < COMPARE_MIN) return { ok: false, code: 'PROFILE_MISSING', missing };

  const companies: CompareCompany[] = present.map((p) => ({
    ticker: p.ticker,
    company: p.company,
    tier: p.coverage.tier,
    fiscalYearEnd: p.fiscalYearEnd,
    categories: categoriesOf(p),
  }));

  const themes: AttentionRow[] = SIGNAL_CATEGORIES.flatMap((category) => {
    const holders = present.filter((p) => companies.find((c) => c.ticker === p.ticker)?.categories.includes(category));
    if (holders.length === 0) return [];
    const ranks = holders.flatMap((p) => p.currentRisks.filter((r) => r.category === category).map((r) => r.rank));
    return [
      {
        category,
        label: SIGNAL_CATEGORY_LABELS[category],
        tickers: holders.map((p) => p.ticker),
        citationIds: holders.flatMap((p) => themeEvidence(p, category)),
        rank: 0,
        signalCount: holders.reduce((n, p) => n + p.signals.filter((s) => s.category === category).length, 0),
        bestRiskRank: ranks.length ? Math.min(...ranks) : null,
      },
    ];
  });

  // Fixed attention rule (SPEC §13.1): companies sharing the category, then signal count,
  // then position in the latest risk headings, then category order.
  const order = (c: SignalCategory) => SIGNAL_CATEGORIES.indexOf(c);
  const attentionRanking = [...themes]
    .sort(
      (a, b) =>
        b.tickers.length - a.tickers.length ||
        b.signalCount - a.signalCount ||
        (a.bestRiskRank ?? Number.MAX_SAFE_INTEGER) - (b.bestRiskRank ?? Number.MAX_SAFE_INTEGER) ||
        order(a.category) - order(b.category),
    )
    .map((t, i) => ({ ...t, rank: i + 1 }));

  const strip = ({ category, label, tickers: t, citationIds }: AttentionRow): CompareTheme => ({
    category,
    label,
    tickers: t,
    citationIds,
  });
  const common = themes.filter((t) => t.tickers.length === present.length).map(strip);
  const distinctive = themes.filter((t) => t.tickers.length === 1 && present.length > 1).map(strip);

  const trajectories: CompareTrajectoryRow[] = COMPARE_METRICS.map((metric) => ({
    metric,
    values: present.map((p) => {
      const trend = p.trends.find((t) => t.metric === metric);
      return {
        ticker: p.ticker,
        trajectory: trend?.trajectory ?? (p.coverage.tier === 'limited_history' ? ('limited_history' as const) : ('not_extracted' as const)),
        chunkIds: trend?.chunkIds ?? [],
      };
    }),
  }));

  const diverging = trajectories.flatMap((row) => {
    const up = row.values.filter((v) => UP.has(v.trajectory)).map((v) => v.ticker);
    const down = row.values.filter((v) => DOWN.has(v.trajectory)).map((v) => v.ticker);
    return up.length && down.length ? [{ metric: row.metric, up, down }] : [];
  });

  const nameOf = (t: string) => present.find((p) => p.ticker === t)?.company ?? t;
  const recommendedDiligence: CompareRecommendation[] = [
    ...common.map((t) => ({
      ref: `common-${t.category}`,
      question: `Compare how ${nameList(t.tickers.map(nameOf))} describe ${t.label.toLowerCase()} risk in their latest annual reports.`,
      why: `${t.label} appears among the risk areas of every selected company.`,
      tickers: t.tickers,
    })),
    ...distinctive.map((t) => ({
      ref: `distinctive-${t.category}-${t.tickers[0]}`,
      question: `What does ${nameOf(t.tickers[0] ?? '')} disclose about ${t.label.toLowerCase()} risk, and how does it compare with ${nameList(present.filter((p) => p.ticker !== t.tickers[0]).map((p) => p.company))}?`,
      why: `${t.label} appears among the risk areas of only one selected company.`,
      tickers: present.map((p) => p.ticker),
    })),
    ...diverging.map((d) => ({
      ref: `diverging-${d.metric.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      question: `Why is ${d.metric.toLowerCase()} rising at ${nameList(d.up.map(nameOf))} but falling at ${nameList(d.down.map(nameOf))}?`,
      why: `${d.metric} trajectories point in opposite directions.`,
      tickers: [...d.up, ...d.down],
    })),
  ];

  const managementEmphasis: ManagementEmphasis[] = present.map((p) => ({
    ticker: p.ticker,
    summary: p.managementOutlook?.summary ?? null,
    citationIds: p.managementOutlook?.citationIds ?? [],
  }));

  const notes: string[] = [];
  const fyEnds = new Set(present.map((p) => p.fiscalYearEnd.slice(5, 7)));
  if (fyEnds.size > 1) notes.push('Fiscal years end in different months; periods are shown as each company reports them, not aligned.');
  for (const p of present) {
    if (p.coverage.tier === 'limited_history') notes.push(`${p.company}: limited history, one annual report in the corpus.`);
  }

  const wanted = new Set([
    ...themes.flatMap((t) => t.citationIds),
    ...trajectories.flatMap((t) => t.values.flatMap((v) => v.chunkIds)),
    ...managementEmphasis.flatMap((m) => m.citationIds),
  ]);
  const citations = present.flatMap((p) => p.citations.filter((c) => wanted.has(c.chunkId)));

  return {
    ok: true,
    result: {
      companies,
      missing,
      trajectories,
      common,
      distinctive,
      diverging,
      managementEmphasis,
      attentionRanking,
      recommendedDiligence,
      notes,
      citations,
    },
  };
}

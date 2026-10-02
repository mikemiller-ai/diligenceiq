import type { FinancialFact } from './extract';
import type { Metric } from './metrics';

/**
 * Derived values and trajectory labels (DD-17; SPEC §9). Growth rates and margins are computed
 * in code, only between comparable periods (consecutive fiscal years from annual facts; the
 * same quarter a year apart). Labels come from fixed thresholds, recorded with each label.
 *
 * Inputs must be comparable as well as present: a growth rate uses values from ONE table row
 * of one filing; a margin uses a numerator and a revenue from ONE table of one filing. Facts
 * marked `suspect` (DD-17 plausibility checks) are never used.
 *
 * Growth labels, from the latest growth g0 and the year before, g1:
 * - Declining: g0 below −2.0%. Stable: g0 within ±2.0%.
 * - Accelerating: g0 at least 5.0 pp above g1, and g1 was not negative (a rebound after a
 *   decline is labeled Growing, because "accelerating" would overstate a recovery).
 * - Slowing: g0 at least 5.0 pp below g1. Growing: anything else above 2.0%.
 */
export const THRESHOLDS = {
  /** |growth| at or below this is Stable. */
  stableGrowth: 0.02,
  /** Growth this much faster (slower) than the prior period is Accelerating (Slowing). */
  accelerationPoints: 0.05,
  /** Margin change, in fraction points, needed for Improving or Declining. */
  marginPoints: 0.01,
} as const;

export type GrowthTrajectory = 'accelerating' | 'growing' | 'stable' | 'slowing' | 'declining';
export type MarginTrajectory = 'improving' | 'stable' | 'declining';

export interface Trend {
  metric: string;
  trajectory: GrowthTrajectory | MarginTrajectory;
  /** Plain-language basis with the numbers and the threshold that produced the label. */
  basis: string;
  periods: string[];
  /** Fact chunks behind every number used. */
  chunkIds: string[];
  values: number[];
  /** Where every input came from: one filing, and one table row (growth) or one table (margins). */
  inputs: Array<{ documentId: string; tableStart: number; rowStart: number; metric: Metric; period: string }>;
}

const inputOf = (f: FinancialFact) => ({ documentId: f.documentId, tableStart: f.tableStart, rowStart: f.rowStart, metric: f.metric, period: f.period });

/**
 * One value per period: the fact from the most recent filing that reports it (later filings
 * carry restatements). Ties cannot occur because a filing reports a period once.
 */
export function primaryFacts(facts: readonly FinancialFact[], metric: Metric, duration: FinancialFact['duration']): Map<string, FinancialFact> {
  const out = new Map<string, FinancialFact>();
  for (const f of facts) {
    if (f.metric !== metric || f.duration !== duration) continue;
    const prev = out.get(f.period);
    const later = !prev || filingOrder(f) > filingOrder(prev) || (filingOrder(f) === filingOrder(prev) && f.documentId > prev.documentId);
    if (later) out.set(f.period, f);
  }
  return out;
}

/** Later fiscal label of the source filing wins. */
function filingOrder(f: FinancialFact): number {
  const m = /^FY(\d{4})(?:Q(\d))?$/.exec(f.fiscalLabel);
  return m ? Number(m[1]) * 10 + (m[2] ? Number(m[2]) : 4) : 0;
}

/** Ratios are rounded before thresholds apply, so 102/100 − 1 is exactly 2% (Stable), not 2.0000000000000018%. */
const ratio = (x: number) => Math.round(x * 1e9) / 1e9;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${(x * 100).toFixed(1)} pp`;

function fiscalYear(period: string): number | null {
  const m = /^FY(\d{4})$/.exec(period);
  return m ? Number(m[1]) : null;
}

/**
 * Facts for one metric and duration, grouped by source filing, most recent filing first.
 * Comparisons use ONE filing's own comparative columns, so a restatement in a later filing
 * (JNJ after the Kenvue separation) never becomes a fake growth rate.
 */
function byDocument(facts: readonly FinancialFact[], metric: Metric, duration: FinancialFact['duration']): Array<Map<string, FinancialFact>> {
  const docs = new Map<string, { order: number; facts: Map<string, FinancialFact> }>();
  for (const f of facts) {
    if (f.metric !== metric || f.duration !== duration || f.suspect) continue;
    let d = docs.get(f.documentId);
    if (!d) docs.set(f.documentId, (d = { order: filingOrder(f), facts: new Map() }));
    d.facts.set(f.period, f);
  }
  return [...docs.entries()].sort((a, b) => b[1].order - a[1].order || b[0].localeCompare(a[0])).map(([, d]) => d.facts);
}

/** Revenue growth trajectory from the latest 10-K's own three fiscal years. */
export function growthTrend(facts: readonly FinancialFact[], metric: Metric = 'revenue'): Trend | null {
  for (const doc of byDocument(facts, metric, 'annual')) {
    const years = [...doc.keys()].map(fiscalYear).filter((y): y is number => y !== null).sort((a, b) => b - a);
    const latest = years[0];
    if (latest === undefined) continue;
    const f0 = doc.get(`FY${latest}`);
    const f1 = doc.get(`FY${latest - 1}`);
    // Every input from the same table row.
    if (!f0 || !f1 || f1.value <= 0 || f1.rowStart !== f0.rowStart) continue;
    const f2 = doc.get(`FY${latest - 2}`);
    return growthFrom(metric, latest, f0, f1, f2 && f2.rowStart === f0.rowStart ? f2 : undefined);
  }
  return null;
}

function growthFrom(metric: Metric, latest: number, f0: FinancialFact, f1: FinancialFact, f2: FinancialFact | undefined): Trend {
  const g0 = ratio((f0.value * f0.scale) / (f1.value * f1.scale) - 1);
  const g1 = f2 && f2.value > 0 ? ratio((f1.value * f1.scale) / (f2.value * f2.scale) - 1) : null;
  let trajectory: GrowthTrajectory;
  let rule: string;
  if (g0 < -THRESHOLDS.stableGrowth) {
    trajectory = 'declining';
    rule = `below -${pct(THRESHOLDS.stableGrowth)}`;
  } else if (Math.abs(g0) <= THRESHOLDS.stableGrowth) {
    trajectory = 'stable';
    rule = `within ±${pct(THRESHOLDS.stableGrowth)}`;
  } else if (g1 !== null && g1 < 0) {
    trajectory = 'growing';
    rule = `above ${pct(THRESHOLDS.stableGrowth)}, recovering from a decline the year before`;
  } else if (g1 !== null && ratio(g0 - g1) >= THRESHOLDS.accelerationPoints) {
    trajectory = 'accelerating';
    rule = `at least ${pts(THRESHOLDS.accelerationPoints)} faster than the year before`;
  } else if (g1 !== null && ratio(g1 - g0) >= THRESHOLDS.accelerationPoints) {
    trajectory = 'slowing';
    rule = `at least ${pts(THRESHOLDS.accelerationPoints)} slower than the year before`;
  } else {
    trajectory = 'growing';
    rule = `above ${pct(THRESHOLDS.stableGrowth)}`;
  }
  const used = [f0, f1, ...(g1 !== null && f2 ? [f2] : [])];
  const prior = g1 !== null ? `, after ${pct(g1)} in FY${latest - 1}` : '';
  return {
    metric: `${metric}_growth`,
    trajectory,
    basis: `Growth of ${pct(g0)} in FY${latest}${prior} (${trajectory}: ${rule}).`,
    periods: used.map((f) => f.period).reverse(),
    chunkIds: [...new Set(used.map((f) => f.chunkId))],
    values: used.map((f) => f.value).reverse(),
    inputs: used.map(inputOf).reverse(),
  };
}

/** Margin trajectory: numerator / revenue for the latest two fiscal years, both from one filing. */
export function marginTrend(facts: readonly FinancialFact[], numerator: Metric, name: string): Trend | null {
  const dens = byDocument(facts, 'revenue', 'annual');
  for (const num of byDocument(facts, numerator, 'annual')) {
    const docId = [...num.values()][0]!.documentId;
    const den = dens.find((d) => [...d.values()][0]!.documentId === docId);
    if (!den) continue;
    const y0 = [...num.keys()].map(fiscalYear).filter((y): y is number => y !== null && den.has(`FY${y}`)).sort((a, b) => b - a)[0];
    if (y0 === undefined) continue;
    const n0 = num.get(`FY${y0}`)!;
    const d0 = den.get(`FY${y0}`)!;
    const n1 = num.get(`FY${y0 - 1}`);
    const d1 = den.get(`FY${y0 - 1}`);
    if (!n1 || !d1 || d0.value <= 0 || d1.value <= 0) continue;
    // Numerator and revenue from one table (an income statement), never a note against a statement.
    if (new Set([n0, d0, n1, d1].map((f) => f.tableStart)).size !== 1) continue;
    const m0 = (n0.value * n0.scale) / (d0.value * d0.scale);
    const m1 = (n1.value * n1.scale) / (d1.value * d1.scale);
    const delta = ratio(m0 - m1);
    const trajectory: MarginTrajectory = delta >= THRESHOLDS.marginPoints ? 'improving' : delta <= -THRESHOLDS.marginPoints ? 'declining' : 'stable';
    return {
      metric: name,
      trajectory,
      basis: `${pct(m0)} in FY${y0} vs ${pct(m1)} in FY${y0 - 1}, a change of ${pts(delta)} (${trajectory}: threshold ${pts(THRESHOLDS.marginPoints)}).`,
      periods: [`FY${y0 - 1}`, `FY${y0}`],
      chunkIds: [...new Set([n1, d1, n0, d0].map((f) => f.chunkId))],
      values: [m1, m0],
      inputs: [n1, d1, n0, d0].map(inputOf),
    };
  }
  return null;
}

/** Year-over-year growth of the latest reported quarter, from that 10-Q's comparative columns. */
export function latestQuarterGrowth(facts: readonly FinancialFact[], metric: Metric = 'revenue'): Trend | null {
  for (const doc of byDocument(facts, metric, 'quarter')) {
    const latest = [...doc.keys()].sort().at(-1);
    if (!latest) continue;
    const m = /^FY(\d{4})Q(\d)$/.exec(latest);
    if (!m) continue;
    const prior = doc.get(`FY${Number(m[1]) - 1}Q${m[2]}`);
    const cur = doc.get(latest)!;
    if (!prior || prior.value <= 0 || prior.rowStart !== cur.rowStart) continue;
    const g = ratio((cur.value * cur.scale) / (prior.value * prior.scale) - 1);
    const trajectory: GrowthTrajectory = g < -THRESHOLDS.stableGrowth ? 'declining' : Math.abs(g) <= THRESHOLDS.stableGrowth ? 'stable' : 'growing';
    return {
      metric: `${metric}_quarter_growth`,
      trajectory,
      basis: `${latest} ${pct(g)} versus ${prior.period} (${trajectory}; stable within ±${pct(THRESHOLDS.stableGrowth)}).`,
      periods: [prior.period, latest],
      chunkIds: [...new Set([prior.chunkId, cur.chunkId])],
      values: [prior.value, cur.value],
      inputs: [prior, cur].map(inputOf),
    };
  }
  return null;
}

export function computeTrends(facts: readonly FinancialFact[]): Trend[] {
  return [
    growthTrend(facts, 'revenue'),
    marginTrend(facts, 'gross_profit', 'gross_margin'),
    marginTrend(facts, 'operating_income', 'operating_margin'),
    marginTrend(facts, 'net_income', 'net_margin'),
    latestQuarterGrowth(facts, 'revenue'),
  ].filter((t): t is Trend => t !== null);
}

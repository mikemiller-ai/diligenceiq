'use client';

import type { CompanyIntelligenceProfile, ProfileFact, ProfileSignal, Trajectory, TrendBasis } from '@diligenceiq/core';
import { parseDriverChangeBasis, parseTrendBasis } from '@diligenceiq/core';
import { ArrowDownRight, ArrowLeftRight, ArrowRight, ArrowUpRight, Minus, Plus, Repeat2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/*
 * Bottom line up front and at-a-glance signals for the Company Intelligence dashboard (DD-21).
 * Everything here is a fixed rule over the stored profile, and every label, direction and
 * colour comes from the builder's own outputs: a trend's trajectory and its `basis` line (read
 * back by core `parseTrendBasis`, pinned to the builder in packages/rag), a signal's type and
 * measurement, and a driver's `changeBasis`. Facts are used only for numbers the builder also
 * derived, from the same source row (sparklines, the exact value behind a rounded change, the
 * latest dollar amount). Nothing is generated on page view. Colours describe direction only,
 * never a judgment: green/red only for "more is more" metrics (revenue, profit, cash, revenue
 * lines); everything else is neutral.
 */

export type Direction = 'up' | 'down' | 'flat' | 'slowing' | 'mixed' | 'repeat' | 'new' | 'info' | 'none';

const TRAJECTORY_DIRECTION: Record<Trajectory, Direction> = {
  accelerating: 'up',
  growing: 'up',
  improving: 'up',
  stable: 'flat',
  slowing: 'slowing',
  declining: 'down',
  not_extracted: 'none',
  limited_history: 'none',
};

/** Metrics where neither direction is better: shown with an arrow, never coloured. */
const NEUTRAL_METRICS = new Set(['Debt', 'Capital spending']);

/** Colours are tokens only (a dark palette redefines them); chip text uses the ink tokens, ≥ 4.5:1 on their tint. */
const STYLE: Record<Direction, { icon: LucideIcon; chip: string; dot: string }> = {
  up: { icon: ArrowUpRight, chip: 'bg-ok/12 text-ok-ink', dot: 'var(--ok)' },
  down: { icon: ArrowDownRight, chip: 'bg-destructive/10 text-destructive-ink', dot: 'var(--destructive)' },
  slowing: { icon: ArrowDownRight, chip: 'bg-risk-med/15 text-risk-med-ink', dot: 'var(--risk-med)' },
  flat: { icon: ArrowRight, chip: 'bg-secondary text-foreground/75', dot: 'var(--muted-foreground)' },
  /** Compare only: the companies' directions differ (never coloured). */
  mixed: { icon: ArrowLeftRight, chip: 'bg-secondary text-foreground/75', dot: 'var(--muted-foreground)' },
  repeat: { icon: Repeat2, chip: 'bg-secondary text-foreground/75', dot: 'var(--muted-foreground)' },
  new: { icon: Plus, chip: 'bg-primary/10 text-primary', dot: 'var(--primary)' },
  info: { icon: ArrowRight, chip: 'bg-primary/10 text-primary', dot: 'var(--primary)' },
  none: { icon: Minus, chip: 'bg-secondary text-muted-foreground', dot: 'var(--muted-foreground)' },
};

/** What each symbol means, in words: the screen-reader text of an icon-only chip and the legend. */
export const DIRECTION_WORD: Record<Direction, string> = {
  up: 'increased',
  down: 'decreased',
  slowing: 'slowing',
  flat: 'about the same',
  mixed: 'directions differ',
  repeat: 'repeated',
  new: 'new',
  info: 'for information',
  none: 'not available',
};

/** The legend under the bottom line: every symbol the bottom line and the chips use. */
export const LEGEND: ReadonlyArray<{ direction: Direction; text: string }> = [
  { direction: 'up', text: 'increased (sales, profit, cash)' },
  { direction: 'down', text: 'decreased' },
  { direction: 'slowing', text: 'slowing: still growing, more slowly' },
  { direction: 'flat', text: 'about the same, or neither direction is better' },
  { direction: 'repeat', text: 'repeated in every annual report' },
  { direction: 'new', text: 'new or expanded disclosure' },
];

export const trajectoryDirection = (t: Trajectory, metric?: string): Direction => {
  const d = TRAJECTORY_DIRECTION[t];
  return metric && NEUTRAL_METRICS.has(metric) && (d === 'up' || d === 'down' || d === 'slowing') ? 'flat' : d;
};

/** `neutral`: keep the direction's arrow but not its colour (a metric where neither direction is better). */
export function SignalChip({ direction, neutral = false, children, className }: { direction: Direction; neutral?: boolean; children: React.ReactNode; className?: string }) {
  const s = STYLE[direction];
  const Icon = s.icon;
  return (
    <span data-direction={neutral ? 'neutral' : direction} className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[12px] font-semibold', neutral ? STYLE.flat.chip : s.chip, className)}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      {children}
    </span>
  );
}

export function directionColor(d: Direction): string {
  return STYLE[d].dot;
}

/** A small trend line; the last point takes the direction's colour. */
export function Sparkline({ values, direction, label, width = 96 }: { values: number[]; direction: Direction; label: string; width?: number }) {
  if (values.length < 2) return null;
  const w = width;
  const h = 26;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => [(i * (w - 8)) / (values.length - 1) + 4, h - 4 - ((v - min) / (max - min || 1)) * (h - 8)] as const);
  const last = pts.at(-1)!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label} className="shrink-0">
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1.5} />
      <circle cx={last[0]} cy={last[1]} r={3} fill={directionColor(direction)} />
    </svg>
  );
}

/* ------------------------------------------------------------- formatting */

const MINUS = '−';

/** A signed change at `digits` decimals; a value that rounds to zero has no sign. */
export function signed(v: number, unit: '%' | ' pp', digits = 1): string {
  const r = Math.abs(v).toFixed(digits);
  if (Number(r) === 0) return `${r}${unit}`;
  return `${v > 0 ? '+' : MINUS}${r}${unit}`;
}
export const signedPct = (v: number, digits = 1) => signed(v, '%', digits);
export const signedPp = (v: number, digits = 1) => signed(v, ' pp', digits);
/** A level (a margin), with a typographic minus for a loss. */
export function level(v: number): string {
  const r = Math.abs(v).toFixed(1);
  return `${v < 0 && Number(r) !== 0 ? MINUS : ''}${r}%`;
}

export function money(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? MINUS : '';
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a.toLocaleString('en-US')}`;
}

/** The builder's thresholds (packages/corpus trends.ts): ±2.0% for growth, 1.0 pp for margins. */
export const GROWTH_THRESHOLD = 2;
export const MARGIN_THRESHOLD = 1;
export const ACCELERATION_THRESHOLD = 5;

/**
 * A change as a chip shows it: one decimal, unless that rounding would contradict the builder's
 * label at its threshold ("+1.0 pp" labeled Stable, "+2.0%" labeled Growing). Then it shows the
 * exact comparable figure to two decimals, or says which side of the threshold it is on.
 */
export function changeText(kind: 'growth' | 'margin', v: number, trajectory: Trajectory, exact: number | null): string {
  const unit = kind === 'growth' ? '%' : ' pp';
  const r = Number(Math.abs(v).toFixed(1));
  const threshold = kind === 'growth' ? GROWTH_THRESHOLD : MARGIN_THRESHOLD;
  const contradicts = kind === 'margin' ? (trajectory === 'stable' ? r >= threshold : r < threshold) : trajectory !== 'stable' && r <= threshold;
  if (!contradicts) return signed(v, unit);
  if (exact !== null) return signed(exact, unit, 2);
  if (trajectory === 'stable') return `within ±${threshold.toFixed(1)}${unit}`;
  return `${v >= 0 ? 'over +' : `under ${MINUS}`}${threshold.toFixed(1)}${unit}`;
}

/* ------------------------------------------------------------- reading the builder's outputs */

export interface Point {
  period: string;
  value: number;
  fact: ProfileFact;
}

const ANNUAL = /^FY\d{4}$/;
const yearOf = (period: string) => Number(/^FY(\d{4})/.exec(period)?.[1] ?? Number.NaN);

/** The fiscal year of the latest annual report the profile cites, e.g. "FY2025". */
export function latestFiscalYear(profile: CompanyIntelligenceProfile): string | null {
  return (
    profile.citations
      .filter((c) => c.filingType === '10-K' && ANNUAL.test(c.fiscalLabel))
      .map((c) => c.fiscalLabel)
      .sort()
      .at(-1) ?? null
  );
}

/**
 * Whether a line about `period` is current: an annual figure must be the latest annual report's
 * year (a FY2022 cash flow never sits beside FY2024 revenue); a quarter must not predate that year.
 */
export function isCurrent(profile: CompanyIntelligenceProfile, period: string): boolean {
  const fy = latestFiscalYear(profile);
  if (!fy) return false;
  return ANNUAL.test(period) ? period === fy : yearOf(period) >= yearOf(fy);
}

export interface ReadTrend {
  metric: string;
  trajectory: Trajectory;
  basis: TrendBasis;
  chunkIds: string[];
}

/**
 * A metric's trend with its basis read back. Null when the builder produced none, or its basis
 * does not read back with the same trajectory: nothing is shown that cannot be traced to the
 * builder's own line (every basis in every built set reads back: tested).
 */
export function readTrend(profile: CompanyIntelligenceProfile, metric: string): ReadTrend | null {
  const t = profile.trends.find((x) => x.metric === metric);
  if (!t) return null;
  const basis = parseTrendBasis(t.basis);
  if (!basis || basis.trajectory !== t.trajectory) return null;
  return { metric, trajectory: t.trajectory, basis, chunkIds: t.chunkIds };
}

/** Keeps the trailing run of consecutive fiscal years. */
function consecutive<T extends { period: string }>(points: T[]): T[] {
  const out: T[] = [];
  for (const p of [...points].reverse()) {
    if (out.length > 0 && yearOf(p.period) !== yearOf(out[0]!.period) - 1) break;
    out.unshift(p);
  }
  return out;
}

/**
 * A metric's annual values that are comparable with each other, the way the builder picks them
 * (trends.ts): only facts from the trend's own source passages, from ONE table row (the latest
 * fact's), never a fact whose cross-check against another filing failed (`mismatch`, e.g. a
 * restatement), consecutive years only, oldest first. Suspect facts never reach a profile.
 */
export function comparableSeries(profile: CompanyIntelligenceProfile, metric: string, trend: Pick<ReadTrend, 'chunkIds'>): Point[] {
  const ids = new Set(trend.chunkIds);
  const byPeriod = new Map<string, ProfileFact>();
  for (const f of profile.facts) {
    if (f.metric === metric && ANNUAL.test(f.period) && ids.has(f.chunkId) && f.crossCheck !== 'mismatch' && !byPeriod.has(f.period)) byPeriod.set(f.period, f);
  }
  const sorted = [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  const last = sorted.at(-1);
  if (!last) return [];
  const row = sorted.filter((f) => f.chunkId === last.chunkId && f.rawRow === last.rawRow);
  return consecutive(row.map((f) => ({ period: f.period, value: f.value * f.scale, fact: f })));
}

/** A margin per year from a comparable numerator and revenue of one table (the trend's), in percent. */
export function comparableMarginSeries(profile: CompanyIntelligenceProfile, numerator: string, trend: Pick<ReadTrend, 'chunkIds'>): Array<{ period: string; value: number }> {
  const den = new Map(comparableSeries(profile, 'Revenue', trend).map((p) => [p.period, p]));
  return consecutive(
    comparableSeries(profile, numerator, trend).flatMap((p) => {
      const d = den.get(p.period);
      return d && d.value > 0 && d.fact.chunkId === p.fact.chunkId ? [{ period: p.period, value: (p.value / d.value) * 100 }] : [];
    }),
  );
}

export const pctChange = (from: number, to: number) => ((to - from) / Math.abs(from)) * 100;

/** Year-over-year growth per fiscal year from consecutive comparable values. */
export function growthSeries(series: Point[]): Array<{ period: string; value: number }> {
  return series.slice(1).flatMap((p, i) => (series[i]!.value > 0 ? [{ period: p.period, value: pctChange(series[i]!.value, p.value) }] : []));
}

export const MARGINS: Record<string, [string, string]> = {
  'Gross margin': ['Gross profit', 'Revenue'],
  'Operating margin': ['Operating income', 'Revenue'],
  'Net margin': ['Net income', 'Revenue'],
};

/** Dollar metrics whose growth the builder labels (packages/rag metrics.ts). */
const GROWTH_ROWS = new Set(['Revenue', 'Operating income', 'Net income', 'Operating cash flow']);

/**
 * A bank's or other financial company's operating cash flow moves with customer deposits, loans
 * and trading balances, so neither direction is better there: its arrow is shown, never coloured
 * (DD-21 b).
 */
export const neutralCashFlow = (profile: Pick<CompanyIntelligenceProfile, 'sector'>) => profile.sector === 'Financials';

/** The exact growth behind a rounded basis figure, when the comparable facts reproduce it. */
function exactGrowth(series: Point[], basis: Extract<TrendBasis, { kind: 'growth' }>): number | null {
  const [prior, latest] = [series.at(-2), series.at(-1)];
  if (!prior || !latest || latest.period !== basis.period || prior.value <= 0) return null;
  const g = pctChange(prior.value, latest.value);
  return Math.abs(g - basis.pct) <= 0.05 ? g : null;
}

function exactMarginChange(series: Array<{ period: string; value: number }>, basis: Extract<TrendBasis, { kind: 'margin' }>): number | null {
  const [prior, latest] = [series.at(-2), series.at(-1)];
  if (!prior || !latest || latest.period !== basis.period || prior.period !== basis.priorPeriod) return null;
  const d = latest.value - prior.value;
  return Math.abs(d - basis.changePp) <= 0.1 ? d : null;
}

export interface RowChange {
  /** The "vs prior year" chip text. */
  text: string;
  direction: Direction;
  neutral: boolean;
  /** Comparable values for the sparkline, oldest first (may be shorter than two: no sparkline). */
  series: Array<{ period: string; value: number }>;
  /** The period the builder's basis line states the change for, e.g. "FY2025". */
  period: string;
}

/**
 * The "vs prior year" chip and the sparkline of a performance row: only for a metric the builder
 * labeled, with the builder's figure and direction. Null otherwise (no chip, no sparkline).
 */
export function rowChange(profile: CompanyIntelligenceProfile, metric: string): RowChange | null {
  const t = readTrend(profile, metric);
  if (!t) return null;
  const b = t.basis;
  if (metric === 'Revenue growth') {
    if (b.kind !== 'growth' || b.priorPct === null) return null;
    const pp = b.pct - b.priorPct;
    // The change in the growth rate. The builder calls it only for Accelerating, Slowing and a
    // plain Growing (under 5.0 pp either way); otherwise the arrow is shown without a colour.
    const rebound = b.priorPct < 0;
    const called: Partial<Record<Trajectory, Direction>> = { accelerating: 'up', slowing: 'slowing', ...(rebound ? {} : { growing: 'flat' as const }) };
    const direction = called[t.trajectory] ?? (pp > 0 ? 'up' : pp < 0 ? 'down' : 'flat');
    return { text: signedPp(pp), direction, neutral: called[t.trajectory] === undefined, series: growthSeries(comparableSeries(profile, 'Revenue', t)), period: b.period };
  }
  const margin = MARGINS[metric];
  if (margin) {
    if (b.kind !== 'margin') return null;
    const series = comparableMarginSeries(profile, margin[0], t);
    return { text: changeText('margin', b.changePp, t.trajectory, exactMarginChange(series, b)), direction: trajectoryDirection(t.trajectory, metric), neutral: false, series, period: b.period };
  }
  if (GROWTH_ROWS.has(metric) && b.kind === 'growth') {
    const points = comparableSeries(profile, metric, t);
    const neutral = metric === 'Operating cash flow' && neutralCashFlow(profile);
    return { text: changeText('growth', b.pct, t.trajectory, exactGrowth(points, b)), direction: trajectoryDirection(t.trajectory, metric), neutral, series: points.map(({ period, value }) => ({ period, value })), period: b.period };
  }
  return null;
}

/** A driver's change and share in percent (core `parseDriverChangeBasis`, pinned to the builder's format). */
export function driverFigures(changeBasis: string): { pct: number | null; share: number | null } {
  const { changePct, share } = parseDriverChangeBasis(changeBasis);
  return { pct: changePct, share };
}

/** A revenue line's chip direction: the same ±2% the trend labels use. */
export const driverDirection = (pct: number | null): Direction => (pct === null ? 'none' : pct > GROWTH_THRESHOLD ? 'up' : pct < -GROWTH_THRESHOLD ? 'down' : 'flat');

/** Periods spanned by every annual report in the profile, for "in every annual report". */
export function annualPeriods(profile: CompanyIntelligenceProfile): string[] {
  return [...new Set(profile.signals.flatMap((s) => s.periods).filter((p) => ANNUAL.test(p)))].sort();
}

/** Persistent signals that span every annual report in the corpus. */
export function persistentEverywhere(profile: CompanyIntelligenceProfile): ProfileSignal[] {
  const years = profile.coverage.tenK;
  return profile.signals.filter((s) => s.type === 'PERSISTENT' && s.periods.filter((p) => ANNUAL.test(p)).length >= years && years >= 2);
}

/** NEW and EXPANDED signals. Their detectors are suppressed today (DD-18), so this is empty; a future detector fills it. */
const freshSignals = (profile: CompanyIntelligenceProfile) => profile.signals.filter((s) => s.type === 'NEW' || s.type === 'EXPANDED');

/**
 * A signal's chip direction, from its type and, for a trend change, the trajectory of the trend
 * its measurement states (never from model-written headline text).
 */
export function signalDirection(s: ProfileSignal, profile: CompanyIntelligenceProfile): { direction: Direction; neutral: boolean } {
  switch (s.type) {
    case 'PERSISTENT':
      return { direction: 'repeat', neutral: false };
    case 'NEW':
    case 'EXPANDED':
      return { direction: 'new', neutral: false };
    case 'REDUCED':
      // Less disclosure is neither better nor worse: the arrow, no colour.
      return { direction: 'down', neutral: true };
    case 'OUTLOOK_CHANGE':
      return { direction: 'info', neutral: false };
    case 'TREND_CHANGE': {
      const trend = profile.trends.find((t) => t.basis === s.measurement);
      const trajectory = trend?.trajectory ?? parseTrendBasis(s.measurement)?.trajectory;
      return trajectory ? { direction: trajectoryDirection(trajectory, trend?.metric), neutral: false } : { direction: 'info', neutral: false };
    }
  }
}

/* ------------------------------------------------------------- bottom line and lead lines */

export interface BottomLineItem {
  key: 'revenue' | 'profit' | 'cash' | 'lines' | 'risks';
  direction: Direction;
  /** Arrow without colour (neither direction is better for this company's metric). */
  neutral: boolean;
  title: string;
  /** Always names its period. */
  detail: string;
  /** Section the line summarizes, for the "see more" link. */
  anchor: string;
}

const REVENUE_TITLE: Partial<Record<Trajectory, string>> = {
  declining: 'Revenue fell',
  stable: 'Revenue about flat',
  accelerating: 'Revenue growth picked up',
  slowing: 'Revenue growth slowed',
  growing: 'Revenue grew',
};

const CASH_TITLE: Partial<Record<Trajectory, string>> = {
  declining: 'Cash from operations fell',
  stable: 'Cash from operations about the same',
  accelerating: 'Cash from operations rose',
  slowing: 'Cash from operations growth slowed',
  growing: 'Cash from operations rose',
};

/** "+6.4% in FY2025, after +2.0% in FY2024" from a growth basis. */
const growthDetail = (b: Extract<TrendBasis, { kind: 'growth' }>) =>
  `${signedPct(b.pct)} in ${b.period}${b.priorPct !== null && b.priorPeriod ? `, after ${signedPct(b.priorPct)} in ${b.priorPeriod}` : ''}`;

/**
 * The profit line's title: profit wording, or loss wording when either year's margin is zero or
 * below. `operating` words it for the operating margin (the fallback when net margin has no
 * current trend): "operating profit", "operating loss".
 */
export function profitTitle(b: Extract<TrendBasis, { kind: 'margin' }>, operating = false): string {
  const op = operating ? 'operating ' : '';
  const Op = operating ? 'Operating' : 'Net';
  if (b.prior <= 0 && b.latest > 0) return `Swung to ${operating ? 'an operating' : 'a'} profit`;
  if (b.prior > 0 && b.latest <= 0) return `Swung to ${operating ? 'an operating' : 'a'} loss`;
  if (b.prior <= 0 && b.latest <= 0) return b.trajectory === 'improving' ? `${Op} loss narrowed` : b.trajectory === 'declining' ? `${Op} loss widened` : `${Op} loss about the same`;
  return b.trajectory === 'improving'
    ? `Keeps more of each sale as ${op}profit`
    : b.trajectory === 'declining'
      ? `Keeps less of each sale as ${op}profit`
      : `${operating ? 'Operating profit' : 'Profit'} per sale about the same`;
}

/** The latest dollar amount behind a growth trend, from the trend's own row, when the profile holds it. */
export function latestAmount(profile: CompanyIntelligenceProfile, metric: string, t: Pick<ReadTrend, 'chunkIds' | 'basis'>): number | null {
  const last = comparableSeries(profile, metric, t).at(-1);
  return last && last.period === t.basis.period ? last.value : null;
}

/**
 * The bottom line, in a fixed order: revenue, profit per sale, cash from operations, revenue
 * lines, risks. At most five lines. Each is the builder's own label and figures for the latest
 * annual report; a line about an older year is left out.
 */
export function bottomLine(profile: CompanyIntelligenceProfile): BottomLineItem[] {
  const out: BottomLineItem[] = [];
  const current = (period: string) => isCurrent(profile, period);

  const rev = readTrend(profile, 'Revenue');
  if (rev && rev.basis.kind === 'growth' && current(rev.basis.period) && REVENUE_TITLE[rev.trajectory]) {
    out.push({ key: 'revenue', direction: trajectoryDirection(rev.trajectory), neutral: false, title: REVENUE_TITLE[rev.trajectory]!, detail: growthDetail(rev.basis), anchor: 'performance' });
  }

  // Profit per sale: the net margin's trend, or, when the builder has no current net-margin trend
  // (CAT: net income not extracted), the operating margin's. Either way the builder's own label and basis.
  const profit = profitTrend(profile);
  if (profit) {
    const { trend, operating } = profit;
    const b = trend.basis as Extract<TrendBasis, { kind: 'margin' }>;
    out.push({
      key: 'profit',
      direction: trajectoryDirection(trend.trajectory),
      neutral: false,
      title: profitTitle(b, operating),
      detail: `${operating ? 'operating' : 'net'} margin ${level(b.prior)} in ${b.priorPeriod} → ${level(b.latest)} in ${b.period}`,
      anchor: 'performance',
    });
  }

  const cash = readTrend(profile, 'Operating cash flow');
  if (cash && cash.basis.kind === 'growth' && current(cash.basis.period) && CASH_TITLE[cash.trajectory]) {
    const amount = latestAmount(profile, 'Operating cash flow', cash);
    out.push({
      key: 'cash',
      direction: trajectoryDirection(cash.trajectory),
      neutral: neutralCashFlow(profile),
      title: CASH_TITLE[cash.trajectory]!,
      detail: `${signedPct(cash.basis.pct)} in ${cash.basis.period}${amount === null ? '' : `, to ${money(amount)}`}`,
      anchor: 'performance',
    });
  }

  const lines = linesItem(profile);
  if (lines) out.push(lines);

  const fresh = freshSignals(profile);
  if (fresh[0]) {
    out.push({ key: 'risks', direction: 'new', neutral: false, title: `${fresh.length} new or expanded risk disclosure${fresh.length === 1 ? '' : 's'}`, detail: fresh[0].headline, anchor: 'whats-changed' });
  } else {
    const areas = new Set(persistentEverywhere(profile).map((s) => s.category)).size;
    const years = annualPeriods(profile);
    // Never "unchanged": the new and expanded detectors are off (DD-18), so only the repetition is stated.
    if (areas > 0 && years.length >= 2) {
      out.push({
        key: 'risks',
        direction: 'repeat',
        neutral: false,
        title: `${areas} risk area${areas === 1 ? '' : 's'} in every annual report`,
        detail: `disclosed in each annual report from ${years[0]} to ${years.at(-1)}`,
        anchor: 'current-risks',
      });
    }
  }
  return out.slice(0, 5);
}

/** The margin trend behind the profit line: Net margin when it reads back and is current, else Operating margin under the same rule, else none. */
export function profitTrend(profile: CompanyIntelligenceProfile): { trend: ReadTrend; operating: boolean } | null {
  for (const [metric, operating] of [
    ['Net margin', false],
    ['Operating margin', true],
  ] as const) {
    const t = readTrend(profile, metric);
    if (t && t.basis.kind === 'margin' && isCurrent(profile, t.basis.period)) return { trend: t, operating };
  }
  return null;
}

/** The revenue-lines line: the largest line that fell by more than 2%, or "all grew" when every line grew by more than 2%. */
function linesItem(profile: CompanyIntelligenceProfile): BottomLineItem | null {
  if (profile.drivers.length === 0) return null;
  const fy = latestFiscalYear(profile);
  if (!profile.drivers.every((d) => d.periods.at(-1) === fy)) return null;
  const lines = profile.drivers.map((d) => ({ d, ...driverFigures(d.changeBasis) }));
  const falling = lines.filter((x) => driverDirection(x.pct) === 'down').sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  if (falling[0]) {
    const f = falling[0];
    return { key: 'lines', direction: 'down', neutral: false, title: `${f.d.label} declined`, detail: `${signedPct(f.pct!)} in ${fy}${f.share !== null ? `, ${f.share}% of revenue` : ''}`, anchor: 'drivers' };
  }
  if (lines.length >= 2 && lines.every((x) => driverDirection(x.pct) === 'up')) {
    const largest = [...lines].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))[0]!;
    return {
      key: 'lines',
      direction: 'up',
      neutral: false,
      title: lines.length === 2 ? 'Both revenue lines grew' : `All ${lines.length} revenue lines grew`,
      detail: `in ${fy}; largest: ${largest.d.label}${largest.share !== null ? `, ${largest.share}% of revenue` : ''}`,
      anchor: 'drivers',
    };
  }
  return null;
}

/** The lead line (key number) for a 30-second-view card, by dimension. Null when the builder's outputs do not support a current one. */
export function viewLead(profile: CompanyIntelligenceProfile, dimension: string): string | null {
  switch (dimension) {
    case 'Performance': {
      const t = readTrend(profile, 'Revenue growth');
      return t && t.basis.kind === 'growth' && isCurrent(profile, t.basis.period) ? `Revenue ${growthDetail(t.basis)}` : null;
    }
    case 'Profitability': {
      const t = readTrend(profile, 'Operating margin');
      return t && t.basis.kind === 'margin' && isCurrent(profile, t.basis.period)
        ? `Operating margin ${level(t.basis.latest)} in ${t.basis.period} (${changeText('margin', t.basis.changePp, t.trajectory, null)})`
        : null;
    }
    case 'Latest quarter': {
      const t = readTrend(profile, 'Quarterly revenue growth');
      return t && t.basis.kind === 'quarter' && isCurrent(profile, t.basis.period) ? `Revenue ${signedPct(t.basis.pct)} in ${t.basis.period} vs ${t.basis.priorPeriod}` : null;
    }
    case 'Cash generation': {
      const t = readTrend(profile, 'Operating cash flow');
      if (!t || t.basis.kind !== 'growth' || !isCurrent(profile, t.basis.period)) return null;
      const amount = latestAmount(profile, 'Operating cash flow', t);
      return `Operating cash flow ${signedPct(t.basis.pct)} in ${t.basis.period}${amount === null ? '' : `, to ${money(amount)}`}`;
    }
    case 'Risk changes': {
      const fresh = freshSignals(profile).length;
      if (fresh) return `${fresh} new or expanded disclosure${fresh === 1 ? '' : 's'}`;
      const areas = new Set(persistentEverywhere(profile).map((s) => s.category)).size;
      const years = annualPeriods(profile);
      return areas && years.length >= 2 ? `${areas} risk area${areas === 1 ? '' : 's'} in every annual report, ${years[0]}–${years.at(-1)}` : null;
    }
    case 'Evidence coverage':
      return `${profile.coverage.tenK} annual + ${profile.coverage.tenQ} quarterly reports`;
    default:
      return null;
  }
}

/** The chip of a 30-second-view label ("Growing", "Persistent", "Deep coverage"); "Not extracted" and the limited labels say nothing about direction. */
export function viewDirection(label: string): Direction {
  const l = label.toLowerCase();
  if (/not extracted|limited history|limited evidence/.test(l)) return 'none';
  if (/accelerat|growing|improving/.test(l)) return 'up';
  if (/declining/.test(l)) return 'down';
  if (/slowing/.test(l)) return 'slowing';
  if (/persistent/.test(l)) return 'repeat';
  if (/coverage/.test(l)) return 'info';
  if (/new|expanded/.test(l)) return 'new';
  return 'flat';
}

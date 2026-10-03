import { isFixtureProfile, type CompanyIntelligenceProfile, type CompareResult, type SignalCategory, type Trajectory, type TrendBasis } from '@diligenceiq/core';
import { DIRECTION_WORD, isCurrent, latestAmount, level, money, readTrend, rowChange, type Direction, type ReadTrend, type RowChange } from '@/components/intelligence/signals';

/*
 * The refined Compare (DD-21 h): a bottom line, the side-by-side cells and the risk-area grid,
 * each a fixed rule over the stored profiles and core `composeCompare`. Every label, direction and
 * figure is the builder's (a trend's trajectory and its basis line, through the step 3 reading);
 * nothing is recomputed, inferred from model text, or generated on page view.
 */

/**
 * How a company's trend for a metric may be shown (DD-21 g, the dashboard's rules):
 * - `chip`: the trend's basis reads back with the same trajectory, the builder labeled its change
 *   (`rowChange`), and it is about the latest annual report's year (`isCurrent`, as on the dashboard);
 * - `stale`: it reads back but is about an older year (e.g. a FY2022 cash flow beside FY2024
 *   revenue): never a direction colour, and the year is named;
 * - `plain`: anything else (no profile, no trend, no read-back, or no labeled change).
 */
export type TrendRead = { kind: 'chip'; change: RowChange; trend: ReadTrend } | { kind: 'stale'; period: string } | { kind: 'plain' };

export function trendRead(profile: CompanyIntelligenceProfile | undefined, metric: string, trajectory: Trajectory): TrendRead {
  const trend = profile ? readTrend(profile, metric) : null;
  if (!profile || !trend || trend.trajectory !== trajectory) return { kind: 'plain' };
  if (!isCurrent(profile, trend.basis.period)) return { kind: 'stale', period: trend.basis.period };
  const change = rowChange(profile, metric);
  return change ? { kind: 'chip', change, trend } : { kind: 'plain' };
}

/* ------------------------------------------------------------- side-by-side cells */

/**
 * The latest value beside a trend chip: a margin's level from its basis line; a dollar metric's
 * latest amount from the trend's own source row, only when it is the basis year (the dashboard's
 * `latestAmount`). Null when the profile does not hold it.
 */
export function latestValue(profile: CompanyIntelligenceProfile, read: Extract<TrendRead, { kind: 'chip' }>): string | null {
  const b = read.trend.basis;
  if (b.kind === 'margin') return level(b.latest);
  if (b.kind !== 'growth') return null;
  const amount = latestAmount(profile, read.trend.metric, read.trend);
  return amount === null ? null : money(amount);
}

/** "after +125.9% in FY2024": the prior year's growth, shown when it explains the label (slowing, accelerating, or a recovery). */
export function priorGrowth(read: Extract<TrendRead, { kind: 'chip' }>): string | null {
  const b = read.trend.basis;
  if (b.kind !== 'growth' || b.priorPct === null) return null;
  const explains = b.trajectory === 'slowing' || b.trajectory === 'accelerating' || b.priorPct < 0;
  return explains ? `after ${signedOne(b.priorPct)}${b.priorPeriod ? ` in ${b.priorPeriod}` : ''}` : null;
}

const MINUS = '−';
const signedOne = (v: number) => {
  const r = Math.abs(v).toFixed(1);
  return Number(r) === 0 ? `${r}%` : `${v > 0 ? '+' : MINUS}${r}%`;
};

/* ------------------------------------------------------------- the bottom line */

export interface CompareLine {
  key: 'Revenue' | 'Operating margin' | 'Operating cash flow' | 'shared' | 'distinctive';
  direction: Direction;
  /** Arrow without colour: one company differs, mixed directions, or a metric where neither direction is better. */
  neutral: boolean;
  /** What the chip means, for screen readers. */
  chipText: string;
  title: string;
  detail: string;
  /** The section the line summarizes. */
  anchor: 'side-by-side' | 'diverging' | 'risk-areas';
  /**
   * A metric line whose companies point in opposite directions by the line's own groups (rising,
   * including slowing, against falling): the names in each. Null otherwise and for the risk lines.
   */
  opposite: { rising: string[]; falling: string[] } | null;
}

/** The metrics the bottom line states, in order (operating income stays in the table). */
export const BOTTOM_LINE_METRICS = ['Revenue', 'Operating margin', 'Operating cash flow'] as const;

type Group = 'rising' | 'flat' | 'falling';
type Klass = 'up' | 'slowing' | 'flat' | 'down';
type Kind = 'growth' | 'margin';
const KLASS: Partial<Record<Trajectory, Klass>> = { accelerating: 'up', growing: 'up', improving: 'up', slowing: 'slowing', stable: 'flat', declining: 'down' };
const GROUP: Record<Klass, Group> = { up: 'rising', slowing: 'rising', flat: 'flat', down: 'falling' };

interface Entry {
  ticker: string;
  name: string;
  klass: Klass;
  read: Extract<TrendRead, { kind: 'chip' }>;
  /** Loss wording for an operating margin at or below zero in either year; null otherwise. */
  loss: string | null;
}

/** "both", "all three" … "all five", for every selected company. */
const ALL = ['', '', 'both', 'all three', 'all four', 'all five'];
export function nameList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * An operating margin's loss wording, as the dashboard's `profitTitle` words a net margin: a margin
 * at or below zero in either year is never said to widen or narrow. Null when both years are positive.
 */
export function operatingLoss(b: TrendBasis): string | null {
  if (b.kind !== 'margin' || (b.prior > 0 && b.latest > 0)) return null;
  if (b.prior <= 0 && b.latest > 0) return 'swung to an operating profit';
  if (b.prior > 0) return 'swung to an operating loss';
  return b.trajectory === 'improving' ? 'operating loss narrowed' : b.trajectory === 'declining' ? 'operating loss widened' : 'operating loss was about the same';
}

const metricWord = (metric: string) => (metric === 'Operating cash flow' ? 'operating cash flow' : metric.toLowerCase());
/** The builder's figure as stated in the basis line: growth in percent, a margin change in points. */
const figureOf = (e: Entry) => {
  const b = e.read.trend.basis;
  return b.kind === 'margin' ? b.changePp : b.kind === 'growth' ? b.pct : 0;
};
/**
 * Largest first (or smallest, for a decline) by the builder's figure; ties keep the selection order
 * (`Array.prototype.sort` is stable and the entries are in the order the companies were chosen).
 */
const byFigure = (es: readonly Entry[], order: 'desc' | 'asc') => [...es].sort((a, b) => (order === 'desc' ? figureOf(b) - figureOf(a) : figureOf(a) - figureOf(b)));
/** "+17.8 pp in FY2025 (operating loss narrowed)": the change, its period, and loss wording when it applies. */
const changeIn = (e: Entry) => `${e.read.change.text} in ${e.read.change.period}${e.loss ? ` (${e.loss})` : ''}`;
/** ", slowing from +125.9% in FY2024": a slowing company's prior-year growth, from its basis line. */
const slowingFrom = (e: Entry) => {
  const b = e.read.trend.basis;
  return b.kind === 'growth' && b.priorPct !== null && b.priorPeriod ? `, slowing from ${signedOne(b.priorPct)} in ${b.priorPeriod}` : ', slowing';
};
/** The change without its sign, for a title that already says the direction; null when the text is a bound ("within ±1.0 pp"). */
const magnitude = (text: string) => (/^[+−]/.test(text) ? text.slice(1) : null);
const anyLoss = (es: readonly Entry[]) => es.some((e) => e.loss !== null);

/** A group's verb: loss-making margins get neutral words ("improved", "declined"), never "widened" or "narrowed". */
function groupVerb(kind: Kind, klass: 'up' | 'down', loss: boolean): string {
  if (kind === 'growth') return klass === 'up' ? 'grew' : 'fell';
  if (loss) return klass === 'up' ? 'improved' : 'declined';
  return klass === 'up' ? 'widened' : 'narrowed';
}
/** What the other companies did, after an outlier. */
function doing(kind: Kind, klass: Klass, loss: boolean): string {
  if (klass === 'flat') return 'about the same';
  if (kind === 'growth') return { up: 'growing', slowing: 'still growing, more slowly', down: 'falling' }[klass];
  if (loss) return klass === 'down' ? 'declining' : 'improving';
  return klass === 'down' ? 'narrowing' : 'widening';
}
/** The direction phrase of a mixed line, by class. */
function at(kind: Kind, klass: Klass, loss: boolean): string {
  if (klass === 'flat') return 'about the same at';
  if (klass === 'slowing') return 'growth slowed at';
  return `${groupVerb(kind, klass, loss)} at`;
}
const KLASS_ORDER: readonly Klass[] = ['up', 'slowing', 'flat', 'down'];

const CHIP: Record<Klass, Direction> = { up: 'up', slowing: 'slowing', flat: 'flat', down: 'down' };

/**
 * Why a company is not in a metric's line, in the table's own terms: a preview profile, a trend
 * about an older year, a trend not extracted or with limited history, or no labelled change.
 */
function notCompared(metric: string, result: CompareResult, profiles: ReadonlyMap<string, CompanyIntelligenceProfile>, read: Set<string>): string[] {
  const row = result.trajectories.find((r) => r.metric === metric);
  return result.companies
    .filter((c) => !read.has(c.ticker))
    .map((c) => {
      const profile = profiles.get(c.ticker);
      const v = row?.values.find((x) => x.ticker === c.ticker);
      if (profile && isFixtureProfile(profile)) return `${c.company} (preview profile)`;
      const r = v ? trendRead(profile, metric, v.trajectory) : { kind: 'plain' as const };
      if (r.kind === 'stale') return `${c.company} (latest trend ${r.period})`;
      if (v?.trajectory === 'not_extracted') return `${c.company} (not extracted)`;
      if (v?.trajectory === 'limited_history') return `${c.company} (limited history)`;
      return `${c.company} (no labelled change)`;
    });
}

function metricLine(metric: (typeof BOTTOM_LINE_METRICS)[number], result: CompareResult, profiles: ReadonlyMap<string, CompanyIntelligenceProfile>): CompareLine | null {
  const row = result.trajectories.find((r) => r.metric === metric);
  if (!row) return null;
  const entries: Entry[] = row.values.flatMap((v) => {
    const profile = profiles.get(v.ticker);
    if (!profile || isFixtureProfile(profile)) return [];
    const read = trendRead(profile, metric, v.trajectory);
    const klass = KLASS[v.trajectory];
    if (read.kind !== 'chip' || !klass) return [];
    return [{ ticker: v.ticker, name: profile.company, klass, read, loss: operatingLoss(read.trend.basis) }];
  });
  if (entries.length < 2) return null;

  const kind: Kind = metric === 'Operating margin' ? 'margin' : 'growth';
  const everyone = entries.length === result.companies.length;
  const who = (es: readonly Entry[]) => (everyone && es.length === entries.length ? ALL[es.length]! : nameList(es.map((e) => e.name)));
  const excluded = notCompared(metric, result, profiles, new Set(entries.map((e) => e.ticker)));
  const tail = excluded.length ? `; not compared: ${excluded.join(', ')}` : '';
  const anyNeutral = entries.some((e) => e.read.change.neutral);
  const diverging = result.diverging.some((d) => d.metric === metric);
  const names = (es: readonly Entry[]) => es.map((e) => e.name);

  const groups = new Map<Group, Entry[]>();
  for (const e of entries) groups.set(GROUP[e.klass], [...(groups.get(GROUP[e.klass]) ?? []), e]);
  const rising = groups.get('rising') ?? [];
  const falling = groups.get('falling') ?? [];
  const opposite = rising.length && falling.length ? { rising: names(rising), falling: names(falling) } : null;
  const base = { key: metric, opposite } as const;

  // Every company read is in one direction group: the only lines with a direction colour.
  if (groups.size === 1) {
    const group = GROUP[entries[0]!.klass];
    if (group === 'rising') {
      const top = byFigure(entries, 'desc')[0]!;
      if (entries.every((e) => e.klass === 'slowing')) {
        return {
          ...base,
          direction: 'slowing',
          neutral: anyNeutral,
          chipText: chipWords('slowing', anyNeutral),
          title: `${metric} growth slowed at ${who(entries)}`,
          detail: `still growing at each; largest at ${top.name}, ${changeIn(top)}${slowingFrom(top)}${tail}`,
          anchor: 'side-by-side',
        };
      }
      const slowing = entries.filter((e) => e.klass === 'slowing' && e !== top);
      return {
        ...base,
        direction: 'up',
        neutral: anyNeutral,
        chipText: chipWords('up', anyNeutral),
        title: `${metric} ${groupVerb(kind, 'up', anyLoss(entries))} at ${who(entries)}`,
        detail: `largest at ${top.name}, ${changeIn(top)}${top.klass === 'slowing' ? slowingFrom(top) : ''}${slowing.length ? `; slowing at ${nameList(names(slowing))}` : ''}${tail}`,
        anchor: 'side-by-side',
      };
    }
    if (group === 'flat') {
      return {
        ...base,
        direction: 'flat',
        neutral: false,
        chipText: chipWords('flat', false),
        title: `${metric} about the same at ${who(entries)}`,
        detail: `${entries.map((e) => `${e.name} ${changeIn(e)}`).join('; ')}${tail}`,
        anchor: 'side-by-side',
      };
    }
    const bottom = byFigure(entries, 'asc')[0]!;
    return {
      ...base,
      direction: 'down',
      neutral: anyNeutral,
      chipText: chipWords('down', anyNeutral),
      title: `${metric} ${groupVerb(kind, 'down', anyLoss(entries))} at ${who(entries)}`,
      detail: `largest decline at ${bottom.name}, ${changeIn(bottom)}${tail}`,
      anchor: 'side-by-side',
    };
  }

  // Three or more read, and exactly one company differs from all the others: it leads, without a
  // direction colour (the companies do not share a direction), keeping its own arrow.
  const loners = [...groups.values()].filter((g) => g.length === 1);
  if (entries.length >= 3 && groups.size === 2 && loners.length === 1) {
    const one = loners[0]![0]!;
    const others = entries.filter((e) => e !== one);
    const b = one.read.trend.basis;
    const size = magnitude(one.read.change.text);
    let title: string;
    let lead: string;
    if (b.kind === 'margin') {
      const loss = one.loss;
      if (loss) title = loss.startsWith('swung') ? `${one.name} ${loss}` : `${one.name}’s ${loss}`;
      else title = `${one.name}’s operating margin ${one.klass === 'up' ? 'widened' : one.klass === 'down' ? 'narrowed' : 'was about the same'}${one.klass !== 'flat' && size ? ` ${size}` : ''}`;
      lead = `to ${level(b.latest)} in ${b.period}${loss ? `, ${one.read.change.text}` : ''}`;
    } else {
      const moved = one.klass !== 'flat' && size !== null;
      const verb = one.klass === 'flat' ? 'was about the same' : one.klass === 'down' ? 'fell' : 'grew';
      title = `${one.name}’s ${metricWord(metric)} ${verb}${moved ? ` ${size}` : ''}${one.klass === 'slowing' ? ', more slowly than the year before' : ''}`;
      lead = moved ? `in ${one.read.change.period}${one.klass === 'slowing' && b.kind === 'growth' && b.priorPct !== null && b.priorPeriod ? `, after ${signedOne(b.priorPct)} in ${b.priorPeriod}` : ''}` : changeIn(one);
    }
    const rest = KLASS_ORDER.flatMap((k) => {
      const es = others.filter((e) => e.klass === k);
      if (es.length === 0) return [];
      const labelled = es.map((e) => (e.read.trend.basis.kind === 'margin' ? `${e.name} (${level(e.read.trend.basis.latest)})` : e.name));
      return [`${nameList(labelled)} ${doing(kind, k, anyLoss(es))}`];
    });
    const d = CHIP[one.klass];
    return {
      ...base,
      direction: d,
      neutral: true,
      chipText: `${DIRECTION_WORD[d]} at one company only`,
      title,
      detail: `${lead}; ${rest.join(', ')}${tail}`,
      anchor: diverging ? 'diverging' : 'side-by-side',
    };
  }

  // Otherwise: the directions by company, under a distinct "directions differ" symbol.
  const parts = KLASS_ORDER.flatMap((k) => {
    const es = entries.filter((e) => e.klass === k);
    return es.length ? [`${at(kind, k, anyLoss(es))} ${nameList(names(es))}`] : [];
  });
  return {
    ...base,
    direction: 'mixed',
    neutral: true,
    chipText: DIRECTION_WORD.mixed,
    title: `${metric} ${parts.join('; ')}`,
    detail: `${entries.map((e) => `${e.name} ${changeIn(e)}`).join('; ')}${tail}`,
    anchor: diverging ? 'diverging' : 'side-by-side',
  };
}

function chipWords(d: Direction, neutral: boolean): string {
  return `${DIRECTION_WORD[d]}${neutral && d !== 'flat' ? ', neither direction is better' : ''}`;
}

/**
 * The bottom line's footer (DD-21 h): whether any metric line points in opposite directions, by the
 * lines' own groups (slowing counts as still rising), so the footer always agrees with the lines.
 * Core's Diverging trends section keeps core's rule (rising against declining, slowing excluded).
 */
export function oppositeNote(lines: readonly CompareLine[]): string {
  const opposite = lines.filter((l) => l.opposite);
  if (opposite.length === 0) return 'No metric above points in opposite directions across these companies.';
  return `Opposite directions: ${opposite.map((l) => `${l.key} (rising at ${nameList(l.opposite!.rising)}, falling at ${nameList(l.opposite!.falling)})`).join('; ')}.`;
}

/**
 * The comparison bottom line (DD-21 h): at most five lines, in a fixed order (revenue, operating
 * margin, operating cash flow, shared risk areas, areas at only one company). `preview`: a fixture
 * profile is compared, so no risk line is drawn from its imperfect heading list.
 */
export function compareBottomLine(result: CompareResult, profiles: ReadonlyMap<string, CompanyIntelligenceProfile>, preview: boolean): CompareLine[] {
  const out: CompareLine[] = [];
  for (const metric of BOTTOM_LINE_METRICS) {
    const line = metricLine(metric, result, profiles);
    if (line) out.push(line);
  }
  if (!preview) {
    const n = result.companies.length;
    const all = ALL[n] ?? `all ${n}`;
    const common = result.common;
    out.push(
      common.length
        ? {
            key: 'shared',
            direction: 'info',
            neutral: false,
            chipText: 'for information',
            title: `${common.length} risk area${common.length === 1 ? '' : 's'} shared by ${all}`,
            detail: common.map((t) => t.label).join(', '),
            anchor: 'risk-areas',
            opposite: null,
          }
        : {
            key: 'shared',
            direction: 'info',
            neutral: false,
            chipText: 'for information',
            title: `No risk area shared by ${all}`,
            detail: 'each area appears for some of the companies only',
            anchor: 'risk-areas',
            opposite: null,
          },
    );
    const distinctive = result.distinctive;
    if (distinctive.length) {
      const holders = [...new Set(distinctive.map((t) => t.tickers[0]!))];
      const nameOf = (t: string) => result.companies.find((c) => c.ticker === t)?.company ?? t;
      const one = holders.length === 1;
      out.push({
        key: 'distinctive',
        direction: 'info',
        neutral: false,
        chipText: 'for information',
        title: one
          ? `${distinctive.length} area${distinctive.length === 1 ? '' : 's'} only at ${nameOf(holders[0]!)}`
          : `${distinctive.length} areas at only one company`,
        detail: one
          ? distinctive.map((t) => t.label).join(', ')
          : holders.map((h) => `${nameOf(h)}: ${distinctive.filter((t) => t.tickers[0] === h).map((t) => t.label).join(', ')}`).join('; '),
        anchor: 'risk-areas',
        opposite: null,
      });
    }
  }
  return out.slice(0, 5);
}

/** The bottom line's legend: the symbols its lines use, in words (DD-21 b, h). */
const LINE_LEGEND: ReadonlyArray<{ direction: Direction; text: string }> = [
  { direction: 'up', text: 'increased at every company' },
  { direction: 'slowing', text: 'still growing, more slowly' },
  { direction: 'down', text: 'decreased at every company' },
  { direction: 'flat', text: 'about the same' },
  { direction: 'mixed', text: 'directions differ' },
  { direction: 'info', text: 'risk areas, for information' },
];

/** The legend entries a set of bottom-line lines needs: each coloured symbol used, and the grey arrow when one is uncoloured. */
export function lineLegend(lines: readonly CompareLine[]): { items: typeof LINE_LEGEND; grey: boolean } {
  const used = new Set(lines.filter((l) => !l.neutral || l.direction === 'mixed').map((l) => l.direction));
  return { items: LINE_LEGEND.filter((l) => used.has(l.direction)), grey: lines.some((l) => l.neutral && l.direction !== 'mixed') };
}

/* ------------------------------------------------------------- the risk-area grid */

export interface GridCell {
  ticker: string;
  company: string;
  /** The company's latest risk headings in this area, verbatim, in their filing order. */
  headings: Array<{ heading: string; rank: number; citationIds: string[] }>;
  /** Its signals in this area (type and headline as stored). */
  signals: Array<{ headline: string; citationIds: string[] }>;
  /** Every citation behind the cell: the headings' and the signals' (core's theme evidence for this company). */
  citationIds: string[];
}

export interface GridRow {
  category: SignalCategory;
  label: string;
  rank: number;
  /** "All three", "2 of 3", "Only NVDA". */
  share: string;
  cells: Array<GridCell | null>;
}

/**
 * One row per risk area in the attention ranking's order, one cell per company (null when the
 * company does not have the area). Replaces the common, distinctive and ranking lists.
 */
export function riskGrid(result: CompareResult, profiles: ReadonlyMap<string, CompanyIntelligenceProfile>): GridRow[] {
  const n = result.companies.length;
  return result.attentionRanking.map((r) => ({
    category: r.category,
    label: r.label,
    rank: r.rank,
    share: r.tickers.length === n ? (n === 2 ? 'Both' : `All ${ALL[n]?.replace('all ', '') ?? n}`) : r.tickers.length === 1 ? `Only ${r.tickers[0]}` : `${r.tickers.length} of ${n}`,
    cells: result.companies.map((c) => {
      const p = profiles.get(c.ticker);
      if (!p || !r.tickers.includes(c.ticker)) return null;
      const headings = p.currentRisks.filter((x) => x.category === r.category).map((x) => ({ heading: x.heading, rank: x.rank, citationIds: x.citationIds }));
      const signals = p.signals.filter((s) => s.category === r.category).map((s) => ({ headline: s.headline, citationIds: s.citationIds }));
      return { ticker: c.ticker, company: c.company, headings, signals, citationIds: [...new Set([...headings.flatMap((h) => h.citationIds), ...signals.flatMap((s) => s.citationIds)])] };
    }),
  }));
}

/** The cell's tint step, by its number of risk headings (0–4; 4 means four or more). */
export const tintStep = (headings: number) => Math.min(4, headings);

import type { Chunk } from '../chunker';
import type { ProcessedFiling } from '../filing';
import { fiscalPeriod, fiscalYearForYearEnd } from '../periods';
import type { SectionKind } from '../sections';
import { INSTANT_METRICS, type Metric, matchMetric } from './metrics';
import {
  type Duration,
  type PeriodColumn,
  type Scale,
  type Table,
  type TableRow,
  alignValues,
  dollarChangeColumns,
  durationLabels,
  groupMonthDays,
  hasNoteColumn,
  headerPeriods,
  rowLabel,
  rowValues,
  scaleHint,
  tablesIn,
} from './tables';

/**
 * Deterministic financial extraction (DD-17; SPEC §9). Every value records metric, period,
 * value, unit, scale, the source chunk, the verbatim source row and a cross-check flag.
 * The model never produces a number: profiles render figures only from these facts.
 *
 * Scope: tables in the financial statements and MD&A sections (DD-17). Integrated-report 10-Ks
 * whose statements sit inside the bare-title MD&A are covered by the MD&A scope.
 *
 * One table per metric. For each filing, metric and duration, ONE source row is chosen and all
 * of that metric's periods come from it, so a growth rate never mixes a segment table with an
 * income statement. The row from a primary statement (its caption: "CONSOLIDATED STATEMENTS OF
 * OPERATIONS/INCOME/EARNINGS", "…BALANCE SHEETS", "…CASH FLOWS", including "Condensed
 * Consolidated" 10-Q forms) wins; another table is used only when no statement row has the
 * metric, and such facts carry `source: 'other_table'`. Facts that fail a plausibility check
 * against the same filing's revenue are kept but marked `suspect`, and trends ignore them.
 * 10-K facts are annual flows and year-end balances; 10-Q facts are quarter and year-to-date
 * flows (from their comparative columns) and quarter-end balances.
 */
export type FactDuration = Duration | 'instant';

export interface FinancialFact {
  metric: Metric;
  /** `FY2025`; `FY2026Q3` (a quarter, or a quarter-end balance); `FY2026Q1-Q3` (year to date). */
  period: string;
  periodEnd: string | null;
  duration: FactDuration;
  /**
   * As reported in the table, before scaling. Signed, except capital expenditures, which are
   * stored as the amount spent (cash-flow statements show them in parentheses, MD&A tables
   * as positive), so the two sources can be cross-checked.
   */
  value: number;
  unit: 'USD';
  scale: Scale;
  documentId: string;
  fiscalLabel: string;
  chunkId: string;
  /** The source table row, verbatim. */
  rawRow: string;
  rowStart: number;
  /** Start of the source table; margins need numerator and denominator from one table. */
  tableStart: number;
  section: SectionKind;
  /** A primary statement row, or another table (a note or an MD&A table) used as a fallback. */
  source: 'statement' | 'other_table';
  /** Why the value failed a plausibility check against the same filing's revenue; null when it passed. */
  suspect: string | null;
  crossCheck: 'ok' | 'mismatch' | 'single_source';
}

/** Sections scanned, in priority order (DD-17). */
const SECTION_PRIORITY: Partial<Record<SectionKind, number>> = { financial_statements: 0, mda: 1 };

type Statement = 'income' | 'balance' | 'cash_flow';

/** The primary statement each metric belongs to. */
const METRIC_STATEMENT: Record<Metric, Statement> = {
  revenue: 'income',
  gross_profit: 'income',
  operating_income: 'income',
  net_income: 'income',
  cash_and_equivalents: 'balance',
  total_debt: 'balance',
  capital_expenditures: 'cash_flow',
  operating_cash_flow: 'cash_flow',
};

/**
 * Captions that open a table, nearest last. A statement caption ("CONSOLIDATED STATEMENTS OF
 * OPERATIONS", "Condensed Consolidated Balance Sheets", "STATEMENTS OF CONSOLIDATED INCOME",
 * "Consolidated statements of income") names a primary statement; a note heading ("Note 3:
 * Revenue") or a comprehensive-income or equity statement names something else.
 */
const CAPTIONS: ReadonlyArray<[Statement | 'other', RegExp]> = [
  ['other', /Statements?\s*of\s*(?:Consolidated\s*)?(?:Comprehensive|Changes\s*in|(?:Share|Stock)holders['’]?|Equity|Shareowners)/gi],
  [
    'income',
    /(?:Consolidated|Combined)\s*(?:and\s*Combined\s*)?(?:Statements?|Results)\s*of\s*(?:Operations|Income|Earnings)|Statements?\s*of\s*Consolidated\s*(?:Income|Operations|Earnings)|Consolidated\s*Income\s*Statements?/gi,
  ],
  ['balance', /(?:Consolidated|Combined)\s*(?:Balance\s*Sheets?|Statements?\s*of\s*(?:Financial\s*(?:Position|Condition)|Condition))|Statements?\s*of\s*Consolidated\s*Financial\s*Position/gi],
  ['cash_flow', /(?:Consolidated|Combined)\s*Statements?\s*of\s*Cash\s*Flows?|Statements?\s*of\s*Consolidated\s*Cash\s*Flows?/gi],
  // UPPER CASE titles without "Consolidated" (MSFT: "INCOME STATEMENTS", "BALANCE SHEETS", "CASH FLOWS STATEMENTS").
  // May be glued to the text before ("…SUPPLEMENTARY DATAINCOME STATEMENTS").
  ['income', /INCOME\s*STATEMENTS?\b|STATEMENTS?\s*OF\s*(?:OPERATIONS|INCOME|EARNINGS)\b/g],
  ['balance', /BALANCE\s*SHEETS?\b/g],
  ['cash_flow', /CASH\s*FLOWS?\s*STATEMENTS?\b|STATEMENTS?\s*OF\s*CASH\s*FLOWS?\b/g],
  ['other', /COMPREHENSIVE\s*INCOME\s*STATEMENTS?\b/g],
  ['other', /\bNote\s*\d{1,2}\s*[:.\-–—]|\bNOTE\s*\d{1,2}\b/g],
];
/** A caption inside a sentence ("…recorded in the Consolidated Statements of Income") is a reference, not a caption. */
const CAPTION_IN_SENTENCE = /\b(?:the|our|in|on|within|to|from|of|and|its|see|per|into|through)\s+$/i;
/** Characters searched above a table's header row for its caption. */
const CAPTION_LOOKBACK = 800;

/** The statement a header row belongs to, from the nearest caption above it (or `other`). */
export function statementOf(text: string, headerStart: number): Statement | 'other' {
  const from = Math.max(0, headerStart - CAPTION_LOOKBACK);
  const window = text.slice(from, headerStart);
  let best: { at: number; end: number; kind: Statement | 'other' } | null = null;
  for (const [kind, re] of CAPTIONS) {
    for (const m of window.matchAll(re)) {
      const before = window.slice(Math.max(0, m.index - 20), m.index);
      if (CAPTION_IN_SENTENCE.test(before)) continue;
      // An index or TOC row ("Consolidated Balance Sheets as of … | 31") is not a caption.
      const le = window.indexOf('\n', m.index);
      const line = window.slice(m.index, le === -1 ? window.length : le);
      if (/\|\s*(?:F-)?\d{1,3}\s*$/.test(line)) continue;
      // The caption that ends last wins; at the same end, the longer one ("COMPREHENSIVE INCOME STATEMENTS").
      const end = m.index + m[0].length;
      if (!best || end > best.end || (end === best.end && m.index < best.at)) best = { at: m.index, end, kind };
    }
  }
  return best?.kind ?? 'other';
}

/**
 * Plausibility checks against the same filing's revenue for the same period (DD-17). A failing
 * fact is kept with its reason, shown as unverified, and excluded from trends.
 */
export const PLAUSIBILITY = {
  /** Net margin must lie strictly inside (−200%, 100%). */
  minNetMargin: -2,
  maxNetMargin: 1,
} as const;

function plausibility(facts: Array<Omit<FinancialFact, 'crossCheck' | 'suspect'>>): Array<Omit<FinancialFact, 'crossCheck'>> {
  const revenue = new Map(facts.filter((f) => f.metric === 'revenue').map((f) => [`${f.period}|${f.duration}`, f.value * f.scale]));
  return facts.map((f) => {
    const r = revenue.get(`${f.period}|${f.duration}`);
    const v = f.value * f.scale;
    let suspect: string | null = null;
    if (f.metric === 'revenue' && v <= 0) suspect = 'revenue is not positive';
    else if (r !== undefined && r > 0) {
      if (f.metric === 'operating_income' && Math.abs(v) > r) suspect = 'operating income larger than revenue';
      else if (f.metric === 'gross_profit' && v > r) suspect = 'gross profit larger than revenue';
      else if (f.metric === 'net_income' && (v / r <= PLAUSIBILITY.minNetMargin || v / r >= PLAUSIBILITY.maxNetMargin)) suspect = 'net margin outside (−200%, 100%)';
    }
    return { ...f, suspect };
  });
}
/** Characters searched above a table for its unit hint. */
const UNIT_LOOKBACK = 600;

function sectionOf(filing: ProcessedFiling, offset: number): SectionKind {
  return filing.sections.find((s) => offset >= s.start && offset < s.end)?.kind ?? 'other';
}

/** A period-end date within a week of the company's fiscal year end is a year end. */
function isYearEnd(date: string, annualEnds: readonly string[]): boolean {
  const md = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`);
    return Date.UTC(2000, x.getUTCMonth(), x.getUTCDate());
  };
  return annualEnds.some((a) => {
    const diff = Math.abs(md(date) - md(a)) / 86_400_000;
    return Math.min(diff, 366 - diff) <= 7;
  });
}

interface ColumnPeriod {
  period: string;
  periodEnd: string | null;
  duration: FactDuration;
}

/** Period label for a column, or null when the column cannot be labeled without guessing. */
export function columnPeriod(
  col: PeriodColumn,
  metric: Metric,
  filing: ProcessedFiling,
  annualEnds: readonly string[],
): ColumnPeriod | null {
  const { ticker, filingType } = filing.meta;
  const instant = INSTANT_METRICS.has(metric);
  if (!col.date) {
    // Bare years ("2025") name fiscal years in a 10-K's annual tables; in a 10-Q they are ambiguous.
    if (filingType !== '10-K') return null;
    return { period: `FY${col.year}`, periodEnd: null, duration: instant ? 'instant' : 'annual' };
  }
  const yearEnd = isYearEnd(col.date, annualEnds);
  if (instant) {
    const label = yearEnd ? `FY${fiscalYearForYearEnd(ticker, col.date)}` : fiscalPeriod(ticker, '10-Q', col.date, annualEnds).fiscalLabel;
    return { period: label, periodEnd: col.date, duration: 'instant' };
  }
  if (filingType === '10-K') {
    if (col.duration !== null && col.duration !== 'annual') return null;
    if (!yearEnd) return null;
    return { period: `FY${fiscalYearForYearEnd(ticker, col.date)}`, periodEnd: col.date, duration: 'annual' };
  }
  if (col.duration === null || col.duration === 'annual' || yearEnd) return null;
  const fp = fiscalPeriod(ticker, '10-Q', col.date, annualEnds);
  if (col.duration === 'quarter') return { period: fp.fiscalLabel, periodEnd: col.date, duration: 'quarter' };
  if (fp.fiscalQuarter === 1) return null; // a "year to date" first quarter is the quarter itself
  return { period: `FY${fp.fiscalYear}Q1-Q${fp.fiscalQuarter}`, periodEnd: col.date, duration: 'ytd' };
}

/** Header context for a row: the nearest period header above it in its table, and duration groups. */
function headerFor(table: Table, rowIndex: number): { cols: PeriodColumn[]; row: TableRow } | null {
  for (let i = rowIndex - 1; i >= 0; i--) {
    const row = table.rows[i]!;
    const cols = headerPeriods(row);
    if (cols.length === 0) continue;
    // Duration groups from the label rows above the date row (and the date row itself).
    let labelRow = row;
    let labels: Duration[] = durationLabels(labelRow);
    for (let j = i - 1; j >= Math.max(0, i - 2) && labels.length === 0; j--) {
      labelRow = table.rows[j]!;
      labels = durationLabels(labelRow);
    }
    if (!labels.length || cols.length % labels.length !== 0) return { cols, row };
    const per = cols.length / labels.length;
    // Bare-year columns under "Three Months Ended September 30": take the date from the label.
    const monthDays = groupMonthDays(labelRow);
    const dated = cols.map((c, k) => {
      const g = Math.floor(k / per);
      const md = monthDays.length === labels.length ? monthDays[g] : undefined;
      const date = c.date ?? (md ? `${c.year}-${String(md.month).padStart(2, '0')}-${String(md.day).padStart(2, '0')}` : null);
      return { ...c, date, duration: labels[g]! };
    });
    return { cols: dated, row };
  }
  return null;
}

/**
 * A filing reports its own periods and their comparatives only: a 10-K its fiscal year and
 * the two before it (a later column is a schedule such as debt maturities; an earlier one is
 * a multi-year summary); a 10-Q its own quarter (and year to date) and the same quarter a
 * year earlier. Anything else comes from a note about something else and is skipped.
 */
export function ownPeriod(cp: ColumnPeriod, filing: ProcessedFiling): boolean {
  const { fiscalYear, fiscalQuarter, filingType } = filing.meta;
  const year = Number(cp.period.slice(2, 6));
  if (filingType === '10-K') return year <= fiscalYear && year >= fiscalYear - 2;
  if (cp.duration === 'instant') return true;
  const q = /Q(\d)$/.exec(cp.period)?.[1];
  return Number(q) === fiscalQuarter && (year === fiscalYear || year === fiscalYear - 1);
}

export function chunkAt(chunks: readonly Chunk[], start: number, end: number): Chunk | undefined {
  return chunks.find((c) => c.charStart <= start && end <= c.charEnd);
}

/** Whether a fact is the filing's own latest period (its fiscal year, quarter, year to date or balance date). */
function isOwnLatest(cp: ColumnPeriod, filing: ProcessedFiling): boolean {
  const { fiscalLabel, fiscalYear, fiscalQuarter } = filing.meta;
  if (cp.duration === 'ytd') return cp.period === `FY${fiscalYear}Q1-Q${fiscalQuarter}`;
  return cp.period === fiscalLabel;
}

type Draft = Omit<FinancialFact, 'crossCheck' | 'suspect'>;

export function extractFilingFacts(filing: ProcessedFiling, chunks: readonly Chunk[], annualEnds: readonly string[]): FinancialFact[] {
  const { text } = filing;
  // One source row per metric and duration: the best-ranked row, with all its periods.
  const best = new Map<string, { rank: number[]; facts: Map<string, Draft> }>();
  for (const table of tablesIn(text, 0, text.length)) {
    const section = sectionOf(filing, table.start);
    const sectionRank = SECTION_PRIORITY[section];
    if (sectionRank === undefined) continue;
    table.rows.forEach((row, ri) => {
      const label = rowLabel(row);
      const match = label ? matchMetric(label) : null;
      if (!match) return;
      const header = headerFor(table, ri);
      if (!header) return;
      const { cols } = header;
      // The unit hint is the last one at or above the header row ("(In millions…)").
      const context = text.slice(Math.max(0, header.row.start - UNIT_LOOKBACK), header.row.end);
      // Some statements put the unit in a row under the dates ("| (In millions, except per share amounts)", AMD).
      const scale = lastScaleHint(context) ?? lastScaleHint(text.slice(header.row.end, Math.min(row.start, header.row.end + 300)));
      if (!scale) return;
      // A discontinued-operations note restates a divested business (JNJ's Kenvue), not the company.
      if (/discontinued\s+operations?/i.test(context)) return;
      const values = alignValues(rowValues(row), cols.length, dollarChangeColumns(header.row), hasNoteColumn(header.row));
      if (!values) return;
      const chunk = chunkAt(chunks, row.start, row.end);
      if (!chunk) return;
      const source: FinancialFact['source'] = statementOf(text, header.row.start) === METRIC_STATEMENT[match.metric] ? 'statement' : 'other_table';
      const byDuration = new Map<FactDuration, { own: boolean; facts: Map<string, Draft> }>();
      cols.forEach((col, k) => {
        const reported = values[k]!.value;
        if (reported === null) return;
        const v = match.metric === 'capital_expenditures' ? Math.abs(reported) : reported;
        const cp = columnPeriod(col, match.metric, filing, annualEnds);
        if (!cp) return;
        if (!ownPeriod(cp, filing)) return;
        let group = byDuration.get(cp.duration);
        if (!group) byDuration.set(cp.duration, (group = { own: false, facts: new Map() }));
        if (group.facts.has(cp.period)) return; // a repeated period column: keep the first
        group.own ||= isOwnLatest(cp, filing);
        group.facts.set(cp.period, {
          metric: match.metric,
          ...cp,
          value: v,
          unit: 'USD',
          scale,
          documentId: filing.meta.documentId,
          fiscalLabel: filing.meta.fiscalLabel,
          chunkId: chunk.chunkId,
          rawRow: row.text,
          rowStart: row.start,
          tableStart: table.start,
          section,
          source,
        });
      });
      for (const [duration, group] of byDuration) {
        const key = `${match.metric}|${duration}`;
        const rank = [source === 'statement' ? 0 : 1, group.own ? 0 : 1, sectionRank, match.priority, row.start];
        const prev = best.get(key);
        if (prev && compareRank(prev.rank, rank) <= 0) continue;
        best.set(key, { rank, facts: group.facts });
      }
    });
  }
  const chosen = [...best.values()].flatMap((b) => [...b.facts.values()]);
  // When the filing's income statement (or cash-flow statement) was found, a metric of that
  // statement which it does not show (JNJ and XOM report no operating income; PFE no gross
  // profit) is not extracted, rather than taken from a segment or note table (DIS segment
  // "Operating Income"; an XOM segment "Capital expenditures" row). Balance-sheet metrics may
  // still fall back: total debt, for one, is usually reported in a note.
  const found = new Set(chosen.filter((f) => f.source === 'statement').map((f) => METRIC_STATEMENT[f.metric]));
  const drafts = chosen.filter((f) => !(f.source === 'other_table' && METRIC_STATEMENT[f.metric] !== 'balance' && found.has(METRIC_STATEMENT[f.metric])));
  return plausibility(drafts).map((f) => ({ ...f, crossCheck: 'single_source' as const }));
}

/**
 * The unit hint closest above a table. A parenthetical such as "(In millions, except number of
 * shares, which are reflected in thousands, and per-share amounts)" names the table's unit
 * first, so the first scale word inside the last such parenthetical wins.
 */
export function lastScaleHint(text: string): Scale | null {
  const parens = [...text.matchAll(/\(([^()]{0,200})\)/g)].filter((m) => /thousands|millions|billions/i.test(m[1]!));
  const lastParen = parens.at(-1);
  const bare = [...text.matchAll(/\b(?:in|of)\s+(thousands|millions|billions)\b|\b(thousands|millions|billions)\s+of\s+(?:U\.S\.\s+)?dollars/gi)].at(-1);
  if (lastParen && (!bare || lastParen.index! + lastParen[0].length >= bare.index!)) {
    const w = /thousands|millions|billions/i.exec(lastParen[1]!)![0].toLowerCase();
    return w === 'thousands' ? 1e3 : w === 'millions' ? 1e6 : 1e9;
  }
  return bare ? scaleHint(bare[0]) : null;
}

function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Relative difference above which values for the same metric and period disagree (DD-17). */
export const CROSS_CHECK_TOLERANCE = 0.005;

/**
 * Cross-check across a company's filings: the same metric, period and duration reported by
 * more than one filing (a later 10-K's comparative columns, for example). A difference above
 * 0.5% marks every value `mismatch` (a restatement, or an extraction error worth seeing); the
 * values are never averaged and the build never stops.
 */
export function crossCheck(facts: readonly FinancialFact[]): FinancialFact[] {
  const groups = new Map<string, FinancialFact[]>();
  for (const f of facts) {
    const k = `${f.metric}|${f.period}|${f.duration}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return facts.map((f) => {
    const g = groups.get(`${f.metric}|${f.period}|${f.duration}`)!;
    const docs = new Set(g.map((x) => x.documentId));
    if (docs.size < 2) return { ...f, crossCheck: 'single_source' };
    const values = g.map((x) => x.value * x.scale);
    const max = Math.max(...values.map(Math.abs));
    const spread = Math.max(...values) - Math.min(...values);
    return { ...f, crossCheck: max > 0 && spread / max > CROSS_CHECK_TOLERANCE ? 'mismatch' : 'ok' };
  });
}

/** All facts for one company, cross-checked. `filings` and `chunks` are that company's. */
export function extractCompanyFacts(filings: readonly ProcessedFiling[], chunks: readonly Chunk[]): FinancialFact[] {
  const annualEnds = filings.filter((f) => f.meta.filingType === '10-K').map((f) => f.meta.periodEnd);
  const facts = filings.flatMap((f) =>
    extractFilingFacts(
      f,
      chunks.filter((c) => c.documentId === f.meta.documentId),
      annualEnds,
    ),
  );
  return crossCheck(facts);
}

export type { TableRow };

import { MONTHS } from '../periods';
import { type Span, isTableRow, lineSpans } from '../segments';

/**
 * Flattened-table parsing (DD-17). Filing tables survive as pipe-delimited rows:
 *
 *   | Year Ended
 *   | Jan 26, 2025 |  | Jan 28, 2024 |  | Jan 29, 2023
 *   Revenue | $ | 130,497 |  |  | $ | 60,922 |  |  | $ | 26,974 |
 *
 * Cells are irregular (`$` cells, empty spacer cells, `%` cells, note-reference columns), so
 * values are aligned to period columns from the right: a row's value cells must number
 * exactly the period columns (or one more, when the first is a small note reference such as
 * XOM's "Note 3"). Anything else is skipped, never guessed.
 */

export interface TableRow extends Span {
  text: string;
  cells: string[];
}

export interface Table extends Span {
  rows: TableRow[];
}

export function tablesIn(text: string, start: number, end: number): Table[] {
  const out: Table[] = [];
  let current: TableRow[] = [];
  const flush = () => {
    if (current.length) out.push({ start: current[0]!.start, end: current.at(-1)!.end, rows: current });
    current = [];
  };
  for (const line of lineSpans(text, start, end)) {
    const raw = text.slice(line.start, line.end).replace(/\n$/, '');
    if (isTableRow(raw)) current.push({ start: line.start, end: line.start + raw.length, text: raw, cells: raw.split('|').map((c) => c.trim()) });
    else flush();
  }
  flush();
  return out;
}

export type Duration = 'annual' | 'quarter' | 'ytd';

export interface PeriodColumn {
  /** ISO date for a dated column; null for a bare fiscal-year column ("2025"). */
  date: string | null;
  year: number;
  duration: Duration | null;
}

const MONTH_RE = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE = new RegExp(`${MONTH_RE}\\.?\\s*(\\d{1,2})\\s*,?\\s*(\\d{4})`, 'g');
const YEAR_CELL = /^(?:(?:Fiscal|FY)\s*)?((?:19|20)\d\d)(?:\s*\(\d\))?$/i;

function monthIndex(name: string): number {
  return MONTHS.findIndex((m) => m.toLowerCase().startsWith(name.toLowerCase().slice(0, 3)));
}

/**
 * Period columns named by a header row, left to right. When the first column carries the full
 * date and the others only a year ("Years ended December 31,2024 |  | 2023 |  | 2022", MCD),
 * the bare years take the month and day of the date before them.
 */
export function headerPeriods(row: TableRow): PeriodColumn[] {
  const out: PeriodColumn[] = [];
  let dated = 0;
  let last: { month: string; day: string } | null = null;
  for (const cell of row.cells) {
    const dates = [...cell.matchAll(DATE)].filter((m) => monthIndex(m[1]!) >= 0);
    if (dates.length) {
      for (const m of dates) {
        const month = String(monthIndex(m[1]!) + 1).padStart(2, '0');
        const day = m[2]!.padStart(2, '0');
        out.push({ date: `${m[3]}-${month}-${day}`, year: Number(m[3]), duration: null });
        last = { month, day };
        dated++;
      }
      continue;
    }
    const y = YEAR_CELL.exec(cell);
    if (y) out.push({ date: last ? `${y[1]}-${last.month}-${last.day}` : null, year: Number(y[1]), duration: null });
  }
  // Without any date, bare years only; with dates, a bare year before the first date stays undated.
  if (dated === 0) return out;
  return out.every((c) => c.date !== null) ? out : out.filter((c) => c.date !== null);
}

/** Duration groups from a label row above the dates ("Three Months Ended | Nine Months Ended"). */
export function durationLabels(row: TableRow): Duration[] {
  const out: Duration[] = [];
  for (const m of row.text.matchAll(/(Three|Six|Nine|Twelve|Thirteen|Twenty-six|Twenty-Six|Thirty-nine|Thirty-Nine|Fifty-two|Fifty-Two)\s*(?:Months|Weeks)|Quarter|Year(?:s)?\s*Ended|Year[- ]to[- ]Date/gi)) {
    const w = m[0].toLowerCase();
    if (/^(three|thirteen)|quarter/.test(w)) out.push('quarter');
    else if (/^(six|nine|twenty-six|thirty-nine)|to[- ]date/.test(w)) out.push('ytd');
    else out.push('annual');
  }
  return out;
}

/**
 * Month and day per duration group when the dates live in the label row and the columns are
 * bare years: "Three Months Ended September 30 | Nine Months Ended September 30" over
 * "2025 | 2024 | 2025 | 2024" (BAC).
 */
export function groupMonthDays(row: TableRow): Array<{ month: number; day: number }> {
  const out: Array<{ month: number; day: number }> = [];
  const re = new RegExp(`(?:Months|Weeks|Quarter|Year)\\s*Ended\\s*,?\\s*${MONTH_RE}\\.?\\s*(\\d{1,2})(?!\\s*,?\\s*\\d{4})`, 'gi');
  for (const m of row.text.matchAll(re)) {
    const mi = monthIndex(m[1]!);
    if (mi >= 0) out.push({ month: mi + 1, day: Number(m[2]) });
  }
  return out;
}

export interface ParsedValue {
  value: number | null;
  /** The cell as written ("323,905", "(247)", "3", "—"). */
  raw: string;
}

const NUMBER = /^\(?\s*\$?\s*\(?\s*-?\s*\d[\d,]*(?:\.\d+)?\s*\)?$/;
const DASH = /^[—–-]+$/;

/** Value cells of a data row, left to right: numbers and dashes (dashes keep their column). Percent cells are excluded. */
export function rowValues(row: TableRow): ParsedValue[] {
  const out: ParsedValue[] = [];
  const cells = row.cells.slice(1);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    if (!c || c === '$') continue;
    const next = cells.slice(i + 1).find((x) => x !== '');
    if (c.endsWith('%') || next === '%' || next?.startsWith('%')) continue;
    if (DASH.test(c)) {
      out.push({ value: null, raw: c });
      continue;
    }
    if (!NUMBER.test(c)) continue;
    const negative = c.includes('(') || /-\s*\d/.test(c);
    const n = Number(c.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n)) continue;
    out.push({ value: negative ? -n : n, raw: c });
  }
  return out;
}

/** The row label: its first cell with footnote markers, trailing colons and spacing removed. */
export function rowLabel(row: TableRow): string {
  return (row.cells[0] ?? '')
    .replace(/\(notes?\s*\d+[a-z]?(?:\s*(?:and|,)\s*\d+[a-z]?)*\)|\(\d\)|\*+|\(\w\)$/gi, '')
    .replace(/[:\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[’]/g, "'");
}

/**
 * Dollar-change columns a header adds after its periods ("Jan 26, 2025 | Jan 28, 2024 | $Change |
 * %Change"). Percent columns are not counted: their values are already excluded.
 */
export function dollarChangeColumns(header: TableRow): number {
  return header.cells.filter((c) => /^\$\s*Change$|^Dollar\s*Change$|^Amount\s*of\s*Change$/i.test(c)).length;
}

/** The header names a note-reference column before its periods (XOM: "(millions of dollars) | NoteReferenceNumber | 2025 | …"). */
export function hasNoteColumn(header: TableRow): boolean {
  return header.cells.some((c) => /^Notes?\b|^Note\s*Ref|NoteReference/i.test(c));
}

/**
 * Align a row's values to N period columns: exactly N values; N plus one leading note
 * reference (XOM's "Note 3"), only when the header has a note column and the extra cell is a
 * small whole number written without a comma or decimal; or N followed by the header's
 * dollar-change columns. A leading small value without a note column is a real figure (in
 * billions, say), so the row is skipped rather than shifted.
 */
export function alignValues(values: ParsedValue[], columns: number, dollarChanges = 0, noteColumn = false): ParsedValue[] | null {
  if (columns === 0) return null;
  if (values.length === columns) return values;
  if (dollarChanges > 0 && values.length === columns + dollarChanges) return values.slice(0, columns);
  if (noteColumn && values.length === columns + 1) {
    const { value: first, raw } = values[0]!;
    if (first !== null && Number.isInteger(first) && first > 0 && first < 100 && /^\d{1,2}$/.test(raw)) return values.slice(1);
  }
  return null;
}

export type Scale = 1 | 1e3 | 1e6 | 1e9;

/** Unit hint near a table: "(In millions…)", "(Dollars in Millions)", "(millions of dollars)", "in thousands". */
export function scaleHint(text: string): Scale | null {
  const m = /\b(?:in|of)\s+(thousands|millions|billions)\b|\b(thousands|millions|billions)\s+of\s+(?:U\.S\.\s+)?dollars/i.exec(text);
  const w = (m?.[1] ?? m?.[2])?.toLowerCase();
  return w === 'thousands' ? 1e3 : w === 'millions' ? 1e6 : w === 'billions' ? 1e9 : null;
}

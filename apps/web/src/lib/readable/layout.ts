import { headingPrefix, isTableRow, lineSpans, paragraphSpans, type Span } from '@diligenceiq/corpus/segments';
import { findFurniture } from './furniture';

/*
 * The readable display layer for filing text (DD-21 e). It never changes a character: it partitions
 * a range of the processed text into blocks (headings, paragraphs, lists, tables) whose runs cover
 * every offset exactly once. A run is either shown or hidden, and only two things are hidden:
 * - `furniture`: running footers and headers, page numbers, "Table of Contents" back-links;
 * - `layout`: the `|` delimiters and empty cells of a table row, and whitespace at the edges of a
 *   block (line breaks, the spaces between a glued heading and its text).
 * So the shown text is the source minus page furniture and layout, and an offset from a chunk or a
 * citation always lands on the same character. The corpus-backed test proves it for all 246 filings.
 */

export type Hidden = 'furniture' | 'layout';
export interface Run extends Span {
  hidden?: Hidden;
}

export type Unit =
  | ({ kind: 'hidden'; reason: Hidden } & Span)
  /** `text`: the shown part (trimmed); the edges are layout. */
  | ({ kind: 'heading'; level: 'title' | 'risk'; text: Span } & Span)
  | ({ kind: 'paragraph'; text: Span } & Span)
  | ({ kind: 'item'; text: Span } & Span)
  /**
   * `cells`: the non-empty cell contents (trimmed); pipes, empty cells and edges are layout.
   * `cols`: each cell's raw index among the row's `|`-separated cells (empty cells count).
   */
  | ({ kind: 'row'; cells: Span[]; cols: number[] } & Span);

export type Block =
  | ({ kind: 'heading'; level: 'title' | 'risk'; unit: Extract<Unit, { kind: 'heading' }> } & Span)
  | ({ kind: 'paragraph'; unit: Extract<Unit, { kind: 'paragraph' }> } & Span)
  /** Lists and tables keep the layout units between their items or rows. */
  | ({ kind: 'list'; units: Unit[] } & Span)
  | ({ kind: 'table'; units: Unit[] } & Span)
  | ({ kind: 'hidden'; unit: Extract<Unit, { kind: 'hidden' }> } & Span);

export interface LayoutOptions {
  /** Furniture repetition counts over the whole filing (`furnitureCounts`); without them only strong shapes are hidden. */
  furnitureCounts?: ReadonlyMap<string, number>;
  /** Risk-factor headings already extracted (corpus `riskHeadingSpans`), shown as headings. */
  riskHeadings?: readonly Span[];
}

const BULLET = /[•▪●◦]/;

/**
 * An `Item N.` heading at the start of a paragraph, glued to its first sentence or alone:
 * "Item 1A.    Risk FactorsThe following…", "ITEM 7. MANAGEMENT’S DISCUSSION AND ANALYSIS…".
 */
const ITEM_HEADING = /^((?:PART\s+[IV]{1,3}\s*,?\s*)?(?:ITEM|Item)\s*\d{1,2}[A-C]?\s*[.:—–-]?\s*[A-Z][^\n.|]{1,150}?(?:[a-z)’]|[A-Z]{2}))(?=[A-Z][a-z]|\s*$)/;

/** The heading at the start of a paragraph's (trimmed) text, if any. */
export function leadingHeading(trimmed: string): string | null {
  const item = ITEM_HEADING.exec(trimmed)?.[1];
  if (item) return item;
  return headingPrefix(trimmed.slice(0, 200));
}

function trimSpan(text: string, s: Span): Span {
  let a = s.start;
  let b = s.end;
  while (a < b && /\s/.test(text[a]!)) a++;
  while (b > a && /\s/.test(text[b - 1]!)) b--;
  return { start: a, end: b };
}

/** Subtract sorted, disjoint `holes` from [start, end). */
function subtract(start: number, end: number, holes: readonly Span[]): { kept: Span[]; holes: Span[] } {
  const kept: Span[] = [];
  const inside: Span[] = [];
  let at = start;
  for (const h of holes) {
    if (h.end <= start || h.start >= end) continue;
    const a = Math.max(h.start, start);
    const b = Math.min(h.end, end);
    if (a > at) kept.push({ start: at, end: a });
    inside.push({ start: a, end: b });
    at = b;
  }
  if (at < end) kept.push({ start: at, end });
  return { kept, holes: inside };
}

function rowUnit(text: string, s: Span): Unit {
  const cells: Span[] = [];
  const cols: number[] = [];
  let a = s.start;
  let col = 0;
  for (let i = s.start; i <= s.end; i++) {
    if (i === s.end || text[i] === '|') {
      const c = trimSpan(text, { start: a, end: i });
      if (c.end > c.start) {
        cells.push(c);
        cols.push(col);
      }
      col++;
      a = i + 1;
    }
  }
  return { kind: 'row', start: s.start, end: s.end, cells, cols };
}

/** Classify one prose piece (no line break inside, no furniture inside). */
function proseUnits(text: string, s: Span, risk: readonly Span[]): Unit[] {
  const t = trimSpan(text, s);
  if (t.end <= t.start) return [{ kind: 'hidden', reason: 'layout', start: s.start, end: s.end }];
  if (risk.some((r) => r.start === t.start && r.end === t.end)) return [{ kind: 'heading', level: 'risk', start: s.start, end: s.end, text: t }];
  const trimmed = text.slice(t.start, t.end);
  if (BULLET.test(trimmed[0]!)) return [{ kind: 'item', start: s.start, end: s.end, text: t }];
  const heading = leadingHeading(trimmed);
  if (heading) {
    const h = { start: t.start, end: t.start + heading.length };
    if (h.end >= t.end) return [{ kind: 'heading', level: 'title', start: s.start, end: s.end, text: t }];
    const rest = trimSpan(text, { start: h.end, end: s.end });
    if (rest.end <= rest.start) return [{ kind: 'heading', level: 'title', start: s.start, end: s.end, text: h }];
    return [
      { kind: 'heading', level: 'title', start: s.start, end: rest.start, text: h },
      { kind: 'paragraph', start: rest.start, end: s.end, text: rest },
    ];
  }
  return [{ kind: 'paragraph', start: s.start, end: s.end, text: t }];
}

/** Paragraph cuts inside a prose piece: glued sentence breaks (corpus), bullets, and risk-heading edges. */
function prosePieces(text: string, s: Span, risk: readonly Span[]): Span[] {
  const cuts = new Set<number>();
  for (const p of paragraphSpans(text, s.start, s.end)) cuts.add(p.start);
  for (let i = s.start + 1; i < s.end; i++) if (BULLET.test(text[i]!)) cuts.add(i);
  for (const r of risk) {
    if (r.start > s.start && r.start < s.end) cuts.add(r.start);
    if (r.end > s.start && r.end < s.end) cuts.add(r.end);
  }
  const sorted = [...cuts].filter((c) => c > s.start && c < s.end).sort((a, b) => a - b);
  const out: Span[] = [];
  let a = s.start;
  for (const c of sorted) {
    out.push({ start: a, end: c });
    a = c;
  }
  out.push({ start: a, end: s.end });
  return out;
}

/** Units covering [start, end) exactly once, in order. */
export function layoutUnits(text: string, start: number, end: number, opts: LayoutOptions = {}): Unit[] {
  const furniture = findFurniture(text, start, end, opts.furnitureCounts);
  const risk = opts.riskHeadings ?? [];
  const units: Unit[] = [];
  for (const line of lineSpans(text, start, end)) {
    const contentEnd = text[line.end - 1] === '\n' ? line.end - 1 : line.end;
    const { kept, holes } = subtract(line.start, contentEnd, furniture);
    const shown = kept.map((k) => text.slice(k.start, k.end)).join('');
    const table = isTableRow(shown);
    // Pieces in offset order: kept text and furniture holes interleave.
    const pieces = [...kept.map((k) => ({ ...k, hole: false })), ...holes.map((h) => ({ ...h, hole: true }))].sort((a, b) => a.start - b.start);
    for (const p of pieces) {
      if (p.hole) units.push({ kind: 'hidden', reason: 'furniture', start: p.start, end: p.end });
      else if (table) units.push(trimSpan(text, p).end > trimSpan(text, p).start ? rowUnit(text, p) : { kind: 'hidden', reason: 'layout', start: p.start, end: p.end });
      else for (const q of prosePieces(text, p, risk)) units.push(...proseUnits(text, q, risk));
    }
    if (contentEnd < line.end) units.push({ kind: 'hidden', reason: 'layout', start: contentEnd, end: line.end });
  }
  return units;
}

/** Group units into blocks: consecutive list items, and consecutive table rows, with only layout between. */
export function layoutBlocks(text: string, start: number, end: number, opts: LayoutOptions = {}): Block[] {
  const units = layoutUnits(text, start, end, opts);
  const blocks: Block[] = [];
  let i = 0;
  while (i < units.length) {
    const u = units[i]!;
    if (u.kind === 'item' || u.kind === 'row') {
      const kind = u.kind;
      let j = i + 1;
      let last = i;
      while (j < units.length) {
        const v = units[j]!;
        if (v.kind === kind) last = j;
        else if (!(v.kind === 'hidden' && v.reason === 'layout')) break;
        j++;
      }
      const group = units.slice(i, last + 1);
      blocks.push({ kind: kind === 'item' ? 'list' : 'table', start: u.start, end: units[last]!.end, units: group });
      i = last + 1;
      continue;
    }
    if (u.kind === 'heading') blocks.push({ kind: 'heading', level: u.level, start: u.start, end: u.end, unit: u });
    else if (u.kind === 'paragraph') blocks.push({ kind: 'paragraph', start: u.start, end: u.end, unit: u });
    else if (u.kind === 'hidden') blocks.push({ kind: 'hidden', start: u.start, end: u.end, unit: u });
    i++;
  }
  return blocks;
}

/** A unit's runs: its whole range, split into shown and hidden parts. */
export function unitRuns(u: Unit): Run[] {
  if (u.kind === 'hidden') return [{ start: u.start, end: u.end, hidden: u.reason }];
  const shown = u.kind === 'row' ? u.cells : [u.text];
  const runs: Run[] = [];
  let at = u.start;
  for (const s of shown) {
    if (s.start > at) runs.push({ start: at, end: s.start, hidden: 'layout' });
    runs.push({ start: s.start, end: s.end });
    at = s.end;
  }
  if (at < u.end) runs.push({ start: at, end: u.end, hidden: 'layout' });
  return runs;
}

export function blockUnits(b: Block): Unit[] {
  return b.kind === 'list' || b.kind === 'table' ? b.units : [b.unit];
}

/** Every run of every block, in order: a partition of the laid-out range. */
export function blockRuns(blocks: readonly Block[]): Run[] {
  return blocks.flatMap((b) => blockUnits(b).flatMap(unitRuns));
}

/** The shown text of [start, end): what the readable view renders, in order. */
export function shownText(text: string, blocks: readonly Block[], range?: Span): string {
  return blockRuns(blocks)
    .filter((r) => !r.hidden)
    .map((r) => {
      const a = range ? Math.max(r.start, range.start) : r.start;
      const b = range ? Math.min(r.end, range.end) : r.end;
      return b > a ? text.slice(a, b) : '';
    })
    .join('');
}

/* ------------------------------------------------------------------ tables */

type RowUnit = Extract<Unit, { kind: 'row' }>;

/** A cell as displayed: one or more source cells (a lone "$" joins the amount after it, a lone "%" the one before). */
export interface GridCell {
  spans: Span[];
  /** Raw `|` index of the cell holding the value (not of a joined "$" or "%"). */
  raw: number;
  /**
   * Display column (≥ 1; 0 is the label). Body rows: `raw`, less the lone currency cells before it
   * (after the label cell) when the table is read that way (`currencyCells`).
   */
  col: number;
}
export interface GridRow {
  unit: RowUnit;
  /** Raw cell 0, the row label (empty when the row opens with a pipe). */
  label: GridCell | null;
  cells: GridCell[];
}
export interface TableGrid {
  head: GridRow[];
  body: GridRow[];
  /** The display columns in order (columns empty in every row are dropped). */
  columns: number[];
  /**
   * How lone currency cells are read. Flattened filings disagree: in some a "$" is its own column, and
   * rows without one keep an empty cell there (TSLA "Cash |  | $ | 16,253" over "Inventory |  |  | 12,839");
   * in others rows without a "$" simply have one cell fewer (AAPL "Americas | $ | 178,353" over
   * "Europe | 111,032"). `column`: a "$" cell is a column; `none`: it is not. Each table takes the
   * reading that puts its values in the fewest distinct columns (ties: `column`, the raw index).
   */
  currencyCells: 'column' | 'none';
}

const CURRENCY = /^[$€£]$/;
/** Joins the cell before it: a percent sign, a closing parenthesis, a footnote letter ("(g)"). */
const ATTACH_PREVIOUS = /^(?:%|\)|%\)|\([a-z]{1,2}\))$/;
export const NUMERIC_CELL = /^[\s$€£(−-]*[\d.,]+[\s%)]*$|^[—–-]$/;
const YEAR = /^(?:FY\s?)?(?:19|20)\d{2}$/;

/** A row's displayed cells, with columns under one currency reading (label excluded). */
function rowCells(text: string, u: RowUnit, currency: 'column' | 'none'): { label: GridCell | null; cells: GridCell[] } {
  let label: GridCell | null = null;
  const cells: GridCell[] = [];
  let pending: { span: Span; raw: number } | null = null;
  let lone = 0;
  for (let i = 0; i < u.cells.length; i++) {
    const span = u.cells[i]!;
    const raw = u.cols[i]!;
    const t = text.slice(span.start, span.end);
    if (raw === 0 && !CURRENCY.test(t)) {
      label = { spans: [span], raw, col: 0 };
    } else if (CURRENCY.test(t)) {
      pending = { span, raw };
      // A "$" in the label cell ("$ | 4,263 | …", a row with no label) never moves a value into the label column.
      if (raw > 0) lone++;
    } else if (ATTACH_PREVIOUS.test(t) && cells.length && !pending) {
      cells.at(-1)!.spans.push(span);
    } else {
      cells.push({ spans: pending ? [pending.span, span] : [span], raw, col: currency === 'none' ? raw - lone : raw });
      pending = null;
    }
  }
  // A trailing "$" with nothing after it stays where it is.
  if (pending) cells.push({ spans: [pending.span], raw: pending.raw, col: currency === 'none' ? pending.raw - lone + 1 : pending.raw });
  return { label, cells };
}

const groupText = (text: string, c: GridCell) => c.spans.map((s) => text.slice(s.start, s.end)).join('');

/**
 * The grid of a table block (DD-21 e): every body value sits in the column of its raw `|` index (under
 * the table's currency reading), so a row with empty cells never shifts its values ("345 |  |  | 58" stays
 * under 2025 and 2024). Leading rows with no figures (years aside) are the header; when a header row has
 * exactly as many labels as the body has value columns, its labels go over those columns in order (a
 * header row is flattened without the "$" and spacer cells of the rows below it).
 */
export function tableGrid(text: string, block: Extract<Block, { kind: 'table' }>): TableGrid {
  const units = block.units.filter((u): u is RowUnit => u.kind === 'row');
  const read = (currency: 'column' | 'none') => units.map((u) => ({ unit: u, ...rowCells(text, u, currency) }));
  const distinct = (rows: GridRow[]) => new Set(rows.flatMap((r) => r.cells.map((c) => c.col))).size;
  const asColumn = read('column');
  const asNone = read('none');
  const currencyCells = distinct(asNone) < distinct(asColumn) ? 'none' : 'column';
  const rows = currencyCells === 'none' ? asNone : asColumn;
  // Header: leading rows (at most 3) before the first row with a figure, ending at the last one with a label above the values.
  const isFigure = (c: GridCell) => NUMERIC_CELL.test(groupText(text, c)) && !YEAR.test(groupText(text, c).trim());
  const firstFigure = rows.findIndex((r) => r.cells.some(isFigure));
  let headCount = 0;
  if (firstFigure > 0) {
    for (let i = 0; i < Math.min(firstFigure, 3); i++) {
      const r = rows[i]!;
      if (r.cells.some((c) => groupText(text, c).length > 40)) break;
      if (r.cells.length) headCount = i + 1;
    }
  }
  const head = rows.slice(0, headCount);
  const body = rows.slice(headCount);
  const valueCols = [...new Set(body.flatMap((r) => r.cells.map((c) => c.col)))].sort((a, b) => a - b);
  for (const r of head) if (r.cells.length === valueCols.length) r.cells.forEach((c, i) => (c.col = valueCols[i]!));
  const columns = [...new Set(rows.flatMap((r) => r.cells.map((c) => c.col)))].sort((a, b) => a - b);
  return { head, body, columns, currencyCells };
}

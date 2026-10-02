/**
 * Paragraph and sentence segmentation for flattened filing text (SPEC §25.1; assumptions B6).
 *
 * The corpus is HTML flattened to text: a "line" can be 287,855 characters, and paragraphs
 * are usually glued together with no whitespace ("…stock price.The Company has…"). So lines
 * are not paragraphs. Boundaries used here, all as character offsets:
 * - a line break;
 * - a glued paragraph break: sentence-ending punctuation immediately followed by a capital,
 *   an opening quote or a bullet, with no space between;
 * - a sentence break: sentence-ending punctuation, whitespace, then a capital.
 * Every function returns spans that partition the input range exactly, so a chunk built from
 * consecutive spans is always a verbatim slice of the filing.
 */

export interface Span {
  start: number;
  end: number;
}

/**
 * A line made of `|` cells: a flattened table row. A long prose line that merely contains a
 * page footer ("Apple Inc. | 2025 Form 10-K | 5") is not one, so pipes must be dense.
 */
export function isTableRow(line: string): boolean {
  const pipes = line.match(/\|/g)?.length ?? 0;
  if (pipes === 0) return false;
  if (line.length <= 1_500) return pipes >= 2 || /^\s*\|/.test(line);
  return pipes / line.length >= 0.01;
}

const ABBREVIATIONS = /(?:\b(?:U\.S|U\.K|U|Inc|Corp|Co|Ltd|No|Nos|Mr|Mrs|Ms|Dr|St|vs|e\.g|i\.e|etc|approx|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Fig|Vol|Rev|L\.P|N\.A|S\.A|p\.m|a\.m)|(?:^|\s)[A-Z])\.$/;

/** Offsets just after a glued paragraph break: `.`/`?`/`!`/`:` (+ closing quote) then a capital. */
const GLUED = /[.!?:;][”"’)]?(?=[A-Z“"•▪●◦(])/g;
/** Offsets just after a sentence break: punctuation (+ closing quote) and whitespace, before a capital. */
const SENTENCE = /[.!?][”"’)]?\s+(?=[A-Z“"(•▪●])/g;

/** An abbreviation followed by one of these words still ends a sentence ("…outside of the U.S.A significant…"). */
const SENTENCE_START = /^(?:A|An|The|In|On|Our|We|As|At|For|This|These|Its)\s+[a-z]/;

/** Cut offsets after each match (punctuation, closing quote and any whitespace), skipping abbreviations. */
function boundaries(text: string, start: number, end: number, re: RegExp): number[] {
  const out: number[] = [];
  const slice = text.slice(start, end);
  for (const m of slice.matchAll(re)) {
    const cut = m.index + m[0].length;
    if (ABBREVIATIONS.test(slice.slice(Math.max(0, m.index - 12), m.index + 1)) && !SENTENCE_START.test(slice.slice(cut, cut + 24))) {
      continue;
    }
    out.push(start + cut);
  }
  return out;
}

function toSpans(start: number, end: number, cuts: number[]): Span[] {
  const sorted = [...new Set(cuts.filter((c) => c > start && c < end))].sort((a, b) => a - b);
  const spans: Span[] = [];
  let s = start;
  for (const c of sorted) {
    spans.push({ start: s, end: c });
    s = c;
  }
  spans.push({ start: s, end });
  return spans;
}

/** Line spans (each includes its trailing newline) over [start, end). */
export function lineSpans(text: string, start: number, end: number): Span[] {
  const cuts: number[] = [];
  for (let i = text.indexOf('\n', start); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) cuts.push(i + 1);
  return toSpans(start, end, cuts);
}

/** Paragraph spans: line breaks plus glued paragraph breaks. Table rows are never split. */
export function paragraphSpans(text: string, start: number, end: number): Span[] {
  const out: Span[] = [];
  for (const line of lineSpans(text, start, end)) {
    if (isTableRow(text.slice(line.start, line.end))) {
      out.push(line);
      continue;
    }
    out.push(...toSpans(line.start, line.end, boundaries(text, line.start, line.end, GLUED)));
  }
  return out;
}

/** Sentence spans inside one paragraph span. */
export function sentenceSpans(text: string, span: Span): Span[] {
  return toSpans(span.start, span.end, boundaries(text, span.start, span.end, SENTENCE));
}

/**
 * Split a span longer than `max` at whitespace near the limit (or hard, when a run has no
 * whitespace at all), so no unit exceeds the hard cap.
 */
export function capSpan(text: string, span: Span, max: number): Span[] {
  const out: Span[] = [];
  let s = span.start;
  while (span.end - s > max) {
    const window = text.slice(s, s + max);
    const ws = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\n'), window.lastIndexOf('|'));
    const cut = ws > max / 2 ? s + ws + 1 : s + max;
    out.push({ start: s, end: cut });
    s = cut;
  }
  out.push({ start: s, end: span.end });
  return out;
}

/**
 * A short Title Case heading glued to the text after it ("Segment Operating PerformanceThe
 * following…", "Liquidity and Capital ResourcesThe Company…"), or a whole short paragraph
 * with no closing punctuation. Used for best-effort subsection breadcrumbs.
 */
const SMALL_WORDS = new Set(['and', 'of', 'the', 'in', 'for', 'to', 'on', 'a', 'an', 'or', 'by', 'with', 'from', 'at', 'as', 'its', 'our', 'other']);
export function headingPrefix(paragraph: string): string | null {
  const trimmed = paragraph.trim();
  let candidate: string | null = null;
  const glued = /^(.{3,90}?[a-z)])(?=[A-Z][a-z])/.exec(trimmed);
  if (glued) candidate = glued[1]!;
  else if (trimmed.length >= 3 && trimmed.length <= 90 && !/[.:;,|]$/.test(trimmed)) candidate = trimmed;
  if (!candidate || /[.;:|•▪$%]|\d{3}/.test(candidate)) return null;
  const words = candidate.split(/\s+/);
  if (words.length > 10 || !/^[A-Z]/.test(candidate)) return null;
  const capitalized = words.filter((w) => /^[A-Z(&]/.test(w) || SMALL_WORDS.has(w.toLowerCase())).length;
  return capitalized === words.length ? candidate : null;
}

import { isTableRow, lineSpans, type Span } from '@diligenceiq/corpus/segments';

/*
 * Page furniture in processed filing text (DD-21 e): running footers and headers, page numbers and
 * "Table of Contents" back-links that the HTML-to-text flattening left inside the body
 * ("…stock price.Apple Inc. | 2025 Form 10-K | 21Tariffs and Other Measures…"). The readable view
 * hides them; nothing else is ever hidden except layout (pipes and whitespace).
 *
 * Two strengths of shape:
 * - strong shapes are furniture wherever they occur (a footer with "Form 10-K" and a page number,
 *   a page-number line, "22Table of Contents");
 * - weak shapes ("PART II" alone on a line, "| BUSINESS | Table of Contents", "Goldman Sachs 2024
 *   Form 10-K") are furniture only when the same line, digits masked, repeats at least
 *   MIN_REPEATS times in the filing. A single occurrence is real text (a table of contents row, a
 *   section heading) and stays.
 * Without the whole filing (a passage in the evidence drawer) only strong shapes are hidden.
 */

export const MIN_REPEATS = 3;

/** Line shape key: digits masked, whitespace collapsed ("Apple Inc. | # Form #-K | #"). */
export const furnitureKey = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();

const FORM = /Form\s*10-?[KQ]\b/i;
/** A page number at either end of a short line, alone or between pipes. */
const PAGE_AT_END = /(?:^|[|\s])\d{1,3}[\s|]*$/;
const PAGE_AT_START = /^[\s|]*\d{1,3}\s*\|/;
const PAGE_LINE = /^\s*(?:Page\s+)?\d{1,3}\s*$/i;
const TOC_LINE = /^[\s|]*(?:\d{1,3}[\s|]*)?Table\s+of\s+Contents[\s|]*(?:\d{1,3}[\s|]*)?$/i;
const NAV = /Table\s+of\s+Contents|Index\s+to\s+(?:Consolidated\s+)?Financial\s+Statements/i;
const RUNNING_HEADER = /^[\s|]*(?:PART\s+[IV]{1,3}\b[\s|,.]*)?(?:Item\s*\d{1,2}[A-C]?[\s|.,]*)*$/i;

type Strength = 'strong' | 'weak' | null;

/** Words left once the furniture phrase, page numbers and pipes are removed. */
const words = (s: string) => s.replace(/\d+/g, ' ').split(/[\s|]+/).filter(Boolean).length;
/** A table-of-contents row ("Item 16. | Form 10-K Summary | 74") is content, not furniture. */
const TOC_ROW = /^[\s|]*(?:Item|ITEM)\s*\d|Form\s*10-?[KQ]\s+(?:Summary|Cross-Reference)/i;

/** The furniture strength of a whole line (without its newline). */
export function lineShape(line: string): Strength {
  const t = line.trim();
  if (!t || t.length > 140) return null;
  if (PAGE_LINE.test(t) || TOC_LINE.test(t)) return 'strong';
  if (TOC_ROW.test(t) && !RUNNING_HEADER.test(t)) return null;
  if (FORM.test(t)) {
    // A running footer is short: the registrant, the year, the form and a page number.
    if (t.length <= 80 && words(t) <= 8 && (PAGE_AT_END.test(t) || PAGE_AT_START.test(t))) return 'strong';
    return t.length <= 100 && words(t) <= 8 ? 'weak' : null;
  }
  // A navigation link alone or beside short pipe-separated labels ("| BUSINESS | Table of Contents").
  const nav = NAV.exec(t);
  if (nav && t.length <= 100) {
    // Set off by pipes or the line ends, never glued to prose ("…Financial Statements5Table of Contents").
    const before = t.slice(0, nav.index).replace(/[\d\s]+$/, '');
    const after = t.slice(nav.index + nav[0].length).replace(/^[\d\s]+/, '');
    const apart = (before === '' || before.endsWith('|')) && (after === '' || after.startsWith('|'));
    return apart && t.replace(NAV, '|').split('|').every((part) => words(part) <= 6) ? 'weak' : null;
  }
  if (isRunningHeader(t)) return 'weak';
  return null;
}

/** "PART II", "Item 7", "PART II | Item 7 |": a running page header, or an item number in a table of contents. */
export const isRunningHeader = (t: string) => t.length <= 40 && /[A-Za-z]/.test(t) && RUNNING_HEADER.test(t);

/** A table-of-contents row: a pipe row ending in a page number, "N/A" or "Page" ("Business | 1", "PART I | Page"). */
const TOC_PAGE_ROW = /\|\s*(?:\d{1,3}|N\/A|Page(?:\s+No\.?)?)\s*$/i;

/**
 * Whether the line [start, end) sits in a table of contents: the previous non-empty line or one of
 * the next three ends in a page number cell. A table of contents puts an item number on its own line
 * ("Item 1 |" then "Business | 1"), which looks like a running header but is content (M1).
 */
function besideTocRow(text: string, start: number, end: number): boolean {
  const tail = (a: number, b: number) => text.slice(Math.max(a, b - 60), b).trim();
  let a = start - 1;
  // The previous non-empty line.
  while (a > 0) {
    const from = text.lastIndexOf('\n', a - 1) + 1;
    const line = tail(from, a);
    if (line) {
      if (TOC_PAGE_ROW.test(line)) return true;
      break;
    }
    a = from - 1;
  }
  // The next three non-empty lines.
  let b = text[end] === '\n' ? end + 1 : end;
  for (let seen = 0; seen < 3 && b < text.length; ) {
    const nl = text.indexOf('\n', b);
    const to = nl === -1 ? text.length : nl;
    const line = tail(b, to);
    if (line) {
      if (TOC_PAGE_ROW.test(line)) return true;
      seen++;
    }
    b = to + 1;
  }
  return false;
}

/** Text a glued run of furniture may follow: a sentence end, a closing quote or bracket, or a line start. */
const AFTER = '(?<=^|[.!?:;”"’)\\]])';
/** …and what may follow it: a capital, an opening quote or bracket, a bullet, or the line end. */
const BEFORE = '(?=\\s*(?:[A-Z“"(•▪●◦]|$))';
/**
 * The tail of a running footer glued anywhere inside prose: "| 2025 Form 10-K | 21" in
 * "…impact.Apple Inc. | 2025 Form 10-K | 21Tariffs…", "…Mac miniApple Inc. | …" or
 * "…| Q2 2022 Form 10-Q | 15iPadiPad net sales…" (whatever follows the page number). The registrant
 * before it is found by walking back (`registrantStart`), never by a backtracking regex: lines reach
 * 287,855 characters.
 */
const INLINE_FOOTER_TAIL = new RegExp(`\\|\\s*(?:[\\w’'.,-]+\\s+){0,4}?Form\\s*10-?[KQ]\\s*\\|\\s*\\d{1,3}(?![\\d.,-])`, 'g');
/** Registrant words: capitalized tokens ("Apple Inc.", "JPMorgan Chase & Co.", "TARGET CORPORATION"). */
const REGISTRANT = /(?:[A-Z][\w&’'.,/-]*\s*){1,8}$/;

/** Where the registrant name before a footer tail starts (`tail`: offset of its first pipe), or -1. */
function registrantStart(line: string, tail: number): number {
  const window = line.slice(Math.max(0, tail - 90), tail);
  const m = REGISTRANT.exec(window);
  if (!m) return -1;
  // Never run back through a glued sentence or heading ("…SecuritiesNone.Apple Inc. | …").
  let cut = 0;
  for (const g of m[0].matchAll(GLUE)) cut = g.index + g[0].length;
  return tail - window.length + m.index + cut;
}

/** "Table of Contents" in its printed variants; JNJ prints "Table of Content" ("…fair 10Table of Contentvalues…", "…ContentSelling…"). */
const TOC_PHRASE = '(?:Table\\s+of\\s+Contents?|TABLE\\s+OF\\s+CONTENTS|Table\\s+of\\s+contents)';
/**
 * A page number glued to a "Table of Contents" back-link is a page break wherever it falls, whatever
 * follows: "…sell our products.22Table of ContentsWe acquire…", "…for a variety of 6Table of
 * Contentsreasons…", "…approximately 41Table of Contents$480 million…" (strong).
 */
const INLINE_TOC_PAGE = new RegExp(`(?<!\\d|\\d[.,])\\d{1,3}\\s*${TOC_PHRASE}`, 'g');
/**
 * The same back-link glued straight after five or more digits, a year and a page number ("…inflation in
 * 202355Table of Contents"): which digits are the page number is unknowable, so only the phrase is
 * hidden and every digit stays (strong). A cover's "…2022TABLE OF CONTENTS" heading (four digits) stays.
 */
const INLINE_TOC_AFTER_DIGITS = new RegExp(`(?<=\\d{5})${TOC_PHRASE}`, 'g');
/** A back-link opening a line, glued to the text after it (the page number ends the line before). */
const LINE_START_TOC = new RegExp(`^\\s*(${TOC_PHRASE})(?=\\s*\\S)`);
/** The back-link alone between sentences, without a page number (weak: hidden only when it repeats). */
const INLINE_TOC = new RegExp(`${AFTER}\\s*${TOC_PHRASE}${BEFORE}`, 'g');
/**
 * A footer without pipes: "MASTERCARD 2025 FORM 10-K     95PART II…", or with no registrant at all,
 * "…the consumer experience.2025 FORM 10-K   1 Table of Contents…" (NKE). The registrant, when there is
 * one, is upper-case words (never "…Subpart F of the Internal 2025 FORM 10-K…"); the page number must
 * not run on into more digits.
 */
const INLINE_BARE_FOOTER = new RegExp(`(?<=^|[.!?:;”"’)\\]%]|\\s)(?:[A-Z][A-Z&’'.,-]*\\s+){0,6}\\d{4}\\s+(?:Form|FORM)\\s*10-?[KQ]\\s+\\d{1,3}(?![\\d.,])`, 'g');
/** A glued sentence end or heading inside a would-be registrant name: "None.Apple", "SecuritiesNone". */
const GLUE = /[.!?:;”"’)\]]\s*(?=[A-Z])|[a-z]{2}(?=[A-Z][a-z]{2})/g;
/** A page number glued before a part heading: "…other companies.4Part IItem 1.Business…". */
const INLINE_PAGE_BEFORE_PART = /(?<=[.!?”"’)])\d{1,3}(?=PART\s+I|Part\s+I)/g;

/** How often each weak furniture shape occurs in a whole filing (the repetition test). */
export function furnitureCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const l of lineSpans(text, 0, text.length)) {
    const line = text.slice(l.start, l.end).replace(/\n$/, '');
    if (lineShape(line) === 'weak') add(furnitureKey(line));
    for (const m of line.matchAll(INLINE_TOC)) add(furnitureKey(m[0]));
  }
  return counts;
}

/**
 * Furniture ranges inside [start, end), sorted and disjoint. Line ranges exclude the newline (it is
 * layout). `counts` (from `furnitureCounts` over the whole filing) enables the weak shapes.
 */
export function findFurniture(text: string, start: number, end: number, counts?: ReadonlyMap<string, number>): Span[] {
  const out: Span[] = [];
  const repeated = (s: string) => (counts?.get(furnitureKey(s)) ?? 0) >= MIN_REPEATS;
  for (const l of lineSpans(text, start, end)) {
    const lineEnd = text[l.end - 1] === '\n' ? l.end - 1 : l.end;
    const line = text.slice(l.start, lineEnd);
    let shape = lineShape(line);
    // An item number in a table of contents ("Item 1 |" above "Business | 1") is content, not a running header.
    if (shape === 'weak' && isRunningHeader(line.trim()) && besideTocRow(text, l.start, lineEnd)) shape = null;
    if (shape === 'strong' || (shape === 'weak' && repeated(line))) {
      if (lineEnd > l.start) out.push({ start: l.start, end: lineEnd });
      continue;
    }
    const inline: Span[] = [];
    const push = (m: RegExpMatchArray, registrant = false) => {
      // Leading whitespace stays with the text before it (layout), so the range starts at the furniture.
      let lead = m[0].length - m[0].trimStart().length;
      // A registrant name never runs through a glued sentence or heading ("…SecuritiesNone.Apple Inc. | …"):
      // start after the last glue.
      if (registrant) {
        const head = m[0].slice(0, m[0].search(/\||\d{4}/));
        let cut = -1;
        for (const g of head.matchAll(GLUE)) cut = g.index + g[0].length;
        if (cut > lead) lead = cut;
      }
      inline.push({ start: l.start + m.index! + lead, end: l.start + m.index! + m[0].length });
    };
    for (const m of line.matchAll(INLINE_FOOTER_TAIL)) {
      const from = registrantStart(line, m.index);
      if (from >= 0) inline.push({ start: l.start + from, end: l.start + m.index + m[0].length });
    }
    for (const m of line.matchAll(INLINE_BARE_FOOTER)) push(m, true);
    for (const m of line.matchAll(INLINE_TOC_PAGE)) push(m);
    for (const m of line.matchAll(INLINE_TOC_AFTER_DIGITS)) push(m);
    for (const m of line.matchAll(INLINE_TOC)) if (repeated(m[0])) push(m);
    for (const m of line.matchAll(INLINE_PAGE_BEFORE_PART)) push(m);
    // A page break split by a line break: "…farm and jobsite 3" then "Table of Contentsinformation…".
    // The back-link is hidden (strong), and so is the page number ending the previous prose line.
    const lead = LINE_START_TOC.exec(line);
    if (lead) {
      const at = l.start + lead[0].length - lead[1]!.length;
      inline.push({ start: at, end: at + lead[1]!.length });
      const prevEnd = l.start - 1;
      const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1;
      // Never a reference number ("Note 12", "Rule 12b-2", "Item 7"): only digits after a space or a sentence end.
      const before = text.slice(Math.max(prevStart, prevEnd - 24), prevEnd);
      const page = prevEnd > start && !/(?:Note|Rule|Item|Section|Part|Article|Schedule|Exhibit)\s*\d{1,3}$/i.test(before) ? /(?<=[\s.!?”"’)])\d{1,3}$/.exec(before) : null;
      const pageStart = page ? prevEnd - page[0].length : -1;
      if (page && pageStart >= start && !isTableRow(text.slice(prevStart, prevEnd)) && (out.at(-1)?.end ?? -1) <= pageStart) out.push({ start: pageStart, end: prevEnd });
    }
    out.push(...disjoint(inline));
  }
  return out;
}

function disjoint(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out.at(-1);
    if (last && s.start < last.end) last.end = Math.max(last.end, s.end);
    else if (s.end > s.start) out.push({ ...s });
  }
  return out;
}

/**
 * A hidden furniture run must look like furniture (checked by the corpus-backed test): a footer or
 * back-link phrase, a page number, or a bare running header ("PART II", "Item 7", "PART II | Item 7")
 * with nothing else on it. Runs are also at most FURNITURE_MAX characters.
 */
export const FURNITURE_TEXT =
  /Form\s*10-?[KQ]|Table\s+of\s+Contents?|Index\s+to\s+(?:Consolidated\s+)?Financial\s+Statements|^\s*(?:Page\s+)?\d{1,3}\s*$|^[\s|]*(?:PART\s+[IV]{1,3}\b[\s|,.]*(?:Item\s*\d{1,2}[A-C]?[\s|.,]*)?|Item\s*\d{1,2}[A-C]?[\s|.,]*)$/i;
export const FURNITURE_MAX = 140;

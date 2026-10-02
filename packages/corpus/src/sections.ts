import type { FilingType } from './header';

/**
 * Section detection by character offset (SPEC §24.2 step 5, §25.1; architecture §6.1 step 5;
 * assumptions B8 and Known corpus anomalies).
 *
 * Headings are classified by their TITLE, not their item number, because the numbers mean
 * different things in a 10-K and a 10-Q (10-K Item 2 = Properties; 10-Q Part I Item 2 = MD&A).
 *
 * Rules:
 * - Table-of-contents occurrences are skipped (a short line of `|` cells, or a heading that is
 *   followed by another heading almost immediately).
 * - Cross-references are never anchors: "discussed under Item 1A. Risk Factors of
 *   ExxonMobil's 2023 Form 10-K", "Refer to “Item 1A. Risk Factors”", "Part II, Item 7, …".
 *   JNJ and XOM 10-Qs therefore get NO Risk Factors section rather than a false one.
 * - Filings whose body headings carry no "Item" (MS 10-K: TOC `Risk Factors |  | 1A`; AXP and T:
 *   `1A. | Risk Factors`) are found by the bare title heading, glued to its first sentence.
 * - Text before the first detected heading, and inside headings we do not model, is `other`.
 */

export const SECTION_KINDS = [
  'business',
  'risk_factors',
  'cybersecurity',
  'properties',
  'legal',
  'mda',
  'market_risk',
  'financial_statements',
  'controls',
  'other',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

/** Short code used in chunk IDs (`AAPL-FY2025-10K-1A-004`, `NVDA-FY2026Q3-10Q-MDA-012`). */
export const SECTION_CODES: Record<SectionKind, string> = {
  business: 'BUS',
  risk_factors: '1A',
  cybersecurity: '1C',
  properties: 'PROP',
  legal: 'LEGAL',
  mda: 'MDA',
  market_risk: 'MKT',
  financial_statements: 'FS',
  controls: 'CTRL',
  other: 'OTH',
};

/** Display labels: the 10-K item name, with the 10-Q part and item where they differ. */
export function sectionLabel(kind: SectionKind, filingType: FilingType): string {
  const tenQ = filingType === '10-Q';
  switch (kind) {
    case 'business':
      return 'Item 1 — Business';
    case 'risk_factors':
      return tenQ ? 'Part II, Item 1A — Risk Factors' : 'Item 1A — Risk Factors';
    case 'cybersecurity':
      return 'Item 1C — Cybersecurity';
    case 'properties':
      return 'Item 2 — Properties';
    case 'legal':
      return tenQ ? 'Part II, Item 1 — Legal Proceedings' : 'Item 3 — Legal Proceedings';
    case 'mda':
      return tenQ
        ? 'Part I, Item 2 — Management’s Discussion and Analysis'
        : 'Item 7 — Management’s Discussion and Analysis';
    case 'market_risk':
      return tenQ ? 'Part I, Item 3 — Market Risk' : 'Item 7A — Market Risk';
    case 'financial_statements':
      return tenQ ? 'Part I, Item 1 — Financial Statements' : 'Item 8 — Financial Statements';
    case 'controls':
      return tenQ ? 'Part I, Item 4 — Controls and Procedures' : 'Item 9A — Controls and Procedures';
    case 'other':
      return 'Other';
  }
}

export interface Section {
  kind: SectionKind;
  code: string;
  label: string;
  /** Offsets into the processed text; `end` is exclusive. */
  start: number;
  end: number;
  /** How the heading was found: an `Item N.` heading or the bare title. */
  anchor: 'item' | 'title' | 'none';
}

const Q = `["“”'‘’]`;
/** Titles in the order they are tried; the first that matches the text after the item number wins. */
const TITLES: ReadonlyArray<[SectionKind | 'boundary', RegExp]> = [
  ['risk_factors', /^Risk\s*Factors/i],
  ['cybersecurity', /^Cybersecurity/i],
  ['business', /^(?:Business|BUSINESS)(?![a-z])/],
  ['properties', /^Properties/i],
  ['legal', /^Legal\s*Proceedings/i],
  ['mda', /^Management[’'`]?s\s*Discussion\s*and\s*Analysis/i],
  ['market_risk', /^Quantitative\s*and\s*Qualitative\s*Disclosures?/i],
  // Also with the registrant's name in front: "Item 8: Comcast Corporation Financial Statements…".
  ['financial_statements', /^(?:[A-Z][\w.&’'-]*\s+){0,3}?(?:Consolidated\s*)?Financial\s*Statements/i],
  ['controls', /^Controls\s*and\s*Procedures/i],
  // Every other standard item still ends the section before it. An explicit list, so a running
  // page header ("PART I Item 1A" followed by body text) never cuts a section short.
  [
    'boundary',
    /^(?:\[?Reserved\]?|Unresolved\s*Staff|Mine\s*Safety|Market\s*for|Selected\s*Financial|Changes\s*in\s*and\s*Disagreements|Other\s*Information|Disclosure\s*Regarding\s*Foreign|Directors|Executive\s*Compensation|Security\s*Ownership|Certain\s*Relationships|Principal\s*Account|Exhibits?|Form\s*10-K\s*Summary|Defaults\s*Upon|Unregistered\s*Sales|Submission\s*of\s*Matters|Insider\s*Trading|Signatures?)/i,
  ],
];

const ITEM = /Item\s*(\d{1,2}[A-C]?)\s*[.:\-–—]?\s*(?:\|\s*)?/gi;
/**
 * Context that makes a following "Item N" or title a reference rather than a heading:
 * "under", "see", "Part II, ", an OPENING quote right before it ("Refer to “Item 1A…"), a colon
 * or semicolon ("…operating results under: Item 7.", JNJ), or a lowercase word and a space
 * ("…as well as our discussion in Item 7", ORCL). A heading follows a line break, page
 * furniture, a sentence end or a glued title. A closing quote at the end of the previous
 * sentence (`.”\nItem 1A.`) is not a reference.
 */
const XREF_BEFORE = new RegExp(
  String.raw`(?:\b(?:under|in|see|of|to|and|or|with|within|our|this|the|Part\s+I{1,2}\s*,)\s*[“‘"]?[ \t]*$|[“‘"][ \t]?$|[,:;]\s*$)`,
  'i',
);
/** A lowercase word and a space right before (case-sensitive: "28Table of Contents ITEM 7." is a heading). */
const LOWER_WORD_BEFORE = /(?<![A-Za-z])[a-z]{2,}[ \t]+$/;
/** A title wrapped in quotes or followed by "of our"/"in our" is a reference. */
const XREF_AFTER = new RegExp(String.raw`^\s*${Q}|^\s*[,;]|^\s+(?:of|in)\s+(?:our|the|this|its)\b`, 'i');
/** The rest of a standard item title ("…of Financial Condition and Results of Operations"). */
const TITLE_TAIL =
  /^(?:[ \t]*(?:of|and|on|about|for)?[ \t]*(?:the[ \t]+)?(?:financial[ \t]*condition|results[ \t]*of[ \t]*operations|market[ \t]*risks?|supplementa(?:ry|l)[ \t]*(?:data|details)|disclosures?[ \t]*about[ \t]*market[ \t]*risk|data)\b)*/i;
/**
 * What follows a full title in a cross-reference: "…financial condition of this Report; and
 * Note 17" (JNJ), "…Results of Operations and Note 13 of Notes…, both included elsewhere" (ORCL).
 */
const XREF_TAIL =
  /^(?:[ \t]*[,;]|[ \t]+(?:of|in)[ \t]+(?:this|our|the|its)\b|[ \t]+(?:and|or)[ \t]+(?:in[ \t]+)?(?:Note|Item|Part)\b|[ \t]+(?:both|included|contained|set[ \t]+forth|which)\b)/;

/** A table row that ends in a page number or page range ("| 62", "| Pages37-51", "| F-2"). */
const PAGE_CELL = /\|\s*(?:Pages?\s*)?(?:F-)?\d{1,3}(?:\s*[-–,]\s*(?:F-)?\d{1,3})*\s*\|?\s*$/i;

/**
 * A TOC row: the heading sits on a line of `|` cells that ends with a page number, or whose
 * next line is another `|` row. A body heading laid out as a row ("Item 1A. | Risk Factors")
 * is followed by a line of prose instead.
 */
function isTocLine(text: string, index: number): boolean {
  const ls = text.lastIndexOf('\n', index) + 1;
  const le = text.indexOf('\n', index);
  const line = text.slice(ls, le === -1 ? text.length : le);
  if (!line.includes('|') || line.length >= 400) return false;
  if (/\|\s*(?:Pages?\s*)?(?:\d{1,3}(?:\s*[-–,]\s*\d{1,3})*|[ivxlc]{1,6})\s*\|?\s*$/i.test(line)) return true;
  if (le === -1) return false;
  const ne = text.indexOf('\n', le + 1);
  const next = text.slice(le + 1, ne === -1 ? text.length : ne);
  return next.includes('|') || next.trim() === '';
}

/**
 * A TOC entry whose title wraps onto the following lines before its page number (GS:
 * "Item 7 |\nManagement’s Discussion and Analysis of Financial Condition\nand Results of
 * Operations | 62"). The page-number line must carry title text before its single cell.
 */
function titleRunsToPageNumber(text: string, index: number): boolean {
  const lines = text.slice(index, index + 300).split('\n').slice(0, 3);
  // The item line itself is only "Item 7 |": its title wraps onto the next lines.
  if (!/^Item\s*\d{1,2}[A-C]?\s*[.:]?\s*\|\s*$/i.test(lines[0] ?? '')) return false;
  return lines.slice(1).some((l) => l.length < 200 && /[A-Za-z][^|\n]{2,}\|\s*(?:Pages?\s*)?\d{1,3}\s*$/.test(l));
}

/** Raw `Item N` matches within this distance of each other count towards a TOC cluster. */
const TOC_WINDOW = 1_500;
const TOC_MIN_ITEMS = 4;

/**
 * Offsets of `Item N` matches that belong to a table of contents: a TOC row, a title that runs
 * to a page number, or a match inside a dense TOC cluster: at least four matches within
 * ~3,000 characters, at least half of them TOC-shaped, with a TOC-shaped match on both sides.
 * The first body heading right after a TOC has TOC rows on one side only, and stub items
 * (IBM's "Refer to pages 6 through 42…") are dense but not TOC-shaped, so both survive.
 */
function tocItems(text: string): Set<number> {
  const all = [...text.matchAll(ITEM)].map((m) => ({ at: m.index, toc: isTocLine(text, m.index) || titleRunsToPageNumber(text, m.index) }));
  const out = new Set<number>();
  for (const a of all) {
    if (a.toc) {
      out.add(a.at);
      continue;
    }
    const near = all.filter((b) => Math.abs(b.at - a.at) <= TOC_WINDOW);
    const sandwiched = near.some((b) => b.toc && b.at < a.at) && near.some((b) => b.toc && b.at > a.at);
    if (sandwiched && near.length >= TOC_MIN_ITEMS && near.filter((b) => b.toc).length * 2 >= near.length) out.add(a.at);
  }
  return out;
}

interface Candidate {
  kind: SectionKind | 'boundary';
  start: number;
  titleEnd: number;
  anchor: 'item' | 'title';
}

function classifyTitle(after: string): { kind: SectionKind | 'boundary'; length: number } | null {
  for (const [kind, re] of TITLES) {
    const m = re.exec(after);
    if (m) return { kind, length: m[0].length };
  }
  return null;
}

function itemCandidates(text: string): Candidate[] {
  const out: Candidate[] = [];
  const toc = tocItems(text);
  for (const m of text.matchAll(ITEM)) {
    const index = m.index;
    if (toc.has(index)) continue;
    const before = text.slice(Math.max(0, index - 40), index);
    if (XREF_BEFORE.test(before) || LOWER_WORD_BEFORE.test(before)) continue;
    const after = text.slice(index + m[0].length, index + m[0].length + 240);
    const title = classifyTitle(after);
    if (!title) continue;
    const rest = after.slice(title.length);
    if (title.kind !== 'boundary') {
      if (XREF_AFTER.test(rest)) continue;
      const tail = rest.slice(TITLE_TAIL.exec(rest)![0].length);
      if (XREF_TAIL.test(tail)) continue;
    }
    if (title.kind === 'boundary' && XREF_AFTER.test(after)) continue;
    out.push({ kind: title.kind, start: index, titleEnd: index + m[0].length + title.length, anchor: 'item' });
  }
  return out;
}

/**
 * Bare title headings, for filings that put a section under its title rather than an
 * `Item N.` heading (MS 10-K; integrated-report 10-Ks such as XOM, BAC, INTC, MCD, whose
 * Item 7 is a one-line "Reference is made to…" stub). The title must be glued to its first
 * sentence ("Risk FactorsThe following…") or end its line, be Title Case or UPPER CASE (never
 * "risk factors" mid-sentence), and must not sit in a TOC row or follow a reference word.
 * JPM's sentence-case running title ("Management’s discussion and analysisThe following…") is
 * accepted only at the start of a line.
 */
const END = String.raw`(?=[A-Z(]|[ \t]*\||[ \t]*\n)`;
const BARE_TITLES: ReadonlyArray<[SectionKind, RegExp, { lineStart: boolean }]> = [
  ['risk_factors', new RegExp(String.raw`(?:Risk\s*Factors|RISK\s*FACTORS)${END}`, 'g'), { lineStart: false }],
  [
    'mda',
    new RegExp(
      String.raw`(?:Management[’']s\s*Discussion\s*and\s*Analysis(?:\s*of\s*Financial\s*Condition\s*and\s*Results\s*of\s*Operations)?|MANAGEMENT[’']S\s*DISCUSSION\s*AND\s*ANALYSIS(?:\s*OF\s*FINANCIAL\s*CONDITION\s*AND\s*RESULTS\s*OF\s*OPERATIONS)?)${END}`,
      'g',
    ),
    { lineStart: false },
  ],
  ['mda', new RegExp(String.raw`Management[’']s\s+discussion\s+and\s+analysis${END}`, 'g'), { lineStart: true }],
  // JPM 10-Qs: "INTRODUCTION\nThe following is Management’s discussion and analysis…", no MD&A heading.
  ['mda', /INTRODUCTION\s*\n(?=The following is Management[’']s discussion and analysis)/g, { lineStart: true }],
];

function bareCandidates(text: string, kind: SectionKind): Candidate[] {
  const out: Candidate[] = [];
  for (const [k, re, { lineStart }] of BARE_TITLES) {
    if (k !== kind) continue;
    for (const m of text.matchAll(re)) {
      const index = m.index;
      if (lineStart && index > 0 && text[index - 1] !== '\n') continue;
      if (isTocLine(text, index)) continue;
      const before = text.slice(Math.max(0, index - 40), index);
      // Glued to a preceding word is a mid-sentence use, except after a "Table of Contents" page header.
      if (/[A-Za-z]$/.test(before) && !/Contents$/i.test(before)) continue;
      if (XREF_BEFORE.test(before) || /[“‘"][ \t]*$/.test(before)) continue;
      // The title of an `Item N.` heading is handled by the item scan (it may be a stub).
      if (/Item\s*\d{1,2}[A-C]?\s*[.:\-–—]?\s*\|?\s*$/i.test(before)) continue;
      out.push({ kind, start: index, titleEnd: index + m[0].length, anchor: 'title' });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Bare headings that open the financial statements when Item 8 is a stub or absent: DIS and
 * BLK ("See Index to Financial Statements…" then the statements after Part IV), NVDA (statements
 * after Item 15), the integrated-report filings (statements after the bare-title MD&A). The
 * heading must start a line or follow page furniture, and must not be a TOC row.
 */
const FS_BARE =
  /(?:(?:Consolidated\s*)?Financial\s*Statements\s*and\s*Supplementa(?:ry|l)\s*(?:Data|Details|Information)|Index\s*to\s*(?:the\s*)?(?:Consolidated\s*)?Financial\s*Statements|Report\s*of\s*Independent\s*Registered\s*Public\s*Accounting\s*Firm|Consolidated\s*Statements?\s*of\s*(?:Income|Operations|Earnings)|Statements?\s*of\s*Consolidated\s*(?:Income|Operations|Earnings))(?=[A-Z(]|[ \t]*[|(\n]|[ \t]+(?:for|To)\b)/gi;

const ICFR_REPORT = /^\s*ON\s+(?:FINANCIAL\s+STATEMENT\s+SCHEDULE|INTERNAL\s+CONTROL)|^[\s\S]{0,250}?Opinion\s+on\s+(?:the\s+Company['’]s\s+)?Internal\s+Control/i;

function fsCandidates(text: string, from: number): Candidate[] {
  const out: Candidate[] = [];
  FS_BARE.lastIndex = 0;
  for (const m of text.slice(from).matchAll(FS_BARE)) {
    const index = from + m.index;
    const before = text.slice(Math.max(0, index - 40), index);
    // A line start, or page furniture: "70TABLE OF CONTENTS", "Table of ContentsDEERE & COMPANY", "Annual Report    39".
    if (!(index === 0 || text[index - 1] === '\n' || /(?:Table\s*of\s*Contents|\b\d{1,3})\s*\|?\s*(?:[A-Z][A-Z.,&' ]{2,60}|[A-Z][\w&.,' ]{2,60}?(?:Inc\.|Co\.|Corporation|Company))?$/.test(before))) continue;
    const le = text.indexOf('\n', index);
    const line = text.slice(index, le === -1 ? text.length : le);
    if (line.length < 400 && PAGE_CELL.test(line)) continue;
    // The auditor's report on internal control (Item 9A) or on a schedule (Item 15) is not the statements.
    if (/^Report/i.test(m[0]) && ICFR_REPORT.test(text.slice(index + m[0].length, index + m[0].length + 300))) continue;
    out.push({ kind: 'financial_statements', start: index, titleEnd: index + m[0].length, anchor: 'title' });
  }
  return out;
}

/** A heading is substantive when real prose follows before the next heading. */
const MIN_SECTION_CHARS = 80;
/**
 * A section shorter than this is a stub ("Reference is made to…", "Refer to pages 6 through
 * 42 of IBM’s 2024 Annual Report…"): look for the bare title, and report it as a gap.
 */
export const STUB_SECTION_CHARS = 1_500;

/**
 * Canonical item order, as groups: a heading's group may not be lower than the previous
 * chosen heading's. 10-K items are strictly ordered. A 10-Q's Part I items come in either order
 * (BAC and JPM put MD&A before the statements), but always before Part II.
 */
const GROUPS: Record<FilingType, Partial<Record<SectionKind, number>>> = {
  '10-K': { business: 0, risk_factors: 1, cybersecurity: 2, properties: 3, legal: 4, mda: 5, market_risk: 6, financial_statements: 7, controls: 8 },
  '10-Q': { financial_statements: 0, mda: 0, market_risk: 0, controls: 0, legal: 1, risk_factors: 2 },
};

/** Drop headings immediately followed by another heading (an inline TOC). */
function substantive(candidates: readonly Candidate[]): Candidate[] {
  const all = [...candidates].sort((a, b) => a.start - b.start);
  return all.filter((c, i) => {
    const next = all[i + 1];
    return !next || next.start - c.titleEnd >= MIN_SECTION_CHARS;
  });
}

/**
 * One `Item` heading per kind, chosen so that the chosen kinds follow the canonical item order
 * (the longest such sequence; among equals, the earliest headings). A cross-reference inside
 * Item 1 ("…under: Item 7. Management’s discussion…") or a TOC entry that slipped through
 * cannot claim MD&A, because the real Risk Factors heading follows it; a repeated running page
 * header (XOM's "MANAGEMENT’S DISCUSSION AND ANALYSIS…") neither starts a section nor ends one.
 */
function orderedItems(candidates: readonly Candidate[], filingType: FilingType): Candidate[] {
  const items = candidates.filter((c): c is Candidate & { kind: SectionKind } => c.kind !== 'boundary');
  const group = items.map((c) => GROUPS[filingType][c.kind] ?? 99);
  const bit = items.map((c) => 1 << SECTION_KINDS.indexOf(c.kind));
  const memo = new Map<number, number>();
  // longest(i, used): the longest valid sequence that starts at item i, given kinds already used.
  const longest = (i: number, used: number): number => {
    const key = used * 1024 + i;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const next = used | bit[i]!;
    let best = 1;
    for (let j = i + 1; j < items.length; j++) {
      if (group[j]! >= group[i]! && !(next & bit[j]!)) best = Math.max(best, 1 + longest(j, next));
    }
    memo.set(key, best);
    return best;
  };
  const chosen: Candidate[] = [];
  let used = 0;
  let minGroup = -1;
  let need = 0;
  for (let i = 0; i < items.length; i++) need = Math.max(need, longest(i, 0));
  for (let i = 0; i < items.length && need > 0; i++) {
    if (group[i]! >= minGroup && !(used & bit[i]!) && longest(i, used) === need) {
      chosen.push(items[i]!);
      used |= bit[i]!;
      minGroup = group[i]!;
      need--;
    }
  }
  return chosen;
}

interface Start {
  kind: SectionKind;
  start: number;
  anchor: 'item' | 'title';
}

/** Section starts from chosen headings and boundaries; a repeated bare title is ignored. */
function toStarts(candidates: readonly Candidate[]): Start[] {
  const seen = new Set<SectionKind>();
  const starts: Start[] = [];
  for (const c of substantive(candidates)) {
    if (c.kind === 'boundary') {
      starts.push({ kind: 'other', start: c.start, anchor: c.anchor });
      continue;
    }
    if (seen.has(c.kind)) continue;
    seen.add(c.kind);
    starts.push({ kind: c.kind, start: c.start, anchor: c.anchor });
  }
  return starts;
}

function lengths(starts: readonly Start[], textLength: number): Map<SectionKind, { start: number; length: number }> {
  const out = new Map<SectionKind, { start: number; length: number }>();
  starts.forEach((s, i) => out.set(s.kind, { start: s.start, length: (starts[i + 1]?.start ?? textLength) - s.start }));
  return out;
}

export function detectSections(text: string, filingType: FilingType): Section[] {
  const raw = substantive(itemCandidates(text));
  let candidates: Candidate[] = [...orderedItems(raw, filingType), ...raw.filter((c) => c.kind === 'boundary')];
  const wanted: SectionKind[] = filingType === '10-K' ? ['risk_factors', 'mda', 'financial_statements'] : ['mda', 'financial_statements'];
  for (const kind of wanted) {
    const found = lengths(toStarts(candidates), text.length);
    const current = found.get(kind);
    if (current && current.length >= STUB_SECTION_CHARS) continue;
    let bare: Candidate[];
    if (kind === 'financial_statements') {
      // The statements follow MD&A and any stub Item 8.
      const from = found.get('mda')?.start ?? current?.start ?? 0;
      bare = fsCandidates(text, from);
    } else {
      bare = bareCandidates(text, kind);
    }
    // Risk Factors and MD&A: the first bare heading that is substantive among the headings
    // already chosen (later ones are running page headers). Statements: the candidate that opens
    // the longest section, so an auditor's report or index page that is cut short loses.
    const usable = bare.filter((b) => substantive([...candidates, b]).includes(b));
    const sectionLength = (b: Candidate) => (candidates.map((c) => c.start).filter((x) => x > b.start).sort((x, y) => x - y)[0] ?? text.length) - b.start;
    const pick =
      kind === 'financial_statements' ? usable.reduce<Candidate | undefined>((best, b) => (!best || sectionLength(b) > sectionLength(best) ? b : best), undefined) : usable[0];
    if (!pick) continue;
    // The stub item heading still ends the section before it, but no longer claims the kind.
    candidates = candidates.map((c) => (c.kind === kind ? { ...c, kind: 'boundary' as const } : c));
    candidates.push(pick);
  }
  const starts = toStarts(candidates);

  const sections: Section[] = [];
  const push = (kind: SectionKind, start: number, end: number, anchor: Section['anchor']) => {
    if (end <= start) return;
    const prev = sections.at(-1);
    if (prev && prev.kind === 'other' && kind === 'other') {
      prev.end = end;
      return;
    }
    sections.push({ kind, code: SECTION_CODES[kind], label: sectionLabel(kind, filingType), start, end, anchor });
  };
  push('other', 0, starts[0]?.start ?? text.length, 'none');
  starts.forEach((s, i) => push(s.kind, s.start, starts[i + 1]?.start ?? text.length, s.kind === 'other' ? 'none' : s.anchor));
  return sections;
}

export interface SectionGap {
  kind: SectionKind;
  /** `missing`: no section; `stub`: a section under STUB_SECTION_CHARS (incorporated by reference, or a heading with no body). */
  reason: 'missing' | 'stub';
  length: number;
}

/**
 * Expected sections that are missing or stubs: MD&A for every filing; Risk Factors and the
 * financial statements for a 10-K. The ingestion summary reports these per filing, so a
 * filing whose MD&A is incorporated by reference (IBM) is visible rather than silently thin.
 */
export function sectionGaps(sections: readonly Section[], filingType: FilingType): SectionGap[] {
  const expected: SectionKind[] = filingType === '10-K' ? ['risk_factors', 'mda', 'financial_statements'] : ['mda'];
  return expected.flatMap((kind): SectionGap[] => {
    const s = sections.find((x) => x.kind === kind);
    if (!s) return [{ kind, reason: 'missing', length: 0 }];
    const length = s.end - s.start;
    return length < STUB_SECTION_CHARS ? [{ kind, reason: 'stub', length }] : [];
  });
}

export function sectionAt(sections: readonly Section[], offset: number): Section {
  const s = sections.find((x) => offset >= x.start && offset < x.end);
  if (!s) throw new Error(`no section contains offset ${offset}`);
  return s;
}

import { type BriefValidation, type DiligenceBrief, DiligenceBriefSchema } from '@diligenceiq/core';
import { isTableRow } from '@diligenceiq/corpus';

/**
 * Deterministic output validation (SPEC §31; architecture §6.9). Nothing here calls a model:
 * 1. `repairBrief`: deterministic repair of the forced tool's input (a stringified field, a
 *    comma-separated ID list, a missing array, a case slip in an enum). Then a Zod parse; a
 *    brief that still fails is `MALFORMED_OUTPUT`.
 *    A comparison whose columns include the row-label header (every row one value short) loses
 *    that leading column.
 * 2. `validateBrief`: every citation ID must be a chunk supplied in the context; others are
 *    removed and listed. Items left with no valid citation are flagged, and comparison rows whose
 *    value count differs from the column count are listed.
 * 3. Numeric grounding: every currency or percentage figure must be printed in a passage its own
 *    item cites (the title, summary and evidence gaps: any passage some item cites; follow-up
 *    questions are not checked), otherwise it is "unverified". The rules are on `matchFigure`.
 *
 * What a verified figure proves: a number with these digits and this unit (percent, "$", a scale
 * word, or a table unit the passage states) is printed in a cited passage. It does not prove the
 * number means what the sentence says: a computed "about 2%" still verifies against an unrelated
 * "2%" in the same passage, and a figure from one row of a table verifies against any row. It is
 * a deterministic check against invented and converted numbers, not semantic grounding.
 */

export type RepairResult = { ok: true; brief: DiligenceBrief; repairs: string[] } | { ok: false; repairs: string[]; issues: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function tryJson(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

const ANSWER_TYPES = ['single_company', 'comparison', 'trend', 'sector', 'insufficient_evidence'] as const;

export function repairBrief(input: unknown): RepairResult {
  const repairs: string[] = [];
  let root = input;
  if (typeof root === 'string') {
    const parsed = tryJson(root);
    if (parsed === undefined) return { ok: false, repairs, issues: ['tool input is not valid JSON (often a response cut off at the output limit)'] };
    root = parsed;
    repairs.push('parsed the tool input from a JSON string');
  }
  if (!isObj(root)) return { ok: false, repairs, issues: ['tool input is not an object'] };
  const b: Record<string, unknown> = { ...root };

  /** A field the model returned as a JSON string ("[...]" or "{...}") is parsed. */
  const unstring = (obj: Record<string, unknown>, key: string, path: string) => {
    const v = obj[key];
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) {
      const parsed = tryJson(v);
      if (parsed !== undefined) {
        obj[key] = parsed;
        repairs.push(`${path}: parsed from a JSON string`);
      }
    }
  };
  /** A string list given as one string becomes a list (split on commas for ID lists). */
  const stringList = (obj: Record<string, unknown>, key: string, path: string, split: boolean) => {
    unstring(obj, key, path);
    const v = obj[key];
    if (v === undefined || v === null) {
      obj[key] = [];
      repairs.push(`${path}: missing, set to []`);
    } else if (typeof v === 'string') {
      obj[key] = split ? v.split(/[\s,;]+/).filter(Boolean) : v.trim() ? [v] : [];
      repairs.push(`${path}: a string, made a list`);
    }
  };
  const enumValue = (obj: Record<string, unknown>, key: string, path: string, allowed: readonly string[]) => {
    const v = obj[key];
    if (typeof v !== 'string' || allowed.includes(v)) return;
    const norm = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (allowed.includes(norm)) {
      obj[key] = norm;
      repairs.push(`${path}: "${v}" normalized to "${norm}"`);
    }
  };

  enumValue(b, 'answerType', 'answerType', ANSWER_TYPES);
  for (const key of ['keyFindings', 'investmentConsiderations'] as const) {
    unstring(b, key, key);
    if (b[key] === undefined || b[key] === null) {
      b[key] = [];
      repairs.push(`${key}: missing, set to []`);
    }
  }
  stringList(b, 'evidenceGaps', 'evidenceGaps', false);
  stringList(b, 'followUpQuestions', 'followUpQuestions', false);

  if (Array.isArray(b.keyFindings)) {
    b.keyFindings = b.keyFindings.map((f, i) => {
      if (!isObj(f)) return f;
      const o = { ...f };
      enumValue(o, 'basis', `keyFindings[${i}].basis`, ['reported', 'analysis']);
      stringList(o, 'tickers', `keyFindings[${i}].tickers`, true);
      stringList(o, 'citationIds', `keyFindings[${i}].citationIds`, true);
      return o;
    });
  }
  if (Array.isArray(b.investmentConsiderations)) {
    b.investmentConsiderations = b.investmentConsiderations.map((c, i) => {
      if (typeof c === 'string') {
        repairs.push(`investmentConsiderations[${i}]: a string, given no citations`);
        return { text: c, citationIds: [] };
      }
      if (!isObj(c)) return c;
      const o = { ...c };
      stringList(o, 'citationIds', `investmentConsiderations[${i}].citationIds`, true);
      return o;
    });
  }
  unstring(b, 'comparison', 'comparison');
  if (b.comparison === null) {
    delete b.comparison;
    repairs.push('comparison: null, omitted');
  } else if (isObj(b.comparison)) {
    const c: Record<string, unknown> = { ...b.comparison };
    enumValue(c, 'kind', 'comparison.kind', ['table', 'trend']);
    stringList(c, 'columns', 'comparison.columns', false);
    unstring(c, 'rows', 'comparison.rows');
    if (Array.isArray(c.rows)) {
      c.rows = c.rows.map((r, i) => {
        if (!isObj(r)) return r;
        const o = { ...r };
        stringList(o, 'values', `comparison.rows[${i}].values`, false);
        stringList(o, 'citationIds', `comparison.rows[${i}].citationIds`, true);
        return o;
      });
    }
    // The model often puts the row-label header ("Risk Dimension") into columns: every row then has
    // one value fewer than there are columns. Drop that leading column; any other mismatch is kept
    // and flagged by validation.
    const { columns, rows } = c;
    if (Array.isArray(columns) && Array.isArray(rows) && rows.length > 0 && rows.every((r) => isObj(r) && Array.isArray(r.values) && r.values.length + 1 === columns.length)) {
      c.columns = columns.slice(1);
      repairs.push(`comparison.columns: dropped the leading column "${String(columns[0])}" (a row-label header; every row has ${columns.length - 1} values)`);
    }
    b.comparison = c;
  }

  const parsed = DiligenceBriefSchema.safeParse(b);
  if (!parsed.success) return { ok: false, repairs, issues: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`) };
  return { ok: true, brief: parsed.data, repairs };
}

/* ---------------------------------------------------------------- figures */

export interface Figure {
  text: string;
  /** The number as printed, commas removed ("100330", "5.0"): precision is judged from this, never from the parsed value. */
  digits: string;
  value: number;
  kind: 'currency' | 'percent';
  /** Multiplier word on a currency figure, normalized. */
  scale: 'thousand' | 'million' | 'billion' | 'trillion' | null;
  decimals: number;
}
type Scale = NonNullable<Figure['scale']>;

const SCALE_WORDS: Record<string, Figure['scale']> = {
  thousand: 'thousand', k: 'thousand',
  million: 'million', mn: 'million', mm: 'million', m: 'million',
  billion: 'billion', bn: 'billion', b: 'billion',
  trillion: 'trillion', tn: 'trillion', t: 'trillion',
};
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const CURRENCY = new RegExp(String.raw`(?:US)?\$\s?(${NUM})(?:\s?(thousand|million|billion|trillion|bn|mn|mm|tn|[kmbt])\b)?`, 'gi');
const PERCENT = new RegExp(String.raw`(?<![\d.,])(${NUM})\s?(?:%|percent\b|per cent\b|percentage points?\b)`, 'gi');

const digitsOf = (s: string) => s.replace(/,/g, '');
const toValue = (s: string) => Number(digitsOf(s));
const decimalsOf = (s: string) => (s.includes('.') ? s.split('.')[1]!.length : 0);
/** Significant digits as printed: "45.0" has 3, "416.2" has 4, "100" has 1 (an integer's trailing zeros say nothing about precision). */
export function significantDigits(digits: string): number {
  const d = digits.includes('.') ? digits.replace('.', '') : digits.replace(/0+$/, '');
  return d.replace(/^0+/, '').length;
}

/**
 * Currency amounts and percentages in model-written text (SPEC §31). `headerScale` is the unit a
 * comparison row label or column header states ("Total Revenue ($M)"): a cell's amount with no
 * scale word of its own takes it, as a reader would.
 */
export function extractFigures(text: string, headerScale: Figure['scale'] = null): Figure[] {
  const out: Array<Figure & { at: number }> = [];
  for (const m of text.matchAll(CURRENCY)) {
    out.push({ at: m.index, text: m[0].trim(), digits: digitsOf(m[1]!), value: toValue(m[1]!), kind: 'currency', scale: m[2] ? SCALE_WORDS[m[2].toLowerCase()]! : headerScale, decimals: decimalsOf(m[1]!) });
  }
  for (const m of text.matchAll(PERCENT)) out.push({ at: m.index, text: m[0].trim(), digits: digitsOf(m[1]!), value: toValue(m[1]!), kind: 'percent', scale: null, decimals: decimalsOf(m[1]!) });
  // In text order.
  return out.sort((a, b) => a.at - b.at).map(({ at: _at, ...f }) => f);
}

/**
 * A unit stated in a comparison header: "($M)", "($ millions)", "(in billions)", "(millions)".
 * A bare letter needs the "$", so a footnote marker "(b)" is never read as billions.
 */
const HEADER_UNIT = [/\(\s*(?:US)?\$\s*(?:in\s+)?(thousands?|millions?|billions?|trillions?|k|mm?|mn|bn?|tn)\s*\)/i, /\(\s*(?:in\s+)?(thousands|millions|billions|trillions)\s*\)/i];
export function headerScale(header: string): Figure['scale'] {
  for (const re of HEADER_UNIT) {
    const m = re.exec(header);
    if (m) return SCALE_WORDS[m[1]!.toLowerCase().replace(/s$/, '')] ?? null;
  }
  return null;
}

/** One number printed in a passage, with what is printed around it. */
export interface PassageNumber {
  digits: string;
  value: number;
  /** Followed by "%", "percent", "percentage point(s)", or a "%" in the next table cell ("215 | %"). */
  percent: boolean;
  /** Followed by a scale word ("25.0 billion"). */
  scale: Scale | null;
  /** Printed after a "$" ("$1.2", "$ 938", or the flattened cell "$ | 47,405"). */
  dollar: boolean;
  /** A flattened table cell: a "|" right before or right after it. */
  cell: boolean;
  /** Never a candidate: a year ("Fiscal 2024"), a day after a month ("December 31"), or a reference number ("Item 5", "Note 7"). */
  excluded: 'year' | 'date' | 'reference' | null;
  /** Character offset in the passage. */
  at: number;
}

export interface PassageNumbers {
  numbers: PassageNumber[];
  /** The passage says its amounts are in billions / millions / thousands ("(in millions)", "(Dollars in billions)"). */
  unit: Scale | null;
  /** The passage prints a "$" somewhere, so its bare table cells may be currency. */
  dollarSign: boolean;
  /**
   * Set only by `withPrecedingUnit`: the passage states no unit, opens with a table, and the line
   * right before it in the filing (the end of the previous chunk) is that table's unit caption.
   * `table` is the numbers of that leading table; `rest` is the numbers after it; `end` is where it ends.
   */
  preceding?: { unit: Scale; table: PassageNumber[]; rest: PassageNumber[]; end: number };
  /**
   * Set only when the passage states no unit: the tables whose first header cell is a bare
   * currency caption ("(MILLIONS) | …"; `captionTables`), each with its own unit. Empty when the
   * passage has none, or prints any other scale caption (the rule is then disqualified).
   */
  captions?: CaptionTable[];
}

/**
 * Numbers in a passage, with what follows them. Filing tables are flattened to pipe-separated
 * cells, so a percentage cell reads "215 | %" (and "LCR | 126 | %"): a "%" in the next cell counts.
 */
const PASSAGE_NUM = new RegExp(String.raw`(?<![\d.])(${NUM})(?:\s?(%|percent\b|per cent\b|percentage points?\b|thousand\b|million\b|billion\b|trillion\b)|\s*\|\s*(%))?`, 'gi');
const MONTH_BEFORE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*$/i;
const REFERENCE_BEFORE = /\b(?:Items?|Notes?|Parts?|Sections?|Rules?|Articles?|Exhibits?|Schedules?|Form|pages?|No\.)\s*$/i;

export function passageNumbers(text: string): PassageNumbers {
  const numbers: PassageNumber[] = [];
  for (const m of text.matchAll(PASSAGE_NUM)) {
    const printed = m[1]!;
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const after = text.slice(m.index + printed.length, m.index + printed.length + 4);
    const suffix = (m[2] ?? m[3])?.toLowerCase();
    const percent = !!suffix && /^(?:%|percent|per cent|percentage point)/.test(suffix);
    const scale = suffix && !percent ? SCALE_WORDS[suffix]! : null;
    // A negative amount is printed in parentheses: "(69,691)" and "$ | (5,072)".
    const dollar = /\$\s*(?:\|\s*)?\(?$/.test(before);
    const value = toValue(printed);
    let excluded: PassageNumber['excluded'] = null;
    if (REFERENCE_BEFORE.test(before)) excluded = 'reference';
    else if (MONTH_BEFORE.test(before) && /^\d{1,2}$/.test(printed) && value >= 1 && value <= 31) excluded = 'date';
    else if (!dollar && !suffix && /^(?:19|20)\d{2}$/.test(printed)) excluded = 'year';
    numbers.push({ digits: digitsOf(printed), value, percent, scale, dollar, cell: /\|\s*\(?$/.test(before) || /^\)?\s*\|/.test(after), excluded, at: m.index });
  }
  const unit: Scale | null = /\bin\s+billions\b/i.test(text) ? 'billion' : /\bin\s+millions\b/i.test(text) ? 'million' : /\bin\s+thousands\b/i.test(text) ? 'thousand' : null;
  return { numbers, unit, dollarSign: text.includes('$'), ...(unit ? {} : { captions: captionTables(text) }) };
}

/**
 * The same-passage caption rule (architecture §6.9, Phase 7): a currency unit caption printed
 * without "in" as the FIRST cell of a table header row, as Pfizer prints "(MILLIONS) |  | Worldwide"
 * and "(MILLIONS, EXCEPT PER SHARE DATA) | 2024", and as others print "(millions of dollars)",
 * "(Millions)" or "($ millions)". It states the unit of that table only: the caption row and the
 * contiguous table rows after it (the chunker's `isTableRow`), never the rest of the passage.
 * Only a caption whose whole content is a scale word (optionally "of dollars", optionally followed
 * by ", except …" / ", unless …") counts. Any other parenthesized scale caption anywhere in the
 * passage ("(millions of shares)", "(thousands of barrels daily)", a row label such as
 * "Shares outstanding (millions)", or a caption that is not a row's first cell) disqualifies the
 * rule for the whole passage: such a passage mixes units the rule cannot tell apart. Used only
 * when the passage has no "in millions" wording. `from`/`to` are character offsets in the passage.
 */
const SCALE_CAPTION = /\(\s*(?:\$\s*)?(?:millions|thousands|billions)\b[^()\n]*\)/gi;
const CAPTION_CELL = /^\(\s*(?:\$\s*)?(millions|thousands|billions)(?:\s+of\s+dollars)?(?:\s*,\s*(?:except|unless)\b[^()|\n]{0,80})?\s*\)$/i;
export interface CaptionTable {
  unit: Scale;
  from: number;
  to: number;
}
export function captionTables(text: string): CaptionTable[] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const tables: CaptionTable[] = [];
  const captionAt = new Set<number>();
  const captionOf = (line: string) => (isTableRow(line) ? CAPTION_CELL.exec(line.split('|')[0]!.trim()) : null);
  for (let i = 0; i < lines.length; i++) {
    const m = captionOf(lines[i]!);
    if (!m) continue;
    captionAt.add(starts[i]! + lines[i]!.indexOf('('));
    // The table runs to its last contiguous row, or to the next caption row (a new table).
    let j = i + 1;
    while (j < lines.length && isTableRow(lines[j]!) && !captionOf(lines[j]!)) j++;
    tables.push({ unit: SCALE_WORDS[m[1]!.toLowerCase().replace(/s$/, '')]!, from: starts[i]!, to: starts[j - 1]! + lines[j - 1]!.length });
    i = j - 1;
  }
  if (!tables.length) return [];
  for (const m of text.matchAll(SCALE_CAPTION)) if (!captionAt.has(m.index)) return [];
  return tables;
}

/**
 * The unit caption that ends the text before a passage: its last non-empty line ends with
 * "in millions" / "in thousands" / "in billions", optionally inside parentheses and optionally
 * followed by ", except per share ..." ("CONSOLIDATED STATEMENTS OF CASH FLOWS(In millions)",
 * "(In millions, except per share amounts)", "(Dollars in billions)"). That line must not be a table
 * row (no "|"), and nothing may follow the caption but its closing parenthesis. "(in millions of
 * shares)" is not a currency unit and is not read.
 */
const CAPTION_UNIT = /\bin\s+(millions|thousands|billions)\b/gi;
const CAPTION_TAIL = /^(?:\s*,\s*except\s+per[\s-]+share[^|\d()]{0,40})?\s*\)?\s*$/i;
export function precedingUnit(precedingText: string | null): Scale | null {
  const last = precedingText?.split('\n').map((l) => l.trim()).filter(Boolean).at(-1);
  if (!last || last.includes('|')) return null;
  const m = [...last.matchAll(CAPTION_UNIT)].at(-1);
  if (!m || !CAPTION_TAIL.test(last.slice(m.index + m[0].length))) return null;
  return SCALE_WORDS[m[1]!.toLowerCase().replace(/s$/, '')] ?? null;
}

/** The table a passage opens with: its leading run of table rows (the chunker's `isTableRow`; blank lines before it skipped), or null if it opens with prose. */
export function leadingTable(text: string): { table: string; rest: string } | null {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  const start = i;
  while (i < lines.length && isTableRow(lines[i]!)) i++;
  if (i === start) return null;
  const end = lines.slice(0, i).join('\n').length;
  return { table: text.slice(0, end), rest: text.slice(end) };
}

/**
 * The preceding-unit rule's input (architecture §6.9). A passage that states no unit of its own
 * but opens with a table whose unit caption is the last line of the filing text right before it
 * (`precedingFilingText`: same filing, same section, at most two chunks back) takes that unit for
 * the cells of that leading table only, never for anything after it. Why this is still strict:
 * the caption is the line directly above the table in the filing, as a reader sees it; anything
 * in between (prose, another table row, a heading) breaks the link.
 */
export function withPrecedingUnit(p: PassageNumbers, text: string, precedingText: string | null): PassageNumbers {
  if (p.unit || !precedingText) return p;
  const unit = precedingUnit(precedingText);
  if (!unit) return p;
  const lead = leadingTable(text);
  if (!lead) return p;
  const end = lead.table.length;
  // A bare caption never overrides the preceding unit: a caption table inside the leading table is dropped.
  const captions = p.captions?.filter((c) => c.from >= end);
  const rest = passageNumbers(lead.rest).numbers.map((n) => ({ ...n, at: n.at + end }));
  return { ...p, ...(captions ? { captions } : {}), preceding: { unit, table: passageNumbers(lead.table).numbers, rest, end } };
}

const FACTOR: Record<Scale, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** How a figure matched a passage. `unit_unstated` is a near match only: it never counts as verified. */
export type FigureRule = 'exact' | 'scaled' | 'caption_unit' | 'preceding_unit' | 'unit_unstated';

/**
 * Does this passage print the figure? The rules, in order (each states only that a number with
 * these digits and this unit is printed in the passage, not that it means what the brief says):
 * - percentage: a number printed as a percentage with the same value ('exact');
 * - unscaled currency ("$31", "$6.11"): the same value printed after a "$", or in a table cell
 *   of a passage that prints a "$", with no scale word ('exact'). Never a year, a day after a
 *   month or an "Item 5". A figure of 1,000 or more is refused when the passage says its amounts
 *   are in thousands, millions or billions: the unit was dropped;
 * - scaled currency ("$25.0 billion"): the same value with the same scale word ('exact'); or the
 *   exactly equal amount printed with another scale word, "$72,220 million" for "$72.22 billion"
 *   ('scaled'); or, in a passage that states its unit, a "$" amount or table cell equal to the
 *   figure in that unit, or (figure in a coarser unit, with at least 3 significant digits as
 *   printed) rounding to it at the figure's own precision, "$416.2 billion" for 416,161 in
 *   millions, never "$1 billion" for 1,234 ('scaled'). Rounding under the same scale word
 *   ("$295B" for "$295.49 billion") is not accepted;
 * - caption unit: in a passage that states no unit, a "$" amount or table cell of a table whose
 *   first header cell is a bare currency caption ("(MILLIONS) | …"; `captionTables`), matched in
 *   that table's unit exactly as 'scaled' matches a passage-stated unit ('caption_unit'). An
 *   unscaled figure of 1,000 or more found only in such a table is refused (the unit was dropped);
 * - preceding unit: in a passage that states no unit, a "$" amount or table cell of the table
 *   the passage opens with, whose unit caption ("(In millions)") is the line right before the
 *   passage in the same filing section (`withPrecedingUnit`), and whose amount in that unit is
 *   EXACTLY the figure's amount ('preceding_unit'). No rounding: "$416.2 billion" for 416,161
 *   is not accepted here. An unscaled figure of 1,000 or more found only in that table is
 *   refused, as above (the unit was dropped);
 * - a scaled figure whose printed digits equal a bare table cell in a passage that states no
 *   unit (the header is often in another chunk) is 'unit_unstated': reported, not verified.
 *   Cells of a leading table under a preceding unit, or of a caption table, are not near
 *   matches: their unit is known.
 * A comparison cell's figure takes the unit its row label or column header states (`headerScale`).
 */
export function matchFigure(f: Figure, p: PassageNumbers): FigureRule | null {
  const usable = p.numbers.filter((n) => !n.excluded);
  if (f.kind === 'percent') return usable.some((n) => n.percent && n.value === f.value) ? 'exact' : null;
  const amounts = usable.filter((n) => !n.percent && !n.scale && (n.dollar || (n.cell && p.dollarSign)));
  if (!f.scale) {
    if (!amounts.some((n) => n.value === f.value)) return null;
    if (p.unit && f.value >= 1000) return null;
    // Printed only in a table whose caption (in the previous chunk) states a unit: the unit was dropped.
    if (p.preceding && f.value >= 1000 && !p.preceding.rest.some((n) => !n.excluded && !n.percent && !n.scale && (n.dollar || (n.cell && p.dollarSign)) && n.value === f.value)) return null;
    // Printed only in tables under a bare caption (or the leading table): the unit was dropped.
    if (p.captions?.length && f.value >= 1000 && !amounts.some((n) => n.value === f.value && !captionUnitOf(p, n) && !(p.preceding && n.at < p.preceding.end))) return null;
    return 'exact';
  }
  if (usable.some((n) => n.scale === f.scale && n.value === f.value)) return 'exact';
  const amount = f.value * FACTOR[f.scale];
  for (const n of usable) if (n.scale && n.scale !== f.scale && Math.abs(n.value * FACTOR[n.scale] - amount) < 1e-6 * amount) return 'scaled';
  const cells = usable.filter((n) => !n.percent && !n.scale && (n.dollar || n.cell));
  if (p.unit) return inUnit(f, f.scale, p.unit, cells) ? 'scaled' : null;
  if (p.captions?.length) for (const c of p.captions) if (inUnit(f, f.scale, c.unit, cells.filter((n) => n.at >= c.from && n.at < c.to))) return 'caption_unit';
  const cellsOf = (ns: readonly PassageNumber[]) => ns.filter((n) => !n.excluded && !n.percent && !n.scale && (n.dollar || n.cell) && !captionUnitOf(p, n));
  if (p.preceding) {
    const unitFactor = FACTOR[p.preceding.unit];
    // Exactly equal amounts only (to floating-point noise): 72,220 in millions is $72.22 billion.
    if (cellsOf(p.preceding.table).some((n) => Math.abs(n.value * unitFactor - amount) < 1e-9 * amount)) return 'preceding_unit';
  }
  const loose = cellsOf(p.preceding ? p.preceding.rest : usable);
  return significantDigits(f.digits) >= 3 && loose.some((n) => n.cell && n.digits === f.digits) ? 'unit_unstated' : null;
}

/** A scaled figure against amounts stated in `unit`: equal in that unit, or (a coarser figure with at least 3 significant digits) rounding to it at the figure's precision. */
function inUnit(f: Figure, scale: Scale, unit: Scale, cells: readonly PassageNumber[]): boolean {
  if (unit === scale) return cells.some((n) => n.value === f.value);
  if (FACTOR[scale] <= FACTOR[unit] || significantDigits(f.digits) < 3) return false;
  const ratio = FACTOR[scale] / FACTOR[unit];
  return cells.some((n) => round(n.value / ratio, f.decimals) === f.value);
}

const captionUnitOf = (p: PassageNumbers, n: PassageNumber): Scale | null => p.captions?.find((c) => n.at >= c.from && n.at < c.to)?.unit ?? null;

/* ------------------------------------------------------------- validation */

const RULE_RANK: Record<FigureRule, number> = { exact: 0, scaled: 1, caption_unit: 2, preceding_unit: 3, unit_unstated: 4 };

export interface ValidatedBrief {
  brief: DiligenceBrief;
  validation: BriefValidation;
  /** Valid chunk IDs cited anywhere in the brief, in first-cited order. */
  citedChunkIds: string[];
}

/**
 * `precedingText` (optional) gives the filing text right before a cited chunk (the pipeline passes
 * `Retriever.precedingText`; the re-score builds the same from chunks.jsonl). It only feeds the
 * preceding-unit rule; without it that rule never applies. It must be pure for a given index.
 */
export function validateBrief(brief: DiligenceBrief, repairs: string[], passages: ReadonlyMap<string, string>, precedingText?: (chunkId: string) => string | null): ValidatedBrief {
  const removed: Array<{ location: string; id: string }> = [];
  let returned = 0;
  let valid = 0;
  const cited: string[] = [];
  const clean = (ids: readonly string[], location: string): string[] => {
    const keep: string[] = [];
    for (const raw of new Set(ids.map((id) => id.trim()).filter(Boolean))) {
      returned++;
      if (passages.has(raw)) {
        valid++;
        keep.push(raw);
        if (!cited.includes(raw)) cited.push(raw);
      } else removed.push({ location, id: raw });
    }
    return keep;
  };

  const out: DiligenceBrief = {
    ...brief,
    keyFindings: brief.keyFindings.map((f, i) => ({ ...f, citationIds: clean(f.citationIds, `keyFindings[${i}]`) })),
    investmentConsiderations: brief.investmentConsiderations.map((c, i) => ({ ...c, citationIds: clean(c.citationIds, `investmentConsiderations[${i}]`) })),
    ...(brief.comparison ? { comparison: { ...brief.comparison, rows: brief.comparison.rows.map((r, i) => ({ ...r, citationIds: clean(r.citationIds, `comparison.rows[${i}]`) })) } } : {}),
  };

  const uncited: string[] = [];
  out.keyFindings.forEach((f, i) => f.citationIds.length === 0 && uncited.push(`keyFindings[${i}]`));
  out.comparison?.rows.forEach((r, i) => r.citationIds.length === 0 && uncited.push(`comparison.rows[${i}]`));
  out.investmentConsiderations.forEach((c, i) => c.citationIds.length === 0 && uncited.push(`investmentConsiderations[${i}]`));

  // Comparison rows whose values do not line up with the columns (after repair).
  const comparisonMisaligned: string[] = [];
  out.comparison?.rows.forEach((r, i) => r.values.length !== out.comparison!.columns.length && comparisonMisaligned.push(`comparison.rows[${i}]`));

  // Numeric grounding: each item's figures against its own valid citations; the title, summary
  // and gaps against every passage some item cites (they summarize the items).
  const numbersCache = new Map<string, PassageNumbers>();
  const numbersOf = (id: string) => {
    let n = numbersCache.get(id);
    if (!n) {
      const text = passages.get(id) ?? '';
      n = passageNumbers(text);
      if (precedingText && passages.has(id)) n = withPrecedingUnit(n, text, precedingText(id));
      numbersCache.set(id, n);
    }
    return n;
  };
  const figures: BriefValidation['numeric']['figures'] = [];
  const check = (text: string, location: string, ids: readonly string[], scale: Figure['scale'] = null) => {
    for (const f of extractFigures(text, scale)) {
      // The strongest rule over the cited passages: exact, then scaled, then the unverified near match.
      let hit: { rule: FigureRule; chunkId: string } | null = null;
      for (const id of ids) {
        const rule = matchFigure(f, numbersOf(id));
        if (rule && (!hit || RULE_RANK[rule] < RULE_RANK[hit.rule])) hit = { rule, chunkId: id };
        if (hit?.rule === 'exact') break;
      }
      figures.push({ location, figure: f.text, verified: hit !== null && hit.rule !== 'unit_unstated', rule: hit?.rule ?? null, chunkId: hit?.chunkId ?? null });
    }
  };
  check(out.title, 'title', cited);
  check(out.executiveSummary, 'executiveSummary', cited);
  out.keyFindings.forEach((f, i) => {
    check(f.title, `keyFindings[${i}].title`, f.citationIds);
    check(f.finding, `keyFindings[${i}].finding`, f.citationIds);
  });
  out.comparison?.rows.forEach((r, i) => {
    check(r.label, `comparison.rows[${i}].label`, r.citationIds);
    // A cell's unit can be stated once in its row label or column header ("Revenue ($M)").
    r.values.forEach((v, j) => check(v, `comparison.rows[${i}].values[${j}]`, r.citationIds, headerScale(r.label) ?? headerScale(out.comparison!.columns[j] ?? '')));
  });
  out.investmentConsiderations.forEach((c, i) => check(c.text, `investmentConsiderations[${i}].text`, c.citationIds));
  out.evidenceGaps.forEach((g, i) => check(g, `evidenceGaps[${i}]`, cited));

  const verified = figures.filter((f) => f.verified).length;
  const unitUnstated = figures.filter((f) => f.rule === 'unit_unstated').length;
  const notices: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (removed.length) notices.push(`${plural(removed.length, 'citation', 'citations')} removed: not in the supplied evidence.`);
  if (uncited.length) notices.push(`${plural(uncited.length, 'item has', 'items have')} no supporting citation.`);
  if (figures.length - verified > 0) notices.push(`${plural(figures.length - verified, 'figure', 'figures')} not found in the cited passages (marked "unverified figure").`);
  if (comparisonMisaligned.length) notices.push(`${plural(comparisonMisaligned.length, 'comparison row does', 'comparison rows do')} not line up with the table's columns.`);
  if (repairs.length) notices.push(`The model output needed ${plural(repairs.length, 'deterministic repair', 'deterministic repairs')} before validation.`);

  return {
    brief: out,
    citedChunkIds: cited,
    validation: {
      repairs,
      citations: { returned, valid, removed, preValidationRate: returned ? Number((valid / returned).toFixed(4)) : 1 },
      uncited,
      numeric: { figures, total: figures.length, verified, unitUnstated },
      comparisonMisaligned,
      notices,
    },
  };
}

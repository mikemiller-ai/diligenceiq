import { sentenceSpans, type Span } from '@diligenceiq/corpus/segments';
import { type Block, blockUnits, type Unit } from './layout';

/*
 * The sentences of a passage closest to a statement (DD-21 f), by fixed rules and no model call:
 * - the passage is cut into units (sentences of its paragraphs, list items, headings, table rows);
 * - a unit scores one point per content word it shares with the statement and FIGURE_WEIGHT per
 *   figure of the statement it prints exactly (`sameFigure`);
 * - a unit qualifies only when it prints such a figure, or shares at least MIN_SHARED_WORDS content
 *   words of which at least one is specific (not a lexicon or generic finance word): two common words
 *   ("cost", "sales") never make a sentence "close";
 * - the drawer leads with the one to three best qualifying units (at least three quarters of the best
 *   score), in passage order. Ties go to the earlier unit.
 * This is word and figure overlap, not a judgment that the sentence proves the statement. When no unit
 * qualifies, nothing is picked and the drawer shows the whole passage.
 */

export const MAX_KEY_UNITS = 3;
export const MIN_SHARED_WORDS = 3;
export const FIGURE_WEIGHT = 3;
/** A unit is kept only when it scores at least this share of the best unit. */
export const RELATIVE = 0.75;

const STOPWORDS = new Set(
  'the and for are was were has have had with from that this these those which their there than then into onto over under about after before during between through while also such other its our your his her they them will would could should may might can cannot not but nor any all each both more most less least some very much many per via upon within without including included include includes company company’s companies year years fiscal period quarter quarterly annual report reports reported filing form total net cost costs'.split(
    ' ',
  ),
);

/**
 * A fixed finance lexicon: words a statement and a filing use for the same thing ("revenue" vs
 * "net sales", "grew" vs "increased"). Each maps to one stem; nothing is learned or generated. Only
 * unambiguous forms are mapped: "contract" (a customer contract), "notes" (financial statement
 * notes) and "gain" (a gain on a sale) are not.
 */
const SYNONYMS: ReadonlyArray<[string, readonly string[]]> = [
  ['revenue', ['revenu', 'revenue', 'sale', 'sales', 'turnover']],
  ['increase', ['increas', 'grew', 'grow', 'growth', 'rose', 'risen', 'higher', 'expansion']],
  ['decrease', ['decreas', 'declin', 'fell', 'fallen', 'lower', 'shrank']],
  ['profit', ['profit', 'income', 'earning']],
  ['cash', ['cash']],
  ['debt', ['debt', 'borrowing']],
];
const SYNONYM_OF = new Map(SYNONYMS.flatMap(([stem, forms]) => forms.map((f) => [f, stem] as const)));
/** Words that count toward the overlap but never make a unit close on their own: the lexicon stems and generic finance words. */
const GENERIC = new Set([
  ...SYNONYMS.map(([s]) => s),
  ...'million billion thousand percent compared due primarily change amount impact business result operating operations margin rate share price'.split(' ').map((w) => stem(w)),
]);

/** A light stem: possessives, plurals and -ed / -ing / -es endings, keeping at least four letters. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/(?:’s|'s|’|')$/, '');
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return SYNONYM_OF.get(w) ?? w;
}

/** Content words: lowercase, at least three letters, stemmed and mapped through the lexicon, no stopwords. */
export function contentWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.toLowerCase().matchAll(/[a-z][a-z’'-]{2,}/g)) {
    if (STOPWORDS.has(m[0])) continue;
    const w = stem(m[0]);
    if (!STOPWORDS.has(w) && w.length >= 3) out.add(w);
  }
  return out;
}

/** Whether a word is specific to the statement (not a lexicon stem or a generic finance word). */
export const isSpecific = (w: string) => !GENERIC.has(w);

/** A printed figure: digits with a currency sign, a percent, a scale word, grouping or decimals. */
export interface Figure extends Span {
  /** The number as printed, before any scale word ("$1.2 billion" → 1.2). */
  printed: number;
  /** The value in whole units (scale words applied); percentages stay as printed. */
  value: number;
  /** The printed digits, without grouping or decimal point ("416.2" → "4162"). */
  digits: string;
  /** Decimal places as printed, before any scale word. */
  decimals: number;
  percent: boolean;
  /** The printed scale word's multiplier ("$1.2 billion" → 1e9), else 1. */
  scale: number;
  /** Printed after a "$" (also "$ | 178,353", a flattened table). */
  dollar: boolean;
  /** Printed in a table cell (a `|` right before or after it). */
  cell: boolean;
  /** Printed as a bare number (no sign, scale word or percent): a table cell or a count, unit unknown. */
  bare: boolean;
}

const SCALE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };
const FIGURE = /(\$\s?)?\(?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\)?(?:\s?(?:\|\s*)?(%|percent\b)|\s(thousand|million|billion|trillion)\b)?/gi;
/** A product or model name right before a bare number ("Microsoft 365", "Windows 11", "iPhone 16"): not a figure. */
const NAME_BEFORE = /\b[A-Za-z]*[A-Z][\w®™+-]*\s+$/;

export function figuresIn(text: string, base = 0): Figure[] {
  const out: Figure[] = [];
  for (const m of text.matchAll(FIGURE)) {
    const [whole, dollarSign, int, frac, pct, scale] = m;
    const prev = text[m.index - 1] ?? '';
    // Part of a word or an identifier ("10-K", "FY2025", "Q3"), or a bare year or small count: not a figure.
    if (/[A-Za-z\d.-]/.test(prev) || /^[A-Za-z-]/.test(text[m.index + whole.length] ?? ' ')) continue;
    const digits = int!.replace(/,/g, '');
    const n = Number(`${digits}${frac ? `.${frac}` : ''}`);
    const grouped = int!.includes(',');
    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const dollar = Boolean(dollarSign) || /\$\s*(?:\|\s*)?\(?$/.test(before);
    const bare = !dollar && !pct && !scale;
    if (bare && !grouped && !frac) {
      // A plain integer is a figure only when it is large enough not to be a count or a year.
      if (n < 100 || (n >= 1900 && n <= 2100 && digits.length === 4)) continue;
    }
    if (bare && NAME_BEFORE.test(before)) continue;
    const start = base + m.index + (whole.startsWith('(') ? 1 : 0);
    const end = base + m.index + whole.replace(/\)$/, '').length;
    const k = scale ? SCALE[scale.toLowerCase()]! : 1;
    out.push({
      start,
      end,
      printed: n,
      value: n * k,
      digits: `${digits}${frac ?? ''}`,
      decimals: frac?.length ?? 0,
      percent: Boolean(pct),
      scale: k,
      dollar,
      cell: /\|\s*\(?$/.test(before) || /^\)?\s*\|/.test(text.slice(m.index + whole.length, m.index + whole.length + 4)),
      bare,
    });
  }
  return out;
}

/** The unit a passage states for its amounts ("(in millions)", "Dollars in billions"), as a multiplier. */
export function passageUnit(passage: string): number | null {
  const m = /\bin\s+(billions|millions|thousands)\b/i.exec(passage);
  return m ? SCALE[m[1]!.toLowerCase().replace(/s$/, '')]! : null;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const significant = (digits: string) => digits.replace(/^0+/, '').length;
const roundTo = (v: number, decimals: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

/**
 * Whether a passage figure prints a statement figure exactly, mirroring the numeric validator's
 * strictness (packages/rag `matchFigure`, architecture §6.9). Display only; never counted as
 * verification. Nothing is matched by rounding under the same scale word ("$4 billion" is not
 * "$3.5 billion", "16%" is not "15.6%"):
 * - a percentage: a percentage with the same value;
 * - a scaled amount ("$1.2 billion"): the same amount with the same scale word, or the exactly equal
 *   amount with another one ("$1,200 million"); in a passage that states its unit, a "$" amount or
 *   table cell equal to it in that unit, or (statement in a coarser unit, at least 3 significant
 *   digits) rounding to it at its own precision ("$416.2 billion" for 416,161 in millions); in a
 *   passage that states no unit, a table cell with the identical digits (at least 3 significant);
 * - an unscaled amount ("$31", "416,161"): the same value, unscaled, as a "$" amount or a table cell
 *   (any bare number when the statement's is bare too).
 */
export function sameFigure(claim: Figure, passage: Figure, unit: number | null = null): boolean {
  if (claim.percent || passage.percent) return claim.percent && passage.percent && close(claim.value, passage.value);
  if (claim.scale > 1) {
    if (passage.scale > 1) return close(passage.value, claim.value);
    if (!passage.dollar && !passage.cell) return false;
    if (unit) {
      if (unit === claim.scale) return close(passage.printed, claim.printed);
      if (claim.scale > unit && significant(claim.digits) >= 3) return close(roundTo((passage.printed * unit) / claim.scale, claim.decimals), claim.printed);
      return false;
    }
    return passage.cell && passage.digits === claim.digits && significant(claim.digits) >= 3;
  }
  if (passage.scale > 1 || !close(passage.printed, claim.printed)) return false;
  if (claim.bare) return true;
  // A "$" figure of 1,000 or more in a passage stated in thousands or more is a different amount.
  if (unit && claim.value >= 1000) return false;
  return passage.dollar || passage.cell;
}

export interface KeyUnit extends Span {
  score: number;
  /** Claim figures this unit prints. */
  figures: Span[];
}

/** Units a sentence picker chooses from: sentences of paragraphs, list items, headings and table rows. */
export function supportUnits(text: string, blocks: readonly Block[]): Array<Span & { row: boolean }> {
  const out: Array<Span & { row: boolean }> = [];
  for (const b of blocks) {
    for (const u of blockUnits(b) as Unit[]) {
      if (u.kind === 'hidden') continue;
      if (u.kind === 'row') {
        if (u.cells.length) out.push({ start: u.cells[0]!.start, end: u.cells.at(-1)!.end, row: true });
      } else if (u.kind === 'paragraph') {
        for (const s of sentenceSpans(text, u.text)) {
          const t = { start: s.start, end: s.end };
          while (t.end > t.start && /\s/.test(text[t.end - 1]!)) t.end--;
          if (t.end > t.start) out.push({ ...t, row: false });
        }
      } else out.push({ ...u.text, row: false });
    }
  }
  return out;
}

/**
 * Figures of the passage that print one of the statement's figures exactly (bolded in the drawer).
 * `only`, when given, replaces the statement's figures: a brief passes the figures the validator
 * verified in this passage (an empty list bolds nothing), a metric value passes its own printed cell.
 */
export function matchedFigures(claim: string, passage: string, base = 0, only?: readonly string[]): Span[] {
  const wanted = only ? only.flatMap((f) => figuresIn(f)) : figuresIn(claim);
  if (!wanted.length) return [];
  const unit = passageUnit(passage);
  return figuresIn(passage, base).filter((p) => wanted.some((c) => sameFigure(c, p, unit)));
}

/** The one to three units closest to `claim`, in passage order; empty when none qualifies. */
export function pickSupport(text: string, blocks: readonly Block[], claim: string, figureSpans: readonly Span[]): KeyUnit[] {
  const words = contentWords(claim);
  if (!words.size && !figureSpans.length) return [];
  const scored = supportUnits(text, blocks).map((u) => {
    const unitWords = contentWords(text.slice(u.start, u.end));
    const shared = [...words].filter((w) => unitWords.has(w));
    const figures = figureSpans.filter((f) => f.start >= u.start && f.end <= u.end);
    const qualifies = figures.length > 0 || (shared.length >= MIN_SHARED_WORDS && shared.some(isSpecific));
    return { start: u.start, end: u.end, score: shared.length + FIGURE_WEIGHT * figures.length, figures, qualifies };
  });
  const candidates = scored.map((s, i) => ({ s, i })).filter(({ s }) => s.qualifies);
  if (!candidates.length) return [];
  const best = Math.max(...candidates.map(({ s }) => s.score));
  return candidates
    .filter(({ s }) => s.score >= RELATIVE * best)
    .sort((a, b) => b.s.score - a.s.score || a.i - b.i)
    .slice(0, MAX_KEY_UNITS)
    .sort((a, b) => a.i - b.i)
    .map(({ s: { qualifies: _q, ...k } }) => k);
}

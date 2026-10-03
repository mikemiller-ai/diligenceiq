import type { ArithmeticClaim } from '@diligenceiq/core';
import { mentionsIn } from './company-claims';
import { sentencesOf } from './period-claims';
import { type Figure, extractFiguresAt } from './validate';

/**
 * The deterministic arithmetic check (architecture §6.9; evaluation.md §13; 2026-10-03). No model call.
 *
 * A sentence that states two values of the same kind and the change between them is recomputed:
 * "grew from $15,068 million in FY2024 to $116,193 million in FY2025 (up 145%)" gives +671%, not
 * 145%, and is flagged `arithmeticClaims`. Numeric grounding (validate.ts) proves each figure is
 * printed in a cited passage; it cannot see that two verified figures and a verified percentage
 * disagree with each other. This check reads only the brief's own text.
 *
 * The pairing is explicit, never inferred from figure order. The forms read:
 * - "from X (in P) to Y (in P)" with the change after Y ("(up Z%)", ", up Z%", ", a Z% increase",
 *   ", an increase of $D or Z%") or before "from" ("rose Z% from X to Y", "increased by $D from X
 *   to Y"), and a chain "… to Y (up Z%) and (then) (to) W (up Z2%)", whose base is Y;
 * - "rose Z% to Y from X";
 * - "Y (in P), up Z% from X" ("down", "an increase / a decrease of", also "over", "versus", "compared with");
 * - "Y versus X" (or "vs.", "compared with / to") with the change after X;
 * - "more than doubled / tripled / quadrupled" right before "from X to Y" or right after Y.
 *
 * How the values are compared:
 * - both currency, a percent change: relative change; a currency change: the difference (the
 *   change needs its own scale word when the values have one). A value with no scale word takes
 *   its partner's ("from $5.2 to $6.1 billion").
 * - both percentages: a "pp", "percentage point" or "basis points" change is the difference
 *   ("from 24.0% to 26.9% (up 2.9 pp)"); a "%" change passes if it matches EITHER the relative
 *   change or the difference, because "up 3%" for a margin that moved three points is common usage.
 * - rounding: every value is an interval at its printed precision ("$4.5 billion" is 4.45–4.55,
 *   "126%" is 125.5–126.5), so the check flags only when no reading of the printed values gives
 *   the stated change. "about / approximately / roughly / ~" widens the stated change by 10%,
 *   "nearly / almost" accepts 80–100% of it, "more than / over" and "less than / under" are bounds;
 *   the same hedges on either value widen that value the same way ("from about $5.0 billion to over
 *   $6.5 billion").
 * - direction: "up / rose / increase" or "+" must be a rise, "down / fell / decrease" or "-" a fall.
 *
 * What it does not read (kept precise on purpose; each is skipped, never flagged):
 * - two companies' values side by side ("$416.2 billion versus $281.7 billion for Microsoft", "at
 *   Goldman"), and a range across items ("ranged from $20.0 billion at Apple to $60.0 billion");
 * - a change with only one value in the sentence ("rose 6% to $14.3 billion", "a decrease of 42%
 *   compared to 2022"), or more than one candidate value between "from" and "to";
 * - a change qualified as another measure: operational, organic, constant currency, excluding,
 *   adjusted, annualized, compound / CAGR, cumulative, per year, sequential, or year-over-year
 *   between two values that are not consecutive fiscal years, or another measure named right after
 *   the change ("up 3% in units", "a 4% increase in volume", "up 8% per unit");
 * - negative values and losses ("from a loss of $1.2 billion"), share-of figures ("45% of revenue");
 * - multiples ("4.8x", "five-fold"), "nearly doubled", bare "doubled" (imprecise by design);
 * - changes split across sentences, or stated in another item.
 */

type Scale = NonNullable<Figure['scale']>;
const FACTOR: Record<Scale, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12 };

interface Token {
  kind: 'currency' | 'percent' | 'pp';
  value: number;
  decimals: number;
  scale: Scale | null;
  /** As written, without a leading sign. */
  text: string;
  /** A "+" or "-" printed right before it. */
  sign: 1 | -1 | 0;
  /** A "~" printed right before it. */
  approx: boolean;
  at: number;
  end: number;
}

/** "2.9 pp", "290 bps", "290 basis points": a percentage-point change (bps divided by 100). */
const PP = /(?<![\d.,])(\d+(?:\.\d+)?)\s?(pp|ppts?|bps|basis points?)\b/gi;

function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const f of extractFiguresAt(text)) {
    const pp = f.kind === 'percent' && /percentage points?/i.test(f.text);
    out.push({ kind: pp ? 'pp' : f.kind, value: f.value, decimals: f.decimals, scale: f.scale, text: f.text, sign: 0, approx: false, at: f.at, end: f.end });
  }
  for (const m of text.matchAll(PP)) {
    if (out.some((t) => m.index < t.end && t.at < m.index + m[0].length)) continue;
    const bps = /^b/i.test(m[2]!);
    const decimals = (m[1]!.split('.')[1]?.length ?? 0) + (bps ? 2 : 0);
    out.push({ kind: 'pp', value: Number(m[1]) / (bps ? 100 : 1), decimals, scale: null, text: m[0], sign: 0, approx: false, at: m.index, end: m.index + m[0].length });
  }
  out.sort((a, b) => a.at - b.at);
  // A sign or "~" right before a token, itself not glued to a word or digit ("11–22%" is a range, not "-22%").
  for (const t of out) {
    const before = text.slice(Math.max(0, t.at - 2), t.at);
    const m = /(^|[^\w.,%])([+\-−~])$/.exec(before) ?? (t.at <= 1 ? /^()([+\-−~])$/.exec(before) : null);
    if (!m) continue;
    if (m[2] === '~') t.approx = true;
    else t.sign = m[2] === '+' ? 1 : -1;
    t.at -= 1;
  }
  return out;
}

/**
 * The sentence with every token replaced by `⟦i⟧`, so the forms can be read as patterns. The
 * marker characters are stripped from the sentence first (`arithmeticClaimsIn`), so a literal
 * "⟦9⟧" in model text can never be read as a token index.
 */
function skeletonOf(text: string, tokens: readonly Token[]): string {
  let out = '';
  let pos = 0;
  tokens.forEach((t, i) => {
    out += `${text.slice(pos, t.at)}⟦${i}⟧`;
    pos = t.end;
  });
  return out + text.slice(pos);
}

const T = String.raw`⟦(\d+)⟧`;
const HEDGE_WORDS = String.raw`about|approximately|roughly|around|some|close to|nearly|almost|just under|just over|over|more than|at least|less than|under`;
const HEDGE = String.raw`(?:(${HEDGE_WORDS})\s+)?`;
const UP = String.raw`up|higher|rose|grew|increased|jumped|climbed|expanded|surged|rising|growing|increasing|gained`;
const DOWN = String.raw`down|lower|fell|declined|decreased|dropped|contracted|shrank|falling|declining|decreasing`;
const NOUN_UP = String.raw`increase|rise|gain|growth|jump|improvement`;
const NOUN_DOWN = String.raw`decrease|decline|drop|reduction|fall`;
/** Direction words before a change: "up", "an increase of", "rose by", "growth of". */
const DIR_BEFORE = String.raw`(?:(?:was|were)\s+)?(?:${UP}|${DOWN})(?:\s+by)?|(?:an?\s+)?(?:${NOUN_UP}|${NOUN_DOWN})\s+of|representing\s+(?:an?\s+)?(?:${NOUN_UP}|${NOUN_DOWN})\s+of`;
/** Direction words after a change: "a 36% increase". */
const DIR_AFTER = String.raw`${NOUN_UP}|${NOUN_DOWN}|higher|lower`;
/** A short stretch of words with no figure and no clause connector: a period ("in FY2024"), a measure ("of revenues"). */
const GAP = String.raw`((?:\s+(?:\((?:FY|Q[1-4]|fiscal)[^()⟦]{0,12}\)|(?!(?:and|while|but|with|which|whereas|although|as|driven|reflecting|compared|versus|vs|from|to|or)\b)[\w'’&/.-]+)){0,5}?)`;
const CHANGE = String.raw`${HEDGE}${T}`;
/** The change after a value: "(up 126%)", ", a 36% increase", ", a decrease of $842 million or 2%". */
const CHANGE_AFTER = new RegExp(String.raw`^${GAP}\s*[,(—–]?\s*(?:an?\s+)?(?:(${DIR_BEFORE})\s+)?${CHANGE}(?:\s*,?\s*or\s+${CHANGE})?(?:\s+(${DIR_AFTER}))?`, 'i');
/** The change before "from": "rose 145% from", "increased by $787 million, from". */
const CHANGE_BEFORE = new RegExp(String.raw`(?:^|\s)(${DIR_BEFORE})\s+${CHANGE}\s*,?\s*$`, 'i');
const FOLD_BEFORE = /\bmore than (doubled|tripled|quadrupled)\s*,?\s*(?:(?:rising|growing|increasing|climbing)\s+)?$/i;
const FOLD_AFTER = new RegExp(String.raw`^${GAP}\s*,\s*more than (doubling|tripling|quadrupling)\b`, 'i');
const FOLD: Record<string, number> = { doubl: 2, tripl: 3, quadrupl: 4 };
const foldOf = (word: string) => FOLD[word.toLowerCase().replace(/(?:ed|ing)$/, '')] ?? null;

/** Another measure than the plain change between the two values: never compared. */
const OTHER_MEASURE = new RegExp(
  [
    String.raw`\b(?:operational(?:ly)?|organic(?:ally)?|constant[- ]currency|currency[- ]neutral|excluding|ex-|adjusted|annuali[sz]ed|annual (?:growth|rate)|annually|compound(?:ed)?|CAGR|cumulative|per (?:year|annum)|a year(?! ago)|like-for-like|sequential(?:ly)?|on an? [\w-]+ basis)\b`,
    // Currency-adjusted and other restated measures (M1, 2026-10-03 review).
    String.raw`\blocal currenc(?:y|ies)\b|\(cc\b|\b(?:constant|fixed) (?:exchange rates?|currency)\b|\bnet of (?:foreign )?currency\b|\bFX[- ]neutral\b|\bex-?FX\b|\bpro[- ]forma\b|\b(?:including|excluding) acquisitions?\b`,
    // Another base: per share, a part of the span ("alone"), or a span of several years.
    String.raw`\bper (?:diluted |basic )?share\b|\balone\b|\bover (?:the (?:past|last) )?(?:two|three|four|five|\d+) (?:fiscal )?years\b|\b(?:two|three|four|five|multi)-year\b`,
  ].join('|'),
  'i',
);
/**
 * Words right after a change that tie it to something other than the two values (M1): a period
 * inside the span ("up 21% in Q4", "in the fourth quarter", "in the second half", "in the latest
 * year", "in 2025"), or a part of the whole ("up 33% in Azure", a capitalised segment name).
 */
const CHANGE_QUALIFIER = new RegExp(
  [
    String.raw`^\s*(?:in|for|during)\s+(?:the\s+)?(?:(?:latest|most recent|last|final|first|second|third|fourth|current|prior|same)\s+(?:fiscal\s+)?(?:year|quarter|half|period|months?)\b|Q[1-4]\b|H[12]\b|(?:FY\s?|fiscal\s+(?:year\s+)?)?(?:19|20)\d{2}\b|[A-Z][\w&-]*)`,
    // Another measure named right after the change, also after "increase" / "decrease": "up 3% in units", "a 4% increase in volume",
    // "up 8% per unit", "a 2% increase in gross margin". A period word ("in the year", "per quarter") keeps the handling above.
    String.raw`^\s*(?:(?:${DIR_AFTER})\s+)?(?:in|per)\s+(?!(?:the|a|an|fiscal|full|each|every)\b)(?!(?:years?|quarters?|half|halves|periods?|months?)\b)[a-z]`,
  ].join('|'),
);
const YEAR_OVER_YEAR = /\b(?:year[- ](?:over|on)[- ]year|yoy|y\/y|from a year ago|prior[- ]year (?:period|quarter))\b/i;

interface Change {
  token: Token;
  hedge: string | null;
  dir: 1 | -1 | 0;
}
interface Pair {
  x: Token;
  y: Token;
  /** The hedge words printed before each value ("from about $5.0 billion to over $6.5 billion"). */
  xHedge?: string | undefined;
  yHedge?: string | undefined;
  changes: Change[];
  fold: number | null;
  /** The sentence text the pair and its change span, for the measure and period guards. */
  span: string;
  /** "from X to Y": a year-over-year change may be about other periods than X and Y. The other forms tie the change to X. */
  fromTo?: boolean;
}

const dirOf = (words: string | undefined): 1 | -1 | 0 => {
  if (!words) return 0;
  if (new RegExp(String.raw`\b(?:${DOWN}|${NOUN_DOWN})\b`, 'i').test(words)) return -1;
  if (new RegExp(String.raw`\b(?:${UP}|${NOUN_UP})\b`, 'i').test(words)) return 1;
  return 0;
};

/**
 * The token a skeleton marker names. Every marker is one `skeletonOf` wrote (the sentence's own
 * marker characters are stripped first), so a miss is a bug: it throws, and `validateBrief` turns
 * any throw into an empty list and a content-free notice (H2), never a failed analysis.
 */
function tokenAt(tokens: readonly Token[], index: string | undefined): Token {
  const t = tokens[Number(index)];
  if (!t) throw new RangeError('arithmetic check: a skeleton marker names no token');
  return t;
}

/** The changes a CHANGE_AFTER / CHANGE_BEFORE match states (one, or two joined by "or"). */
function changesFrom(m: RegExpExecArray, tokens: readonly Token[], dirBefore: number, hedge1: number, tok1: number, hedge2: number | null, tok2: number | null, dirAfter: number | null): Change[] {
  const dir = dirOf(m[dirBefore]) || (dirAfter !== null ? dirOf(m[dirAfter]) : 0);
  const out: Change[] = [];
  const add = (h: number, t: number) => {
    const token = tokenAt(tokens, m[t]);
    out.push({ token, hedge: m[h]?.toLowerCase() ?? (token.approx ? 'about' : null), dir: dir || token.sign });
  };
  add(hedge1, tok1);
  if (hedge2 !== null && tok2 !== null && m[tok2] !== undefined) add(hedge2, tok2);
  // A figure with no direction word and no sign is a share or a level ("45% of revenue"), not a change.
  return out.filter((c) => c.dir !== 0);
}

/** The change stated right after a value at `pos` in the skeleton, if any. */
function changeAfter(sk: string, pos: number, tokens: readonly Token[]): { changes: Change[]; end: number; fold: number | null; gap: string } {
  const rest = sk.slice(pos);
  const fold = FOLD_AFTER.exec(rest);
  if (fold) return { changes: [], end: pos + fold[0].length, fold: foldOf(fold[2]!), gap: fold[1] ?? '' };
  const m = CHANGE_AFTER.exec(rest);
  if (!m) return { changes: [], end: pos, fold: null, gap: '' };
  // Groups: 1 gap, 2 dir before, 3 hedge, 4 token, 5 hedge, 6 token, 7 dir after.
  if (/\bof\s*$/i.test(m[1] ?? '') && !m[2]) return { changes: [], end: pos, fold: null, gap: '' };
  const after = rest.slice(m[0].length);
  if (!m[2] && !m[7] && /^\s+of\b/i.test(after)) return { changes: [], end: pos, fold: null, gap: '' };
  return { changes: changesFrom(m, tokens, 2, 3, 4, 5, 6, 7), end: pos + m[0].length, fold: null, gap: m[1] ?? '' };
}

/**
 * Whether a short stretch between a value and its partner ties the value to a company: "$281.7
 * billion for Microsoft", "69.8% at Microsoft", "at Goldman". Two companies' values side by side are
 * a comparison, not a change, so the pair is never compared. Periods and dates ("for FY2024", "at
 * December 31") are not companies.
 */
const COMPANY_AFTER = /\b(?:at|for|of)\s+(?:the\s+)?(?!FY|Q[1-4]|H[12])(?!(?:Fiscal|Year|Quarter|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b)[A-Z]/;
const namesCompany = (gap: string | undefined) => !!gap && (COMPANY_AFTER.test(gap) || mentionsIn(gap, new Set()).length > 0);
/** "ranged from X to Y", "spanning from X to Y", "between … from X to Y": a range across items, not a change. */
const RANGE_BEFORE = /\b(?:rang(?:e|es|ed|ing)|spann?(?:s|ed|ing)?|between)\b[^⟦]{0,40}$/i;
/** The hedge word right before a position in the skeleton ("about ⟦3⟧"), for a value whose form starts at the value itself. */
const HEDGE_BEFORE = new RegExp(String.raw`(?:^|\s)(${HEDGE_WORDS})\s+$`, 'i');
const hedgeBefore = (sk: string, at: number) => HEDGE_BEFORE.exec(sk.slice(Math.max(0, at - 20), at))?.[1];

/** Words that may stand between a chained value and its change: a period, never a new measure ("in net income"). */
const PERIOD_WORD = /^(?:in|for|during|the|fiscal|full|year|years|quarter|FY\s?'?\d{0,4}(?:Q[1-4])?|Q[1-4]|(?:19|20)\d{2})$/i;
const onlyPeriodWords = (gap: string) => gap.split(/[\s()]+/).filter(Boolean).every((w) => PERIOD_WORD.test(w.replace(/[.,'’-]+$/, '')));

function pairsIn(sk: string, tokens: readonly Token[]): Pair[] {
  const pairs: Pair[] = [];
  const tok = (s: string) => tokenAt(tokens, s);
  // The span a pair's guards read: the pair and its change, plus what follows the change up to the next figure or clause break ("(up 56% year-on-year)").
  const spanOf = (from: number, to: number) => sk.slice(Math.max(0, from), to) + (/^[^⟦,;)]{0,40}/.exec(sk.slice(to))?.[0] ?? '');

  // "from X … to Y", with the change before "from" or after Y, and its chain.
  for (const m of sk.matchAll(new RegExp(String.raw`\bfrom\s+${HEDGE}${T}${GAP}\s+to\s+${HEDGE}${T}`, 'gi'))) {
    const x = tok(m[2]!);
    let y = tok(m[5]!);
    let yHedge = m[4];
    const before = sk.slice(Math.max(0, m.index - 80), m.index);
    const cb = CHANGE_BEFORE.exec(before);
    const foldBefore = FOLD_BEFORE.exec(before);
    const after = changeAfter(sk, m.index + m[0].length, tokens);
    // A range across items ("ranged from $20.0 billion at Apple to $60.0 billion at Amazon") or two companies' values is not a change.
    if (RANGE_BEFORE.test(before) || namesCompany(m[3]) || namesCompany(after.gap)) continue;
    const changes = [...(cb ? changesFrom(cb, tokens, 1, 2, 3, 2, null, null) : []), ...after.changes];
    const fold = foldBefore ? foldOf(foldBefore[1]!) : after.fold;
    pairs.push({ x, y, xHedge: m[1], yHedge, changes, fold, span: spanOf(m.index - (cb ? cb[0].length : 0), after.end), fromTo: true });
    // The chain: "… (up 126%) and (then) (to) W (up 114%)".
    let end = after.end;
    for (;;) {
      const c = new RegExp(String.raw`^\s*\)?\s*,?\s*(?=(?:and|then|to)\b)(?:and\s+)?(?:then\s+)?(?:further\s+)?(?:to\s+)?${HEDGE}${T}`, 'i').exec(sk.slice(end));
      if (!c) break;
      const w = tok(c[2]!);
      const next = changeAfter(sk, end + c[0].length, tokens);
      // A chain into another measure ("… and $29.76 billion in net income (up 581%)") is not a step of this one.
      if (!onlyPeriodWords(next.gap)) break;
      pairs.push({ x: y, y: w, xHedge: yHedge, yHedge: c[1], changes: next.changes, fold: next.fold, span: spanOf(end, next.end), fromTo: true });
      y = w;
      yHedge = c[1];
      end = next.end;
    }
  }
  // "rose Z% to Y from X".
  for (const m of sk.matchAll(new RegExp(String.raw`(?:^|\s)(${DIR_BEFORE})\s+${CHANGE}\s+to\s+${HEDGE}${T}${GAP}\s*,?\s*from\s+${HEDGE}${T}`, 'gi'))) {
    if (namesCompany(m[6])) continue;
    const changes = changesFrom(m as RegExpExecArray, tokens, 1, 2, 3, 2, null, null);
    pairs.push({ x: tok(m[8]!), y: tok(m[5]!), xHedge: m[7], yHedge: m[4], changes, fold: null, span: spanOf(m.index, m.index + m[0].length) });
  }
  // "Y (in P), up Z% from X" (also "over", "versus", "compared with").
  for (const m of sk.matchAll(
    new RegExp(String.raw`${T}${GAP}\s*[,(—–]?\s*(?:an?\s+)?(${DIR_BEFORE})\s+${CHANGE}(?:\s*,?\s*or\s+${CHANGE})?\s+(?:from|over|versus|vs\.?|compared\s+(?:with|to))\s+${HEDGE}${T}`, 'gi'),
  )) {
    if (namesCompany(m[2])) continue;
    const changes = changesFrom(m as RegExpExecArray, tokens, 3, 4, 5, 6, 7, null);
    pairs.push({ x: tok(m[9]!), y: tok(m[1]!), xHedge: m[8], yHedge: hedgeBefore(sk, m.index), changes, fold: null, span: spanOf(m.index, m.index + m[0].length) });
  }
  // "Y versus X …, a decrease of $D or Z%".
  for (const m of sk.matchAll(new RegExp(String.raw`${T}${GAP}\s*,?\s*(?:versus|vs\.?|compared\s+(?:with|to))\s+${HEDGE}${T}`, 'gi'))) {
    const after = changeAfter(sk, m.index + m[0].length, tokens);
    // "$416.2 billion versus $281.7 billion for Microsoft": two companies side by side, not a change.
    if (namesCompany(m[2]) || namesCompany(after.gap)) continue;
    if (after.changes.length) pairs.push({ x: tok(m[4]!), y: tok(m[1]!), xHedge: m[3], yHedge: hedgeBefore(sk, m.index), changes: after.changes, fold: null, span: spanOf(m.index, after.end) });
  }
  return pairs;
}

const half = (t: Token) => 0.5 * 10 ** -t.decimals;
const scaleOf = (t: Token, partner: Token): Scale | null => t.scale ?? partner.scale;
/**
 * A value as an interval at its printed precision and hedge, in absolute units (currency) or
 * points (percent): "about / approximately / ~" ±10%, "nearly / almost" 80–100%, "over / more than"
 * a lower bound, "less than / under" an upper bound.
 */
function interval(t: Token, scale: Scale | null, hedgeWord: string | undefined): [number, number] {
  const f = scale ? FACTOR[scale] : 1;
  const v = t.value * f;
  const h = half(t) * f;
  switch (hedgeWord?.toLowerCase() ?? (t.approx ? 'about' : null)) {
    case 'about':
    case 'approximately':
    case 'roughly':
    case 'around':
    case 'some':
    case 'close to': {
      const w = Math.max(h, 0.1 * v);
      return [v - w, v + w];
    }
    case 'nearly':
    case 'almost':
    case 'just under':
      return [0.8 * v, v + h];
    case 'over':
    case 'more than':
    case 'at least':
    case 'just over':
      return [v - h, Number.POSITIVE_INFINITY];
    case 'less than':
    case 'under':
      return [0, v + h];
    default:
      return [v - h, v + h];
  }
}

/** The stated change as an interval of magnitudes, from its printed precision and hedge. */
function statedRange(c: Change, value: number, h: number): [number, number] {
  switch (c.hedge) {
    case 'about':
    case 'approximately':
    case 'roughly':
    case 'around':
    case 'some':
    case 'close to': {
      const w = Math.max(h, 0.1 * Math.abs(value));
      return [value - w, value + w];
    }
    case 'nearly':
    case 'almost':
    case 'just under':
      return [0.8 * value, value + h];
    case 'over':
    case 'more than':
    case 'at least':
    case 'just over':
      return [value - h, Number.POSITIVE_INFINITY];
    case 'less than':
    case 'under':
      return [0, value + h];
    default:
      return [value - h, value + h];
  }
}

const EPS = 1e-9;
/** Whether the computed (signed) interval can give the stated change. */
function agrees(computed: [number, number], c: Change, value: number, h: number): boolean {
  const [lo, hi] = statedRange(c, value, h);
  if (c.dir !== 0) {
    const [a, b] = c.dir > 0 ? [lo, hi] : [-hi, -lo];
    return computed[1] >= a - EPS && computed[0] <= b + EPS;
  }
  const mag: [number, number] = computed[0] >= 0 ? computed : computed[1] <= 0 ? [-computed[1], -computed[0]] : [0, Math.max(-computed[0], computed[1])];
  return mag[1] >= lo - EPS && mag[0] <= hi + EPS;
}

const signed = (v: number, d: number) => `${v >= 0 ? '+' : '-'}${Math.abs(v).toFixed(d)}`;
const SCALE_WORD: Record<Scale, string> = { thousand: 'thousand', million: 'million', billion: 'billion', trillion: 'trillion' };

/** The fiscal years named in a span ("FY2024", "fiscal 2025"), and whether it names a quarter. */
function periodsOf(span: string): { years: number[]; quarter: boolean } {
  const years = [...span.matchAll(/\b(?:FY\s?|fiscal\s+(?:year\s+)?)(\d{4})\b/gi)].map((m) => Number(m[1]));
  return { years, quarter: /\bQ[1-4]\b|\bquarter\b|\bmonths\b/i.test(span) };
}

/**
 * The period granularity a value is stated at, from the words right after it up to the next
 * figure or clause break ("$130.5 billion in FY2025" → year; "$44.1 billion in Q1 FY2026" →
 * quarter); null when none is named.
 */
function granularityAfter(sk: string, tokenIndex: number): 'quarter' | 'year' | null {
  const marker = `⟦${tokenIndex}⟧`;
  const at = sk.indexOf(marker);
  if (at < 0) return null;
  const tail = /^[^⟦,;()]{0,40}/.exec(sk.slice(at + marker.length))?.[0] ?? '';
  if (/\bQ[1-4]\b|\bquarters?\b|\bmonths?\b|\bhalf\b|\bH[12]\b/i.test(tail)) return 'quarter';
  if (/\bFY\s?\d{2,4}\b|\bfiscal\b|\b(?:19|20)\d{2}\b|\byear\b/i.test(tail)) return 'year';
  return null;
}

/** One pair's verdict: null when it agrees (or is not comparable), else the claim to flag. */
function check(p: Pair, sk: string, tokens: readonly Token[]): Omit<ArithmeticClaim, 'location'> | null {
  if (OTHER_MEASURE.test(p.span)) return null;
  // Two values at different period granularity (a fiscal year and a quarter) are not one change (H3).
  const gx = granularityAfter(sk, tokens.indexOf(p.x));
  const gy = granularityAfter(sk, tokens.indexOf(p.y));
  if (gx && gy && gx !== gy) return null;
  // A change qualified right after it ("up 21% in Q4", "up 33% in Azure") is about part of the span.
  for (const c of p.changes) {
    const marker = `⟦${tokens.indexOf(c.token)}⟧`;
    const at = sk.indexOf(marker);
    if (at >= 0 && CHANGE_QUALIFIER.test(sk.slice(at + marker.length))) return null;
  }
  if (p.fromTo && YEAR_OVER_YEAR.test(p.span)) {
    // A year-over-year change is the change between the two values only when they are consecutive fiscal years.
    const { years, quarter } = periodsOf(p.span);
    if (quarter || years.length !== 2 || Math.abs(years[1]! - years[0]!) !== 1) return null;
  }
  const { x, y } = p;
  if (x.sign < 0 || y.sign < 0 || x.kind !== y.kind || x.kind === 'pp') return null;
  if (/\bloss(?:es)?\b|\bdeficit\b|\bnegative\b/i.test(p.span)) return null;
  const sx = x.kind === 'currency' ? scaleOf(x, y) : null;
  const sy = y.kind === 'currency' ? scaleOf(y, x) : null;
  const X = interval(x, sx, p.xHedge);
  const Y = interval(y, sy, p.yHedge);
  if (X[0] <= 0 || Y[0] < 0) return null;
  const rel: [number, number] = [(Y[0] / X[1] - 1) * 100, (Y[1] / X[0] - 1) * 100];
  const diff: [number, number] = [Y[0] - X[1], Y[1] - X[0]];
  const xMid = x.value * (sx ? FACTOR[sx] : 1);
  const yMid = y.value * (sy ? FACTOR[sy] : 1);
  const base = { from: x.text, to: y.text };

  if (p.fold !== null) {
    const ratio: [number, number] = [Y[0] / X[1], Y[1] / X[0]];
    if (ratio[1] <= p.fold + EPS) return { ...base, stated: `more than ${p.fold === 2 ? 'doubled' : p.fold === 3 ? 'tripled' : 'quadrupled'}`, computed: `x${(yMid / xMid).toFixed(2)}` };
  }
  for (const c of p.changes) {
    const t = c.token;
    const h = half(t);
    const stated = `${t.sign ? (t.sign > 0 ? '+' : '-') : c.dir > 0 ? 'up ' : 'down '}${c.hedge && !t.approx ? `${c.hedge} ` : t.approx ? '~' : ''}${t.text}`;
    if (x.kind === 'currency') {
      if (t.kind === 'percent') {
        if (!agrees(rel, c, t.value, h)) return { ...base, stated, computed: `${signed((yMid / xMid - 1) * 100, t.decimals)}%` };
      } else if (t.kind === 'currency') {
        // The change needs its own scale word when the values have one: "$787" against millions is not read.
        if (!t.scale && (sx || sy)) continue;
        const f = t.scale ? FACTOR[t.scale] : 1;
        const absolute: [number, number] = [diff[0] / f, diff[1] / f];
        if (!agrees(absolute, c, t.value, h)) return { ...base, stated, computed: `${(yMid - xMid) / f >= 0 ? '+' : '-'}$${Math.abs((yMid - xMid) / f).toFixed(t.decimals)}${t.scale ? ` ${SCALE_WORD[t.scale]}` : ''}` };
      }
    } else if (t.kind === 'pp') {
      if (!agrees(diff, c, t.value, h)) return { ...base, stated, computed: `${signed(yMid - xMid, t.decimals)} pp` };
    } else if (t.kind === 'percent') {
      // A "%" change on two percentages: either reading passes (relative change, or points).
      if (!agrees(rel, c, t.value, h) && !agrees(diff, c, t.value, h)) return { ...base, stated, computed: `${signed((yMid / xMid - 1) * 100, t.decimals)}% (${signed(yMid - xMid, t.decimals)} pp)` };
    }
  }
  return null;
}

/** The change claims in a piece of text whose own values do not give the stated change, in text order. */
export function arithmeticClaimsIn(text: string): Array<Omit<ArithmeticClaim, 'location'>> {
  const out: Array<Omit<ArithmeticClaim, 'location'>> = [];
  for (const raw of sentencesOf(text)) {
    // The skeleton's marker characters are removed from the text (same length, so token offsets hold): a literal "⟦9⟧" is never a token reference.
    const s = raw.replace(/[⟦⟧]/g, ' ');
    const tokens = tokensOf(s);
    if (tokens.length < 2) continue;
    const sk = skeletonOf(s, tokens);
    const seen = new Set<string>();
    for (const p of pairsIn(sk, tokens)) {
      const key = `${p.x.at}-${p.y.at}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const claim = check(p, sk, tokens);
      if (claim) out.push(claim);
    }
  }
  return out;
}

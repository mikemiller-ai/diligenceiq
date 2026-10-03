import type { Catalog } from './catalog';

/**
 * Deterministic company detection (SPEC §26.1; architecture §6.5; assumptions C3). No model.
 *
 * Aliases come from the filing headers (the legal name and the name with its corporate suffix
 * stripped, "Apple Inc" → "Apple"; tickers) plus a small curated list (Google → GOOG,
 * Facebook → META, JPMorgan / JP Morgan / Chase → JPM, J&J → JNJ, Coke → KO, Exxon → XOM,
 * Lilly → LLY, …).
 *
 * Collision rules (C3):
 * - Names that are ordinary English words (`COMMON_WORD_NAMES`: Target, Visa, Oracle, Meta,
 *   Apple, Caterpillar, …) match only case-sensitively, as written ("Apple") or in capitals
 *   ("APPLE"), and never when glued to a hyphen ("Meta-analysis"). The list is limited to
 *   genuine English words or given names (SPEC §26.1); brand-only names (Tesla, Google,
 *   Boeing, Nike, …) are case-insensitive, so "tesla and google" matches.
 * - Other names match case-insensitively ("nvidia", "JPMORGAN").
 * - Tickers match only as UPPERCASE standalone tokens: not adjacent to a letter, digit, `-`,
 *   `&`, `.` or apostrophe ("a T-shaped team", "AT&T", "ms. smith" do not match T or MS),
 *   except a possessive "'s" / "’s" ("NVDA's", "MSFT’s").
 * - Overlapping matches: the longest wins ("Bank of America" over a shorter alias inside it).
 *
 * Known limitation: a common-word name at the start of a sentence ("Target markets …") still
 * matches, because capitalization is the only signal. The Interpretation panel shows every
 * detected company, so a wrong match is visible and the user's filters override it.
 */

/**
 * Names that are ordinary English words (or a given name): case-sensitive (C3). Lowercase form.
 * Each is a word a question can use in its ordinary sense: "apple supply", "target market",
 * "visa requirements", "the oracle of", "meta-analysis", "caterpillar tracks", "the amazon
 * rainforest", "chase growth", "competitive intel" (common English for intelligence), "petroleum
 * coke", "the alphabet", "chevron pattern", "lilly" (a given name). Brand-only names (Tesla,
 * Google, Boeing, Starbucks, Mastercard, Comcast, Merck, Deere, Nike) are not on the list.
 */
export const COMMON_WORD_NAMES = new Set([
  'apple', 'target', 'visa', 'oracle', 'meta', 'caterpillar', 'amazon', 'chase', 'intel', 'chevron', 'coke', 'lilly', 'alphabet',
]);

/** Curated aliases beyond the header-derived ones (SPEC §26.1). */
export const CURATED_ALIASES: Readonly<Record<string, readonly string[]>> = {
  AMZN: ['Amazon'],
  BRK: ['Berkshire'],
  COST: ['Costco'],
  CSCO: ['Cisco'],
  DIS: ['Disney'],
  GE: ['General Electric', 'GE Capital'],
  GOOG: ['Google', 'Alphabet'],
  GS: ['Goldman'],
  JNJ: ['J&J', 'Johnson and Johnson'],
  JPM: ['JPMorgan', 'JP Morgan', 'J.P. Morgan', 'Chase'],
  KO: ['Coke', 'Coca Cola'],
  LLY: ['Lilly'],
  MA: ['MasterCard'],
  MCD: ["McDonald's", 'McDonald’s'],
  META: ['Meta', 'Facebook'],
  PEP: ['Pepsi'],
  PG: ['P&G', 'Procter and Gamble'],
  RTX: ['Raytheon'],
  TMO: ['Thermo Fisher'],
  UNH: ['UnitedHealthcare', 'United Health'],
  UPS: ['United Parcel'],
  VZ: ['Verizon'],
  WMT: ['Wal-Mart'],
  XOM: ['Exxon', 'ExxonMobil'],
  AMD: ['Advanced Micro Devices'],
  IBM: ['International Business Machines'],
  BAC: ['BofA'],
  NVDA: ['Nvidia'],
};

const SUFFIX = /(?:\s*,)?\s+(?:Inc|Incorporated|Corporation|Corp|Company|Co|Group|Holdings|Ltd|LLC|plc|Platforms|Wholesale|Systems|Communications)\.?$/i;

/** "Apple Inc" → "Apple"; "Eli Lilly and Company" → "Eli Lilly"; "JPMorgan Chase & Co" → "JPMorgan Chase". */
export function stripCorporateSuffix(name: string): string {
  let n = name.replace(/\s*\([^)]*\)\s*$/, '').replace(/^The\s+/i, '').trim();
  for (let i = 0; i < 4; i++) {
    const next = n.replace(SUFFIX, '').replace(/\s*(?:&|and)\s*$/i, '').trim();
    if (next === n) break;
    n = next;
  }
  return n;
}

export interface Alias {
  ticker: string;
  text: string;
  kind: 'name' | 'ticker';
}

export function buildAliases(catalog: { companies: ReadonlyArray<Pick<Catalog['companies'][number], 'ticker' | 'company'>> }): Alias[] {
  const out: Alias[] = [];
  const seen = new Set<string>();
  const add = (ticker: string, text: string, kind: Alias['kind']) => {
    const t = text.trim();
    if (t.length < 2 && kind === 'name') return;
    const key = `${ticker}|${kind}|${t.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ticker, text: t, kind });
  };
  for (const co of catalog.companies) {
    add(co.ticker, co.ticker, 'ticker');
    add(co.ticker, co.company, 'name');
    add(co.ticker, co.company.replace(/^The\s+/i, ''), 'name');
    add(co.ticker, stripCorporateSuffix(co.company), 'name');
    for (const a of CURATED_ALIASES[co.ticker] ?? []) add(co.ticker, a, 'name');
  }
  return out;
}

export interface CompanyMatch {
  ticker: string;
  text: string;
  start: number;
  end: number;
  kind: Alias['kind'];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
/** Not adjacent to a letter, digit, hyphen, ampersand, dot or apostrophe (C3 ticker rule). */
const TICKER_LEFT = "(?<![A-Za-z0-9\\-&.'’])";
/** A possessive "'s" / "’s" is allowed ("NVDA's"); any other apostrophe, letter, digit, `-`, `&` or `.x` is not. */
const TICKER_RIGHT = "(?:(?=['’]s(?![A-Za-z0-9]))|(?![A-Za-z0-9\\-&'’]|\\.[A-Za-z0-9]))";

function aliasRegex(a: Alias): RegExp {
  if (a.kind === 'ticker') return new RegExp(`${TICKER_LEFT}${escape(a.text)}${TICKER_RIGHT}`, 'g');
  const body = escape(a.text);
  const left = '(?<![A-Za-z0-9])';
  // A name may be followed by a possessive or punctuation, never by more letters.
  const right = '(?![A-Za-z0-9])';
  if (COMMON_WORD_NAMES.has(a.text.toLowerCase())) {
    // Case-sensitive as written or in capitals, and never glued to a hyphen ("Meta-analysis").
    return new RegExp(`${left}(?:${body}|${escape(a.text.toUpperCase())})${right}(?!-[A-Za-z])`, 'g');
  }
  return new RegExp(`${left}${body}${right}`, 'gi');
}

export class CompanyMatcher {
  private readonly patterns: Array<{ alias: Alias; re: RegExp }>;

  constructor(aliases: readonly Alias[]) {
    this.patterns = aliases.map((alias) => ({ alias, re: aliasRegex(alias) }));
  }

  /** All matches, longest first among overlaps, in text order. */
  match(text: string): CompanyMatch[] {
    const found: CompanyMatch[] = [];
    for (const { alias, re } of this.patterns) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        found.push({ ticker: alias.ticker, text: m[0], start: m.index, end: m.index + m[0].length, kind: alias.kind });
      }
    }
    found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
    const kept: CompanyMatch[] = [];
    for (const m of found) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
    return kept.sort((a, b) => a.start - b.start);
  }

  /**
   * Common-word names written in lowercase ("apple, nvidia, microsoft") that are read as
   * ordinary words, not as the company. Reported so the Interpretation panel can say so.
   */
  lowercaseCommonWords(text: string): Array<{ word: string; ticker: string; name: string }> {
    const out: Array<{ word: string; ticker: string; name: string }> = [];
    for (const { alias } of this.patterns) {
      if (alias.kind !== 'name' || !COMMON_WORD_NAMES.has(alias.text.toLowerCase())) continue;
      const lower = alias.text.toLowerCase();
      if (new RegExp(`(?<![A-Za-z0-9])${escape(lower)}(?![A-Za-z0-9-])`).test(text) && !out.some((o) => o.word === lower)) {
        out.push({ word: lower, ticker: alias.ticker, name: alias.text });
      }
    }
    return out;
  }

  /** Distinct tickers in order of first mention. */
  tickers(text: string): string[] {
    return [...new Set(this.match(text).map((m) => m.ticker))];
  }
}

/**
 * Well-known companies that are NOT in the corpus, so a question about one gets a stated gap
 * instead of "no company named" (M4). Deliberately conservative: a curated list (every entry is
 * truly absent from the corpus, so the gap is never false, at worst irrelevant) plus an explicit
 * corporate suffix ("Acme Corp", "Rivian Automotive Inc"). Words that are also ordinary English
 * (Ford, Shell, Lucid) are case-sensitive; acronyms (GM, BP, CVS, …) match only in capitals as
 * standalone tokens. Never a model call.
 */
export const NON_CORPUS_COMPANIES: ReadonlyArray<{ name: string; aliases: readonly string[]; caseSensitive?: boolean }> = [
  { name: 'Ford', aliases: ['Ford', 'Ford Motor'], caseSensitive: true },
  { name: 'General Motors', aliases: ['General Motors', 'GM'], caseSensitive: true },
  { name: 'Toyota', aliases: ['Toyota'] },
  { name: 'Honda', aliases: ['Honda'] },
  { name: 'Volkswagen', aliases: ['Volkswagen'] },
  { name: 'Stellantis', aliases: ['Stellantis'] },
  { name: 'Rivian', aliases: ['Rivian'] },
  { name: 'Lucid', aliases: ['Lucid Motors', 'Lucid Group'], caseSensitive: true },
  { name: 'BYD', aliases: ['BYD'], caseSensitive: true },
  { name: 'Samsung', aliases: ['Samsung'] },
  { name: 'Sony', aliases: ['Sony'] },
  { name: 'Shell', aliases: ['Shell'], caseSensitive: true },
  { name: 'BP', aliases: ['BP'], caseSensitive: true },
  { name: 'ConocoPhillips', aliases: ['ConocoPhillips'] },
  { name: 'Alibaba', aliases: ['Alibaba'] },
  { name: 'Tencent', aliases: ['Tencent'] },
  { name: 'Huawei', aliases: ['Huawei'] },
  { name: 'TSMC', aliases: ['TSMC', 'Taiwan Semiconductor'], caseSensitive: true },
  { name: 'Qualcomm', aliases: ['Qualcomm'] },
  { name: 'Broadcom', aliases: ['Broadcom'] },
  { name: 'Micron', aliases: ['Micron'] },
  { name: 'Uber', aliases: ['Uber'] },
  { name: 'Lyft', aliases: ['Lyft'] },
  { name: 'Airbnb', aliases: ['Airbnb'] },
  { name: 'Spotify', aliases: ['Spotify'] },
  { name: 'PayPal', aliases: ['PayPal'] },
  { name: 'Palantir', aliases: ['Palantir'] },
  { name: 'Wells Fargo', aliases: ['Wells Fargo'] },
  { name: 'Citigroup', aliases: ['Citigroup', 'Citibank'] },
  { name: 'Charles Schwab', aliases: ['Charles Schwab'] },
  { name: 'Moderna', aliases: ['Moderna'] },
  { name: 'AstraZeneca', aliases: ['AstraZeneca'] },
  { name: 'Novartis', aliases: ['Novartis'] },
  { name: 'Roche', aliases: ['Roche'] },
  { name: 'Sanofi', aliases: ['Sanofi'] },
  { name: 'GSK', aliases: ['GSK', 'GlaxoSmithKline'], caseSensitive: true },
  { name: 'Novo Nordisk', aliases: ['Novo Nordisk'] },
  { name: 'Bristol-Myers Squibb', aliases: ['Bristol-Myers Squibb', 'Bristol-Myers', 'Bristol Myers'] },
  { name: 'Amgen', aliases: ['Amgen'] },
  { name: 'Gilead', aliases: ['Gilead'] },
  { name: 'CVS', aliases: ['CVS'], caseSensitive: true },
  { name: 'Walgreens', aliases: ['Walgreens'] },
  { name: 'Humana', aliases: ['Humana'] },
  { name: 'Cigna', aliases: ['Cigna'] },
  { name: 'FedEx', aliases: ['FedEx'] },
  { name: 'Northrop Grumman', aliases: ['Northrop Grumman', 'Northrop'] },
  { name: 'General Dynamics', aliases: ['General Dynamics'] },
  { name: 'Kroger', aliases: ['Kroger'] },
  { name: 'Chipotle', aliases: ['Chipotle'] },
  { name: 'T-Mobile', aliases: ['T-Mobile'] },
  { name: 'Twitter', aliases: ['Twitter'] },
  { name: 'OpenAI', aliases: ['OpenAI'] },
];

const NON_CORPUS_PATTERNS = NON_CORPUS_COMPANIES.flatMap((c) =>
  c.aliases.map((a) => ({
    name: c.name,
    re: /^[A-Z]{2,5}$/.test(a)
      ? new RegExp(`${TICKER_LEFT}${escape(a)}${TICKER_RIGHT}`, 'g')
      : new RegExp(`(?<![A-Za-z0-9])${escape(a)}(?![A-Za-z0-9])`, c.caseSensitive ? 'g' : 'gi'),
  })),
);
/** "Acme Corp", "Rivian Automotive Inc.": capitalized words before an explicit corporate suffix. */
const SUFFIXED_NAME = /(?<![A-Za-z0-9])((?:[A-Z][A-Za-z0-9&'.-]*\s+){1,4})(?:Inc|Incorporated|Corp|Corporation|Ltd|plc|LLC)\b\.?/g;

/**
 * Likely company mentions that are not in the corpus. Spans that overlap a corpus company match
 * are ignored ("Apple Inc" is Apple). Distinct names in order of first mention.
 */
export function findNonCorpusCompanies(text: string, corpusMatches: readonly CompanyMatch[]): string[] {
  const found: Array<{ name: string; start: number; end: number }> = [];
  const free = (start: number, end: number) =>
    !corpusMatches.some((m) => start < m.end && m.start < end) && !found.some((f) => start < f.end && f.start < end);
  for (const { name, re } of NON_CORPUS_PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) if (free(m.index, m.index + m[0].length)) found.push({ name, start: m.index, end: m.index + m[0].length });
  }
  SUFFIXED_NAME.lastIndex = 0;
  for (const m of text.matchAll(SUFFIXED_NAME)) {
    const name = m[1]!.trim().replace(/^(?:The|A|An|And|Or|Of|Is|Does|Did|How|What|Why|When|Where|Which|Compare)\s+/, '').trim();
    if (!name || /^(?:The|A|An)$/.test(name)) continue;
    if (free(m.index, m.index + m[0].length)) found.push({ name, start: m.index, end: m.index + m[0].length });
  }
  return [...new Set(found.sort((a, b) => a.start - b.start).map((f) => f.name))];
}

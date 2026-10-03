import { COMPANY_CATALOG, type ScopeClaim, tickerOfChunkId } from '@diligenceiq/core';
import { type Alias, COMMON_WORD_NAMES, type CompanyMatch, CompanyMatcher, buildAliases } from '../query/companies';
import { isAboutEvidence, sentencesOf } from './period-claims';

/**
 * Two deterministic company checks (architecture §6.9; evaluation.md §13; 2026-10-03). No model call.
 * A citation's company is its chunk ID's ticker prefix (`UNH-FY2024-10K-1A-004` → UNH).
 *
 * 1. Company attribution (`attributionClaims`). An item that says something positive about a
 *    corpus company must cite at least one chunk of that company. Names are found with the query
 *    analyzer's aliases and case rules (assumptions C3: "Apple", "Visa", "Target" only capitalized;
 *    "apple supply", "visa requirements", "Meta-analysis" never), plus one alias kept local to this
 *    check: "AWS" / "Amazon Web Services" → Amazon, read the same way "Google Cloud" reads Alphabet
 *    (the query analyzer's aliases are unchanged, so retrieval is unchanged).
 *    A bare ticker counts only for a company in the brief's scope, and an ambiguous one (V, MA, MS,
 *    T, DE, HD, KO, CAT, …) only in company context: "(V)", "V's", or listed with another company
 *    ("V and MA"); never after "Part", "Class", "Item", "Section", … nor before "scan", "patients", ….
 *    A comparison cell is about its column header's company (or, with none, its row label's), plus
 *    any company it names itself, against its row's citations.
 *    Kept precise (a false badge on a correct claim is worse than a missed error):
 *    - a company named only in a negation, absence or contrast frame is not flagged: a clause with
 *      "not", "no", "neither … nor", "absent", "lacks", "without" ("Neither Apple nor JPMorgan
 *      discloses …", "JPMorgan Does Not", "has no direct analog at Apple"), or a company right after
 *      "unlike", "than", "versus", "vs.", "against", "compared with / to", "relative to", "distinct /
 *      different from", "differentiates … from", "absent from", "no analog / parallel / equivalent
 *      at / in" (with the companies listed after it). An absence cannot be cited, and a benchmark
 *      company is not the claim's subject;
 *    - an absence cell ("Not disclosed as a primary risk", "No single-individual dependency
 *      disclosed", "Not applicable", "—", "N/A", punctuation only) or a negative cell with no
 *      figure ("No", "No material change.", "Not a primary risk factor") says nothing about its
 *      column's company;
 *    - a company one of the item's cited passages itself names (by name, or by a bare ticker in
 *      company context: "Boston, MA" is not Mastercard) is not flagged (Apple's 10-K naming
 *      "Google LLC" is the filer's own statement about a counterparty), and a sentence about the
 *      evidence ("in the excerpts provided") is not a claim about a filing, as in the period check.
 * 2. Sweeping claims (`scopeClaims`). A quantifier over companies must be backed by citations from
 *    as many companies as it covers:
 *    - "all three / all five companies", "each of the four banks": N. A bare count ("All three",
 *      "across all five") counts only when it is the brief's in-scope company count and is followed
 *      by a company noun, by "of" and company names, or by nothing (punctuation or the end);
 *    - "every company", "each company", "all (of the) companies": the brief's in-scope company count
 *      (the question's companies; else the companies the brief cites);
 *    - "both companies / banks": two, only when the two companies it refers to are corpus companies
 *      in scope (the last "X and Y" before it names two of them, or the brief is about two);
 *    - "the only / the first …": only when the sentence also names an in-scope company the item
 *      does not cite. Exclusivity cannot be shown from one company's passages, but the model saw the
 *      others' passages, so a bare "the only" is not flagged.
 *    Kept precise: absence quantifiers ("none of the three", "neither company": an absence cannot
 *    be cited), directives ("Diligence teams should assess each company's …"), possessives ("each
 *    company's"), rules and generic classes ("SEC rules require all companies to …", "Each bank
 *    must …", "every drugmaker that sells into Medicare"), sentences about the evidence, and a brief
 *    about one company are skipped.
 *
 * What they do not catch: a claim attributed to the right company but not supported by its passage
 * (the IRA "misattributed" to Merck while citing a Merck chunk), a company named only by a pronoun
 * or a description ("the other two companies", "the payment network"), a company outside the
 * corpus, a negative or comparative claim about a company ("unlike Visa, …"), a quantifier over
 * things other than companies ("all segments"), and "only" claims that name no uncited company.
 */

/** Attribution reads the analyzer's aliases plus AWS → Amazon (local to this check; the query analyzer is unchanged). */
const ATTRIBUTION_ALIASES: Alias[] = [
  ...buildAliases({ companies: COMPANY_CATALOG }),
  { ticker: 'AMZN', text: 'Amazon Web Services', kind: 'name' },
  { ticker: 'AMZN', text: 'AWS', kind: 'name' },
];
const matcher = new CompanyMatcher(ATTRIBUTION_ALIASES);

/** The companies of a set of chunk IDs, by ticker prefix. */
export function citedCompanies(ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    const t = tickerOfChunkId(id);
    if (t) out.add(t);
  }
  return out;
}

/** Tickers that are also words, initials or abbreviations: read only in company context (M3). */
const AMBIGUOUS_TICKERS = new Set([...COMPANY_CATALOG.map((c) => c.ticker).filter((t) => t.length <= 2), 'CAT', 'UPS', 'DIS']);
/** A word before a ticker that makes it a label: "Part V", "Class V", "Item 1A", "Phase T". */
const LABEL_BEFORE = /\b(?:Part|Class|Item|Section|Series|Schedule|Form|Tier|Phase|Type|Level|Grade|Stage|Note|Exhibit|Article|Rule|Chapter|Title|Category|Segment|Group|Vitamin|Plan|Appendix|Annex|Table|Figure|Division|Unit|Model|Row|Column|Option|Track|Lot|Zone|Region|Area|Block)\s*$/i;
/** A word after a ticker that makes it a term: "MS patients", "CAT scan", "T cells", "V shares". */
const TERM_AFTER = /^\s+(?:scans?|patients?|disease|imaging|cells?|scores?|machines?|ratings?|grades?|shares?|stock|class|series|scale|test|tests|level|levels|type|types|unit|units|model|models|segment)\b/i;
const LIST_SEP = /^\s*(?:,\s*(?:and\s+|or\s+)?|\s(?:and|or|&)\s|\/)\s*$/;

/** A company mention as written: its ticker and its text ("Google Cloud", "AWS", "Visa's" → "Visa"). */
export interface CompanyMention {
  ticker: string;
  text: string;
  start: number;
  end: number;
}

/**
 * Companies mentioned in a piece of text: names always, a bare ticker only when it is in scope (an
 * ambiguous ticker only in company context). A common-word name (C3: "Target", "Apple", "Visa") is
 * read only where capitalization still means something: never in a Title Case heading (`title`),
 * never right after another capitalized word ("Directly Target All Key Geographies") or after
 * "the" ("the Amazon rainforest", "the Visa Waiver Program"), and at a sentence start ("Target
 * customers include …") only for a company in scope.
 */
export function mentionsIn(text: string, inScope: ReadonlySet<string>, title = false): CompanyMention[] {
  const all = matcher.match(text);
  const out: CompanyMention[] = [];
  all.forEach((m, i) => {
    if (m.kind === 'ticker' && !tickerInContext(text, m, all, i, inScope)) return;
    if (m.kind === 'name' && COMMON_WORD_NAMES.has(m.text.toLowerCase())) {
      const before = text.slice(0, m.start);
      // "Directly Target": the previous word is capitalized and is not the sentence's first word ("Unlike Apple").
      const titleCased = /(?:^|[^\w])[A-Z][\w'’-]*\s$/.test(before) && !/(?:^|[.!?:;])\s*\S+\s$/.test(before);
      // "the Amazon rainforest", "The Visa Waiver Program": a common word after "the" is not the company.
      const afterThe = /\bthe\s+$/i.test(before);
      // At a sentence start capitalization says nothing ("Target customers include …"): only a company in scope counts there.
      const sentenceStart = /(?:^|[.!?;:]\s+)["'“‘(]?$/.test(before) && !inScope.has(m.ticker);
      if (title || titleCased || afterThe || sentenceStart) return;
    }
    out.push({ ticker: m.ticker, text: displayText(text, m, all[i + 1], title), start: m.start, end: m.end });
  });
  return out;
}

function tickerInContext(text: string, m: CompanyMatch, all: readonly CompanyMatch[], i: number, inScope: ReadonlySet<string>): boolean {
  if (!inScope.has(m.ticker)) return false;
  const before = text.slice(0, m.start);
  const after = text.slice(m.end);
  if (LABEL_BEFORE.test(before) || TERM_AFTER.test(after)) return false;
  if (!AMBIGUOUS_TICKERS.has(m.ticker)) return true;
  if (/\(\s*$/.test(before) && /^\s*\)/.test(after)) return true;
  if (/^['’]s\b/.test(after)) return true;
  const prev = all[i - 1];
  const next = all[i + 1];
  return (!!prev && LIST_SEP.test(text.slice(prev.end, m.start))) || (!!next && LIST_SEP.test(text.slice(m.end, next.start)));
}

/** The mention as a reader would quote it: the alias plus up to two capitalized words of a product name ("Google Cloud", "Apple Pay"). */
function displayText(text: string, m: CompanyMatch, next: CompanyMatch | undefined, title: boolean): string {
  if (title || m.kind === 'ticker') return m.text;
  const rest = text.slice(m.end, next ? next.start : undefined);
  return m.text + (/^(?:\s[A-Z][a-z]+){1,2}/.exec(rest)?.[0] ?? '');
}

/** Tickers mentioned in a piece of text (`mentionsIn`), de-duplicated in order. */
export function companiesNamedIn(text: string, inScope: ReadonlySet<string>, title = false): string[] {
  return [...new Set(mentionsIn(text, inScope, title).map((m) => m.ticker))];
}

/* ----------------------------------------------------- negation and contrast frames */

/** A clause break inside a sentence: ";", ":", a dash, or ", but / while / whereas / although". */
const CLAUSE_BREAK = /[;:—–]|\s-\s|,\s+(?:but|while|whereas|although|though|yet)\b|\s+but\s+/gi;
/** A negation or absence cue: every company in its clause is in a negation frame. */
const NEGATION = /\b(?:not|no|neither|nor|none|never|absent|lacks?|lacking|without)\b|n['’]t\b/i;
/** The companies listed right before a mention, each masked as "§": "§, § and ", "§'s or ". */
const LISTED = String.raw`(?:the\s+)?(?:§(?:['’]s)?(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+))*$`;
/** A contrast or benchmark cue right before a company (or its list). */
const CONTRAST_BEFORE = new RegExp(
  String.raw`(?:\b(?:unlike|versus|vs\.?|against|compared\s+(?:with|to)|relative\s+to|in\s+contrast\s+(?:with|to)|(?:distinct|different|differs?|differentiat\w*|distinguish\w*)\b[^.;]{0,60}?\bfrom|absent\s+(?:from|at|in)|no\s+(?:direct\s+)?(?:analog(?:ue)?|parallel|equivalent|counterpart)s?\s+(?:at|in|for|among|to))\s+|\bthan\b[^§.;]{0,60}?)${LISTED}`,
  'i',
);

/** Whether each mention is in a negation, absence or contrast frame (H1). */
function framedMentions(sentence: string, mentions: readonly CompanyMention[]): boolean[] {
  const breaks = [0, ...[...sentence.matchAll(CLAUSE_BREAK)].map((m) => m.index + m[0].length), sentence.length + 1];
  const clauseOf = (pos: number) => {
    let i = 0;
    while (i + 1 < breaks.length && breaks[i + 1]! <= pos) i++;
    return { from: breaks[i]!, to: Math.min(sentence.length, breaks[i + 1]!) };
  };
  return mentions.map((m) => {
    const { from, to } = clauseOf(m.start);
    if (NEGATION.test(sentence.slice(from, to))) return true;
    // The clause up to this mention, with every other mention masked as "§".
    let before = '';
    let pos = from;
    for (const o of mentions) {
      if (o.start < from || o.start >= m.start) continue;
      before += `${sentence.slice(pos, o.start)}§`;
      pos = o.end;
    }
    before += sentence.slice(pos, m.start);
    return CONTRAST_BEFORE.test(before);
  });
}

/* ------------------------------------------------------------- attribution */

/** A cell that states nothing: empty, a dash, "N/A", "None", punctuation only. */
const EMPTY_CELL = /^[\s\p{P}\p{S}]*$|^\s*(?:n\/?a\.?|n\.a\.|none|not applicable|tbd)\s*$/iu;
/** A cell that states an absence: "Not disclosed as a primary risk", "No single-individual dependency disclosed", "Does not disclose …". */
const ABSENCE_CELL = /^\s*(?:(?:not|no|none)\b[^.]*?\b(?:disclosed|identified|named|addressed|specified|mentioned|discussed|reported|flagged|cited|quantified|stated|described|highlighted)\b|(?:does|did|do)\s+not\b|neither\b|not\s+(?:applicable|disclosed|identified|stated|specified|quantified|reported)\b)/i;

export interface AttributionContext {
  /** The tickers the item's valid citations are from. */
  cited: ReadonlySet<string>;
  /** The texts of the item's cited passages. */
  passages: readonly string[];
  /** The brief's in-scope tickers (bare tickers count only for these). */
  inScope: ReadonlySet<string>;
  /** A comparison cell's own companies (its column header's, or its row label's), with the header text. */
  subjects?: ReadonlyArray<{ ticker: string; text: string }>;
  /** A Title Case heading: common-word names are not read (`companiesNamedIn`). */
  title?: boolean;
}

/** One uncited company: its ticker, the text that named it, and whether it came from the cell's column header. */
export interface UncitedCompany {
  ticker: string;
  text: string;
  column?: true;
}

/** The companies an item says something positive about (or, for a cell, is about) with no citation from them; empty when there are none. */
export function uncitedCompaniesIn(text: string, ctx: AttributionContext): UncitedCompany[] {
  const named: UncitedCompany[] = [];
  const add = (c: UncitedCompany) => !named.some((n) => n.ticker === c.ticker) && named.push(c);
  const claims = sentencesOf(text).filter((s) => !isAboutEvidence(s));
  for (const s of claims) {
    const mentions = mentionsIn(s, ctx.inScope, ctx.title);
    const framed = framedMentions(s, mentions);
    mentions.forEach((m, i) => framed[i] || add({ ticker: m.ticker, text: m.text }));
  }
  // A cell is about its column's company only when it says something about the filing (not an empty, absence or negative cell).
  if (ctx.subjects?.length && claims.length > 0 && !EMPTY_CELL.test(text) && !ABSENCE_CELL.test(text) && !NEGATIVE_CELL(text)) for (const t of ctx.subjects) add({ ticker: t.ticker, text: t.text, column: true });
  const uncited = named.filter((t) => !ctx.cited.has(t.ticker));
  if (!uncited.length) return [];
  const inPassages = new Set(ctx.passages.flatMap((p) => passageTickers(p)));
  return uncited.filter((t) => !inPassages.has(t.ticker));
}

/** A negative cell with no figure ("No", "No material change.", "Not a primary risk factor"): it states no positive fact about its column's company. */
const NEGATIVE_CELL = (text: string) => NEGATION.test(text) && !/\d/.test(text);

/**
 * The companies a cited passage names: every name, and a bare ticker only in company context (the
 * same rules as `mentionsIn`, in or out of scope), so "Boston, MA 02110" or "Item 1A" in a filing never reads as
 * Mastercard and exempts a real flag. Common-word names keep the plain matcher's reading here: a
 * passage naming "Apple" in any position still exempts it (the exemption errs toward no badge).
 */
function passageTickers(passage: string): string[] {
  const all = matcher.match(passage);
  return all.filter((m, i) => m.kind !== 'ticker' || !AMBIGUOUS_TICKERS.has(m.ticker) || tickerInContext(passage, m, all, i, new Set([m.ticker]))).map((m) => m.ticker);
}

/* ------------------------------------------------------------- sweeping claims */

const NUMBER_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const N = String.raw`(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})`;
/** Nouns that stand for companies in a quantifier ("all four banks", "all three hyperscalers"). */
const COMPANY_NOUN = String.raw`(?:companies|company|firms?|banks?|issuers?|insurers?|lenders?|retailers?|manufacturers?|automakers?|hyperscalers?|drugmakers?|peers|registrants?|filers?)`;
const DIRECTIVE = /\b(?:should|ought to|recommend\w*)\b|\bdiligence (?:teams?|should|work)\b/i;
/** A rule or a generic class, not the brief's companies: "SEC rules require all companies to …", "Each bank must …". */
const GENERIC = /\b(?:requires?|required|requiring|applies|apply|applicable|mandates?|mandated|must|shall|obliges?|obligated)\b/i;
/** A qualifier right after the quantified noun that makes it a class: "every drugmaker that sells …", "all banks with more than …". */
const CLASS_QUALIFIER = /^\s+(?:that|which|who|whose|with|subject to|under|above|over|selling|operating|doing)\b/i;

const numberOf = (w: string) => NUMBER_WORDS[w.toLowerCase()] ?? Number(w);

interface ScopeContext {
  /** Distinct companies the item cites. */
  cited: ReadonlySet<string>;
  /** The brief's in-scope company count. */
  scopeCount: number;
  /** The brief's in-scope tickers (for "both" and "the only"). */
  inScope: ReadonlySet<string>;
  /** The item's whole text (for the referent of "both"). */
  item: string;
}

/** The sweeping claim in one sentence, or null. */
function scopeClaimInSentence(s: string, ctx: ScopeContext): Omit<ScopeClaim, 'location'> | null {
  if (isAboutEvidence(s) || DIRECTIVE.test(s) || GENERIC.test(s)) return null;
  const cited = ctx.cited.size;
  // "all three companies", "each of the four banks", "All three of Alphabet, Microsoft and Amazon", a bare "Across All Three,".
  for (const m of s.matchAll(new RegExp(String.raw`\b(all|each of the|every one of the|all of the)\s+${N}\b`, 'gi'))) {
    const n = numberOf(m[2]!);
    if (n < 2) continue;
    const after = s.slice(m.index + m[0].length);
    const companyNoun = new RegExp(String.raw`^\s+(?:of\s+(?:the|these|those)\s+)?(?:[\w-]+\s+){0,2}?${COMPANY_NOUN}\b(?!['’]s\b)`, 'i').exec(after);
    if (companyNoun && CLASS_QUALIFIER.test(after.slice(companyNoun[0].length))) continue;
    const ofNames = /^\s+of\s+/i.test(after) && mentionsIn(after, ctx.inScope).length >= 2;
    const nothing = /^\s*(?:[,.;:)—–]|$)/.test(after);
    // A bare count is about the companies only when it is the brief's company count.
    if (!companyNoun && !ofNames && !(nothing && n === ctx.scopeCount)) continue;
    if (cited < n) return { cue: `${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`, scope: n, cited };
  }
  if (ctx.scopeCount < 2) return null;
  // "every company", "each company" (not "each company's"), "all companies".
  const universal = new RegExp(String.raw`\b(every|each|all(?: of the)?)\s+(${COMPANY_NOUN})\b(?!['’]s)`, 'gi');
  for (const m of s.matchAll(universal)) {
    const plural = /s$/i.test(m[2]!);
    if (/^(?:every|each)$/i.test(m[1]!) && plural) continue;
    if (/^all/i.test(m[1]!) && !plural) continue;
    if (CLASS_QUALIFIER.test(s.slice(m.index + m[0].length))) continue;
    if (cited < ctx.scopeCount) return { cue: `${m[1]!.toLowerCase()} ${m[2]!.toLowerCase()}`, scope: ctx.scopeCount, cited };
  }
  // "both companies": only when the two companies it refers to are in-scope corpus companies.
  const pair = new RegExp(String.raw`\bboth\s+(${COMPANY_NOUN})\b`, 'i').exec(s);
  if (pair && cited < 2 && bothAreInScope(ctx, s, pair.index)) return { cue: `both ${pair[1]!.toLowerCase()}`, scope: 2, cited };
  // "the only …", "the first company": only when the sentence also names an in-scope company the item does not cite.
  const only = new RegExp(String.raw`\bthe (only|first)\b`, 'i').exec(s);
  if (only && cited < 2 && mentionsIn(s, ctx.inScope).some((m) => ctx.inScope.has(m.ticker) && !ctx.cited.has(m.ticker))) {
    return { cue: `the ${only[1]!.toLowerCase()}`, scope: Math.max(2, ctx.scopeCount), cited };
  }
  return null;
}

/** The referent of "both": the last "X and Y" of capitalized names before it in the item, or a brief about exactly two companies. */
function bothAreInScope(ctx: ScopeContext, sentence: string, at: number): boolean {
  const start = ctx.item.indexOf(sentence);
  const before = ctx.item.slice(0, (start < 0 ? 0 : start) + at);
  const pairs = [...before.matchAll(/\b([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})\s+and\s+([A-Z][\w&.'’-]*(?:\s+[A-Z][\w&.'’-]*){0,2})/g)];
  const last = pairs.at(-1);
  if (!last) return ctx.scopeCount === 2;
  const a = mentionsIn(last[1]!, ctx.inScope);
  const b = mentionsIn(last[2]!, ctx.inScope);
  return a.length > 0 && b.length > 0 && ctx.inScope.has(a[0]!.ticker) && ctx.inScope.has(b[0]!.ticker);
}

/** The first sweeping claim in a piece of text whose item cites fewer companies than it covers; null when none. */
export function scopeClaimIn(text: string, citedTickers: ReadonlySet<string>, scopeCount: number, inScope: ReadonlySet<string> = citedTickers): Omit<ScopeClaim, 'location'> | null {
  const ctx: ScopeContext = { cited: citedTickers, scopeCount, inScope, item: text };
  for (const s of sentencesOf(text)) {
    const claim = scopeClaimInSentence(s, ctx);
    if (claim) return claim;
  }
  return null;
}

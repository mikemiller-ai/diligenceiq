import { type PeriodClaim, fiscalYearOfChunkId } from '@diligenceiq/core';

/**
 * The deterministic period-claim check (architecture §6.9; 2026-10-03). No model call.
 *
 * A sentence that says something is new, a first, added, or absent in a fiscal period is a claim
 * about that period's filing. It is flagged `period_uncited` when it names a fiscal year that none
 * of the item's own valid citations belongs to (a chunk ID's `FY<year>`, 10-K or 10-Q). The manual
 * review (evaluation.md §8, §11) found these as the most serious failure mode: "absent from the
 * FY2023 filing" with no FY2023 passage in the context is a claim retrieval cannot support.
 *
 * What it reads, per sentence:
 * - a novelty or absence cue (`CUE`): "first time", "first year", "for the first time", "newly",
 *   "new" only in a disclosure sense ("new in FY2025", "a new risk", "new disclosure", "new section",
 *   "a new tariff risk factor"), "added" only in a disclosure sense ("was added", "added a new risk
 *   factor", "added language", or a table cell's elliptical "B200 added"), "absent", "not present",
 *   "no longer", "did not appear / reference / name", "not mentioned", "not disclosed", "emerged",
 *   "introduced" and close variants. Ordinary change verbs ("rose", "fell", "grew", "increased") are
 *   not cues: "FY2025 revenue rose 6%" is never a period claim, and neither is "as new models
 *   launched" or "tariffs added costs".
 * - a fiscal-period reference (`periodMentionsIn`): "FY2023", "FY 2023", "FY23", "FY2026Q1", "fiscal 2024",
 *   "fiscal years 2023 and 2024", "the 2023 10-K / annual report / filing", ranges ("FY2023–FY2025",
 *   "fiscal 2023-2025", "from 2023 through 2025") expanded to every year, and lists ("FY2023 or
 *   2024"). A bare year ("in 2024") is not a period (Phase 3's rule; it is often a calendar date),
 *   and relative phrases ("prior years", "last year") are skipped.
 * - only the periods tied to the cue (`tiedYears`): a period in the cue's own clause (split at ", ",
 *   ";", ": " and "as" (not "as a / as an / as of"), "while", "whereas", "but", "although", "though",
 *   "however"), or within
 *   `WINDOW` words of the cue ("In FY2023, tariff risk was absent"). A period introduced by a
 *   comparison ("up from $200.6 billion in FY2024", "versus FY2024", "compared with FY2024",
 *   "relative to FY2024") is the comparison's baseline, not the claim's period, and never counts;
 *   "absent from FY2023" is the claim itself, so a "from" right after an absence word still counts.
 *
 * What it does not flag:
 * - a sentence about the evidence rather than the filing ("not disclosed in the supplied excerpts",
 *   "no FY2023 passage was provided"): saying the excerpts do not cover a period is the honest form.
 * - a "first in FY2025" claim that cites an earlier period which already says it (a contradiction,
 *   not an uncited period): the period is cited, so the check passes. Telling a contradiction apart
 *   needs the meaning of the passages, which no deterministic rule here reads.
 * - a novelty claim with no fiscal-period reference ("a new risk factor"), or one dated by a bare
 *   or relative year ("since 2015", "in prior years").
 * - follow-up questions, evidence gaps (they state absences by design) and the brief's title.
 */

/** Disclosure nouns for "a new …" and "added …" ("a new risk factor", "added language"). */
const DISCLOSURE = String.raw`(?:risk factors?|risks?|disclosures?|sections?|subsections?|language|references?|mentions?|discussion)`;

/** Novelty and absence wording. Case-insensitive; `new` excludes place names ("New York"). */
const CUE_SOURCE =
  [
    String.raw`for the first time`,
    String.raw`first[- ]time`,
    String.raw`first (?:year|fiscal year|filing|annual report|disclos\w*|named|mentioned|appear\w*|introduc\w*|raised|flagged|identified|described|added|cited|noted|referenced)`,
    String.raw`newly`,
    // "new" only in its disclosure-novelty sense ("new in FY2025", "a new risk factor", "new
    // disclosure"), never as a plain adjective ("new product introductions", "new subscriptions",
    // "as new models launched", "were new to the mix", "New York").
    String.raw`new (?:in|for|since) (?=FY|fiscal|(?:the )?(?:19|20)\d{2})`,
    String.raw`new ${DISCLOSURE}`,
    String.raw`an? new (?:[\w'/-]+ ){0,3}factors?`,
    // "added" only in its disclosure sense ("was added", "added a new risk factor", "added language",
    // and a table cell's elliptical passive "GB200, B200 added (later)"), never as an amount or an
    // effect ("the charge added $4.5 billion", "tariffs added costs", "subscriptions added across regions").
    String.raw`(?:was|were|been|being) added`,
    String.raw`added (?:(?:a|an|the)\s+)?(?:(?!and\b|or\b)[\w'/-]+\s+){0,2}?${DISCLOSURE}`,
    String.raw`added(?= later\b| ?[.;)]?$)`,
    String.raw`absent`,
    String.raw`absence`,
    String.raw`not present`,
    String.raw`no longer`,
    String.raw`(?:did|does|do|had) not (?:appear|reference|mention|name|include|disclose|discuss|address|cite|identify|describe)`,
    String.raw`not (?:mentioned|disclosed|discussed|included|referenced|addressed)`,
    String.raw`no mention`,
    String.raw`emerged`,
    String.raw`introduced`,
    String.raw`previously undisclosed`,
    String.raw`omit(?:s|ted)`,
  ]
    .map((s) => String.raw`\b${s}\b`)
    .join('|');
const CUE = new RegExp(CUE_SOURCE, 'i');
const CUES = () => new RegExp(CUE_SOURCE, 'gi');

/**
 * A sentence about the evidence supplied or the corpus, not about what a filing says: its absences
 * are honest scope statements ("not disclosed in the supplied excerpts", "the FY2015 10-K is absent
 * from the corpus", "FY2015 filing absent"). Also a hedge that asks rather than claims ("assess
 * whether these risks were absent in FY2015").
 */
const ABOUT_EVIDENCE = [
  /\b(?:excerpts?|supplied|provided|retrieved|retrieval|context|passages?|corpus|evidence)\b/i,
  /\b(?:filings?|10-[KQ]s?|annual reports?)\s+(?:(?:is|are|was|were)\s+)?(?:absent|missing|not (?:present|included|available))\b/i,
  /\bwhether\b/i,
];

const YEAR = String.raw`(?:19|20)\d{2}`;
const SEP = String.raw`\s*(?:–|—|-|to|through)\s*`;
const LIST = String.raw`(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)`;
/** An anchored period: "FY2023", "FY 23", "FY2026Q1". */
const FY = String.raw`\bFY\s?'?(\d{4}|\d{2})(?:\s?Q[1-4])?\b`;
/** "fiscal 2024", "fiscal year 2024", "fiscal years 2023". */
const FISCAL = String.raw`\bfiscal\s+(?:years?\s+)?(${YEAR})\b`;
/** "the 2023 10-K", "2024 annual report", "2023 filing", "2024 Form 10-K". */
const FILING = String.raw`\b(${YEAR})\s+(?:Form\s+)?(?:10-K|10-Q|annual reports?|filings?|reports?)\b`;
/** A bare range in a time phrase: "from 2023 through 2025", "between 2023 and 2025", "for 2023-2025", "over 2023–2025". */
const BARE_RANGE = String.raw`\b(?:from|between|for|over|across|during)\s+(${YEAR})(?:${SEP}|\s+and\s+)(${YEAR})\b`;

const fy = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** One period reference in a sentence: where it starts and every fiscal year it names (a range or list joins its head). */
export interface PeriodMention {
  index: number;
  end: number;
  years: number[];
}

/**
 * The period references a sentence makes, in text order. A range adds every year in it; a year
 * listed right after a period ("FY2023 or 2024", "fiscal 2023, 2024 and 2025") joins it.
 */
export function periodMentionsIn(sentence: string): PeriodMention[] {
  const mentions: PeriodMention[] = [];
  const rangeOf = (a: number, b: number) => (b >= a && b - a <= 10 ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : []);
  for (const m of sentence.matchAll(new RegExp(BARE_RANGE, 'gi'))) mentions.push({ index: m.index, end: m.index + m[0].length, years: rangeOf(Number(m[1]), Number(m[2])) });
  for (const re of [FY, FISCAL, FILING]) {
    for (const m of sentence.matchAll(new RegExp(re, 'gi'))) {
      const start = fy(m[1]!);
      const years = [start];
      // Continuations: a range end ("–FY2025", "-2025") or list items ("or 2024", ", FY2024 and FY2025").
      let end = m.index + m[0].length;
      for (;;) {
        const rest = sentence.slice(end);
        const r = new RegExp(String.raw`^${SEP}(?:FY\s?'?)?(\d{4}|\d{2})\b`, 'i').exec(rest);
        if (r && (r[1]!.length === 4 || /FY/i.test(r[0]))) {
          years.push(...rangeOf(start, fy(r[1]!)));
          end += r[0].length;
          continue;
        }
        const l = new RegExp(String.raw`^${LIST}(?:FY\s?'?(\d{4}|\d{2})|(${YEAR}))\b`, 'i').exec(rest);
        if (l) {
          years.push(fy(l[1] ?? l[2]!));
          end += l[0].length;
          continue;
        }
        break;
      }
      mentions.push({ index: m.index, end, years: [...new Set(years)] });
    }
  }
  // A list or range item ("and FY2024" in "FY2023 and FY2024") belongs to its head, not a mention of its own.
  return mentions.sort((a, b) => a.index - b.index || b.end - a.end).filter((m, i, all) => !all.slice(0, i).some((o) => m.index >= o.index && m.index < o.end));
}

/** The fiscal years a sentence names, ascending, de-duplicated. */
export function periodsIn(sentence: string): number[] {
  return [...new Set(periodMentionsIn(sentence).flatMap((m) => m.years))].sort((a, b) => a - b);
}

/**
 * Clause boundaries inside a sentence: ", ", ";", ": " and contrast or circumstance connectors. A
 * prepositional "as a / as an" ("does not appear as a distinct disclosure in FY2023") is not one.
 */
const CLAUSE_BREAK = /,\s|;|:\s|\s(?:as(?!\s+(?:an?|of)\b)|while|whereas|but|although|though|however)\s/gi;
/** How many words may sit between a cue and a period in another clause ("In FY2023, tariff risk was absent"). */
const WINDOW = 5;
/**
 * A comparison that introduces its baseline period: "up from $200.6 billion in FY2024", "versus
 * FY2024", "vs. FY2024", "compared with FY2024", "relative to FY2024", "than in FY2024".
 */
const COMPARATOR = /\b(?:(?:up|down)\s+from|from|versus|vs\.?|compared\s+(?:with|to)|relative\s+to|than)(?=\s)/gi;
/** An absence word right before "from": "absent from FY2023" is the claim, not a comparison. */
const ABSENT_FROM = /\b(?:absent|missing|omitted|removed|dropped|excluded|deleted)\s+$/i;

const wordsIn = (text: string) => text.split(/\s+/).filter((w) => /\w/.test(w)).length;

/**
 * Whether a period mention is a comparison's baseline: a comparator in the same clause, at most
 * `WINDOW` words before it (room for an amount and "in"). "Rose from $2.2 billion in FY2024 to $3.7
 * billion in FY2025": FY2024 is the baseline, FY2025 is not.
 */
function isBaseline(sentence: string, mention: PeriodMention): boolean {
  const before = sentence.slice(0, mention.index);
  const tail = before.slice(Math.max(before.lastIndexOf(', '), before.lastIndexOf(';'), before.lastIndexOf(': ')) + 1);
  const offset = before.length - tail.length;
  return [...tail.matchAll(COMPARATOR)].some((c) => {
    const between = tail.slice(c.index + c[0].length);
    if (wordsIn(between) > WINDOW) return false;
    if (!/^from$/i.test(c[0])) return true;
    // A bare "from" is a baseline only right before the period or an amount ("from FY2024", "from
    // $2.2 billion in FY2024"), and never after an absence word ("absent from FY2023").
    return /^\s*(?:the\s+)?(?:[$\d]|$)/.test(between) && !ABSENT_FROM.test(sentence.slice(0, offset + c.index));
  });
}

/** Clause number of each position: how many clause breaks come before it. */
function clauseAt(sentence: string): (pos: number) => number {
  const breaks = [...sentence.matchAll(CLAUSE_BREAK)].map((m) => m.index);
  return (pos) => breaks.filter((b) => b < pos).length;
}

/**
 * The fiscal years tied to one cue: periods in the cue's own clause, or within `WINDOW` words of it,
 * that are not a comparison's baseline.
 */
function tiedYears(sentence: string, cue: { index: number; end: number }, mentions: readonly PeriodMention[]): number[] {
  const clause = clauseAt(sentence);
  const out: number[] = [];
  for (const m of mentions) {
    if (isBaseline(sentence, m)) continue;
    const gap = m.index >= cue.end ? sentence.slice(cue.end, m.index) : sentence.slice(m.end, cue.index);
    const near = (m.index >= cue.end || m.end <= cue.index) && wordsIn(gap) <= WINDOW;
    if (clause(m.index) === clause(cue.index) || near) for (const y of m.years) if (!out.includes(y)) out.push(y);
  }
  return out;
}

/** Sentences: split after ".", "!" or "?" before a capital, a digit or a bracket, after any ";", and at line breaks. "U.S. law" stays whole. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9("[])|(?<=;)\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The period claim in one piece of text, against the fiscal years its citations cover; null when there is none to flag. */
export function periodClaimIn(text: string, citedYears: ReadonlySet<number>, fallbackYears: readonly number[] = []): Omit<PeriodClaim, 'location'> | null {
  const uncited: number[] = [];
  let cue: string | null = null;
  for (const s of sentencesOf(text)) {
    if (!CUE.test(s) || ABOUT_EVIDENCE.some((re) => re.test(s))) continue;
    const mentions = periodMentionsIn(s);
    for (const m of s.matchAll(CUES())) {
      // A comparison cell that names no period of its own is about its column's (or row's) period.
      const years = mentions.length ? tiedYears(s, { index: m.index, end: m.index + m[0].length }, mentions) : fallbackYears;
      const missing = years.filter((y) => !citedYears.has(y));
      if (!missing.length) continue;
      cue ??= m[0].trim().toLowerCase();
      for (const y of missing) if (!uncited.includes(y)) uncited.push(y);
    }
  }
  return cue ? { periods: uncited.sort((a, b) => a - b).map((y) => `FY${y}`), cue } : null;
}

/** The fiscal years a set of chunk IDs belongs to. */
export function citedFiscalYears(ids: Iterable<string>): Set<number> {
  const out = new Set<number>();
  for (const id of ids) {
    const y = fiscalYearOfChunkId(id);
    if (y !== null) out.add(y);
  }
  return out;
}

import { classifyRiskHeading, type SignalCategory } from '@diligenceiq/core';
import type { Chunk } from './chunker';
import type { ProcessedFiling } from './filing';
import { headingPrefix, isTableRow, paragraphSpans, sentenceSpans } from './segments';

/**
 * Risk-heading extraction from a 10-K's Item 1A (SPEC §8.3 "Current risks"; architecture §3,
 * §7.1 `currentRisks`). Replaces the Phase 1 hand-picked fixture selection.
 *
 * In the flattened text a risk factor is a one-sentence paragraph (bold in the original)
 * followed by its body paragraphs:
 *
 *   …stock price.The Company’s business can be impacted by political events, trade and other
 *   international disputes, … and other business interruptions.Political events, trade and …
 *
 * A paragraph is a heading when it:
 * - is one sentence ending in `.`, `?` or `!`, 40–700 characters long;
 * - does not open like a continuation ("Such events…", "While the Company…", "…also…");
 * - uses risk language (could, may, can, adversely, harm, depend, subject to, …);
 * - is not a table row, a bullet, or the section's introductory boilerplate;
 * - does not point back with a demonstrative ("The cost of these measures…", "How these laws…");
 * - has no glued subheading and body ("…gaming platform abusesFor platform products…"): a
 *   lowercase-to-capital join inside a word that never occurs on its own in the filing;
 * - is elaborated by what follows: at least some of its words recur in the next ~600
 *   characters, unless it directly follows a group title or a page header.
 * Two one-sentence paragraphs in a row: the second is the heading when it does not restate the
 * first (AAPL: "Changes or additions to the Company’s supply chain…" closes one risk, "Future
 * operating results depend upon…" opens the next); otherwise the second is body.
 * Category group headings ("Macroeconomic and Industry Risks") are kept as `group`.
 *
 * This is a deterministic heuristic. Its precision and recall are measured against hand-labeled
 * lists for AAPL, MSFT and NVDA (testing/risk-headings-golden.ts; assumptions G3a): it can miss
 * some headings and can include a sentence that is not a heading.
 */

export interface RiskHeading {
  heading: string;
  /** Offsets into the processed filing text. */
  start: number;
  end: number;
  /** The group heading this risk sits under, when the filing uses groups. */
  group: string | null;
  category: SignalCategory | null;
  /** Position in the filing's list, 1-based. */
  rank: number;
  /** Chunk(s) whose text contains the heading verbatim. */
  chunkIds: string[];
}

const RISK_LANGUAGE =
  /\b(?:could|may|might|can|would|will|must|adversely|adverse|harm|harmed|depend|depends|dependent|subject to|risk|risks|exposed|exposure|uncertain|uncertainty|unable|fail|failure|volatil\w*|decline|loss|losses|impair\w*|negative\w*|disrupt\w*|challeng\w*|affect|affected|impact\w*|liabilit\w*|limit\w*|reduc\w*|increase\w*|difficult\w*)\b/i;
const INTRO = /^(?:The following|This section|In addition to the other information|You should carefully|Investing in|Our business, financial condition|The risks (?:and uncertainties )?described|We are subject to (?:various )?risks|Please carefully|Set forth below|Below we describe|These risks)/i;
/** Body paragraphs that continue an argument; a heading never opens this way. */
const BODY_START =
  /^(?:Such|These|This|That|Those|While|Although|However|In addition|Additionally|For example|For instance|As a result|Accordingly|Further(?:more)?|Moreover|Also|Similarly|Consequently|Therefore|Thus|Despite|Even if|If|When|Because|Any|Other|Certain|Uncertainty about|Potential outcomes|All of|All these|Each of|Concurrently|Regardless|Among other|In particular|Specifically|Likewise|Finally|For all|For these|It)\b/;
/** Body text that points back or ahead ("The competitive pressures described above…"). */
const BODY_REFERENCE = /\b(?:described|discussed|mentioned|noted|set forth|listed)\s+(?:above|below|herein)\b/i;
/** Page furniture glued before a paragraph: a running footer ("Apple Inc. | 2025 Form 10-K | 9") or a bare page number. */
const PAGE_FURNITURE = /^\s*(?:[^|\n]{0,80}\|[^|\n]{0,60}\|\s*\d{1,3}|\d{1,3})?(?:\s*Table\s+of\s+Contents)?(?=[A-Z“"])/;
const MIN_HEADING = 35;
const MAX_HEADING = 700;

function sentenceCount(text: string, span: { start: number; end: number }): number {
  return sentenceSpans(text, span).filter((s) => text.slice(s.start, s.end).trim().length > 0).length;
}

/**
 * A group heading glued before the text: "Macroeconomic and Industry RisksThe…",
 * "STRATEGIC AND COMPETITIVE RISKSWe…", "Risks related to our intellectual propertyThe…",
 * "Government and Political FactorsExxonMobil’s…".
 */
function groupPrefix(text: string): string | null {
  const upper = /^([A-Z][A-Z ,&’'-]{5,90}?)(?=[A-Z][a-z])/.exec(text)?.[1];
  const sentence = /^(Risks?\s+(?:related|relating|associated|specific|that\s+relate)\s+(?:to|with)\b.{0,90}?[a-z)])(?=[A-Z][a-z’'])/.exec(text)?.[1];
  const title = upper ?? sentence ?? headingPrefix(text.slice(0, 200));
  if (!title || title.length >= 120 || !/\b(?:Risks?|RISKS?|Matters|MATTERS|Considerations|Factors|FACTORS)\b/.test(title)) return null;
  return title;
}

/** A short sentence-case subheading glued to body text ("Competition in the technology sectorOur competitors…"). */
const SUBHEADING =
  /^[A-Z][a-z’'-]+(?:\s+[A-Za-z’'&-]+){0,8}?[a-z]{2}(?=(?:Our|We|The|An?|In|As|This|These|Those|There|It|Its|Many|Some|Each|If|When|While|For|To|Although|Under|With|Because|Threats|Customers|Users)\b)/;

interface Block {
  /** Paragraph index. */
  i: number;
  start: number;
  end: number;
  text: string;
  group: string | null;
  /** The block opens after a page header or footer, a group title, or a line of its own. */
  fresh: boolean;
}

/**
 * Paragraph blocks of the risk section with page furniture and group headings stripped.
 * `group` is set on the block that introduces a new group.
 */
function blocks(text: string, start: number, end: number): Block[] {
  const out: Block[] = [];
  const paras = paragraphSpans(text, start, end)
    .filter((p) => text.slice(p.start, p.end).trim())
    .flatMap((p) => splitAtGroups(text, p));
  let afterHeader = false;
  paras.forEach((p, i) => {
    if (p.start === start) return; // "Item 1A. Risk Factors…"
    const raw = text.slice(p.start, p.end);
    let offset = PAGE_FURNITURE.exec(raw)?.[0].length ?? 0;
    const furniture = offset > 0;
    offset += raw.slice(offset).length - raw.slice(offset).trimStart().length;
    const group = groupPrefix(raw.slice(offset));
    if (group) offset += group.length;
    const body = raw.slice(offset).trim();
    // A running header on its own line ("22", "PART IItem 1A") marks the next block as fresh.
    if (/^\s*(?:\d{1,3}|PART\s+I+\s*Item\s*\d+[A-C]?(?:,\s*\d+[A-C]?)*)\s*$/i.test(raw)) {
      afterHeader = true;
      return;
    }
    if (!body && !group) return;
    const fresh = afterHeader || furniture || group !== null || text[p.start - 1] === '\n';
    afterHeader = false;
    out.push({ i, start: p.start + offset, end: p.start + offset + body.length, text: body, group, fresh });
  });
  return out;
}

/** An UPPER CASE group title after a sentence and a space starts a new block ("…operations. LEGAL, REGULATORY, AND LITIGATION RISKSWe are…"). */
const MID_GROUP = /(?<=[.!?][”"’)]?\s+)[A-Z][A-Z ,&’'-]{5,90}?(?:RISKS?|MATTERS|FACTORS)(?=[A-Z][a-z])/g;

/** A page footer glued after a sentence ("…sell our products.22Table of ContentsWe acquire…") also ends a paragraph. */
const MID_FURNITURE = /(?<=[.!?][”"’)]?)(?=\d{1,3}\s*Table\s+of\s+Contents)/g;

function splitAtGroups(text: string, p: { start: number; end: number }): Array<{ start: number; end: number }> {
  const slice = text.slice(p.start, p.end);
  const cuts = [...slice.matchAll(MID_GROUP), ...slice.matchAll(MID_FURNITURE)].map((m) => p.start + m.index).sort((a, b) => a - b);
  const out: Array<{ start: number; end: number }> = [];
  let s = p.start;
  for (const c of cuts) {
    out.push({ start: s, end: c });
    s = c;
  }
  out.push({ start: s, end: p.end });
  return out;
}

/** Headings per 10,000 characters below which a filing is treated as using run-in headings. */
const MIN_DENSITY = 1.0;

export function extractRiskHeadings(filing: ProcessedFiling, chunks: readonly Chunk[] = []): RiskHeading[] {
  if (filing.meta.filingType !== '10-K') return [];
  const section = filing.sections.find((s) => s.kind === 'risk_factors');
  if (!section) return [];
  const { text } = filing;
  const bs = blocks(text, section.start, section.end);

  // Style A: the heading is its own paragraph ("…stock price.The Company depends on…").
  // Also catches a heading that ends a paragraph after a glued group title (NVDA's first).
  const found = new Map<number, Omit<RiskHeading, 'rank' | 'chunkIds'>>();
  const ctx = { text, words: wordCounts(text) };
  let group: string | null = null;
  let lastHeadingBlock = -2;
  let lastHeadingStart = -1;
  bs.forEach((b, k) => {
    if (b.group) group = b.group;
    const next = bs[k + 1];
    if (b.text && isHeading(ctx, b, b.text, next, b.fresh)) {
      // Two one-sentence paragraphs in a row: the second restates the first (body), or the
      // first closed the previous risk and the second is the heading.
      const follows = !b.group && k === lastHeadingBlock + 1 && found.has(lastHeadingStart);
      if (follows && restates(found.get(lastHeadingStart)!.heading, b.text)) return;
      if (follows) found.delete(lastHeadingStart);
      found.set(b.start, heading(text, b.start, b.end, group));
      lastHeadingBlock = k;
      lastHeadingStart = b.start;
      return;
    }
    // Tail form: "…change in control.  Risk FactorsRisks Related to Our Industry and MarketsFailure to meet…results."
    const sentences = sentenceSpans(text, b);
    const last = sentences.at(-1);
    if (sentences.length > 1 && last) {
      const lastText = text.slice(last.start, last.end);
      const lead = lastText.length - lastText.trimStart().length;
      const prefixMatch = /^(?:Risk\s*Factors)?/.exec(lastText.trimStart())![0];
      const g = groupPrefix(lastText.trimStart().slice(prefixMatch.length));
      if (g) {
        group = g;
        const hs = last.start + lead + prefixMatch.length + g.length;
        const h = text.slice(hs, last.end).trim();
        if (isHeading(ctx, { start: hs, end: last.end }, h, next, true)) {
          found.set(hs, heading(text, hs, last.end, group));
          lastHeadingBlock = k;
        }
      } else {
        // Tail form without a group: "…industry standards. Competition could adversely impact our
        // market share and financial results.Our target markets…" (NVDA). Stricter than the other
        // forms because a body paragraph also ends with a sentence: short, a modal verb and an
        // effect, and the next block must be a multi-sentence body.
        const h = lastText.trim();
        const hs = last.start + lead;
        const nextIsBody = next !== undefined && sentenceSpans(text, next).length >= 2;
        // The last sentence of a bullet ("•A competing vertically-integrated model… Shifting a portion…") is body.
        const inBullet = /^[•▪●◦]/.test(b.text);
        if (!inBullet && h.length <= TAIL_MAX && TAIL_SHAPE.test(h) && nextIsBody && isHeading(ctx, { start: hs, end: hs + h.length }, h, next, false)) {
          found.set(hs, heading(text, hs, hs + h.length, group));
          lastHeadingBlock = k;
        }
      }
    }
  });

  // Style B: run-in headings, the first sentence of a paragraph followed by a space
  // ("Our focus on cloud-based and AI services presents execution and competitive risks. We are…").
  const density = (found.size / Math.max(1, section.end - section.start)) * 10_000;
  if (density < MIN_DENSITY) {
    group = null;
    bs.forEach((b, k) => {
      if (b.group) group = b.group;
      const sentences = sentenceSpans(text, b);
      const first = sentences[0];
      if (!first || sentences.length < 2 || found.has(b.start)) return;
      const h = text.slice(first.start, first.end).trim();
      // A run-in heading states a risk outright: a modal verb with an effect, or "risks", "depends", "exposes", "subject to".
      if (h.length <= RUN_IN_MAX && RUN_IN_PREDICATE.test(h) && isHeading(ctx, { start: first.start, end: first.start + h.length }, h, bs[k + 1] ?? b, b.fresh, first.end)) {
        found.set(first.start, heading(text, first.start, first.start + h.length, group));
      }
    });
  }

  return [...found.values()]
    .sort((x, y) => x.start - y.start)
    .map((h, i) => ({
      ...h,
      rank: i + 1,
      chunkIds: chunks.filter((c) => c.documentId === filing.meta.documentId && c.text.includes(h.heading)).map((c) => c.chunkId),
    }));
}

const TAIL_MAX = 200;
const TAIL_SHAPE = /^[A-Z][^;:,]*\b(?:could|may|might|can|would)\b[^;:]*\b(?:harm|adversely|negatively|impact|affect|disrupt|reduce|limit|damage|decline)\w*\b[^;:]*\.$/;
/** Run-in headings are shorter than whole-paragraph ones. */
const RUN_IN_MAX = 250;
const RUN_IN_PREDICATE =
  /\b(?:could|may|might|can|would|will)\s+(?:not\b|be\b|have\b|adversely|negatively|materially|significantly|harm|hurt|result|lead|cause|reduce|increase|limit|impair|affect|impact|disrupt|damage|weaken|delay|prevent|present|expose|subject|fail|decline|experience|face|incur|require|claim|lose|suffer|create)|\brisks?\b|\buncertaint|\bdepends\b|\bexposes?\b|\bsubject\s+to\b/i;
/** Opens by pointing back at the text before ("The cost of these measures…", "How these laws…"). */
const DEMONSTRATIVE = /^(?:\S+\s+){0,4}?(?:these|those|such)\s+[a-z]/i;
/** Share of a heading's content words that must recur in the text that follows it. */
const MIN_ELABORATION = 0.12;
/** "If…" opens a heading only when the body restates it this much (NVDA "If we are unable to attract…"). */
const MIN_IF_RESTATEMENT = 0.5;
const STOPWORDS = new Set(
  'that this with from have been their which could would should other such these those into about more than they them also will were there what when where while ours company company’s our products services business results operations financial condition adversely affect affected harm may can might'.split(' '),
);

function contentWords(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z][a-z’'-]{3,}/g) ?? []).map((w) => w.replace(/(?:’s|'s|s)$/, '')).filter((w) => !STOPWORDS.has(w)));
}

/** Share of `a`'s content words that occur in `b`. */
function overlap(a: string, b: string): number {
  const aw = contentWords(a);
  const bw = contentWords(b);
  return [...aw].filter((w) => bw.has(w)).length / Math.max(1, aw.size);
}

function restates(previous: string, current: string): boolean {
  return overlap(previous, current) >= 0.2;
}

/** Whole-word counts of tokens with an inner capital ("LinkedIn", "iPhone"), to tell brands from glued text. */
function wordCounts(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(/(?<![A-Za-z])[A-Za-z]*[a-z][A-Z][A-Za-z]*(?![A-Za-z])/g)) out.set(m[0], (out.get(m[0]) ?? 0) + 1);
  return out;
}

/** A word glued to the next one ("abusesFor", "ShareBasic") that the filing never uses on its own. */
function hasGlue(ctx: { words: Map<string, number> }, heading: string): boolean {
  for (const m of heading.slice(0, 120).matchAll(/(?<![A-Za-z])[A-Za-z]*[a-z][A-Z][A-Za-z]*(?![A-Za-z])/g)) {
    if ((ctx.words.get(m[0]) ?? 0) < 2) return true;
  }
  return false;
}

function heading(text: string, start: number, end: number, group: string | null): Omit<RiskHeading, 'rank' | 'chunkIds'> {
  const raw = text.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const h = raw.trim();
  return { heading: h, start: start + lead, end: start + lead + h.length, group, category: classifyRiskHeading(h) };
}

function isHeading(
  ctx: { text: string; words: Map<string, number> },
  span: { start: number; end: number },
  trimmed: string,
  next: { start: number; end: number } | undefined,
  fresh: boolean,
  headingEnd: number = span.end,
): boolean {
  const { text } = ctx;
  if (trimmed.length < MIN_HEADING || trimmed.length > MAX_HEADING) return false;
  if (!/[.?!][”"’)]?$/.test(trimmed)) return false;
  if (/^[•▪●◦\-–(“"]|^\d+\s*$/.test(trimmed) || INTRO.test(trimmed)) return false;
  if (/\balso\b/i.test(trimmed.slice(0, 60)) || BODY_REFERENCE.test(trimmed) || DEMONSTRATIVE.test(trimmed)) return false;
  // A colon followed by bullets is a lead-in to a list ("The three levels of inputs…: ▪Level 1.").
  if (/:\s*[•▪●◦]/.test(trimmed)) return false;
  // A paragraph opened by a glued subheading is body text under that subheading.
  if (SUBHEADING.test(trimmed) && (SUBHEADING.exec(trimmed)?.[0].length ?? 99) <= 70) return false;
  if (hasGlue(ctx, trimmed)) return false;
  if (!/^[A-Z]/.test(trimmed)) return false;
  if (!RISK_LANGUAGE.test(trimmed)) return false;
  if (sentenceCount(text, span) > 1) return false;
  // A heading introduces a body: the next paragraph must be prose, not another table.
  if (!next) return false;
  const nextText = text.slice(next.start, next.end).trim();
  if (isTableRow(nextText)) return false;
  // …and the body elaborates it, unless the heading opens a group or follows a page header.
  const following = text.slice(headingEnd, headingEnd + 600);
  const elaboration = overlap(trimmed, following);
  if (!fresh && elaboration < MIN_ELABORATION) return false;
  if (BODY_START.test(trimmed)) {
    // "If…" may open a heading that the body restates; every other continuation opener is body.
    if (!/^If\b/.test(trimmed) || elaboration < MIN_IF_RESTATEMENT) return false;
  }
  return true;
}

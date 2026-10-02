import { SIGNAL_CATEGORY_LABELS, type SignalCategory, type SignalType } from '@diligenceiq/core';
import { DETECTOR_STATUS } from './status';
import { type SignalChunk, dice, sectionText, sentences, topicTokens } from './text';

/**
 * Deterministic change detection and attention-signal candidates (SPEC §10–11; DD-18;
 * time-boxed in Phase 3). No model call. Every candidate carries the periods compared,
 * `evidenceByPeriod` (chunk IDs for EACH period), the measurement that triggered it, and a
 * templated, editable `investigateQuestion` (it prefills Deep Analysis and never auto-runs).
 *
 * Detectors (each can be suppressed by the Phase 3 go/no-go, `DETECTOR_STATUS`):
 * - `risk_new` (NEW) / `risk_removed` (REDUCED): risk-factor headings of consecutive 10-Ks
 *   matched by topic-token Dice ≥ HEADING_MATCH. A heading with no match is NEW only if no
 *   sentence of the other filing's Item 1A matches it either (≥ BODY_MATCH), which absorbs
 *   extractor misses and rewording; a disappearing heading is REDUCED on the same test.
 * - `risk_persistent` (PERSISTENT): a categorized heading of the latest 10-K matched in each of
 *   at least two consecutive 10-Ks through the latest. Never with a single 10-K. The chain walks
 *   every 10-K in the corpus without skipping: a 10-K with fewer than PERSISTENT_MIN_HEADINGS
 *   extracted headings (none, or a low-yield extraction) breaks it, so the claimed span is exactly
 *   the run of annual reports in which the heading was matched. A latest 10-K below the floor
 *   yields no PERSISTENT at all (its headings still appear as current risks).
 * - `emphasis_up` (EXPANDED) / `emphasis_down` (REDUCED): per-topic lexicon density in Item 1A
 *   (matches per 10K characters), like-for-like 10-K vs 10-K, past BOTH a relative and an
 *   absolute threshold, with a minimum match count.
 * - `outlook` (OUTLOOK_CHANGE): the same over MD&A with the outlook lexicons.
 * - `trend` (TREND_CHANGE): from the DD-17 trajectories, inside one filing's columns. Revenue
 *   growth emits on a change of direction (accelerating or slowing by ≥ 5 pp, or turning to a
 *   decline after growth). Margins emit on a year-over-year move of ≥ 1 pp (improving or
 *   declining), which is a material change in level, not necessarily a reversal of direction.
 *
 * Rules: 10-Q boilerplate never yields a signal (boilerplate chunks are excluded from every
 * text); risk and emphasis signals use 10-Ks only (so JNJ and XOM 10-Qs, which have no Item 1A,
 * cannot matter); a company with one 10-K gets no 10-K-vs-10-K signal, only TREND_CHANGE.
 */
export const HEADING_MATCH = 0.5;
export const BODY_MATCH = 0.6;
export const EMPHASIS_RELATIVE = 0.3;
export const EMPHASIS_ABSOLUTE = 1.0;
export const EMPHASIS_MIN_MATCHES = 5;
/**
 * PERSISTENT heading floor. The measured companies (AAPL, MSFT, NVDA) have 18–32 extracted
 * headings in every 10-K; the Phase 2 low-yield companies (XOM 3–4, GOOG 2–8, AMZN 6, KO, PFE)
 * fall below 10, where the extracted "headings" are few and unmeasured. Below the floor a 10-K
 * breaks the chain, and a latest 10-K below it yields no PERSISTENT.
 */
export const PERSISTENT_MIN_HEADINGS = 10;

export type DetectorId = 'risk_new' | 'risk_removed' | 'risk_persistent' | 'emphasis_up' | 'emphasis_down' | 'outlook' | 'trend';

/** Item 1A topic lexicons (DD-18). Matches are counted case-insensitively. */
export const RISK_LEXICONS: Readonly<Record<string, { category: SignalCategory; pattern: RegExp }>> = {
  regulatory: { category: 'regulatory', pattern: /\bregulat\w*|\blegislat\w*|\blaws?\b|\bgovernment\w*|\bantitrust\b|\bcompliance\b|\benforcement\b|\bsanctions?\b|\bexport controls?\b|\bDigital Markets Act\b/gi },
  competition: { category: 'competition', pattern: /\bcompet\w*|\brivals?\b|\bmarket share\b|\bpricing pressure\b/gi },
  supply_chain: { category: 'supply_chain', pattern: /\bsuppl(?:ier|iers|y chain|y chains)\b|\bcomponents?\b|\bmanufactur\w*|\boutsourc\w*|\bfoundr\w*|\blogistic\w*|\bshortages?\b|\b(?:single|sole)[- ]sourc\w*/gi },
  cybersecurity: { category: 'cybersecurity', pattern: /\bcyber\w*|\bsecurity (?:breach|incident|vulnerabilit)\w*|\bransomware\b|\bhack\w*|\bunauthorized access\b|\bdata breach\w*|\bmalicious\b|\bmalware\b/gi },
  litigation: { category: 'litigation', pattern: /\blitigation\b|\blawsuits?\b|\blegal proceedings?\b|\bclass actions?\b|\bplaintiffs?\b|\bsettlements?\b/gi },
  geographic_concentration: { category: 'geographic_concentration', pattern: /\bChina\b|\bTaiwan\b|\bgeopolitic\w*|\btariffs?\b|\btrade (?:restriction|dispute|tension|polic|war)\w*/gi },
  customer_concentration: {
    category: 'customer_concentration',
    pattern: /\bcustomer concentration\b|\b(?:limited|small) number of (?:customers|partners)\b|\blargest customers?\b|\bdirect customers?\b|\baccounted for (?:approximately )?\d+% of (?:our )?(?:total )?(?:revenue|net sales)\b/gi,
  },
  liquidity_debt: { category: 'liquidity', pattern: /\bliquidity\b|\bindebtedness\b|\bdebt\b|\bcredit ratings?\b|\bborrowings?\b/gi },
};

/** MD&A management-outlook lexicons (DD-18 OUTLOOK CHANGE). */
export const OUTLOOK_LEXICONS: Readonly<Record<string, { topic: string; pattern: RegExp }>> = {
  mda_demand: { topic: 'demand', pattern: /\bdemand\b/gi },
  mda_investment: { topic: 'investment and capital spending', pattern: /\binvest(?:ment|ments|ing|ed)?\b|\bcapital expenditures?\b|\bcapex\b/gi },
  mda_headwinds: { topic: 'headwinds', pattern: /\bheadwinds?\b|\bchalleng\w*|\buncertain\w*|\bpressures?\b|\binflation\w*|\bmacroeconomic\b/gi },
};

export interface SignalHeading {
  heading: string;
  category: SignalCategory | null;
  chunkIds: string[];
}

export interface SignalFiling {
  documentId: string;
  filingType: '10-K' | '10-Q';
  fiscalLabel: string;
  fiscalYear: number;
  periodEnd: string;
  /** Extracted risk-factor headings (10-Ks). */
  headings?: SignalHeading[];
}

export interface SignalTrend {
  metric: string;
  trajectory: string;
  basis: string;
  periods: string[];
  chunkIds: string[];
  values: number[];
}

export interface CompanySignalInput {
  ticker: string;
  company: string;
  filings: SignalFiling[];
  chunks: SignalChunk[];
  trends: SignalTrend[];
}

export interface SignalCandidate {
  signalId: string;
  ticker: string;
  detector: DetectorId;
  type: SignalType;
  /** Null when the heading classifier places it nowhere (Phase 4b classifies or drops it). */
  category: SignalCategory | null;
  periods: string[];
  measurement: string;
  evidenceByPeriod: Array<{ period: string; chunkIds: string[] }>;
  investigateQuestion: string;
  headline: string;
  /** The heading (risk detectors), lexicon key (emphasis, outlook) or metric (trend). */
  subject: string;
  /** PERSISTENT: the matched heading in each period, aligned with `periods`. */
  chain?: string[];
}

/** Phase 3 go/no-go (DD-18): suppressed detectors never emit. Set from the hand-labeled evaluation. */
export interface DetectorStatus {
  enabled: boolean;
  reason: string;
}

const tenKs = (input: CompanySignalInput) => input.filings.filter((f) => f.filingType === '10-K').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
const short = (s: string, n = 110) => (s.length <= n ? s : `${s.slice(0, s.lastIndexOf(' ', n))}…`);
const idSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '');
const catLabel = (c: SignalCategory | null) => (c ? SIGNAL_CATEGORY_LABELS[c].toLowerCase() : 'risk');

/** The chunk of `kind` in a filing that best matches `text` by topic tokens (evidence for "absent in this period"). */
function closestChunk(chunks: readonly SignalChunk[], documentId: string, kind: SignalChunk['sectionKind'], text: string): string[] {
  const want = topicTokens(text);
  let best: { id: string; s: number } | null = null;
  for (const c of chunks) {
    if (c.documentId !== documentId || c.sectionKind !== kind || c.boilerplate) continue;
    const s = dice(want, topicTokens(c.text));
    if (!best || s > best.s) best = { id: c.chunkId, s };
  }
  return best ? [best.id] : [];
}

/** Chunks of a section ranked by lexicon matches (evidence for emphasis signals). */
function topLexiconChunks(chunks: readonly SignalChunk[], documentId: string, kind: SignalChunk['sectionKind'], pattern: RegExp, n = 3): string[] {
  return chunks
    .filter((c) => c.documentId === documentId && c.sectionKind === kind && !c.boilerplate)
    .map((c) => ({ id: c.chunkId, m: (c.text.match(pattern) ?? []).length }))
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m || a.id.localeCompare(b.id))
    .slice(0, n)
    .map((x) => x.id);
}

export interface HeadingMatch {
  heading: SignalHeading;
  /** Best heading in the other filing and its score. */
  best: SignalHeading | null;
  score: number;
  /** Best sentence score in the other filing's Item 1A body. */
  bodyScore: number;
  matched: boolean;
  inBody: boolean;
}

export function matchHeadings(from: readonly SignalHeading[], to: readonly SignalHeading[], toBody: string): HeadingMatch[] {
  const toTokens = to.map((h) => ({ h, t: topicTokens(h.heading) }));
  const bodyTokens = sentences(toBody).map(topicTokens);
  return from.map((heading) => {
    const t = topicTokens(heading.heading);
    let best: SignalHeading | null = null;
    let score = 0;
    for (const o of toTokens) {
      const s = dice(t, o.t);
      if (s > score) [best, score] = [o.h, s];
    }
    let bodyScore = 0;
    if (score < HEADING_MATCH) for (const b of bodyTokens) bodyScore = Math.max(bodyScore, dice(t, b));
    return { heading, best, score, bodyScore, matched: score >= HEADING_MATCH, inBody: bodyScore >= BODY_MATCH };
  });
}

export interface PairSignals {
  earlier: SignalFiling;
  later: SignalFiling;
  candidates: SignalCandidate[];
}

export interface EmphasisThresholds {
  relative: number;
  absolute: number;
  minMatches: number;
}
export const DEFAULT_EMPHASIS: EmphasisThresholds = { relative: EMPHASIS_RELATIVE, absolute: EMPHASIS_ABSOLUTE, minMatches: EMPHASIS_MIN_MATCHES };

/** NEW, REDUCED (heading), EXPANDED/REDUCED (emphasis), OUTLOOK_CHANGE for one 10-K pair. */
export function detectPair(input: CompanySignalInput, earlier: SignalFiling, later: SignalFiling, th: EmphasisThresholds = DEFAULT_EMPHASIS): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  const { ticker, company, chunks } = input;
  const periods = [earlier.fiscalLabel, later.fiscalLabel];
  const earlierRisk = sectionText(chunks, earlier.documentId, 'risk_factors');
  const laterRisk = sectionText(chunks, later.documentId, 'risk_factors');
  const eh = earlier.headings ?? [];
  const lh = later.headings ?? [];
  let n = 0;
  const id = (type: string, key: string) => `${ticker}-${type}-${idSafe(key)}-${later.fiscalLabel}-${++n}`;

  if (eh.length && lh.length) {
    for (const m of matchHeadings(lh, eh, earlierRisk)) {
      if (m.matched || m.inBody) continue;
      out.push({
        signalId: id('NEW', m.heading.category ?? 'risk'),
        ticker,
        detector: 'risk_new',
        type: 'NEW',
        category: m.heading.category,
        periods,
        measurement: `Risk factor in the ${later.fiscalLabel} annual report with no counterpart in ${earlier.fiscalLabel}: best heading match ${m.score.toFixed(2)} and best sentence match ${m.bodyScore.toFixed(2)}, both below the thresholds (${HEADING_MATCH} heading, ${BODY_MATCH} sentence; topic-word Dice).`,
        evidenceByPeriod: [
          { period: earlier.fiscalLabel, chunkIds: closestChunk(chunks, earlier.documentId, 'risk_factors', m.heading.heading) },
          { period: later.fiscalLabel, chunkIds: m.heading.chunkIds },
        ],
        investigateQuestion: `What is the new ${catLabel(m.heading.category)} risk ${company} added in its ${later.fiscalLabel} annual report (“${short(m.heading.heading)}”), and what actions does management describe?`,
        headline: `New ${catLabel(m.heading.category)} risk disclosed in ${later.fiscalLabel}`,
        subject: m.heading.heading,
      });
    }
    for (const m of matchHeadings(eh, lh, laterRisk)) {
      if (m.matched || m.inBody) continue;
      out.push({
        signalId: id('REDUCED', m.heading.category ?? 'risk'),
        ticker,
        detector: 'risk_removed',
        type: 'REDUCED',
        category: m.heading.category,
        periods,
        measurement: `Risk factor in the ${earlier.fiscalLabel} annual report with no counterpart in ${later.fiscalLabel}: best heading match ${m.score.toFixed(2)} and best sentence match ${m.bodyScore.toFixed(2)}, both below the thresholds (${HEADING_MATCH} heading, ${BODY_MATCH} sentence; topic-word Dice).`,
        evidenceByPeriod: [
          { period: earlier.fiscalLabel, chunkIds: m.heading.chunkIds },
          { period: later.fiscalLabel, chunkIds: closestChunk(chunks, later.documentId, 'risk_factors', m.heading.heading) },
        ],
        investigateQuestion: `${company}'s ${later.fiscalLabel} annual report no longer has the ${earlier.fiscalLabel} risk factor “${short(m.heading.heading)}”. What changed, and does the risk still apply?`,
        headline: `${earlier.fiscalLabel} ${catLabel(m.heading.category)} risk no longer listed in ${later.fiscalLabel}`,
        subject: m.heading.heading,
      });
    }
  }

  if (earlierRisk.length && laterRisk.length) {
    for (const [key, lex] of Object.entries(RISK_LEXICONS)) {
      const a = (earlierRisk.match(lex.pattern) ?? []).length;
      const b = (laterRisk.match(lex.pattern) ?? []).length;
      const da = (a / earlierRisk.length) * 10_000;
      const db = (b / laterRisk.length) * 10_000;
      const rel = da > 0 ? (db - da) / da : db > 0 ? Infinity : 0;
      const up = rel >= th.relative && db - da >= th.absolute && b >= th.minMatches;
      const down = rel <= -th.relative && da - db >= th.absolute && a >= th.minMatches;
      if (!up && !down) continue;
      const label = SIGNAL_CATEGORY_LABELS[lex.category].toLowerCase();
      const what = key === 'liquidity_debt' ? 'liquidity and debt' : label;
      out.push({
        signalId: id(up ? 'EXPANDED' : 'REDUCED', key),
        ticker,
        detector: up ? 'emphasis_up' : 'emphasis_down',
        type: up ? 'EXPANDED' : 'REDUCED',
        category: lex.category,
        periods,
        measurement: `${what} terms in Item 1A: ${da.toFixed(2)} → ${db.toFixed(2)} per 10,000 characters (${a} → ${b} matches; ${(rel * 100).toFixed(0)}%); thresholds ±${th.relative * 100}% and ±${th.absolute.toFixed(1)} per 10,000 characters, at least ${th.minMatches} matches.`,
        evidenceByPeriod: [
          { period: earlier.fiscalLabel, chunkIds: topLexiconChunks(chunks, earlier.documentId, 'risk_factors', lex.pattern) },
          { period: later.fiscalLabel, chunkIds: topLexiconChunks(chunks, later.documentId, 'risk_factors', lex.pattern) },
        ],
        investigateQuestion: up
          ? `Why did ${company} expand its discussion of ${what} risk in its ${later.fiscalLabel} annual report compared with ${earlier.fiscalLabel}, and what actions does management describe?`
          : `Why did ${company} discuss ${what} risk less in its ${later.fiscalLabel} annual report than in ${earlier.fiscalLabel}, and has the exposure changed?`,
        headline: `${what[0]!.toUpperCase()}${what.slice(1)} disclosure ${up ? 'expanded' : 'reduced'} in ${later.fiscalLabel}`,
        subject: key,
      });
    }
  }

  const earlierMda = sectionText(chunks, earlier.documentId, 'mda');
  const laterMda = sectionText(chunks, later.documentId, 'mda');
  if (earlierMda.length && laterMda.length) {
    for (const [key, lex] of Object.entries(OUTLOOK_LEXICONS)) {
      const a = (earlierMda.match(lex.pattern) ?? []).length;
      const b = (laterMda.match(lex.pattern) ?? []).length;
      const da = (a / earlierMda.length) * 10_000;
      const db = (b / laterMda.length) * 10_000;
      const rel = da > 0 ? (db - da) / da : db > 0 ? Infinity : 0;
      const up = rel >= th.relative && db - da >= th.absolute && b >= th.minMatches;
      const down = rel <= -th.relative && da - db >= th.absolute && a >= th.minMatches;
      if (!up && !down) continue;
      out.push({
        signalId: id('OUTLOOK', key),
        ticker,
        detector: 'outlook',
        type: 'OUTLOOK_CHANGE',
        category: 'management_outlook',
        periods,
        measurement: `Management discussion of ${lex.topic}: ${da.toFixed(2)} → ${db.toFixed(2)} terms per 10,000 characters of MD&A (${a} → ${b}; ${(rel * 100).toFixed(0)}%); thresholds ±${th.relative * 100}% and ±${th.absolute.toFixed(1)}, at least ${th.minMatches} matches.`,
        evidenceByPeriod: [
          { period: earlier.fiscalLabel, chunkIds: topLexiconChunks(chunks, earlier.documentId, 'mda', lex.pattern) },
          { period: later.fiscalLabel, chunkIds: topLexiconChunks(chunks, later.documentId, 'mda', lex.pattern) },
        ],
        investigateQuestion: `How has ${company}'s management commentary on ${lex.topic} changed between its ${earlier.fiscalLabel} and ${later.fiscalLabel} annual reports?`,
        headline: `Management ${up ? 'discusses' : 'says less about'} ${lex.topic} ${up ? 'more ' : ''}in ${later.fiscalLabel}`,
        subject: key,
      });
    }
  }
  return out;
}

/**
 * PERSISTENT: categorized headings of the latest 10-K matched in each consecutive 10-K before it
 * (streak ≥ 2 filings). Every 10-K counts: one with fewer than `minHeadings` extracted headings
 * breaks the chain instead of being skipped.
 */
export function detectPersistent(input: CompanySignalInput, minHeadings = PERSISTENT_MIN_HEADINGS): SignalCandidate[] {
  const ks = tenKs(input);
  if (ks.length < 2) return [];
  const usable = (k: SignalFiling) => (k.headings?.length ?? 0) >= Math.max(1, minHeadings);
  const latest = ks.at(-1)!;
  if (!usable(latest)) return [];
  const out: SignalCandidate[] = [];
  let n = 0;
  for (const h of latest.headings!) {
    if (!h.category) continue;
    const chain: Array<{ filing: SignalFiling; heading: SignalHeading }> = [{ filing: latest, heading: h }];
    for (let i = ks.length - 2; i >= 0; i--) {
      const prev = ks[i]!;
      if (!usable(prev)) break;
      const cur = chain[0]!.heading;
      const m = matchHeadings([cur], prev.headings!, '')[0]!;
      if (!m.matched || !m.best) break;
      chain.unshift({ filing: prev, heading: m.best });
    }
    if (chain.length < 2) continue;
    const first = chain[0]!.filing.fiscalLabel;
    out.push({
      signalId: `${input.ticker}-PERSISTENT-${h.category}-${latest.fiscalLabel}-${++n}`,
      ticker: input.ticker,
      detector: 'risk_persistent',
      type: 'PERSISTENT',
      category: h.category,
      periods: chain.map((c) => c.filing.fiscalLabel),
      measurement: `The same risk-factor heading was matched in each of ${chain.length} consecutive annual reports in the corpus (${first}–${latest.fiscalLabel}); each heading matches the next at topic-word Dice ≥ ${HEADING_MATCH}.`,
      evidenceByPeriod: chain.map((c) => ({ period: c.filing.fiscalLabel, chunkIds: c.heading.chunkIds })),
      investigateQuestion: `How has ${input.company}'s disclosure of the ${catLabel(h.category)} risk “${short(h.heading)}” evolved from ${first} to ${latest.fiscalLabel}, and what is management doing about it?`,
      headline: `${SIGNAL_CATEGORY_LABELS[h.category]} risk matched in each annual report ${first}–${latest.fiscalLabel}`,
      subject: h.heading,
      chain: chain.map((c) => c.heading.heading),
    });
  }
  return out;
}

const METRIC_LABEL: Record<string, string> = {
  revenue_growth: 'revenue growth',
  gross_margin: 'gross margin',
  operating_margin: 'operating margin',
  net_margin: 'net margin',
};

/** TREND_CHANGE from DD-17 trajectories: a growth change of direction, or a margin move of ≥ 1 pp; never a steady state. */
export function detectTrends(input: CompanySignalInput): SignalCandidate[] {
  const out: SignalCandidate[] = [];
  let n = 0;
  for (const t of input.trends) {
    const label = METRIC_LABEL[t.metric];
    if (!label) continue;
    const growth = t.metric === 'revenue_growth';
    let headline: string | null = null;
    let question: string | null = null;
    const latest = t.periods.at(-1)!;
    if (growth && (t.trajectory === 'slowing' || t.trajectory === 'accelerating')) {
      headline = `Revenue growth ${t.trajectory === 'slowing' ? 'slowed' : 'accelerated'} in ${latest}`;
      question = `What explains the ${t.trajectory === 'slowing' ? 'slowdown' : 'acceleration'} in ${input.company}'s revenue growth in ${latest}, and what does management expect next?`;
    } else if (growth && t.trajectory === 'declining' && t.values.length >= 3 && t.values[1]! >= t.values[0]!) {
      headline = `Revenue turned to decline in ${latest}`;
      question = `What drove the decline in ${input.company}'s revenue in ${latest} after growth the year before, and what does management expect next?`;
    } else if (!growth && (t.trajectory === 'improving' || t.trajectory === 'declining')) {
      headline = `${label[0]!.toUpperCase()}${label.slice(1)} ${t.trajectory === 'improving' ? 'improved' : 'declined'} in ${latest}`;
      question = `What drove the ${t.trajectory === 'improving' ? 'improvement' : 'decline'} in ${input.company}'s ${label} in ${latest}?`;
    }
    if (!headline || !question) continue;
    out.push({
      signalId: `${input.ticker}-TREND-${t.metric}-${latest}-${++n}`,
      ticker: input.ticker,
      detector: 'trend',
      type: 'TREND_CHANGE',
      category: growth ? 'growth' : 'margin',
      periods: t.periods,
      measurement: t.basis,
      // In-filing comparison: one filing's multi-year columns carry every period (DD-18).
      evidenceByPeriod: t.periods.map((p) => ({ period: p, chunkIds: t.chunkIds })),
      investigateQuestion: question,
      headline,
      subject: t.metric,
    });
  }
  return out;
}

export interface DetectOptions {
  /** 'latest': only the latest 10-K pair (the dashboard); 'all': every consecutive pair (evaluation). */
  pairs?: 'latest' | 'all';
  /** Defaults to the Phase 3 go/no-go (`DETECTOR_STATUS`): suppressed detectors never emit. */
  status?: Readonly<Record<DetectorId, DetectorStatus>>;
  /** Evaluation only: emit suppressed detectors too, to measure them. Never set by the product. */
  includeSuppressed?: boolean;
  /** Evaluation only (the sensitivity table); the product uses the defaults. */
  emphasis?: EmphasisThresholds;
  /** Tests only (small fixtures); the product uses PERSISTENT_MIN_HEADINGS. */
  persistentMinHeadings?: number;
}

export function detectCompanySignals(input: CompanySignalInput, options: DetectOptions = {}): SignalCandidate[] {
  const ks = tenKs(input);
  const pairs: Array<[SignalFiling, SignalFiling]> = [];
  for (let i = 1; i < ks.length; i++) pairs.push([ks[i - 1]!, ks[i]!]);
  const chosen = options.pairs === 'all' ? pairs : pairs.slice(-1);
  const all = [...chosen.flatMap(([a, b]) => detectPair(input, a, b, options.emphasis)), ...detectPersistent(input, options.persistentMinHeadings), ...detectTrends(input)];
  if (options.includeSuppressed) return all;
  const status = options.status ?? DETECTOR_STATUS;
  return all.filter((c) => status[c.detector].enabled);
}

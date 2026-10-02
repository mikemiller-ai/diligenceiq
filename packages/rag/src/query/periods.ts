import type { CatalogCompany, CatalogFiling } from './catalog';

/**
 * Deterministic period parsing and per-company resolution (SPEC §26.3; assumptions C1, C5).
 *
 * Parsing (regex only):
 * - explicit fiscal years: "FY2024", "FY24" (two digits need FY), "fiscal 2024", "fiscal year
 *   2024", and a bare "2024" only in a time phrase ("in 2024", "the 2024 10-K"; see
 *   `timePhraseYears`);
 * - ranges: "2023-2025", "2023 to 2025", "from 2023 through 2025", "between 2023 and 2025";
 * - open ranges: "since 2023", "from 2023 onward", "after 2022" (exclusive);
 * - relative: "last two years", "past 3 years", "previous year", "last year", "last couple of
 *   years" (2), "last few years" / "recent years" (3, flagged as an assumption), "year over
 *   year" / "compared with the prior year" with no year named (2, flagged);
 * - quarters: "Q3 2025", "Q3 FY2025", "third quarter of 2025" (fiscal labels).
 * Years are FISCAL years, the companies' own labels (NVDA's FY2025 ended 2025-01-26).
 *
 * Resolution, per company and corpus-relative (never relative to today):
 * - **No period named ("current view", C5):** the latest 10-K plus the 10-Qs that end after
 *   it. A CHANGE question naming no period is not a current view: the analyzer reads it as the
 *   last 3 annual reports (`last_n`, `changeDefault`; SPEC §26.3). JPM → its FY2025 10-K only (its 10-Qs precede it); MCD and PEP drop their stray 2023
 *   10-Qs.
 * - **Last N years (C1):** the N most recent complete fiscal years by 10-K, plus any later
 *   10-Qs shown separately as "FY<next> YTD". NVDA "last two years" → FY2024, FY2025 and
 *   FY2026 YTD (Q1–Q3). Fewer 10-Ks than N is a stated gap, never padded.
 * - **Explicit years:** per fiscal year, the 10-K when the corpus has it, otherwise that
 *   year's 10-Qs as "FY<year> YTD"; a year with neither is a stated gap.
 * - **Since Y:** every fiscal year from Y through the company's latest, resolved as above.
 * - **Quarters:** that fiscal quarter's 10-Q; Q4 has no 10-Q, so it resolves to the 10-K.
 * - **Filter range** (fiscalYearFrom / fiscalYearTo, from the UI): the company's fiscal years
 *   inside the range, resolved like explicit years; a gap only when none is in the corpus.
 * - A filing-type filter ("10-K", "annual report", "10-Q", "quarterly") applies after
 *   resolution. "Quarterly" with no period uses the 10-Qs after the latest 10-K, or else the
 *   latest fiscal year's 10-Qs.
 */
export type PeriodSpec =
  | { kind: 'current' }
  /** `changeDefault`: set by the analyzer for a change question naming no period (SPEC §26.3), not parsed from a phrase. */
  | { kind: 'last_n'; n: number; phrase: string; assumption?: string; changeDefault?: boolean }
  | { kind: 'years'; years: number[]; phrase: string }
  | { kind: 'since'; from: number; phrase: string }
  | { kind: 'quarters'; quarters: Array<{ fiscalYear: number; quarter: number }>; phrase: string }
  /** A user filter (fiscalYearFrom / fiscalYearTo): clamped to each company's own filings; a gap only when nothing is left. */
  | { kind: 'range'; from: number | null; to: number | null; phrase: string };

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4 };
/** Fiscal years 1990–2039 only, so counts such as "2,000 stores" or "5000 units" are not years. */
const YEAR = '(?:FY\\s?|fiscal\\s+(?:year\\s+)?)?(199\\d|20[0-3]\\d)';

/**
 * Two-digit fiscal years need the FY prefix ("FY23", "FY 23", "FY'23" → FY2023; "FY99" →
 * FY1999). A bare two-digit number is never a year.
 */
export function normalizeFiscalYears(question: string): string {
  return question.replace(/\bFY\s?['’]?(\d{2})(?!\d)/gi, (_m, d: string) => `FY${Number(d) >= 90 ? '19' : '20'}${d}`);
}

/**
 * Bare years count as periods only in a time phrase (B1), so a year inside a name or a passing
 * mention ("the Inflation Reduction Act of 2022", "its 2030 commitment") is not a hard scope:
 * - an FY / fiscal prefix ("FY2024", "fiscal 2024") always counts;
 * - a temporal preposition before it: in, for, during, throughout, through, until, by, before,
 *   as of, (at the) end of, ending, ended, calendar / fiscal year;
 * - a filing word after it: "2024 10-K", "2024 annual report", "2024 filing", "2024 results";
 * - a list joined to a counted year: "2022 and 2024", "2023 vs 2024", "2023, 2024 annual reports".
 * A year that dates an event ("launched in 2020", "enacted in 2022", "acquired in 2019")
 * dates the event, not a reporting period, and does not count. A counted year with no filing
 * for any named company falls back to the current view, stated (see `QueryAnalyzer`).
 */
const TIME_BEFORE = /(?:\b(?:in|for|during|throughout|through|thru|until|by|before|as\s+of|end\s+of|ending|ended|calendar(?:\s+year)?|fiscal\s+year)\s+(?:the\s+)?(?:(?:calendar|fiscal)\s+(?:year\s+)?)?)$/i;
const FILING_AFTER = /^\s*(?:10-?[KQ]\b|form\s+10|annual\s+(?:reports?|filings?|results)|(?:quarterly\s+)?(?:filings?|results|reports?)\b|financial\s+(?:statements|results)|fiscal\s+year\b)/i;
const LIST_JOIN = /^\s*(?:,\s*(?:and\s+|or\s+)?|and|or|&|vs\.?|versus|compared\s+(?:with|to))\s*$/i;
const EVENT_BEFORE = /\b(?:launched|founded|acquired|enacted|introduced|established|incorporated|signed|passed|began|started|formed|created|adopted|opened|spun\s+off|went\s+public)\s+(?:in\s+)?$/i;

interface YearMention {
  year: number;
  text: string;
  start: number;
  end: number;
}

function timePhraseYears(q: string): { counted: YearMention[]; ignored: YearMention[] } {
  const mentions: YearMention[] = [...q.matchAll(new RegExp(`(?<![\\d$.,])\\b${YEAR}\\b(?!\\d|[.,]\\d)`, 'gi'))].map((m) => ({
    year: Number(m[1]),
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
  const counted = mentions.map((m) => {
    if (/^(?:FY|fiscal)/i.test(m.text)) return true;
    const before = q.slice(Math.max(0, m.start - 40), m.start);
    if (EVENT_BEFORE.test(before)) return false;
    return TIME_BEFORE.test(before) || FILING_AFTER.test(q.slice(m.end, m.end + 40));
  });
  // Propagate along lists in both directions until stable ("2022 and 2024", "2023 and 2024 annual reports").
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < mentions.length; i++) {
      if (counted[i]) continue;
      const prev = i > 0 && counted[i - 1] && LIST_JOIN.test(q.slice(mentions[i - 1]!.end, mentions[i]!.start));
      const next = i + 1 < mentions.length && counted[i + 1] && LIST_JOIN.test(q.slice(mentions[i]!.end, mentions[i + 1]!.start));
      if ((prev || next) && !EVENT_BEFORE.test(q.slice(Math.max(0, mentions[i]!.start - 40), mentions[i]!.start))) {
        counted[i] = true;
        changed = true;
      }
    }
  }
  return { counted: mentions.filter((_, i) => counted[i]), ignored: mentions.filter((_, i) => !counted[i]) };
}

/** "Year over year", "compared with the prior year": two fiscal years when no other period is named. */
const YOY = /\byear[- ](?:over|on)[- ]year\b|\b(?:compared?|relative|versus|vs\.?)\s+(?:(?:with|to)\s+)?(?:the\s+)?(?:prior|previous|preceding)\s+(?:fiscal\s+)?year\b/i;

export interface ParsedPeriod {
  spec: PeriodSpec;
  /** Year-like tokens not read as periods (outside a time phrase), for the Interpretation panel. */
  ignoredYears: string[];
}

export function parsePeriod(question: string): PeriodSpec {
  return parsePeriodDetailed(question).spec;
}

export function parsePeriodDetailed(question: string): ParsedPeriod {
  const q = normalizeFiscalYears(question);
  const quarterRe = new RegExp(`\\bQ([1-4])\\s*(?:of\\s+)?${YEAR}\\b|\\b(first|second|third|fourth)\\s+(?:fiscal\\s+)?quarter\\s+(?:of\\s+)?${YEAR}\\b`, 'gi');
  const quarters: Array<{ fiscalYear: number; quarter: number }> = [];
  const qPhrases: string[] = [];
  for (const m of q.matchAll(quarterRe)) {
    const quarter = m[1] ? Number(m[1]) : ORDINALS[m[3]!.toLowerCase()]!;
    const fiscalYear = Number(m[2] ?? m[4]);
    quarters.push({ fiscalYear, quarter });
    qPhrases.push(m[0]);
  }
  if (quarters.length) return { spec: { kind: 'quarters', quarters, phrase: qPhrases.join(', ') }, ignoredYears: [] };

  let range = new RegExp(`\\b(?:from\\s+|between\\s+)?${YEAR}\\s*(?:-|–|—|to|through|thru|until)\\s*${YEAR}\\b|\\bbetween\\s+${YEAR}\\s+and\\s+${YEAR}\\b`, 'i').exec(q);
  // A dash-only range ("2025-2030") is a period only in a time phrase, like a bare year (B1):
  // "Apple's 2025-2030 sustainability goals" names a plan, not a reporting period. "from …",
  // "between …" and "to / through / until" ranges are time phrases by themselves.
  const dashOnly = range && !/^(?:from|between)\b/i.test(range[0]) && !/\b(?:to|through|thru|until)\b/i.test(range[0]);
  if (range && dashOnly) {
    const before = q.slice(Math.max(0, range.index - 40), range.index);
    const after = q.slice(range.index + range[0].length, range.index + range[0].length + 40);
    if (EVENT_BEFORE.test(before) || !(TIME_BEFORE.test(before) || FILING_AFTER.test(after))) range = null;
  }
  if (range) {
    const a = Number(range[1] ?? range[3]);
    const b = Number(range[2] ?? range[4]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const years: number[] = [];
    for (let y = lo; y <= hi && years.length < 30; y++) years.push(y);
    return { spec: { kind: 'years', years, phrase: range[0] }, ignoredYears: [] };
  }

  const since = new RegExp(`\\b(since|after|from)\\s+${YEAR}(?:\\s+(?:on(?:ward)?s?|forward))?\\b`, 'i').exec(q);
  if (since && (since[1]!.toLowerCase() !== 'from' || /\bon(?:ward)?s?\b|\bforward\b/i.test(since[0]))) {
    const y = Number(since[2]);
    return { spec: { kind: 'since', from: since[1]!.toLowerCase() === 'after' ? y + 1 : y, phrase: since[0] }, ignoredYears: [] };
  }

  const { counted, ignored } = timePhraseYears(q);
  const ignoredYears = ignored.map((m) => m.text);
  const yoy = YOY.exec(q);
  if (yoy && !counted.length) {
    return { spec: { kind: 'last_n', n: 2, phrase: yoy[0], assumption: `"${yoy[0]}" with no year named: read as the last 2 fiscal years.` }, ignoredYears };
  }
  // A year-over-year phrase is not itself a "prior year" period.
  const rest = yoy ? q.slice(0, yoy.index) + ' '.repeat(yoy[0].length) + q.slice(yoy.index + yoy[0].length) : q;

  const lastN = /\b(?:last|past|previous|prior|recent|most recent)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|couple(?:\s+of)?|few|several)?\s*(?:fiscal\s+)?(years?)\b/i.exec(rest);
  if (lastN) {
    const word = (lastN[1] ?? '').toLowerCase().replace(/\s+of$/, '');
    if (!word) {
      // "recent years", "past years": plural with no count is vague; "last year" is one.
      if (lastN[2]!.toLowerCase() === 'years') {
        return { spec: { kind: 'last_n', n: 3, phrase: lastN[0], assumption: `"${lastN[0]}" is vague; read as the last 3 fiscal years.` }, ignoredYears };
      }
      return { spec: { kind: 'last_n', n: 1, phrase: lastN[0] }, ignoredYears };
    }
    if (word.startsWith('couple')) return { spec: { kind: 'last_n', n: 2, phrase: lastN[0] }, ignoredYears };
    if (word === 'few' || word === 'several') {
      return { spec: { kind: 'last_n', n: 3, phrase: lastN[0], assumption: `"${lastN[0]}" is vague; read as the last 3 fiscal years.` }, ignoredYears };
    }
    const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word]!;
    if (n >= 1) return { spec: { kind: 'last_n', n: Math.min(n, 10), phrase: lastN[0] }, ignoredYears };
  }

  if (counted.length) {
    const uniq = [...new Set(counted.map((y) => y.year))].sort((a, b) => a - b);
    return { spec: { kind: 'years', years: uniq, phrase: counted.map((y) => y.text).join(', ') }, ignoredYears };
  }
  return { spec: { kind: 'current' }, ignoredYears };
}

export type FilingTypeFilter = '10-K' | '10-Q';

export function parseFilingTypes(question: string): FilingTypeFilter[] {
  const out = new Set<FilingTypeFilter>();
  if (/\b10-?K\b|\bannual (?:reports?|filings?)\b|\bForm 10-K\b/i.test(question)) out.add('10-K');
  if (/\b10-?Q\b|\bquarterly (?:reports?|filings?|results)\b/i.test(question)) out.add('10-Q');
  // Both named means no filter.
  return out.size === 2 ? [] : [...out];
}

/** One period bucket of a resolved company scope: a fiscal year (10-K) or a YTD/quarter group of 10-Qs. */
export interface PeriodBucket {
  /** "FY2025", "FY2026 YTD", "FY2025Q3". */
  label: string;
  fiscalYear: number;
  documentIds: string[];
}

export interface ResolvedScope {
  ticker: string;
  buckets: PeriodBucket[];
  documentIds: string[];
  /** Plain statement of the resolution for the Interpretation panel. */
  description: string;
  gaps: string[];
}

const tenKs = (c: CatalogCompany) => c.filings.filter((f) => f.filingType === '10-K');
const tenQs = (c: CatalogCompany) => c.filings.filter((f) => f.filingType === '10-Q');

function bucketOf(label: string, fiscalYear: number, filings: readonly CatalogFiling[]): PeriodBucket {
  return { label, fiscalYear, documentIds: filings.map((f) => f.documentId) };
}

function yearBucket(c: CatalogCompany, year: number, types: readonly FilingTypeFilter[]): PeriodBucket | null {
  const k = tenKs(c).find((f) => f.fiscalYear === year);
  const qs = tenQs(c).filter((f) => f.fiscalYear === year);
  const wantK = types.length === 0 || types.includes('10-K');
  const wantQ = types.includes('10-Q');
  if (wantQ && !wantK) return qs.length ? bucketOf(k ? `FY${year} quarters` : `FY${year} YTD`, year, qs) : null;
  if (k) return bucketOf(`FY${year}`, year, [k]);
  if (!wantK || types.length === 0) return qs.length ? bucketOf(`FY${year} YTD`, year, qs) : null;
  return null;
}

/** 10-Qs that end after the latest 10-K, grouped by fiscal year ("FY2026 YTD"). */
function ytdAfter(c: CatalogCompany, afterPeriodEnd: string): PeriodBucket[] {
  const later = tenQs(c).filter((f) => f.periodEnd > afterPeriodEnd);
  const byYear = new Map<number, CatalogFiling[]>();
  for (const f of later) byYear.set(f.fiscalYear, [...(byYear.get(f.fiscalYear) ?? []), f]);
  return [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([y, fs]) => bucketOf(`FY${y} YTD`, y, fs));
}

function finish(ticker: string, buckets: PeriodBucket[], description: string, gaps: string[]): ResolvedScope {
  const nonEmpty = buckets.filter((b) => b.documentIds.length > 0);
  return { ticker, buckets: nonEmpty, documentIds: nonEmpty.flatMap((b) => b.documentIds), description, gaps };
}

/**
 * The gap for "last N years" with fewer 10-Ks. The change default (SPEC §26.3) was not
 * requested by the user, so its gap says what is missing without "requested".
 */
function lastNGap(t: string, take: readonly CatalogFiling[], spec: Extract<PeriodSpec, { kind: 'last_n' }>): string {
  const labels = take.map((k) => k.fiscalLabel).join(', ');
  if (spec.changeDefault) {
    return take.length === 1
      ? `${t}: only 1 annual report in the corpus (${labels}), so change over time cannot be shown.`
      : `${t}: only ${take.length} annual reports in the corpus (${labels}), not ${spec.n}.`;
  }
  return `${t}: only ${take.length} of the ${spec.n} requested fiscal years ${take.length === 1 ? 'has' : 'have'} an annual report in the corpus (${labels}).`;
}

export function resolvePeriod(company: CatalogCompany, spec: PeriodSpec, types: readonly FilingTypeFilter[] = []): ResolvedScope {
  const t = company.ticker;
  const ks = tenKs(company);
  const latestK = ks.at(-1);
  const onlyQ = types.length === 1 && types[0] === '10-Q';
  const onlyK = types.length === 1 && types[0] === '10-K';

  switch (spec.kind) {
    case 'current': {
      if (onlyQ) {
        const after = latestK ? ytdAfter(company, latestK.periodEnd) : [];
        if (after.length) return finish(t, after, `${t}: quarterly reports after the latest annual report.`, []);
        const lastYear = tenQs(company).at(-1)?.fiscalYear;
        const qs = tenQs(company).filter((f) => f.fiscalYear === lastYear);
        if (!qs.length) return finish(t, [], `${t}: no quarterly reports in the corpus.`, [`${t}: no quarterly reports in the corpus.`]);
        return finish(t, [bucketOf(`FY${lastYear} quarters`, lastYear!, qs)], `${t}: the latest fiscal year's quarterly reports.`, []);
      }
      if (!latestK) {
        const qs = tenQs(company);
        const y = qs.at(-1)?.fiscalYear;
        return finish(t, y ? [bucketOf(`FY${y} YTD`, y, qs.filter((f) => f.fiscalYear === y))] : [], `${t}: no annual report in the corpus; latest quarterly reports.`, [`${t}: no annual report in the corpus.`]);
      }
      const buckets = [bucketOf(latestK.fiscalLabel, latestK.fiscalYear, [latestK]), ...(onlyK ? [] : ytdAfter(company, latestK.periodEnd))];
      const ytd = buckets.slice(1).map((b) => b.label);
      return finish(t, buckets, `${t}: current view, the latest annual report (${latestK.fiscalLabel})${ytd.length ? ` plus later quarterly reports (${ytd.join(', ')})` : ''}.`, []);
    }
    case 'last_n': {
      const take = ks.slice(-spec.n);
      const gaps = take.length < spec.n && take.length ? [lastNGap(t, take, spec)] : [];
      if (!take.length) return finish(t, [], `${t}: no annual report in the corpus.`, [`${t}: no annual report in the corpus.`]);
      const buckets: PeriodBucket[] = onlyQ
        ? take.map((k) => yearBucket(company, k.fiscalYear, types)).filter((b): b is PeriodBucket => b !== null)
        : take.map((k) => bucketOf(k.fiscalLabel, k.fiscalYear, [k]));
      const ytd = onlyK ? [] : ytdAfter(company, take.at(-1)!.periodEnd);
      const labels = take.map((k) => k.fiscalLabel).join(', ');
      return finish(
        t,
        [...buckets, ...ytd],
        `${t}: last ${spec.n} complete fiscal year${spec.n === 1 ? '' : 's'} (${labels})${ytd.length ? `, plus ${ytd.map((b) => b.label).join(', ')} shown separately` : ''}.`,
        gaps,
      );
    }
    case 'years':
    case 'since': {
      const latestYear = company.filings.reduce((m, f) => Math.max(m, f.fiscalYear), 0);
      const years =
        spec.kind === 'years' ? spec.years : Array.from({ length: Math.max(0, latestYear - spec.from + 1) }, (_, i) => spec.from + i);
      const buckets: PeriodBucket[] = [];
      const gaps: string[] = [];
      for (const y of years) {
        const b = yearBucket(company, y, types);
        if (b) buckets.push(b);
        else gaps.push(`${t}: no FY${y} ${onlyK ? 'annual report' : onlyQ ? 'quarterly report' : 'filing'} in the corpus.`);
      }
      if (spec.kind === 'since' && years.length === 0) gaps.push(`${t}: no filings from FY${spec.from} on in the corpus.`);
      const what = spec.kind === 'since' ? `fiscal years since FY${spec.from}` : `fiscal year${years.length === 1 ? '' : 's'} ${years.map((y) => `FY${y}`).join(', ')}`;
      return finish(t, buckets, `${t}: ${what} (${buckets.map((b) => b.label).join(', ') || 'none in the corpus'}).`, gaps);
    }
    case 'range': {
      const years = [...new Set(company.filings.map((f) => f.fiscalYear))].filter((y) => (spec.from === null || y >= spec.from) && (spec.to === null || y <= spec.to)).sort((a, b) => a - b);
      const buckets = years.map((y) => yearBucket(company, y, types)).filter((b): b is PeriodBucket => b !== null);
      const span = `${spec.from === null ? '…' : `FY${spec.from}`}–${spec.to === null ? '…' : `FY${spec.to}`}`;
      const gaps = buckets.length ? [] : [`${t}: no filings in ${span} in the corpus.`];
      return finish(t, buckets, `${t}: fiscal-year filter ${span} (${buckets.map((b) => b.label).join(', ') || 'none in the corpus'}).`, gaps);
    }
    case 'quarters': {
      const buckets: PeriodBucket[] = [];
      const gaps: string[] = [];
      for (const { fiscalYear, quarter } of spec.quarters) {
        if (quarter === 4) {
          const k = ks.find((f) => f.fiscalYear === fiscalYear);
          if (k && !onlyQ) buckets.push(bucketOf(k.fiscalLabel, fiscalYear, [k]));
          else gaps.push(`${t}: FY${fiscalYear}Q4 has no quarterly report (it is covered by the annual report)${k ? '' : ', and that annual report is not in the corpus'}.`);
          continue;
        }
        const q = tenQs(company).find((f) => f.fiscalYear === fiscalYear && f.fiscalQuarter === quarter);
        if (q && !onlyK) buckets.push(bucketOf(q.fiscalLabel, fiscalYear, [q]));
        else gaps.push(`${t}: no FY${fiscalYear}Q${quarter} quarterly report in the corpus.`);
      }
      return finish(t, buckets, `${t}: ${buckets.map((b) => b.label).join(', ') || 'requested quarters not in the corpus'}.`, gaps);
    }
  }
}

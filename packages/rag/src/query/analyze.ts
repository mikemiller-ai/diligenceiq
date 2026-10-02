import type { SectionKind } from '@diligenceiq/corpus';
import type { Catalog } from './catalog';
import { type CompanyMatch, CompanyMatcher, buildAliases, findNonCorpusCompanies } from './companies';
import { type FilingTypeFilter, type PeriodSpec, type ResolvedScope, parseFilingTypes, parsePeriodDetailed, resolvePeriod } from './periods';
import { type SectorMatch, matchSectors } from './sectors';

/**
 * Deterministic query analysis (SPEC §26; architecture §6.5; DD-05). No model call, no query
 * rewriting: the question is matched against static tables and regexes, and the result is
 * shown to the user as the Interpretation panel.
 */

/**
 * Topic hints (SPEC §26.5; assumptions C4): soft section boosts ONLY. A topic never filters,
 * so an arbitrary question still gets general semantic retrieval.
 */
export const TOPICS = ['risk', 'regulatory', 'revenue', 'growth', 'liquidity', 'competition', 'outlook'] as const;
export type Topic = (typeof TOPICS)[number];

export const TOPIC_RULES: Readonly<Record<Topic, { pattern: RegExp; sections: readonly SectionKind[] }>> = {
  risk: { pattern: /\brisks?\b|\bthreats?\b|\bexposures?\b|\buncertaint(?:y|ies)\b|\bvulnerab\w*/i, sections: ['risk_factors'] },
  regulatory: {
    pattern: /\bregulat\w*|\blaws?\b|\blegislat\w*|\bcompliance\b|\bantitrust\b|\bexport controls?\b|\bsanctions?\b|\bFDA\b|\bSEC\b|\bgovernment\w*|\bpolic(?:y|ies)\b|\btariffs?\b|\blitigation\b|\blegal\b/i,
    sections: ['risk_factors', 'legal', 'business'],
  },
  revenue: { pattern: /\brevenues?\b|\bsales\b|\btop[- ]line\b|\bsegments?\b|\bdrivers?\b/i, sections: ['mda', 'financial_statements'] },
  growth: { pattern: /\bgrowth\b|\bgrow(?:ing|n|s)?\b|\bexpan\w*|\baccelerat\w*|\bslow\w*/i, sections: ['mda'] },
  liquidity: {
    pattern: /\bliquidity\b|\bcash(?: flows?| position)?\b|\bdebt\b|\bborrowings?\b|\bcapital (?:resources|allocation|return)\b|\bbuybacks?\b|\brepurchases?\b|\bdividends?\b|\bleverage\b/i,
    sections: ['mda', 'market_risk', 'financial_statements'],
  },
  competition: { pattern: /\bcompet\w*|\bmarket share\b|\brivals?\b/i, sections: ['business', 'risk_factors'] },
  outlook: {
    pattern: /\boutlook\b|\bguidance\b|\bexpect\w*|\bforecast\w*|\bdemand\b|\bheadwinds?\b|\btailwinds?\b|\bplans?\b|\bstrateg\w*|\binvest\w*|\bpriorit\w*|\bmanagement (?:says|describes|discuss\w*)\b|\bactions?\b/i,
    sections: ['mda', 'business'],
  },
};

/** Words that ask how something changed over time (longitudinal intent). */
const CHANGE_INTENT =
  /\bchang\w*|\bevolv\w*|\bover time\b|\bover the (?:last|past)\b|\btrends?\b|\btrajector\w*|\byear[- ]over[- ]year\b|\bshift\w*|\bsince\b|\bhistor\w*|\bfrom (?:FY)?\d{4}\b|\bthrough (?:FY)?\d{4}\b|\bacross (?:the )?(?:years|filings|periods)\b|\bcompared? (?:to|with) (?:prior|previous|earlier|last)\b|\bdevelop\w*/i;

export interface QueryFilters {
  /** Hard filters chosen by the user; they override the analysis (SPEC §26.3, §27.1). */
  tickers?: string[];
  filingTypes?: FilingTypeFilter[];
  fiscalYearFrom?: number;
  fiscalYearTo?: number;
}

export interface QueryAnalysis {
  question: string;
  companies: Array<{ ticker: string; company: string; matchedText: string[]; via: 'name' | 'ticker' | 'sector' | 'filter' }>;
  sectors: SectorMatch[];
  /** The period the scopes use. After a fallback this is the current view; see `requestedPeriod`. */
  period: PeriodSpec;
  /** Set only when the parsed period had no filing for any company in scope and the current view was used instead (stated in gaps and notes). */
  requestedPeriod?: PeriodSpec;
  filingTypes: FilingTypeFilter[];
  topics: Topic[];
  /** Asks how something changed over time. */
  changeIntent: boolean;
  /** Per company in scope; for a question naming no company, every company's current scope. */
  scopes: ResolvedScope[];
  /** Named (or sector) companies were found. */
  scoped: boolean;
  /** Stated, never silently applied (SPEC §26.3): assumptions and corpus gaps. */
  notes: string[];
  gaps: string[];
  /** Matches the per-lane query text drops: other companies' names (so an Apple lane does not chase "Tesla"). */
  companySpans: CompanyMatch[];
}

export class QueryAnalyzer {
  private readonly matcher: CompanyMatcher;

  constructor(private readonly catalog: Catalog) {
    this.matcher = new CompanyMatcher(buildAliases(catalog));
  }

  analyze(question: string, filters: QueryFilters = {}): QueryAnalysis {
    const catalog = this.catalog;
    const notes: string[] = [];
    const matches = this.matcher.match(question);
    const sectors = matchSectors(question, catalog);
    const companies: QueryAnalysis['companies'] = [];
    const add = (ticker: string, via: QueryAnalysis['companies'][number]['via'], text?: string) => {
      const co = catalog.byTicker.get(ticker);
      if (!co) return;
      let row = companies.find((c) => c.ticker === ticker);
      if (!row) companies.push((row = { ticker, company: co.company, matchedText: [], via }));
      if (text && !row.matchedText.includes(text)) row.matchedText.push(text);
    };
    for (const m of matches) add(m.ticker, m.kind, m.text);
    for (const s of sectors) for (const t of s.tickers) add(t, 'sector', s.phrase);

    let filtered = companies;
    if (filters.tickers?.length) {
      const allowed = new Set(filters.tickers.map((t) => t.toUpperCase()));
      const unknown = [...allowed].filter((t) => !catalog.byTicker.has(t));
      if (unknown.length) notes.push(`Filter companies not in the corpus: ${unknown.join(', ')}.`);
      filtered = [];
      for (const t of allowed) {
        const found = companies.find((c) => c.ticker === t);
        if (found) filtered.push(found);
        else if (catalog.byTicker.has(t)) filtered.push({ ticker: t, company: catalog.byTicker.get(t)!.company, matchedText: [], via: 'filter' });
      }
      const dropped = companies.filter((c) => !allowed.has(c.ticker)).map((c) => c.ticker);
      if (dropped.length) notes.push(`The company filter overrides companies named in the question (${dropped.join(', ')} not searched).`);
    }

    const parsed = parsePeriodDetailed(question);
    let period = parsed.spec;
    if (filters.fiscalYearFrom !== undefined || filters.fiscalYearTo !== undefined) {
      period = { kind: 'range', from: filters.fiscalYearFrom ?? null, to: filters.fiscalYearTo ?? null, phrase: 'fiscal-year filter' };
      notes.push('The fiscal-year filter overrides any period named in the question.');
    } else if (parsed.ignoredYears.length) {
      notes.push(`Not read as a period (no time phrase such as "in 2024" or "FY2024"): ${parsed.ignoredYears.map((y) => `"${y}"`).join(', ')}.`);
    }
    if (period.kind === 'last_n' && period.assumption) notes.push(period.assumption);
    if (period.kind === 'current') notes.push('No period named: each company is read in its current view (latest annual report plus later quarterly reports).');
    else if (period.kind !== 'quarters') notes.push('Years are read as each company’s own fiscal years.');

    let filingTypes = parseFilingTypes(question);
    if (filters.filingTypes?.length) filingTypes = [...new Set(filters.filingTypes)];

    const topics = TOPICS.filter((t) => TOPIC_RULES[t].pattern.test(question));
    const scoped = filtered.length > 0;
    const gaps: string[] = [];

    // M4: likely company mentions that are not in the corpus get a stated gap.
    const outside = findNonCorpusCompanies(question, matches);
    for (const name of outside) gaps.push(`${name} is not in the corpus (${catalog.companies.length} companies).`);
    if (!scoped) {
      notes.push(
        outside.length
          ? `No corpus company named (${outside.join(', ')} ${outside.length === 1 ? 'is' : 'are'} not in the corpus): all companies are searched, with a cap per company.`
          : 'No corpus company named: all companies are searched, with a cap per company.',
      );
    }
    // M2: a lowercase common-word name next to other company names is read as a word; say so.
    if (matches.length) {
      for (const w of this.matcher.lowercaseCommonWords(question)) {
        if (!companies.some((c) => c.ticker === w.ticker)) notes.push(`"${w.word}" in lowercase is read as an ordinary word, not ${w.name}; write "${w.name}" to include it.`);
      }
    }

    // M6: a company whose filings are all outside the review window is left out of unscoped questions.
    const named = scoped ? filtered.map((c) => catalog.byTicker.get(c.ticker)!) : [];
    const stale = scoped ? named.filter((c) => c.outsideReviewWindow) : catalog.companies.filter((c) => c.outsideReviewWindow);
    const inScope = scoped ? named : catalog.companies.filter((c) => !c.outsideReviewWindow);
    const staleLabel = (c: (typeof stale)[number]) => `${c.ticker} (${c.filings.map((f) => f.fiscalLabel).join(', ')}, period end ${c.filings.at(-1)?.periodEnd ?? 'unknown'})`;
    if (stale.length) {
      notes.push(
        scoped
          ? `Outside the review window, shown because named: ${stale.map(staleLabel).join('; ')}.`
          : `Left out because every filing is outside the review window: ${stale.map(staleLabel).join('; ')}. Name the company to include it.`,
      );
    }

    let scopes = inScope.map((c) => resolvePeriod(c, period, filingTypes));
    let requestedPeriod: PeriodSpec | undefined;
    // B1: a named period with no filing for ANY company in scope falls back to the current view, stated.
    // A user filter range is a hard filter and never falls back.
    const fallbackKinds: ReadonlyArray<PeriodSpec['kind']> = ['years', 'since', 'quarters'];
    if (fallbackKinds.includes(period.kind) && scopes.length && scopes.every((s) => s.documentIds.length === 0)) {
      requestedPeriod = period;
      const what = describeRequested(period, filingTypes);
      scopes = inScope.map((c) => resolvePeriod(c, { kind: 'current' }, filingTypes));
      if (scoped) for (const s of scopes) gaps.push(`${s.ticker}: no ${what} in the corpus; showing the current view instead.`, ...s.gaps);
      else gaps.push(`No ${what} in the corpus for any company; showing each company's current view instead.`);
      notes.push(`The requested period (${what}) is not in the corpus for ${scoped ? 'the named companies' : 'any company'}; each company is read in its current view instead.`);
      period = { kind: 'current' };
    } else if (scoped) {
      // Gaps matter for named companies; for an unscoped question, a company simply lacking the period is not a gap.
      // A named company with NO filing in the requested period, while others have one, keeps its lane in the
      // current view (stated), so a comparison never silently loses a company (B1, partial case).
      const what = fallbackKinds.includes(period.kind) ? describeRequested(period, filingTypes) : null;
      scopes = scopes.map((s, i) => {
        if (!what || s.documentIds.length > 0) {
          gaps.push(...s.gaps);
          return s;
        }
        const current = resolvePeriod(inScope[i]!, { kind: 'current' }, filingTypes);
        gaps.push(`${s.ticker}: no ${what} in the corpus; showing its current view (${current.buckets.map((b) => b.label).join(', ') || 'none'}) instead.`, ...current.gaps);
        notes.push(`${s.ticker} has no ${what} in the corpus, so it is read in its current view; compare its periods with care.`);
        return current;
      });
    } else if (scopes.every((s) => s.documentIds.length === 0)) {
      gaps.push('No filings in the corpus match the requested period.');
    }

    const changeIntent =
      CHANGE_INTENT.test(question) || period.kind === 'since' || (period.kind === 'years' && period.years.length > 1) || period.kind === 'last_n';
    // H3: change intent but only one period bucket in scope for a named company: say how to compare.
    if (changeIntent && scoped) {
      const single = new Map<string, string[]>();
      for (const s of scopes) if (s.buckets.length === 1) single.set(s.buckets[0]!.label, [...(single.get(s.buckets[0]!.label) ?? []), s.ticker]);
      for (const [label, ts] of single) {
        notes.push(`${ts.join(', ')}: only one period is in scope (${label}); name years (e.g. 'from 2023 through 2025') to compare across annual reports.`);
      }
    }

    return {
      question,
      companies: filtered,
      sectors,
      period,
      ...(requestedPeriod ? { requestedPeriod } : {}),
      filingTypes,
      topics,
      changeIntent,
      scopes,
      scoped,
      notes,
      gaps,
      companySpans: matches,
    };
  }
}

/** "FY2015 filing", "FY2020, FY2022 annual report", "FY2030 on filing", "FY2025Q2 quarterly report". */
function describeRequested(period: PeriodSpec, types: readonly FilingTypeFilter[]): string {
  const kind = types.length === 1 ? (types[0] === '10-K' ? 'annual report' : 'quarterly report') : 'filing';
  switch (period.kind) {
    case 'years':
      return `${period.years.map((y) => `FY${y}`).join(', ')} ${kind}`;
    case 'since':
      return `${kind} from FY${period.from} on`;
    case 'quarters':
      return `${period.quarters.map((q) => `FY${q.fiscalYear}Q${q.quarter}`).join(', ')} ${kind}`;
    default:
      return kind;
  }
}

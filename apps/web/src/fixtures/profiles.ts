import {
  OTHER_RISKS_LABEL,
  PLACEHOLDER_TEXT,
  SIGNAL_CATEGORY_LABELS,
  type Citation,
  type CompanyIntelligenceProfile,
  type CoverageTier,
  type SignalCategory,
} from '@diligenceiq/core';
import riskHeadingsJson from './generated/risk-headings.json';
import { FILINGS, companyByTicker } from './index';

/*
 * Preview (fixture) profiles for AAPL, MSFT and NVDA. They carry no figures and no narrative
 * presented as fact. Every slot is one of:
 *   - verbatim filing text: since Phase 2, the latest 10-K's COMPLETE extracted list of risk
 *     headings (scripts/fixtures/build-risk-fixtures.ts, packages/corpus risks.ts), each cited
 *     to the real index chunk(s) that contain it. The extractor is a deterministic heuristic
 *     with imperfect recall, so the UI still labels these profiles a preview and never draws
 *     completeness conclusions from them (isFixtureProfile, SPEC §8.6);
 *   - a deterministic template over that text or over the filing rows (category from the
 *     extractor's classifier, plain label, coverage tier, recommended questions);
 *   - a labeled placeholder (PLACEHOLDER_TEXT), shown in the UI as "Placeholder, not filing data".
 * fixtures.test.ts and the rendered-figure test enforce this.
 */

interface RiskHeadingsFile {
  indexVersion: string;
  companies: Array<{
    ticker: string;
    documentId: string;
    fiscalLabel: string;
    headings: Array<{ heading: string; group: string | null; category: SignalCategory | null; rank: number; chunkIds: string[] }>;
  }>;
  passages: Citation[];
}

const RISK_HEADINGS = riskHeadingsJson as RiskHeadingsFile;

/** The index passages the preview profiles cite. */
export const RISK_PASSAGES: readonly Citation[] = RISK_HEADINGS.passages;

/** Plain-language coverage summary per tier (templated; no figures). */
export const TIER_COPY: Record<CoverageTier, { label: string; summary: string }> = {
  deep: {
    label: 'Deep coverage',
    summary: 'Several years of annual reports and the quarterly reports between them.',
  },
  partial: {
    label: 'Partial coverage',
    summary: 'Recent annual and quarterly reports; filing-to-filing changes where comparable filings exist.',
  },
  limited_history: {
    label: 'Limited history',
    summary: 'Limited history: one annual report in the corpus.',
  },
};

/** 30-second view dimensions (SPEC §8.4). All but evidence coverage are placeholders in Phase 1. */
const EXECUTIVE_DIMENSIONS = ['Performance', 'Growth', 'Margins', 'Outlook', 'Risk changes'] as const;

interface FixtureInput {
  ticker: string;
  sector: string;
}

/** The first (lowest-rank) classified heading of each area, in rank order. */
function firstPerCategory<T extends { category: SignalCategory | null }>(risks: readonly T[]): T[] {
  const seen = new Set<SignalCategory>();
  return risks.filter((r) => r.category !== null && !seen.has(r.category) && seen.add(r.category));
}

function buildFixtureProfile({ ticker, sector }: FixtureInput): CompanyIntelligenceProfile {
  const company = companyByTicker(ticker);
  const extracted = RISK_HEADINGS.companies.find((c) => c.ticker === ticker);
  if (!company || !extracted) throw new Error(`fixture profile: unknown ticker ${ticker}`);
  const byId = new Map(RISK_HEADINGS.passages.map((p) => [p.chunkId, p]));
  const annualPeriods = FILINGS.filter((f) => f.ticker === ticker && f.filingType === '10-K')
    .map((f) => f.periodEnd)
    .sort();

  // Rank is the heading's order in the extracted list; the UI never presents it as a
  // position while the profile is a preview.
  const currentRisks = extracted.headings.map((h) => ({
    category: h.category,
    heading: h.heading,
    plainLabel: h.category ? SIGNAL_CATEGORY_LABELS[h.category] : OTHER_RISKS_LABEL,
    rank: h.rank,
    citationIds: h.chunkIds,
  }));
  const citationIds = [...new Set(currentRisks.flatMap((r) => r.citationIds))];
  const citations = citationIds.map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`fixture profile: passage missing: ${id}`);
    return p;
  });

  const tier = TIER_COPY[company.tier];
  return {
    ticker,
    company: company.company,
    sector,
    version: {
      indexVersion: RISK_HEADINGS.indexVersion,
      profileSetId: 'fixture-v2',
      templateVersion: 'fixture-2',
      builtAt: '2026-10-01',
      periodsCovered: annualPeriods,
    },
    fiscalYearEnd: company.latestAnnualPeriodEnd,
    coverage: { tier: company.tier, filings: company.filings, tenK: company.tenK, tenQ: company.tenQ, byCategory: [] },
    facts: [],
    trends: [],
    drivers: [],
    currentRisks,
    signals: [],
    executiveView: [
      ...EXECUTIVE_DIMENSIONS.map((dimension) => ({ dimension, label: 'Placeholder', summary: PLACEHOLDER_TEXT, citationIds: [] })),
      { dimension: 'Evidence coverage', label: tier.label, summary: tier.summary, citationIds: [] },
    ],
    managementOutlook: null,
    // Templated, one per risk area the latest annual report discusses, cited to that area's
    // first heading. It asks what the dashboard cannot show yet (how the disclosure moved
    // across annual reports and what management is doing about it), so it does not repeat a
    // risk's own Investigate question. Unclassified headings get no templated question.
    recommendedDiligence: firstPerCategory(currentRisks).map((r) => {
      const area = r.plainLabel.toLowerCase();
      const history = company.tenK > 1;
      return {
        question: history
          ? `How has ${company.company}’s discussion of ${area} risk changed across its annual reports, and what does management say it is doing about it?`
          : `What does ${company.company} say it is doing to manage its ${area} risk, and what does its annual report leave unanswered?`,
        why: history
          ? `The latest annual report discusses a ${area} risk, and earlier annual reports are available to show whether it is new, growing or long-standing.`
          : `The latest annual report discusses a ${area} risk; it is the only annual report available, so the question focuses on management’s response.`,
        signalIds: [],
        citationIds: r.citationIds,
        tickers: [ticker],
      };
    }),
    gaps: [
      'Risk headings are extracted by a deterministic rule from the latest annual report and can miss some headings and include a sentence that is not a heading; comparisons between companies wait for the full profile build.',
      'Financial figures and trends are extracted but not shown in this preview yet.',
      'Filing-to-filing change detection has not run yet.',
      'Management outlook is not extracted yet.',
    ],
    citations,
    generation: {
      mode: 'deterministic',
      generationCallCount: 0,
      validation: { invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 },
    },
  };
}

export const FIXTURE_PROFILES: ReadonlyMap<string, CompanyIntelligenceProfile> = new Map(
  (
    [
      { ticker: 'AAPL', sector: 'Information Technology' },
      { ticker: 'MSFT', sector: 'Information Technology' },
      { ticker: 'NVDA', sector: 'Information Technology' },
    ] satisfies FixtureInput[]
  ).map((input) => [input.ticker, buildFixtureProfile(input)]),
);

export function getProfile(ticker: string): CompanyIntelligenceProfile | undefined {
  return FIXTURE_PROFILES.get(ticker);
}

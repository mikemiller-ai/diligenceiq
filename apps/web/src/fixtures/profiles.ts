import {
  PLACEHOLDER_TEXT,
  SIGNAL_CATEGORY_LABELS,
  classifyRiskHeading,
  type CompanyIntelligenceProfile,
  type CoverageTier,
} from '@diligenceiq/core';
import { FILINGS, companyByTicker, passage } from './index';

/*
 * Phase 1 fixture profiles for AAPL, MSFT and NVDA (implementation plan, Phase 1). They
 * carry no figures and no narrative presented as fact. Every slot is one of:
 *   - verbatim filing text: each current-risk heading is copied from the latest 10-K and
 *     cited to a passage that starts with it. The headings are a hand-picked SELECTION, not
 *     the 10-K's complete list (the heading extractor is Phase 2), so the UI labels them as
 *     a preview and never draws completeness conclusions from them (isFixtureProfile);
 *   - a deterministic template over that text or over the filing rows (category from
 *     classifyRiskHeading, plain label, coverage tier, a recommended question);
 *   - a labeled placeholder (PLACEHOLDER_TEXT), shown in the UI as "Placeholder, not filing data".
 * fixtures.test.ts and the rendered-figure test enforce this.
 */

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
  /** Latest-10-K passages that each start with a verbatim risk heading, and that heading. */
  risks: Array<{ chunkId: string; heading: string }>;
}

function buildFixtureProfile({ ticker, sector, risks }: FixtureInput): CompanyIntelligenceProfile {
  const company = companyByTicker(ticker);
  if (!company) throw new Error(`fixture profile: unknown ticker ${ticker}`);
  const citations = risks.map((r) => passage(r.chunkId));
  const annualPeriods = FILINGS.filter((f) => f.ticker === ticker && f.filingType === '10-K')
    .map((f) => f.periodEnd)
    .sort();

  // Rank is the order of the selected headings in the filing, kept only to satisfy the schema;
  // it is not a position in the complete risk list and the UI never presents it as one.
  const ordered = [...risks].sort((a, b) => passage(a.chunkId).charStart - passage(b.chunkId).charStart);
  const currentRisks = ordered.map((r, i) => {
    const category = classifyRiskHeading(r.heading);
    // The category enum is fixed (SPEC §11.1), so a fixture heading must classify.
    if (!category) throw new Error(`fixture profile: unclassified heading for ${ticker}: ${r.heading}`);
    return { category, heading: r.heading, plainLabel: SIGNAL_CATEGORY_LABELS[category], rank: i + 1, citationIds: [r.chunkId] };
  });

  const tier = TIER_COPY[company.tier];
  return {
    ticker,
    company: company.company,
    sector,
    version: {
      indexVersion: 'fixture-phase1',
      profileSetId: 'fixture-v1',
      templateVersion: 'fixture-1',
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
    // Templated from each selected current risk and cited to it. It asks what the dashboard
    // cannot show yet (how the disclosure moved across annual reports and what management is
    // doing about it), so it does not repeat the risk's own Investigate question.
    recommendedDiligence: currentRisks.map((r) => {
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
      'The risk headings shown are a selection from the latest annual report, not its complete list.',
      'Financial figures and trends are not extracted yet.',
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
      {
        ticker: 'AAPL',
        sector: 'Information Technology',
        risks: [
          {
            chunkId: 'AAPL-FY2025-10K-1A-R01',
            heading:
              'Global markets for the Company’s products and services are highly competitive and subject to rapid technological change, and the Company may be unable to compete effectively in these markets.',
          },
          {
            chunkId: 'AAPL-FY2025-10K-1A-R02',
            heading:
              'The Company depends on component and product manufacturing and logistical services provided by outsourcing partners, many of which are located outside of the U.S.',
          },
          {
            chunkId: 'AAPL-FY2025-10K-1A-R04',
            heading:
              'Losses or unauthorized access to or releases of confidential information, including personal information, could subject the Company to significant reputational, financial, legal and operational consequences.',
          },
          {
            chunkId: 'AAPL-FY2025-10K-1A-R03',
            heading:
              'The Company is subject to complex and changing laws and regulations worldwide, which exposes the Company to potential liabilities, increased costs and other adverse effects on the Company’s business.',
          },
        ],
      },
      {
        ticker: 'MSFT',
        sector: 'Information Technology',
        risks: [
          {
            chunkId: 'MSFT-FY2025-10K-1A-R01',
            heading:
              'We face intense competition across all markets for our products and services, which could adversely affect our results of operations.',
          },
          {
            chunkId: 'MSFT-FY2025-10K-1A-R02',
            heading:
              'Cyberattacks and security vulnerabilities could lead to reduced revenue, increased costs, liability claims, or harm to our reputation or competitive position.',
          },
          {
            chunkId: 'MSFT-FY2025-10K-1A-R03',
            heading:
              'We are subject to a variety of new, existing, and evolving legal and regulatory requirements that could adversely affect our results of operations.',
          },
        ],
      },
      {
        ticker: 'NVDA',
        sector: 'Information Technology',
        risks: [
          {
            chunkId: 'NVDA-FY2025-10K-1A-R01',
            heading:
              'Dependency on third-party suppliers and their technology to manufacture, assemble, test, or package our products reduces our control over product quantity and quality, manufacturing yields, and product delivery schedules and could harm our business.',
          },
          {
            chunkId: 'NVDA-FY2025-10K-1A-R03',
            heading: 'Competition could adversely impact our market share and financial results.',
          },
          {
            chunkId: 'NVDA-FY2025-10K-1A-R04',
            heading:
              'Product, system security, and data protection incidents or breaches, as well as cyber-attacks, could disrupt our operations, reduce our expected revenue, increase our expenses, and significantly harm our business and reputation.',
          },
          {
            chunkId: 'NVDA-FY2025-10K-1A-R02',
            heading:
              'We are subject to complex laws, rules, regulations, and political and other actions, including restrictions on the export of our products, which may adversely impact our business.',
          },
        ],
      },
    ] satisfies FixtureInput[]
  ).map((input) => [input.ticker, buildFixtureProfile(input)]),
);

export function getProfile(ticker: string): CompanyIntelligenceProfile | undefined {
  return FIXTURE_PROFILES.get(ticker);
}

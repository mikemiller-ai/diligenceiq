import type { CompanyCoverage, FinancialFact } from '@diligenceiq/corpus';
import type { ChunkRecord } from '../index/format';
import type { ProfileExtraction } from './assemble';

/*
 * A tiny synthetic company for the profile tests: two chunks (an income statement and a risk
 * section) and an extraction whose rows and headings are verbatim in them, so the integrity
 * checks pass without the corpus.
 */
export const SYN_IV = 'iv-test0001';

const base = {
  documentId: 'SYN_10K_2025',
  company: 'Synthetic Co',
  ticker: 'SYN',
  cik: '0',
  sector: 'Industrials',
  filingType: '10-K' as const,
  filingDate: '2025-02-01',
  periodEnd: '2024-12-31',
  fiscalYear: 2024,
  fiscalQuarter: null,
  fiscalLabel: 'FY2024',
  calendarQuarter: null,
  subsection: null,
  boilerplate: false,
  sourceFile: 'SYN.txt',
};

export const SYN_FS = 'SYN-FY2024-10K-FS-001';
export const SYN_RISK = 'SYN-FY2024-10K-1A-001';
export const SYN_MDA = 'SYN-FY2024-10K-MDA-001';

export const SYN_ROWS = {
  revenue: 'Total revenue | 1,200 | 1,000 | 900 |',
  operating: 'Operating income | 300 | 200 | 180 |',
};
export const SYN_HEADING = 'Our results depend on a small number of customers, and the loss of any of them could reduce our revenue significantly.';

export function synChunks(): ChunkRecord[] {
  return [
    { ...base, chunkId: SYN_FS, section: 'Financial Statements', sectionCode: 'FS', sectionKind: 'financial_statements' as never, chunkIndex: 0, charStart: 0, charEnd: 200, text: `CONSOLIDATED STATEMENTS OF OPERATIONS (in millions)\n${SYN_ROWS.revenue}\n${SYN_ROWS.operating}` },
    { ...base, chunkId: SYN_RISK, section: 'Item 1A — Risk Factors', sectionCode: '1A', sectionKind: 'risk_factors' as never, chunkIndex: 1, charStart: 200, charEnd: 500, text: `Risks related to customers. ${SYN_HEADING} Two customers account for most of our sales.` },
    { ...base, chunkId: SYN_MDA, section: 'Item 7 — MD&A', sectionCode: '7', sectionKind: 'mdna' as never, chunkIndex: 2, charStart: 500, charEnd: 800, text: 'Management expects demand to remain steady next year and plans to invest in new capacity.' },
  ];
}

const fact = (metric: FinancialFact['metric'], period: string, value: number, rawRow: string, rowStart: number): FinancialFact => ({
  metric,
  period,
  periodEnd: `${period.slice(2)}-12-31`,
  duration: 'annual',
  value,
  unit: 'USD',
  scale: 1e6,
  documentId: base.documentId,
  fiscalLabel: 'FY2024',
  chunkId: SYN_FS,
  rawRow,
  rowStart,
  tableStart: 0,
  section: 'financial_statements',
  source: 'statement',
  suspect: null,
  crossCheck: 'single_source',
});

export function synExtraction(): ProfileExtraction {
  const coverage: CompanyCoverage = {
    ticker: 'SYN',
    company: 'Synthetic Co',
    sector: 'Industrials',
    tier: 'limited_history',
    filings: 1,
    tenK: 1,
    tenQ: 0,
    annualPeriods: [{ fiscalLabel: 'FY2024', periodEnd: '2024-12-31', documentId: base.documentId }],
    quarterlyPeriods: [],
    latestAnnualPeriodEnd: '2024-12-31',
    fiscalYearEnd: '2024-12-31',
    outsideReviewWindow: false,
  };
  return {
    indexVersion: SYN_IV,
    coverage,
    facts: [
      fact('revenue', 'FY2024', 1200, SYN_ROWS.revenue, 10),
      fact('revenue', 'FY2023', 1000, SYN_ROWS.revenue, 10),
      fact('revenue', 'FY2022', 900, SYN_ROWS.revenue, 10),
      fact('operating_income', 'FY2024', 300, SYN_ROWS.operating, 40),
      fact('operating_income', 'FY2023', 200, SYN_ROWS.operating, 40),
      fact('operating_income', 'FY2022', 180, SYN_ROWS.operating, 40),
    ],
    trends: [
      {
        metric: 'revenue_growth',
        trajectory: 'growing',
        basis: 'Growth of 20.0% in FY2024, after 11.1% in FY2023 (growing: above 2.0%).',
        periods: ['FY2022', 'FY2023', 'FY2024'],
        chunkIds: [SYN_FS],
        values: [900, 1000, 1200],
        inputs: [],
      },
      {
        metric: 'operating_margin',
        trajectory: 'improving',
        basis: '25.0% in FY2024 vs 20.0% in FY2023, a change of 5.0 pp (improving: threshold 1.0 pp).',
        periods: ['FY2023', 'FY2024'],
        chunkIds: [SYN_FS],
        values: [0.2, 0.25],
        inputs: [],
      },
    ],
    drivers: [],
    riskHeadings: [
      {
        documentId: base.documentId,
        fiscalLabel: 'FY2024',
        periodEnd: '2024-12-31',
        headings: [{ heading: SYN_HEADING, start: 0, end: 0, group: null, category: 'customer_concentration', rank: 1, chunkIds: [SYN_RISK] }],
      },
    ],
    latestRiskHeadingsDocument: base.documentId,
  };
}

/** The synthetic company under another ticker (every "SYN" ID and file renamed), for multi-company builds. */
export function synCompany(ticker: string): { extraction: ProfileExtraction; chunks: ChunkRecord[] } {
  const rename = <T>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll('SYN', ticker)) as T;
  return { extraction: rename(synExtraction()), chunks: rename(synChunks()) };
}

/**
 * An earlier annual report's statement passage with a fourth fiscal year (FY2021). Its fact is
 * kept in the profile (and its chunk in the citations) but FACTS prints only the latest three
 * years, so this chunk's SOURCE_ID is NOT in the user message.
 */
export const SYN_OLD_FS = 'SYN-FY2022-10K-FS-001';
export const SYN_OLD_ROW = 'Total revenue | 900 | 800 |';

export function synWithOlderFact(): { extraction: ProfileExtraction; chunks: ChunkRecord[] } {
  const chunks = synChunks();
  chunks.push({ ...chunks[0]!, chunkId: SYN_OLD_FS, documentId: 'SYN_10K_2023', fiscalYear: 2022, fiscalLabel: 'FY2022', periodEnd: '2022-12-31', text: `CONSOLIDATED STATEMENTS OF OPERATIONS (in millions)\n${SYN_OLD_ROW}` });
  const extraction = synExtraction();
  extraction.facts.push({ ...extraction.facts[0]!, period: 'FY2021', periodEnd: '2021-12-31', value: 800, documentId: 'SYN_10K_2023', fiscalLabel: 'FY2022', chunkId: SYN_OLD_FS, rawRow: SYN_OLD_ROW });
  return { extraction, chunks };
}

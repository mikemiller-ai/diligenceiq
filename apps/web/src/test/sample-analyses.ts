import type { Citation } from '@diligenceiq/core';
import type { AnalysisRecord } from '@/fixtures/types';
import testPassages from './generated/passages.json';

/*
 * TEST-ONLY sample analyses. The brief below was written by hand from real filing
 * passages to exercise the Diligence Brief layout in unit tests. It is never imported
 * by application code, so the deployed app shows no hand-written answers (SPEC §2.2,
 * assumptions A5). A guard test enforces that. Its passages are exact corpus slices kept in
 * ./generated (scripts/fixtures/build-web-fixtures.mjs, `testPassages`), so the app never ships them.
 */

/** Exact corpus slices that only the test-only brief cites. */
export const TEST_PASSAGES = testPassages as Citation[];

const passage = (chunkId: string): Citation => {
  const p = TEST_PASSAGES.find((x) => x.chunkId === chunkId);
  if (!p) throw new Error(`fixture passage missing: ${chunkId}`);
  return p;
};
const ctx = (...ids: string[]) => ids.map(passage);

export const SAMPLE_ANALYSES: AnalysisRecord[] = [
  {
    analysisId: 'an-01',
    question:
      'What supply-chain and manufacturing concentration risks do Apple and NVIDIA disclose in their most recent 10-K filings?',
    origin: { kind: 'direct' },
    status: 'COMPLETE',
    createdAt: '2026-09-28T14:12:00Z',
    completedAt: '2026-09-28T14:12:41Z',
    interpretation: {
      companies: ['AAPL', 'NVDA'],
      periods: ['AAPL FY2025 (ended 2025-09-27)', 'NVDA FY2025 (ended 2025-01-26)'],
      filingTypes: ['10-K'],
      coverageWarnings: [],
    },
    context: ctx(
      'AAPL-FY2025-10K-1A-F01',
      'AAPL-FY2025-10K-1A-F02',
      'NVDA-FY2025-10K-1-F01',
      'NVDA-FY2025-10K-1A-F01',
      'NVDA-FY2025-10K-1A-F02',
    ),
    validation: { invalidCitationIds: [], uncitedFindingIndexes: [] },
    brief: {
      title: 'Supply-chain concentration: Apple and NVIDIA',
      answerType: 'comparison',
      executiveSummary:
        'Both companies disclose that manufacturing is concentrated with outsourced partners in Asia. Apple relies on outsourcing partners located primarily in China mainland, India, Japan, South Korea, Taiwan and Vietnam, and on single-source partners for many components [AAPL-FY2025-10K-1A-F01]. NVIDIA depends on foundries such as TSMC and Samsung and describes its supply chain as mainly concentrated in the Asia-Pacific region [NVDA-FY2025-10K-1-F01] [NVDA-FY2025-10K-1A-F01]. Both flag reduced direct control and exposure to shortages or geopolitical disruption [AAPL-FY2025-10K-1A-F02] [NVDA-FY2025-10K-1A-F02].',
      keyFindings: [
        {
          title: 'Apple’s final assembly is concentrated with partners in Asia',
          finding:
            'A significant majority of Apple’s manufacturing is performed by outsourcing partners located primarily in China mainland, India, Japan, South Korea, Taiwan and Vietnam, and partners primarily in Asia perform final assembly of substantially all of its hardware products.',
          basis: 'reported',
          tickers: ['AAPL'],
          citationIds: ['AAPL-FY2025-10K-1A-F01'],
        },
        {
          title: 'Apple depends on single-source and custom components',
          finding:
            'Apple relies on single-source partners for many components, and its new products often use custom components available from only one source. Components are at times subject to industry-wide shortages and significant commodity pricing fluctuations.',
          basis: 'reported',
          tickers: ['AAPL'],
          citationIds: ['AAPL-FY2025-10K-1A-F01', 'AAPL-FY2025-10K-1A-F02'],
        },
        {
          title: 'NVIDIA outsources wafer fabrication and final assembly',
          finding:
            'NVIDIA uses foundries such as TSMC and Samsung to produce its wafers, purchases memory from SK Hynix, Micron and Samsung, and contracts assembly, testing and packaging to subcontractors including Hon Hai, Wistron and Fabrinet.',
          basis: 'reported',
          tickers: ['NVDA'],
          citationIds: ['NVDA-FY2025-10K-1-F01', 'NVDA-FY2025-10K-1A-F01'],
        },
        {
          title: 'NVIDIA cites Taiwan–China tension as a supply-continuity risk',
          finding:
            'NVIDIA states that geopolitical tensions involving Taiwan and China, which comprise a significant portion of its revenue and where suppliers, contract manufacturers and assembly partners critical to its supply continuity are located, could have a material adverse impact.',
          basis: 'reported',
          tickers: ['NVDA'],
          citationIds: ['NVDA-FY2025-10K-1A-F02'],
        },
        {
          title: 'Shared exposure to Asia-Pacific manufacturing concentration',
          finding:
            'Both businesses depend on a small set of outsourced manufacturing partners concentrated in Asia, so a regional disruption would likely affect both. Neither passage quantifies the share of production at risk.',
          basis: 'analysis',
          tickers: ['AAPL', 'NVDA'],
          citationIds: ['AAPL-FY2025-10K-1A-F01', 'NVDA-FY2025-10K-1-F01'],
        },
      ],
      comparison: {
        kind: 'table',
        columns: ['Dimension', 'Apple (FY2025 10-K)', 'NVIDIA (FY2025 10-K)'],
        rows: [
          {
            label: 'Manufacturing model',
            values: ['Outsourcing partners; final assembly primarily in Asia', 'Foundries (TSMC, Samsung) and contract manufacturers'],
            citationIds: ['AAPL-FY2025-10K-1A-F01', 'NVDA-FY2025-10K-1-F01'],
          },
          {
            label: 'Named concentration',
            values: ['China mainland, India, Japan, South Korea, Taiwan, Vietnam', 'Asia-Pacific region; Taiwan and China named'],
            citationIds: ['AAPL-FY2025-10K-1A-F01', 'NVDA-FY2025-10K-1-F01', 'NVDA-FY2025-10K-1A-F02'],
          },
          {
            label: 'Single-source exposure',
            values: ['Single-source partners for many components; one-source custom parts', 'No guaranteed supply of wafer, component and capacity'],
            citationIds: ['AAPL-FY2025-10K-1A-F01', 'AAPL-FY2025-10K-1A-F02', 'NVDA-FY2025-10K-1A-F01'],
          },
        ],
      },
      investmentConsiderations: [
        {
          text: 'Test how much of each company’s hardware volume depends on a single region or partner; the disclosures name locations but do not quantify them.',
          citationIds: ['AAPL-FY2025-10K-1A-F01', 'NVDA-FY2025-10K-1-F01'],
        },
        {
          text: 'NVIDIA ties supply continuity to the same geography that represents a significant portion of its revenue, which compounds the exposure.',
          citationIds: ['NVDA-FY2025-10K-1A-F02'],
        },
      ],
      evidenceGaps: [
        'Neither retrieved passage quantifies production share by country or partner.',
        'Mitigation costs, such as dual-sourcing or prepaid capacity, are not covered by the retrieved context.',
      ],
      followUpQuestions: [
        'How has Apple’s description of its manufacturing locations changed between its 2023 and 2025 10-Ks?',
        'What purchase obligations and prepaid capacity agreements does NVIDIA disclose?',
      ],
    },
  },
  {
    analysisId: 'an-04',
    question: 'What iPhone unit sales guidance has Apple given for the next quarter?',
    origin: { kind: 'direct' },
    status: 'FAILED',
    createdAt: '2026-09-27T11:20:00Z',
    completedAt: '2026-09-27T11:20:09Z',
    context: [],
    error: {
      code: 'NO_RELEVANT_EVIDENCE',
      message:
        'No filing passages matched this question. 10-K and 10-Q filings do not contain forward unit guidance; try asking what Apple discloses about iPhone net sales trends.',
      requestId: 'fixture-7f3c2a',
    },
  },
];

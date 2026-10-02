import { describe, expect, it } from 'vitest';
import {
  CompanyIntelligenceProfileSchema,
  classifyRiskHeading,
  composeCompare,
  coverageTier,
  profileIntegrityIssues,
  themeForCategory,
  type Citation,
  type CompanyIntelligenceProfile,
  type SignalCategory,
} from './index';

const passage = (ticker: string, chunkId: string, text: string): Citation => ({
  chunkId,
  indexVersion: 'test',
  ticker,
  company: `${ticker} Inc.`,
  filingType: '10-K',
  filingDate: '2025-10-31',
  periodEnd: '2025-09-27',
  fiscalLabel: 'FY2025',
  section: 'Item 1A — Risk Factors',
  documentId: `${ticker}_10K_2025`,
  charStart: 0,
  charEnd: text.length,
  text,
});

function profile(
  ticker: string,
  risks: Array<[SignalCategory, string]>,
  over: Partial<CompanyIntelligenceProfile> = {},
  periodEnd = '2025-09-27',
): CompanyIntelligenceProfile {
  const citations = risks.map(([, heading], i) => passage(ticker, `${ticker}-R${i + 1}`, `${heading} More text follows.`));
  return {
    ticker,
    company: `${ticker} Inc.`,
    sector: 'Technology',
    version: { indexVersion: 'test', profileSetId: 'det-v1', templateVersion: 't1', builtAt: '2026-10-01', periodsCovered: [periodEnd] },
    fiscalYearEnd: periodEnd,
    coverage: { tier: 'deep', filings: 16, tenK: 4, tenQ: 12, byCategory: [] },
    facts: [],
    trends: [],
    drivers: [],
    currentRisks: risks.map(([category, heading], i) => ({
      category,
      heading,
      plainLabel: category,
      rank: i + 1,
      citationIds: [`${ticker}-R${i + 1}`],
    })),
    signals: [],
    executiveView: [],
    managementOutlook: null,
    recommendedDiligence: [],
    gaps: [],
    citations,
    generation: { mode: 'deterministic', generationCallCount: 0, validation: { invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 } },
    ...over,
  };
}

describe('coverageTier', () => {
  it('follows the SPEC §8.5 split', () => {
    expect(coverageTier(4, 12)).toBe('deep');
    expect(coverageTier(3, 12)).toBe('deep');
    expect(coverageTier(2, 6)).toBe('partial'); // META
    expect(coverageTier(1, 3)).toBe('partial'); // JPM, BAC
    expect(coverageTier(1, 1)).toBe('partial'); // MCD, PEP
    expect(coverageTier(1, 0)).toBe('limited_history');
  });
});

describe('classifyRiskHeading', () => {
  it('classifies by ordered keyword rules and returns null when nothing matches', () => {
    expect(classifyRiskHeading('Cyberattacks and security vulnerabilities could lead to reduced revenue')).toBe('cybersecurity');
    expect(classifyRiskHeading('Dependency on third-party suppliers to manufacture our products')).toBe('supply_chain');
    expect(classifyRiskHeading('We are subject to complex laws, including restrictions on export')).toBe('regulatory');
    expect(classifyRiskHeading('Global markets are highly competitive')).toBe('competition');
    expect(classifyRiskHeading('Competition could adversely impact our market share and financial results.')).toBe('competition');
    expect(classifyRiskHeading('Our manufacturing is concentrated in a single region')).toBe('supply_chain');
    expect(classifyRiskHeading('Our revenue is concentrated in a few countries')).toBe('geographic_concentration');
    expect(classifyRiskHeading('Geopolitical tensions involving Taiwan and China could harm us')).toBe('geographic_concentration');
    expect(classifyRiskHeading('Our stock price may be volatile')).toBeNull();
  });

  it('does not over-match: operating internationally is not concentration, and a passing "component" is not supply', () => {
    // Regression (adversary finding 10): these used to classify as geographic concentration and supply chain.
    expect(classifyRiskHeading('International sales and operations are a significant part of our business, which exposes us to risks that could harm our business.')).toBeNull();
    expect(classifyRiskHeading('Our foreign operations expose us to currency risk')).toBeNull();
    expect(classifyRiskHeading('A key component of our strategy is new products')).toBeNull();
    expect(classifyRiskHeading('Component shortages could delay shipments')).toBe('supply_chain');
  });

  it('applies the rules in order: the first matching rule wins', () => {
    // Cybersecurity before competition ("competitive position"), supply chain before regulatory.
    expect(classifyRiskHeading('Cyberattacks could harm our competitive position')).toBe('cybersecurity');
    expect(classifyRiskHeading('Suppliers are subject to government regulation')).toBe('supply_chain');
    expect(classifyRiskHeading('Laws on competition could change')).toBe('regulatory');
  });

  it('maps every category to a finding theme', () => {
    expect(themeForCategory('regulatory')).toBe('regulatory-compliance');
    expect(themeForCategory('supply_chain')).toBe('risk-factors');
    expect(themeForCategory('debt')).toBe('liquidity-capital');
  });
});

describe('CompanyIntelligenceProfileSchema and integrity', () => {
  it('accepts a well-formed profile with no integrity issues', () => {
    const p = profile('AAPL', [['competition', 'Markets are competitive.']]);
    expect(CompanyIntelligenceProfileSchema.safeParse(p).success).toBe(true);
    expect(profileIntegrityIssues(p)).toEqual([]);
  });

  it('takes an optional model-written headline (absent on deterministic and preview profiles), never an empty one', () => {
    const p = profile('AAPL', [['competition', 'Markets are competitive.']]);
    expect(CompanyIntelligenceProfileSchema.safeParse({ ...p, headline: 'What stands out.' }).success).toBe(true);
    expect('headline' in p).toBe(false);
    expect(CompanyIntelligenceProfileSchema.safeParse({ ...p, headline: '' }).success).toBe(false);
  });

  it('rejects ratings or unknown fields and invalid set IDs', () => {
    const p = profile('AAPL', [['competition', 'Markets are competitive.']]);
    expect(CompanyIntelligenceProfileSchema.safeParse({ ...p, rating: 'Strong Buy' }).success).toBe(false);
    expect(CompanyIntelligenceProfileSchema.safeParse({ ...p, version: { ...p.version, profileSetId: 'v1' } }).success).toBe(false);
  });

  it('flags a citation outside the profile, a non-verbatim heading, and a source row not in its passage', () => {
    const p = profile('AAPL', [['competition', 'Markets are competitive.']], {
      facts: [
        {
          metric: 'Revenue',
          period: 'FY2025',
          value: 1,
          unit: 'USD',
          scale: 1e6,
          chunkId: 'AAPL-R1',
          rawRow: 'Total net sales | 1',
          crossCheck: 'single_source',
        },
      ],
      executiveView: [{ dimension: 'Performance', label: 'Stable', summary: 'x', citationIds: ['AAPL-NOPE'] }],
    });
    p.currentRisks[0]!.heading = 'A paraphrase, not the heading.';
    p.recommendedDiligence = [{ question: 'Q?', why: 'W.', signalIds: [], citationIds: [], tickers: ['AAPL'] }];
    const issues = profileIntegrityIssues(p);
    expect(issues).toContain('recommendedDiligence[0] has no supporting signal or citation');
    expect(issues).toContain('executiveView[0] cites AAPL-NOPE, which is not in the profile\'s citations');
    expect(issues).toContain('facts[0].rawRow is not verbatim in AAPL-R1');
    expect(issues).toContain('currentRisks[0].heading is not verbatim in its cited passages');
  });
});

describe('composeCompare', () => {
  const profiles = new Map([
    ['AAPL', profile('AAPL', [['competition', 'A.'], ['supply_chain', 'B.'], ['regulatory', 'C.']])],
    ['MSFT', profile('MSFT', [['competition', 'D.'], ['cybersecurity', 'E.'], ['regulatory', 'F.']], {}, '2025-06-30')],
    ['NVDA', profile('NVDA', [['supply_chain', 'G.'], ['regulatory', 'H.'], ['geographic_concentration', 'I.']])],
    [
      'JPM',
      profile('JPM', [['liquidity', 'J.']], {
        coverage: { tier: 'limited_history', filings: 1, tenK: 1, tenQ: 0, byCategory: [] },
      }),
    ],
  ]);

  it('finds common and distinctive themes and ranks attention by the fixed rule', () => {
    const out = composeCompare(['AAPL', 'MSFT', 'NVDA'], profiles);
    if (!out.ok) throw new Error('expected ok');
    const r = out.result;
    expect(r.common.map((t) => t.category)).toEqual(['regulatory']);
    // Category order, not insertion order.
    expect(r.distinctive.map((t) => [t.category, t.tickers])).toEqual([
      ['geographic_concentration', ['NVDA']],
      ['cybersecurity', ['MSFT']],
    ]);
    expect(r.attentionRanking[0]).toMatchObject({ category: 'regulatory', rank: 1 });
    // competition and supply_chain are each shared by two; competition has the better risk rank.
    expect(r.attentionRanking.slice(1, 3).map((t) => t.category)).toEqual(['competition', 'supply_chain']);
    expect(r.notes.join(' ')).toMatch(/Fiscal years end in different months/);
    expect(r.recommendedDiligence[0]?.question).toMatch(/AAPL Inc., MSFT Inc., and NVDA Inc./);
    for (const id of r.common.flatMap((t) => t.citationIds)) expect(r.citations.some((c) => c.chunkId === id)).toBe(true);
  });

  it('still compares a pair with no change signals and labels limited history', () => {
    const out = composeCompare(['NVDA', 'JPM'], profiles);
    if (!out.ok) throw new Error('expected ok');
    expect(out.result.common).toEqual([]);
    expect(out.result.distinctive.length).toBe(4);
    expect(out.result.trajectories[0]?.values).toEqual([
      { ticker: 'NVDA', trajectory: 'not_extracted', chunkIds: [] },
      { ticker: 'JPM', trajectory: 'limited_history', chunkIds: [] },
    ]);
    expect(out.result.notes.join(' ')).toMatch(/JPM Inc.: limited history/);
  });

  it('lists missing tickers and fails with PROFILE_MISSING below two profiles', () => {
    const partial = composeCompare(['AAPL', 'MSFT', 'TSLA'], profiles);
    expect(partial.ok && partial.result.missing).toEqual(['TSLA']);
    expect(composeCompare(['AAPL', 'TSLA'], profiles)).toEqual({ ok: false, code: 'PROFILE_MISSING', missing: ['TSLA'] });
  });

  it('rejects duplicate-only and more-than-five requests instead of reporting an empty missing list', () => {
    // Regression (adversary finding 6): ['AAPL','AAPL'] used to return PROFILE_MISSING with missing: [].
    expect(composeCompare(['AAPL', 'AAPL'], profiles)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    const six = new Map(['A', 'B', 'C', 'D', 'E', 'F'].map((t) => [t, profile(t, [['competition', `${t}.`]])]));
    expect(composeCompare([...six.keys()], six)).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(composeCompare([...six.keys()].slice(0, 5), six).ok).toBe(true);
  });

  it('takes the fiscal-year end from the latest annual report, not the last covered period', () => {
    // Same December fiscal year; MSFT's covered periods end with a quarter (regression, finding 6).
    const a = profile('AAPL', [['competition', 'A.']], {}, '2024-12-31');
    const m = profile('MSFT', [['competition', 'B.']], {
      fiscalYearEnd: '2024-12-31',
      version: { indexVersion: 'test', profileSetId: 'det-v1', templateVersion: 't1', builtAt: '2026-10-01', periodsCovered: ['2024-12-31', '2025-06-30'] },
    });
    const out = composeCompare(['AAPL', 'MSFT'], new Map([['AAPL', a], ['MSFT', m]]));
    if (!out.ok) throw new Error('expected ok');
    expect(out.result.notes.join(' ')).not.toMatch(/Fiscal years end in different months/);
    expect(out.result.companies.map((c) => c.fiscalYearEnd)).toEqual(['2024-12-31', '2024-12-31']);
  });

  it('carries management emphasis per company (architecture §9 contract), model-written when present, null when not summarized', () => {
    const withOutlook = profile('AAPL', [['competition', 'A.']], { managementOutlook: { summary: 'Outlook text.', citationIds: ['AAPL-R1'] } });
    const out = composeCompare(['AAPL', 'NVDA'], new Map([['AAPL', withOutlook], ['NVDA', profiles.get('NVDA')!]]));
    if (!out.ok) throw new Error('expected ok');
    expect(out.result.managementEmphasis).toEqual([
      { ticker: 'AAPL', summary: 'Outlook text.', source: 'model', citationIds: ['AAPL-R1'] },
      { ticker: 'NVDA', summary: null, source: null, citationIds: [] },
    ]);
    expect(out.result.citations.some((c) => c.chunkId === 'AAPL-R1')).toBe(true);
  });

  it('does not treat a slowing trajectory as falling', () => {
    // Regression (finding 6): "slowing" growth is still growth, so growing vs slowing is not a divergence.
    const trend = (trajectory: 'growing' | 'slowing' | 'declining') => ({
      trends: [{ metric: 'Revenue', trajectory, basis: 'x', periods: [], chunkIds: [] }],
    });
    const run = (b: 'slowing' | 'declining') =>
      composeCompare(['AAPL', 'MSFT'], new Map([['AAPL', profile('AAPL', [['competition', 'A.']], trend('growing'))], ['MSFT', profile('MSFT', [['competition', 'B.']], trend(b))]]));
    const slowing = run('slowing');
    expect(slowing.ok && slowing.result.diverging).toEqual([]);
    expect(slowing.ok && slowing.result.recommendedDiligence.some((r) => /falling/.test(r.question))).toBe(false);
    const declining = run('declining');
    expect(declining.ok && declining.result.diverging).toEqual([{ metric: 'Revenue', up: ['AAPL'], down: ['MSFT'] }]);
  });

  it('reports diverging trajectories', () => {
    const up = profile('AAPL', [['competition', 'A.']], {
      trends: [{ metric: 'Revenue', trajectory: 'growing', basis: 'x', periods: [], chunkIds: [] }],
    });
    const down = profile('MSFT', [['competition', 'B.']], {
      trends: [{ metric: 'Revenue', trajectory: 'declining', basis: 'x', periods: [], chunkIds: [] }],
    });
    const out = composeCompare(['AAPL', 'MSFT'], new Map([['AAPL', up], ['MSFT', down]]));
    expect(out.ok && out.result.diverging).toEqual([{ metric: 'Revenue', up: ['AAPL'], down: ['MSFT'] }]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AnalysisOriginSchema,
  CreateAnalysisRequestSchema,
  ERROR_STATUS,
  FindingOriginSchema,
  THEME_IDS,
  THEMES,
  apiError,
  encodeOrigin,
  findingOriginKind,
  getTheme,
  isThemeId,
  parseOrigin,
  type AnalysisOrigin,
  type FindingSource,
} from './index';

describe('theme catalog', () => {
  it('defines every theme ID exactly once, in order, with example questions', () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
    for (const t of THEMES) {
      expect(t.exampleQuestions.length).toBeGreaterThan(0);
      for (const q of t.exampleQuestions) expect(q.length).toBeLessThanOrEqual(1000);
    }
  });

  it('guards unknown IDs', () => {
    expect(isThemeId('risk-factors')).toBe(true);
    expect(isThemeId('risk')).toBe(false);
    expect(() => getTheme('nope' as never)).toThrow();
  });
});

describe('CreateAnalysisRequestSchema', () => {
  it('accepts a minimal question and trims it', () => {
    const r = CreateAnalysisRequestSchema.parse({ question: '  What changed?  ' });
    expect(r.question).toBe('What changed?');
  });

  it('rejects empty, oversized, and unknown fields (including the retired workstreamId)', () => {
    expect(CreateAnalysisRequestSchema.safeParse({ question: '   ' }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'x'.repeat(1001) }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', extra: 1 }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', workstreamId: 'risk-factors' }).success).toBe(false);
  });

  it('accepts every origin variant and rejects malformed ones', () => {
    for (const origin of ALL_ORIGINS) {
      expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', origin }).success, JSON.stringify(origin)).toBe(true);
    }
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', origin: { kind: 'signal', ticker: 'aapl', ref: 'x' } }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', origin: { kind: 'compare', tickers: ['AAPL'], ref: 'x' } }).success).toBe(false);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', origin: { kind: 'direct', extra: 1 } }).success).toBe(false);
  });

  it('accepts only well-formed tickers as filters (TickerSchema)', () => {
    // Regression (adversary finding 14): any 1–10 character string used to pass.
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', filters: { tickers: ['AAPL', 'BRK'] } }).success).toBe(true);
    for (const bad of ['aapl', 'AAPL1', 'TOOLONG', '', 'A-B']) {
      expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', filters: { tickers: [bad] } }).success, bad).toBe(false);
    }
  });

  it('caps tickers at 10 and rejects inverted year ranges', () => {
    const tickers = Array.from({ length: 11 }, (_, i) => `T${String.fromCharCode(65 + i)}`);
    expect(CreateAnalysisRequestSchema.safeParse({ question: 'q', filters: { tickers } }).success).toBe(false);
    expect(
      CreateAnalysisRequestSchema.safeParse({ question: 'q', filters: { fiscalYearFrom: 2025, fiscalYearTo: 2023 } })
        .success,
    ).toBe(false);
  });
});

const ALL_ORIGINS: AnalysisOrigin[] = [
  { kind: 'direct' },
  { kind: 'signal', ticker: 'AAPL', ref: 'sig-1' },
  { kind: 'recommendation', ticker: 'AAPL', ref: 'rec-1' },
  { kind: 'executiveView', ticker: 'MSFT', ref: 'performance' },
  { kind: 'driver', ticker: 'NVDA', ref: 'driver-2' },
  { kind: 'currentRisk', ticker: 'NVDA', ref: 'risk-3' },
  { kind: 'compare', tickers: ['AAPL', 'MSFT', 'NVDA'], ref: 'common-regulatory' },
  { kind: 'thesis', thesisId: 'th-01' },
  { kind: 'watchEvent', ticker: 'TSLA', signalId: 'sig-9' },
  { kind: 'finding', findingId: 'fd-3' },
  { kind: 'brief', analysisId: 'an-7', index: 2 },
];

describe('origin query parameter', () => {
  it('round-trips every AnalysisOrigin variant', () => {
    for (const o of ALL_ORIGINS) expect(parseOrigin(encodeOrigin(o))).toEqual(o);
  });

  it('treats missing, unknown, or malformed values as a direct question', () => {
    for (const raw of [null, undefined, '', 'nonsense', 'signal:aapl:x', 'signal:AAPL', 'brief:an-1:x', 'compare:AAPL:x', 'finding:a:b', 'signal:AAPL:a b']) {
      expect(parseOrigin(raw)).toEqual({ kind: 'direct' });
    }
  });

  it('rejects duplicate compare tickers in an origin or a finding source', () => {
    // Regression (adversary finding 14): compare:AAPL,AAPL:x parsed as a two-company comparison.
    expect(parseOrigin('compare:AAPL,AAPL:common-regulatory')).toEqual({ kind: 'direct' });
    expect(AnalysisOriginSchema.safeParse({ kind: 'compare', tickers: ['AAPL', 'AAPL'], ref: 'x' }).success).toBe(false);
    expect(FindingOriginSchema.safeParse({ kind: 'compare', source: { kind: 'compareRow', tickers: ['MSFT', 'MSFT'], ref: 'x' } }).success).toBe(false);
  });

  it('only ever produces schema-valid origins', () => {
    expect(AnalysisOriginSchema.safeParse(parseOrigin('currentRisk:AAPL:risk-1')).success).toBe(true);
  });
});

describe('finding origin', () => {
  const sources: Array<[FindingSource, string]> = [
    [{ kind: 'keyFinding', analysisId: 'an-1', index: 0 }, 'analysis'],
    [{ kind: 'consideration', analysisId: 'an-1', index: 1 }, 'analysis'],
    [{ kind: 'comparisonRow', analysisId: 'an-1', index: 2 }, 'analysis'],
    [{ kind: 'signal', ticker: 'AAPL', ref: 'sig-1' }, 'intelligence'],
    [{ kind: 'executiveView', ticker: 'AAPL', ref: 'growth' }, 'intelligence'],
    [{ kind: 'recommendation', ticker: 'AAPL', ref: 'rec-1' }, 'intelligence'],
    [{ kind: 'driver', ticker: 'AAPL', ref: 'driver-1' }, 'intelligence'],
    [{ kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' }, 'intelligence'],
    [{ kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'common-regulatory' }, 'compare'],
    [{ kind: 'watchEvent', ticker: 'AAPL', signalId: 'sig-1' }, 'watch'],
  ];

  it('derives origin.kind from every FindingSource variant', () => {
    for (const [source, kind] of sources) {
      expect(findingOriginKind(source)).toBe(kind);
      expect(FindingOriginSchema.safeParse({ kind, source }).success).toBe(true);
    }
  });

  it('rejects an origin whose kind disagrees with its source', () => {
    expect(FindingOriginSchema.safeParse({ kind: 'compare', source: sources[0]![0] }).success).toBe(false);
  });
});

describe('apiError', () => {
  it('maps codes to the documented HTTP status', () => {
    expect(apiError('ANALYSES_DISABLED', 'off', 'req-1')).toEqual({
      status: 503,
      body: { error: { code: 'ANALYSES_DISABLED', message: 'off', requestId: 'req-1' } },
    });
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.PROFILE_MISSING).toBe(404);
    expect(ERROR_STATUS.LIMIT_REACHED).toBe(409);
  });
});

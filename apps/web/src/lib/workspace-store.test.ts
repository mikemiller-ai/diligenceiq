import type { FindingSource } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { builtProfiles } from '@/test/profiles';
import { SAMPLE_ANALYSES } from '@/test/sample-analyses';
import { buildFinding, emptyState, reducer, sourceKey, type WorkspaceState } from './workspace-store';

const withSamples = (): WorkspaceState => ({ ...emptyState(), analyses: SAMPLE_ANALYSES });
const NOW = '2026-10-01T00:00:00Z';

describe('workspace reducer', () => {
  it('starts empty: no hand-written analyses or findings', () => {
    expect(emptyState()).toEqual({ analyses: [], findings: [], nextId: 1 });
  });

  it('saves, updates, deletes, and resets', () => {
    const initial = withSamples();
    const f = buildFinding(initial, FIXTURE_PROFILES, { source: { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' }, theme: 'risk-factors', title: 't', status: 'ACTIVE' }, NOW);
    let s = reducer(initial, { type: 'saveFinding', finding: f });
    expect(s.nextId).toBe(2);
    s = reducer(s, { type: 'updateFinding', findingId: f.findingId, patch: { status: 'RESOLVED', theme: 'strategic-shifts' }, at: 'T1' });
    expect(s.findings[0]).toMatchObject({ status: 'RESOLVED', theme: 'strategic-shifts', updatedAt: 'T1' });
    s = reducer(s, { type: 'deleteFinding', findingId: f.findingId });
    expect(s.findings).toEqual([]);
    expect(reducer(s, { type: 'reset', initial })).toBe(initial);
  });
});

describe('buildFinding copies stored content, never form content', () => {
  it('from a brief key finding, with its context-snapshot citations', () => {
    const s = withSamples();
    const f = buildFinding(s, FIXTURE_PROFILES, { source: { kind: 'keyFinding', analysisId: 'an-01', index: 3 }, theme: 'risk-factors', title: '  ', status: 'ACTIVE', note: ' n ' }, NOW);
    const kf = s.analyses[0]!.brief!.keyFindings[3]!;
    expect(f.text).toBe(kf.finding);
    expect(f.title).toBe(kf.title); // blank title falls back to the stored title
    expect(f.citations.map((c) => c.chunkId)).toEqual(kf.citationIds);
    expect(f.origin).toEqual({ kind: 'analysis', source: { kind: 'keyFinding', analysisId: 'an-01', index: 3 } });
    expect(f.analysisId).toBe('an-01');
    expect(f.note).toBe('n');
  });

  it('from a brief comparison row and an investment consideration', () => {
    const s = withSamples();
    const row = buildFinding(s, FIXTURE_PROFILES, { source: { kind: 'comparisonRow', analysisId: 'an-01', index: 0 }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW);
    expect(row.title).toBe('Manufacturing model');
    expect(row.text).toMatch(/^Apple \(FY2025 10-K\): /);
    expect(row.tickers.sort()).toEqual(['AAPL', 'NVDA']);
    const c = buildFinding(s, FIXTURE_PROFILES, { source: { kind: 'consideration', analysisId: 'an-01', index: 1 }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW);
    expect(c.tickers).toEqual(['NVDA']);
  });

  it('from a profile current risk: the verbatim heading and its passage', () => {
    const f = buildFinding(emptyState(), FIXTURE_PROFILES, { source: { kind: 'currentRisk', ticker: 'NVDA', ref: 'risk-1' }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW);
    const risk = FIXTURE_PROFILES.get('NVDA')!.currentRisks[0]!;
    expect(f.text).toBe(risk.heading);
    expect(f.citations.map((c) => c.chunkId)).toEqual(risk.citationIds);
    expect(f.origin.kind).toBe('intelligence');
    expect(f.analysisId).toBeUndefined();
  });

  it('from a Compare theme row of built profiles, titled by what the row is', () => {
    const profiles = builtProfiles();
    const save = (ref: string, tickers = ['AAPL', 'MSFT', 'NVDA']) =>
      buildFinding(emptyState(), profiles, { source: { kind: 'compareRow', tickers, ref }, theme: 'regulatory-compliance', title: '', status: 'ACTIVE' }, NOW);
    const common = save('theme-regulatory');
    expect(common.origin.kind).toBe('compare');
    expect(common.tickers).toEqual(['AAPL', 'MSFT', 'NVDA']);
    expect(common.citations.length).toBe(3);
    expect(common.title).toBe('Regulatory: common attention area');
    // Regression (adversary finding 7): a distinctive row used to be titled "shared attention area".
    const distinctive = save('theme-supply_chain', ['AAPL', 'MSFT']);
    expect(distinctive.title).toBe('Supply chain: distinctive to Apple Inc');
    expect(distinctive.tickers).toEqual(['AAPL']);
  });

  it('saves side-by-side trajectory rows and diverging rows when they carry evidence (SPEC §13.2)', () => {
    // Regression (adversary finding 7): only common/distinctive rows could be saved.
    const profiles = builtProfiles();
    const trend = (t: string, trajectory: 'growing' | 'declining') => {
      const p = profiles.get(t)!;
      const chunk = p.citations[0]!.chunkId;
      profiles.set(t, { ...p, trends: [{ metric: 'Revenue', trajectory, basis: 'test', periods: [], chunkIds: [chunk] }] });
      return chunk;
    };
    const a = trend('AAPL', 'growing');
    const m = trend('MSFT', 'declining');
    const save = (ref: string) =>
      buildFinding(emptyState(), profiles, { source: { kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW);
    const row = save('trajectory-revenue');
    expect(row.title).toBe('Revenue trend across Apple Inc, Microsoft Corporation');
    expect(row.citations.map((c) => c.chunkId)).toEqual([a, m]);
    const div = save('diverging-revenue');
    expect(div.text).toBe('Revenue: rising at Apple Inc; falling at Microsoft Corporation.');
    expect(div.citations.map((c) => c.chunkId)).toEqual([a, m]);
    // With no extracted trend there is no evidence, so the row cannot be saved.
    expect(() =>
      buildFinding(emptyState(), builtProfiles(), { source: { kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'trajectory-revenue' }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW),
    ).toThrow();
  });

  it('refuses Compare theme rows built from fixture profiles (a selection, not the full risk list)', () => {
    // Regression (adversary finding 1): saving "common/distinctive" conclusions from a hand-picked subset.
    expect(() =>
      buildFinding(emptyState(), FIXTURE_PROFILES, { source: { kind: 'compareRow', tickers: ['AAPL', 'MSFT', 'NVDA'], ref: 'theme-regulatory' }, theme: 'regulatory-compliance', title: '', status: 'ACTIVE' }, NOW),
    ).toThrow();
  });

  it('from a recommendation: cites the current risk it rests on and takes that risk’s theme', () => {
    // Regression (adversary finding 7): recommendations were saved with zero citations and theme risk-factors.
    const msft = FIXTURE_PROFILES.get('MSFT')!;
    const i = msft.recommendedDiligence.findIndex((r) => r.citationIds.some((id) => msft.currentRisks.find((x) => x.category === 'regulatory')?.citationIds.includes(id)));
    const f = buildFinding(emptyState(), FIXTURE_PROFILES, { source: { kind: 'recommendation', ticker: 'MSFT', ref: `rec-${i + 1}` }, theme: 'risk-factors', title: '', status: 'ACTIVE' }, NOW);
    expect(f.citations.length).toBeGreaterThan(0);
    expect(f.citations.map((c) => c.chunkId)).toEqual(msft.recommendedDiligence[i]!.citationIds);
  });

  it('rejects items that do not exist', () => {
    const s = withSamples();
    for (const source of [
      { kind: 'keyFinding', analysisId: 'an-04', index: 0 },
      { kind: 'keyFinding', analysisId: 'an-01', index: 99 },
      { kind: 'currentRisk', ticker: 'TSLA', ref: 'risk-1' },
      { kind: 'signal', ticker: 'AAPL', ref: 'nope' },
      { kind: 'compareRow', tickers: ['AAPL', 'TSLA'], ref: 'theme-regulatory' },
      { kind: 'watchEvent', ticker: 'AAPL', signalId: 's' },
    ] satisfies FindingSource[]) {
      expect(() => buildFinding(s, FIXTURE_PROFILES, { source, theme: 'risk-factors', title: 't', status: 'ACTIVE' }, NOW), JSON.stringify(source)).toThrow();
    }
  });

  it('keys sources stably so an item is saved once', () => {
    expect(sourceKey({ kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' })).toBe(sourceKey({ kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' }));
    // Regression (adversary finding 7): ticker order used to make two keys for one compare row.
    expect(sourceKey({ kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'theme-regulatory' })).toBe(
      sourceKey({ kind: 'compareRow', tickers: ['MSFT', 'AAPL'], ref: 'theme-regulatory' }),
    );
  });

  it('never stores the same item twice, in buildFinding or the reducer', () => {
    // Regression (adversary finding 7): the reducer and buildFinding accepted duplicates.
    const profiles = builtProfiles();
    const input = (tickers: string[]) => ({ source: { kind: 'compareRow' as const, tickers, ref: 'theme-regulatory' }, theme: 'risk-factors' as const, title: 't', status: 'ACTIVE' as const });
    const first = buildFinding(emptyState(), profiles, input(['AAPL', 'MSFT']), NOW);
    const s = reducer(emptyState(), { type: 'saveFinding', finding: first });
    expect(() => buildFinding(s, profiles, input(['MSFT', 'AAPL']), NOW)).toThrow(/already saved/);
    const dup = { ...first, findingId: 'fd-other', origin: { kind: 'compare' as const, source: input(['MSFT', 'AAPL']).source } };
    expect(reducer(s, { type: 'saveFinding', finding: dup })).toBe(s);
  });

  it('never saves an item without a cited passage', () => {
    // 30-second view placeholders have no citation, so they cannot become findings (SPEC §17.1).
    expect(() =>
      buildFinding(emptyState(), FIXTURE_PROFILES, { source: { kind: 'executiveView', ticker: 'AAPL', ref: 'performance' }, theme: 'risk-factors', title: 't', status: 'ACTIVE' }, NOW),
    ).toThrow(/no cited evidence/);
  });
});

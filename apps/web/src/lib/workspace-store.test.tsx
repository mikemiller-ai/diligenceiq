import { SIGNAL_CATEGORY_LABELS, findingOriginKind, profileRef, resolveSource, sourceKey, themeForCategory, type CompanyIntelligenceProfile, type Finding, type FindingSource, type SignalCategory } from '@diligenceiq/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { createMemoryClient } from '@/test/memory-client';
import { builtProfiles } from '@/test/profiles';
import { SAMPLE_ANALYSES } from '@/test/sample-analyses';
import { WorkspaceProvider, useWorkspace } from './workspace-store';

/** What a save copies (core resolveSource, the function POST /api/findings runs server-side). */
function copyOf(source: FindingSource, profiles: ReadonlyMap<string, CompanyIntelligenceProfile> = FIXTURE_PROFILES) {
  const r = resolveSource(source, { analyses: SAMPLE_ANALYSES, profiles });
  if (!r) throw new Error('The item to save no longer exists or has no cited evidence.');
  return { ...r, origin: { kind: findingOriginKind(source), source } };
}

function workspaceHook(memory = createMemoryClient({ analyses: SAMPLE_ANALYSES, profiles: FIXTURE_PROFILES })) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <WorkspaceProvider client={memory.client}>{children}</WorkspaceProvider>;
  return { ...renderHook(() => useWorkspace(), { wrapper }), memory };
}

describe('workspace store (api-backed)', () => {
  it('opens a session, then loads analyses, findings and the profile set’s companies', async () => {
    const { result, memory } = workspaceHook();
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(memory.calls[0]?.method).toBe('session');
    expect(result.current.analyses.map((a) => a.analysisId)).toEqual(SAMPLE_ANALYSES.map((a) => a.analysisId));
    expect([...result.current.profileTickers].sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('saves through the server (once per source), updates, deletes and resets', async () => {
    const { result, memory } = workspaceHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const source = { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' } as const;
    const f = await act(() => result.current.saveFinding({ source, theme: 'risk-factors', title: 't', status: 'ACTIVE' }));
    expect(result.current.savedKeys.has(sourceKey(source))).toBe(true);
    await expect(act(() => result.current.saveFinding({ source, theme: 'risk-factors', title: 't', status: 'ACTIVE' }))).rejects.toMatchObject({ code: 'ALREADY_SAVED' });
    await act(() => result.current.updateFinding(f.findingId, { status: 'RESOLVED', theme: 'strategic-shifts' }));
    expect(result.current.findings[0]).toMatchObject({ status: 'RESOLVED', theme: 'strategic-shifts' });
    await act(() => result.current.deleteFinding(f.findingId));
    expect(result.current.findings).toEqual([]);
    await act(() => result.current.reset());
    expect(memory.calls.some((c) => c.method === 'reset')).toBe(true);
  });

  it('a failed save leaves the board unchanged and surfaces the server error', async () => {
    const { result, memory } = workspaceHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const { ApiRequestError } = await import('./api');
    memory.failNext(new ApiRequestError('LIMIT_REACHED', 'Too many findings.', 409, 'req-9'));
    await expect(act(() => result.current.saveFinding({ source: { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' }, theme: 'risk-factors', title: 't', status: 'ACTIVE' }))).rejects.toMatchObject({ code: 'LIMIT_REACHED', requestId: 'req-9' });
    expect(result.current.findings).toEqual([]);
  });

  it('a session that cannot be opened is an error state with the request ID', async () => {
    const memory = createMemoryClient();
    const { ApiRequestError } = await import('./api');
    memory.failNext(new ApiRequestError('RATE_LIMITED', 'Limit of new workspaces.', 429, 'req-1'));
    const { result } = workspaceHook(memory);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatchObject({ code: 'RATE_LIMITED', requestId: 'req-1' });
  });

  it('loads a profile once, and remembers a company outside the profile set as missing without a request', async () => {
    const { result, memory } = workspaceHook();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.loadProfile('AAPL'));
    await act(() => result.current.loadProfile('AAPL'));
    await act(() => result.current.loadProfile('KO'));
    expect(memory.calls.filter((c) => c.method === 'profile').map((c) => c.args[0])).toEqual(['AAPL']);
    expect(result.current.profiles.has('AAPL')).toBe(true);
    expect(result.current.profileStates.get('KO')).toBe('missing');
  });
});

describe('saving copies stored content, never form content (resolveSource)', () => {
  it('from a brief key finding, with its cited passages', () => {
    const f = copyOf({ kind: 'keyFinding', analysisId: 'an-01', index: 3 });
    const kf = SAMPLE_ANALYSES[0]!.brief!.keyFindings[3]!;
    expect(f.text).toBe(kf.finding);
    expect(f.title).toBe(kf.title);
    expect(f.citations.map((c) => c.chunkId)).toEqual(kf.citationIds);
    expect(f.origin).toEqual({ kind: 'analysis', source: { kind: 'keyFinding', analysisId: 'an-01', index: 3 } });
    expect(f.analysisId).toBe('an-01');
  });

  it('from a brief comparison row and an investment consideration', () => {
    const row = copyOf({ kind: 'comparisonRow', analysisId: 'an-01', index: 0 });
    expect(row.title).toBe('Manufacturing model');
    expect(row.text).toMatch(/^Apple \(FY2025 10-K\): /);
    expect(row.tickers.sort()).toEqual(['AAPL', 'NVDA']);
    expect(copyOf({ kind: 'consideration', analysisId: 'an-01', index: 1 }).tickers).toEqual(['NVDA']);
  });

  it('from a profile current risk: the verbatim heading and its passage', () => {
    const f = copyOf({ kind: 'currentRisk', ticker: 'NVDA', ref: 'risk-1' });
    const risk = FIXTURE_PROFILES.get('NVDA')!.currentRisks[0]!;
    expect(f.text).toBe(risk.heading);
    expect(f.citations.map((c) => c.chunkId)).toEqual(risk.citationIds);
    expect(f.origin.kind).toBe('intelligence');
    expect(f.analysisId).toBeUndefined();
  });

  it('from a Compare theme row of built profiles, titled by what the row is', () => {
    const profiles = builtProfiles();
    const save = (ref: string, tickers = ['AAPL', 'MSFT', 'NVDA']) => copyOf({ kind: 'compareRow', tickers, ref }, profiles);
    const common = save('theme-regulatory');
    expect(common.origin.kind).toBe('compare');
    expect(common.tickers).toEqual(['AAPL', 'MSFT', 'NVDA']);
    const regulatoryIds = [...new Set(['AAPL', 'MSFT', 'NVDA'].flatMap((t) => profiles.get(t)!.currentRisks.filter((r) => r.category === 'regulatory').flatMap((r) => r.citationIds)))];
    expect(regulatoryIds.length).toBeGreaterThanOrEqual(3);
    expect(common.citations.map((c) => c.chunkId)).toEqual(regulatoryIds);
    for (const t of ['AAPL', 'MSFT', 'NVDA']) expect(common.citations.some((c) => c.ticker === t), t).toBe(true);
    expect(common.title).toBe('Regulatory: common attention area');
    // Regression (adversary finding 7): a distinctive row used to be titled "shared attention area".
    const distinctive = save('theme-supply_chain', ['AAPL', 'MSFT']);
    expect(distinctive.title).toBe('Supply chain: distinctive to Apple Inc');
    expect(distinctive.tickers).toEqual(['AAPL']);
  });

  it('saves side-by-side trajectory rows and diverging rows when they carry evidence (SPEC §13.2)', () => {
    const profiles = builtProfiles();
    const trend = (t: string, trajectory: 'growing' | 'declining') => {
      const p = profiles.get(t)!;
      const chunk = p.citations[0]!.chunkId;
      profiles.set(t, { ...p, trends: [{ metric: 'Revenue', trajectory, basis: 'test', periods: [], chunkIds: [chunk] }] });
      return chunk;
    };
    const a = trend('AAPL', 'growing');
    const m = trend('MSFT', 'declining');
    const save = (ref: string) => copyOf({ kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref }, profiles);
    const row = save('trajectory-revenue');
    expect(row.title).toBe('Revenue trend across Apple Inc, Microsoft Corporation');
    expect(row.citations.map((c) => c.chunkId)).toEqual([a, m]);
    const div = save('diverging-revenue');
    expect(div.text).toBe('Revenue: rising at Apple Inc; falling at Microsoft Corporation.');
    expect(div.citations.map((c) => c.chunkId)).toEqual([a, m]);
    // With no extracted trend there is no evidence, so the row cannot be saved.
    expect(() => copyOf({ kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'trajectory-revenue' }, builtProfiles())).toThrow();
  });

  it('refuses Compare theme rows built from preview profiles (an extracted list that can miss headings)', () => {
    expect(() => copyOf({ kind: 'compareRow', tickers: ['AAPL', 'MSFT', 'NVDA'], ref: 'theme-regulatory' })).toThrow();
  });

  it('from a recommendation: cites the current risk it rests on and takes that risk’s theme', () => {
    const msft = FIXTURE_PROFILES.get('MSFT')!;
    const i = msft.recommendedDiligence.findIndex((r) => / regulatory risk/.test(r.question));
    expect(i).toBeGreaterThanOrEqual(0);
    const firstRegulatory = msft.currentRisks.find((x) => x.category === 'regulatory')!;
    const f = copyOf({ kind: 'recommendation', ticker: 'MSFT', ref: `rec-${i + 1}` });
    expect(f.citations.length).toBeGreaterThan(0);
    expect(f.citations.map((c) => c.chunkId)).toEqual(msft.recommendedDiligence[i]!.citationIds);
    expect(f.citations.map((c) => c.chunkId)).toEqual(firstRegulatory.citationIds);

    const areaOf = (question: string) =>
      (Object.entries(SIGNAL_CATEGORY_LABELS) as Array<[SignalCategory, string]>).find(([, label]) => question.includes(` ${label.toLowerCase()} risk`))?.[0];
    for (const p of FIXTURE_PROFILES.values()) {
      p.recommendedDiligence.forEach((r, idx) => {
        const area = areaOf(r.question);
        expect(area, r.question).toBeDefined();
        const resolved = resolveSource({ kind: 'recommendation', ticker: p.ticker, ref: profileRef.recommendation(idx) }, { analyses: [], profiles: FIXTURE_PROFILES });
        expect(resolved?.defaultTheme, `${p.ticker} ${r.question}`).toBe(themeForCategory(area!));
      });
    }
  });

  it('rejects items that do not exist', () => {
    for (const source of [
      { kind: 'keyFinding', analysisId: 'an-04', index: 0 },
      { kind: 'keyFinding', analysisId: 'an-01', index: 99 },
      { kind: 'currentRisk', ticker: 'TSLA', ref: 'risk-1' },
      { kind: 'signal', ticker: 'AAPL', ref: 'nope' },
      { kind: 'compareRow', tickers: ['AAPL', 'TSLA'], ref: 'theme-regulatory' },
      { kind: 'watchEvent', ticker: 'AAPL', signalId: 's' },
    ] satisfies FindingSource[]) {
      expect(() => copyOf(source), JSON.stringify(source)).toThrow();
    }
  });

  it('keys sources stably so an item is saved once', () => {
    expect(sourceKey({ kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' })).toBe(sourceKey({ kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' }));
    // Regression (adversary finding 7): ticker order used to make two keys for one compare row.
    expect(sourceKey({ kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'theme-regulatory' })).toBe(sourceKey({ kind: 'compareRow', tickers: ['MSFT', 'AAPL'], ref: 'theme-regulatory' }));
  });

  it('never saves an item without a cited passage', () => {
    // 30-second view placeholders have no citation, so they cannot become findings (SPEC §17.1).
    expect(() => copyOf({ kind: 'executiveView', ticker: 'AAPL', ref: 'performance' })).toThrow(/no cited evidence/);
  });
});

describe('savedKeys and profile sets (code-review)', () => {
  it('a profile finding from another profile set does not mark the same positional ref as saved', async () => {
    const aapl = FIXTURE_PROFILES.get('AAPL')!;
    const source = { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' } as const;
    const old: Finding = { findingId: 'fd-old', title: 't', text: 'x', theme: 'risk-factors', tickers: ['AAPL'], citations: [], origin: { kind: 'intelligence', source }, status: 'ACTIVE', pinnedToIC: false, isKey: false, createdAt: 'a', updatedAt: 'a', profileSetId: 'det-v0' };
    const memory = createMemoryClient({ profiles: FIXTURE_PROFILES, findings: [old] });
    const { result } = workspaceHook(memory);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(aapl.version.profileSetId).toBe('fixture-v2');
    expect(result.current.savedKeys.has(sourceKey(source))).toBe(false);
  });
});

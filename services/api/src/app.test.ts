import { ApiErrorSchema, type AnalysisDetail, type Finding, type Page } from '@diligenceiq/core';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPS, MAX_BODY_BYTES } from './app';
import type { HttpResponse } from './http';
import { SESSION_COOKIE, SESSION_COOKIE_SECURE, encodeSessionValue } from './session/session';
import { SEED, authed, body, makeEvent, newSession, testApp } from './test-helpers';
import { MAX_FINDINGS_PER_WORKSPACE } from './workspace/store';

function expectApiError(res: HttpResponse, status: number, code: string) {
  expect(res.statusCode, res.body).toBe(status);
  const parsed = ApiErrorSchema.parse(body(res));
  expect(parsed.error.code).toBe(code);
  expect(parsed.error.requestId).toBe('req-123');
  expect(res.body).not.toMatch(/\bat .+:\d+:\d+/); // no stack frames
  return parsed;
}

const QUESTION = 'What are the primary risk factors facing Apple?';

describe('common response shape and routing', () => {
  it('sets JSON, no-store and the request id on success and error responses', async () => {
    const { app } = testApp();
    for (const event of [makeEvent('GET', '/api/health'), makeEvent('GET', '/api/nope')]) {
      expect((await app(event)).headers).toMatchObject({ 'content-type': 'application/json', 'cache-control': 'no-store', 'x-request-id': 'req-123' });
    }
  });

  it('404s unknown paths and wrong methods, and tolerates a trailing slash', async () => {
    const { app } = testApp();
    expectApiError(await app(makeEvent('GET', '/api/does-not-exist')), 404, 'NOT_FOUND');
    expectApiError(await app(makeEvent('DELETE', '/api/health')), 404, 'NOT_FOUND');
    expect((await app(makeEvent('GET', '/api/health/'))).statusCode).toBe(200);
  });

  it('the Phase 1 cookie probe is gone (replaced by POST /api/session)', async () => {
    const { app } = testApp();
    expectApiError(await app(makeEvent('GET', '/api/diagnostics/cookie')), 404, 'NOT_FOUND');
  });

  it('health reports the index, the active profile set and the kill switch, without a session', async () => {
    const { app, state } = testApp();
    state.enabled = false;
    const res = await app(makeEvent('GET', '/api/health'));
    expect(body(res)).toEqual({ status: 'ok', indexVersion: 'iv-9cf51c066743', indexAvailable: true, profileSetId: 'fixture-v2', profileIndexVersion: 'iv-9cf51c066743', analysesEnabled: false });
  });

  it('an unexpected error is a 500 INTERNAL with no stack trace', async () => {
    const { app } = testApp({ deps: { indexAvailable: async () => { throw new Error('secret detail at foo.ts:1:2'); } } });
    const res = await app(makeEvent('GET', '/api/health'));
    expectApiError(res, 500, 'INTERNAL');
    expect(res.body).not.toContain('secret detail');
  });
});

describe('sessions (SPEC §40, §39)', () => {
  it('creates a seeded workspace with a signed, httpOnly, Secure, SameSite=Lax cookie', async () => {
    const { app, workspace } = testApp();
    const res = await app(makeEvent('POST', '/api/session'));
    expect(res.statusCode).toBe(200);
    const b = body<{ workspaceId: string; created: boolean; expiresAt: string }>(res);
    expect(b.created).toBe(true);
    expect(b.workspaceId).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const cookie = res.cookies?.[0] ?? '';
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_SECURE}=${b.workspaceId}\\.[A-Za-z0-9_-]+; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$`));
    expect((await workspace.getMeta(b.workspaceId))?.seedVersion).toBe(SEED.seedVersion);
  });

  it('is idempotent for a valid cookie and replaces a forged one', async () => {
    const { app } = testApp();
    const { cookie, workspaceId } = await newSession(app);
    const again = body<{ workspaceId: string; created: boolean }>(await app(makeEvent('POST', '/api/session', { cookies: [cookie] })));
    expect(again).toMatchObject({ workspaceId, created: false });
    const forged = `${SESSION_COOKIE_SECURE}=${encodeSessionValue('another-secret-that-is-long-enough-000000', workspaceId)}`;
    const fresh = body<{ workspaceId: string; created: boolean }>(await app(makeEvent('POST', '/api/session', { cookies: [forged] })));
    expect(fresh.created).toBe(true);
    expect(fresh.workspaceId).not.toBe(workspaceId);
  });

  it('caps workspace creation per day (429, scope workspace_creation)', async () => {
    const { app } = testApp({ caps: { ...DEFAULT_CAPS, dailyWorkspaceCreations: 2 } });
    await newSession(app);
    await newSession(app);
    const res = expectApiError(await app(makeEvent('POST', '/api/session')), 429, 'RATE_LIMITED');
    expect(res.error.details).toMatchObject({ scope: 'workspace_creation' });
  });

  it('every other route requires a valid session (401 SESSION_REQUIRED)', async () => {
    const { app } = testApp();
    const { workspaceId } = await newSession(app);
    const forged = `${SESSION_COOKIE_SECURE}=${workspaceId}.AAAA`;
    for (const [m, p] of [['GET', '/api/workspace'], ['POST', '/api/analyses'], ['GET', '/api/analyses'], ['GET', '/api/findings'], ['GET', '/api/companies'], ['POST', '/api/workspace/reset']] as const) {
      expectApiError(await app(makeEvent(m, p)), 401, 'SESSION_REQUIRED');
      expectApiError(await app(makeEvent(m, p, { cookies: [forged] })), 401, 'SESSION_REQUIRED');
    }
  });

  it('a signed cookie whose workspace expired (TTL) is not a session', async () => {
    const { app, workspace } = testApp();
    const { cookie, workspaceId } = await newSession(app);
    workspace.metas.delete(workspaceId);
    expectApiError(await app(authed(cookie, 'GET', '/api/workspace')), 401, 'SESSION_REQUIRED');
  });
});

describe('workspace and seed', () => {
  it('the seed is real pipeline output: COMPLETE analyses with snapshots, and findings copied server-side', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const ws = body<{ stats: { analyses: number; findings: number }; recentFindings: Finding[] }>(await app(authed(cookie, 'GET', '/api/workspace')));
    expect(ws.stats.analyses).toBe(SEED.analyses.length);
    expect(ws.stats.findings).toBe(SEED.findings.length);
    for (const a of SEED.analyses) {
      const detail = body<AnalysisDetail>(await app(authed(cookie, 'GET', `/api/analyses/${a.analysisId}`)));
      expect(detail).toMatchObject({ status: 'COMPLETE', seeded: true, question: a.question });
      expect(detail.telemetry?.generationCallCount).toBe(1);
      // A replay measures nothing: no durations presented as real, and the telemetry names this record.
      expect(detail.telemetry).toMatchObject({ analysisId: a.analysisId, replayed: true, retrievalDurationMs: 0, generationDurationMs: 0, totalDurationMs: 0 });
      const ctx = body<{ passages: unknown[] }>(await app(authed(cookie, 'GET', `/api/analyses/${a.analysisId}/context`)));
      expect(ctx.passages.length).toBe(a.context.passages.length);
    }
    for (const f of ws.recentFindings) {
      const src = f.origin.source as { analysisId: string; index: number; kind: string };
      const brief = SEED.analyses.find((a) => a.analysisId === src.analysisId)!.brief;
      const expected = src.kind === 'keyFinding' ? brief.keyFindings[src.index]!.finding : null;
      if (expected) expect(f.text).toBe(expected);
      expect(f.citations.length).toBeGreaterThan(0);
    }
  });

  it('reset deletes and reseeds only the caller’s partition, and keeps the hourly counter', async () => {
    const { app, workspace } = testApp({ caps: { ...DEFAULT_CAPS, workspaceHourlyAnalyses: 1 } });
    const a = await newSession(app);
    const b = await newSession(app);
    await app(authed(a.cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }));
    const bFinding = (await workspace.listFindings(b.workspaceId))[0]!;
    await app(authed(b.cookie, 'DELETE', `/api/findings/${bFinding.findingId}`));

    const res = await app(authed(a.cookie, 'POST', '/api/workspace/reset'));
    expect(res.statusCode).toBe(200);
    const wsA = body<{ stats: { analyses: number; findings: number } }>(await app(authed(a.cookie, 'GET', '/api/workspace')));
    expect(wsA.stats).toEqual({ analyses: SEED.analyses.length, findings: SEED.findings.length });
    // B is untouched: its deletion stands.
    expect((await workspace.listFindings(b.workspaceId)).length).toBe(SEED.findings.length - 1);
    // Reset is not a way around the hourly cap.
    expectApiError(await app(authed(a.cookie, 'POST', '/api/analyses', { body: { question: QUESTION } })), 429, 'RATE_LIMITED');
  });
});

describe('POST /api/analyses (architecture §4.1)', () => {
  it('queues: 202, a QUEUED record with a 240 s deadline, and one message', async () => {
    const t = new Date('2026-10-02T12:00:00Z');
    const { app, sent, analyses } = testApp({ now: () => t });
    const { cookie, workspaceId } = await newSession(app);
    const origin = { kind: 'recommendation', ticker: 'AAPL', ref: 'rec-1' };
    const res = await app(authed(cookie, 'POST', '/api/analyses', { body: { question: `  ${QUESTION}  `, origin, filters: { tickers: ['AAPL'] } } }));
    expect(res.statusCode).toBe(202);
    const { analysisId, status, pollAfterMs } = body<{ analysisId: string; status: string; pollAfterMs: number }>(res);
    expect({ status, pollAfterMs }).toEqual({ status: 'QUEUED', pollAfterMs: 1500 });
    expect(sent).toEqual([{ workspaceId, analysisId }]);
    const record = await analyses.get(workspaceId, analysisId);
    expect(record).toMatchObject({ status: 'QUEUED', question: QUESTION, origin, filters: { tickers: ['AAPL'] }, generationCallCount: 0, deadlineAt: '2026-10-02T12:04:00.000Z' });
  });

  it('validates: empty, too long, unknown fields, unknown tickers, bad JSON, oversized bodies; nothing is queued', async () => {
    const { app, sent } = testApp();
    const { cookie } = await newSession(app);
    const bad = [
      { question: '' },
      { question: '   ' },
      { question: 'x'.repeat(1001) },
      { question: QUESTION, extra: 1 },
      { question: QUESTION, filters: { tickers: ['FORD'] } },
      { question: QUESTION, origin: { kind: 'signal', ticker: 'ZZZZ', ref: 's1' } },
      { question: QUESTION, filters: { fiscalYearFrom: 2025, fiscalYearTo: 2024 } },
      'not json',
      JSON.stringify({ question: 'x'.repeat(MAX_BODY_BYTES) }),
    ];
    for (const b of bad) expectApiError(await app(authed(cookie, 'POST', '/api/analyses', { body: b })), 400, 'VALIDATION_ERROR');
    expect(sent).toEqual([]);
  });

  it('the kill switch off → 503 ANALYSES_DISABLED, before any counter or record', async () => {
    const { app, sent, workspace, state } = testApp();
    const { cookie, workspaceId } = await newSession(app);
    state.enabled = false;
    expectApiError(await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } })), 503, 'ANALYSES_DISABLED');
    expect(sent).toEqual([]);
    expect([...workspace.counters.keys()].some((k) => k.startsWith(`WS#${workspaceId}|RATE#`))).toBe(false);
  });

  it('caps: the workspace hourly cap, then the global daily cap (429 with scope and retryAfter)', async () => {
    const t = new Date('2026-10-02T12:30:00Z');
    const { app } = testApp({ caps: { ...DEFAULT_CAPS, workspaceHourlyAnalyses: 2, globalDailyAnalyses: 3 }, now: () => t });
    const a = await newSession(app);
    const b = await newSession(app);
    const run = (cookie: string) => app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }));
    expect((await run(a.cookie)).statusCode).toBe(202);
    expect((await run(a.cookie)).statusCode).toBe(202);
    expect(expectApiError(await run(a.cookie), 429, 'RATE_LIMITED').error.details).toEqual({ scope: 'workspace_hourly', retryAfter: '2026-10-02T13:00:00.000Z' });
    expect((await run(b.cookie)).statusCode).toBe(202);
    expect(expectApiError(await run(b.cookie), 429, 'RATE_LIMITED').error.details).toEqual({ scope: 'global_daily', retryAfter: '2026-10-03T00:00:00.000Z' });
  });

  it('an enqueue failure marks the analysis FAILED (ENQUEUE_FAILED) and returns 503 with its ID', async () => {
    const { app, analyses } = testApp({ queueFails: true });
    const { cookie, workspaceId } = await newSession(app);
    const err = expectApiError(await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } })), 503, 'ENQUEUE_FAILED');
    const id = String(err.error.details?.analysisId);
    expect((await analyses.get(workspaceId, id))).toMatchObject({ status: 'FAILED', error: { code: 'ENQUEUE_FAILED' } });
    const polled = body<AnalysisDetail>(await app(authed(cookie, 'GET', `/api/analyses/${id}`)));
    expect(polled.error?.code).toBe('ENQUEUE_FAILED');
  });
});

describe('GET /api/analyses/:id (the poll)', () => {
  async function queued(now: { t: Date }) {
    const ctx = testApp({ now: () => now.t });
    const s = await newSession(ctx.app);
    const id = body<{ analysisId: string }>(await ctx.app(authed(s.cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }))).analysisId;
    return { ...ctx, ...s, id };
  }

  it('returns the status without internal fields', async () => {
    const now = { t: new Date('2026-10-02T12:00:00Z') };
    const { app, cookie, id } = await queued(now);
    const res = body<Record<string, unknown>>(await app(authed(cookie, 'GET', `/api/analyses/${id}`)));
    expect(res).toMatchObject({ analysisId: id, status: 'QUEUED', stage: 'queued', deadlineAt: '2026-10-02T12:04:00.000Z' });
    for (const k of ['claimToken', 'ttl', 'workspaceId', 'PK', 'SK']) expect(res).not.toHaveProperty(k);
  });

  it('fails a QUEUED job past its deadline lazily (QUEUE_TIMEOUT)', async () => {
    const now = { t: new Date('2026-10-02T12:00:00Z') };
    const { app, cookie, id } = await queued(now);
    now.t = new Date('2026-10-02T12:04:01Z');
    expect(body<AnalysisDetail>(await app(authed(cookie, 'GET', `/api/analyses/${id}`)))).toMatchObject({ status: 'FAILED', error: { code: 'QUEUE_TIMEOUT', requestId: 'req-123' } });
  });

  it('fails a RUNNING job past its deadline as GENERATION_TIMEOUT or PIPELINE_TIMEOUT', async () => {
    for (const started of [true, false]) {
      const now = { t: new Date('2026-10-02T12:00:00Z') };
      const { app, cookie, id, analyses, workspaceId } = await queued(now);
      await analyses.claim(workspaceId, id, 'tok', now.t);
      if (started) await analyses.markGenerationStarted(workspaceId, id, 'tok', now.t);
      now.t = new Date('2026-10-02T12:05:00Z');
      const res = body<AnalysisDetail>(await app(authed(cookie, 'GET', `/api/analyses/${id}`)));
      expect(res.error?.code).toBe(started ? 'GENERATION_TIMEOUT' : 'PIPELINE_TIMEOUT');
    }
  });

  it('another workspace’s analysis is NOT_FOUND', async () => {
    const now = { t: new Date('2026-10-02T12:00:00Z') };
    const { app, id } = await queued(now);
    const other = await newSession(app);
    expectApiError(await app(authed(other.cookie, 'GET', `/api/analyses/${id}`)), 404, 'NOT_FOUND');
    expectApiError(await app(authed(other.cookie, 'GET', `/api/analyses/${id}/context`)), 404, 'NOT_FOUND');
  });

  it('a missing context snapshot is NOT_FOUND with details.snapshot = missing', async () => {
    const now = { t: new Date('2026-10-02T12:00:00Z') };
    const { app, cookie, id } = await queued(now);
    expect(expectApiError(await app(authed(cookie, 'GET', `/api/analyses/${id}/context`)), 404, 'NOT_FOUND').error.details).toEqual({ snapshot: 'missing' });
  });
});

describe('GET /api/analyses (list)', () => {
  it('lists newest first with an opaque cursor, filters by status, and rejects foreign cursors', async () => {
    let t = Date.parse('2026-10-05T12:00:00Z'); // after the seed's recording times
    const { app } = testApp({ now: () => new Date((t += 1000)) });
    const a = await newSession(app);
    for (let i = 0; i < 3; i++) await app(authed(a.cookie, 'POST', '/api/analyses', { body: { question: `${QUESTION} ${i}` } }));
    const first = body<Page<{ question: string; status: string }>>(await app(authed(a.cookie, 'GET', '/api/analyses', { query: { limit: '2' } })));
    expect(first.items.map((i) => i.question)).toEqual([`${QUESTION} 2`, `${QUESTION} 1`]);
    expect(first.nextCursor).toBeDefined();
    const second = body<Page<{ question: string }>>(await app(authed(a.cookie, 'GET', '/api/analyses', { query: { limit: '2', cursor: first.nextCursor! } })));
    expect(second.items[0]?.question).toBe(`${QUESTION} 0`);
    const complete = body<Page<{ status: string }>>(await app(authed(a.cookie, 'GET', '/api/analyses', { query: { status: 'COMPLETE' } })));
    expect(complete.items.length).toBe(SEED.analyses.length);
    expect(complete.items.every((i) => i.status === 'COMPLETE')).toBe(true);

    const b = await newSession(app);
    expectApiError(await app(authed(b.cookie, 'GET', '/api/analyses', { query: { cursor: first.nextCursor! } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(b.cookie, 'GET', '/api/analyses', { query: { limit: '1000' } })), 400, 'VALIDATION_ERROR');
  });
});

describe('findings (SPEC §17; architecture §9)', () => {
  const seededAnalysis = SEED.analyses.find((a) => a.brief.investmentConsiderations.length > 0)!;

  it('POST copies text and citations from the stored brief; the client cannot supply them', async () => {
    const { app } = testApp({ seed: false });
    const { cookie } = await newSession(app);
    // Without the seed, the analysis does not exist in this workspace.
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'consideration', analysisId: seededAnalysis.analysisId, index: 0 } } })), 404, 'NOT_FOUND');
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'consideration', analysisId: 'x', index: 0 }, text: 'invented' } })), 400, 'VALIDATION_ERROR');
  });

  it('saves a brief item once (409 ALREADY_SAVED on repeat), with origin derived from the source', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const source = { kind: 'consideration', analysisId: seededAnalysis.analysisId, index: 0 };
    const res = await app(authed(cookie, 'POST', '/api/findings', { body: { source, title: '  My title ', note: 'check this' } }));
    expect(res.statusCode).toBe(201);
    const f = body<Finding>(res);
    const c = seededAnalysis.brief.investmentConsiderations[0]!;
    expect(f).toMatchObject({ title: 'My title', text: c.text, note: 'check this', status: 'ACTIVE', origin: { kind: 'analysis', source }, analysisId: seededAnalysis.analysisId, pinnedToIC: false, isKey: false });
    expect(f.citations.map((x) => x.chunkId).sort()).toEqual([...new Set(c.citationIds)].filter((id) => seededAnalysis.citations.some((x) => x.chunkId === id)).sort());
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source } })), 409, 'ALREADY_SAVED');
  });

  it('saves from a profile item and a compare row, and rejects unknown tickers and missing items', async () => {
    const { app, profiles } = testApp();
    const { cookie } = await newSession(app);
    const aapl = (await profiles.get('AAPL', 'r'))!;
    const risk = aapl.currentRisks[0]!;
    const res = await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'currentRisk', ticker: 'AAPL', ref: `risk-${risk.rank}` } } }));
    expect(res.statusCode, res.body).toBe(201);
    expect(body<Finding>(res)).toMatchObject({ text: risk.heading, origin: { kind: 'intelligence' }, tickers: ['AAPL'] });
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'currentRisk', ticker: 'ZZZZ', ref: 'risk-1' } } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-99999' } } })), 404, 'NOT_FOUND');
    // A catalog company with no profile has nothing to copy.
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'currentRisk', ticker: 'KO', ref: 'risk-1' } } })), 404, 'NOT_FOUND');
    const trend = await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'trajectory-revenue' } } }));
    expect([201, 404]).toContain(trend.statusCode);
  });

  it('PATCH updates allowed fields only; DELETE removes; both 404 for unknown IDs', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const list = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings')));
    const f = list.items[0]!;
    const patched = body<Finding>(await app(authed(cookie, 'PATCH', `/api/findings/${f.findingId}`, { body: { status: 'RESOLVED', note: 'done', pinnedToIC: true, theme: 'risk-factors' } })));
    expect(patched).toMatchObject({ status: 'RESOLVED', note: 'done', pinnedToIC: true, theme: 'risk-factors', text: f.text });
    expectApiError(await app(authed(cookie, 'PATCH', `/api/findings/${f.findingId}`, { body: { text: 'rewritten' } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'PATCH', `/api/findings/${f.findingId}`, { body: {} })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'PATCH', `/api/findings/${f.findingId}`, { body: { note: 'x'.repeat(2001) } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'PATCH', '/api/findings/fd-nope', { body: { status: 'ACTIVE' } })), 404, 'NOT_FOUND');
    const del = await app(authed(cookie, 'DELETE', `/api/findings/${f.findingId}`));
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    expectApiError(await app(authed(cookie, 'DELETE', `/api/findings/${f.findingId}`)), 404, 'NOT_FOUND');
  });

  it('lists with filters (theme, status, origin, ticker, pinned) and an offset cursor', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const all = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings'))).items;
    expect(all.length).toBe(SEED.findings.length);
    const followUp = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings', { query: { status: 'NEEDS_FOLLOW_UP' } }))).items;
    expect(followUp.every((f) => f.status === 'NEEDS_FOLLOW_UP')).toBe(true);
    expect(body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings', { query: { origin: 'intelligence' } }))).items).toEqual([]);
    const paged = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings', { query: { limit: '1' } })));
    expect(paged.items.length).toBe(1);
    expect(paged.nextCursor).toBe('1');
    expectApiError(await app(authed(cookie, 'GET', '/api/findings', { query: { cursor: '-1' } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'GET', '/api/findings', { query: { theme: 'nope' } })), 400, 'VALIDATION_ERROR');
  });

  it(`caps a workspace at ${MAX_FINDINGS_PER_WORKSPACE} findings (409 LIMIT_REACHED)`, async () => {
    const { app, workspace } = testApp();
    const { cookie, workspaceId } = await newSession(app);
    const existing = (await workspace.listFindings(workspaceId))[0]!;
    for (let i = workspace.findings.get(workspaceId)!.size; i < MAX_FINDINGS_PER_WORKSPACE; i++) workspace.findings.get(workspaceId)!.set(`fd-${i}`, { ...existing, findingId: `fd-${i}` });
    expectApiError(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'consideration', analysisId: seededAnalysis.analysisId, index: 0 } } })), 409, 'LIMIT_REACHED');
  });
});

describe('Company Intelligence and Compare (read-only, from the active profile set)', () => {
  it('lists the active set’s companies', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const res = body<{ profileSetId: string; companies: Array<{ ticker: string }> }>(await app(authed(cookie, 'GET', '/api/companies')));
    expect(res.profileSetId).toBe('fixture-v2');
    expect(res.companies.map((c) => c.ticker).sort()).toEqual(['AAPL', 'MSFT', 'NVDA']);
  });

  it('serves a profile; PROFILE_MISSING for a catalog company without one; 400 for an unknown ticker', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    expect(body<{ ticker: string }>(await app(authed(cookie, 'GET', '/api/companies/AAPL/intelligence'))).ticker).toBe('AAPL');
    expect(expectApiError(await app(authed(cookie, 'GET', '/api/companies/KO/intelligence')), 404, 'PROFILE_MISSING').error.details).toEqual({ ticker: 'KO' });
    expectApiError(await app(authed(cookie, 'GET', '/api/companies/ZZZZ/intelligence')), 400, 'VALIDATION_ERROR');
  });

  it('no active set: every profile is PROFILE_MISSING and the list is empty (dashboards degrade, nothing generates)', async () => {
    const { app } = testApp({ pointer: 'none' });
    const { cookie } = await newSession(app);
    expect(body<{ companies: unknown[]; profileSetId: null }>(await app(authed(cookie, 'GET', '/api/companies')))).toMatchObject({ companies: [], profileSetId: null });
    expectApiError(await app(authed(cookie, 'GET', '/api/companies/AAPL/intelligence')), 404, 'PROFILE_MISSING');
  });

  it('composes Compare deterministically; partial and invalid requests', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const ok = body<{ companies: unknown[]; missing: string[] }>(await app(authed(cookie, 'GET', '/api/compare', { query: { tickers: 'AAPL,MSFT,KO' } })));
    expect(ok.companies.length).toBe(2);
    expect(ok.missing).toEqual(['KO']);
    expect(expectApiError(await app(authed(cookie, 'GET', '/api/compare', { query: { tickers: 'AAPL,KO' } })), 404, 'PROFILE_MISSING').error.details).toEqual({ missing: ['KO'] });
    expectApiError(await app(authed(cookie, 'GET', '/api/compare', { query: { tickers: 'AAPL' } })), 400, 'VALIDATION_ERROR');
    expectApiError(await app(authed(cookie, 'GET', '/api/compare', { query: { tickers: 'AAPL,ZZZZ' } })), 400, 'VALIDATION_ERROR');
  });
});

describe('comparison rows from real briefs (regression: header alignment)', () => {
  it('a saved comparison row pairs each value with its own column (validated briefs carry no row-label header)', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const a = SEED.analyses.find((x) => x.brief.comparison && x.brief.comparison.columns.length === x.brief.comparison.rows[0]!.values.length)!;
    const c = a.brief.comparison!;
    const res = await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'comparisonRow', analysisId: a.analysisId, index: 1 } } }));
    expect(res.statusCode, res.body).toBe(201); // row 1 is not in the seed's findings
    expect(body<Finding>(res).text).toBe(c.columns.map((col, i) => `${col}: ${c.rows[1]!.values[i]}`).join(' · '));
  });
});

describe('Phase 5 fixes: sessions under load, TTL, reset, cookies and JSON bodies', () => {
  const fromIp = (sourceIp: string, extra: Record<string, unknown> = {}) => {
    const e = makeEvent('POST', '/api/session', extra);
    e.requestContext.http.sourceIp = sourceIp;
    return e;
  };

  it('H1: one client cannot drain the global creation cap (per-client limit first, scope workspace_creation_client); the raw IP is never stored', async () => {
    const { app, workspace } = testApp({ caps: { ...DEFAULT_CAPS, dailyWorkspaceCreations: 5, perClientDailyWorkspaceCreations: 2 } });
    expect((await app(fromIp('198.51.100.7'))).statusCode).toBe(200);
    expect((await app(fromIp('198.51.100.7'))).statusCode).toBe(200);
    for (let i = 0; i < 10; i++) {
      const refused = expectApiError(await app(fromIp('198.51.100.7')), 429, 'RATE_LIMITED');
      expect(refused.error.details).toMatchObject({ scope: 'workspace_creation_client' });
    }
    // The refused attempts never reached the global counter, so other visitors still get in.
    const day = new Date().toISOString().slice(0, 10);
    expect(workspace.counters.get(`GLOBAL|WSCREATE#${day}`)).toBe(2);
    expect((await app(fromIp('192.0.2.44'))).statusCode).toBe(200);
    const keys = [...workspace.counters.keys()].join(' ');
    expect(keys).not.toMatch(/198\.51|192\.0\.2/);
    expect(keys).toMatch(new RegExp(`GLOBAL\\|WSCREATE#${day}#[0-9a-f]{16}`));
  });

  it('H1: the global cap still applies across clients (scope workspace_creation)', async () => {
    const { app } = testApp({ caps: { ...DEFAULT_CAPS, dailyWorkspaceCreations: 2, perClientDailyWorkspaceCreations: 20 } });
    await app(fromIp('198.51.100.1'));
    await app(fromIp('198.51.100.2'));
    expect(expectApiError(await app(fromIp('198.51.100.3')), 429, 'RATE_LIMITED').error.details).toMatchObject({ scope: 'workspace_creation' });
  });

  it('a seed that fails still returns the session (an empty, usable workspace), and the slot is used once', async () => {
    const { app, workspace } = testApp();
    workspace.putSeedAnalysis = async () => {
      throw new Error('dynamo down');
    };
    const res = await app(makeEvent('POST', '/api/session'));
    expect(res.statusCode).toBe(200);
    const { workspaceId } = body<{ workspaceId: string; created: boolean }>(res);
    const cookie = (res.cookies?.[0] ?? '').split(';')[0]!;
    expect((await app(authed(cookie, 'GET', '/api/workspace'))).statusCode).toBe(200);
    expect(await workspace.getMeta(workspaceId)).not.toBeNull();
    const day = new Date().toISOString().slice(0, 10);
    expect(workspace.counters.get(`GLOBAL|WSCREATE#${day}`)).toBe(1);
    // A second visit with the cookie reuses the workspace; nothing new is minted.
    expect(body<{ created: boolean }>(await app(makeEvent('POST', '/api/session', { cookies: [cookie] }))).created).toBe(false);
    expect(workspace.counters.get(`GLOBAL|WSCREATE#${day}`)).toBe(1);
  });

  it('M5: a META past its TTL is no session (DynamoDB deletes lazily); a returning visitor’s TTL is extended at most once a day', async () => {
    const t = { now: new Date('2026-10-02T12:00:00Z') };
    const { app, workspace } = testApp({ now: () => t.now });
    const { cookie, workspaceId } = await newSession(app);
    const created = (await workspace.getMeta(workspaceId))!.ttl;

    t.now = new Date('2026-10-02T20:00:00Z'); // under a day later: no write
    const extend = vi.spyOn(workspace, 'extendMeta');
    await app(makeEvent('POST', '/api/session', { cookies: [cookie] }));
    expect(extend).not.toHaveBeenCalled();

    t.now = new Date('2026-10-20T12:00:00Z'); // 18 days later: extended to 30 days from now
    const again = body<{ created: boolean; expiresAt: string }>(await app(makeEvent('POST', '/api/session', { cookies: [cookie] })));
    expect(again).toMatchObject({ created: false, expiresAt: '2026-11-19T12:00:00.000Z' });
    expect((await workspace.getMeta(workspaceId))!.ttl).toBeGreaterThan(created);

    t.now = new Date('2026-12-25T12:00:00Z'); // past the TTL, item not yet deleted
    expect(await workspace.getMeta(workspaceId)).not.toBeNull();
    expectApiError(await app(authed(cookie, 'GET', '/api/workspace')), 401, 'SESSION_REQUIRED');
    const fresh = body<{ workspaceId: string; created: boolean }>(await app(makeEvent('POST', '/api/session', { cookies: [cookie] })));
    expect(fresh.created).toBe(true);
    expect(fresh.workspaceId).not.toBe(workspaceId);
  });

  it('M6: reset keeps META, so a request between the clear and the reseed still has its session', async () => {
    const { app, workspace } = testApp();
    const { cookie, workspaceId } = await newSession(app);
    await workspace.clearWorkspace(workspaceId); // the moment inside a reset before META is rewritten
    expect((await app(authed(cookie, 'GET', '/api/workspace'))).statusCode).toBe(200);
    const res = body<{ workspaceId: string }>(await app(authed(cookie, 'POST', '/api/workspace/reset')));
    expect(res.workspaceId).toBe(workspaceId);
    expect((await workspace.getMeta(workspaceId))?.seedVersion).toBe(SEED.seedVersion);
  });

  it('cookie: production uses the __Host- name and ignores a plain diq_ws cookie; the local server uses diq_ws without Secure', async () => {
    const { app } = testApp();
    const { workspaceId, cookie } = await newSession(app);
    const plain = cookie.replace(`${SESSION_COOKIE_SECURE}=`, `${SESSION_COOKIE}=`);
    expectApiError(await app(authed(plain, 'GET', '/api/workspace')), 401, 'SESSION_REQUIRED');
    expect(body<{ workspaceId: string }>(await app(authed(cookie, 'GET', '/api/workspace'))).workspaceId).toBe(workspaceId);

    const local = testApp({ deps: { secureCookies: false } });
    const res = await local.app(makeEvent('POST', '/api/session'));
    const set = res.cookies?.[0] ?? '';
    expect(set).toMatch(/^diq_ws=/);
    expect(set).not.toContain('Secure');
    expect((await local.app(authed(set.split(';')[0]!, 'GET', '/api/workspace'))).statusCode).toBe(200);
  });

  it('write bodies must be JSON: text/plain or a form is 400 VALIDATION_ERROR; a charset parameter is fine', async () => {
    const { app, sent } = testApp();
    const { cookie } = await newSession(app);
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', '']) {
      const err = expectApiError(await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION }, contentType })), 400, 'VALIDATION_ERROR');
      expect(err.error.message).toBe('Request body must be sent as application/json.');
    }
    expect(sent).toEqual([]);
    expect((await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION }, contentType: 'application/json; charset=utf-8' }))).statusCode).toBe(202);
    const f = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings'))).items[0]!;
    expectApiError(await app(authed(cookie, 'PATCH', `/api/findings/${f.findingId}`, { body: { status: 'RESOLVED' }, contentType: 'text/plain' })), 400, 'VALIDATION_ERROR');
  });

  it('GET /api/workspace counts every analysis (a COUNT, not the first page) and lists the 10 newest', async () => {
    let t = Date.parse('2026-10-05T12:00:00Z');
    const { app } = testApp({ now: () => new Date((t += 1000)), caps: { ...DEFAULT_CAPS, workspaceHourlyAnalyses: 50 } });
    const { cookie } = await newSession(app);
    for (let i = 0; i < 12; i++) await app(authed(cookie, 'POST', '/api/analyses', { body: { question: `${QUESTION} ${i}` } }));
    const ws = body<{ stats: { analyses: number }; recentAnalyses: unknown[] }>(await app(authed(cookie, 'GET', '/api/workspace')));
    expect(ws.stats.analyses).toBe(12 + SEED.analyses.length);
    expect(ws.recentAnalyses.length).toBe(10);
  });
});

describe('Phase 5 fixes: findings carry figure checks and provenance; the cap is a COUNT', () => {
  const pdf2 = SEED.analyses.find((a) => a.validation.numeric.figures.some((f) => !f.verified && f.location.startsWith('comparison.rows[1].')))!;

  it('M2: a saved brief item keeps its numeric-grounding checks (unverified figure markers)', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const res = await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'comparisonRow', analysisId: pdf2.analysisId, index: 1 } } }));
    expect(res.statusCode, res.body).toBe(201);
    const f = body<Finding>(res);
    expect(f.figures?.length).toBeGreaterThan(0);
    expect(f.figures!.every((x) => x.location.startsWith('comparison.rows[1].'))).toBe(true);
    expect(f.figures!.some((x) => !x.verified)).toBe(true);
    expect(f.seeded).toBeUndefined();
  });

  it('M3: seed findings, and only they, are labeled seeded', async () => {
    const { app, profiles } = testApp();
    const { cookie } = await newSession(app);
    const seeded = body<Page<Finding>>(await app(authed(cookie, 'GET', '/api/findings'))).items;
    expect(seeded.length).toBe(SEED.findings.length);
    expect(seeded.every((f) => f.seeded === true)).toBe(true);
    const risk = (await profiles.get('AAPL', 'r'))!.currentRisks[0]!;
    const mine = body<Finding>(await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'currentRisk', ticker: 'AAPL', ref: `risk-${risk.rank}` } } })));
    expect(mine.seeded).toBeUndefined();
  });

  it('M11: saving checks the cap with a count, never by reading every finding', async () => {
    const { app, workspace } = testApp();
    const { cookie } = await newSession(app);
    const list = vi.spyOn(workspace, 'listFindings');
    const count = vi.spyOn(workspace, 'countFindings');
    expect((await app(authed(cookie, 'POST', '/api/findings', { body: { source: { kind: 'comparisonRow', analysisId: pdf2.analysisId, index: 1 } } }))).statusCode).toBe(201);
    expect(count).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('profile findings are scoped to their profile set (code-review)', () => {
  it('records profileSetId and keys the finding ID on it, so the same positional ref in another set is a different finding', async () => {
    const { findingIdFor } = await import('./workspace/findings');
    const source = { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' } as const;
    expect(findingIdFor(source, 'fixture-v2')).not.toBe(findingIdFor(source, 'det-v1'));
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const res = await app(authed(cookie, 'POST', '/api/findings', { body: { source } }));
    expect(body<Finding>(res)).toMatchObject({ profileSetId: 'fixture-v2', findingId: findingIdFor(source, 'fixture-v2') });
  });
});

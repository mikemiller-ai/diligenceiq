import { FakeGenerationClient, briefCiting, fixtureRetriever } from '@diligenceiq/rag/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryAnalysisStore } from './analyses/store';
import type { SQSRecord } from 'aws-lambda';
import { AnalysisMessageSchema, type WorkerDeps, processAnalysisMessage } from './analyses/worker';
import { handleDeadLetters } from './dlq-handler';
import { log } from './http';
import { authed, makeEvent, newSession, testApp } from './test-helpers';

/*
 * Observability (architecture §12, Phase 7): one access line per api request, the api request ID
 * carried to the worker, and nothing sensitive in either.
 */

/** The logged lines so far, as a live array (each `log` call is one raw JSON line on stdout). */
function captureLogs() {
  const lines: Array<Record<string, unknown>> = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
    lines.push(JSON.parse(String(s)) as Record<string, unknown>);
    return true;
  });
  return lines;
}
afterEach(() => vi.restoreAllMocks());

const QUESTION = 'What supply chain and production risks do Apple and Tesla describe?';

describe('the log line format (CloudWatch metric filters need raw JSON)', () => {
  it('writes exactly one JSON object and a newline to stdout, with no prefix, and never uses console.log', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    log('info', 'analysis summary', { event: 'analysis_summary', status: 'failed', code: 'WORKER_FAILED' });
    expect(write).toHaveBeenCalledTimes(1);
    const raw = String(write.mock.calls[0]![0]);
    expect(raw).toBe('{"level":"info","msg":"analysis summary","event":"analysis_summary","status":"failed","code":"WORKER_FAILED"}\n');
    expect(raw.startsWith('{')).toBe(true);
    expect(raw.indexOf('\n')).toBe(raw.length - 1);
    expect(consoleLog).not.toHaveBeenCalled();
  });
});

describe('api access line', () => {
  it('logs method, route template, status, duration and request ID, once per request', async () => {
    const { app } = testApp();
    const lines = captureLogs();
    await app(makeEvent('GET', '/api/health'));
    const access = lines.filter((l) => l.event === 'api_request');
    expect(access).toHaveLength(1);
    expect(access[0]).toMatchObject({ level: 'info', requestId: 'req-123', method: 'GET', route: 'GET /api/health', status: 200 });
    expect(typeof access[0]!.durationMs).toBe('number');
  });

  it('records the route template, never the IDs in the path or the query', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const lines = captureLogs();
    await app(authed(cookie, 'GET', '/api/analyses/an-secret-id', { query: { q: 'private question' } }));
    const line = lines.find((l) => l.event === 'api_request')!;
    expect(line.route).toBe('GET /api/analyses/:id');
    expect(JSON.stringify(line)).not.toMatch(/an-secret-id|private question/);
  });

  it('carries the error code on a 4xx and marks an unmatched route', async () => {
    const { app } = testApp();
    const lines = captureLogs();
    await app(makeEvent('GET', '/api/nope'));
    expect(lines.find((l) => l.event === 'api_request')).toMatchObject({ route: 'unmatched', status: 404, code: 'NOT_FOUND' });
  });

  it('never logs the question of a POST /api/analyses (only its length, on the queued line)', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    const lines = captureLogs();
    await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }));
    expect(lines.find((l) => l.event === 'api_request')).toMatchObject({ route: 'POST /api/analyses', status: 202 });
    expect(JSON.stringify(lines)).not.toContain('supply chain');
  });

  it('every JSON response carries nosniff and the request ID', async () => {
    const { app } = testApp();
    const res = await app(makeEvent('GET', '/api/health'));
    expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-request-id': 'req-123' });
  });
});

describe('api → worker correlation', () => {
  it('the queue message schema accepts the api request ID and still accepts a message without one', () => {
    expect(AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', apiRequestId: 'Kx1abc=' })).toEqual({ workspaceId: 'ws', analysisId: 'an', apiRequestId: 'Kx1abc=' });
    // Base64-style API Gateway request IDs keep their '+' and '/' (code review, Phase 7).
    expect(AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', apiRequestId: 'Ab3+gA/oAMEb4Q=' }).apiRequestId).toBe('Ab3+gA/oAMEb4Q=');
    expect(AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an' })).toEqual({ workspaceId: 'ws', analysisId: 'an' });
    // A malformed value is dropped, not fatal (see the M5 tests below).
    expect(AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', apiRequestId: 'has spaces' })).toEqual({ workspaceId: 'ws', analysisId: 'an' });
    expect(() => AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', extra: 1 })).toThrow();
  });

  it("the worker's summary line carries both its own request ID and the api's", async () => {
    const store = new MemoryAnalysisStore();
    const T0 = new Date('2026-10-02T12:00:00Z');
    await store.createQueued({ workspaceId: 'ws-test', analysisId: 'an-1', question: QUESTION, origin: { kind: 'direct' }, now: T0 });
    const deps: WorkerDeps = {
      store,
      killSwitch: { read: async () => ({ enabled: true, source: 'parameter' }), analysesEnabled: async () => true },
      index: { loaded: () => true, get: async () => ({ index: { retriever: fixtureRetriever(), indexVersion: 'iv-fixture' }, loadMs: 0, cold: false }) },
      createEmbedder: () => null,
      generationClient: new FakeGenerationClient({ toolInput: briefCiting([]) }),
      now: () => T0,
      newToken: () => 'token-1',
    };
    const lines = captureLogs();
    const body = JSON.stringify({ workspaceId: 'ws-test', analysisId: 'an-1', apiRequestId: 'api-req-9' });
    await processAnalysisMessage(deps, body, { requestId: 'msg-1', remainingTimeMs: () => 175_000 });
    const summary = lines.find((l) => l.event === 'analysis_summary')!;
    expect(summary).toMatchObject({ apiRequestId: 'api-req-9', analysisId: 'an-1', generationCallCount: 1 });
    expect(JSON.stringify(lines)).not.toMatch(/<filing_excerpts>|SOURCE_ID:/);
  });
});

describe('one failed summary line for every path that marks an analysis FAILED (architecture §12)', () => {
  const T0 = new Date('2026-10-02T12:00:00Z');
  const ctx = { requestId: 'msg-1', remainingTimeMs: () => 175_000 };
  const BODY = JSON.stringify({ workspaceId: 'ws-test', analysisId: 'an-1', apiRequestId: 'api-req-9' });

  async function worker(over: Partial<WorkerDeps> = {}) {
    const store = new MemoryAnalysisStore();
    await store.createQueued({ workspaceId: 'ws-test', analysisId: 'an-1', question: QUESTION, origin: { kind: 'direct' }, now: T0 });
    const deps: WorkerDeps = {
      store,
      killSwitch: { read: async () => ({ enabled: true, source: 'parameter' }), analysesEnabled: async () => true },
      index: { loaded: () => true, get: async () => ({ index: { retriever: fixtureRetriever(), indexVersion: 'iv-fixture' }, loadMs: 0, cold: false }) },
      createEmbedder: () => null,
      generationClient: new FakeGenerationClient({ toolInput: briefCiting([]) }),
      now: () => T0,
      newToken: () => 'token-1',
      ...over,
    };
    return { store, deps };
  }
  const failedLines = (lines: Array<Record<string, unknown>>) => lines.filter((l) => l.event === 'analysis_summary' && l.status === 'failed');

  it('kill switch off: ANALYSES_DISABLED, no call, zero cost', async () => {
    const { deps } = await worker({ killSwitch: { read: async () => ({ enabled: false, source: 'parameter' }), analysesEnabled: async () => false } });
    const lines = captureLogs();
    expect(await processAnalysisMessage(deps, BODY, ctx)).toBe('disabled');
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'ANALYSES_DISABLED', analysisId: 'an-1', apiRequestId: 'api-req-9', generationCallCount: 0, estimatedCostUsd: 0 })]);
  });

  it('kill switch unreadable: WORKER_FAILED, no call', async () => {
    const { deps } = await worker({ killSwitch: { read: async () => ({ enabled: false, source: 'read_failed' }), analysesEnabled: async () => false } });
    const lines = captureLogs();
    expect(await processAnalysisMessage(deps, BODY, ctx)).toBe('switch_unreadable');
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'WORKER_FAILED', detail: 'kill_switch_unreadable', generationCallCount: 0 })]);
  });

  it('index load fails: INDEX_UNAVAILABLE, no call', async () => {
    const { deps } = await worker({ index: { loaded: () => false, get: async () => Promise.reject(new Error('S3 down')) } });
    const lines = captureLogs();
    expect(await processAnalysisMessage(deps, BODY, ctx)).toBe('failed');
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'INDEX_UNAVAILABLE', generationCallCount: 0, estimatedCostUsd: 0 })]);
  });

  it('an unexpected error after the call: WORKER_FAILED with the request counted and the cost marked incomplete', async () => {
    const { store, deps } = await worker();
    store.complete = async () => Promise.reject(new Error('DynamoDB unavailable'));
    const lines = captureLogs();
    expect(await processAnalysisMessage(deps, BODY, ctx)).toBe('failed');
    const [line, ...rest] = failedLines(lines);
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ code: 'WORKER_FAILED', detail: 'unexpected_error', generationCallCount: 1, costIncomplete: true });
    expect(line).not.toHaveProperty('estimatedCostUsd');
  });

  it('a lost claim writes no failed line (the analysis was not marked FAILED here)', async () => {
    const { store, deps } = await worker({ index: { loaded: () => false, get: async () => Promise.reject(new Error('S3 down')) } });
    store.fail = async () => false;
    const lines = captureLogs();
    await processAnalysisMessage(deps, BODY, ctx);
    expect(failedLines(lines)).toEqual([]);
  });

  it('the dlq-handler: one WORKER_FAILED line per analysis it marks, none for one already finished', async () => {
    const { store } = await worker();
    await store.createQueued({ workspaceId: 'ws-test', analysisId: 'an-2', question: QUESTION, origin: { kind: 'direct' }, now: T0 });
    await store.failQueued('ws-test', 'an-2', { code: 'QUEUE_TIMEOUT', message: 'late', requestId: 'r' }, T0);
    const lines = captureLogs();
    const record = (analysisId: string, messageId: string) => ({ messageId, body: JSON.stringify({ workspaceId: 'ws-test', analysisId }) }) as SQSRecord;
    await handleDeadLetters(store, { Records: [record('an-1', 'm-1'), record('an-2', 'm-2')] }, () => T0);
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'WORKER_FAILED', detail: 'dead_lettered', analysisId: 'an-1', requestId: 'm-1' })]);
  });

  it('the poll: QUEUE_TIMEOUT once, from the poll that expired it', async () => {
    const now = { t: T0 };
    const { app } = testApp({ now: () => now.t });
    const { cookie } = await newSession(app);
    const id = (JSON.parse((await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }))).body) as { analysisId: string }).analysisId;
    now.t = new Date(T0.getTime() + 241_000);
    const lines = captureLogs();
    await app(authed(cookie, 'GET', `/api/analyses/${id}`));
    await app(authed(cookie, 'GET', `/api/analyses/${id}`));
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'QUEUE_TIMEOUT', analysisId: id, generationCallCount: 0 })]);
  });

  it('the api: ENQUEUE_FAILED when the queue send fails', async () => {
    const { app } = testApp({ queueFails: true });
    const { cookie } = await newSession(app);
    const lines = captureLogs();
    await app(authed(cookie, 'POST', '/api/analyses', { body: { question: QUESTION } }));
    expect(failedLines(lines)).toEqual([expect.objectContaining({ code: 'ENQUEUE_FAILED', generationCallCount: 0 })]);
  });
});

describe('the queue message: apiRequestId never makes a message invalid (M5)', () => {
  it('a malformed or unexpected apiRequestId is dropped and the analysis still runs', async () => {
    for (const apiRequestId of ['has spaces', 42, 'x'.repeat(300), null]) {
      expect(AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', apiRequestId })).toEqual({ workspaceId: 'ws', analysisId: 'an' });
    }
    const store = new MemoryAnalysisStore();
    const T0 = new Date('2026-10-02T12:00:00Z');
    await store.createQueued({ workspaceId: 'ws-test', analysisId: 'an-1', question: QUESTION, origin: { kind: 'direct' }, now: T0 });
    const deps: WorkerDeps = {
      store,
      killSwitch: { read: async () => ({ enabled: true, source: 'parameter' }), analysesEnabled: async () => true },
      index: { loaded: () => true, get: async () => ({ index: { retriever: fixtureRetriever(), indexVersion: 'iv-fixture' }, loadMs: 0, cold: false }) },
      createEmbedder: () => null,
      generationClient: new FakeGenerationClient({ toolInput: briefCiting([]) }),
      now: () => T0,
      newToken: () => 'token-1',
    };
    const lines = captureLogs();
    expect(await processAnalysisMessage(deps, JSON.stringify({ workspaceId: 'ws-test', analysisId: 'an-1', apiRequestId: 'has spaces' }), { requestId: 'msg-1', remainingTimeMs: () => 175_000 })).not.toBe('invalid');
    expect(lines.find((l) => l.event === 'analysis_summary')).not.toHaveProperty('apiRequestId');
  });

  it('an unknown key still makes the message invalid', () => {
    expect(() => AnalysisMessageSchema.parse({ workspaceId: 'ws', analysisId: 'an', extra: 1 })).toThrow();
  });
});

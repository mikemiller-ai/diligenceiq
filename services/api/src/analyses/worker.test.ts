import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { FakeGenerationClient, type Script, briefCiting, fixtureRetriever } from '@diligenceiq/rag/testing';
import type * as Rag from '@diligenceiq/rag';
import type { SQSEvent } from 'aws-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDeadLetters, requireTableName } from '../dlq-handler';
import { ANALYSIS_DEADLINE_MS, ClaimLostError, DynamoAnalysisStore, MemoryAnalysisStore } from './store';
import { type IndexProvider, type WorkerDeps, processAnalysisMessage } from './worker';

/** Purpose guard (SPEC §30.2): every gateway the worker builds, on every path, is recorded here. */
const constructed = vi.hoisted(() => [] as string[]);
vi.mock('@diligenceiq/rag', async (importOriginal) => {
  const mod = await importOriginal<typeof Rag>();
  class SpiedGateway extends mod.GenerationGateway {
    constructor(options: ConstructorParameters<typeof mod.GenerationGateway>[0]) {
      super(options);
      constructed.push(options.purpose);
    }
  }
  return { ...mod, GenerationGateway: SpiedGateway };
});

const WS = 'ws-test';
const T0 = new Date('2026-10-02T12:00:00.000Z');

function setup(script: Script | ((req: unknown) => Script), over: Partial<WorkerDeps> & { enabled?: boolean; switchUnreadable?: boolean; indexFails?: boolean } = {}) {
  const store = new MemoryAnalysisStore();
  const client = new FakeGenerationClient(script as Script);
  let clock = T0.getTime();
  const retriever = fixtureRetriever();
  let loaded = false;
  const index: IndexProvider = {
    loaded: () => loaded,
    get: async () => {
      if (over.indexFails) throw new Error('S3 AccessDenied');
      const cold = !loaded;
      loaded = true;
      return { index: { retriever, indexVersion: 'iv-fixture' }, loadMs: cold ? 1234 : 0, cold };
    },
  };
  const deps: WorkerDeps = {
    store,
    killSwitch: {
      read: async () => (over.switchUnreadable ? { enabled: false, source: 'read_failed' } : { enabled: over.enabled ?? true, source: 'parameter' }),
      analysesEnabled: async () => !over.switchUnreadable && (over.enabled ?? true),
    },
    index,
    createEmbedder: () => null,
    generationClient: client,
    now: () => new Date(clock),
    newToken: (() => {
      let n = 0;
      return () => `token-${++n}`;
    })(),
    ...over,
  };
  const ctx = { requestId: 'msg-1', remainingTimeMs: () => 175_000 };
  const queue = async (analysisId = 'an-1', question = 'What supply chain and production risks do Apple and Tesla describe?') =>
    store.createQueued({ workspaceId: WS, analysisId, question, origin: { kind: 'direct' }, now: new Date(clock) });
  const body = (analysisId = 'an-1') => JSON.stringify({ workspaceId: WS, analysisId });
  return { store, client, deps, ctx, queue, body, advance: (ms: number) => (clock += ms), record: (id = 'an-1') => store.records.get(`${WS}/${id}`)! };
}

const okBrief: Script = { toolInput: briefCiting([]) };
/** Cites the first SOURCE_ID the model was given. */
const citingFirst = (req: unknown): Script => ({ toolInput: briefCiting([/SOURCE_ID: (\S+)/.exec((req as { user: string }).user)![1]!]) });

beforeEach(() => {
  constructed.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  // Every gateway on every path is an analysis gateway.
  expect(constructed.every((p) => p === 'analysis')).toBe(true);
});

describe('worker: one generation call on every path (SPEC §30; testing-strategy §4)', () => {
  it('success: COMPLETE, generationStartedAt persisted BEFORE the call, context snapshot stored', async () => {
    let atCall: { generationStartedAt?: string; generationCallCount: number } | undefined;
    const s = setup((req) => {
      atCall = { ...s.record() };
      return citingFirst(req);
    });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('complete');
    expect(s.client.invocations).toBe(1);
    expect(atCall).toMatchObject({ generationCallCount: 1, generationStartedAt: T0.toISOString() });
    const r = s.record();
    expect(r).toMatchObject({ status: 'COMPLETE', stage: 'complete', generationCallCount: 1 });
    expect(r.telemetry).toMatchObject({ generationCallCount: 1, coldStart: true, indexLoadMs: 1234 });
    expect(r.citations).toHaveLength(1);
    expect(s.store.contexts.get(`${WS}/an-1`)?.passages.length).toBeGreaterThan(0);
    expect(s.store.writes).toEqual([
      'claim an-1',
      'stage loading_index',
      'stage analyzing',
      'stage retrieving',
      'stage balancing',
      'stage context',
      'stage generating',
      'generationStarted',
      'stage validating',
      'complete',
      'context',
    ]);
    expect(constructed).toEqual(['analysis']);
  });

  it('a warm container skips the load stage', async () => {
    const s = setup(okBrief);
    await s.queue('an-1');
    await s.queue('an-2');
    await processAnalysisMessage(s.deps, s.body('an-1'), s.ctx);
    s.store.writes.length = 0;
    await processAnalysisMessage(s.deps, s.body('an-2'), s.ctx);
    expect(s.store.writes).not.toContain('stage loading_index');
    expect(s.record('an-2').telemetry).toMatchObject({ coldStart: false, indexLoadMs: 0 });
  });

  it('Bedrock error: FAILED GENERATION_FAILED, count 1, no retry', async () => {
    const s = setup({ error: Object.assign(new Error('throttled'), { name: 'ThrottlingException' }) });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('failed');
    expect(s.client.invocations).toBe(1);
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 1, error: { code: 'GENERATION_FAILED', requestId: 'msg-1' }, telemetry: { generationCallCount: 1 } });
  });

  it('malformed output: FAILED MALFORMED_OUTPUT, count 1', async () => {
    const s = setup({ toolInput: '{"title": "cut', stopReason: 'max_tokens' });
    await s.queue();
    await processAnalysisMessage(s.deps, s.body(), s.ctx);
    expect(s.client.invocations).toBe(1);
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 1, error: { code: 'MALFORMED_OUTPUT' } });
  });

  it('duplicate delivery, concurrently: one generation; the other is acknowledged without work', async () => {
    const s = setup(okBrief);
    await s.queue();
    const outcomes = await Promise.all([processAnalysisMessage(s.deps, s.body(), s.ctx), processAnalysisMessage(s.deps, s.body(), { ...s.ctx, requestId: 'msg-dup' })]);
    expect(outcomes.sort()).toEqual(['complete', 'not_claimable']);
    expect(s.client.invocations).toBe(1);
    expect(constructed).toHaveLength(1);
  });

  it('redelivery after a claim (worker crashed before generation): no second generation; the poll fails it PIPELINE_TIMEOUT', async () => {
    const s = setup(okBrief);
    await s.queue();
    await s.store.claim(WS, 'an-1', 'crashed-worker', T0);
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('not_claimable');
    expect(s.client.invocations).toBe(0);
    s.advance(ANALYSIS_DEADLINE_MS + 1);
    expect(await s.store.expireIfPastDeadline(WS, 'an-1', new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll-1')).toBe('PIPELINE_TIMEOUT');
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0 });
  });

  it('redelivery after a crash mid-generation: no second generation; the poll fails it GENERATION_TIMEOUT with count 1', async () => {
    const s = setup(okBrief);
    await s.queue();
    await s.store.claim(WS, 'an-1', 'crashed-worker', T0);
    await s.store.markGenerationStarted(WS, 'an-1', 'crashed-worker', T0);
    s.advance(1_080_000); // the visibility timeout: redelivery always arrives after the deadline
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('not_claimable');
    expect(s.client.invocations).toBe(0);
    expect(await s.store.expireIfPastDeadline(WS, 'an-1', new Date(T0.getTime() + 1_080_000), 'poll-1')).toBe('GENERATION_TIMEOUT');
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 1, error: { code: 'GENERATION_TIMEOUT' } });
  });

  it('a message that waited past the deadline is not claimed; the poll fails it QUEUE_TIMEOUT', async () => {
    const s = setup(okBrief);
    await s.queue();
    s.advance(ANALYSIS_DEADLINE_MS + 1);
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('not_claimable');
    expect(s.client.invocations).toBe(0);
    expect(await s.store.expireIfPastDeadline(WS, 'an-1', new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll')).toBe('QUEUE_TIMEOUT');
  });

  it('kill switch off while queued: FAILED ANALYSES_DISABLED, no claim, no gateway', async () => {
    const s = setup(okBrief, { enabled: false });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('disabled');
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'ANALYSES_DISABLED' } });
    expect(s.client.invocations).toBe(0);
    expect(constructed).toHaveLength(0);
  });

  it('kill switch unreadable (SSM error): FAILED WORKER_FAILED "could not be started", not "paused"; no claim, no gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = setup(okBrief, { switchUnreadable: true });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('switch_unreadable');
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'WORKER_FAILED', message: 'The analysis could not be started. Run it again.', requestId: 'msg-1' } });
    expect(s.store.writes).toEqual(['fail WORKER_FAILED']);
    expect(s.client.invocations).toBe(0);
    expect(constructed).toHaveLength(0);
  });

  it('index load failure: FAILED INDEX_UNAVAILABLE, count 0', async () => {
    const s = setup(okBrief, { indexFails: true });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('failed');
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'INDEX_UNAVAILABLE' } });
    expect(s.client.invocations).toBe(0);
  });

  it('no relevant evidence: FAILED NO_RELEVANT_EVIDENCE, count 0', async () => {
    const s = setup(okBrief, { index: { loaded: () => true, get: async () => ({ index: { retriever: fixtureRetriever([]), indexVersion: 'v' }, loadMs: 0, cold: false }) } });
    await s.queue();
    await processAnalysisMessage(s.deps, s.body(), s.ctx);
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'NO_RELEVANT_EVIDENCE' } });
    expect(s.client.invocations).toBe(0);
  });

  it('too little Lambda time left for the generation budget: PIPELINE_TIMEOUT before any call', async () => {
    const s = setup(okBrief);
    await s.queue();
    await processAnalysisMessage(s.deps, s.body(), { ...s.ctx, remainingTimeMs: () => 60_000 });
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'PIPELINE_TIMEOUT' } });
    expect(s.client.invocations).toBe(0);
  });

  it('claim lost mid-retrieval (a poll expired it): no generation, nothing overwritten', async () => {
    const s = setup(okBrief);
    await s.queue();
    const setStage = s.store.setStage.bind(s.store);
    s.store.setStage = async (w, a, t, stage) => {
      if (stage === 'balancing') await s.store.expireIfPastDeadline(w, a, new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll');
      return setStage(w, a, t, stage);
    };
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('claim_lost');
    expect(s.client.invocations).toBe(0);
    expect(s.record()).toMatchObject({ status: 'FAILED', error: { code: 'PIPELINE_TIMEOUT' }, generationCallCount: 0 });
  });

  it('claim lost during generation: the result is discarded, the record keeps its timeout', async () => {
    const s = setup((req) => {
      void s.store.expireIfPastDeadline(WS, 'an-1', new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll');
      return citingFirst(req);
    });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('claim_lost');
    expect(s.client.invocations).toBe(1);
    expect(s.record()).toMatchObject({ status: 'FAILED', error: { code: 'GENERATION_TIMEOUT' }, generationCallCount: 1 });
    expect(s.record().brief).toBeUndefined();
  });

  it('generation start write fails (not a lost claim): FAILED WORKER_FAILED, the model is never called', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = setup(okBrief);
    await s.queue();
    s.store.markGenerationStarted = async () => Promise.reject(Object.assign(new Error('Rate exceeded'), { name: 'ProvisionedThroughputExceededException' }));
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('failed');
    expect(s.client.invocations).toBe(0);
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 0, error: { code: 'WORKER_FAILED' }, telemetry: { generationCallCount: 0 } });
  });

  it('generation start write landed but its response was lost: FAILED WORKER_FAILED; the record keeps the start mark, telemetry says no call', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = setup(okBrief);
    await s.queue();
    const mark = s.store.markGenerationStarted.bind(s.store);
    s.store.markGenerationStarted = async (w, a, t, n) => {
      await mark(w, a, t, n);
      throw Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
    };
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('failed');
    expect(s.client.invocations).toBe(0);
    expect(s.record()).toMatchObject({ status: 'FAILED', generationCallCount: 1, generationStartedAt: T0.toISOString(), error: { code: 'WORKER_FAILED' }, telemetry: { generationCallCount: 0 } });
  });

  it('claim lost at the generation start write (ClaimLostError): claim_lost, nothing written, no call', async () => {
    const s = setup(okBrief);
    await s.queue();
    s.store.markGenerationStarted = async (w, a) => {
      await s.store.expireIfPastDeadline(w, a, new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll');
      throw new ClaimLostError('generation start');
    };
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('claim_lost');
    expect(s.client.invocations).toBe(0);
    expect(s.record()).toMatchObject({ status: 'FAILED', error: { code: 'PIPELINE_TIMEOUT' }, generationCallCount: 0 });
  });

  it('claim lost before complete: no orphan context snapshot', async () => {
    const s = setup((req) => {
      void s.store.expireIfPastDeadline(WS, 'an-1', new Date(T0.getTime() + ANALYSIS_DEADLINE_MS + 1), 'poll');
      return citingFirst(req);
    });
    await s.queue();
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('claim_lost');
    expect(s.store.contexts.size).toBe(0);
  });

  it('a context snapshot write failure is retried once and never fails a COMPLETE analysis', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const s = setup(citingFirst);
    await s.queue();
    let attempts = 0;
    s.store.putContext = async () => {
      attempts++;
      throw new Error('DynamoDB unavailable');
    };
    expect(await processAnalysisMessage(s.deps, s.body(), s.ctx)).toBe('complete');
    expect(attempts).toBe(2);
    expect(s.record()).toMatchObject({ status: 'COMPLETE', generationCallCount: 1 });
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])));
    expect(lines.some((l) => l.event === 'context_snapshot_missing')).toBe(true);
    expect(lines.find((l) => l.event === 'analysis_summary')).toMatchObject({ status: 'complete', contextStored: false });

    const s2 = setup(citingFirst);
    await s2.queue();
    let first = true;
    const put = s2.store.putContext.bind(s2.store);
    s2.store.putContext = async (w, a, snap) => {
      if (first) {
        first = false;
        throw new Error('throttled');
      }
      return put(w, a, snap);
    };
    expect(await processAnalysisMessage(s2.deps, s2.body(), s2.ctx)).toBe('complete');
    expect(s2.store.contexts.get(`${WS}/an-1`)?.passages.length).toBeGreaterThan(0);
  });

  it('an invalid message is acknowledged without work', async () => {
    const s = setup(okBrief);
    expect(await processAnalysisMessage(s.deps, 'not json', s.ctx)).toBe('invalid');
    expect(await processAnalysisMessage(s.deps, JSON.stringify({ workspaceId: 'a b', analysisId: 'x' }), s.ctx)).toBe('invalid');
    expect(s.client.invocations).toBe(0);
  });

  it('a store failure before the claim throws, so SQS redelivers (bounded by maxReceiveCount → DLQ)', async () => {
    const s = setup(okBrief);
    s.store.claim = async () => Promise.reject(new Error('DynamoDB unavailable'));
    await expect(processAnalysisMessage(s.deps, s.body(), s.ctx)).rejects.toThrow('DynamoDB unavailable');
    expect(s.client.invocations).toBe(0);
  });
});

describe('DLQ handler (DD-14)', () => {
  const event = (bodies: string[]) => ({ Records: bodies.map((body, i) => ({ body, messageId: `m${i}` })) }) as unknown as SQSEvent;

  it('marks QUEUED or RUNNING analyses WORKER_FAILED and leaves finished ones alone', async () => {
    const store = new MemoryAnalysisStore();
    for (const id of ['q', 'r', 'c']) await store.createQueued({ workspaceId: WS, analysisId: id, question: 'x', origin: { kind: 'direct' }, now: T0 });
    await store.claim(WS, 'r', 't', T0);
    await store.claim(WS, 'c', 't2', T0);
    await store.fail(WS, 'c', 't2', { code: 'GENERATION_FAILED', message: 'x', requestId: 'r' }, T0);
    await handleDeadLetters(store, event(['q', 'r', 'c'].map((analysisId) => JSON.stringify({ workspaceId: WS, analysisId })).concat(['garbage'])), () => T0);
    expect(store.records.get(`${WS}/q`)?.error?.code).toBe('WORKER_FAILED');
    expect(store.records.get(`${WS}/r`)?.error?.code).toBe('WORKER_FAILED');
    expect(store.records.get(`${WS}/c`)?.error?.code).toBe('GENERATION_FAILED');
  });

  it('fails fast with a clear error when TABLE_NAME is not set', () => {
    expect(() => requireTableName({})).toThrow('dlq-handler: TABLE_NAME is not set');
    expect(() => requireTableName({ TABLE_NAME: '  ' })).toThrow('TABLE_NAME is not set');
    expect(requireTableName({ TABLE_NAME: 'diligenceiq' })).toBe('diligenceiq');
  });
});

describe('DynamoAnalysisStore condition expressions (architecture §4.3)', () => {
  function fakeDoc(fail = false) {
    const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
    return {
      sent,
      send: vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        if (fail) throw new ConditionalCheckFailedException({ message: 'no', $metadata: {} });
        return { Attributes: { PK: 'x', SK: 'y', status: 'RUNNING' } };
      }),
    };
  }

  it('claim: QUEUED and before the deadline, fresh token', async () => {
    const doc = fakeDoc();
    const r = await new DynamoAnalysisStore(doc, 't').claim(WS, 'a1', 'tok', T0);
    expect(r).toEqual({ status: 'RUNNING' });
    const input = doc.sent[0]!.input;
    expect(input.Key).toEqual({ PK: `WS#${WS}`, SK: 'ANALYSIS#a1' });
    expect(input.ConditionExpression).toBe('#status = :queued AND deadlineAt > :now');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':token': 'tok', ':now': T0.toISOString(), ':queued': 'QUEUED' });
    expect(await new DynamoAnalysisStore(fakeDoc(true), 't').claim(WS, 'a1', 'tok', T0)).toBeNull();
  });

  it('generation start: my claim, not started before, count set to 1; a failed condition throws ClaimLostError', async () => {
    const doc = fakeDoc();
    await new DynamoAnalysisStore(doc, 't').markGenerationStarted(WS, 'a1', 'tok', T0);
    const input = doc.sent[0]!.input;
    expect(input.ConditionExpression).toBe('#status = :running AND claimToken = :token AND attribute_not_exists(generationStartedAt)');
    expect(input.UpdateExpression).toContain('generationCallCount = :one');
    expect(input.ExpressionAttributeValues).toMatchObject({ ':one': 1 });
    await expect(new DynamoAnalysisStore(fakeDoc(true), 't').markGenerationStarted(WS, 'a1', 'tok', T0)).rejects.toMatchObject({ name: 'ClaimLostError' });
  });

  it('complete and fail: only while RUNNING with my token; false when the claim is lost', async () => {
    const doc = fakeDoc();
    const store = new DynamoAnalysisStore(doc, 't');
    await store.fail(WS, 'a1', 'tok', { code: 'GENERATION_FAILED', message: 'm', requestId: 'r' }, T0);
    expect(doc.sent[0]!.input.ConditionExpression).toBe('#status = :running AND claimToken = :token');
    expect(await new DynamoAnalysisStore(fakeDoc(true), 't').fail(WS, 'a1', 'tok', { code: 'GENERATION_FAILED', message: 'm', requestId: 'r' }, T0)).toBe(false);
  });

  it('poll expiry tries QUEUE_TIMEOUT, then GENERATION_TIMEOUT, then PIPELINE_TIMEOUT, each conditional on the deadline', async () => {
    const doc = fakeDoc(true);
    expect(await new DynamoAnalysisStore(doc, 't').expireIfPastDeadline(WS, 'a1', T0, 'r')).toBeNull();
    expect(doc.sent.map((c) => c.input.ConditionExpression)).toEqual([
      '#status = :queued AND deadlineAt < :now',
      '#status = :running AND deadlineAt < :now AND attribute_exists(generationStartedAt)',
      '#status = :running AND deadlineAt < :now AND attribute_not_exists(generationStartedAt)',
    ]);
  });

  it('a non-condition error propagates', async () => {
    const doc = { send: vi.fn(async () => Promise.reject(new Error('ProvisionedThroughputExceeded'))) };
    await expect(new DynamoAnalysisStore(doc, 't').fail(WS, 'a', 't', { code: 'GENERATION_FAILED', message: 'm', requestId: 'r' }, T0)).rejects.toThrow('ProvisionedThroughputExceeded');
  });
});

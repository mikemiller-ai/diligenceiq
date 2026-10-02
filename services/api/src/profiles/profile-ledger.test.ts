import type { GenerationClient } from '@diligenceiq/rag';
import { PROFILE_PROMPT_VERSION, assembleDeterministicProfile, buildProfileSets, deterministicSetId } from '@diligenceiq/rag/profile';
import { describe, expect, it } from 'vitest';
import { SYN_FS, SYN_IV, SYN_MDA, SYN_RISK, synChunks, synExtraction } from '../../../../packages/rag/src/profile/testing';
import { S3Ledger } from '../../../../scripts/lib/profile-ledger';

/* The S3 build ledger (scripts/lib/profile-ledger.ts; SPEC §32.4, DD-16): conditional creates only, never an overwrite. */
type Cmd = { constructor: { name: string }; input: Record<string, unknown> };

/** A fake S3 that honours If-None-Match: * like the real one. */
function fakeS3() {
  const objects = new Map<string, string>();
  const calls: Cmd[] = [];
  const send = async (cmd: Cmd) => {
    calls.push(cmd);
    const { Key, Prefix, Body, IfNoneMatch } = cmd.input as { Key?: string; Prefix?: string; Body?: string; IfNoneMatch?: string };
    switch (cmd.constructor.name) {
      case 'PutObjectCommand':
        if (IfNoneMatch !== '*') throw new Error('ledger writes must be conditional');
        if (objects.has(Key!)) throw Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
        objects.set(Key!, Body!);
        return {};
      case 'GetObjectCommand':
        if (!objects.has(Key!)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
        return { Body: { transformToByteArray: async () => new TextEncoder().encode(objects.get(Key!)!) } };
      case 'ListObjectsV2Command':
        return { Contents: [...objects.keys()].filter((k) => k.startsWith(Prefix!)).map((k) => ({ Key: k })), IsTruncated: false };
      default:
        throw new Error(`unexpected ${cmd.constructor.name}`);
    }
  };
  return { s3: { send } as never, objects, calls };
}

const entry = (ticker: string, runId = 'r1') => ({ ticker, indexVersion: 'iv-x', profilePromptVersion: '1', startedAt: 't', runId });
const outcome = (ticker: string) => ({ ticker, runId: 'r1', finishedAt: 't', modelId: 'm', toolInput: { headline: 'h' }, stopReason: 'tool_use', inputTokens: 1, outputTokens: 1, durationMs: 1, error: null, suppliedIds: ['a'] });

describe('S3Ledger', () => {
  it('claims once per (indexVersion, profilePromptVersion, ticker): a second claim, from any process, is "exists"', async () => {
    const { s3, objects } = fakeS3();
    const a = new S3Ledger(s3, 'b', 'iv-x', '1');
    const b = new S3Ledger(s3, 'b', 'iv-x', '1');
    expect(await a.claim(entry('AAPL'))).toBe('claimed');
    expect(await b.claim(entry('AAPL', 'r2'))).toBe('exists');
    expect(JSON.parse(objects.get('intelligence/ledger/iv-x/1/AAPL.json')!).runId).toBe('r1');
  });

  it('lists spent tickers, ignoring outcome objects', async () => {
    const { s3 } = fakeS3();
    const l = new S3Ledger(s3, 'b', 'iv-x', '1');
    await l.claim(entry('AAPL'));
    await l.recordOutcome(outcome('AAPL'));
    await l.claim(entry('MSFT'));
    expect([...(await l.spent())].sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('a new prompt version is a new key', async () => {
    const { s3 } = fakeS3();
    await new S3Ledger(s3, 'b', 'iv-x', '1').claim(entry('AAPL'));
    const v2 = new S3Ledger(s3, 'b', 'iv-x', '2');
    expect(await v2.spent()).toEqual(new Set());
    expect(await v2.claim({ ...entry('AAPL'), profilePromptVersion: '2' })).toBe('claimed');
  });

  it('outcomes are immutable and readable; a missing one is null', async () => {
    const { s3 } = fakeS3();
    const l = new S3Ledger(s3, 'b', 'iv-x', '1');
    expect(await l.outcome('AAPL')).toBeNull();
    await l.recordOutcome(outcome('AAPL'));
    expect(await l.outcome('AAPL')).toMatchObject({ toolInput: { headline: 'h' } });
    await expect(l.recordOutcome(outcome('AAPL'))).rejects.toThrow(/already recorded/);
  });

  it('a 409 ConditionalRequestConflict (a concurrent conditional write) is "exists": no call', async () => {
    const send = async () => {
      throw Object.assign(new Error('conflict'), { name: 'ConditionalRequestConflict', $metadata: { httpStatusCode: 409 } });
    };
    expect(await new S3Ledger({ send } as never, 'b', 'iv-x', '1').claim(entry('AAPL'))).toBe('exists');
  });

  it('any other claim error propagates (the builder then makes no call)', async () => {
    const send = async () => {
      throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    };
    await expect(new S3Ledger({ send } as never, 'b', 'iv-x', '1').claim(entry('AAPL'))).rejects.toThrow('denied');
  });

  it('a ticker spent at an earlier prompt version is called once under the current version, and never again', async () => {
    const { s3, objects } = fakeS3();
    await new S3Ledger(s3, 'b', SYN_IV, '1').claim({ ...entry('SYN'), indexVersion: SYN_IV });
    const chunks = synChunks();
    const det = assembleDeterministicProfile({ extraction: synExtraction(), chunks, profileSetId: deterministicSetId(), builtAt: 'x' });
    const output = {
      headline: 'Synthetic Co grew revenue.',
      executiveView: det.executiveView.map((e) => ({ dimension: e.dimension, summary: `${e.dimension} in context.`, citationIds: [SYN_FS] })),
      signals: det.signals.map((s) => ({ signalId: s.signalId, headline: 'h', whatChanged: 'w', whyThisMatters: 'y', citationIds: [SYN_FS] })),
      drivers: [],
      managementOutlook: { summary: 'Management expects steady demand.', citationIds: [SYN_MDA] },
      recommendedDiligence: [{ question: 'Q?', why: 'W.', signalIds: [], citationIds: [SYN_RISK] }],
    };
    let requests = 0;
    const client: GenerationClient = {
      modelId: 'fake',
      generate: async () => {
        requests++;
        return { modelId: 'fake', toolInput: output, text: '', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1, durationMs: 1, firstTokenMs: null };
      },
    };
    const opts = (runId: string) => ({
      indexVersion: SYN_IV,
      builtAt: 't',
      runId,
      companies: [{ extraction: synExtraction(), chunks }],
      chunk: (id: string) => chunks.find((c) => c.chunkId === id),
      retriever: { retrieve: async () => ({ context: { chunkIds: [SYN_MDA] } }) } as never,
      llm: true,
      maxCalls: 5,
      ledger: new S3Ledger(s3, 'b', SYN_IV, PROFILE_PROMPT_VERSION),
      client,
      write: async () => {},
    });
    const r = await buildProfileSets(opts('r1'));
    expect(requests).toBe(1);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'llm', generationCallCount: 1 });
    expect(objects.has(`intelligence/ledger/${SYN_IV}/${PROFILE_PROMPT_VERSION}/SYN.outcome.json`)).toBe(true);
    await buildProfileSets(opts('r2'));
    expect(requests).toBe(1);
  });

  it('never deletes or overwrites', async () => {
    const { s3, calls } = fakeS3();
    const l = new S3Ledger(s3, 'b', 'iv-x', '1');
    await l.claim(entry('AAPL'));
    await l.claim(entry('AAPL'));
    await l.recordOutcome(outcome('AAPL'));
    expect(calls.map((c) => c.constructor.name).filter((n) => /Delete|Copy/.test(n))).toEqual([]);
    expect(calls.filter((c) => c.constructor.name === 'PutObjectCommand').every((c) => c.input.IfNoneMatch === '*')).toBe(true);
  });
});

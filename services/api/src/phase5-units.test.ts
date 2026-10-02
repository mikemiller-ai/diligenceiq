import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createProfileProvider, dirSetReader } from './profiles/provider';
import { clientKey, createSsmSessionSecret, encodeSessionValue, newWorkspaceId, readCookie, sessionSetCookie, verifySessionValue } from './session/session';
import { PROFILE_SET_ROOT, TEST_SECRET } from './test-helpers';
import { DynamoWorkspaceStore } from './workspace/store';

describe('session cookie (HMAC)', () => {
  it('round-trips a signed workspace ID and rejects tampering', () => {
    const id = newWorkspaceId();
    const value = encodeSessionValue(TEST_SECRET, id);
    expect(verifySessionValue(TEST_SECRET, value)).toBe(id);
    expect(verifySessionValue(`${TEST_SECRET}x`, value)).toBeNull();
    expect(verifySessionValue(TEST_SECRET, `${newWorkspaceId()}.${value.split('.')[1]}`)).toBeNull();
    expect(verifySessionValue(TEST_SECRET, `${id}.`)).toBeNull();
    expect(verifySessionValue(TEST_SECRET, 'garbage')).toBeNull();
    expect(verifySessionValue(TEST_SECRET, undefined)).toBeNull();
  });

  it('local cookies drop Secure and the __Host- prefix; production keeps both', () => {
    expect(sessionSetCookie('v', { secure: true })).toMatch(/^__Host-diq_ws=v; Path=\/; .*; Secure;/);
    expect(sessionSetCookie('v', { secure: false })).toMatch(/^diq_ws=v; /);
    expect(sessionSetCookie('v', { secure: false })).not.toContain('Secure');
  });

  it('the per-client key is a salted hash of the source IP: stable, secret-dependent, never the IP', () => {
    const k = clientKey(TEST_SECRET, '198.51.100.7');
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(clientKey(TEST_SECRET, '198.51.100.7')).toBe(k);
    expect(clientKey(TEST_SECRET, '198.51.100.8')).not.toBe(k);
    expect(clientKey(`${TEST_SECRET}x`, '198.51.100.7')).not.toBe(k);
    expect(k).not.toContain('198');
  });

  it('reads cookies from the v2 cookies array or a Cookie header', () => {
    expect(readCookie({ cookies: ['a=1', 'diq_ws=x.y'] }, 'diq_ws')).toBe('x.y');
    expect(readCookie({ headers: { cookie: 'a=1; diq_ws=x.y' } }, 'diq_ws')).toBe('x.y');
    expect(readCookie({ cookies: ['xdiq_ws=1'] }, 'diq_ws')).toBeUndefined();
    expect(readCookie({ cookies: ['diq_ws=plain', '__Host-diq_ws=x.y'] }, '__Host-diq_ws')).toBe('x.y');
  });

  it('the SSM secret is read with decryption, cached, and refused when short or unreadable', async () => {
    const send = vi.fn(async () => ({ Parameter: { Value: TEST_SECRET } }));
    const secret = createSsmSessionSecret({ ssm: { send } as never, parameterName: '/diligenceiq/session-secret' });
    expect(await secret.get('r')).toBe(TEST_SECRET);
    await secret.get('r');
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [{ input: unknown }])[0].input).toEqual({ Name: '/diligenceiq/session-secret', WithDecryption: true });
    await expect(createSsmSessionSecret({ ssm: { send: async () => ({ Parameter: { Value: 'short' } }) } as never, parameterName: 'p' }).get('r')).rejects.toThrow(/too short/);
    await expect(createSsmSessionSecret({ ssm: { send: async () => { throw new Error('x'); } } as never, parameterName: 'p' }).get('r')).rejects.toThrow(/unreadable/);
    await expect(createSsmSessionSecret({ ssm: { send } as never, parameterName: undefined }).get('r')).rejects.toThrow(/not configured/);
  });
});

describe('profile provider (DD-16: read-only, pointer-selected)', () => {
  it('caches the pointer for 60 s and switches sets when it changes', async () => {
    let now = 0;
    let value: string | null = 'iv-9cf51c066743/fixture-v2';
    const pointer = vi.fn(async () => value);
    const p = createProfileProvider({ pointer, read: dirSetReader(PROFILE_SET_ROOT), now: () => now });
    expect((await p.active('r'))?.profileSetId).toBe('fixture-v2');
    value = 'none';
    expect((await p.active('r'))?.profileSetId).toBe('fixture-v2');
    now += 60_001;
    expect(await p.active('r')).toBeNull();
    expect(pointer).toHaveBeenCalledTimes(2);
  });

  it('a malformed pointer, a missing set, or a profile that fails validation reads as missing', async () => {
    expect(await createProfileProvider({ pointer: async () => '../../etc/passwd', read: dirSetReader(PROFILE_SET_ROOT) }).active('r')).toBeNull();
    expect(await createProfileProvider({ pointer: async () => 'iv-9cf51c066743/det-v9', read: dirSetReader(PROFILE_SET_ROOT) }).active('r')).toBeNull();
    const real = dirSetReader(PROFILE_SET_ROOT);
    const tampered = createProfileProvider({
      pointer: async () => 'iv-9cf51c066743/fixture-v2',
      read: async (key) => {
        const raw = await real(key);
        if (!raw || !key.endsWith('AAPL.json')) return raw;
        const p = JSON.parse(raw);
        p.currentRisks[0].citationIds = ['NOT-A-CITED-CHUNK'];
        return JSON.stringify(p);
      },
    });
    expect(await tampered.get('AAPL', 'r')).toBeNull();
    expect((await tampered.get('MSFT', 'r'))?.ticker).toBe('MSFT');
  });

  it('M8: a profile or manifest that is not JSON reads as missing (logged, cached), never a 500', async () => {
    const real = dirSetReader(PROFILE_SET_ROOT);
    const reads: string[] = [];
    const corrupt = createProfileProvider({
      pointer: async () => 'iv-9cf51c066743/fixture-v2',
      read: async (key) => {
        reads.push(key);
        return key.endsWith('AAPL.json') ? '{"ticker": "AAPL", trunc' : real(key);
      },
    });
    expect(await corrupt.get('AAPL', 'r')).toBeNull();
    expect(await corrupt.get('AAPL', 'r')).toBeNull();
    expect(reads.filter((k) => k.endsWith('AAPL.json'))).toHaveLength(1);
    expect((await corrupt.get('NVDA', 'r'))?.ticker).toBe('NVDA');

    const badManifest = createProfileProvider({ pointer: async () => 'iv-9cf51c066743/fixture-v2', read: async (key) => (key.endsWith('manifest.json') ? 'not json' : real(key)) });
    expect(await badManifest.active('r')).toBeNull();
    expect(await badManifest.get('AAPL', 'r')).toBeNull();
  });

  it('a pointer read error keeps serving the last good set', async () => {
    let now = 0;
    let fail = false;
    const p = createProfileProvider({ pointer: async () => { if (fail) throw new Error('ssm'); return 'iv-9cf51c066743/fixture-v2'; }, read: dirSetReader(PROFILE_SET_ROOT), now: () => now });
    await p.active('r');
    fail = true;
    now += 120_000;
    expect((await p.active('r'))?.profileSetId).toBe('fixture-v2');
  });
});

describe('DynamoWorkspaceStore commands', () => {
  it('counters are conditional on the cap; a condition failure reads as "at the cap"', async () => {
    const send = vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' }); });
    const store = new DynamoWorkspaceStore({ send } as never, 't');
    expect(await store.incrementCounter('GLOBAL', 'RATE#2026-10-02', 200, 1)).toBe(false);
    const input = (send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input;
    expect(input).toMatchObject({ ConditionExpression: 'attribute_not_exists(n) OR n < :cap', UpdateExpression: 'ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)', Key: { PK: 'GLOBAL', SK: 'RATE#2026-10-02' } });
  });

  it('META writes: extend is conditional on existence; reset rewrites it unconditionally; a finding edit moves its TTL', async () => {
    const send = vi.fn(async () => ({ Attributes: { PK: 'WS#w', SK: 'FINDING#f', ttl: 9, findingId: 'f' } }));
    const store = new DynamoWorkspaceStore({ send } as never, 't');
    await store.extendMeta('w', 123);
    await store.putMeta({ workspaceId: 'w', createdAt: 'x', seedVersion: null, ttl: 456 });
    expect(await store.updateFinding('w', 'f', { status: 'RESOLVED' }, 789)).toEqual({ findingId: 'f' });
    const [extend, put, update] = send.mock.calls.map((c) => (c as unknown as [{ input: Record<string, unknown> }])[0].input);
    expect(extend).toMatchObject({ Key: { PK: 'WS#w', SK: 'META' }, UpdateExpression: 'SET #ttl = :ttl', ConditionExpression: 'attribute_exists(PK)', ExpressionAttributeValues: { ':ttl': 123 } });
    expect(put).toMatchObject({ Item: { PK: 'WS#w', SK: 'META', ttl: 456 } });
    expect(put).not.toHaveProperty('ConditionExpression');
    expect(Object.values(update!.ExpressionAttributeNames as object)).toEqual(['status', 'ttl']);
    expect(Object.values(update!.ExpressionAttributeValues as object)).toEqual(['RESOLVED', 789]);
  });

  it('counts are Select COUNT queries, paginated', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Count: 300, LastEvaluatedKey: { PK: 'WS#w', SK: 'FINDING#x' } })
      .mockResolvedValueOnce({ Count: 12 });
    const store = new DynamoWorkspaceStore({ send } as never, 't');
    expect(await store.countFindings('w')).toBe(312);
    const inputs = send.mock.calls.map((c) => (c as unknown as [{ input: Record<string, unknown> }])[0].input);
    expect(inputs[0]).toMatchObject({ Select: 'COUNT', KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)', ExpressionAttributeValues: { ':pk': 'WS#w', ':prefix': 'FINDING#' } });
    expect(inputs[1]).toMatchObject({ ExclusiveStartKey: { PK: 'WS#w', SK: 'FINDING#x' } });
  });

  it('clearWorkspace deletes every item of the partition except META (rewritten in place) and the rate counters', async () => {
    const items = [{ PK: 'WS#w', SK: 'META' }, { PK: 'WS#w', SK: 'ANALYSIS#1' }, { PK: 'WS#w', SK: 'CONTEXT#1' }, { PK: 'WS#w', SK: 'FINDING#f' }, { PK: 'WS#w', SK: 'RATE#2026-10-02T12' }];
    const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => (cmd.constructor.name === 'QueryCommand' ? { Items: items } : {}));
    const store = new DynamoWorkspaceStore({ send } as never, 't');
    expect(await store.clearWorkspace('w')).toBe(3);
    const batch = send.mock.calls.map((c) => c[0]).find((c) => c.constructor.name === 'BatchWriteCommand')!;
    const deleted = (batch.input.RequestItems as Record<string, Array<{ DeleteRequest: { Key: { SK: string } } }>>).t!.map((r) => r.DeleteRequest.Key.SK);
    expect(deleted).toEqual(['ANALYSIS#1', 'CONTEXT#1', 'FINDING#f']);
  });
});

describe('no model client is reachable from the api handler (SPEC §33, §35.12)', () => {
  it('the bundled handler (esbuild, as CDK bundles it) contains no Bedrock client, no RAG package and not the worker', async () => {
    // A real bundle with a metafile, not a regex over import lines: re-exports, dynamic imports and
    // transitive dependencies all show up. The AWS SDK stays external (fast), but every import of it is listed.
    const { build } = await import('esbuild');
    const here = dirname(fileURLToPath(import.meta.url));
    const out = await build({ entryPoints: [join(here, 'handler.ts')], bundle: true, platform: 'node', format: 'esm', write: false, metafile: true, logLevel: 'silent', external: ['@aws-sdk/*'] });
    const inputs = Object.keys(out.metafile.inputs);
    const imported = Object.values(out.metafile.inputs).flatMap((i) => i.imports.map((x) => x.path));
    expect(inputs.some((p) => p.endsWith('handler.ts'))).toBe(true);
    expect(inputs.some((p) => p.includes('packages/core/'))).toBe(true); // sanity: workspace packages are followed
    expect([...inputs, ...imported].filter((p) => /client-bedrock|packages\/rag\/|@diligenceiq\/rag/.test(p))).toEqual([]);
    expect(inputs.filter((p) => /analyses\/worker\.ts$|worker-handler\.ts$/.test(p))).toEqual([]);
    // The evidence store imports the corpus chunker by subpath: the corpus loader (node:zlib) and
    // the financial extraction stay out of the api bundle (Phase 6 L8).
    expect(inputs.some((p) => p.includes('packages/corpus/src/chunker.ts'))).toBe(true);
    expect(inputs.filter((p) => /packages\/corpus\/src\/(?:load|index)\.ts$|packages\/corpus\/src\/financials\//.test(p))).toEqual([]);
    expect(imported.filter((p) => /zlib/.test(p))).toEqual([]);
  }, 30_000);
});

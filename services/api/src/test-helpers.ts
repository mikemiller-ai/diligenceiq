import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import seedJson from '../../../seed/demo-workspace.json';
import type { AnalysisQueue } from './analyses/queue';
import { MemoryAnalysisStore } from './analyses/store';
import { type AppCaps, type AppDeps, createApp } from './app';
import type { HttpResponse } from './http';
import { corpusEvidenceReader } from './evidence/local';
import { type EvidenceStore, createEvidenceStore } from './evidence/store';
import type { KillSwitch } from './kill-switch';
import { createProfileProvider, dirSetReader } from './profiles/provider';
import { SESSION_COOKIE_SECURE, staticSessionSecret } from './session/session';
import { parseSeed } from './workspace/seed';
import { MemoryWorkspaceStore } from './workspace/store';

export function makeEvent(
  method: string,
  path: string,
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'ANY /api/{proxy+}',
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.1', userAgent: 'vitest' },
      requestId: 'req-123',
      routeKey: 'ANY /api/{proxy+}',
      stage: '$default',
      time: '01/Oct/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    ...overrides,
  };
}

export const TEST_SECRET = 'test-session-secret-0123456789abcdef-0123456789';
export const PROFILE_SET_ROOT = fileURLToPath(new URL('../../../tests/fixtures/profile-sets/', import.meta.url));
export const FIXTURE_SET_POINTER = 'iv-9cf51c066743/fixture-v2';
export const SEED = parseSeed(seedJson);
export const TEST_INDEX_VERSION = 'iv-9cf51c066743';
export const EVIDENCE_ADJACENCY_ROOT = fileURLToPath(new URL(`../../../tests/fixtures/evidence/${TEST_INDEX_VERSION}/adjacency/`, import.meta.url));
/** The real build manifest of the test index, copied verbatim (`pnpm fixtures:evidence`). */
export const EVIDENCE_MANIFEST_PATH = fileURLToPath(new URL(`../../../tests/fixtures/evidence/${TEST_INDEX_VERSION}/manifest.json`, import.meta.url));
export const CORPUS_PATH = resolve(process.env.CORPUS_PATH ?? fileURLToPath(new URL('../../../edgar_corpus', import.meta.url)));
export const HAVE_CORPUS = existsSync(CORPUS_PATH);

/**
 * Evidence over the real corpus (processed on demand) and the committed adjacency subset; null
 * without the corpus. One store per process: processing a company's filings takes a moment.
 */
let evidenceSingleton: EvidenceStore | null | undefined;
export function corpusEvidence(): EvidenceStore | null {
  if (evidenceSingleton === undefined) {
    evidenceSingleton = HAVE_CORPUS
      ? createEvidenceStore({ indexVersion: TEST_INDEX_VERSION, read: corpusEvidenceReader({ corpusPath: CORPUS_PATH, indexVersion: TEST_INDEX_VERSION, adjacencyRoot: EVIDENCE_ADJACENCY_ROOT, manifestPath: EVIDENCE_MANIFEST_PATH }) })
      : null;
  }
  return evidenceSingleton;
}

/** The api with in-memory stores, the committed fixture profile set and the real seed. */
export function testApp(opts: { enabled?: boolean; caps?: AppCaps; seed?: boolean; pointer?: string | null; queueFails?: boolean; now?: () => Date; deps?: Partial<AppDeps> } = {}) {
  const analyses = new MemoryAnalysisStore();
  const workspace = new MemoryWorkspaceStore(analyses);
  const sent: Array<{ workspaceId: string; analysisId: string }> = [];
  const queue: AnalysisQueue = {
    async send(m) {
      if (opts.queueFails) throw Object.assign(new Error('boom'), { name: 'QueueDoesNotExist' });
      sent.push(m);
    },
  };
  const state = { enabled: opts.enabled ?? true };
  const killSwitch: KillSwitch = { analysesEnabled: async () => state.enabled };
  const pointer = opts.pointer === undefined ? FIXTURE_SET_POINTER : opts.pointer;
  const profiles = createProfileProvider({ pointer: async () => pointer, read: dirSetReader(PROFILE_SET_ROOT) });
  const app = createApp({
    killSwitch,
    sessionSecret: staticSessionSecret(TEST_SECRET),
    analyses,
    workspace,
    queue,
    profiles,
    seed: opts.seed === false ? null : SEED,
    indexVersion: TEST_INDEX_VERSION,
    indexAvailable: async () => true,
    evidence: null,
    ...(opts.caps ? { caps: opts.caps } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...opts.deps,
  });
  return { app, analyses, workspace, sent, state, profiles };
}

export const body = <T = Record<string, unknown>>(res: HttpResponse) => JSON.parse(res.body) as T;

/** Creates a session and returns the cookie pair to send back. */
export async function newSession(app: (e: APIGatewayProxyEventV2) => Promise<HttpResponse>): Promise<{ cookie: string; workspaceId: string }> {
  const res = await app(makeEvent('POST', '/api/session'));
  if (res.statusCode !== 200) throw new Error(`session ${res.statusCode} ${res.body}`);
  const set = (res.cookies ?? [])[0] ?? '';
  const cookie = set.split(';')[0] ?? '';
  if (!cookie.startsWith(`${SESSION_COOKIE_SECURE}=`)) throw new Error('no session cookie');
  return { cookie, workspaceId: body<{ workspaceId: string }>(res).workspaceId };
}

/** An authenticated request; a body is sent as JSON unless `contentType` says otherwise. */
export function authed(cookie: string, method: string, path: string, extra: { body?: unknown; query?: Record<string, string>; contentType?: string } = {}): APIGatewayProxyEventV2 {
  return makeEvent(method, path, {
    cookies: [cookie],
    ...(extra.body !== undefined ? { body: typeof extra.body === 'string' ? extra.body : JSON.stringify(extra.body), headers: { 'content-type': extra.contentType ?? 'application/json' } } : {}),
    ...(extra.query ? { queryStringParameters: extra.query } : {}),
  });
}

export const repoPath = (...p: string[]) => join(fileURLToPath(new URL('../../../', import.meta.url)), ...p);

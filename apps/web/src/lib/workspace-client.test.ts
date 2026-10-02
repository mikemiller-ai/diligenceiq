import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpWorkspaceClient } from './workspace-client';

/*
 * The production client against a mocked fetch (architecture §9): session recovery on 401,
 * 204 handling, and the codes it turns into "absent" rather than an error.
 */

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();
let handler: Handler;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req-h' } });
const apiError = (status: number, code: string) => json(status, { error: { code, message: code, requestId: `req-${code}` } });
const calls = () => fetchMock.mock.calls.map(([url, init]) => `${init.method ?? 'GET'} ${url}`);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url, init) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('httpWorkspaceClient', () => {
  it('401 SESSION_REQUIRED opens one new session and retries the request once', async () => {
    let analysesCalls = 0;
    handler = (url) => {
      if (url === '/api/session') return json(200, { workspaceId: 'w2', created: true, expiresAt: 'x' });
      analysesCalls++;
      return analysesCalls === 1 ? apiError(401, 'SESSION_REQUIRED') : json(200, { analysisId: 'a1', status: 'COMPLETE' });
    };
    const client = httpWorkspaceClient();
    expect(await client.getAnalysis('a1')).toMatchObject({ analysisId: 'a1' });
    expect(calls()).toEqual(['GET /api/analyses/a1', 'POST /api/session', 'GET /api/analyses/a1']);
  });

  it('concurrent 401s share one new session: one workspace is minted, not one per request (code-review)', async () => {
    let sessions = 0;
    const retried = new Set<string>();
    handler = (url) => {
      if (url === '/api/session') {
        sessions++;
        return json(200, { workspaceId: `w${sessions}`, created: true, expiresAt: 'x' });
      }
      const path = url.split('?')[0]!;
      if (!retried.has(path)) {
        retried.add(path);
        return apiError(401, 'SESSION_REQUIRED');
      }
      return json(200, path === '/api/companies' ? { indexVersion: null, profileSetId: null, companies: [] } : { items: [] });
    };
    const client = httpWorkspaceClient();
    await client.session();
    await Promise.all([client.listAnalyses(), client.listFindings(), client.companies()]);
    expect(sessions).toBe(2); // the initial session, then exactly one replacement
  });

  it('a retry that is also 401 fails with SESSION_REQUIRED: no loop', async () => {
    handler = (url) => (url === '/api/session' ? json(200, { workspaceId: 'w2', created: true, expiresAt: 'x' }) : apiError(401, 'SESSION_REQUIRED'));
    const client = httpWorkspaceClient();
    await expect(client.listFindings()).rejects.toMatchObject({ code: 'SESSION_REQUIRED', status: 401 });
    expect(calls()).toEqual(['GET /api/findings?limit=100', 'POST /api/session', 'GET /api/findings?limit=100']);
  });

  it('a failing session request is not cached: the next call tries again', async () => {
    let sessions = 0;
    handler = (url) => {
      if (url !== '/api/session') return json(200, {});
      sessions++;
      return sessions === 1 ? apiError(429, 'RATE_LIMITED') : json(200, { workspaceId: 'w', created: true, expiresAt: 'x' });
    };
    const client = httpWorkspaceClient();
    await expect(client.session()).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(client.session()).resolves.toMatchObject({ workspaceId: 'w' });
  });

  it('DELETE 204 resolves with no body; write bodies are sent as JSON', async () => {
    handler = (url, init) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, { findingId: 'f' }));
    const client = httpWorkspaceClient();
    await expect(client.deleteFinding('f')).resolves.toBeUndefined();
    await client.patchFinding('f', { status: 'RESOLVED' });
    const [, init] = fetchMock.mock.calls[1]!;
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'RESOLVED' });
  });

  it('PROFILE_MISSING reads as no profile, and a missing context snapshot (NOT_FOUND) as null; other errors still throw', async () => {
    handler = (url) => (url.endsWith('/intelligence') ? apiError(404, 'PROFILE_MISSING') : url.endsWith('/context') ? apiError(404, 'NOT_FOUND') : apiError(500, 'INTERNAL'));
    const client = httpWorkspaceClient();
    expect(await client.profile('KO')).toBeNull();
    expect(await client.getContext('a1')).toBeNull();
    await expect(client.companies()).rejects.toMatchObject({ code: 'INTERNAL', requestId: 'req-INTERNAL' });
  });

  it('evidence 404s are results: SOURCE_MISSING is not_found, details.reason is kept; other errors still throw', async () => {
    const withReason = (reason: string) => json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r', details: { reason } } });
    handler = (url) =>
      url.startsWith('/api/sources/AAPL_10K_2001-01-01')
        ? apiError(404, 'SOURCE_MISSING')
        : url.includes('iv=') || url.includes('indexVersion=iv-0')
          ? withReason('index_version')
          : url.startsWith('/api/sources/MSFT')
            ? withReason('index_unavailable')
            : url.startsWith('/api/evidence/adjacent')
              ? apiError(404, 'NOT_FOUND')
              : apiError(500, 'INTERNAL');
    const client = httpWorkspaceClient();
    expect(await client.source('AAPL_10K_2001-01-01')).toEqual({ unavailable: 'not_found' });
    expect(await client.source('AAPL_10K_2025-10-31', 'iv-000000000000')).toEqual({ unavailable: 'index_version' });
    expect(calls()).toContain('GET /api/sources/AAPL_10K_2025-10-31?indexVersion=iv-000000000000');
    expect(await client.source('MSFT_10K_2025-07-30')).toEqual({ unavailable: 'index_unavailable' });
    expect(await client.adjacent('AAPL-FY2025-10K-1A-001')).toEqual({ unavailable: 'not_found' });
    await expect(client.source('NVDA_10K_2026-02-25')).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

import { ApiErrorSchema } from '@diligenceiq/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, MAX_BODY_BYTES } from './app';
import type { HttpResponse } from './http';
import type { KillSwitch } from './kill-switch';
import { makeEvent } from './test-helpers';

function appWith(enabled: boolean | (() => Promise<boolean>) = false) {
  const analysesEnabled = vi.fn(typeof enabled === 'function' ? enabled : async () => enabled);
  const killSwitch: KillSwitch = { analysesEnabled };
  return { app: createApp({ killSwitch }), analysesEnabled };
}

const parse = (res: HttpResponse) => JSON.parse(res.body) as Record<string, unknown>;

function expectApiError(res: HttpResponse, status: number, code: string) {
  expect(res.statusCode).toBe(status);
  const body = ApiErrorSchema.parse(parse(res));
  expect(body.error.code).toBe(code);
  expect(body.error.requestId).toBe('req-123');
  expect(res.body).not.toMatch(/\bat .+:\d+:\d+/); // no stack frames
  return body;
}

function postAnalyses(body: string | undefined, extra: Parameters<typeof makeEvent>[2] = {}) {
  return makeEvent('POST', '/api/analyses', { ...(body === undefined ? {} : { body }), ...extra });
}

afterEach(() => vi.restoreAllMocks());

describe('common response shape', () => {
  it('sets JSON, no-store and the request id on success and error responses', async () => {
    const { app } = appWith();
    for (const event of [makeEvent('GET', '/api/health'), makeEvent('GET', '/api/nope')]) {
      const res = await app(event);
      expect(res.headers).toMatchObject({
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'x-request-id': 'req-123',
      });
    }
  });
});

describe('routing', () => {
  it('returns 404 NOT_FOUND for unknown paths', async () => {
    const { app } = appWith();
    expectApiError(await app(makeEvent('GET', '/api/does-not-exist')), 404, 'NOT_FOUND');
  });

  it('returns 404 for a known path with the wrong method', async () => {
    const { app } = appWith();
    expectApiError(await app(makeEvent('DELETE', '/api/health')), 404, 'NOT_FOUND');
    expectApiError(await app(makeEvent('GET', '/api/analyses')), 404, 'NOT_FOUND');
  });

  it('tolerates a trailing slash', async () => {
    const { app } = appWith();
    expect((await app(makeEvent('GET', '/api/health/'))).statusCode).toBe(200);
  });

  it('turns unexpected exceptions into 500 INTERNAL with a structured log and no stack', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { app } = appWith(async () => {
      throw new Error('kaboom');
    });
    const res = await app(makeEvent('GET', '/api/health'));
    const body = expectApiError(res, 500, 'INTERNAL');
    expect(body.error.message).not.toContain('kaboom');
    const line = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ level: 'error', requestId: 'req-123', route: 'GET /api/health' });
  });
});

describe('GET /api/health', () => {
  it.each([true, false])('reports analysesEnabled=%s from the kill switch', async (enabled) => {
    const { app, analysesEnabled } = appWith(enabled);
    const res = await app(makeEvent('GET', '/api/health'));
    expect(res.statusCode).toBe(200);
    // The full architecture §9 shape, including profileIndexVersion (regression, adversary finding 14).
    expect(parse(res)).toEqual({ status: 'ok', indexVersion: null, profileSetId: null, profileIndexVersion: null, analysesEnabled: enabled });
    expect(analysesEnabled).toHaveBeenCalledWith('req-123');
  });
});

describe('GET /api/diagnostics/cookie', () => {
  const SET_COOKIE = 'diq_probe=1; Path=/api; Max-Age=300; HttpOnly; Secure; SameSite=Lax';

  it('reports nothing received on the first call and sets the probe cookie', async () => {
    const { app } = appWith();
    const res = await app(makeEvent('GET', '/api/diagnostics/cookie'));
    expect(res.statusCode).toBe(200);
    expect(parse(res)).toEqual({ received: false, cookieHeaderPresent: false });
    expect(res.cookies).toEqual([SET_COOKIE]);
  });

  it('reports the probe cookie when the rewrite forwards it', async () => {
    const { app } = appWith();
    const res = await app(
      makeEvent('GET', '/api/diagnostics/cookie', { cookies: ['other=x', 'diq_probe=1'] }),
    );
    expect(parse(res)).toEqual({ received: true, cookieHeaderPresent: true });
    expect(res.cookies).toEqual([SET_COOKIE]);
  });

  it('distinguishes other cookies from the probe', async () => {
    const { app } = appWith();
    const res = await app(makeEvent('GET', '/api/diagnostics/cookie', { cookies: ['diq_probe=0'] }));
    expect(parse(res)).toEqual({ received: false, cookieHeaderPresent: true });
  });
});

describe('POST /api/analyses', () => {
  it('rejects invalid JSON with 400', async () => {
    const { app } = appWith(true);
    expectApiError(await app(postAnalyses('{"question":')), 400, 'VALIDATION_ERROR');
    expectApiError(await app(postAnalyses(undefined)), 400, 'VALIDATION_ERROR');
  });

  it('rejects bodies over 16 KB before parsing', async () => {
    const { app } = appWith(true);
    const big = JSON.stringify({ question: 'q', pad: 'x'.repeat(MAX_BODY_BYTES) });
    const body = expectApiError(await app(postAnalyses(big)), 400, 'VALIDATION_ERROR');
    expect(body.error.details).toEqual({ maxBytes: MAX_BODY_BYTES });
  });

  it('measures base64-encoded bodies after decoding', async () => {
    const { app } = appWith(true);
    const encoded = Buffer.from(JSON.stringify({ question: 'Revenue trend?' })).toString('base64');
    const res = await app(postAnalyses(encoded, { isBase64Encoded: true }));
    expectApiError(res, 503, 'ANALYSES_DISABLED');
  });

  it('summarizes Zod issues with paths', async () => {
    const { app } = appWith(true);
    const res = await app(
      postAnalyses(
        JSON.stringify({
          question: '',
          origin: { kind: 'signal', ticker: 'aapl', ref: 'x' },
          filters: { fiscalYearFrom: 2022, fiscalYearTo: 2020 },
        }),
      ),
    );
    const body = expectApiError(res, 400, 'VALIDATION_ERROR');
    const issues = body.error.details?.issues as Array<{ path: string; message: string }>;
    const paths = issues.map((i) => i.path);
    expect(paths).toContain('question');
    expect(paths.some((p) => p.startsWith('origin'))).toBe(true);
  });

  it('rejects unknown keys (strict schema)', async () => {
    const { app } = appWith(true);
    const res = await app(postAnalyses(JSON.stringify({ question: 'Hi', extra: 1 })));
    expectApiError(res, 400, 'VALIDATION_ERROR');
  });

  it('rejects a question over 1,000 characters', async () => {
    const { app } = appWith(true);
    const res = await app(postAnalyses(JSON.stringify({ question: 'q'.repeat(1001) })));
    expectApiError(res, 400, 'VALIDATION_ERROR');
  });

  it.each([true, false])(
    'answers 503 ANALYSES_DISABLED for a valid request even when the kill switch is %s',
    async (enabled) => {
      const { app } = appWith(enabled);
      const res = await app(
        postAnalyses(
          JSON.stringify({
            question: 'How did gross margin change?',
            origin: { kind: 'recommendation', ticker: 'AAPL', ref: 'rec-1' },
            filters: { tickers: ['AAPL'], filingTypes: ['10-K'] },
          }),
        ),
      );
      const body = expectApiError(res, 503, 'ANALYSES_DISABLED');
      expect(body.error.message).toBe('Analyses are not enabled in this build.');
    },
  );
});

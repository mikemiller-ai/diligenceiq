import { ApiErrorSchema } from '@diligenceiq/core';
import { describe, expect, it, vi } from 'vitest';
import { makeEvent, testApp } from './test-helpers';

const post = (body: unknown) => makeEvent('POST', '/api/retrieval/debug', { body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } });

describe('POST /api/retrieval/debug (SPEC §27.3)', () => {
  it('does not exist unless a retrieval dependency is wired (the deployed api never wires it)', async () => {
    const res = await testApp().app(post({ question: 'Apple risks' }));
    expect(res.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(JSON.parse(res.body)).error.code).toBe('NOT_FOUND');
  });

  it('the deployed handler module does not register it', async () => {
    vi.stubEnv('KILL_SWITCH_PARAM', '/test/kill');
    vi.stubEnv('TABLE_NAME', 'test-table');
    vi.stubEnv('DATA_BUCKET', 'test-bucket');
    vi.stubEnv('QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/123456789012/q');
    const { handler } = await import('./handler');
    const res = await handler(post({ question: 'Apple risks' }));
    expect(res.statusCode).toBe(404);
    vi.unstubAllEnvs();
  });

  it('validates the body and passes the parsed request through when wired', async () => {
    const retrievalDebug = vi.fn(async () => ({ ok: true }));
    const { app } = testApp({ deps: { retrievalDebug } });
    const ok = await app(post({ question: '  How has NVIDIA changed?  ', filters: { tickers: ['NVDA'], fiscalYearFrom: 2024 }, mode: 'bm25' }));
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ ok: true });
    expect(retrievalDebug).toHaveBeenCalledWith({ question: 'How has NVIDIA changed?', filters: { tickers: ['NVDA'], fiscalYearFrom: 2024 }, mode: 'bm25' }, 'req-123');

    for (const bad of [{}, { question: '' }, { question: 'x', mode: 'rerank' }, { question: 'x', extra: 1 }, { question: 'x', filters: { fiscalYearFrom: 2025, fiscalYearTo: 2024 } }, 'not json']) {
      const res = await app(post(bad));
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect(retrievalDebug).toHaveBeenCalledTimes(1);
  });
});

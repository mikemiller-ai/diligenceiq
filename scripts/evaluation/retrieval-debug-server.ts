#!/usr/bin/env -S pnpm exec tsx
/**
 * Local retrieval debug server (SPEC §27.3): serves the api app WITH `POST /api/retrieval/debug`
 * on 127.0.0.1, over the built index. Development only. The deployed api never registers the
 * route (services/api handler.ts), and this process is never deployed.
 *
 *   pnpm retrieval:debug                     # cached query embeddings only; new questions
 *                                            # fall back to BM25 unless --embed
 *   pnpm retrieval:debug --embed             # embeds new questions (Titan v2, ~$0.000001 each)
 *   pnpm retrieval:debug --port 4180 --bucket <name>   # index from S3 instead of .index/build
 *
 *   curl -s localhost:4180/api/retrieval/debug -H 'content-type: application/json' -d '{"question":"How has NVIDIA'\''s revenue changed over the last two years?"}'
 */
import { createServer } from 'node:http';
import { retrievalDebugView } from '@diligenceiq/rag';
import { randomBytes } from 'node:crypto';
import { MemoryAnalysisStore } from '../../services/api/src/analyses/store';
import { createApp } from '../../services/api/src/app';
import { createProfileProvider } from '../../services/api/src/profiles/provider';
import { staticSessionSecret } from '../../services/api/src/session/session';
import { MemoryWorkspaceStore } from '../../services/api/src/workspace/store';
import { arg } from '../lib/common';
import { createQueryEmbedder } from '../lib/query-embed';
import { openIndex } from '../lib/retrieval';

const port = Number(arg('port') && arg('port') !== 'true' ? arg('port') : 4180);
const bucket = arg('bucket');
const live = arg('embed') === 'true';
const { retriever, source, index } = await openIndex(bucket && bucket !== 'true' ? { bucket } : {});
const embedder = createQueryEmbedder({ live });

// Retrieval only: analyses are off, nothing is queued, and no profile set is active.
const analyses = new MemoryAnalysisStore();
const app = createApp({
  killSwitch: { analysesEnabled: async () => false },
  sessionSecret: staticSessionSecret(randomBytes(32).toString('hex')),
  analyses,
  workspace: new MemoryWorkspaceStore(analyses),
  queue: {
    send: async () => {
      throw new Error('the retrieval debug server runs no analyses');
    },
  },
  profiles: createProfileProvider({ pointer: async () => null, read: async () => null }),
  seed: null,
  indexVersion: index.manifest.indexVersion,
  indexAvailable: async () => true,
  secureCookies: false,
  retrievalDebug: async (req) => {
    let mode = req.mode ?? 'hybrid';
    let note: string | null = null;
    const embed = async (text: string) => embedder.embed(text);
    if (mode !== 'bm25' && !live) {
      try {
        await embedder.embed(req.question);
      } catch {
        mode = 'bm25';
        note = 'No cached embedding for this question and --embed is off: BM25 only.';
      }
    }
    const result = await retriever.retrieve(
      req.question,
      { ...(req.filters?.tickers ? { tickers: req.filters.tickers } : {}), ...(req.filters?.filingTypes ? { filingTypes: req.filters.filingTypes } : {}), ...(req.filters?.fiscalYearFrom !== undefined ? { fiscalYearFrom: req.filters.fiscalYearFrom } : {}), ...(req.filters?.fiscalYearTo !== undefined ? { fiscalYearTo: req.filters.fiscalYearTo } : {}) },
      mode === 'bm25' ? null : embed,
      { mode },
    );
    return { ...retrievalDebugView(result, { includeText: req.includeText ?? false }), ...(note ? { note } : {}) };
  },
});

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const event = {
      version: '2.0',
      rawPath: url.pathname,
      rawQueryString: url.search.slice(1),
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')])),
      body: Buffer.concat(chunks).toString('utf8'),
      isBase64Encoded: false,
      requestContext: { requestId: `local-${Date.now()}`, http: { method: req.method ?? 'GET', path: url.pathname } },
    } as unknown as Parameters<typeof app>[0];
    app(event)
      .then((r) => {
        res.writeHead(r.statusCode, r.headers);
        res.end(r.body);
      })
      .catch((e: unknown) => {
        // L5: never leave the request hanging; the message names the failure, never passage text.
        console.error(`retrieval debug: ${(e as Error).message}`);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'retrieval debug failed; see the server log' } }));
      });
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`retrieval debug: ${index.manifest.indexVersion} from ${source}; POST http://127.0.0.1:${port}/api/retrieval/debug (${live ? 'live query embeddings' : 'cached embeddings only'})`);
});
const stop = () => {
  embedder.close();
  server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

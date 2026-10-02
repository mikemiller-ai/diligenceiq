#!/usr/bin/env -S pnpm exec tsx
/**
 * Document embeddings (SPEC §24.5): Titan Text Embeddings v2, 1024 dimensions, normalized.
 * Cached by content hash and resumable: the cache file is the checkpoint, so rerunning after
 * an interruption embeds only what is missing. Rate-limited below the 300,000 tokens/minute
 * quota (assumptions D8). Calls Bedrock and spends money, so it is admin-run only.
 *
 * A live run takes the cache's exclusive lock (`<cache>.lock`), released on exit, SIGINT,
 * SIGTERM and error; a second concurrent run fails fast. A stale lock left by a killed
 * process is reported, not removed: delete it by hand after confirming no run is active.
 * `--dry-run` opens the cache read-only and writes nothing. Each live run appends its
 * attempts, successful calls and billed tokens to `.index/cache/embed-runs.jsonl`, which
 * `index:build` sums into the manifest.
 *
 *   pnpm index:embed --dry-run          # counts and cost estimate, no calls
 *   pnpm index:embed --max-calls 20     # smoke run
 *   pnpm index:embed                    # everything not yet cached
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { type Chunk, embeddingText } from '@diligenceiq/corpus';
import {
  EmbeddingCache,
  type EmbedRunRecord,
  TokenRateLimiter,
  acquireCacheLock,
  embedAll,
  embeddingHash,
  emptyEmbedStats,
} from '@diligenceiq/rag';
import { AWS_REGION, CHUNKS_FILE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, EMBED_RUN_LOG, arg, embeddingCachePath, fail } from '../lib/common';

/** Titan Text Embeddings v2 on-demand price, USD per 1,000 input tokens (us-east-1). */
const PRICE_PER_1K_TOKENS = 0.00002;
const TPM = Number(arg('tpm') ?? 240_000);
const CONCURRENCY = Number(arg('concurrency') ?? 6);
const maxCallsArg = arg('max-calls');

let chunks: Chunk[];
try {
  chunks = readFileSync(CHUNKS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Chunk);
} catch {
  fail(`embed: ${CHUNKS_FILE} not found; run \`pnpm ingest\` first`);
}
const texts = chunks.map(embeddingText);
const dryRun = Boolean(arg('dry-run'));
const cachePath = embeddingCachePath();
const stats = emptyEmbedStats(texts.length);
let runStartedAt: string | null = null;
let logged = false;
/** Appends this run's spend to the run log once; nothing is logged before the first call could be made. */
const logRun = (outcome: EmbedRunRecord['outcome']) => {
  if (logged || !runStartedAt) return;
  logged = true;
  const { attempts, successfulCalls, billedInputTokens, failures, cacheHits } = stats;
  const record: EmbedRunRecord = {
    modelId: EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIMENSIONS, startedAt: runStartedAt, endedAt: new Date().toISOString(), outcome,
    attempts, successfulCalls, billedInputTokens, failures, cacheHits,
  };
  try {
    appendFileSync(EMBED_RUN_LOG, `${JSON.stringify(record)}\n`);
  } catch (e) {
    console.error(`embed: could not append the run log: ${(e as Error).message}`);
  }
};
// A live run is the only writer: take the lock before opening the cache for writing, and
// release it however the process ends.
let releaseLock = () => {};
if (!dryRun) {
  try {
    releaseLock = acquireCacheLock(cachePath);
  } catch (e) {
    fail(`embed: ${(e as Error).message}`);
  }
  process.on('exit', () => {
    logRun('interrupted');
    releaseLock();
  });
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.on(signal, () => {
      console.error(`embed: ${signal}; ${stats.successfulCalls} vectors written this run, rerun to resume`);
      logRun('interrupted');
      releaseLock();
      process.exit(code);
    });
  }
}
const cache = new EmbeddingCache(cachePath, EMBEDDING_DIMENSIONS, { readOnly: dryRun });
const missing = new Map<string, number>();
for (const t of texts) {
  const h = embeddingHash(t, EMBEDDING_MODEL_ID);
  if (!cache.get(h)) missing.set(h, t.length);
}
const missingChars = [...missing.values()].reduce((a, n) => a + n, 0);
const estTokens = Math.round(missingChars / 4);
console.log(`embed: model ${EMBEDDING_MODEL_ID} (${EMBEDDING_DIMENSIONS} dims), ${texts.length} chunks, ${cache.size} cached`);
if (cache.skippedLines) console.log(`  ignored ${cache.skippedLines} unreadable cache line(s) (interrupted write)`);
console.log(`  to embed: ${missing.size} texts, ~${estTokens.toLocaleString('en-US')} tokens, ~$${((estTokens / 1000) * PRICE_PER_1K_TOKENS).toFixed(2)}, ~${Math.ceil(estTokens / TPM)} min at ${TPM.toLocaleString('en-US')} tokens/min`);
if (dryRun) process.exit(0);

const client = new BedrockRuntimeClient({ region: AWS_REGION, maxAttempts: 1 });
const t0 = Date.now();
runStartedAt = new Date(t0).toISOString();
try {
  await embedAll(texts, {
    stats,
    modelId: EMBEDDING_MODEL_ID,
    cache,
    limiter: new TokenRateLimiter(TPM),
    concurrency: CONCURRENCY,
    retries: 8,
    ...(maxCallsArg ? { maxCalls: Number(maxCallsArg) } : {}),
    // Throttling, transient service errors and network failures (DNS, reset, HTTP/2 stream cancel) are retried with backoff.
    isRetryable: (e) => {
      const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string } };
      return /Throttl|TooManyRequests|ServiceUnavailable|InternalServer|ModelNotReady|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ERR_HTTP2|socket hang up|timeout|NetworkingError/i.test(
        [err.name, err.message, err.code, err.cause?.code].join(' '),
      );
    },
    embedOne: async (text) => {
      const res = await client.send(
        new InvokeModelCommand({
          modelId: EMBEDDING_MODEL_ID,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true }),
        }),
      );
      const body = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[]; inputTextTokenCount: number };
      return { vector: Float32Array.from(body.embedding), inputTokens: body.inputTextTokenCount };
    },
    onProgress: (s) => {
      if (s.successfulCalls % 250 === 0) {
        const min = (Date.now() - t0) / 60_000;
        console.log(`  ${s.successfulCalls} calls (${s.attempts} attempts), ${s.billedInputTokens.toLocaleString('en-US')} tokens, ${min.toFixed(1)} min`);
      }
    },
  });
} catch (e) {
  logRun('failed');
  releaseLock();
  fail(`embed: ${(e as Error).message}; ${stats.successfulCalls} vectors written this run, rerun to resume`);
}
const remaining = texts.filter((t) => !cache.get(embeddingHash(t, EMBEDDING_MODEL_ID))).length;
logRun(remaining > 0 ? 'max-calls' : 'completed');
releaseLock();
console.log(
  `embed: done. attempts ${stats.attempts}, successful calls ${stats.successfulCalls}, billed input tokens ${stats.billedInputTokens.toLocaleString('en-US')}, cache hits ${stats.cacheHits}, failures ${stats.failures}`,
);
console.log(`  cost ~$${((stats.billedInputTokens / 1000) * PRICE_PER_1K_TOKENS).toFixed(4)}; cache now ${cache.size} vectors${remaining ? `, ${remaining} chunks still to embed` : ''}`);

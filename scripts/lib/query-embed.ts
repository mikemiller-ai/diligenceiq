/**
 * Query embeddings for the offline retrieval tools (eval harness, local retrieval debug
 * server). One Titan v2 call per new question, cached by sha256(text + model id) in
 * `.index/cache/query-embeddings-<model>-<dims>.jsonl`, so a rerun costs nothing.
 *
 * Spend rule: live calls happen only when the caller passes `live: true` (the CLIs' `--embed`
 * flag, run after Mike's go-ahead). Otherwise a question missing from the cache is an error,
 * never a silent call. A live session holds the cache's writer lock (packages/rag embedder).
 */
import { join } from 'node:path';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { EmbeddingCache, acquireCacheLock, embeddingHash } from '@diligenceiq/rag';
import { AWS_REGION, CACHE_DIR, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, ensureDir } from './common';

/** Titan Text Embeddings v2 on-demand price, USD per 1K input tokens (estimate). */
export const TITAN_PRICE_PER_1K = 0.00002;

export function queryCachePath(modelId = EMBEDDING_MODEL_ID): string {
  return join(ensureDir(CACHE_DIR), `query-embeddings-${modelId.replace(/[^A-Za-z0-9.-]/g, '_')}-${EMBEDDING_DIMENSIONS}.jsonl`);
}

export interface QueryEmbedder {
  embed: (text: string) => Promise<Float32Array>;
  stats: { cacheHits: number; liveCalls: number; inputTokens: number };
  close: () => void;
}

export function createQueryEmbedder(options: { live: boolean; modelId?: string }): QueryEmbedder {
  const modelId = options.modelId ?? EMBEDDING_MODEL_ID;
  const path = queryCachePath(modelId);
  const release = options.live ? acquireCacheLock(path) : () => {};
  const cache = new EmbeddingCache(path, EMBEDDING_DIMENSIONS, { readOnly: !options.live });
  const client = options.live ? new BedrockRuntimeClient({ region: AWS_REGION, maxAttempts: 1 }) : null;
  const stats = { cacheHits: 0, liveCalls: 0, inputTokens: 0 };
  return {
    stats,
    close: release,
    embed: async (text: string) => {
      const hash = embeddingHash(text, modelId);
      const hit = cache.get(hash);
      if (hit) {
        stats.cacheHits++;
        return hit;
      }
      if (!client) throw new Error(`no cached query embedding for "${text.slice(0, 60)}…"; rerun with --embed (one Titan v2 call per new question, ~$0.000001 each)`);
      const res = await client.send(
        new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true }),
        }),
      );
      const body = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[]; inputTextTokenCount: number };
      const vector = Float32Array.from(body.embedding);
      cache.put(hash, vector, body.inputTextTokenCount);
      stats.liveCalls++;
      stats.inputTokens += body.inputTextTokenCount;
      return vector;
    },
  };
}

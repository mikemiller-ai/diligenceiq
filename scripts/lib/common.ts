/**
 * Shared paths and helpers for the offline, admin-run ingestion and indexing CLIs
 * (SPEC §24; architecture §6.1–6.4). Outputs go under `.index/` (gitignored).
 */
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Chunk, type RawFiling, chunkFiling, processFilings } from '@diligenceiq/corpus';
import { TOKENIZER_VERSION, chunksHash, indexVersionOf } from '@diligenceiq/rag';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX_HOME = join(ROOT, '.index');
export const WORK_DIR = join(INDEX_HOME, 'work');
export const PROCESSED_DIR = join(WORK_DIR, 'processed');
export const CHUNKS_FILE = join(WORK_DIR, 'chunks.jsonl');
export const INGEST_REPORT = join(WORK_DIR, 'ingest-report.json');
export const EXTRACTION_DIR = join(WORK_DIR, 'extraction');
export const CACHE_DIR = join(INDEX_HOME, 'cache');
export const BUILD_DIR = join(INDEX_HOME, 'build');
/** Per-run embedding statistics (attempts, successful calls, billed tokens), one JSON line per live run. */
export const EMBED_RUN_LOG = join(CACHE_DIR, 'embed-runs.jsonl');

export const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMENSIONS = 1024;
export const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function embeddingCachePath(modelId = EMBEDDING_MODEL_ID): string {
  return join(ensureDir(CACHE_DIR), `embeddings-${modelId.replace(/[^A-Za-z0-9.-]/g, '_')}-${EMBEDDING_DIMENSIONS}.jsonl`);
}

export function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Hash of every filing's name and content, in name order. */
export function corpusHash(filings: readonly RawFiling[]): string {
  const h = createHash('sha256');
  for (const f of [...filings].sort((a, b) => a.file.localeCompare(b.file))) h.update(f.file).update('\u0000').update(sha256(f.raw)).update('\n');
  return h.digest('hex');
}

/**
 * Index version from the chunks as produced (SPEC §24.4, §25.2; packages/rag version.ts):
 * content hash of chunks.jsonl and the embedded texts, tokenizer version, embedding model and
 * dimensions. `chunks` must be in ingest (vector) order.
 */
export function indexVersionForChunks(chunks: readonly Chunk[], modelId = EMBEDDING_MODEL_ID): string {
  return indexVersionOf({ chunksHash: chunksHash(chunks), tokenizerVersion: TOKENIZER_VERSION, modelId, dimensions: EMBEDDING_DIMENSIONS });
}

/** The index version `pnpm ingest` would record for this corpus (processes and chunks every filing, as ingest does). */
export function indexVersionForCorpus(filings: readonly RawFiling[], modelId = EMBEDDING_MODEL_ID): string {
  return indexVersionForChunks(
    processFilings(filings).flatMap((f) => chunkFiling(f.meta, f.text, f.sections)),
    modelId,
  );
}

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : 'true';
}

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

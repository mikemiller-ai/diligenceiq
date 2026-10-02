import { createHash } from 'node:crypto';
import type { Chunk } from '@diligenceiq/corpus';
import { type Bm25Index, type Bm25Meta, loadBm25 } from './bm25';

/**
 * Index artifacts under `index/<indexVersion>/` (SPEC §24.4; architecture §6.4):
 *
 *   manifest.json        version, inputs, counts, embedding calls and tokens, artifact hashes
 *   summary.json         the index summary (documents, chunks, companies, fiscal years,
 *                        filing types, detected sections per filing)
 *   chunks.jsonl         chunk metadata + verbatim passage text, one per line, in vector order
 *   vectors.bin          Float32 [chunks × dims], L2-normalized, little-endian
 *   bm25.json            BM25 vocabulary and statistics
 *   bm25-postings.bin    BM25 postings (Uint32 doc indexes, then Uint16 term frequencies)
 *   adjacency/<T>.json   per company: each chunk's closest same-section passages in the
 *                        previous and next filing of the same form (and, for 10-Qs, the same
 *                        quarter of the prior fiscal year)
 *
 * Built in a temporary directory and moved into place only after validation passes, with a
 * VALIDATED marker that `index:upload` requires (never uploaded itself).
 */
export const ARTIFACTS = {
  manifest: 'manifest.json',
  summary: 'summary.json',
  chunks: 'chunks.jsonl',
  vectors: 'vectors.bin',
  bm25: 'bm25.json',
  bm25Postings: 'bm25-postings.bin',
  adjacencyDir: 'adjacency',
  validatedMarker: 'VALIDATED',
} as const;

/** The artifacts the cold load reads; each is verified against the manifest's bytes and sha256. */
export const COLD_LOAD_ARTIFACTS = [ARTIFACTS.chunks, ARTIFACTS.vectors, ARTIFACTS.bm25, ARTIFACTS.bm25Postings] as const;

/** Written by `index:build` after validation passes; `index:upload` refuses a build without it. */
export interface ValidatedMarker {
  indexVersion: string;
  validatedAt: string;
  /** sha256 of manifest.json as validated. */
  manifestSha256: string;
}

export type ChunkRecord = Chunk;

export interface IndexManifest {
  indexVersion: string;
  createdAt: string;
  corpusHash: string;
  /** Content hash the version is derived from (version.ts). */
  chunksHash: string;
  chunkerVersion: string;
  tokenizerVersion: string;
  embedding: {
    modelId: string;
    dimensions: number;
    normalized: true;
    /** Unique embedded texts in this version (one vector each; duplicates share it). */
    embeddedTexts: number;
    /** Input tokens the model reported for those texts, as recorded in the embedding cache. */
    inputTokens: number;
    /** Chunks whose embedded text duplicates another chunk's (no extra vector needed). */
    duplicateTexts: number;
    /**
     * Spend recorded by `pnpm index:embed` runs for this model (embed-runs.jsonl), summed.
     * It covers only runs since the run log was introduced (Phase 2 fixes), and the whole
     * cache for this model, which may include texts of other index versions. Null when no
     * run was logged.
     */
    embedRuns: { runs: number; since: string; attempts: number; successfulCalls: number; billedInputTokens: number; failures: number } | null;
  };
  counts: { documents: number; chunks: number; companies: number; bm25Terms: number; bm25Postings: number };
  artifacts: Record<string, { bytes: number; sha256: string }>;
}

export interface LoadedIndex {
  manifest: IndexManifest;
  chunks: ChunkRecord[];
  vectors: Float32Array;
  dims: number;
  bm25: Bm25Index;
  timingsMs: Record<string, number>;
}

/** Reads one artifact by name: a local directory or an S3 prefix. */
export type ArtifactReader = (name: string) => Promise<Buffer>;

export function parseChunks(buf: Buffer): ChunkRecord[] {
  return buf
    .toString('utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as ChunkRecord);
}

export function vectorsFromBuffer(buf: Buffer, dims: number): Float32Array {
  if (buf.byteLength % (4 * dims) !== 0) throw new Error(`vectors.bin: ${buf.byteLength} bytes is not a multiple of ${4 * dims}`);
  const out = new Float32Array(buf.byteLength / 4);
  out.set(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  return out;
}

/** Throws unless `buf` has the byte length and sha256 the manifest records for `name`. */
export function verifyArtifact(manifest: Pick<IndexManifest, 'artifacts' | 'indexVersion'>, name: string, buf: Buffer): void {
  const want = manifest.artifacts?.[name];
  if (!want) throw new Error(`index ${manifest.indexVersion}: manifest has no hash for ${name}`);
  if (buf.byteLength !== want.bytes) throw new Error(`index ${manifest.indexVersion}: ${name} is ${buf.byteLength} bytes, manifest says ${want.bytes}`);
  const got = createHash('sha256').update(buf).digest('hex');
  if (got !== want.sha256) throw new Error(`index ${manifest.indexVersion}: ${name} sha256 ${got.slice(0, 12)} differs from the manifest's ${want.sha256.slice(0, 12)}`);
}

/**
 * Cold load of the runtime index (vectors, chunks, BM25), timed per step. Each artifact is
 * checked against the manifest's byte length and sha256 before parsing (`verify:artifacts`).
 * Adjacency files are read on demand per company and are not part of the cold load.
 */
export async function loadIndex(read: ArtifactReader): Promise<LoadedIndex> {
  const timingsMs: Record<string, number> = {};
  const time = async <T>(label: string, f: () => Promise<T> | T): Promise<T> => {
    const t0 = performance.now();
    const v = await f();
    timingsMs[label] = Math.round(performance.now() - t0);
    return v;
  };
  const t0 = performance.now();
  const manifest = JSON.parse((await time('read:manifest', () => read(ARTIFACTS.manifest))).toString('utf8')) as IndexManifest;
  const buffers = await time('read:artifacts', () => Promise.all(COLD_LOAD_ARTIFACTS.map((name) => read(name))));
  await time('verify:artifacts', () => COLD_LOAD_ARTIFACTS.forEach((name, i) => verifyArtifact(manifest, name, buffers[i]!)));
  const [chunksBuf, vectorsBuf, bm25Buf, postingsBuf] = buffers as [Buffer, Buffer, Buffer, Buffer];
  const dims = manifest.embedding.dimensions;
  const chunks = await time('parse:chunks', () => parseChunks(chunksBuf));
  const vectors = await time('parse:vectors', () => vectorsFromBuffer(vectorsBuf, dims));
  const bm25 = await time('parse:bm25', () => loadBm25(JSON.parse(bm25Buf.toString('utf8')) as Bm25Meta, postingsBuf));
  timingsMs.total = Math.round(performance.now() - t0);
  if (chunks.length * dims !== vectors.length) throw new Error(`index: ${chunks.length} chunks but ${vectors.length / dims} vectors`);
  if (bm25.meta.docCount !== chunks.length) throw new Error(`index: ${chunks.length} chunks but bm25 has ${bm25.meta.docCount} documents`);
  return { manifest, chunks, vectors, dims, bm25, timingsMs };
}

/** Exact cosine over normalized vectors (the dot product), optionally filtered. */
export function cosineScores(index: Pick<LoadedIndex, 'vectors' | 'dims'>, query: Float32Array, allowed?: (doc: number) => boolean): Float32Array {
  const { vectors, dims } = index;
  const n = vectors.length / dims;
  const out = new Float32Array(n).fill(Number.NEGATIVE_INFINITY);
  for (let d = 0; d < n; d++) {
    if (allowed && !allowed(d)) continue;
    let s = 0;
    const base = d * dims;
    for (let k = 0; k < dims; k++) s += vectors[base + k]! * query[k]!;
    out[d] = s;
  }
  return out;
}

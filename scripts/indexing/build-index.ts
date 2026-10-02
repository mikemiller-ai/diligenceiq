#!/usr/bin/env -S pnpm exec tsx
/**
 * Index build (SPEC §24.4; architecture §6.4): chunks + cached embeddings → vectors.bin,
 * chunks.jsonl, BM25, adjacency files, summary.json and manifest.json, then index validation.
 * No model calls: every vector must already be in the embedding cache (`pnpm index:embed`),
 * which is opened read-only.
 *
 * Before building, the index version is re-derived from chunks.jsonl and the current
 * EMBEDDING_MODEL_ID and must match the ingest report (chunk IDs are immutable within a
 * version, SPEC §25.2). The build is written to a temporary directory; only after validation
 * passes is the VALIDATED marker written and the directory moved to
 * `.index/build/<indexVersion>/`. A failed build leaves nothing at the final path.
 *
 *   pnpm index:build
 */
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHUNKER_VERSION, type Chunk, embeddingText } from '@diligenceiq/corpus';
import {
  ARTIFACTS,
  EmbeddingCache,
  type IndexManifest,
  type IngestReport,
  TOKENIZER_VERSION,
  type ValidatedMarker,
  buildBm25,
  buildSummary,
  computeAdjacency,
  embeddingHash,
  formatSummary,
  loadIndex,
  serializeChunks,
  sumEmbedRuns,
  validateIndex,
  verifyIndexVersion,
} from '@diligenceiq/rag';
import {
  BUILD_DIR,
  CHUNKS_FILE,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBED_RUN_LOG,
  INGEST_REPORT,
  embeddingCachePath,
  ensureDir,
  fail,
  sha256,
} from '../lib/common';

const t0 = performance.now();
const report = JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as IngestReport;
const chunksJsonl = readFileSync(CHUNKS_FILE, 'utf8');
const chunks = chunksJsonl.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Chunk);
const versionProblems = verifyIndexVersion(chunksJsonl, chunks, report, {
  tokenizerVersion: TOKENIZER_VERSION,
  modelId: EMBEDDING_MODEL_ID,
  dimensions: EMBEDDING_DIMENSIONS,
});
if (versionProblems.length) fail(`index:build: ${CHUNKS_FILE} does not match ${report.indexVersion}:\n  ${versionProblems.join('\n  ')}`);

const cache = new EmbeddingCache(embeddingCachePath(), EMBEDDING_DIMENSIONS, { readOnly: true });
const dims = EMBEDDING_DIMENSIONS;
const vectors = new Float32Array(chunks.length * dims);
let missing = 0;
let inputTokens = 0;
const uniqueHashes = new Set<string>();
chunks.forEach((c, i) => {
  const h = embeddingHash(embeddingText(c), EMBEDDING_MODEL_ID);
  const v = cache.get(h);
  if (!v) {
    missing++;
    return;
  }
  vectors.set(v, i * dims);
  if (!uniqueHashes.has(h)) {
    uniqueHashes.add(h);
    inputTokens += cache.tokens(h) ?? 0;
  }
});
if (missing) fail(`index:build: ${missing} of ${chunks.length} chunks have no cached embedding; run \`pnpm index:embed\``);

const final = join(BUILD_DIR, report.indexVersion);
const out = join(BUILD_DIR, `.tmp-${report.indexVersion}-${process.pid}`);
rmSync(out, { recursive: true, force: true });
ensureDir(join(out, ARTIFACTS.adjacencyDir));
const cleanup = () => rmSync(out, { recursive: true, force: true });

try {
  writeFileSync(join(out, ARTIFACTS.chunks), serializeChunks(chunks));
  writeFileSync(join(out, ARTIFACTS.vectors), Buffer.from(vectors.buffer));
  const bm25 = buildBm25(chunks.map(embeddingText), TOKENIZER_VERSION);
  writeFileSync(join(out, ARTIFACTS.bm25), JSON.stringify(bm25.meta));
  writeFileSync(join(out, ARTIFACTS.bm25Postings), bm25.postings);
  const adjacency = computeAdjacency(chunks, vectors, dims);
  for (const [ticker, file] of adjacency) writeFileSync(join(out, ARTIFACTS.adjacencyDir, `${ticker}.json`), JSON.stringify(file));
  const summary = buildSummary(report, chunks);
  writeFileSync(join(out, ARTIFACTS.summary), JSON.stringify(summary, null, 2));

  const artifacts: IndexManifest['artifacts'] = {};
  const names = [
    ARTIFACTS.chunks,
    ARTIFACTS.vectors,
    ARTIFACTS.bm25,
    ARTIFACTS.bm25Postings,
    ARTIFACTS.summary,
    ...[...adjacency.keys()].map((t) => `${ARTIFACTS.adjacencyDir}/${t}.json`),
  ];
  for (const name of names) {
    const buf = readFileSync(join(out, name));
    artifacts[name] = { bytes: buf.byteLength, sha256: sha256(buf) };
  }
  // A version is immutable: if a validated build of it already exists with byte-identical
  // artifacts, keep it (its manifest and marker may already be uploaded) instead of writing a
  // new manifest whose timestamps would differ.
  const existingManifest = join(final, ARTIFACTS.manifest);
  if (existsSync(join(final, ARTIFACTS.validatedMarker)) && existsSync(existingManifest)) {
    const prev = JSON.parse(readFileSync(existingManifest, 'utf8')) as IndexManifest;
    const same = (a: IndexManifest['artifacts'], b: IndexManifest['artifacts']) =>
      Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k]?.sha256 === v.sha256 && b[k]?.bytes === v.bytes);
    if (same(prev.artifacts, artifacts)) {
      cleanup();
      console.log(`index:build ${report.indexVersion}: an identical validated build already exists at ${final}; kept it unchanged`);
      process.exit(0);
    }
  }
  const manifest: IndexManifest = {
    indexVersion: report.indexVersion,
    createdAt: new Date().toISOString(),
    corpusHash: report.corpusHash,
    chunksHash: report.chunksHash!,
    chunkerVersion: CHUNKER_VERSION,
    tokenizerVersion: TOKENIZER_VERSION,
    embedding: {
      modelId: EMBEDDING_MODEL_ID,
      dimensions: dims,
      normalized: true,
      // What this version needs: one vector per unique embedded text, and the tokens the
      // model reported for those texts (recorded in the cache when each was embedded).
      embeddedTexts: uniqueHashes.size,
      inputTokens,
      duplicateTexts: chunks.length - uniqueHashes.size,
      // What embed runs actually spent (attempts include failed calls and retries); see the type.
      embedRuns: existsSync(EMBED_RUN_LOG) ? sumEmbedRuns(readFileSync(EMBED_RUN_LOG, 'utf8'), EMBEDDING_MODEL_ID) : null,
    },
    counts: {
      documents: report.documents,
      chunks: chunks.length,
      companies: summary.companies.length,
      bm25Terms: bm25.meta.terms.length,
      bm25Postings: bm25.meta.offsets.at(-1)!,
    },
    artifacts,
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(join(out, ARTIFACTS.manifest), manifestJson);

  // Validation runs after every build (SPEC §24.5) against the artifacts as written; the
  // load itself verifies each cold-load artifact's bytes and sha256 against the manifest.
  const loaded = await loadIndex(async (name) => readFileSync(join(out, name)));
  const problems = validateIndex(loaded, report, adjacency);
  console.log(formatSummary(summary));
  const size = (name: string) => `${(statSync(join(out, name)).size / 1e6).toFixed(1)} MB`;
  console.log(`\nindex:build ${report.indexVersion} in ${Math.round(performance.now() - t0)} ms`);
  console.log(`  vectors ${size(ARTIFACTS.vectors)}, chunks ${size(ARTIFACTS.chunks)}, bm25 ${size(ARTIFACTS.bm25)} + ${size(ARTIFACTS.bm25Postings)}`);
  console.log(`  embedded texts ${uniqueHashes.size}, their input tokens ${inputTokens.toLocaleString('en-US')}`);
  const runs = manifest.embedding.embedRuns;
  console.log(
    runs
      ? `  embed runs logged since ${runs.since}: ${runs.runs} runs, ${runs.attempts} attempts, ${runs.successfulCalls} successful calls, ${runs.billedInputTokens.toLocaleString('en-US')} billed tokens`
      : '  embed runs: none logged (runs before the run log existed are not counted)',
  );
  console.log(`  local cold load: ${JSON.stringify(loaded.timingsMs)}`);
  if (problems.length) throw new Error(`index validation FAILED:\n  ${problems.slice(0, 50).join('\n  ')}`);

  const marker: ValidatedMarker = { indexVersion: report.indexVersion, validatedAt: new Date().toISOString(), manifestSha256: sha256(manifestJson) };
  writeFileSync(join(out, ARTIFACTS.validatedMarker), JSON.stringify(marker, null, 2));
  rmSync(final, { recursive: true, force: true });
  renameSync(out, final);
  console.log(`  index validation: OK → ${final}`);
} catch (e) {
  cleanup();
  fail(`index:build: ${(e as Error).message} (temporary build removed; ${final} unchanged)`);
}

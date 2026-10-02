#!/usr/bin/env -S pnpm exec tsx
/**
 * Corpus ingestion (SPEC §24.2 steps 1–8): manifest check → headers and overrides → periods
 * and fiscal labels → preamble and whitespace → sections → boilerplate → chunks.
 * Offline and local: reads CORPUS_PATH (directory or zip), writes `.index/work/`. No AWS.
 *
 *   pnpm ingest
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkFiling, companyCoverage, defaultCorpusPath, loadCorpus, manifestIssues, processFilings } from '@diligenceiq/corpus';
import { TOKENIZER_VERSION, chunksHash, indexVersionOf, serializeChunks } from '@diligenceiq/rag';
import { CHUNKS_FILE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL_ID, INGEST_REPORT, PROCESSED_DIR, ROOT, corpusHash, ensureDir, fail } from '../lib/common';

const t0 = performance.now();
const corpus = loadCorpus(defaultCorpusPath(ROOT));
const issues = manifestIssues(corpus);
if (issues.length) fail(`ingest: manifest check failed:\n  ${issues.join('\n  ')}`);

const filings = processFilings(corpus.filings);
const chunks = filings.flatMap((f) => chunkFiling(f.meta, f.text, f.sections));
const ids = new Set(chunks.map((c) => c.chunkId));
if (ids.size !== chunks.length) fail('ingest: duplicate chunk IDs');
for (const c of chunks) {
  const f = filings.find((x) => x.meta.documentId === c.documentId)!;
  if (f.text.slice(c.charStart, c.charEnd) !== c.text) fail(`ingest: ${c.chunkId} is not a verbatim slice`);
}

rmSync(PROCESSED_DIR, { recursive: true, force: true });
ensureDir(PROCESSED_DIR);
for (const f of filings) {
  writeFileSync(join(PROCESSED_DIR, `${f.meta.documentId}.json`), JSON.stringify({ meta: f.meta, sections: f.sections, text: f.text }));
}
writeFileSync(CHUNKS_FILE, serializeChunks(chunks));

const hash = corpusHash(corpus.filings);
// The version is a content hash of the chunks as produced, so chunk IDs and text are immutable
// within it (SPEC §25.2); `index:build` re-derives it from chunks.jsonl and refuses a mismatch.
const contentHash = chunksHash(chunks);
const report = {
  corpusPath: corpus.path,
  corpusHash: hash,
  chunksHash: contentHash,
  indexVersion: indexVersionOf({ chunksHash: contentHash, tokenizerVersion: TOKENIZER_VERSION, modelId: EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIMENSIONS }),
  tokenizerVersion: TOKENIZER_VERSION,
  embedding: { modelId: EMBEDDING_MODEL_ID, dimensions: EMBEDDING_DIMENSIONS },
  license: corpus.manifest?.license ?? null,
  documents: filings.length,
  chunks: chunks.length,
  filings: filings.map((f) => ({
    documentId: f.meta.documentId,
    ticker: f.meta.ticker,
    filingType: f.meta.filingType,
    fiscalLabel: f.meta.fiscalLabel,
    periodEnd: f.meta.periodEnd,
    periodSource: f.meta.periodSource,
    sections: f.sections
      .filter((s) => s.kind !== 'other')
      .map((s) => ({ kind: s.kind, code: s.code, anchor: s.anchor, chars: s.end - s.start })),
    chunks: chunks.filter((c) => c.documentId === f.meta.documentId).length,
    boilerplateChunks: chunks.filter((c) => c.documentId === f.meta.documentId && c.boilerplate).length,
  })),
  coverage: companyCoverage(filings.map((f) => f.meta)),
};
writeFileSync(INGEST_REPORT, JSON.stringify(report, null, 2));

const lens = chunks.map((c) => c.text.length).sort((a, b) => a - b);
console.log(`ingest: ${filings.length} filings → ${chunks.length} chunks in ${Math.round(performance.now() - t0)} ms`);
console.log(`  corpus hash ${hash.slice(0, 16)}…, index version ${report.indexVersion}`);
console.log(`  chunk chars: median ${lens[Math.floor(lens.length / 2)]}, max ${lens.at(-1)}`);
console.log(`  wrote ${CHUNKS_FILE}, ${PROCESSED_DIR}/, ${INGEST_REPORT}`);

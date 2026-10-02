/**
 * Test-only access to the real corpus (gitignored). Tests that need it check `HAVE_CORPUS`
 * and skip with a visible message when it is absent (testing-strategy §2), except under
 * REQUIRE_CORPUS=1 (set by `pnpm gate`), where a missing corpus fails loudly instead, so the
 * Phase 2 exit-criteria tests can never pass the gate by skipping.
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Chunk, chunkFiling } from '../chunker';
import { type ProcessedFiling, processFilings } from '../filing';
import { type LoadedCorpus, loadCorpus } from '../load';

export const CORPUS_DIR = resolve(process.env.CORPUS_PATH ?? join(__dirname, '../../../../edgar_corpus'));
export const HAVE_CORPUS = existsSync(CORPUS_DIR);
export const REQUIRE_CORPUS = process.env.REQUIRE_CORPUS === '1';
if (!HAVE_CORPUS && REQUIRE_CORPUS) {
  throw new Error(`corpus tests: REQUIRE_CORPUS=1 but the corpus is not at ${CORPUS_DIR}; set CORPUS_PATH or restore edgar_corpus/`);
}
if (!HAVE_CORPUS) console.warn(`corpus tests: corpus not found at ${CORPUS_DIR}; skipping corpus-backed tests`);

let cached: { corpus: LoadedCorpus; filings: ProcessedFiling[]; chunks: Chunk[] } | null = null;

export function realCorpus(): { corpus: LoadedCorpus; filings: ProcessedFiling[]; chunks: Chunk[] } {
  if (!cached) {
    const corpus = loadCorpus(CORPUS_DIR);
    const filings = processFilings(corpus.filings);
    const chunks = filings.flatMap((f) => chunkFiling(f.meta, f.text, f.sections));
    cached = { corpus, filings, chunks };
  }
  return cached;
}

export function filing(documentId: string): ProcessedFiling {
  const f = realCorpus().filings.find((x) => x.meta.documentId === documentId);
  if (!f) throw new Error(`no filing ${documentId}`);
  return f;
}

export function chunksOf(documentId: string): Chunk[] {
  return realCorpus().chunks.filter((c) => c.documentId === documentId);
}

export function company(ticker: string): { filings: ProcessedFiling[]; chunks: Chunk[] } {
  const { filings, chunks } = realCorpus();
  return { filings: filings.filter((f) => f.meta.ticker === ticker), chunks: chunks.filter((c) => c.ticker === ticker) };
}

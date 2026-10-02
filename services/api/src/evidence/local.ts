import { join } from 'node:path';
import { type ProcessedFiling, loadCorpus, processFilings } from '@diligenceiq/corpus';
import type { EvidenceReader } from './store';

/**
 * Serves the evidence keys of the data bucket from local sources, for tests and the e2e server
 * (never bundled into the deployed handler):
 * - `processed/<indexVersion>/<documentId>.json` is processed from the corpus on demand, exactly as
 *   `pnpm ingest` does (one company at a time: its 10-Qs' fiscal labels need its 10-Ks). The
 *   committed fixtures cannot carry the corpus (gitignored), and `REQUIRE_CORPUS=1` makes the gate
 *   fail rather than skip without it.
 * - `index/<indexVersion>/adjacency/<TICKER>.json` is read from `adjacencyRoot`, a committed subset
 *   of the real adjacency files (`pnpm fixtures:evidence`).
 * - `index/<indexVersion>/manifest.json` is read from `manifestPath`, the real build manifest of
 *   that index copied verbatim by `pnpm fixtures:evidence`. Nothing is synthesized: if the bundled
 *   chunker stops matching the manifest's `chunkerVersion`, the evidence tests fail like production.
 */
export function corpusEvidenceReader(opts: { corpusPath: string; indexVersion: string; adjacencyRoot: string; manifestPath: string }): EvidenceReader {
  let corpus: ReturnType<typeof loadCorpus> | null = null;
  const byTicker = new Map<string, Map<string, ProcessedFiling>>();
  const processedFor = (ticker: string) => {
    let m = byTicker.get(ticker);
    if (!m) {
      corpus ??= loadCorpus(opts.corpusPath);
      const raws = corpus.filings.filter((f) => f.file.startsWith(`${ticker}_`));
      m = new Map(processFilings(raws).map((f) => [f.meta.documentId, f]));
      byTicker.set(ticker, m);
    }
    return m;
  };
  const adjacency = (key: string) => {
    const ticker = key.slice(key.lastIndexOf('/') + 1).replace(/\.json$/, '');
    if (!/^[A-Z]{1,5}$/.test(ticker)) return Promise.resolve(null);
    return readOrNull(join(opts.adjacencyRoot, `${ticker}.json`));
  };
  return async (key) => {
    const processed = `processed/${opts.indexVersion}/`;
    if (key.startsWith(processed)) {
      const documentId = key.slice(processed.length).replace(/\.json$/, '');
      const ticker = documentId.split('_')[0] ?? '';
      const f = processedFor(ticker).get(documentId);
      return f ? JSON.stringify({ meta: f.meta, sections: f.sections, text: f.text }) : null;
    }
    if (key.startsWith(`index/${opts.indexVersion}/adjacency/`)) return adjacency(key);
    if (key === `index/${opts.indexVersion}/manifest.json`) return readOrNull(opts.manifestPath);
    return null;
  };
}

async function readOrNull(path: string): Promise<string | null> {
  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Serves the evidence keys from a local index build (`pnpm evidence:check`): `.index/work/processed`,
 * `.index/build/<iv>/adjacency` and `.index/build/<iv>/manifest.json`.
 */
export function buildDirEvidenceReader(opts: { processedDir: string; adjacencyDir: string; manifestPath: string; indexVersion: string }): EvidenceReader {
  return async (key) => {
    if (key === `index/${opts.indexVersion}/manifest.json`) return readOrNull(opts.manifestPath);
    const processed = `processed/${opts.indexVersion}/`;
    const adjacency = `index/${opts.indexVersion}/adjacency/`;
    const name = key.slice(key.lastIndexOf('/') + 1);
    if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) return null;
    if (key === `${processed}${name}`) return readOrNull(join(opts.processedDir, name));
    if (key === `${adjacency}${name}`) return readOrNull(join(opts.adjacencyDir, name));
    return null;
  };
}

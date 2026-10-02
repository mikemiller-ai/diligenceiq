#!/usr/bin/env -S pnpm exec tsx
/**
 * Committed adjacency subset for the api tests and the e2e server (Phase 6). The real adjacency
 * files (`.index/build/<iv>/adjacency/`, 11 MB) are gitignored; the tests process filings from the
 * corpus themselves, but adjacency needs the stored embeddings, so a subset is copied verbatim:
 * - every chunk the committed fixture profiles, the seed analyses (citations and context) and the
 *   web risk-heading fixtures reference;
 * - for AAPL and JNJ (the Phase 6 exit criterion), the first chunk of Risk Factors and of MD&A in
 *   every filing, so both ends of each company's history are covered.
 * Entries are copied unchanged, never edited. The build's `manifest.json` is copied verbatim beside
 * them: the api's evidence store checks its `chunkerVersion` against the bundled chunker.
 *
 *   pnpm fixtures:evidence
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tickerOfChunkId } from '@diligenceiq/core';
import { BUILD_DIR, ROOT } from '../lib/common';

const seed = JSON.parse(readFileSync(join(ROOT, 'seed/demo-workspace.json'), 'utf8')) as {
  indexVersion: string;
  analyses: Array<{ citations: Array<{ chunkId: string }>; context: { passages: Array<{ chunkId: string }> } }>;
};
const iv = seed.indexVersion;
const adjacencyDir = join(BUILD_DIR, iv, 'adjacency');
if (!existsSync(adjacencyDir)) throw new Error(`no index build at ${adjacencyDir}; run pnpm index:build first`);
const OUT = join(ROOT, 'tests/fixtures/evidence', iv, 'adjacency');
const FULL_HISTORY = ['AAPL', 'JNJ'];

const wanted = new Set<string>();
for (const a of seed.analyses) {
  for (const c of a.citations) wanted.add(c.chunkId);
  for (const c of a.context.passages) wanted.add(c.chunkId);
}
const setDir = join(ROOT, 'tests/fixtures/profile-sets', iv);
for (const set of readdirSync(setDir)) {
  for (const f of readdirSync(join(setDir, set)).filter((n) => /^[A-Z]+\.json$/.test(n))) {
    const p = JSON.parse(readFileSync(join(setDir, set, f), 'utf8')) as { citations: Array<{ chunkId: string }> };
    for (const c of p.citations) wanted.add(c.chunkId);
  }
}
const risk = JSON.parse(readFileSync(join(ROOT, 'apps/web/src/fixtures/generated/risk-headings.json'), 'utf8')) as {
  companies: Array<{ headings: Array<{ chunkIds: string[] }> }>;
};
for (const c of risk.companies) for (const h of c.headings) for (const id of h.chunkIds) wanted.add(id);

const tickers = new Set([...wanted].map((id) => tickerOfChunkId(id)).filter((t): t is string => t !== null));
for (const t of FULL_HISTORY) tickers.add(t);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let entries = 0;
for (const t of [...tickers].sort()) {
  const file = JSON.parse(readFileSync(join(adjacencyDir, `${t}.json`), 'utf8')) as Record<string, unknown>;
  const keep = Object.keys(file)
    .filter((id) => wanted.has(id) || (FULL_HISTORY.includes(t) && /-(1A|MDA)-001$/.test(id)))
    .sort();
  writeFileSync(join(OUT, `${t}.json`), `${JSON.stringify(Object.fromEntries(keep.map((id) => [id, file[id]])), null, 1)}\n`);
  entries += keep.length;
}
const missing = [...wanted].filter((id) => {
  const t = tickerOfChunkId(id);
  if (!t) return true;
  const file = JSON.parse(readFileSync(join(adjacencyDir, `${t}.json`), 'utf8')) as Record<string, unknown>;
  return !(id in file);
});
copyFileSync(join(BUILD_DIR, iv, 'manifest.json'), join(ROOT, 'tests/fixtures/evidence', iv, 'manifest.json'));
console.log(`wrote ${entries} adjacency entries for ${tickers.size} companies to ${OUT}`);
if (missing.length) {
  console.error(`${missing.length} referenced chunks have no adjacency entry: ${missing.slice(0, 5).join(', ')}`);
  process.exit(1);
}

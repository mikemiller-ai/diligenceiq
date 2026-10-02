#!/usr/bin/env -S pnpm exec tsx
/**
 * Citation integrity over the real index build (Phase 6 exit criterion; no AWS, no model).
 * Reads the evidence the way the deployed api does (`createEvidenceStore` over the same
 * `processed/<iv>/` and `index/<iv>/adjacency/` keys, served from `.index/`) and checks:
 * 1. every chunk in `chunks.jsonl` is reproduced by the store (ID, section, offsets, text), so
 *    every citation the worker can make opens in the source view;
 * 2. every adjacency reference resolves to a chunk of the same section kind and form, in the
 *    filing it names, and every chunk has an adjacency entry;
 * 3. every citation in the seeded briefs (citations and context snapshots), in the recorded live
 *    briefs, and in every profile set (`.index/intelligence/<iv>/*` and the committed fixture set)
 *    resolves to its passage: same ID, exact span and text.
 *
 * "Recorded live briefs" are the Deep Analysis generations recorded by the live eval runs
 * (`pnpm eval:retrieval --generate --live`), committed as `evals/results/generation-<iv>-*.json`:
 * real Bedrock outputs, read from disk here (this check makes no model call). For each one, every
 * `citationIds` entry and every bracketed inline citation (`[AAPL-FY2025-10K-1A-004]`, the form the
 * web renders as a chip) must be a well-formed chunk ID that resolves, and every context chunk ID
 * must resolve. A bracketed token that looks like a citation but is not a chunk ID is a failure,
 * never skipped. Production analyses in DynamoDB are not covered (this check never reads AWS).
 *
 * Writes `evals/results/evidence-<iv>.json` and exits 1 on any failure. Free and offline.
 *
 *   pnpm evidence:check
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Citation, briefCitationIds, citationMatchesSource, tickerOfChunkId } from '@diligenceiq/core';
import { type Chunk, chunkSectionLabel } from '@diligenceiq/corpus';
import { buildDirEvidenceReader } from '../../services/api/src/evidence/local';
import { createEvidenceStore } from '../../services/api/src/evidence/store';
import { BUILD_DIR, INDEX_HOME, PROCESSED_DIR, ROOT } from '../lib/common';

const seed = JSON.parse(readFileSync(join(ROOT, 'seed/demo-workspace.json'), 'utf8')) as {
  indexVersion: string;
  analyses: Array<{ analysisId: string; brief?: unknown; citations: Citation[]; context: { passages: Array<Omit<Citation, 'indexVersion'>> } }>;
  findings?: Array<{ findingId?: string; citations?: Citation[] }>;
};
const iv = process.argv.find((a) => a.startsWith('--index='))?.slice(8) ?? seed.indexVersion;
const build = join(BUILD_DIR, iv);
if (!existsSync(join(build, 'chunks.jsonl'))) throw new Error(`no index build at ${build}; run pnpm index:build`);

const store = createEvidenceStore({
  indexVersion: iv,
  read: buildDirEvidenceReader({ processedDir: PROCESSED_DIR, adjacencyDir: join(build, 'adjacency'), manifestPath: join(build, 'manifest.json'), indexVersion: iv }),
});
const failures: string[] = [];
const fail = (msg: string) => {
  if (failures.length < 200) failures.push(msg);
  else if (failures.length === 200) failures.push('… more failures omitted');
};
const rid = 'evidence-check';

// 0. The api serves evidence only when the bundled chunker built this index (manifest guard).
if (!(await store.ready(rid))) fail(`index manifest ${iv}: missing, unreadable, or built by another chunker version; the api would answer index_unavailable`);

// 1. Every index chunk is reproduced.
const indexChunks = readFileSync(join(build, 'chunks.jsonl'), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Chunk);
const byDoc = new Map<string, Chunk[]>();
for (const c of indexChunks) byDoc.set(c.documentId, [...(byDoc.get(c.documentId) ?? []), c]);
const reproduced = new Map<string, Chunk>();
for (const [documentId, chunks] of byDoc) {
  const doc = await store.document(documentId, rid);
  if (!doc) {
    fail(`processed filing missing: ${documentId}`);
    continue;
  }
  const mine = new Map(doc.chunks.map((c) => [c.chunkId, c]));
  if (doc.chunks.length !== chunks.length) fail(`${documentId}: store has ${doc.chunks.length} chunks, index ${chunks.length}`);
  for (const c of chunks) {
    const r = mine.get(c.chunkId);
    if (!r) fail(`chunk not reproduced: ${c.chunkId}`);
    else if (r.charStart !== c.charStart || r.charEnd !== c.charEnd || r.text !== c.text || chunkSectionLabel(r) !== chunkSectionLabel(c)) fail(`chunk differs: ${c.chunkId}`);
    else reproduced.set(c.chunkId, r);
  }
}

// 2. Adjacency references.
const indexById = new Map(indexChunks.map((c) => [c.chunkId, c]));
let adjacencyRefs = 0;
let adjacencyEntries = 0;
const sides = ['previous', 'next', 'sameQuarterPriorYear'] as const;
type Side = { documentId: string; matches: Array<{ chunkId: string }> } | null;
for (const name of readdirSync(join(build, 'adjacency'))) {
  const file = JSON.parse(readFileSync(join(build, 'adjacency', name), 'utf8')) as Record<string, Record<(typeof sides)[number], Side>>;
  for (const [id, entry] of Object.entries(file)) {
    adjacencyEntries++;
    const self = indexById.get(id);
    if (!self) fail(`adjacency key not in the index: ${id}`);
    for (const s of sides) {
      for (const m of entry[s]?.matches ?? []) {
        adjacencyRefs++;
        const other = reproduced.get(m.chunkId);
        if (!other) fail(`adjacency ${id}.${s} → ${m.chunkId}: not resolvable`);
        else if (self && (other.sectionKind !== self.sectionKind || other.filingType !== self.filingType || other.documentId !== entry[s]?.documentId)) fail(`adjacency ${id}.${s} → ${m.chunkId}: different section, form or filing`);
      }
    }
  }
}
if (adjacencyEntries !== indexChunks.length) fail(`adjacency has ${adjacencyEntries} entries for ${indexChunks.length} chunks`);

// 3. Citations in seeded briefs, live briefs and profiles.
const counts: Record<string, number> = {};
const check = (where: string, c: Pick<Citation, 'chunkId' | 'documentId' | 'charStart' | 'charEnd' | 'text'> & { indexVersion?: string }) => {
  counts[where] = (counts[where] ?? 0) + 1;
  if (c.indexVersion && c.indexVersion !== iv) return fail(`${where}: ${c.chunkId} is from ${c.indexVersion}`);
  const r = reproduced.get(c.chunkId);
  if (!r) return fail(`${where}: ${c.chunkId} does not resolve`);
  if (r.documentId !== c.documentId || r.charStart !== c.charStart || r.charEnd !== c.charEnd || r.text !== c.text) fail(`${where}: ${c.chunkId} span or text differs from the source`);
};
const checkId = (where: string, id: string) => {
  counts[where] = (counts[where] ?? 0) + 1;
  if (!reproduced.has(id)) fail(`${where}: ${id} does not resolve`);
};

for (const a of seed.analyses) {
  for (const c of a.citations) check('seed brief citations', c);
  for (const c of a.context.passages) check('seed context passages', c);
}
for (const f of seed.findings ?? []) for (const c of f.citations ?? []) check('seed finding citations', c);

const liveRuns = readdirSync(join(ROOT, 'evals/results')).filter((n) => n.startsWith(`generation-${iv}-`) && n.endsWith('.json'));
for (const name of liveRuns) {
  const run = JSON.parse(readFileSync(join(ROOT, 'evals/results', name), 'utf8')) as { records: Array<{ id?: string; brief?: unknown; contextChunkIds?: string[] }> };
  for (const r of run.records) {
    const { ids, malformed } = briefCitationIds(r.brief ?? null);
    for (const id of malformed) fail(`live brief ${name} ${r.id ?? '?'}: "${id}" is cited but is not a chunk ID`);
    for (const id of ids) checkId('live brief citations', id);
    for (const id of r.contextChunkIds ?? []) checkId('live brief context', id);
  }
}

for (const a of seed.analyses) {
  const { ids, malformed } = briefCitationIds(a.brief ?? null);
  const cited = new Set(a.citations.map((c) => c.chunkId));
  for (const id of malformed) fail(`seed brief ${a.analysisId}: "${id}" is cited but is not a chunk ID`);
  for (const id of ids) if (!cited.has(id)) fail(`seed brief ${a.analysisId}: ${id} is cited in the brief but not in its citations`);
}

const setRoots = [join(INDEX_HOME, 'intelligence', iv), join(ROOT, 'tests/fixtures/profile-sets', iv)].filter(existsSync);
const setsChecked: string[] = [];
for (const root of setRoots) {
  for (const set of readdirSync(root)) {
    setsChecked.push(set);
    for (const name of readdirSync(join(root, set)).filter((n) => /^[A-Z]+\.json$/.test(n))) {
      const p = JSON.parse(readFileSync(join(root, set, name), 'utf8')) as { citations: Citation[] };
      for (const c of p.citations) {
        check(`profiles ${set}`, c);
        if (tickerOfChunkId(c.chunkId) !== c.ticker) fail(`profiles ${set}: ${c.chunkId} cited for ${c.ticker}`);
      }
    }
  }
}

// The api's own route output, spot-checked on one passage per filing: the span in the response text is the chunk text.
let spot = 0;
for (const documentId of byDoc.keys()) {
  const src = await store.source(documentId, rid);
  const first = src?.chunks[0];
  const chunk = first && reproduced.get(first.chunkId);
  if (!src || !first || !chunk || !citationMatchesSource({ ...first, text: chunk.text }, src.text)) fail(`source route: ${documentId} span mismatch`);
  spot++;
}

const result = {
  indexVersion: iv,
  checkedAt: new Date().toISOString(),
  chunks: { index: indexChunks.length, reproduced: reproduced.size, filings: byDoc.size },
  adjacency: { entries: adjacencyEntries, references: adjacencyRefs },
  citations: counts,
  liveBriefRuns: liveRuns,
  profileSets: setsChecked,
  sourceRouteSpotChecks: spot,
  failures,
  pass: failures.length === 0,
};
writeFileSync(join(ROOT, 'evals/results', `evidence-${iv}.json`), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, failures: failures.slice(0, 20) }, null, 2));
if (!result.pass) process.exit(1);

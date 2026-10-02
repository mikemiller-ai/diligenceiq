#!/usr/bin/env -S pnpm exec tsx
/**
 * Profile evaluation (testing-strategy §7; SPEC §32.9) over locally built sets. No model call,
 * no AWS. Reads `.index/intelligence/<indexVersion>/<set>/`, scores each profile against the
 * provisional bars in evals/profiles.yaml, and writes evals/results/profiles-<iv>-<set>.{md,json}.
 * For a model-written profile it recomputes the request (evidence and message) from the company's
 * deterministic profile in det-v<templateVersion> with the local index (BM25, no embedding), and
 * checks citations and figures against that; the tier is recomputed from the index's documents.
 *
 *   pnpm eval:profiles                    # every set built for the current index
 *   pnpm eval:profiles --set det-v2
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CompanyIntelligenceProfile } from '@diligenceiq/core';
import {
  PROVISIONAL_BARS,
  deterministicSetId,
  profileSuppliedIds,
  scoreProfile,
  selectProfileEvidence,
  summarizeProfiles,
  type ProfileScore,
  type ProfileSupplied,
} from '@diligenceiq/rag/profile';
import { INDEX_HOME, INGEST_REPORT, ROOT, arg, fail } from '../lib/common';
import { openIndex } from '../lib/retrieval';

const indexVersion = (JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as { indexVersion: string }).indexVersion;
const base = join(INDEX_HOME, 'intelligence', indexVersion);
if (!existsSync(base)) fail(`eval:profiles: no sets at ${base}; run pnpm intelligence:build first`);
const wanted = arg('set');
const sets = readdirSync(base).filter((s) => /^(llm|det)-v\d+$/.test(s) && (!wanted || s === wanted));
if (!sets.length) fail(`eval:profiles: no matching set in ${base}`);

// The bars file is the record; the code's provisional bars must match it.
const yaml = readFileSync(join(ROOT, 'evals', 'profiles.yaml'), 'utf8');
for (const [k, v] of Object.entries(PROVISIONAL_BARS)) {
  if (!new RegExp(`^\\s*${k}:\\s*${String(v).replace('.', '\\.')}\\s*(#.*)?$`, 'm').test(yaml)) fail(`evals/profiles.yaml: bar ${k} is not ${v}`);
}

const { index, retriever } = await openIndex({ indexVersion });
const ids = new Set(index.chunks.map((c) => c.chunkId));
const byId = new Map(index.chunks.map((c) => [c.chunkId, c]));
// 10-K and 10-Q documents per ticker in the index, for the tier check (independent of the profile's own counts).
const docs = new Map<string, { tenK: Set<string>; tenQ: Set<string> }>();
for (const c of index.chunks) {
  const d = docs.get(c.ticker) ?? { tenK: new Set<string>(), tenQ: new Set<string>() };
  (c.filingType === '10-K' ? d.tenK : d.tenQ).add(c.documentId);
  docs.set(c.ticker, d);
}
const detDir = join(base, deterministicSetId());
/** The request a model-written profile was checked against, recomputed from its deterministic profile. */
async function suppliedFor(ticker: string): Promise<ProfileSupplied> {
  const file = join(detDir, `${ticker}.json`);
  if (!existsSync(file)) fail(`eval:profiles: ${file} is missing; build ${deterministicSetId()} first (pnpm intelligence:build --max-calls 0)`);
  const det = JSON.parse(readFileSync(file, 'utf8')) as CompanyIntelligenceProfile;
  const ev = await selectProfileEvidence(det, (id) => byId.get(id), retriever);
  return { suppliedIds: profileSuppliedIds(det, ev.chunkIds), excerptIds: new Set(ev.chunkIds) };
}
const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const mark = (b: boolean | null) => (b === null ? '—' : b ? 'pass' : '**FAIL**');

for (const set of sets) {
  const dir = join(base, set);
  const scores: ProfileScore[] = [];
  for (const f of readdirSync(dir).filter((f) => /^[A-Z]{1,5}\.json$/.test(f)).sort()) {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as CompanyIntelligenceProfile;
    const d = docs.get(raw.ticker);
    scores.push(
      scoreProfile(raw, {
        indexChunkIds: ids,
        documents: { tenK: d?.tenK.size ?? 0, tenQ: d?.tenQ.size ?? 0 },
        ...(raw.generation?.mode === 'llm' ? { supplied: await suppliedFor(raw.ticker) } : {}),
      }),
    );
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as {
    builtAt: string;
    runId?: string;
    templateVersion?: string;
    validatorVersion?: string;
    companies: Array<{ ticker: string; failure?: string; issues?: string[]; promptVerified?: boolean; mode: string }>;
  };
  const unverified = manifest.companies.filter((c) => c.promptVerified === false).length;
  const summary = summarizeProfiles(scores, set.startsWith('llm-'));
  const out = join(ROOT, 'evals', 'results', `profiles-${indexVersion}-${set}`);
  writeFileSync(`${out}.json`, `${JSON.stringify({ indexVersion, set, builtAt: manifest.builtAt, runId: manifest.runId, bars: PROVISIONAL_BARS, summary, scores }, null, 1)}\n`);
  const failures = manifest.companies.filter((c) => c.failure);
  writeFileSync(
    `${out}.md`,
    [
      `# Profile eval — ${indexVersion}, ${set}`,
      '',
      `Built ${manifest.builtAt}${manifest.runId ? ` (run ${manifest.runId})` : ''}. ${summary.profiles} profiles, ${summary.llm} written by the model. Template version ${manifest.templateVersion ?? '?'}, validator version ${manifest.validatorVersion ?? '?'}. Bars: evals/profiles.yaml (provisional, SPEC §32.9).`,
      ...(unverified ? ['', `${unverified} stored outcomes carry no request hash (recorded before hashing existed), so their request could not be verified by hash; they were re-validated against the request recomputed now (promptVerified: false in the manifest).`] : []),
      '',
      '| Metric | Value | Bar | Result |',
      '|---|---|---|---|',
      `| Citation validity (index chunks of the company; model citations ⊂ the recomputed request) | ${pct(summary.citationValidity)} | 100% | ${mark(summary.passes.citationValidity)} |`,
      `| Figure match (FACTS, or a cited excerpt passage for model text; points only as points) | ${pct(summary.figureMatch)} | 100% | ${mark(summary.passes.figureMatch)} |`,
      `| Banned-phrase matches | ${summary.bannedPhrases} | 0 | ${mark(summary.passes.bannedPhrases)} |`,
      `| LLM-to-deterministic fallback, deep tier | ${pct(summary.deepTierFallbackRate)} | ≤ ${pct(PROVISIONAL_BARS.deepTierFallbackRate)} | ${mark(summary.passes.deepTierFallbackRate)} |`,
      `| Coverage-tier correctness | ${pct(summary.tierCorrectness)} | 100% | ${mark(summary.passes.tierCorrectness)} |`,
      `| Generation calls per profile (max) | ${summary.maxCallsPerProfile} | ≤ 1 | ${mark(summary.passes.maxCallsPerProfile)} |`,
      `| Schema-valid / integrity-clean | ${summary.schemaValid} / ${summary.integrityClean} of ${summary.profiles} | all | ${mark(summary.schemaValid === summary.profiles && summary.integrityClean === summary.profiles)} |`,
      '',
      'Signal precision and recall are measured by `pnpm eval:signals` (signals-<iv>.md); the profiles use only the detectors that passed it.',
      '',
      ...(failures.length ? ['## Fallbacks', '', ...failures.map((c) => `- ${c.ticker}: ${c.failure}${c.issues?.length ? ` — ${c.issues.slice(0, 2).join('; ')}` : ''}`), ''] : []),
      ...(scores.some((s) => s.citations.invalid.length || s.figures.unmatched.length || s.banned.length || s.integrityIssues.length)
        ? ['## Problems', '', ...scores.flatMap((s) => [...s.citations.invalid, ...s.figures.unmatched, ...s.banned, ...s.integrityIssues].map((x) => `- ${s.ticker}: ${x}`)), '']
        : []),
    ].join('\n'),
  );
  console.log(`eval:profiles ${set}: ${summary.profiles} profiles · citations ${pct(summary.citationValidity)} · figures ${pct(summary.figureMatch)} · banned ${summary.bannedPhrases} · deep fallback ${pct(summary.deepTierFallbackRate)} → ${out}.md`);
}

/**
 * Builds `seed/demo-workspace.json` (SPEC §40; architecture §8) from REAL pipeline output, with
 * no live spend: each seeded analysis is an eval question whose Deep Analysis generation was
 * recorded live (`pnpm eval:retrieval --generate --live`, approved runs), replayed here through
 * the same `runDeepAnalysis` pipeline and deterministic validator over the same index. A
 * question whose generation is not recorded fails the build; nothing is ever called live.
 *
 * Seeded findings name a source only; the api copies their text and citations server-side,
 * exactly as POST /api/findings does. Run: `pnpm seed:build` (needs `.index/` and the caches).
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEEP_ANALYSIS_PROMPT_VERSION, GenerationGateway, runDeepAnalysis } from '@diligenceiq/rag';
import { parse as parseYaml } from 'yaml';
import { CACHE_DIR, ROOT, fail } from '../lib/common';
import { createRecordedGenerationClient, requestKey } from '../lib/generation';
import { createQueryEmbedder } from '../lib/query-embed';
import { openIndex } from '../lib/retrieval';

const SEED_VERSION = 'seed-v1';
/** Eval question IDs to seed (listed newest first by their recording time). Chosen to show a single company over time, a comparison, and a trend with figures. */
const SEED_QUESTIONS = ['pdf-2', 'multi-cloud', 'expert-1'];
/** Context snapshots stay under DynamoDB's 400 KB item limit (architecture §8: ≤ 350 KB guard). */
const MAX_CONTEXT_BYTES = 350_000;

const questions = (parseYaml(readFileSync(join(ROOT, 'evals/questions.yaml'), 'utf8')) as { questions: Array<{ id: string; question: string }> }).questions;
const { retriever, index } = await openIndex();
const indexVersion = index.manifest.indexVersion;
const embedder = createQueryEmbedder({ live: false });
const { client, stats } = createRecordedGenerationClient({ live: false, promptVersion: DEEP_ANALYSIS_PROMPT_VERSION });
const recordingsDir = join(CACHE_DIR, 'generations', DEEP_ANALYSIS_PROMPT_VERSION);

/** When the recorded generation was made (the file's recordedAt), so the seed carries the real run time. */
function recordedAt(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of readdirSync(recordingsDir)) {
    const rec = JSON.parse(readFileSync(join(recordingsDir, f), 'utf8')) as { recordedAt?: string };
    out.set(f.replace(/\.json$/, ''), rec.recordedAt ?? new Date(statSync(join(recordingsDir, f)).mtimeMs).toISOString());
  }
  return out;
}
const times = recordedAt();

const analyses: Array<Record<string, unknown> & { analysisId: string }> = [];
for (const id of SEED_QUESTIONS) {
  const q = questions.find((x) => x.id === id) ?? fail(`unknown eval question ${id}`);
  const vector = await embedder.embed(q.question);
  let key = '';
  const gateway = new GenerationGateway({
    purpose: 'analysis',
    client: {
      modelId: client.modelId,
      async generate(request) {
        key = requestKey(client.modelId, request);
        return client.generate(request);
      },
    },
    beforeCall: async () => {},
  });
  const outcome = await runDeepAnalysis(
    { question: q.question, requestId: `seed-${id}`, analysisId: `seed-${id}` },
    { retriever, indexVersion, embedQuery: async () => vector, gateway, onStage: async () => {}, remainingMs: () => Number.MAX_SAFE_INTEGER },
  );
  if (outcome.status !== 'COMPLETE') fail(`${id}: ${outcome.status} ${'code' in outcome ? outcome.code : ''} ${'detail' in outcome ? outcome.detail ?? '' : ''}`);
  const at = times.get(key) ?? fail(`${id}: recording ${key.slice(0, 12)} has no time`);
  const { snapshot, ...result } = outcome.output;
  const context = { indexVersion, passages: snapshot };
  const bytes = Buffer.byteLength(JSON.stringify(context));
  if (bytes > MAX_CONTEXT_BYTES) fail(`${id}: context snapshot ${bytes} bytes exceeds ${MAX_CONTEXT_BYTES}`);
  // Time-ordered ID from the real run time, as the api's newAnalysisId builds them.
  const analysisId = `${Date.parse(at).toString(36).padStart(9, '0')}seed${id.replace(/[^a-z0-9]/g, '').slice(0, 12)}`;
  // A replay measures nothing: the recording carries no timings, so every duration is 0 and the
  // telemetry says `replayed` (architecture §8). It names the seed record's own analysis ID.
  const telemetry = {
    ...result.telemetry,
    analysisId,
    replayed: true,
    retrievalDurationMs: 0,
    generationDurationMs: 0,
    totalDurationMs: 0,
    ...('embeddingDurationMs' in result.telemetry ? { embeddingDurationMs: 0 } : {}),
    ...('indexLoadMs' in result.telemetry ? { indexLoadMs: 0 } : {}),
    ...('generationFirstTokenMs' in result.telemetry ? { generationFirstTokenMs: null } : {}),
  };
  analyses.push({ analysisId, question: q.question, origin: { kind: 'direct' }, createdAt: at, completedAt: at, ...result, telemetry, context });
  console.log(`  ${id}: COMPLETE, ${snapshot.length} passages (${Math.round(bytes / 1024)} KB), ${result.validation.numeric.verified}/${result.validation.numeric.total} figures verified, recorded ${at}`);
}
embedder.close();
if (stats.liveCalls !== 0) fail('a live call was made; the seed must be replay-only');

const byQuestion = (id: string) => analyses[SEED_QUESTIONS.indexOf(id)]!;

/**
 * The seeded findings, each chosen by its text rather than a bare index, so a reseed under a new
 * prompt version fails loudly instead of quietly saving whatever item now sits at that index.
 * Each must be a substantive claim (UX review item 5: a "Reporting period" row of fiscal-year end
 * dates was once seeded) with every figure in it verified against its cited passage and no period,
 * arithmetic, attribution or sweeping claim flagged on it (`validation.periodClaims`,
 * `arithmeticClaims`, `attributionClaims`, `scopeClaims`; evaluation.md §12, §13). Each was also
 * read against its cited chunk text by hand: evals/results/seed-verification-2026-10-03.md.
 */
type SeedItemKind = 'keyFinding' | 'comparisonRow';
const SEED_FINDINGS: Array<{ question: string; kind: SeedItemKind; match: RegExp; theme: string; status: string }> = [
  // da-v4: the DMA key finding is not seeded: it dates the DMA fines and "many risks will remain" to FY2025,
  // but AAPL-FY2024-10K-1A-017 already states both (evaluation.md §8). The Google row cites every period it describes.
  { question: 'expert-1', kind: 'comparisonRow', match: /\bGoogle\b/, theme: 'regulatory-compliance', status: 'NEEDS_FOLLOW_UP' },
  { question: 'expert-1', kind: 'keyFinding', match: /antitrust .*smartphone|smartphone .*antitrust/i, theme: 'regulatory-compliance', status: 'ACTIVE' },
  { question: 'multi-cloud', kind: 'comparisonRow', match: /revenue growth/i, theme: 'growth-outlook', status: 'ACTIVE' },
  { question: 'pdf-2', kind: 'keyFinding', match: /gross margin/i, theme: 'financial-performance', status: 'ACTIVE' },
];

type SeedBrief = { keyFindings: Array<{ title: string; finding: string }>; comparison?: { rows: Array<{ label: string }> } };
type SeedValidation = {
  numeric: { figures: Array<{ location: string; verified: boolean }> };
  periodClaims?: Array<{ location: string; periods: string[] }>;
  arithmeticClaims?: Array<{ location: string; stated: string; computed: string }>;
  attributionClaims?: Array<{ location: string; companies: string[] }>;
  scopeClaims?: Array<{ location: string; cue: string }>;
};
function seedItem(spec: (typeof SEED_FINDINGS)[number]): { kind: SeedItemKind; analysisId: string; index: number } {
  const a = byQuestion(spec.question) as unknown as { analysisId: string; brief: SeedBrief; validation: SeedValidation };
  const texts = spec.kind === 'keyFinding' ? a.brief.keyFindings.map((k) => `${k.title} ${k.finding}`) : (a.brief.comparison?.rows ?? []).map((r) => r.label);
  const hits = texts.flatMap((t, i) => (spec.match.test(t) ? [i] : []));
  if (hits.length !== 1) fail(`${spec.question}: ${hits.length} ${spec.kind} items match ${spec.match} (need exactly one): ${texts.map((t) => t.slice(0, 60)).join(' | ')}`);
  const index = hits[0]!;
  const prefix = spec.kind === 'keyFinding' ? `keyFindings[${index}].` : `comparison.rows[${index}].`;
  const unverified = a.validation.numeric.figures.filter((f) => f.location.startsWith(prefix) && !f.verified);
  if (unverified.length) fail(`${spec.question} ${prefix}: ${unverified.length} unverified figure(s); a seeded finding must have every figure verified`);
  const periodClaims = (a.validation.periodClaims ?? []).filter((p) => p.location.startsWith(prefix));
  if (periodClaims.length) fail(`${spec.question} ${prefix}: ${periodClaims.length} period claim(s) not cited (${periodClaims.map((p) => p.periods.join('/')).join(', ')}); a seeded finding must have none`);
  // The claim checks of 2026-10-03: a seeded finding carries none of their flags either.
  const at = <T extends { location: string }>(xs: readonly T[] | undefined) => (xs ?? []).filter((x) => x.location.startsWith(prefix));
  const arithmetic = at(a.validation.arithmeticClaims);
  if (arithmetic.length) fail(`${spec.question} ${prefix}: ${arithmetic.length} change(s) that do not add up (${arithmetic.map((c) => `${c.stated} vs ${c.computed}`).join(', ')}); a seeded finding must have none`);
  const attribution = at(a.validation.attributionClaims);
  if (attribution.length) fail(`${spec.question} ${prefix}: names ${attribution.flatMap((c) => c.companies).join(', ')} with no citation from them; a seeded finding must have none`);
  const scope = at(a.validation.scopeClaims);
  if (scope.length) fail(`${spec.question} ${prefix}: sweeping claim(s) (${scope.map((c) => `"${c.cue}"`).join(', ')}) wider than their citations; a seeded finding must have none`);
  return { kind: spec.kind, analysisId: a.analysisId, index };
}

const seed = {
  seedVersion: SEED_VERSION,
  provenance: `Real Deep Analysis output: eval questions ${SEED_QUESTIONS.join(', ')} under prompt ${DEEP_ANALYSIS_PROMPT_VERSION} and model ${client.modelId}, each recorded from one live generation call and replayed through the pipeline and validator over index ${indexVersion}. Run times are the recording times. A replay measures no durations: they are 0 and the telemetry is marked replayed; the UI shows none.`,
  builtAt: new Date().toISOString(),
  indexVersion,
  promptVersion: DEEP_ANALYSIS_PROMPT_VERSION,
  analyses,
  findings: SEED_FINDINGS.map((f) => ({ source: seedItem(f), theme: f.theme, status: f.status })),
};
const out = join(ROOT, 'seed/demo-workspace.json');
writeFileSync(out, `${JSON.stringify(seed)}\n`);
console.log(`build-seed: ${analyses.length} analyses, ${seed.findings.length} findings → seed/demo-workspace.json (${Math.round(Buffer.byteLength(JSON.stringify(seed)) / 1024)} KB); bedrock ${stats.replayed} replayed, 0 live`);

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
const seed = {
  seedVersion: SEED_VERSION,
  provenance: `Real Deep Analysis output: eval questions ${SEED_QUESTIONS.join(', ')} under prompt ${DEEP_ANALYSIS_PROMPT_VERSION} and model ${client.modelId}, each recorded from one live generation call and replayed through the pipeline and validator over index ${indexVersion}. Run times are the recording times. A replay measures no durations: they are 0 and the telemetry is marked replayed; the UI shows none.`,
  builtAt: new Date().toISOString(),
  indexVersion,
  promptVersion: DEEP_ANALYSIS_PROMPT_VERSION,
  analyses,
  findings: [
    { source: { kind: 'keyFinding', analysisId: byQuestion('expert-1').analysisId, index: 0 }, theme: 'regulatory-compliance', status: 'NEEDS_FOLLOW_UP' },
    { source: { kind: 'keyFinding', analysisId: byQuestion('expert-1').analysisId, index: 1 }, theme: 'regulatory-compliance', status: 'ACTIVE' },
    { source: { kind: 'comparisonRow', analysisId: byQuestion('multi-cloud').analysisId, index: 0 }, theme: 'growth-outlook', status: 'ACTIVE' },
    { source: { kind: 'keyFinding', analysisId: byQuestion('pdf-2').analysisId, index: 0 }, theme: 'financial-performance', status: 'ACTIVE' },
  ],
};
const out = join(ROOT, 'seed/demo-workspace.json');
writeFileSync(out, `${JSON.stringify(seed)}\n`);
console.log(`build-seed: ${analyses.length} analyses, ${seed.findings.length} findings → seed/demo-workspace.json (${Math.round(Buffer.byteLength(JSON.stringify(seed)) / 1024)} KB); bedrock ${stats.replayed} replayed, 0 live`);

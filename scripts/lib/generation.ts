/**
 * Generation for the offline eval harness (SPEC §41.2). Every live response is recorded in
 * `.index/cache/generations/<promptVersion>/<sha256>.json`, keyed by the exact request (model,
 * system prompt, user message with its context, tool, settings), so re-scoring a run costs
 * nothing. A changed prompt or context is a new key.
 *
 * Spend rule: a live Bedrock call happens only with `live: true` (the CLI's `--live`, run after
 * Mike's go-ahead). Otherwise a request missing from the recordings is an error, never a silent
 * call. The client is built with maxAttempts 1 and makes one request per `generate`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BedrockGenerationClient,
  DEFAULT_GENERATION_MODEL_ID,
  type GenerationClient,
  type GenerationRequest,
  type GenerationResponse,
  type GenerationScore,
  type GenerationSummary,
  createBedrockRuntime,
} from '@diligenceiq/rag';
import { AWS_REGION, CACHE_DIR, ensureDir } from './common';

export const GENERATION_MODEL_ID = process.env.GENERATION_MODEL_ID ?? DEFAULT_GENERATION_MODEL_ID;

export class NotRecordedError extends Error {
  constructor(key: string) {
    super(`no recorded generation ${key.slice(0, 12)}; rerun with --generate --live (one Bedrock call, about $0.10)`);
    this.name = 'NotRecordedError';
  }
}

export function requestKey(modelId: string, r: GenerationRequest): string {
  return createHash('sha256').update(JSON.stringify([modelId, r.system, r.user, r.tool, r.temperature, r.maxTokens])).digest('hex');
}

export function createRecordedGenerationClient(options: { live: boolean; promptVersion: string; modelId?: string }) {
  const modelId = options.modelId ?? GENERATION_MODEL_ID;
  const dir = ensureDir(join(CACHE_DIR, 'generations', options.promptVersion));
  const live = options.live ? new BedrockGenerationClient(createBedrockRuntime(AWS_REGION), modelId) : null;
  const stats = { replayed: 0, liveCalls: 0, liveInputTokens: 0, liveOutputTokens: 0, errors: 0 };
  const client: GenerationClient = {
    modelId,
    async generate(request) {
      const key = requestKey(modelId, request);
      const path = join(dir, `${key}.json`);
      if (existsSync(path)) {
        stats.replayed++;
        const rec = JSON.parse(readFileSync(path, 'utf8')) as { response?: GenerationResponse; error?: { name: string; message: string } };
        if (rec.error) throw Object.assign(new Error(rec.error.message), { name: rec.error.name });
        return rec.response!;
      }
      if (!live) throw new NotRecordedError(key);
      stats.liveCalls++;
      try {
        const response = await live.generate(request);
        stats.liveInputTokens += response.inputTokens;
        stats.liveOutputTokens += response.outputTokens;
        writeFileSync(path, `${JSON.stringify({ recordedAt: new Date().toISOString(), modelId, response }, null, 1)}\n`);
        return response;
      } catch (err) {
        // A failed call is recorded too: it was spent, and replay must not call again.
        stats.errors++;
        const e = err as Error;
        writeFileSync(path, `${JSON.stringify({ recordedAt: new Date().toISOString(), modelId, error: { name: e.name, message: e.message } }, null, 1)}\n`);
        throw err;
      }
    },
  };
  return { client, stats };
}

/** The generation results report (`evals/results/generation-<indexVersion>-<promptVersion>.md`), shared by the eval CLI and the re-score tool. */
export function renderGenerationReport(r: { indexVersion: string; promptVersion: string; provenance: string[]; summary: GenerationSummary; scores: readonly GenerationScore[]; notRecorded: readonly string[] }): string {
  const sum = r.summary;
  const tally = (t: { passed: number; total: number }) => (t.total ? `${t.passed}/${t.total}` : 'n/a');
  const claims = (c: { claims: number; briefs: number } | undefined) => (c ? `${c.claims} in ${c.briefs} briefs` : 'not checked');
  return [
    `# Generation eval — ${r.indexVersion}, prompt ${r.promptVersion}`,
    '',
    ...r.provenance,
    '',
    '| Metric | Result |',
    '|---|---|',
    `| Questions passing every check | ${sum.passed}/${sum.questions} |`,
    `| Schema-valid briefs | ${sum.completed}/${sum.questions} |`,
    `| Generation calls per question | ${[...new Set(sum.callsPerQuestion)].join(', ')} (every question) |`,
    `| Citation validity before validation (model's IDs in the context) | ${sum.citationValidityPre} |`,
    `| Citation validity after validation (re-check; validation removes the rest) | ${sum.citationValidityPost} |`,
    `| Numeric grounding (figures found in cited passages) | ${sum.numericGrounding ?? 'n/a'} (${sum.figuresVerified}/${sum.figuresTotal}) |`,
    `| Unverified near matches (digits in a table cell; passage states no unit) | ${sum.figuresUnitUnstated} |`,
    `| Briefs with every figure verified | ${sum.briefsFullyGrounded}/${sum.completed} |`,
    `| Period claims flagged (new or absent in a period none of the claim's citations is from; reported, not a check) | ${sum.periodClaims ? `${sum.periodClaims.claims} in ${sum.periodClaims.briefs} briefs` : 'not checked'} |`,
    `| Arithmetic claims flagged (a stated change its own two values do not give; reported, not a check) | ${claims(sum.arithmeticClaims)} |`,
    `| Company attribution flagged (an item saying something positive about a company none of its citations is from; reported, not a check) | ${claims(sum.attributionClaims)} |`,
    `| Sweeping claims flagged (all N / every / both companies, with citations from fewer companies; reported, not a check) | ${claims(sum.scopeClaims)} |`,
    `| Comparison tables aligned (one value per column in every row) | ${tally(sum.comparisonAligned)} |`,
    `| Abstention | ${tally(sum.abstention)} |`,
    `| Follow-ups answerable (abstention questions) | ${tally(sum.followUpsAnswerable)} |`,
    `| Injection resistance | ${tally(sum.injection)} |`,
    `| Brief coverage (every expected company cited) | ${tally(sum.briefCoverage)} |`,
    `| Generation latency p50 / max (recorded responses) | ${sum.latencyMs.generationP50} / ${sum.latencyMs.generationMax} ms (first token p50 ${sum.latencyMs.firstTokenP50 ?? 'n/a'} ms) |`,
    `| Pipeline total p50 / max (local, excl. index load) | ${sum.latencyMs.totalP50 === null ? 'not measured (responses replayed or re-scored; see generation latency)' : `${sum.latencyMs.totalP50} / ${sum.latencyMs.totalMax} ms`} |`,
    `| Tokens per question (mean) | ${sum.tokens.inputMean} in / ${sum.tokens.outputMean} out |`,
    `| Estimated cost, all questions | $${sum.costUsd} |`,
    ...(r.notRecorded.length ? ['', `Not run (no recorded response): ${r.notRecorded.join(', ')}.`] : []),
    '',
    '## Per question',
    '',
    '| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Period claims | Arithmetic / attribution / sweeping | Tokens in / out | Generation ms | Failed checks |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...r.scores.map(
      (s) =>
        `| \`${s.id}\` | ${s.pass ? 'pass' : 'fail'} | ${s.answerType ?? s.code ?? s.status} | ${s.citations.valid}/${s.citations.returned} | ${s.figures.verified}/${s.figures.total}${s.figures.unitUnstated ? ` (${s.figures.unitUnstated})` : ''} | ${s.periodClaims ?? '—'} | ${s.arithmeticClaims === undefined ? '—' : `${s.arithmeticClaims} / ${s.attributionClaims ?? 0} / ${s.scopeClaims ?? 0}`} | ${s.inputTokens} / ${s.outputTokens} | ${s.generationMs} | ${s.checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail.replace(/\|/g, '/')}`).join('; ') || '—'} |`,
    ),
    '',
  ].join('\n');
}

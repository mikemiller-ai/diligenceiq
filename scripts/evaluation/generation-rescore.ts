#!/usr/bin/env -S pnpm exec tsx
/**
 * Re-score recorded generation runs with the current validator and checks (SPEC §41.2), with no
 * model call and no AWS. For each `evals/results/generation-<indexVersion>-<promptVersion>.json`:
 * - the raw tool input of every recorded response (`.index/cache/generations/<promptVersion>/`)
 *   is matched to its question by brief title and output tokens;
 * - it goes through the current `repairBrief` and `validateBrief` against the question's stored
 *   context passages (text from `.index/build/<indexVersion>/chunks.jsonl`), with the same
 *   preceding-text lookup the worker passes (`precedingFilingText` over the same chunks, as
 *   `Retriever.precedingText` does), then `scoreGeneration`;
 * - the file's summary, scores, briefs and validation blocks are rewritten. The recorded
 *   telemetry is kept (generation latency, first token, tokens, cost, from the original run);
 *   pipeline totals are kept only when the original run measured them (a live run), since a
 *   re-score measures no latency (otherwise `totalP50: null`).
 *
 * This is how v1 and v2, whose prompts are no longer the runtime prompt, are scored by the same
 * validator as the shipped version. Exit 1 if a recorded response cannot be matched.
 *
 * `--set robustness` (Phase 7) re-scores `generation-<iv>-<pv>-robustness.json` against
 * `evals/robustness.yaml` instead. A planted passage (its `plant.id`, or `PLANTED-<ticker>-001`;
 * never an index chunk) is rebuilt as the eval built it (`plantedChunk` over the first context chunk
 * of its ticker and period, and the question's `plant.text`; scripts/evaluation/retrieval-eval.ts).
 * Its position needs no rebuild: the recorded context order already holds it.
 *
 *   pnpm eval:generation:rescore                    # every generation-*.json for the built index
 *   pnpm eval:generation:rescore --prompt da-v3     # one prompt version
 *   pnpm eval:generation:rescore --set robustness   # the robustness results (evals/robustness.yaml)
 */
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AnalysisTelemetry } from '@diligenceiq/core';
import { parse } from 'yaml';
import {
  type ChunkRecord,
  EvalFileSchema,
  type GenerationResponse,
  type GenerationScore,
  PLANTED_ID_PREFIX,
  type PipelineOutcome,
  RobustnessFileSchema,
  type SnapshotEntry,
  plantedChunk,
  precedingFilingText,
  repairBrief,
  scoreGeneration,
  summarizeGeneration,
  toCitations,
  validateBrief,
} from '@diligenceiq/rag';
import { BUILD_DIR, CACHE_DIR, ROOT, arg, fail } from '../lib/common';
import { renderGenerationReport } from '../lib/generation';

interface StoredRecord {
  id: string;
  question: string;
  score: GenerationScore;
  brief: { title: string } | null;
  validation: unknown;
  interpretation: unknown;
  contextChunkIds: string[];
}
interface StoredFile {
  indexVersion: string;
  promptVersion: string;
  modelId: string;
  ranAt: string;
  summary: unknown;
  notRecorded: string[];
  records: StoredRecord[];
}

const outDir = join(ROOT, 'evals', 'results');
const only = arg('prompt') && arg('prompt') !== 'true' ? arg('prompt') : null;
const setArg = arg('set');
if (setArg && setArg !== 'robustness') fail(`--set: unknown set ${setArg} (only "robustness")`);
const robustness = setArg === 'robustness';
const suffix = robustness ? '-robustness' : '';
const files = readdirSync(outDir).filter((f) => new RegExp(String.raw`^generation-.+-da-v\d+${suffix}\.json$`).test(f) && (!only || f.endsWith(`-${only}${suffix}.json`)));
if (!files.length) fail(`no generation${suffix} results in evals/results${only ? ` for ${only}` : ''}`);
const questionFile = robustness
  ? RobustnessFileSchema.parse(parse(readFileSync(join(ROOT, 'evals', 'robustness.yaml'), 'utf8')))
  : EvalFileSchema.parse(parse(readFileSync(join(ROOT, 'evals', 'questions.yaml'), 'utf8')));
const questions = new Map(questionFile.questions.map((q) => [q.id, q]));

/**
 * Snapshot entries for the given chunk IDs, read from the built index's chunks.jsonl, and the
 * preceding-text lookup over every chunk in index order (the worker's `Retriever.precedingText`).
 */
async function loadChunks(indexVersion: string, ids: ReadonlySet<string>): Promise<{ snapshot: Map<string, SnapshotEntry>; records: Map<string, ChunkRecord>; precedingText: (chunkId: string) => string | null }> {
  const path = join(BUILD_DIR, indexVersion, 'chunks.jsonl');
  if (!existsSync(path)) fail(`${path} not found (pnpm index:build)`);
  const out = new Map<string, SnapshotEntry>();
  const records = new Map<string, ChunkRecord>();
  const all: ChunkRecord[] = [];
  const at = new Map<string, number>();
  for await (const line of createInterface({ input: createReadStream(path) })) {
    if (!line) continue;
    const c = JSON.parse(line) as ChunkRecord;
    at.set(c.chunkId, all.length);
    all.push(c);
    if (!ids.has(c.chunkId)) continue;
    records.set(c.chunkId, c);
    out.set(c.chunkId, entryOf(c));
  }
  const precedingText = (chunkId: string): string | null => {
    const i = at.get(chunkId);
    return i === undefined ? null : precedingFilingText(all[i]!, (x) => {
      const j = at.get(x.chunkId);
      return j ? all[j - 1] : undefined;
    });
  };
  return { snapshot: out, records, precedingText };
}

const entryOf = (c: ChunkRecord): SnapshotEntry => ({ chunkId: c.chunkId, documentId: c.documentId, ticker: c.ticker, company: c.company, filingType: c.filingType, filingDate: c.filingDate, periodEnd: c.periodEnd, fiscalLabel: c.fiscalLabel, section: c.section, subsection: c.subsection, charStart: c.charStart, charEnd: c.charEnd, text: c.text, laneId: '', score: 0 });

for (const name of files) {
  const stored = JSON.parse(readFileSync(join(outDir, name), 'utf8')) as StoredFile;
  const recDir = join(CACHE_DIR, 'generations', stored.promptVersion);
  if (!existsSync(recDir)) fail(`${recDir} not found: no recorded responses for ${stored.promptVersion}`);
  const recorded = readdirSync(recDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(join(recDir, f), 'utf8')) as { response?: GenerationResponse }).response)
    .filter((r): r is GenerationResponse => !!r);
  const { snapshot: chunks, records: chunkRecords, precedingText } = await loadChunks(stored.indexVersion, new Set(stored.records.flatMap((r) => r.contextChunkIds)));

  const scores: GenerationScore[] = [];
  const records: StoredRecord[] = [];
  for (const rec of stored.records) {
    const q = questions.get(rec.id);
    if (!q) fail(`${name}: question ${rec.id} is not in evals/${robustness ? 'robustness' : 'questions'}.yaml`);
    if (!rec.brief) {
      // No brief to re-validate (a failed or skipped analysis): the stored score stands.
      scores.push(rec.score);
      records.push(rec);
      continue;
    }
    const matches = recorded.filter((r) => r.outputTokens === rec.score.outputTokens && r.inputTokens === rec.score.inputTokens && (() => {
      const b = repairBrief(r.toolInput);
      return b.ok && b.brief.title === rec.brief!.title;
    })());
    if (matches.length !== 1) fail(`${name}: ${rec.id}: ${matches.length} recorded responses match (title and tokens); expected exactly 1`);
    const gen = matches[0]!;
    const planted = (id: string): SnapshotEntry | undefined => {
      const plant = q.plant;
      if (!plant || id !== (plant.id ?? `${PLANTED_ID_PREFIX}${plant.ticker}-001`)) return undefined;
      // As the eval built it: the first context chunk of the plant's ticker (and period) lends its filing metadata.
      const template = rec.contextChunkIds.map((c) => chunkRecords.get(c)).find((c) => c?.ticker === plant.ticker && (!plant.period || c.fiscalLabel === plant.period));
      return template ? { ...entryOf(plantedChunk(template, plant.text, plant.id)), laneId: 'planted' } : undefined;
    };
    const snapshot = rec.contextChunkIds.map((id) => chunks.get(id) ?? planted(id) ?? fail(`${name}: ${rec.id}: context chunk ${id} not in ${stored.indexVersion}`));
    const repaired = repairBrief(gen.toolInput);
    if (!repaired.ok) fail(`${name}: ${rec.id}: the recorded response no longer passes repair: ${repaired.issues.join('; ')}`);
    const { brief, validation, citedChunkIds } = validateBrief(repaired.brief, repaired.repairs, new Map(snapshot.map((e) => [e.chunkId, e.text])), precedingText);
    const s = rec.score;
    // The original run's telemetry, as recorded; totalDurationMs is not a re-score measurement.
    const telemetry = {
      generationCallCount: s.generationCallCount,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      generationDurationMs: s.generationMs,
      generationFirstTokenMs: s.firstTokenMs ?? undefined,
      totalDurationMs: s.totalMs,
      stopReason: s.stopReason ?? undefined,
      estimatedCostUsd: s.costUsd,
    } as AnalysisTelemetry;
    const outcome = {
      status: 'COMPLETE',
      output: { interpretation: rec.interpretation, coverage: { cells: [] }, brief, citations: toCitations(snapshot, citedChunkIds, stored.indexVersion), validation, snapshot, telemetry },
    } as PipelineOutcome;
    const score = scoreGeneration(q, outcome, new Set(rec.contextChunkIds));
    scores.push(score);
    records.push({ ...rec, score, brief, validation });
    const failed = score.checks.filter((c) => !c.pass);
    console.log(`  ${score.pass ? 'PASS' : 'FAIL'} ${rec.id}: figures ${score.figures.verified}/${score.figures.total}${score.figures.unitUnstated ? ` (${score.figures.unitUnstated} near)` : ''}${score.periodClaims ? `; ${score.periodClaims} period claim(s): ${(validation.periodClaims ?? []).map((c) => `${c.location} ${c.periods.join('/')} "${c.cue}"`).join(', ')}` : ''}${failed.length ? ` — ${failed.map((c) => c.name).join(', ')}` : ''}`);
  }

  const summary = summarizeGeneration(scores, { totalsMeasured: (stored.summary as { latencyMs?: { totalP50?: number | null } }).latencyMs?.totalP50 != null });
  const rescoredAt = new Date().toISOString();
  const rescore = { rescoredAt, by: 'pnpm eval:generation:rescore', note: 'Recorded responses re-validated and re-scored with the current validator and checks; no model call. Telemetry (generation latency, tokens, cost) is from the original run.' };
  writeFileSync(join(outDir, name), `${JSON.stringify({ ...stored, rescore, summary, records }, null, 1)}\n`);
  const md = renderGenerationReport({
    indexVersion: stored.indexVersion,
    promptVersion: stored.promptVersion,
    provenance: [
      `Generated on ${new Date(stored.ranAt).toLocaleDateString('en-CA')} (local) by \`pnpm eval:retrieval${robustness ? ' --set robustness' : ''} --generate\`, model \`${stored.modelId}\`, temperature 0.2, forced tool \`submit_diligence_brief\`, one generation request per question. Re-scored on ${new Date(rescoredAt).toLocaleDateString('en-CA')} by \`pnpm eval:generation:rescore${robustness ? ' --set robustness' : ''}\`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).`,
    ],
    summary,
    scores,
    notRecorded: stored.notRecorded,
  });
  writeFileSync(join(outDir, name.replace(/\.json$/, '.md')), md);
  console.log(
    `${name}: ${summary.passed}/${summary.questions} pass; numeric grounding ${summary.numericGrounding} (${summary.figuresVerified}/${summary.figuresTotal}, ${summary.figuresUnitUnstated} near matches); every figure verified in ${summary.briefsFullyGrounded}/${summary.completed}; period claims ${summary.periodClaims.claims} in ${summary.periodClaims.briefs} briefs; comparisons aligned ${summary.comparisonAligned.passed}/${summary.comparisonAligned.total}; abstention ${summary.abstention.passed}/${summary.abstention.total}; follow-ups answerable ${summary.followUpsAnswerable.passed}/${summary.followUpsAnswerable.total}; injection ${summary.injection.passed}/${summary.injection.total}; coverage ${summary.briefCoverage.passed}/${summary.briefCoverage.total}; citation validity ${summary.citationValidityPre} → ${summary.citationValidityPost}`,
  );
}

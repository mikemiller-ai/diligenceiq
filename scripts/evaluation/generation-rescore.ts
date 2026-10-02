#!/usr/bin/env -S pnpm exec tsx
/**
 * Re-score recorded generation runs with the current validator and checks (SPEC §41.2), with no
 * model call and no AWS. For each `evals/results/generation-<indexVersion>-<promptVersion>.json`:
 * - the raw tool input of every recorded response (`.index/cache/generations/<promptVersion>/`)
 *   is matched to its question by brief title and output tokens;
 * - it goes through the current `repairBrief` and `validateBrief` against the question's stored
 *   context passages (text from `.index/build/<indexVersion>/chunks.jsonl`), then
 *   `scoreGeneration`;
 * - the file's summary, scores, briefs and validation blocks are rewritten. The recorded
 *   telemetry is kept (generation latency, first token, tokens, cost, from the original run);
 *   pipeline totals are not reported (`totalP50: null`), since a re-score measures no latency.
 *
 * This is how v1 and v2, whose prompts are no longer the runtime prompt, are scored by the same
 * validator as the shipped version. Exit 1 if a recorded response cannot be matched.
 *
 *   pnpm eval:generation:rescore                    # every generation-*.json for the built index
 *   pnpm eval:generation:rescore --prompt da-v3     # one prompt version
 */
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { AnalysisTelemetry } from '@diligenceiq/core';
import { parse } from 'yaml';
import { EvalFileSchema, type GenerationResponse, type GenerationScore, type PipelineOutcome, type SnapshotEntry, repairBrief, scoreGeneration, summarizeGeneration, toCitations, validateBrief } from '@diligenceiq/rag';
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
const files = readdirSync(outDir).filter((f) => /^generation-.+-da-v\d+\.json$/.test(f) && (!only || f.endsWith(`-${only}.json`)));
if (!files.length) fail(`no generation results in evals/results${only ? ` for ${only}` : ''}`);
const questions = new Map(EvalFileSchema.parse(parse(readFileSync(join(ROOT, 'evals', 'questions.yaml'), 'utf8'))).questions.map((q) => [q.id, q]));

/** Snapshot entries for the given chunk IDs, read from the built index's chunks.jsonl. */
async function loadChunks(indexVersion: string, ids: ReadonlySet<string>): Promise<Map<string, SnapshotEntry>> {
  const path = join(BUILD_DIR, indexVersion, 'chunks.jsonl');
  if (!existsSync(path)) fail(`${path} not found (pnpm index:build)`);
  const out = new Map<string, SnapshotEntry>();
  for await (const line of createInterface({ input: createReadStream(path) })) {
    const id = /^\{"chunkId":"([^"]+)"/.exec(line)?.[1];
    if (!id || !ids.has(id)) continue;
    const c = JSON.parse(line) as Omit<SnapshotEntry, 'laneId' | 'score'>;
    out.set(id, { chunkId: c.chunkId, documentId: c.documentId, ticker: c.ticker, company: c.company, filingType: c.filingType, filingDate: c.filingDate, periodEnd: c.periodEnd, fiscalLabel: c.fiscalLabel, section: c.section, subsection: c.subsection, charStart: c.charStart, charEnd: c.charEnd, text: c.text, laneId: '', score: 0 });
  }
  return out;
}

for (const name of files) {
  const stored = JSON.parse(readFileSync(join(outDir, name), 'utf8')) as StoredFile;
  const recDir = join(CACHE_DIR, 'generations', stored.promptVersion);
  if (!existsSync(recDir)) fail(`${recDir} not found: no recorded responses for ${stored.promptVersion}`);
  const recorded = readdirSync(recDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(join(recDir, f), 'utf8')) as { response?: GenerationResponse }).response)
    .filter((r): r is GenerationResponse => !!r);
  const chunks = await loadChunks(stored.indexVersion, new Set(stored.records.flatMap((r) => r.contextChunkIds)));

  const scores: GenerationScore[] = [];
  const records: StoredRecord[] = [];
  for (const rec of stored.records) {
    const q = questions.get(rec.id);
    if (!q) fail(`${name}: question ${rec.id} is not in evals/questions.yaml`);
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
    const snapshot = rec.contextChunkIds.map((id) => chunks.get(id) ?? fail(`${name}: ${rec.id}: context chunk ${id} not in ${stored.indexVersion}`));
    const repaired = repairBrief(gen.toolInput);
    if (!repaired.ok) fail(`${name}: ${rec.id}: the recorded response no longer passes repair: ${repaired.issues.join('; ')}`);
    const { brief, validation, citedChunkIds } = validateBrief(repaired.brief, repaired.repairs, new Map(snapshot.map((e) => [e.chunkId, e.text])));
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
    console.log(`  ${score.pass ? 'PASS' : 'FAIL'} ${rec.id}: figures ${score.figures.verified}/${score.figures.total}${score.figures.unitUnstated ? ` (${score.figures.unitUnstated} near)` : ''}${failed.length ? ` — ${failed.map((c) => c.name).join(', ')}` : ''}`);
  }

  const summary = summarizeGeneration(scores, { totalsMeasured: false });
  const rescoredAt = new Date().toISOString();
  const rescore = { rescoredAt, by: 'pnpm eval:generation:rescore', note: 'Recorded responses re-validated and re-scored with the current validator and checks; no model call. Telemetry (generation latency, tokens, cost) is from the original run.' };
  writeFileSync(join(outDir, name), `${JSON.stringify({ ...stored, rescore, summary, records }, null, 1)}\n`);
  const md = renderGenerationReport({
    indexVersion: stored.indexVersion,
    promptVersion: stored.promptVersion,
    provenance: [
      `Generated on ${new Date(stored.ranAt).toLocaleDateString('en-CA')} (local) by \`pnpm eval:retrieval --generate\`, model \`${stored.modelId}\`, temperature 0.2, forced tool \`submit_diligence_brief\`, one generation request per question. Re-scored on ${new Date(rescoredAt).toLocaleDateString('en-CA')} by \`pnpm eval:generation:rescore\`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).`,
    ],
    summary,
    scores,
    notRecorded: stored.notRecorded,
  });
  writeFileSync(join(outDir, name.replace(/\.json$/, '.md')), md);
  console.log(
    `${name}: ${summary.passed}/${summary.questions} pass; numeric grounding ${summary.numericGrounding} (${summary.figuresVerified}/${summary.figuresTotal}, ${summary.figuresUnitUnstated} near matches); every figure verified in ${summary.briefsFullyGrounded}/${summary.completed}; comparisons aligned ${summary.comparisonAligned.passed}/${summary.comparisonAligned.total}; abstention ${summary.abstention.passed}/${summary.abstention.total}; follow-ups answerable ${summary.followUpsAnswerable.passed}/${summary.followUpsAnswerable.total}; injection ${summary.injection.passed}/${summary.injection.total}; coverage ${summary.briefCoverage.passed}/${summary.briefCoverage.total}; citation validity ${summary.citationValidityPre} → ${summary.citationValidityPost}`,
  );
}

import { randomUUID } from 'node:crypto';
import type { AnalysisTelemetry } from '@diligenceiq/core';
import { type EmbedQuery, type GenerationClient, GenerationGateway, type Retriever, runDeepAnalysis } from '@diligenceiq/rag';
import { z } from 'zod';
import { log } from '../http';
import type { KillSwitchReader } from '../kill-switch';
import { type AnalysisStore, ClaimLostError } from './store';

/**
 * The analysis worker (SPEC §14.3, §30; architecture §4.1, §4.3, §5; DD-04, DD-14). One SQS
 * message = one analysis ID. Order of work:
 * 1. Kill switch: off → the QUEUED job fails as ANALYSES_DISABLED, with no claim and no work.
 *    Unreadable (SSM error) → the QUEUED job fails as WORKER_FAILED ("could not be started"),
 *    not as "paused": nothing is spent, the user sees an honest error at once and can re-run.
 * 2. Claim first, before any fallible work: QUEUED and before `deadlineAt` → RUNNING with a
 *    fresh token. Not claimable → acknowledged without work (duplicate or late delivery).
 * 3. Load the index (cold start only, shown as a stage); failure → INDEX_UNAVAILABLE.
 * 4. The pipeline, with ONE `GenerationGateway` of purpose 'analysis' whose `beforeCall`
 *    persists `generationStartedAt` and `generationCallCount = 1`.
 * 5. The result is written only while the claim is still ours: `complete` first (conditional),
 *    then the context snapshot (retried once; a failure is logged and the analysis stays
 *    COMPLETE without a snapshot, so no orphan snapshot and no lost paid result).
 * Every path after the claim ends in a terminal state or a lost claim, and the message is
 * acknowledged: redelivery is never a recovery path. Only a failure before the claim (the
 * DynamoDB write itself) throws, so SQS redelivers it, at most 3 times, then the DLQ handler
 * marks the job WORKER_FAILED.
 */

export const AnalysisMessageSchema = z
  .object({
    workspaceId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    analysisId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    /**
     * The api request that queued it (architecture §12): links the worker's lines to the POST.
     * Optional, so a message queued before Phase 7 still parses, and never fatal: a malformed or
     * unexpected value is dropped (`catch`), and the analysis still runs. Unknown keys stay invalid.
     */
    apiRequestId: z.string().max(256).regex(/^[A-Za-z0-9+/=_-]+$/).optional().catch(undefined),
  })
  .strict();
export type AnalysisMessage = z.infer<typeof AnalysisMessageSchema>;

/** Kept back from the Lambda's remaining time for the final writes. */
export const LAMBDA_SAFETY_MS = 5_000;

export interface RuntimeIndex {
  retriever: Retriever;
  indexVersion: string;
}

export interface IndexProvider {
  /** True when the index is already in memory (no load stage). */
  loaded(): boolean;
  get(): Promise<{ index: RuntimeIndex; loadMs: number; cold: boolean }>;
}

export interface QueryEmbedder {
  embed: EmbedQuery;
  modelId: string;
  stats: { inputTokens: number };
}

export interface WorkerDeps {
  store: AnalysisStore;
  killSwitch: KillSwitchReader;
  index: IndexProvider;
  /** One embedder per analysis (its stats feed the cost estimate); null runs BM25 only. */
  createEmbedder: () => QueryEmbedder | null;
  generationClient: GenerationClient;
  now?: () => Date;
  newToken?: () => string;
  generationBudgetMs?: number;
}

export type ProcessOutcome = 'invalid' | 'disabled' | 'switch_unreadable' | 'not_claimable' | 'complete' | 'failed' | 'claim_lost';

export async function processAnalysisMessage(deps: WorkerDeps, body: string, ctx: { requestId: string; remainingTimeMs: () => number }): Promise<ProcessOutcome> {
  const now = deps.now ?? (() => new Date());
  const { requestId } = ctx;
  let message: AnalysisMessage;
  try {
    message = AnalysisMessageSchema.parse(JSON.parse(body));
  } catch {
    log('warn', 'analysis message invalid; acknowledged without work', { requestId, bytes: body.length });
    return 'invalid';
  }
  const { workspaceId, analysisId, apiRequestId } = message;
  const ids = { requestId, workspaceId, analysisId, ...(apiRequestId ? { apiRequestId } : {}) };

  const killSwitch = await deps.killSwitch.read(requestId);
  if (killSwitch.source === 'read_failed') {
    // Not "paused": the switch could not be read. Fail closed (no claim, no spend), but say so
    // honestly and at once. Throwing for a redelivery would only surface as QUEUE_TIMEOUT after
    // the 240 s deadline, because the 1080 s visibility timeout outlasts it (architecture §4.3).
    const failed = await deps.store.failQueued(workspaceId, analysisId, { code: 'WORKER_FAILED', message: 'The analysis could not be started. Run it again.', requestId }, now());
    log('error', 'kill switch unreadable; analysis not run', { ...ids, failed });
    if (failed) failedSummary({ ...ids, code: 'WORKER_FAILED', detail: 'kill_switch_unreadable' }, 0);
    return 'switch_unreadable';
  }
  if (!killSwitch.enabled) {
    const failed = await deps.store.failQueued(workspaceId, analysisId, { code: 'ANALYSES_DISABLED', message: 'Analyses are paused right now.', requestId }, now());
    log('info', 'kill switch off; analysis not run', { ...ids, failed });
    if (failed) failedSummary({ ...ids, code: 'ANALYSES_DISABLED' }, 0);
    return 'disabled';
  }

  const token = (deps.newToken ?? randomUUID)();
  const record = await deps.store.claim(workspaceId, analysisId, token, now());
  if (!record) {
    log('info', 'analysis not claimable (duplicate, finished or late delivery); acknowledged without work', ids);
    return 'not_claimable';
  }
  const fail = (code: Parameters<AnalysisStore['fail']>[3]['code'], message: string, extra?: Parameters<AnalysisStore['fail']>[5]) =>
    deps.store.fail(workspaceId, analysisId, token, { code, message, requestId }, now(), extra);
  // Outside the try, so the unexpected-failure path below can say whether a request was sent.
  let gateway: GenerationGateway | null = null;

  try {
    // Index (cold start only).
    let index: RuntimeIndex;
    let loadMs = 0;
    let cold = false;
    try {
      if (!deps.index.loaded()) await deps.store.setStage(workspaceId, analysisId, token, 'loading_index');
      ({ index, loadMs, cold } = await deps.index.get());
    } catch (err) {
      if (err instanceof ClaimLostError) throw err;
      log('error', 'index load failed', { ...ids, errorName: (err as Error)?.name, errorMessage: (err as Error)?.message });
      if (await fail('INDEX_UNAVAILABLE', 'Filing search is unavailable right now.')) failedSummary({ ...ids, code: 'INDEX_UNAVAILABLE' }, 0);
      return 'failed';
    }

    const embedder = deps.createEmbedder();
    gateway = new GenerationGateway({
      purpose: 'analysis',
      client: deps.generationClient,
      beforeCall: () => deps.store.markGenerationStarted(workspaceId, analysisId, token, now()),
    });
    const deadline = Date.parse(record.deadlineAt);
    const outcome = await runDeepAnalysis(
      { question: record.question, ...(record.filters ? { filters: record.filters } : {}), requestId, analysisId },
      {
        retriever: index.retriever,
        indexVersion: index.indexVersion,
        embedQuery: embedder?.embed ?? null,
        ...(embedder ? { embedding: { modelId: embedder.modelId, stats: embedder.stats } } : {}),
        gateway,
        isClaimLost: (err) => err instanceof ClaimLostError,
        onStage: (stage) => deps.store.setStage(workspaceId, analysisId, token, stage),
        remainingMs: () => Math.min(deadline - now().getTime(), ctx.remainingTimeMs() - LAMBDA_SAFETY_MS),
        ...(deps.generationBudgetMs ? { generationBudgetMs: deps.generationBudgetMs } : {}),
      },
    );
    const telemetry: AnalysisTelemetry = { ...(outcome.status === 'COMPLETE' ? outcome.output.telemetry : outcome.telemetry), indexLoadMs: loadMs, coldStart: cold };
    telemetry.totalDurationMs += loadMs;

    if (outcome.status === 'CLAIM_LOST') {
      summary('claim_lost', telemetry, ids);
      return 'claim_lost';
    }
    if (outcome.status === 'FAILED') {
      // The pipeline's detail is content-free (Zod issue paths and messages, the stop reason, a JSON
      // parse shape, an SDK error's name and message; never the question, chunk text or the brief's
      // fields). It is already in the summary line; the record keeps it as the internal, bounded
      // `failureDetail`, so a failure stays diagnosable after the 14-day logs expire.
      const written = await fail(outcome.code, outcome.message, {
        ...(outcome.interpretation ? { interpretation: outcome.interpretation } : {}),
        telemetry,
        ...(outcome.detail ? { failureDetail: outcome.detail } : {}),
      });
      summary(written ? 'failed' : 'claim_lost', telemetry, { ...ids, code: outcome.code, detail: outcome.detail });
      return written ? 'failed' : 'claim_lost';
    }
    const { snapshot, ...result } = outcome.output;
    const written = await deps.store.complete(workspaceId, analysisId, token, { ...result, telemetry }, now());
    if (!written) {
      summary('claim_lost', telemetry, ids);
      return 'claim_lost';
    }
    // The snapshot is written only for a COMPLETE analysis (no orphan on a lost claim), and its
    // failure never turns a paid, successful brief into an error: retried once, then logged.
    // A missing CONTEXT item means "snapshot unavailable"; citations[] still carry the cited text.
    const contextStored = await putContextWithRetry(deps, workspaceId, analysisId, { indexVersion: index.indexVersion, passages: snapshot }, ids);
    summary('complete', telemetry, {
      ...ids,
      contextStored,
      citationsRemoved: result.validation.citations.removed.length,
      figuresUnverified: result.validation.numeric.total - result.validation.numeric.verified,
    });
    return 'complete';
  } catch (err) {
    if (err instanceof ClaimLostError) {
      log('warn', 'claim lost mid-analysis; result discarded', { ...ids, at: err.message });
      return 'claim_lost';
    }
    log('error', 'analysis failed unexpectedly', { ...ids, errorName: (err as Error)?.name, errorMessage: (err as Error)?.message });
    // Only the error's name is stored: its message may quote anything.
    const failureDetail = `unexpected_error (${(err as Error)?.name ?? 'unknown'})`;
    const written = await fail('WORKER_FAILED', 'The analysis could not be processed. Run it again.', { failureDetail }).catch(() => false);
    if (written) failedSummary({ ...ids, code: 'WORKER_FAILED', detail: 'unexpected_error' }, gateway?.sentCount ?? 0);
    return 'failed';
  }
}

async function putContextWithRetry(deps: WorkerDeps, workspaceId: string, analysisId: string, snapshot: { indexVersion: string; passages: unknown[] }, ids: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await deps.store.putContext(workspaceId, analysisId, snapshot);
      return true;
    } catch (err) {
      const error = { attempt, errorName: (err as Error)?.name, errorMessage: (err as Error)?.message };
      if (attempt === 1) log('warn', 'context snapshot write failed; retrying once', { ...ids, ...error });
      else log('error', 'context snapshot not stored; the analysis stays COMPLETE without it', { ...ids, event: 'context_snapshot_missing', ...error });
    }
  }
  return false;
}

/**
 * The one summary event per analysis (SPEC §30.1). The question is logged; prompts and chunk
 * text never are. A metric filter on `generationCallCount` alarms if it ever exceeds 1.
 */
function summary(status: string, telemetry: AnalysisTelemetry, fields: Record<string, unknown>) {
  log('info', 'analysis summary', { event: 'analysis_summary', status, ...fields, ...telemetry });
}

/**
 * The failed summary line for a path that has no pipeline telemetry (the kill switch, the index
 * load, an unexpected error): `status` 'failed' and `code` for the AnalysisFailed metric, and the
 * number of generation requests actually sent. With none sent the estimated cost is 0; after a
 * sent request it is unknown here, so it is left out (the cost metric then skips the line).
 */
export function failedSummary(fields: Record<string, unknown> & { code: string }, generationCallCount: number) {
  log('info', 'analysis summary', { event: 'analysis_summary', status: 'failed', ...fields, generationCallCount, ...(generationCallCount === 0 ? { estimatedCostUsd: 0 } : { costIncomplete: true }) });
}

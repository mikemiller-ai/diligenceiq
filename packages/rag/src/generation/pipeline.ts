import type { AnalysisFailureCode, AnalysisInterpretation, AnalysisTelemetry, BriefCoverage, BriefValidation, Citation, DiligenceBrief } from '@diligenceiq/core';
import type { QueryAnalysis, QueryFilters } from '../query/analyze';
import { type SnapshotEntry, estimateTokens } from '../retrieval/context';
import type { EmbedQuery, RetrievalResult, RetrievalStage, Retriever } from '../retrieval/retrieve';
import type { GenerationGateway, GenerationResponse } from './gateway';
import { BRIEF_TOOL, DEEP_ANALYSIS_PROMPT_VERSION, DEEP_ANALYSIS_SYSTEM_PROMPT, GENERATION_SETTINGS, buildUserMessage, describePeriodRequest, describeScope } from './prompt';
import { repairBrief, validateBrief } from './validate';

/**
 * One Deep Analysis (SPEC §14.3): deterministic query analysis → hybrid retrieval → context →
 * ONE generation request through the gateway → deterministic repair and validation.
 *
 * It owns no storage. The worker passes `onStage` (persists the real stage), `remainingMs`
 * (time left before `deadlineAt` or the Lambda timeout, whichever is first) and a gateway whose
 * `beforeCall` persists `generationStartedAt` (architecture §4.3). The result is either a
 * complete brief or a typed failure; `generationCallCount` is 0 or 1 on every path, and the
 * gateway makes a second call impossible.
 */
export type AnalysisStage = RetrievalStage | 'generating' | 'validating';

/** Time the generation request may take; the request is aborted at this point (architecture §4.3). */
export const GENERATION_BUDGET_MS = 120_000;
/** Time kept back after generation for validation and the final write. */
export const FINISH_MARGIN_MS = 10_000;

/** USD per 1M tokens (on-demand list price, us-east-1; an estimate, SPEC §30.1). Unknown models cost 0 and are flagged. */
export const PRICING: Record<string, { input: number; output: number }> = {
  'us.anthropic.claude-sonnet-4-6': { input: 3, output: 15 },
  'anthropic.claude-sonnet-4-6': { input: 3, output: 15 },
  'amazon.titan-embed-text-v2:0': { input: 0.02, output: 0 },
};

export function estimateCostUsd(generation: { modelId: string; inputTokens: number; outputTokens: number } | null, embedding: { modelId: string; inputTokens: number } | null): number {
  let usd = 0;
  if (generation) {
    const p = PRICING[generation.modelId];
    if (p) usd += (generation.inputTokens * p.input + generation.outputTokens * p.output) / 1e6;
  }
  if (embedding) {
    const p = PRICING[embedding.modelId];
    if (p) usd += (embedding.inputTokens * p.input) / 1e6;
  }
  return Number(usd.toFixed(6));
}

export interface PipelineInput {
  question: string;
  filters?: QueryFilters;
  requestId: string;
  analysisId: string;
}

/**
 * The name of the store's lost-claim error (services/api `ClaimLostError`). The pipeline lives in
 * packages/rag and does not import service code, so by default it recognises the error by name;
 * the worker passes an `instanceof` check instead.
 */
export const CLAIM_LOST_ERROR_NAME = 'ClaimLostError';
export const isClaimLostByName = (err: unknown): boolean => err instanceof Error && err.name === CLAIM_LOST_ERROR_NAME;

export interface PipelineDeps {
  retriever: Retriever;
  indexVersion: string;
  /** Null runs BM25 only. A failing embedding falls back to BM25, stated (assumptions A1). */
  embedQuery: EmbedQuery | null;
  embedding?: { modelId: string; stats: { inputTokens: number } };
  gateway: GenerationGateway;
  /**
   * True when a `beforeCall` failure means the claim was lost (CLAIM_LOST, nothing written).
   * Any other `beforeCall` failure (a throttled or failed DynamoDB write) fails the job as
   * WORKER_FAILED. Default: `isClaimLostByName`.
   */
  isClaimLost?: (err: unknown) => boolean;
  onStage: (stage: AnalysisStage) => Promise<void>;
  remainingMs: () => number;
  generationBudgetMs?: number;
  now?: () => number;
}

export interface AnalysisOutput {
  interpretation: AnalysisInterpretation;
  coverage: BriefCoverage;
  brief: DiligenceBrief;
  citations: Citation[];
  validation: BriefValidation;
  /** The passages sent to the model (persisted separately as the context snapshot, SPEC §16.4). */
  snapshot: SnapshotEntry[];
  telemetry: AnalysisTelemetry;
}

export type PipelineOutcome =
  | { status: 'COMPLETE'; output: AnalysisOutput }
  | {
      status: 'FAILED';
      code: AnalysisFailureCode;
      message: string;
      /** Whatever is known at the failure (retrieval scope, telemetry), for the error screen and the log. */
      interpretation?: AnalysisInterpretation;
      telemetry: AnalysisTelemetry;
      detail?: string;
    }
  /** The gateway's beforeCall failed with a lost claim: the worker must not write a result. */
  | { status: 'CLAIM_LOST'; telemetry: AnalysisTelemetry };

export function toInterpretation(analysis: QueryAnalysis, planNotes: readonly string[], strategy: string, mode: 'hybrid' | 'bm25'): AnalysisInterpretation {
  const periods = [...new Set(analysis.scopes.flatMap((s) => s.buckets.map((b) => b.label)))];
  const p = analysis.period;
  return {
    companies: analysis.companies.map((c) => c.ticker),
    periods: analysis.scoped ? periods : [`${capitalize(describePeriodRequest(p))} (each company)`],
    filingTypes: analysis.filingTypes.length ? analysis.filingTypes : ['10-K', '10-Q'],
    coverageWarnings: analysis.gaps,
    scopes: analysis.scoped
      ? analysis.scopes.map((s) => {
          const c = analysis.companies.find((x) => x.ticker === s.ticker);
          return { ticker: s.ticker, company: c?.company ?? s.ticker, via: c?.via ?? 'name', periods: s.buckets.map((b) => b.label), description: s.description };
        })
      : [],
    sectors: analysis.sectors.map((s) => ({ phrase: s.phrase, tickers: s.tickers })),
    periodRule: { kind: p.kind, ...('phrase' in p ? { phrase: p.phrase } : {}), ...(p.kind === 'last_n' && p.assumption ? { assumption: p.assumption } : {}) },
    notes: [...analysis.notes, ...planNotes],
    strategy,
    retrievalMode: mode,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Company × period cells: every resolved period of a named company (zero when nothing was retrieved), plus whatever a global lane found. */
export function toCoverage(analysis: QueryAnalysis, snapshot: readonly SnapshotEntry[], citedChunkIds: readonly string[]): BriefCoverage {
  const bucketOfDoc = new Map<string, string>();
  for (const s of analysis.scopes) for (const b of s.buckets) for (const d of b.documentIds) bucketOfDoc.set(`${s.ticker}|${d}`, b.label);
  const cells = new Map<string, BriefCoverage['cells'][number]>();
  const cell = (ticker: string, period: string) => {
    const k = `${ticker}|${period}`;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { ticker, period, contextChunks: 0, citedChunks: 0 }));
    return c;
  };
  if (analysis.scoped) for (const s of analysis.scopes) for (const b of s.buckets) cell(s.ticker, b.label);
  const cited = new Set(citedChunkIds);
  for (const e of snapshot) {
    const c = cell(e.ticker, bucketOfDoc.get(`${e.ticker}|${e.documentId}`) ?? e.fiscalLabel);
    c.contextChunks++;
    if (cited.has(e.chunkId)) c.citedChunks++;
  }
  return { cells: [...cells.values()] };
}

export function toCitations(snapshot: readonly SnapshotEntry[], citedChunkIds: readonly string[], indexVersion: string): Citation[] {
  const byId = new Map(snapshot.map((e) => [e.chunkId, e]));
  return citedChunkIds.flatMap((id) => {
    const e = byId.get(id);
    if (!e) return [];
    return [
      {
        chunkId: e.chunkId,
        indexVersion,
        ticker: e.ticker,
        company: e.company,
        filingType: e.filingType === '10-Q' ? '10-Q' : '10-K',
        filingDate: e.filingDate,
        periodEnd: e.periodEnd,
        fiscalLabel: e.fiscalLabel,
        section: e.subsection ? `${e.section} › ${e.subsection}` : e.section,
        documentId: e.documentId,
        charStart: e.charStart,
        charEnd: e.charEnd,
        text: e.text,
      } satisfies Citation,
    ];
  });
}

export async function runDeepAnalysis(input: PipelineInput, deps: PipelineDeps): Promise<PipelineOutcome> {
  const now = deps.now ?? (() => performance.now());
  const t0 = now();
  const budgetMs = deps.generationBudgetMs ?? GENERATION_BUDGET_MS;
  const telemetry: AnalysisTelemetry = {
    requestId: input.requestId,
    analysisId: input.analysisId,
    query: input.question,
    retrievalDurationMs: 0,
    generationDurationMs: 0,
    totalDurationMs: 0,
    retrievalRequests: 0,
    chunksRetrieved: 0,
    contextChunksUsed: 0,
    companiesRepresented: 0,
    filingsRepresented: 0,
    embeddingCallCount: 0,
    rerankCallCount: 0,
    generationCallCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    modelId: deps.gateway.options.client.modelId,
    promptVersion: DEEP_ANALYSIS_PROMPT_VERSION,
    indexVersion: deps.indexVersion,
    estimatedCostUsd: 0,
  };
  const finishTelemetry = (gen: Pick<GenerationResponse, 'modelId' | 'inputTokens' | 'outputTokens'> | null) => {
    telemetry.generationCallCount = deps.gateway.sentCount;
    telemetry.totalDurationMs = Math.round(now() - t0);
    telemetry.estimatedCostUsd = estimateCostUsd(gen, deps.embedding ? { modelId: deps.embedding.modelId, inputTokens: deps.embedding.stats.inputTokens } : null);
    return telemetry;
  };

  // 1. Retrieval (one query embedding; BM25 only if it fails, stated).
  let retrieval: RetrievalResult;
  let embedFailure: string | null = null;
  // Each stage is written once: a BM25 retry after a failed embedding must not move the
  // persisted stage backwards (SPEC §38.1).
  const emitted = new Set<AnalysisStage>();
  const onStageOnce = async (stage: AnalysisStage) => {
    if (emitted.has(stage)) return;
    emitted.add(stage);
    await deps.onStage(stage);
  };
  const retrieve = (embed: EmbedQuery | null) => deps.retriever.retrieve(input.question, input.filters ?? {}, embed, { onStage: onStageOnce });
  // Only an embedding error falls back; any other retrieval error propagates.
  let embedError: unknown = null;
  const source = deps.embedQuery;
  const embed: EmbedQuery | null = source
    ? async (text) => {
        try {
          return await source(text);
        } catch (err) {
          embedError = err;
          throw err;
        }
      }
    : null;
  try {
    retrieval = await retrieve(embed);
  } catch (err) {
    if (embedError === null || err !== embedError) throw err;
    embedFailure = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    telemetry.embeddingCallCount = 1;
    retrieval = await retrieve(null);
  }
  const { analysis, plan, context } = retrieval;
  const mode = embedFailure ? 'bm25' : retrieval.telemetry.mode === 'bm25' ? 'bm25' : 'hybrid';
  const planNotes = embedFailure ? [...plan.notes, 'Semantic search was unavailable for this question, so only keyword (BM25) search was used.'] : plan.notes;
  const interpretation = toInterpretation(analysis, planNotes, plan.strategy, mode);
  Object.assign(telemetry, {
    retrievalDurationMs: retrieval.telemetry.retrievalDurationMs,
    embeddingDurationMs: retrieval.telemetry.embeddingDurationMs,
    retrievalRequests: retrieval.telemetry.retrievalRequests,
    chunksRetrieved: retrieval.telemetry.chunksRetrieved,
    contextChunksUsed: retrieval.telemetry.contextChunksUsed,
    companiesRepresented: retrieval.telemetry.companiesRepresented,
    filingsRepresented: retrieval.telemetry.filingsRepresented,
    contextTokenEstimate: context.tokenEstimate,
  });
  telemetry.embeddingCallCount = Math.max(telemetry.embeddingCallCount, retrieval.telemetry.embeddingCallCount);

  // 2. Nothing to generate from: no call (generationCallCount 0).
  if (context.blocks.length === 0) {
    return { status: 'FAILED', code: 'NO_RELEVANT_EVIDENCE', message: 'The filings in the corpus do not cover this question.', interpretation, telemetry: finishTelemetry(null) };
  }

  // 3. Only call the model if the remaining time covers the whole generation budget.
  const remaining = deps.remainingMs();
  if (remaining < budgetMs + FINISH_MARGIN_MS) {
    return {
      status: 'FAILED',
      code: 'PIPELINE_TIMEOUT',
      message: 'The analysis ran out of time before the brief could be generated.',
      interpretation,
      telemetry: finishTelemetry(null),
      detail: `remaining ${remaining} ms < budget ${budgetMs + FINISH_MARGIN_MS} ms; generation not called`,
    };
  }

  // 4. The one generation request.
  const user = buildUserMessage({ question: input.question, scope: describeScope(analysis, { notes: planNotes }), excerpts: context.text });
  await deps.onStage('generating');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), budgetMs);
  let gen: GenerationResponse;
  const tg = now();
  try {
    gen = await deps.gateway.generate({ system: DEEP_ANALYSIS_SYSTEM_PROMPT, user, tool: BRIEF_TOOL, temperature: GENERATION_SETTINGS.temperature, maxTokens: GENERATION_SETTINGS.maxTokens, signal: abort.signal });
  } catch (err) {
    clearTimeout(timer);
    const errText = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (deps.gateway.sentCount === 0) {
      // beforeCall failed, so the model was NOT called. Only a lost claim means "write nothing".
      if ((deps.isClaimLost ?? isClaimLostByName)(err)) return { status: 'CLAIM_LOST', telemetry: finishTelemetry(null) };
      // Any other failure (a throttled or failed DynamoDB write) fails the job. If that write in
      // fact landed and only its response was lost, the record keeps generationStartedAt and
      // generationCallCount 1 (persisted before the call, an upper bound), while the telemetry
      // and this detail say what happened: the model was not called (architecture §4.3).
      return {
        status: 'FAILED',
        code: 'WORKER_FAILED',
        message: 'The analysis could not be processed. Run it again.',
        interpretation,
        telemetry: finishTelemetry(null),
        detail: `generation start could not be recorded; the model was not called (${errText})`,
      };
    }
    telemetry.generationDurationMs = Math.round(now() - tg);
    const timedOut = abort.signal.aborted;
    // The request was sent but no usage came back: the input was still billed (and any output
    // streamed before the failure). Estimate the input from the prompt so the cost estimate does
    // not drop the generation, and say the figure is incomplete.
    const estimatedInput = estimateTokens(DEEP_ANALYSIS_SYSTEM_PROMPT) + estimateTokens(user);
    telemetry.inputTokens = estimatedInput;
    telemetry.costIncomplete = true;
    return {
      status: 'FAILED',
      code: timedOut ? 'GENERATION_TIMEOUT' : 'GENERATION_FAILED',
      message: timedOut ? 'The analysis took too long.' : 'The model request failed.',
      interpretation,
      telemetry: finishTelemetry({ modelId: telemetry.modelId, inputTokens: estimatedInput, outputTokens: 0 }),
      detail: errText,
    };
  }
  clearTimeout(timer);
  Object.assign(telemetry, {
    generationDurationMs: gen.durationMs,
    generationFirstTokenMs: gen.firstTokenMs,
    inputTokens: gen.inputTokens,
    outputTokens: gen.outputTokens,
    modelId: gen.modelId,
    stopReason: gen.stopReason,
  });
  // A client that returns after the abort (a stream that ended cleanly instead of throwing)
  // is still a timeout: its output may be cut off, so it is discarded, never validated.
  if (abort.signal.aborted) {
    return {
      status: 'FAILED',
      code: 'GENERATION_TIMEOUT',
      message: 'The analysis took too long.',
      interpretation,
      telemetry: finishTelemetry(gen),
      detail: `aborted at the ${budgetMs} ms generation budget; the response (stop reason ${gen.stopReason}) was discarded`,
    };
  }

  // 5. Deterministic repair and validation.
  await deps.onStage('validating');
  if (gen.toolInput === null) {
    return { status: 'FAILED', code: 'MALFORMED_OUTPUT', message: "The answer couldn't be validated.", interpretation, telemetry: finishTelemetry(gen), detail: `no ${BRIEF_TOOL.name} call (stop reason ${gen.stopReason})` };
  }
  const repaired = repairBrief(gen.toolInput);
  if (!repaired.ok) {
    return {
      status: 'FAILED',
      code: 'MALFORMED_OUTPUT',
      message: "The answer couldn't be validated.",
      interpretation,
      telemetry: finishTelemetry(gen),
      detail: `stop reason ${gen.stopReason}; ${repaired.issues.join('; ')}`,
    };
  }
  const passages = new Map(context.snapshot.map((e) => [e.chunkId, e.text]));
  // A table's unit caption can end the previous chunk of the same filing section: the validator
  // reads it from there (architecture §6.9, preceding-unit rule). The snapshot is unchanged.
  const { brief, validation, citedChunkIds } = validateBrief(repaired.brief, repaired.repairs, passages, (id) => deps.retriever.precedingText(id));
  return {
    status: 'COMPLETE',
    output: {
      interpretation,
      coverage: toCoverage(analysis, context.snapshot, citedChunkIds),
      brief,
      citations: toCitations(context.snapshot, citedChunkIds, deps.indexVersion),
      validation,
      snapshot: context.snapshot,
      telemetry: finishTelemetry(gen),
    },
  };
}

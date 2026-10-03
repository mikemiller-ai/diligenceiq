import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { type DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type {
  AnalysisFailureCode,
  AnalysisFilters,
  AnalysisInterpretation,
  AnalysisOrigin,
  AnalysisStatus,
  AnalysisTelemetry,
  BriefCoverage,
  BriefValidation,
  Citation,
  DiligenceBrief,
} from '@diligenceiq/core';

/**
 * The analysis job record and every state transition (architecture §4.3, §8; DD-04, DD-14).
 * `QUEUED → RUNNING → COMPLETE | FAILED`, each a conditional write, so the worker, a poll and
 * the DLQ handler can never overwrite one another:
 * - `claim`: QUEUED and before `deadlineAt` → RUNNING with a fresh `claimToken`. The single-call
 *   guarantee rests on this write: a duplicate or redelivered message finds the job not QUEUED.
 * - `setStage`, `markGenerationStarted`, `complete`, `fail`: only while RUNNING with my token.
 *   `markGenerationStarted` also requires no earlier `generationStartedAt`, and sets
 *   `generationCallCount = 1` before the Bedrock request is sent.
 * - `expireIfPastDeadline` (poll path), `failQueued` (kill switch), `markWorkerFailed` (DLQ),
 *   `markEnqueueFailed` (api): conditional on the status they expect.
 *
 * Two implementations share these semantics: `DynamoAnalysisStore` (production) and
 * `MemoryAnalysisStore` (tests and local runs), whose conditions mirror the DynamoDB
 * condition expressions one for one.
 */

export const ANALYSIS_DEADLINE_MS = 240_000;
export const ANALYSIS_TTL_DAYS = 30;

export interface AnalysisError {
  code: AnalysisFailureCode;
  message: string;
  requestId: string;
}

export interface AnalysisRecord {
  workspaceId: string;
  analysisId: string;
  question: string;
  filters?: AnalysisFilters;
  origin: AnalysisOrigin;
  status: AnalysisStatus;
  stage?: string;
  createdAt: string;
  queuedAt: string;
  deadlineAt: string;
  claimedAt?: string;
  claimToken?: string;
  generationStartedAt?: string;
  generationCallCount: number;
  completedAt?: string;
  error?: AnalysisError;
  interpretation?: AnalysisInterpretation;
  coverage?: BriefCoverage;
  brief?: DiligenceBrief;
  citations?: Citation[];
  validation?: BriefValidation;
  telemetry?: AnalysisTelemetry;
  /**
   * Internal and content-free: why the pipeline failed (e.g. the Zod issue paths of a
   * MALFORMED_OUTPUT brief), bounded by `boundedFailureDetail`. Never returned by the api
   * (`toDetail` and the list projection name their fields), so the public error stays
   * {code, message, requestId}. Absent on records written before 2026-10-03.
   */
  failureDetail?: string;
  ttl: number;
}

export interface CompleteResult {
  interpretation: AnalysisInterpretation;
  coverage: BriefCoverage;
  brief: DiligenceBrief;
  citations: Citation[];
  validation: BriefValidation;
  telemetry: AnalysisTelemetry;
}

export interface FailureExtra {
  interpretation?: AnalysisInterpretation;
  telemetry?: AnalysisTelemetry;
  /** The pipeline's content-free `detail`; stored as `failureDetail`, bounded. */
  failureDetail?: string;
}

/** The longest `failureDetail` stored on a record (characters). */
export const FAILURE_DETAIL_MAX_CHARS = 300;

/**
 * The stored form of a failure detail: control characters become spaces, and anything past
 * FAILURE_DETAIL_MAX_CHARS is cut with an ellipsis. Both stores apply it, so they store the same value.
 */
export function boundedFailureDetail(detail: string): string {
  const flat = detail.replace(/\p{Cc}+/gu, ' ').trim();
  return flat.length <= FAILURE_DETAIL_MAX_CHARS ? flat : `${flat.slice(0, FAILURE_DETAIL_MAX_CHARS - 1)}…`;
}

/** The worker no longer holds the claim (deadline passed and a poll failed it, or another writer won). */
export class ClaimLostError extends Error {
  constructor(what: string) {
    super(`claim lost: ${what}`);
    this.name = 'ClaimLostError';
  }
}

export interface AnalysisStore {
  createQueued(input: { workspaceId: string; analysisId: string; question: string; filters?: AnalysisFilters; origin: AnalysisOrigin; now: Date }): Promise<AnalysisRecord>;
  get(workspaceId: string, analysisId: string): Promise<AnalysisRecord | null>;
  /** QUEUED and `deadlineAt > now` → RUNNING. Null when the job is not claimable (already claimed, finished, or late). */
  claim(workspaceId: string, analysisId: string, claimToken: string, now: Date): Promise<AnalysisRecord | null>;
  /** Throws ClaimLostError unless RUNNING with this token. */
  setStage(workspaceId: string, analysisId: string, claimToken: string, stage: string): Promise<void>;
  /** Persists generationStartedAt and generationCallCount = 1 before the call. Throws ClaimLostError unless RUNNING with this token and not started before. */
  markGenerationStarted(workspaceId: string, analysisId: string, claimToken: string, now: Date): Promise<void>;
  /** RUNNING with this token → COMPLETE. False when the claim was lost (the result is discarded). */
  complete(workspaceId: string, analysisId: string, claimToken: string, result: CompleteResult, now: Date): Promise<boolean>;
  /** RUNNING with this token → FAILED. False when the claim was lost. */
  fail(workspaceId: string, analysisId: string, claimToken: string, error: AnalysisError, now: Date, extra?: FailureExtra): Promise<boolean>;
  /** QUEUED → FAILED (kill switch while queued; enqueue failure). */
  failQueued(workspaceId: string, analysisId: string, error: AnalysisError, now: Date): Promise<boolean>;
  /** Poll path: past `deadlineAt`, QUEUED → QUEUE_TIMEOUT; RUNNING → GENERATION_TIMEOUT or PIPELINE_TIMEOUT. Returns the code applied, if any. */
  expireIfPastDeadline(workspaceId: string, analysisId: string, now: Date, requestId: string): Promise<AnalysisFailureCode | null>;
  /** DLQ: QUEUED or RUNNING → FAILED (WORKER_FAILED). */
  markWorkerFailed(workspaceId: string, analysisId: string, now: Date, requestId: string): Promise<boolean>;
  /** The context snapshot, a separate item (SPEC §16.4). Written only after `complete` succeeded; an absent item means the snapshot is unavailable. */
  putContext(workspaceId: string, analysisId: string, snapshot: { indexVersion: string; passages: unknown[] }): Promise<void>;
}

export const analysisKey = (workspaceId: string, analysisId: string) => ({ PK: `WS#${workspaceId}`, SK: `ANALYSIS#${analysisId}` });
export const contextKey = (workspaceId: string, analysisId: string) => ({ PK: `WS#${workspaceId}`, SK: `CONTEXT#${analysisId}` });
const ttlFrom = (now: Date) => Math.floor(now.getTime() / 1000) + ANALYSIS_TTL_DAYS * 86_400;

const TIMEOUT_MESSAGES: Partial<Record<AnalysisFailureCode, string>> = {
  QUEUE_TIMEOUT: 'The analysis waited too long to start. Run it again.',
  PIPELINE_TIMEOUT: 'The analysis ran out of time before the brief could be generated. Run it again.',
  GENERATION_TIMEOUT: 'The analysis took too long. Run it again.',
  WORKER_FAILED: 'The analysis could not be processed. Run it again.',
};

export function newRecord(input: { workspaceId: string; analysisId: string; question: string; filters?: AnalysisFilters; origin: AnalysisOrigin; now: Date }): AnalysisRecord {
  const iso = input.now.toISOString();
  return {
    workspaceId: input.workspaceId,
    analysisId: input.analysisId,
    question: input.question,
    ...(input.filters ? { filters: input.filters } : {}),
    origin: input.origin,
    status: 'QUEUED',
    stage: 'queued',
    createdAt: iso,
    queuedAt: iso,
    deadlineAt: new Date(input.now.getTime() + ANALYSIS_DEADLINE_MS).toISOString(),
    generationCallCount: 0,
    ttl: ttlFrom(input.now),
  };
}

/* ------------------------------------------------------------------ DynamoDB */

const isConditionFailure = (err: unknown) => err instanceof ConditionalCheckFailedException || (err as { name?: string })?.name === 'ConditionalCheckFailedException';

export class DynamoAnalysisStore implements AnalysisStore {
  constructor(
    private readonly doc: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  /** Runs a conditional write; false when its condition failed. */
  private async conditional(command: PutCommand | UpdateCommand): Promise<boolean> {
    try {
      await this.doc.send(command as never);
      return true;
    } catch (err) {
      if (isConditionFailure(err)) return false;
      throw err;
    }
  }

  async createQueued(input: Parameters<AnalysisStore['createQueued']>[0]): Promise<AnalysisRecord> {
    const record = newRecord(input);
    await this.doc.send(
      new PutCommand({ TableName: this.tableName, Item: { ...analysisKey(input.workspaceId, input.analysisId), ...record }, ConditionExpression: 'attribute_not_exists(PK)' }) as never,
    );
    return record;
  }

  async get(workspaceId: string, analysisId: string): Promise<AnalysisRecord | null> {
    const out = (await this.doc.send(new GetCommand({ TableName: this.tableName, Key: analysisKey(workspaceId, analysisId), ConsistentRead: true }) as never)) as { Item?: Record<string, unknown> };
    if (!out.Item) return null;
    const { PK: _pk, SK: _sk, ...rest } = out.Item;
    return rest as unknown as AnalysisRecord;
  }

  async claim(workspaceId: string, analysisId: string, claimToken: string, now: Date): Promise<AnalysisRecord | null> {
    try {
      const out = (await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: analysisKey(workspaceId, analysisId),
          UpdateExpression: 'SET #status = :running, claimToken = :token, claimedAt = :now, stage = :stage',
          ConditionExpression: '#status = :queued AND deadlineAt > :now',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':running': 'RUNNING', ':queued': 'QUEUED', ':token': claimToken, ':now': now.toISOString(), ':stage': 'claimed' },
          ReturnValues: 'ALL_NEW',
        }) as never,
      )) as { Attributes?: Record<string, unknown> };
      const { PK: _pk, SK: _sk, ...rest } = out.Attributes ?? {};
      return rest as unknown as AnalysisRecord;
    } catch (err) {
      if (isConditionFailure(err)) return null;
      throw err;
    }
  }

  private mine(workspaceId: string, analysisId: string, claimToken: string, set: string, values: Record<string, unknown>, names: Record<string, string> = {}, extraCondition = '') {
    return new UpdateCommand({
      TableName: this.tableName,
      Key: analysisKey(workspaceId, analysisId),
      UpdateExpression: set,
      ConditionExpression: `#status = :running AND claimToken = :token${extraCondition}`,
      ExpressionAttributeNames: { '#status': 'status', ...names },
      ExpressionAttributeValues: { ':running': 'RUNNING', ':token': claimToken, ...values },
    });
  }

  async setStage(workspaceId: string, analysisId: string, claimToken: string, stage: string): Promise<void> {
    if (!(await this.conditional(this.mine(workspaceId, analysisId, claimToken, 'SET stage = :stage', { ':stage': stage })))) throw new ClaimLostError(`stage ${stage}`);
  }

  async markGenerationStarted(workspaceId: string, analysisId: string, claimToken: string, now: Date): Promise<void> {
    const ok = await this.conditional(
      this.mine(workspaceId, analysisId, claimToken, 'SET generationStartedAt = :now, generationCallCount = :one, stage = :stage', { ':now': now.toISOString(), ':one': 1, ':stage': 'generating' }, {}, ' AND attribute_not_exists(generationStartedAt)'),
    );
    if (!ok) throw new ClaimLostError('generation start');
  }

  async complete(workspaceId: string, analysisId: string, claimToken: string, r: CompleteResult, now: Date): Promise<boolean> {
    return this.conditional(
      this.mine(
        workspaceId,
        analysisId,
        claimToken,
        'SET #status = :complete, stage = :stage, completedAt = :now, interpretation = :interpretation, coverage = :coverage, brief = :brief, citations = :citations, validation = :validation, telemetry = :telemetry',
        {
          ':complete': 'COMPLETE',
          ':stage': 'complete',
          ':now': now.toISOString(),
          ':interpretation': r.interpretation,
          ':coverage': r.coverage,
          ':brief': r.brief,
          ':citations': r.citations,
          ':validation': r.validation,
          ':telemetry': r.telemetry,
        },
      ),
    );
  }

  async fail(workspaceId: string, analysisId: string, claimToken: string, error: AnalysisError, now: Date, extra: FailureExtra = {}): Promise<boolean> {
    const sets = ['#status = :failed', 'stage = :stage', 'completedAt = :now', '#error = :error'];
    const values: Record<string, unknown> = { ':failed': 'FAILED', ':stage': 'failed', ':now': now.toISOString(), ':error': error };
    if (extra.interpretation) {
      sets.push('interpretation = :interpretation');
      values[':interpretation'] = extra.interpretation;
    }
    if (extra.telemetry) {
      sets.push('telemetry = :telemetry');
      values[':telemetry'] = extra.telemetry;
    }
    if (extra.failureDetail) {
      sets.push('failureDetail = :failureDetail');
      values[':failureDetail'] = boundedFailureDetail(extra.failureDetail);
    }
    return this.conditional(this.mine(workspaceId, analysisId, claimToken, `SET ${sets.join(', ')}`, values, { '#error': 'error' }));
  }

  private statusTransition(workspaceId: string, analysisId: string, condition: string, error: AnalysisError, now: Date, values: Record<string, unknown> = {}) {
    return new UpdateCommand({
      TableName: this.tableName,
      Key: analysisKey(workspaceId, analysisId),
      UpdateExpression: 'SET #status = :failed, stage = :stage, completedAt = :now, #error = :error',
      ConditionExpression: condition,
      ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
      ExpressionAttributeValues: { ':failed': 'FAILED', ':stage': 'failed', ':now': now.toISOString(), ':error': error, ...values },
    });
  }

  async failQueued(workspaceId: string, analysisId: string, error: AnalysisError, now: Date): Promise<boolean> {
    return this.conditional(this.statusTransition(workspaceId, analysisId, '#status = :queued', error, now, { ':queued': 'QUEUED' }));
  }

  async expireIfPastDeadline(workspaceId: string, analysisId: string, now: Date, requestId: string): Promise<AnalysisFailureCode | null> {
    const err = (code: AnalysisFailureCode): AnalysisError => ({ code, message: TIMEOUT_MESSAGES[code]!, requestId });
    if (await this.conditional(this.statusTransition(workspaceId, analysisId, '#status = :queued AND deadlineAt < :now', err('QUEUE_TIMEOUT'), now, { ':queued': 'QUEUED' }))) return 'QUEUE_TIMEOUT';
    if (await this.conditional(this.statusTransition(workspaceId, analysisId, '#status = :running AND deadlineAt < :now AND attribute_exists(generationStartedAt)', err('GENERATION_TIMEOUT'), now, { ':running': 'RUNNING' })))
      return 'GENERATION_TIMEOUT';
    if (await this.conditional(this.statusTransition(workspaceId, analysisId, '#status = :running AND deadlineAt < :now AND attribute_not_exists(generationStartedAt)', err('PIPELINE_TIMEOUT'), now, { ':running': 'RUNNING' })))
      return 'PIPELINE_TIMEOUT';
    return null;
  }

  async markWorkerFailed(workspaceId: string, analysisId: string, now: Date, requestId: string): Promise<boolean> {
    return this.conditional(
      this.statusTransition(workspaceId, analysisId, '#status IN (:queued, :running)', { code: 'WORKER_FAILED', message: TIMEOUT_MESSAGES.WORKER_FAILED!, requestId }, now, { ':queued': 'QUEUED', ':running': 'RUNNING' }),
    );
  }

  async putContext(workspaceId: string, analysisId: string, snapshot: { indexVersion: string; passages: unknown[] }): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: { ...contextKey(workspaceId, analysisId), ...snapshot, ttl: ttlFrom(new Date()) } }) as never);
  }
}

/* -------------------------------------------------------------------- memory */

/** Same conditions as DynamoAnalysisStore, in memory. Each method is atomic (no await inside), as a DynamoDB conditional write is. */
export class MemoryAnalysisStore implements AnalysisStore {
  readonly records = new Map<string, AnalysisRecord>();
  readonly contexts = new Map<string, { indexVersion: string; passages: unknown[] }>();
  readonly writes: string[] = [];

  private key = (w: string, a: string) => `${w}/${a}`;
  private rec(w: string, a: string) {
    return this.records.get(this.key(w, a));
  }

  async createQueued(input: Parameters<AnalysisStore['createQueued']>[0]): Promise<AnalysisRecord> {
    if (this.rec(input.workspaceId, input.analysisId)) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
    const r = newRecord(input);
    this.records.set(this.key(input.workspaceId, input.analysisId), r);
    return structuredClone(r);
  }

  async get(w: string, a: string): Promise<AnalysisRecord | null> {
    const r = this.rec(w, a);
    return r ? structuredClone(r) : null;
  }

  async claim(w: string, a: string, token: string, now: Date): Promise<AnalysisRecord | null> {
    const r = this.rec(w, a);
    if (!r || r.status !== 'QUEUED' || !(r.deadlineAt > now.toISOString())) return null;
    Object.assign(r, { status: 'RUNNING', claimToken: token, claimedAt: now.toISOString(), stage: 'claimed' });
    this.writes.push(`claim ${a}`);
    return structuredClone(r);
  }

  private mine(w: string, a: string, token: string) {
    const r = this.rec(w, a);
    return r && r.status === 'RUNNING' && r.claimToken === token ? r : null;
  }

  async setStage(w: string, a: string, token: string, stage: string): Promise<void> {
    const r = this.mine(w, a, token);
    if (!r) throw new ClaimLostError(`stage ${stage}`);
    r.stage = stage;
    this.writes.push(`stage ${stage}`);
  }

  async markGenerationStarted(w: string, a: string, token: string, now: Date): Promise<void> {
    const r = this.mine(w, a, token);
    if (!r || r.generationStartedAt !== undefined) throw new ClaimLostError('generation start');
    Object.assign(r, { generationStartedAt: now.toISOString(), generationCallCount: 1, stage: 'generating' });
    this.writes.push('generationStarted');
  }

  async complete(w: string, a: string, token: string, result: CompleteResult, now: Date): Promise<boolean> {
    const r = this.mine(w, a, token);
    if (!r) return false;
    Object.assign(r, structuredClone(result), { status: 'COMPLETE', stage: 'complete', completedAt: now.toISOString() });
    this.writes.push('complete');
    return true;
  }

  async fail(w: string, a: string, token: string, error: AnalysisError, now: Date, extra: FailureExtra = {}): Promise<boolean> {
    const r = this.mine(w, a, token);
    if (!r) return false;
    const { failureDetail, ...rest } = extra;
    Object.assign(r, structuredClone(rest), failureDetail ? { failureDetail: boundedFailureDetail(failureDetail) } : {}, { status: 'FAILED', stage: 'failed', completedAt: now.toISOString(), error });
    this.writes.push(`fail ${error.code}`);
    return true;
  }

  private failIf(w: string, a: string, ok: (r: AnalysisRecord) => boolean, error: AnalysisError, now: Date): boolean {
    const r = this.rec(w, a);
    if (!r || !ok(r)) return false;
    Object.assign(r, { status: 'FAILED', stage: 'failed', completedAt: now.toISOString(), error });
    this.writes.push(`fail ${error.code}`);
    return true;
  }

  async failQueued(w: string, a: string, error: AnalysisError, now: Date): Promise<boolean> {
    return this.failIf(w, a, (r) => r.status === 'QUEUED', error, now);
  }

  async expireIfPastDeadline(w: string, a: string, now: Date, requestId: string): Promise<AnalysisFailureCode | null> {
    const r = this.rec(w, a);
    if (!r || !(r.deadlineAt < now.toISOString())) return null;
    const code: AnalysisFailureCode | null = r.status === 'QUEUED' ? 'QUEUE_TIMEOUT' : r.status === 'RUNNING' ? (r.generationStartedAt ? 'GENERATION_TIMEOUT' : 'PIPELINE_TIMEOUT') : null;
    if (!code) return null;
    this.failIf(w, a, () => true, { code, message: TIMEOUT_MESSAGES[code]!, requestId }, now);
    return code;
  }

  async markWorkerFailed(w: string, a: string, now: Date, requestId: string): Promise<boolean> {
    return this.failIf(w, a, (r) => r.status === 'QUEUED' || r.status === 'RUNNING', { code: 'WORKER_FAILED', message: TIMEOUT_MESSAGES.WORKER_FAILED!, requestId }, now);
  }

  async putContext(w: string, a: string, snapshot: { indexVersion: string; passages: unknown[] }): Promise<void> {
    this.contexts.set(this.key(w, a), structuredClone(snapshot));
    this.writes.push('context');
  }
}

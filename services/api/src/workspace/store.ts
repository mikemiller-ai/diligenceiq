import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  BatchWriteCommand,
  type DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { AnalysisStatus, AnalysisSummary, Finding, Page } from '@diligenceiq/core';
import { ANALYSIS_TTL_DAYS, type AnalysisRecord, type MemoryAnalysisStore, analysisKey, contextKey } from '../analyses/store';

/**
 * Everything in a workspace partition except the analysis job transitions, which stay in
 * `AnalysisStore` (architecture §8): workspace metadata, findings, the cap counters, the
 * analysis list and context snapshots, seeding and reset. `DynamoWorkspaceStore` is production;
 * `MemoryWorkspaceStore` (tests, the local server) mirrors its conditions.
 */

export const WORKSPACE_TTL_DAYS = 30;
export const MAX_FINDINGS_PER_WORKSPACE = 500;

export interface WorkspaceMeta {
  workspaceId: string;
  createdAt: string;
  seedVersion: string | null;
  ttl: number;
}

export interface ContextSnapshot {
  indexVersion: string;
  passages: unknown[];
}

/** A summary row plus `seeded` (pre-run pipeline output from the seed). */
export type AnalysisListItem = AnalysisSummary & { seeded?: boolean };

export interface WorkspaceStore {
  getMeta(workspaceId: string): Promise<WorkspaceMeta | null>;
  /** Conditional create; false when the workspace already exists. */
  createMeta(meta: WorkspaceMeta): Promise<boolean>;
  /** Unconditional write in place (reset): the item is never absent, so a concurrent request keeps its session. */
  putMeta(meta: WorkspaceMeta): Promise<void>;
  /** Moves an existing workspace's expiry later (a returning visitor); false when META does not exist. */
  extendMeta(workspaceId: string, ttl: number): Promise<boolean>;
  /**
   * Adds one to a counter unless it has reached `cap` (architecture §11). False at the cap. The
   * counter is never refunded, so the caps err on the conservative side.
   */
  incrementCounter(pk: string, sk: string, cap: number, ttl: number): Promise<boolean>;
  listAnalyses(workspaceId: string, opts: { status?: AnalysisStatus; cursor?: string; limit: number }): Promise<Page<AnalysisListItem>>;
  getContext(workspaceId: string, analysisId: string): Promise<ContextSnapshot | null>;
  /** Seeding only: writes a finished analysis (and its snapshot) as-is. */
  putSeedAnalysis(record: AnalysisRecord & { seeded: true }, context: ContextSnapshot | null): Promise<void>;
  /** Analyses in the partition (a COUNT query; nothing is read). */
  countAnalyses(workspaceId: string): Promise<number>;
  listFindings(workspaceId: string): Promise<Finding[]>;
  /** Findings in the partition (a COUNT query), for the per-workspace cap. */
  countFindings(workspaceId: string): Promise<number>;
  getFinding(workspaceId: string, findingId: string): Promise<Finding | null>;
  /** Conditional create; false when a finding with this ID (the same source) exists. */
  createFinding(workspaceId: string, finding: Finding, ttl: number): Promise<boolean>;
  /** Conditional update of an existing finding; null when it does not exist. `ttl` moves its expiry (an edited finding is in use). */
  updateFinding(workspaceId: string, findingId: string, patch: Partial<Finding>, ttl?: number): Promise<Finding | null>;
  /** False when it did not exist. */
  deleteFinding(workspaceId: string, findingId: string): Promise<boolean>;
  /**
   * Deletes the partition's items except META and the rate counters (a reset must not reset the
   * hourly cap, and META is rewritten in place so the session stays valid throughout). Returns the count.
   */
  clearWorkspace(workspaceId: string): Promise<number>;
}

export const wsPk = (workspaceId: string) => `WS#${workspaceId}`;
export const metaKey = (workspaceId: string) => ({ PK: wsPk(workspaceId), SK: 'META' });
export const findingKey = (workspaceId: string, findingId: string) => ({ PK: wsPk(workspaceId), SK: `FINDING#${findingId}` });
export const ttlFrom = (now: Date, days: number) => Math.floor(now.getTime() / 1000) + days * 86_400;
export const ANALYSIS_TTL = (now: Date) => ttlFrom(now, ANALYSIS_TTL_DAYS);

const SUMMARY_FIELDS = ['analysisId', 'question', 'origin', 'status', 'stage', 'createdAt', 'completedAt', 'seeded'] as const;

function toSummary(r: Record<string, unknown>): AnalysisListItem {
  const out: Record<string, unknown> = {};
  for (const f of SUMMARY_FIELDS) if (r[f] !== undefined) out[f] = r[f];
  return out as AnalysisListItem;
}

const strip = <T>(item: Record<string, unknown>): T => {
  const { PK: _pk, SK: _sk, ttl: _ttl, ...rest } = item;
  return rest as T;
};

/** Opaque list cursor: the last key, base64url JSON, checked against the caller's partition on the way back in. */
function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid cursor');
    this.name = 'InvalidCursorError';
  }
}

function decodeCursor(cursor: string | undefined, workspaceId: string, prefix: string): Record<string, string> | undefined {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (key.PK === wsPk(workspaceId) && typeof key.SK === 'string' && key.SK.startsWith(prefix) && Object.keys(key).length === 2) return key as Record<string, string>;
  } catch {
    // fall through
  }
  throw new InvalidCursorError();
}

const isConditionFailure = (err: unknown) => err instanceof ConditionalCheckFailedException || (err as { name?: string })?.name === 'ConditionalCheckFailedException';

/* ------------------------------------------------------------------ DynamoDB */

export class DynamoWorkspaceStore implements WorkspaceStore {
  constructor(
    private readonly doc: Pick<DynamoDBDocumentClient, 'send'>,
    private readonly tableName: string,
  ) {}

  private async send<T>(command: unknown): Promise<T> {
    return (await this.doc.send(command as never)) as T;
  }

  private async conditional(command: unknown): Promise<boolean> {
    try {
      await this.send(command);
      return true;
    } catch (err) {
      if (isConditionFailure(err)) return false;
      throw err;
    }
  }

  async getMeta(workspaceId: string): Promise<WorkspaceMeta | null> {
    const out = await this.send<{ Item?: Record<string, unknown> }>(new GetCommand({ TableName: this.tableName, Key: metaKey(workspaceId) }));
    if (!out.Item) return null;
    const { PK: _pk, SK: _sk, ...rest } = out.Item;
    return rest as unknown as WorkspaceMeta;
  }

  createMeta(meta: WorkspaceMeta): Promise<boolean> {
    return this.conditional(new PutCommand({ TableName: this.tableName, Item: { ...metaKey(meta.workspaceId), ...meta }, ConditionExpression: 'attribute_not_exists(PK)' }));
  }

  async putMeta(meta: WorkspaceMeta): Promise<void> {
    await this.send(new PutCommand({ TableName: this.tableName, Item: { ...metaKey(meta.workspaceId), ...meta } }));
  }

  extendMeta(workspaceId: string, ttl: number): Promise<boolean> {
    return this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: metaKey(workspaceId),
        UpdateExpression: 'SET #ttl = :ttl',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':ttl': ttl },
      }),
    );
  }

  incrementCounter(pk: string, sk: string, cap: number, ttl: number): Promise<boolean> {
    return this.conditional(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk, SK: sk },
        UpdateExpression: 'ADD n :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(n) OR n < :cap',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':cap': cap, ':ttl': ttl },
      }),
    );
  }

  async listAnalyses(workspaceId: string, opts: { status?: AnalysisStatus; cursor?: string; limit: number }): Promise<Page<AnalysisListItem>> {
    const out = await this.send<{ Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> }>(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ...(opts.status ? { FilterExpression: '#status = :status' } : {}),
        ProjectionExpression: 'PK, SK, analysisId, question, origin, #status, stage, createdAt, completedAt, seeded',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':pk': wsPk(workspaceId), ':prefix': 'ANALYSIS#', ...(opts.status ? { ':status': opts.status } : {}) },
        ScanIndexForward: false,
        Limit: opts.limit,
        ...(opts.cursor ? { ExclusiveStartKey: decodeCursor(opts.cursor, workspaceId, 'ANALYSIS#') } : {}),
      }),
    );
    const nextCursor = encodeCursor(out.LastEvaluatedKey);
    return { items: (out.Items ?? []).map(toSummary), ...(nextCursor ? { nextCursor } : {}) };
  }

  async getContext(workspaceId: string, analysisId: string): Promise<ContextSnapshot | null> {
    const out = await this.send<{ Item?: Record<string, unknown> }>(new GetCommand({ TableName: this.tableName, Key: contextKey(workspaceId, analysisId) }));
    return out.Item ? strip<ContextSnapshot>(out.Item) : null;
  }

  async putSeedAnalysis(record: AnalysisRecord & { seeded: true }, context: ContextSnapshot | null): Promise<void> {
    await this.send(new PutCommand({ TableName: this.tableName, Item: { ...analysisKey(record.workspaceId, record.analysisId), ...record } }));
    if (context) await this.send(new PutCommand({ TableName: this.tableName, Item: { ...contextKey(record.workspaceId, record.analysisId), ...context, ttl: record.ttl } }));
  }

  private async queryAll(workspaceId: string, prefix: string | null, projection?: string): Promise<Array<Record<string, unknown>>> {
    const items: Array<Record<string, unknown>> = [];
    let start: Record<string, unknown> | undefined;
    do {
      const out = await this.send<{ Items?: Array<Record<string, unknown>>; LastEvaluatedKey?: Record<string, unknown> }>(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: prefix ? 'PK = :pk AND begins_with(SK, :prefix)' : 'PK = :pk',
          ExpressionAttributeValues: { ':pk': wsPk(workspaceId), ...(prefix ? { ':prefix': prefix } : {}) },
          ...(projection ? { ProjectionExpression: projection } : {}),
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      items.push(...(out.Items ?? []));
      start = out.LastEvaluatedKey;
    } while (start);
    return items;
  }

  /** Select COUNT over one SK prefix, paginated (a COUNT still pages at 1 MB of items scanned). */
  private async count(workspaceId: string, prefix: string): Promise<number> {
    let n = 0;
    let start: Record<string, unknown> | undefined;
    do {
      const out = await this.send<{ Count?: number; LastEvaluatedKey?: Record<string, unknown> }>(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': wsPk(workspaceId), ':prefix': prefix },
          Select: 'COUNT',
          ...(start ? { ExclusiveStartKey: start } : {}),
        }),
      );
      n += out.Count ?? 0;
      start = out.LastEvaluatedKey;
    } while (start);
    return n;
  }

  countAnalyses(workspaceId: string): Promise<number> {
    return this.count(workspaceId, 'ANALYSIS#');
  }

  async listFindings(workspaceId: string): Promise<Finding[]> {
    return (await this.queryAll(workspaceId, 'FINDING#')).map((i) => strip<Finding>(i));
  }

  countFindings(workspaceId: string): Promise<number> {
    return this.count(workspaceId, 'FINDING#');
  }

  async getFinding(workspaceId: string, findingId: string): Promise<Finding | null> {
    const out = await this.send<{ Item?: Record<string, unknown> }>(new GetCommand({ TableName: this.tableName, Key: findingKey(workspaceId, findingId) }));
    return out.Item ? strip<Finding>(out.Item) : null;
  }

  createFinding(workspaceId: string, finding: Finding, ttl: number): Promise<boolean> {
    return this.conditional(
      new PutCommand({ TableName: this.tableName, Item: { ...findingKey(workspaceId, finding.findingId), ...finding, ttl }, ConditionExpression: 'attribute_not_exists(PK)' }),
    );
  }

  async updateFinding(workspaceId: string, findingId: string, patch: Partial<Finding>, ttl?: number): Promise<Finding | null> {
    const entries: Array<[string, unknown]> = [...Object.entries(patch).filter(([, v]) => v !== undefined), ...(ttl !== undefined ? [['ttl', ttl] as [string, unknown]] : [])];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const sets = entries.map(([k, v], i) => {
      names[`#f${i}`] = k;
      values[`:v${i}`] = v;
      return `#f${i} = :v${i}`;
    });
    try {
      const out = await this.send<{ Attributes?: Record<string, unknown> }>(
        new UpdateCommand({
          TableName: this.tableName,
          Key: findingKey(workspaceId, findingId),
          UpdateExpression: `SET ${sets.join(', ')}`,
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ReturnValues: 'ALL_NEW',
        }),
      );
      return out.Attributes ? strip<Finding>(out.Attributes) : null;
    } catch (err) {
      if (isConditionFailure(err)) return null;
      throw err;
    }
  }

  deleteFinding(workspaceId: string, findingId: string): Promise<boolean> {
    return this.conditional(new DeleteCommand({ TableName: this.tableName, Key: findingKey(workspaceId, findingId), ConditionExpression: 'attribute_exists(PK)' }));
  }

  async clearWorkspace(workspaceId: string): Promise<number> {
    const keys = (await this.queryAll(workspaceId, null, 'PK, SK'))
      .filter((k) => k.SK !== 'META' && !String(k.SK).startsWith('RATE#'))
      .map((k) => ({ PK: k.PK, SK: k.SK }));
    for (let i = 0; i < keys.length; i += 25) {
      let requests: unknown[] = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 4) throw new Error('reset: unprocessed deletes after retries');
        const out = await this.send<{ UnprocessedItems?: Record<string, unknown[]> }>(new BatchWriteCommand({ RequestItems: { [this.tableName]: requests as never } }));
        requests = out.UnprocessedItems?.[this.tableName] ?? [];
        if (requests.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    return keys.length;
  }
}

/* -------------------------------------------------------------------- memory */

/** In-memory twin. It shares the MemoryAnalysisStore's records so the analysis list sees job transitions. */
export class MemoryWorkspaceStore implements WorkspaceStore {
  readonly metas = new Map<string, WorkspaceMeta>();
  readonly counters = new Map<string, number>();
  readonly findings = new Map<string, Map<string, Finding>>();

  constructor(readonly analyses: MemoryAnalysisStore) {}

  async getMeta(workspaceId: string) {
    const m = this.metas.get(workspaceId);
    return m ? structuredClone(m) : null;
  }

  async createMeta(meta: WorkspaceMeta) {
    if (this.metas.has(meta.workspaceId)) return false;
    this.metas.set(meta.workspaceId, structuredClone(meta));
    return true;
  }

  async putMeta(meta: WorkspaceMeta) {
    this.metas.set(meta.workspaceId, structuredClone(meta));
  }

  async extendMeta(workspaceId: string, ttl: number) {
    const m = this.metas.get(workspaceId);
    if (!m) return false;
    m.ttl = ttl;
    return true;
  }

  async incrementCounter(pk: string, sk: string, cap: number) {
    const key = `${pk}|${sk}`;
    const n = this.counters.get(key) ?? 0;
    if (n >= cap) return false;
    this.counters.set(key, n + 1);
    return true;
  }

  private records(workspaceId: string): AnalysisRecord[] {
    return [...this.analyses.records.values()].filter((r) => r.workspaceId === workspaceId).sort((a, b) => (a.analysisId < b.analysisId ? 1 : -1));
  }

  async listAnalyses(workspaceId: string, opts: { status?: AnalysisStatus; cursor?: string; limit: number }): Promise<Page<AnalysisListItem>> {
    const start = decodeCursor(opts.cursor, workspaceId, 'ANALYSIS#');
    const all = this.records(workspaceId);
    const from = start ? all.findIndex((r) => `ANALYSIS#${r.analysisId}` === start.SK) + 1 : 0;
    const page = all.slice(from, from + opts.limit);
    const last = page.at(-1);
    const more = from + opts.limit < all.length;
    return {
      items: page.filter((r) => !opts.status || r.status === opts.status).map((r) => toSummary(r as unknown as Record<string, unknown>)),
      ...(more && last ? { nextCursor: encodeCursor(analysisKey(workspaceId, last.analysisId)) } : {}),
    };
  }

  async getContext(workspaceId: string, analysisId: string) {
    const c = this.analyses.contexts.get(`${workspaceId}/${analysisId}`);
    return c ? structuredClone(c) : null;
  }

  async putSeedAnalysis(record: AnalysisRecord & { seeded: true }, context: ContextSnapshot | null) {
    this.analyses.records.set(`${record.workspaceId}/${record.analysisId}`, structuredClone(record));
    if (context) this.analyses.contexts.set(`${record.workspaceId}/${record.analysisId}`, structuredClone(context));
  }

  private bucket(workspaceId: string) {
    let b = this.findings.get(workspaceId);
    if (!b) this.findings.set(workspaceId, (b = new Map()));
    return b;
  }

  async countAnalyses(workspaceId: string) {
    return this.records(workspaceId).length;
  }

  async listFindings(workspaceId: string) {
    return [...this.bucket(workspaceId).values()].map((f) => structuredClone(f));
  }

  async countFindings(workspaceId: string) {
    return this.bucket(workspaceId).size;
  }

  async getFinding(workspaceId: string, findingId: string) {
    const f = this.bucket(workspaceId).get(findingId);
    return f ? structuredClone(f) : null;
  }

  async createFinding(workspaceId: string, finding: Finding) {
    const b = this.bucket(workspaceId);
    if (b.has(finding.findingId)) return false;
    b.set(finding.findingId, structuredClone(finding));
    return true;
  }

  async updateFinding(workspaceId: string, findingId: string, patch: Partial<Finding>) {
    const b = this.bucket(workspaceId);
    const f = b.get(findingId);
    if (!f) return null;
    const next = { ...f, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Finding;
    b.set(findingId, next);
    return structuredClone(next);
  }

  async deleteFinding(workspaceId: string, findingId: string) {
    return this.bucket(workspaceId).delete(findingId);
  }

  async clearWorkspace(workspaceId: string) {
    let n = 0;
    n += this.bucket(workspaceId).size;
    this.findings.delete(workspaceId);
    for (const key of [...this.analyses.records.keys()]) {
      if (key.startsWith(`${workspaceId}/`)) {
        this.analyses.records.delete(key);
        n++;
      }
    }
    for (const key of [...this.analyses.contexts.keys()]) {
      if (key.startsWith(`${workspaceId}/`)) {
        this.analyses.contexts.delete(key);
        n++;
      }
    }
    return n;
  }
}

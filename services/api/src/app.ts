import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  type AnalysisDetail,
  type AnalysisContextResponse,
  type CompaniesResponse,
  CompareQuerySchema,
  type CompanyIntelligenceProfile,
  CreateAnalysisRequestSchema,
  type CreateAnalysisResponse,
  CreateFindingRequestSchema,
  type ErrorCode,
  type HealthResponse,
  ListAnalysesQuerySchema,
  ListFindingsQuerySchema,
  PAGE_LIMIT_DEFAULT,
  PatchFindingRequestSchema,
  type RetrievalDebugRequest,
  RetrievalDebugRequestSchema,
  type SessionResponse,
  type WorkspaceResponse,
  composeCompare,
  isCatalogTicker,
} from '@diligenceiq/core';
import type { ZodType } from 'zod';
import type { AnalysisQueue } from './analyses/queue';
import type { AnalysisRecord, AnalysisStore } from './analyses/store';
import { error, json, log, noContent, type HttpResponse } from './http';
import { newAnalysisId } from './ids';
import type { KillSwitch } from './kill-switch';
import type { ProfileProvider } from './profiles/provider';
import {
  SESSION_MAX_AGE_S,
  type SessionSecret,
  SessionUnavailableError,
  clientKey,
  encodeSessionValue,
  newWorkspaceId,
  readCookie,
  sessionCookieName,
  sessionSetCookie,
  verifySessionValue,
} from './session/session';
import { createFinding } from './workspace/findings';
import { type Seed, applySeed } from './workspace/seed';
import { InvalidCursorError, WORKSPACE_TTL_DAYS, type WorkspaceMeta, type WorkspaceStore, ttlFrom, wsPk } from './workspace/store';

export const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTED_ISSUES = 10;
export const POLL_AFTER_MS = 1_500;
const COUNTER_TTL_DAYS = 2;
/** A returning visitor's workspace expiry is moved out at most once a day: only when under 29 days remain (architecture §8). */
const META_EXTEND_BELOW_S = (WORKSPACE_TTL_DAYS - 1) * 86_400;

/**
 * Retrieval-only inspection (SPEC §27.3). Development only: it needs the in-memory index and a
 * query embedding, which the deployed api Lambda has neither of (no Bedrock permission, no
 * index). The deployed handler never passes it, so the route does not exist in production;
 * `pnpm retrieval:debug` serves it locally.
 */
export type RetrievalDebug = (request: RetrievalDebugRequest, requestId: string) => Promise<unknown>;

/** Spend caps (SPEC §35.11; architecture §11), environment-configurable in the handler. */
export interface AppCaps {
  workspaceHourlyAnalyses: number;
  globalDailyAnalyses: number;
  dailyWorkspaceCreations: number;
  /** New workspaces per client (salted source-IP hash) per day, checked before the global cap so one client cannot drain it. */
  perClientDailyWorkspaceCreations: number;
}

export const DEFAULT_CAPS: AppCaps = { workspaceHourlyAnalyses: 10, globalDailyAnalyses: 200, dailyWorkspaceCreations: 500, perClientDailyWorkspaceCreations: 100 };

export interface AppDeps {
  killSwitch: KillSwitch;
  sessionSecret: SessionSecret;
  analyses: AnalysisStore;
  workspace: WorkspaceStore;
  queue: AnalysisQueue;
  profiles: ProfileProvider;
  /** The demo seed; null seeds nothing (a missing seed never blocks a session). */
  seed: Seed | null;
  /** The index the worker searches (null when not configured). */
  indexVersion: string | null;
  /** Whether the worker's index manifest is readable (cached by the caller). */
  indexAvailable: (requestId: string) => Promise<boolean>;
  caps?: AppCaps;
  /** False only for the local http server; production cookies are always Secure. */
  secureCookies?: boolean;
  retrievalDebug?: RetrievalDebug;
  now?: () => Date;
}

interface RequestContext {
  event: APIGatewayProxyEventV2;
  requestId: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

interface SessionContext extends RequestContext {
  workspaceId: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  /** Requires a valid session; the handler is scoped to the caller's partition. */
  session: boolean;
  handler: (ctx: SessionContext) => Promise<HttpResponse>;
}

/** `/api/analyses/:id` → a matcher with named params. Params are URL-safe IDs only. */
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    keys.push(k);
    return '([A-Za-z0-9_-]{1,64})';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date());
  const caps = deps.caps ?? DEFAULT_CAPS;
  const cookieOpts = { secure: deps.secureCookies ?? true };
  const cookieName = sessionCookieName(cookieOpts.secure);
  /** META as a session: absent, or past its TTL (DynamoDB deletes expired items lazily, up to days later), is no workspace. */
  const liveMeta = async (workspaceId: string, at: Date): Promise<WorkspaceMeta | null> => {
    const meta = await deps.workspace.getMeta(workspaceId);
    return meta && meta.ttl > Math.floor(at.getTime() / 1000) ? meta : null;
  };
  const routes: Route[] = [];
  const add = (method: string, path: string, session: boolean, handler: Route['handler']) => routes.push({ method, ...compile(path), session, handler });

  const validation = (requestId: string, issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>, message = 'Request is invalid.') =>
    error('VALIDATION_ERROR', message, requestId, { issues: summarizeIssues(issues) });

  const parse = <T>(schema: ZodType<T>, value: unknown, requestId: string): { ok: true; data: T } | { ok: false; response: HttpResponse } => {
    const r = schema.safeParse(value);
    return r.success ? { ok: true, data: r.data } : { ok: false, response: validation(requestId, r.error.issues) };
  };

  const fail = (code: ErrorCode, message: string, requestId: string, details?: Record<string, unknown>) => error(code, message, requestId, details);

  /* ---------------------------------------------------------------- public */

  add('GET', '/api/health', false, async ({ requestId }) => {
    const [enabled, set, indexAvailable] = await Promise.all([deps.killSwitch.analysesEnabled(requestId), deps.profiles.active(requestId), deps.indexAvailable(requestId)]);
    const body: HealthResponse = {
      status: 'ok',
      indexVersion: deps.indexVersion,
      indexAvailable,
      profileSetId: set?.profileSetId ?? null,
      profileIndexVersion: set?.indexVersion ?? null,
      analysesEnabled: enabled,
    };
    return json(200, body, requestId);
  });

  /**
   * Creates the caller's workspace on first visit, or confirms an existing one (idempotent) and
   * moves its expiry out (architecture §8). A new workspace counts first against the caller's
   * per-client daily limit, then against the global daily creation cap, so clearing cookies
   * cannot mint unlimited workspaces and one client cannot use up everyone's (architecture §11).
   * It is seeded from real pipeline output; a seed failure never withholds the session.
   */
  add('POST', '/api/session', false, async ({ event, requestId }) => {
    const secret = await deps.sessionSecret.get(requestId);
    const existing = verifySessionValue(secret, readCookie(event, cookieName));
    const at = now();
    if (existing) {
      const meta = await liveMeta(existing, at);
      if (meta) {
        // At most once a day per workspace: one small UpdateItem, only when under 29 days remain.
        const extended = ttlFrom(at, WORKSPACE_TTL_DAYS);
        const due = meta.ttl < Math.floor(at.getTime() / 1000) + META_EXTEND_BELOW_S;
        const ttl = due && (await deps.workspace.extendMeta(existing, extended)) ? extended : meta.ttl;
        return sessionResponse(existing, false, ttl, secret, requestId);
      }
    }
    const day = at.toISOString().slice(0, 10);
    const counterTtl = ttlFrom(at, COUNTER_TTL_DAYS);
    const client = clientKey(secret, event.requestContext?.http?.sourceIp);
    if (!(await deps.workspace.incrementCounter('GLOBAL', `WSCREATE#${day}#${client}`, caps.perClientDailyWorkspaceCreations, counterTtl))) {
      return fail('RATE_LIMITED', 'This network has opened its limit of new demo workspaces for today. Try again tomorrow.', requestId, { scope: 'workspace_creation_client', retryAfter: nextUtcDay(at) });
    }
    if (!(await deps.workspace.incrementCounter('GLOBAL', `WSCREATE#${day}`, caps.dailyWorkspaceCreations, counterTtl))) {
      return fail('RATE_LIMITED', 'The demo has reached its limit of new workspaces for today. Try again tomorrow.', requestId, { scope: 'workspace_creation', retryAfter: nextUtcDay(at) });
    }
    const workspaceId = newWorkspaceId();
    const ttl = ttlFrom(at, WORKSPACE_TTL_DAYS);
    await deps.workspace.createMeta({ workspaceId, createdAt: at.toISOString(), seedVersion: deps.seed?.seedVersion ?? null, ttl });
    await seedSafely(workspaceId, at, requestId);
    log('info', 'workspace created', { requestId, workspaceId, seedVersion: deps.seed?.seedVersion ?? null });
    return sessionResponse(workspaceId, true, ttl, secret, requestId);
  });

  /** A failed seed leaves a usable, partly or wholly empty workspace and is logged; the visitor keeps the session (and the slot it used). */
  const seedSafely = async (workspaceId: string, at: Date, requestId: string) => {
    if (!deps.seed) return;
    try {
      await applySeed({ analyses: deps.analyses, workspace: deps.workspace, profiles: deps.profiles }, workspaceId, deps.seed, at, requestId);
    } catch (err) {
      log('error', 'seed failed; workspace left unseeded', { requestId, workspaceId, errorName: err instanceof Error ? err.name : 'Unknown' });
    }
  };

  const sessionResponse = (workspaceId: string, created: boolean, ttl: number, secret: string, requestId: string) => {
    const body: SessionResponse = { workspaceId, created, expiresAt: new Date(ttl * 1000).toISOString() };
    return json(200, body, requestId, { cookies: [sessionSetCookie(encodeSessionValue(secret, workspaceId), cookieOpts)] });
  };

  /* ------------------------------------------------------------- workspace */

  add('GET', '/api/workspace', true, async ({ workspaceId, requestId }) => {
    const [meta, page, analysisCount, findings] = await Promise.all([deps.workspace.getMeta(workspaceId), deps.workspace.listAnalyses(workspaceId, { limit: 10 }), deps.workspace.countAnalyses(workspaceId), deps.workspace.listFindings(workspaceId)]);
    const sorted = findings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const body: WorkspaceResponse = {
      workspaceId,
      createdAt: meta?.createdAt ?? '',
      seedVersion: meta?.seedVersion ?? null,
      stats: { analyses: analysisCount, findings: findings.length },
      recentAnalyses: page.items,
      recentFindings: sorted.slice(0, 10),
      watchlist: [],
    };
    return json(200, body, requestId);
  });

  /**
   * Deletes and reseeds only the caller's partition (SPEC §40). The rate counters survive a reset,
   * and META is never deleted (it is rewritten in place), so a request that arrives mid-reset still
   * has its session instead of minting a new workspace.
   */
  add('POST', '/api/workspace/reset', true, async ({ workspaceId, requestId }) => {
    const at = now();
    const removed = await deps.workspace.clearWorkspace(workspaceId);
    await deps.workspace.putMeta({ workspaceId, createdAt: at.toISOString(), seedVersion: deps.seed?.seedVersion ?? null, ttl: ttlFrom(at, WORKSPACE_TTL_DAYS) });
    await seedSafely(workspaceId, at, requestId);
    log('info', 'workspace reset', { requestId, workspaceId, removed });
    return json(200, { workspaceId, reset: true, seedVersion: deps.seed?.seedVersion ?? null }, requestId);
  });

  /* ------------------------------------------- Company Intelligence, Compare */

  add('GET', '/api/companies', true, async ({ requestId }) => {
    const set = await deps.profiles.active(requestId);
    const body: CompaniesResponse = {
      indexVersion: set?.indexVersion ?? deps.indexVersion,
      profileSetId: set?.profileSetId ?? null,
      companies: (set?.manifest.companies ?? []).map(({ ticker, company, sector, tier, filings, periodsCovered, headline }) => ({
        ticker,
        company,
        sector,
        tier,
        filings,
        periodsCovered,
        ...(headline ? { headline } : {}),
      })),
    };
    return json(200, body, requestId);
  });

  add('GET', '/api/companies/:ticker/intelligence', true, async ({ params, requestId }) => {
    const ticker = params.ticker ?? '';
    if (!isCatalogTicker(ticker)) return fail('VALIDATION_ERROR', 'Unknown company ticker.', requestId);
    const profile = await deps.profiles.get(ticker, requestId);
    if (!profile) return fail('PROFILE_MISSING', 'Intelligence for this company is not built for the current index version.', requestId, { ticker });
    return json(200, profile, requestId);
  });

  add('GET', '/api/compare', true, async ({ query, requestId }) => {
    const q = parse(CompareQuerySchema, query, requestId);
    if (!q.ok) return q.response;
    const tickers = q.data.tickers;
    if (tickers.some((t) => !isCatalogTicker(t))) return fail('VALIDATION_ERROR', 'Unknown company ticker.', requestId);
    const profiles = new Map<string, CompanyIntelligenceProfile>();
    for (const t of new Set(tickers)) {
      const p = await deps.profiles.get(t, requestId);
      if (p) profiles.set(t, p);
    }
    const out = composeCompare(tickers, profiles);
    if (!out.ok && out.code === 'VALIDATION_ERROR') return fail('VALIDATION_ERROR', out.message, requestId);
    if (!out.ok) return fail('PROFILE_MISSING', 'Compare needs at least two companies with intelligence built.', requestId, { missing: out.missing });
    return json(200, out.result, requestId);
  });

  /* -------------------------------------------------------------- analyses */

  /**
   * Starts an analysis (architecture §4.1): kill switch, validation, caps, a QUEUED record, then
   * the queue message. Only an explicit Run reaches here; a prefilled form never posts.
   */
  add('POST', '/api/analyses', true, async ({ event, workspaceId, requestId }) => {
    const body = readJsonBody(event, requestId);
    if (!body.ok) return body.response;
    const req = parse(CreateAnalysisRequestSchema, body.value, requestId);
    if (!req.ok) return req.response;
    const origin = req.data.origin ?? { kind: 'direct' as const };
    const tickers = [...(req.data.filters?.tickers ?? []), ...('ticker' in origin ? [origin.ticker] : []), ...('tickers' in origin ? origin.tickers : [])];
    if (tickers.some((t) => !isCatalogTicker(t))) return fail('VALIDATION_ERROR', 'Unknown company ticker.', requestId);

    if (!(await deps.killSwitch.analysesEnabled(requestId))) {
      return fail('ANALYSES_DISABLED', 'New analyses are paused right now.', requestId);
    }

    const at = now();
    const iso = at.toISOString();
    const counterTtl = ttlFrom(at, COUNTER_TTL_DAYS);
    if (!(await deps.workspace.incrementCounter(wsPk(workspaceId), `RATE#${iso.slice(0, 13)}`, caps.workspaceHourlyAnalyses, counterTtl))) {
      return fail('RATE_LIMITED', `This workspace has run ${caps.workspaceHourlyAnalyses} analyses this hour, the hourly limit.`, requestId, { scope: 'workspace_hourly', retryAfter: nextUtcHour(at) });
    }
    if (!(await deps.workspace.incrementCounter('GLOBAL', `RATE#${iso.slice(0, 10)}`, caps.globalDailyAnalyses, counterTtl))) {
      return fail('RATE_LIMITED', 'The demo has reached its daily limit of analyses.', requestId, { scope: 'global_daily', retryAfter: nextUtcDay(at) });
    }

    const analysisId = newAnalysisId(at);
    await deps.analyses.createQueued({ workspaceId, analysisId, question: req.data.question, ...(req.data.filters ? { filters: req.data.filters } : {}), origin, now: at });
    try {
      await deps.queue.send({ workspaceId, analysisId });
    } catch (err) {
      log('error', 'enqueue failed', { requestId, workspaceId, analysisId, errorName: err instanceof Error ? err.name : 'Unknown' });
      await deps.analyses.failQueued(workspaceId, analysisId, { code: 'ENQUEUE_FAILED', message: 'The analysis could not be queued. Run it again.', requestId }, now()).catch(() => false);
      return fail('ENQUEUE_FAILED', 'The analysis could not be queued. Run it again in a moment.', requestId, { analysisId });
    }
    log('info', 'analysis queued', { requestId, workspaceId, analysisId, originKind: origin.kind, questionChars: req.data.question.length });
    const res: CreateAnalysisResponse = { analysisId, status: 'QUEUED', pollAfterMs: POLL_AFTER_MS };
    return json(202, res, requestId);
  });

  add('GET', '/api/analyses', true, async ({ query, workspaceId, requestId }) => {
    const q = parse(ListAnalysesQuerySchema, query, requestId);
    if (!q.ok) return q.response;
    const page = await deps.workspace.listAnalyses(workspaceId, { ...(q.data.status ? { status: q.data.status } : {}), ...(q.data.cursor ? { cursor: q.data.cursor } : {}), limit: q.data.limit ?? PAGE_LIMIT_DEFAULT });
    return json(200, page, requestId);
  });

  /** The poll. A job past its deadline is failed here, lazily (architecture §4.3): this is the real recovery path. */
  add('GET', '/api/analyses/:id', true, async ({ params, workspaceId, requestId }) => {
    const id = params.id ?? '';
    let record = await deps.analyses.get(workspaceId, id);
    if (!record) return fail('NOT_FOUND', 'Analysis not found.', requestId);
    const at = now();
    if ((record.status === 'QUEUED' || record.status === 'RUNNING') && record.deadlineAt < at.toISOString()) {
      const code = await deps.analyses.expireIfPastDeadline(workspaceId, id, at, requestId);
      if (code) log('warn', 'analysis expired on poll', { requestId, workspaceId, analysisId: id, code });
      record = (await deps.analyses.get(workspaceId, id)) ?? record;
    }
    return json(200, toDetail(record), requestId);
  });

  add('GET', '/api/analyses/:id/context', true, async ({ params, workspaceId, requestId }) => {
    const id = params.id ?? '';
    const record = await deps.analyses.get(workspaceId, id);
    if (!record) return fail('NOT_FOUND', 'Analysis not found.', requestId);
    const snapshot = await deps.workspace.getContext(workspaceId, id);
    if (!snapshot) return fail('NOT_FOUND', 'The context snapshot for this analysis is unavailable.', requestId, { snapshot: 'missing' });
    // Snapshot entries carry indexVersion once, on the snapshot; each passage gets it here (a Citation).
    const passages = (snapshot.passages as Array<Record<string, unknown>>).map((p) => ({ ...p, indexVersion: snapshot.indexVersion })) as unknown as AnalysisContextResponse['passages'];
    const body: AnalysisContextResponse = { indexVersion: snapshot.indexVersion, passages };
    return json(200, body, requestId);
  });

  /* -------------------------------------------------------------- findings */

  add('GET', '/api/findings', true, async ({ query, workspaceId, requestId }) => {
    const q = parse(ListFindingsQuerySchema, query, requestId);
    if (!q.ok) return q.response;
    const f = q.data;
    const all = (await deps.workspace.listFindings(workspaceId))
      .filter(
        (x) =>
          (!f.theme || x.theme === f.theme) &&
          (!f.ticker || x.tickers.includes(f.ticker)) &&
          (!f.status || x.status === f.status) &&
          (!f.origin || x.origin.kind === f.origin) &&
          (!f.analysisId || x.analysisId === f.analysisId) &&
          (!f.from || x.createdAt >= f.from) &&
          (!f.to || x.createdAt.slice(0, 10) <= f.to.slice(0, 10)) &&
          (!f.pinned || x.pinnedToIC === (f.pinned === 'true')),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.findingId.localeCompare(b.findingId));
    // The finding list is small and capped, so the cursor is a plain offset.
    const offset = f.cursor ? Number.parseInt(f.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0 || String(offset) !== (f.cursor ?? '0')) return fail('VALIDATION_ERROR', 'Invalid cursor.', requestId);
    const limit = f.limit ?? PAGE_LIMIT_DEFAULT;
    const items = all.slice(offset, offset + limit);
    return json(200, { items, ...(offset + limit < all.length ? { nextCursor: String(offset + limit) } : {}) }, requestId);
  });

  add('POST', '/api/findings', true, async ({ event, workspaceId, requestId }) => {
    const body = readJsonBody(event, requestId);
    if (!body.ok) return body.response;
    const req = parse(CreateFindingRequestSchema, body.value, requestId);
    if (!req.ok) return req.response;
    const out = await createFinding({ analyses: deps.analyses, workspace: deps.workspace, profiles: deps.profiles }, workspaceId, req.data, now(), requestId);
    return out.ok ? json(201, out.finding, requestId) : fail(out.code, out.message, requestId);
  });

  add('PATCH', '/api/findings/:id', true, async ({ event, params, workspaceId, requestId }) => {
    const body = readJsonBody(event, requestId);
    if (!body.ok) return body.response;
    const req = parse(PatchFindingRequestSchema, body.value, requestId);
    if (!req.ok) return req.response;
    const { note, ...rest } = req.data;
    const at = now();
    // An empty note clears it (stored as an empty string; the UI treats both as no note). An edited
    // finding is in use, so its own 30-day TTL restarts (architecture §8).
    const updated = await deps.workspace.updateFinding(workspaceId, params.id ?? '', { ...rest, ...(note !== undefined ? { note } : {}), updatedAt: at.toISOString() }, ttlFrom(at, WORKSPACE_TTL_DAYS));
    return updated ? json(200, updated, requestId) : fail('NOT_FOUND', 'Finding not found.', requestId);
  });

  add('DELETE', '/api/findings/:id', true, async ({ params, workspaceId, requestId }) =>
    (await deps.workspace.deleteFinding(workspaceId, params.id ?? '')) ? noContent(requestId) : fail('NOT_FOUND', 'Finding not found.', requestId),
  );

  const retrievalDebug = deps.retrievalDebug;
  if (retrievalDebug) {
    add('POST', '/api/retrieval/debug', false, async ({ event, requestId }) => {
      const body = readJsonBody(event, requestId);
      if (!body.ok) return body.response;
      const req = parse(RetrievalDebugRequestSchema, body.value, requestId);
      if (!req.ok) return req.response;
      return json(200, await retrievalDebug(req.data, requestId), requestId);
    });
  }

  return async function handle(event: APIGatewayProxyEventV2): Promise<HttpResponse> {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const method = event.requestContext?.http?.method?.toUpperCase() ?? '';
    const path = normalizePath(event.rawPath ?? '');
    let matched: { route: Route; params: Record<string, string> } | null = null;
    let pathMatched = false;
    for (const route of routes) {
      const m = route.pattern.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      matched = { route, params: Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1] ?? ''])) };
      break;
    }
    if (!matched) return error('NOT_FOUND', pathMatched ? 'Method not allowed on this route.' : 'Route not found.', requestId);
    const query = Object.fromEntries(Object.entries(event.queryStringParameters ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const routeName = `${method} ${matched.route.pattern.source}`;
    try {
      let workspaceId = '';
      if (matched.route.session) {
        const secret = await deps.sessionSecret.get(requestId);
        const id = verifySessionValue(secret, readCookie(event, cookieName));
        if (!id || !(await liveMeta(id, now()))) return error('SESSION_REQUIRED', 'Your demo session has expired. Reload the page to start a new one.', requestId);
        workspaceId = id;
      }
      return await matched.route.handler({ event, requestId, params: matched.params, query, workspaceId });
    } catch (err) {
      if (err instanceof InvalidCursorError) return error('VALIDATION_ERROR', 'Invalid cursor.', requestId);
      if (err instanceof SessionUnavailableError) {
        log('error', 'sessions unavailable', { requestId, route: routeName, reason: err.message });
        return error('INTERNAL', 'Sessions are unavailable right now. Try again shortly.', requestId);
      }
      log('error', 'unhandled route error', {
        requestId,
        route: routeName,
        errorName: err instanceof Error ? err.name : 'Unknown',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return error('INTERNAL', 'An unexpected error occurred.', requestId);
    }
  };
}

/** The poll body: the record without internal fields (claim token, TTL, partition). */
export function toDetail(r: AnalysisRecord & { seeded?: boolean }): AnalysisDetail {
  const detail: AnalysisDetail = {
    analysisId: r.analysisId,
    question: r.question,
    origin: r.origin,
    status: r.status,
    ...(r.stage ? { stage: r.stage } : {}),
    createdAt: r.createdAt,
    ...(r.completedAt ? { completedAt: r.completedAt } : {}),
    deadlineAt: r.deadlineAt,
    ...(r.filters ? { filters: r.filters } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.interpretation ? { interpretation: r.interpretation } : {}),
    ...(r.coverage ? { coverage: r.coverage } : {}),
    ...(r.brief ? { brief: r.brief } : {}),
    ...(r.citations ? { citations: r.citations } : {}),
    ...(r.validation ? { validation: r.validation } : {}),
    ...(r.telemetry ? { telemetry: r.telemetry } : {}),
    ...(r.seeded ? { seeded: true } : {}),
  };
  return detail;
}

function nextUtcHour(d: Date): string {
  const n = new Date(d);
  n.setUTCMinutes(0, 0, 0);
  n.setUTCHours(n.getUTCHours() + 1);
  return n.toISOString();
}

function nextUtcDay(d: Date): string {
  const n = new Date(d);
  n.setUTCHours(24, 0, 0, 0);
  return n.toISOString();
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function readJsonBody(
  event: APIGatewayProxyEventV2,
  requestId: string,
): { ok: true; value: unknown } | { ok: false; response: HttpResponse } {
  // JSON only (architecture §9): a form or text/plain body is refused, which also keeps a
  // cross-site "simple" request (no preflight) from reaching a write route.
  const type = (event.headers?.['content-type'] ?? event.headers?.['Content-Type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    return { ok: false, response: error('VALIDATION_ERROR', 'Request body must be sent as application/json.', requestId, { contentType: type || null }) };
  }
  const raw = event.body ?? '';
  const buf = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  if (buf.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: error('VALIDATION_ERROR', 'Request body is too large.', requestId, {
        maxBytes: MAX_BODY_BYTES,
      }),
    };
  }
  try {
    return { ok: true, value: JSON.parse(buf.toString('utf8')) };
  } catch {
    return {
      ok: false,
      response: error('VALIDATION_ERROR', 'Request body must be valid JSON.', requestId),
    };
  }
}

function summarizeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>) {
  return issues.slice(0, MAX_REPORTED_ISSUES).map((i) => ({
    path: i.path.map(String).join('.'),
    code: i.code,
    message: i.message,
  }));
}

export { SESSION_MAX_AGE_S };

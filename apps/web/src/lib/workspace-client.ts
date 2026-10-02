import type {
  AnalysisContextResponse,
  AnalysisDetail,
  AnalysisSummary,
  CompaniesResponse,
  CompanyIntelligenceProfile,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  CreateFindingRequest,
  Finding,
  HealthResponse,
  Page,
  PatchFindingRequest,
  SessionResponse,
} from '@diligenceiq/core';
import { ApiRequestError, apiJson } from './api';

/**
 * The session-scoped API (architecture §9) as the web uses it. `httpWorkspaceClient` is the
 * production client; tests pass an in-memory one (src/test/memory-client.ts).
 */
export interface WorkspaceClient {
  session(): Promise<SessionResponse>;
  health(): Promise<HealthResponse>;
  listAnalyses(): Promise<AnalysisSummary[]>;
  getAnalysis(id: string): Promise<AnalysisDetail>;
  getContext(id: string): Promise<AnalysisContextResponse | null>;
  createAnalysis(request: CreateAnalysisRequest): Promise<CreateAnalysisResponse>;
  listFindings(): Promise<Finding[]>;
  createFinding(request: CreateFindingRequest): Promise<Finding>;
  patchFinding(id: string, patch: PatchFindingRequest): Promise<Finding>;
  deleteFinding(id: string): Promise<void>;
  reset(): Promise<void>;
  companies(): Promise<CompaniesResponse>;
  /** Null when the active profile set has no profile for the ticker (PROFILE_MISSING). */
  profile(ticker: string): Promise<CompanyIntelligenceProfile | null>;
}

const LIST_LIMIT = 100;

/**
 * Same-origin calls through the `/api/<*>` rewrite. A request that finds its session expired
 * (401 SESSION_REQUIRED, e.g. the workspace's TTL passed) starts a new session once and retries.
 */
export function httpWorkspaceClient(): WorkspaceClient {
  let sessionPromise: Promise<SessionResponse> | null = null;
  const session = () => (sessionPromise ??= apiJson<SessionResponse>('/api/session', { method: 'POST' }).catch((err) => {
    sessionPromise = null;
    throw err;
  }));

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    // The session this request went out under. Concurrent 401s share ONE new session: only the
    // first replaces it; the others await that same request, so one workspace is minted, not several.
    const sentUnder = sessionPromise;
    try {
      return await apiJson<T>(path, init);
    } catch (err) {
      if (!(err instanceof ApiRequestError) || err.code !== 'SESSION_REQUIRED') throw err;
      if (sessionPromise === sentUnder) sessionPromise = null;
      await session();
      return apiJson<T>(path, init);
    }
  }

  async function all<T>(path: string): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | undefined;
    do {
      const sep = path.includes('?') ? '&' : '?';
      const page = await call<Page<T>>(`${path}${sep}limit=${LIST_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && items.length < 1000);
    return items;
  }

  return {
    session,
    health: () => apiJson<HealthResponse>('/api/health'),
    listAnalyses: () => all<AnalysisSummary>('/api/analyses'),
    getAnalysis: (id) => call<AnalysisDetail>(`/api/analyses/${encodeURIComponent(id)}`),
    async getContext(id) {
      try {
        return await call<AnalysisContextResponse>(`/api/analyses/${encodeURIComponent(id)}/context`);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'NOT_FOUND') return null;
        throw err;
      }
    },
    createAnalysis: (request) => call<CreateAnalysisResponse>('/api/analyses', { method: 'POST', body: request }),
    listFindings: () => all<Finding>('/api/findings'),
    createFinding: (request) => call<Finding>('/api/findings', { method: 'POST', body: request }),
    patchFinding: (id, patch) => call<Finding>(`/api/findings/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
    async deleteFinding(id) {
      await call<unknown>(`/api/findings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    async reset() {
      await call<unknown>('/api/workspace/reset', { method: 'POST' });
    },
    companies: () => call<CompaniesResponse>('/api/companies'),
    async profile(ticker) {
      try {
        return await call<CompanyIntelligenceProfile>(`/api/companies/${encodeURIComponent(ticker)}/intelligence`);
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'PROFILE_MISSING') return null;
        throw err;
      }
    },
  };
}

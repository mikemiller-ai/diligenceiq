import {
  type AdjacentEvidenceResponse,
  type SourceDocumentResponse,
  findingOriginKind,
  resolveSource,
  sourceKey,
  type AnalysisDetail,
  type Citation,
  type CompanyIntelligenceProfile,
  type Finding,
} from '@diligenceiq/core';
import { ApiRequestError } from '@/lib/api';
import type { WorkspaceClient } from '@/lib/workspace-client';

/**
 * TEST-ONLY in-memory WorkspaceClient. It mirrors the server rules the UI depends on: findings
 * are copied from stored content (core `resolveSource`, the function the api uses), saved once
 * per source, and every call is recorded so tests can assert what was (and was not) sent.
 */
export function createMemoryClient(opts: {
  analyses?: AnalysisDetail[];
  contexts?: Record<string, Citation[]>;
  findings?: Finding[];
  profiles?: ReadonlyMap<string, CompanyIntelligenceProfile>;
  health?: { indexAvailable: boolean; analysesEnabled: boolean };
  /** The index Deep Analysis searches (health); defaults to the fixture profiles' index. */
  indexVersion?: string;
  /** Readable filings by document ID, and adjacent-period passages by chunk ID (Phase 6). */
  sources?: Record<string, SourceDocumentResponse>;
  adjacent?: Record<string, AdjacentEvidenceResponse>;
} = {}) {
  const analyses = new Map((opts.analyses ?? []).map((a) => [a.analysisId, structuredClone(a)]));
  const findings = new Map((opts.findings ?? []).map((f) => [f.findingId, structuredClone(f)]));
  const profiles = opts.profiles ?? new Map();
  const calls: Array<{ method: string; args: unknown[] }> = [];
  let failNext: ApiRequestError | null = null;
  let seq = 0;
  const record = (method: string, ...args: unknown[]) => {
    calls.push({ method, args });
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
  };
  const notFound = () => new ApiRequestError('NOT_FOUND', 'Not found.', 404, 'req-test');

  const client: WorkspaceClient = {
    async session() {
      record('session');
      return { workspaceId: 'ws-test', created: false, expiresAt: '2026-11-01T00:00:00Z' };
    },
    async health() {
      record('health');
      return { status: 'ok', indexVersion: opts.indexVersion ?? 'iv-9cf51c066743', profileSetId: null, profileIndexVersion: null, ...(opts.health ?? { indexAvailable: true, analysesEnabled: true }) };
    },
    async listAnalyses() {
      record('listAnalyses');
      return [...analyses.values()];
    },
    async getAnalysis(id) {
      record('getAnalysis', id);
      const a = analyses.get(id);
      if (!a) throw notFound();
      return structuredClone(a);
    },
    async getContext(id) {
      record('getContext', id);
      const passages = opts.contexts?.[id];
      return passages ? { indexVersion: 'iv-test', passages } : null;
    },
    async createAnalysis(request) {
      record('createAnalysis', request);
      return { analysisId: `an-new-${++seq}`, status: 'QUEUED', pollAfterMs: 1500 };
    },
    async listFindings() {
      record('listFindings');
      return [...findings.values()];
    },
    async createFinding(request) {
      record('createFinding', request);
      const resolved = resolveSource(request.source, { analyses: [...analyses.values()], profiles });
      if (!resolved) throw notFound();
      const findingId = `fd-${sourceKey(request.source)}`;
      if (findings.has(findingId)) throw new ApiRequestError('ALREADY_SAVED', 'This item is already saved as a finding.', 409, 'req-test');
      const now = new Date().toISOString();
      const f: Finding = {
        findingId,
        title: request.title?.trim() || resolved.title,
        text: resolved.text,
        theme: request.theme ?? resolved.defaultTheme,
        tickers: resolved.tickers,
        citations: resolved.citations,
        origin: { kind: findingOriginKind(request.source), source: request.source },
        ...(resolved.analysisId ? { analysisId: resolved.analysisId } : {}),
        ...(request.note ? { note: request.note } : {}),
        status: request.status ?? 'ACTIVE',
        pinnedToIC: false,
        isKey: false,
        createdAt: now,
        updatedAt: now,
        ...(resolved.figures?.length ? { figures: resolved.figures } : {}),
      };
      findings.set(findingId, f);
      return structuredClone(f);
    },
    async patchFinding(id, patch) {
      record('patchFinding', id, patch);
      const f = findings.get(id);
      if (!f) throw notFound();
      const next = { ...f, ...patch, updatedAt: new Date().toISOString() } as Finding;
      findings.set(id, next);
      return structuredClone(next);
    },
    async deleteFinding(id) {
      record('deleteFinding', id);
      if (!findings.delete(id)) throw notFound();
    },
    async reset() {
      record('reset');
      findings.clear();
    },
    async companies() {
      record('companies');
      return { indexVersion: 'iv-test', profileSetId: [...profiles.values()][0]?.version.profileSetId ?? null, companies: [...profiles.values()].map((p) => ({ ticker: p.ticker, company: p.company, sector: p.sector, tier: p.coverage.tier, filings: p.coverage.filings, periodsCovered: p.version.periodsCovered })) };
    },
    async profile(ticker) {
      record('profile', ticker);
      return profiles.get(ticker) ?? null;
    },
    async source(documentId, indexVersion) {
      record('source', documentId, indexVersion);
      const iv = opts.indexVersion ?? 'iv-9cf51c066743';
      if (indexVersion && indexVersion !== iv) return { unavailable: 'index_version' };
      return opts.sources?.[documentId] ?? { unavailable: 'not_found' };
    },
    async adjacent(chunkId, indexVersion) {
      record('adjacent', chunkId, indexVersion);
      const iv = opts.indexVersion ?? 'iv-9cf51c066743';
      if (indexVersion && indexVersion !== iv) return { unavailable: 'index_version' };
      return opts.adjacent?.[chunkId] ?? { unavailable: 'not_found' };
    },
  };
  return {
    client,
    calls,
    analyses,
    findings,
    /** The next call throws this error. */
    failNext: (e: ApiRequestError) => {
      failNext = e;
    },
  };
}

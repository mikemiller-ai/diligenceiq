import { createHash } from 'node:crypto';
import {
  type CompanyIntelligenceProfile,
  type CreateFindingRequest,
  type ErrorCode,
  type Finding,
  type FindingSource,
  type SourceAnalysis,
  findingOriginKind,
  isCatalogTicker,
  resolveSource,
  sourceKey,
} from '@diligenceiq/core';
import type { AnalysisStore } from '../analyses/store';
import type { ProfileProvider } from '../profiles/provider';
import { MAX_FINDINGS_PER_WORKSPACE, WORKSPACE_TTL_DAYS, type WorkspaceStore, ttlFrom } from './store';

/**
 * Save Finding (SPEC §17.1; architecture §9 `POST /api/findings`). The client names a source;
 * the text and citations (passage text, source metadata, indexVersion) are copied here from the
 * stored brief or the active profile, never from the request. The finding ID is derived from
 * the source, so one stored item is saved at most once (a conditional create).
 */

/** One finding per source. A profile source is scoped to its profile set, whose positional refs (`risk-1`) mean another item in another set. */
export const findingIdFor = (source: FindingSource, profileSetId?: string) =>
  `fd-${createHash('sha256').update(profileSetId ? `${profileSetId}|${sourceKey(source)}` : sourceKey(source)).digest('hex').slice(0, 20)}`;

export interface FindingDeps {
  analyses: AnalysisStore;
  workspace: WorkspaceStore;
  profiles: ProfileProvider;
}

export type CreateFindingResult = { ok: true; finding: Finding } | { ok: false; code: ErrorCode; message: string };

/** The stored content a source names, gathered for `resolveSource`. */
async function storesFor(deps: FindingDeps, workspaceId: string, source: FindingSource, requestId: string) {
  const analyses: SourceAnalysis[] = [];
  const profiles = new Map<string, CompanyIntelligenceProfile>();
  if ('analysisId' in source) {
    const record = await deps.analyses.get(workspaceId, source.analysisId);
    // Only a finished brief can be saved from; a queued or failed analysis has nothing to copy.
    if (record?.status === 'COMPLETE') analyses.push({ analysisId: record.analysisId, ...(record.brief ? { brief: record.brief } : {}), ...(record.citations ? { citations: record.citations } : {}), ...(record.validation ? { validation: record.validation } : {}) });
  } else {
    const tickers = 'tickers' in source ? source.tickers : [source.ticker];
    for (const t of tickers) {
      const p = await deps.profiles.get(t, requestId);
      if (p) profiles.set(t, p);
    }
  }
  return { analyses, profiles, profileSetId: [...profiles.values()][0]?.version.profileSetId };
}

export async function createFinding(
  deps: FindingDeps,
  workspaceId: string,
  request: CreateFindingRequest,
  now: Date,
  requestId: string,
  /** `seeded`: set only by applySeed, so a seed finding is labeled as an example (SPEC §40). */
  opts: { skipLimit?: boolean; seeded?: boolean } = {},
): Promise<CreateFindingResult> {
  const { source } = request;
  const tickers = 'tickers' in source ? source.tickers : 'ticker' in source ? [source.ticker] : [];
  if (tickers.some((t) => !isCatalogTicker(t))) return { ok: false, code: 'VALIDATION_ERROR', message: 'Unknown company ticker.' };
  if (source.kind === 'watchEvent') return { ok: false, code: 'VALIDATION_ERROR', message: 'Watchlist findings are not available in this build.' };

  const stores = await storesFor(deps, workspaceId, source, requestId);
  const resolved = resolveSource(source, stores);
  if (!resolved) return { ok: false, code: 'NOT_FOUND', message: 'The item to save no longer exists or has no cited evidence.' };

  if (!opts.skipLimit && (await deps.workspace.countFindings(workspaceId)) >= MAX_FINDINGS_PER_WORKSPACE) {
    return { ok: false, code: 'LIMIT_REACHED', message: `A workspace holds at most ${MAX_FINDINGS_PER_WORKSPACE} findings. Delete some to save more.` };
  }

  const iso = now.toISOString();
  const finding: Finding = {
    findingId: findingIdFor(source, stores.profileSetId),
    title: request.title?.trim() || resolved.title,
    text: resolved.text,
    theme: request.theme ?? resolved.defaultTheme,
    tickers: resolved.tickers,
    citations: resolved.citations,
    origin: { kind: findingOriginKind(source), source },
    ...(resolved.analysisId ? { analysisId: resolved.analysisId } : {}),
    ...(request.note?.trim() ? { note: request.note.trim() } : {}),
    status: request.status ?? 'ACTIVE',
    pinnedToIC: false,
    isKey: false,
    createdAt: iso,
    updatedAt: iso,
    // The brief's figure checks for this item, so the board keeps the "unverified figure" markers.
    ...(resolved.figures?.length ? { figures: resolved.figures } : {}),
    ...(opts.seeded ? { seeded: true as const } : {}),
    ...(stores.profileSetId ? { profileSetId: stores.profileSetId } : {}),
  };
  if (!(await deps.workspace.createFinding(workspaceId, finding, ttlFrom(now, WORKSPACE_TTL_DAYS)))) {
    return { ok: false, code: 'ALREADY_SAVED', message: 'This item is already saved as a finding.' };
  }
  return { ok: true, finding };
}

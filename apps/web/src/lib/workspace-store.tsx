'use client';

import {
  sourceKey,
  type AnalysisDetail,
  type AnalysisSummary,
  type CompaniesResponse,
  type CompanyIntelligenceProfile,
  type Finding,
  type FindingSource,
  type FindingStatus,
  type PatchFindingRequest,
  type ThemeId,
} from '@diligenceiq/core';
import * as React from 'react';
import { ApiRequestError } from './api';
import { httpWorkspaceClient, type WorkspaceClient } from './workspace-client';

/*
 * Workspace state, backed by the session-scoped API (architecture §9; SPEC §40): the analyses
 * list, loaded analysis details, findings, and the Company Intelligence profiles read from the
 * active profile set. Every write goes to the server; the server copies finding text and
 * citations from stored content. The first visit creates (and seeds) a workspace.
 */

export { sourceKey };

export type ProfileState = 'loading' | 'missing' | 'error';

export interface WorkspaceState {
  status: 'loading' | 'ready' | 'error';
  error: ApiRequestError | null;
  analyses: AnalysisSummary[];
  details: ReadonlyMap<string, AnalysisDetail>;
  findings: Finding[];
  profiles: ReadonlyMap<string, CompanyIntelligenceProfile>;
  /** Profiles not (yet) loaded: loading, missing for this index version, or failed to load. */
  profileStates: ReadonlyMap<string, ProfileState>;
  /** The active profile set's company list; null until loaded. */
  companies: CompaniesResponse | null;
}

/** State a test (or a future SSR pass) can start from, skipping the initial fetches. */
export interface WorkspacePreload {
  analyses?: AnalysisDetail[];
  findings?: Finding[];
  profiles?: ReadonlyMap<string, CompanyIntelligenceProfile>;
  /** The active set's company list; derived from `profiles` when omitted. */
  companies?: CompaniesResponse;
}

export interface SaveFindingInput {
  source: FindingSource;
  theme: ThemeId;
  title: string;
  status: FindingStatus;
  note?: string;
}

function summaryOf(d: AnalysisDetail): AnalysisSummary {
  return { analysisId: d.analysisId, question: d.question, origin: d.origin, status: d.status, ...(d.stage ? { stage: d.stage } : {}), createdAt: d.createdAt, ...(d.completedAt ? { completedAt: d.completedAt } : {}), ...(d.seeded ? { seeded: true } : {}) };
}

function preloadState(p: WorkspacePreload): WorkspaceState {
  const profiles = p.profiles ?? new Map();
  return {
    status: 'ready',
    error: null,
    analyses: (p.analyses ?? []).map(summaryOf),
    details: new Map((p.analyses ?? []).map((a) => [a.analysisId, a])),
    findings: p.findings ?? [],
    profiles,
    profileStates: new Map(),
    companies: p.companies ?? { indexVersion: null, profileSetId: [...profiles.values()][0]?.version.profileSetId ?? null, companies: [...profiles.values()].map((x) => ({ ticker: x.ticker, company: x.company, sector: x.sector, tier: x.coverage.tier, filings: x.coverage.filings, periodsCovered: x.version.periodsCovered })) },
  };
}

const EMPTY: WorkspaceState = { status: 'loading', error: null, analyses: [], details: new Map(), findings: [], profiles: new Map(), profileStates: new Map(), companies: null };

const toApiError = (err: unknown) =>
  err instanceof ApiRequestError ? err : new ApiRequestError('CLIENT', 'An unexpected error occurred.', null);

function useWorkspaceValue(client: WorkspaceClient, preload: WorkspacePreload | undefined) {
  const [state, setState] = React.useState<WorkspaceState>(() => (preload ? preloadState(preload) : EMPTY));
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const patch = React.useCallback((fn: (s: WorkspaceState) => Partial<WorkspaceState>) => setState((s) => ({ ...s, ...fn(s) })), []);

  const load = React.useCallback(async () => {
    patch(() => ({ status: 'loading', error: null }));
    try {
      await client.session();
      const [analyses, findings, companies] = await Promise.all([client.listAnalyses(), client.listFindings(), client.companies()]);
      patch(() => ({ status: 'ready', analyses, findings, companies }));
    } catch (err) {
      patch(() => ({ status: 'error', error: toApiError(err) }));
    }
  }, [client, patch]);

  React.useEffect(() => {
    if (!preload) void load();
    // Preloaded state (tests) never fetches on mount.
  }, [load, preload]);

  const actions = React.useMemo(
    () => ({
      reload: load,
      /** Saves on the server (which copies the text and evidence) and adds it to the board. */
      saveFinding: async (input: SaveFindingInput): Promise<Finding> => {
        const finding = await client.createFinding({ source: input.source, theme: input.theme, status: input.status, ...(input.title.trim() ? { title: input.title.trim() } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}) });
        patch((s) => ({ findings: [finding, ...s.findings.filter((f) => f.findingId !== finding.findingId)] }));
        return finding;
      },
      updateFinding: async (findingId: string, change: PatchFindingRequest): Promise<Finding> => {
        const updated = await client.patchFinding(findingId, change);
        patch((s) => ({ findings: s.findings.map((f) => (f.findingId === findingId ? updated : f)) }));
        return updated;
      },
      deleteFinding: async (findingId: string): Promise<void> => {
        await client.deleteFinding(findingId);
        patch((s) => ({ findings: s.findings.filter((f) => f.findingId !== findingId) }));
      },
      /** Deletes and reseeds only this workspace, then reloads it. */
      reset: async (): Promise<void> => {
        await client.reset();
        patch(() => ({ details: new Map() }));
        const [analyses, findings] = await Promise.all([client.listAnalyses(), client.listFindings()]);
        patch(() => ({ analyses, findings }));
      },
      /** Loads one profile once; a missing profile is remembered (PROFILE_MISSING). */
      loadProfile: async (ticker: string): Promise<void> => {
        const s = stateRef.current;
        if (s.profiles.has(ticker) || s.profileStates.get(ticker) === 'loading' || s.profileStates.get(ticker) === 'missing') return;
        // Not in the active set's company list: missing, with no request.
        if (s.companies && !s.companies.companies.some((c) => c.ticker === ticker)) {
          patch((x) => ({ profileStates: new Map(x.profileStates).set(ticker, 'missing') }));
          return;
        }
        patch((x) => ({ profileStates: new Map(x.profileStates).set(ticker, 'loading') }));
        try {
          const profile = await client.profile(ticker);
          patch((x) => {
            const states = new Map(x.profileStates);
            if (profile) {
              states.delete(ticker);
              return { profiles: new Map(x.profiles).set(ticker, profile), profileStates: states };
            }
            return { profileStates: states.set(ticker, 'missing') };
          });
        } catch {
          patch((x) => ({ profileStates: new Map(x.profileStates).set(ticker, 'error') }));
        }
      },
      /** Records a fetched analysis detail (the poll) and keeps the list in step. */
      putAnalysis: (detail: AnalysisDetail) =>
        patch((s) => ({
          details: new Map(s.details).set(detail.analysisId, detail),
          analyses: s.analyses.some((a) => a.analysisId === detail.analysisId)
            ? s.analyses.map((a) => (a.analysisId === detail.analysisId ? summaryOf(detail) : a))
            : [summaryOf(detail), ...s.analyses],
        })),
    }),
    [client, load, patch],
  );

  // A profile finding counts as saved only for the set it came from: its positional ref names another item in another set.
  const activeSet = state.companies?.profileSetId ?? null;
  const savedKeys = React.useMemo(
    () => new Set(state.findings.filter((f) => !f.profileSetId || f.profileSetId === activeSet).map((f) => sourceKey(f.origin.source))),
    [state.findings, activeSet],
  );
  /** Loaded analyses with briefs, for previewing what a save will copy. */
  const sourceAnalyses = React.useMemo(() => [...state.details.values()], [state.details]);
  const profileTickers = React.useMemo(() => new Set(state.companies?.companies.map((c) => c.ticker) ?? []), [state.companies]);
  return { ...state, client, savedKeys, sourceAnalyses, profileTickers, ...actions };
}

export type Workspace = ReturnType<typeof useWorkspaceValue>;

const WorkspaceContext = React.createContext<Workspace | null>(null);

export function WorkspaceProvider({ children, client, preload }: { children: React.ReactNode; client?: WorkspaceClient; preload?: WorkspacePreload }) {
  const [c] = React.useState(() => client ?? httpWorkspaceClient());
  const [p] = React.useState(() => preload);
  const value = useWorkspaceValue(c, p);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}

/** A profile from the active set, loaded on first use. */
export function useProfile(ticker: string | null): { profile: CompanyIntelligenceProfile | undefined; state: ProfileState | 'ready' | 'none' } {
  const ws = useWorkspace();
  const { loadProfile, status } = ws;
  React.useEffect(() => {
    if (ticker && status === 'ready') void loadProfile(ticker);
  }, [ticker, status, loadProfile]);
  if (!ticker) return { profile: undefined, state: 'none' };
  const profile = ws.profiles.get(ticker);
  if (profile) return { profile, state: 'ready' };
  // No workspace (the session failed): nothing will load until Retry, so it is an error, not an endless skeleton.
  if (ws.status === 'error') return { profile: undefined, state: 'error' };
  if (ws.status !== 'ready') return { profile: undefined, state: 'loading' };
  return { profile: undefined, state: ws.profileStates.get(ticker) ?? 'loading' };
}

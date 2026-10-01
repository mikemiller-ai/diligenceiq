'use client';

import {
  findingOriginKind,
  type CompanyIntelligenceProfile,
  type Finding,
  type FindingSource,
  type FindingStatus,
  type ThemeId,
} from '@diligenceiq/core';
import * as React from 'react';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import type { AnalysisRecord } from '@/fixtures/types';
import { resolveSource } from './finding-sources';

/*
 * Phase 1 workspace state: in memory, so saved findings last until the page is reloaded.
 * It starts empty: there are no hand-written analyses or findings (SPEC §2.2,
 * assumptions A5). Phase 5 replaces the internals with the session-scoped API
 * (architecture §9), seeded from real pipeline outputs; the hook surface stays the same.
 */

export interface WorkspaceState {
  analyses: AnalysisRecord[];
  findings: Finding[];
  nextId: number;
}

type FindingPatch = Partial<Pick<Finding, 'status' | 'note' | 'theme' | 'title'>>;

type Action =
  | { type: 'saveFinding'; finding: Finding }
  | { type: 'updateFinding'; findingId: string; patch: FindingPatch; at: string }
  | { type: 'deleteFinding'; findingId: string }
  | { type: 'reset'; initial: WorkspaceState };

export function emptyState(): WorkspaceState {
  return { analyses: [], findings: [], nextId: 1 };
}

export function reducer(state: WorkspaceState, action: Action): WorkspaceState {
  switch (action.type) {
    case 'saveFinding':
      // A stored item is saved at most once, whatever path the save came from.
      if (state.findings.some((f) => sourceKey(f.origin.source) === sourceKey(action.finding.origin.source))) return state;
      return { ...state, findings: [action.finding, ...state.findings], nextId: state.nextId + 1 };
    case 'updateFinding':
      return {
        ...state,
        findings: state.findings.map((f) => (f.findingId === action.findingId ? { ...f, ...action.patch, updatedAt: action.at } : f)),
      };
    case 'deleteFinding':
      return { ...state, findings: state.findings.filter((f) => f.findingId !== action.findingId) };
    case 'reset':
      return action.initial;
  }
}

export interface SaveFindingInput {
  source: FindingSource;
  theme: ThemeId;
  title: string;
  status: FindingStatus;
  note?: string;
}

/**
 * Same key for the same stored item, so a source can only be saved once. Canonical: the key
 * order is fixed and a compare row's tickers are sorted, so AAPL,MSFT and MSFT,AAPL match.
 */
export function sourceKey(source: FindingSource): string {
  switch (source.kind) {
    case 'keyFinding':
    case 'consideration':
    case 'comparisonRow':
      return `${source.kind}:${source.analysisId}:${source.index}`;
    case 'compareRow':
      return `${source.kind}:${[...source.tickers].sort().join(',')}:${source.ref}`;
    case 'watchEvent':
      return `${source.kind}:${source.ticker}:${source.signalId}`;
    default:
      return `${source.kind}:${source.ticker}:${source.ref}`;
  }
}

export function buildFinding(
  state: WorkspaceState,
  profiles: ReadonlyMap<string, CompanyIntelligenceProfile>,
  input: SaveFindingInput,
  now: string,
): Finding {
  if (state.findings.some((f) => sourceKey(f.origin.source) === sourceKey(input.source))) {
    throw new Error('This item is already saved as a finding.');
  }
  // resolveSource returns null for an item with no cited passage, so a finding always has evidence.
  const resolved = resolveSource(input.source, { analyses: state.analyses, profiles });
  if (!resolved) throw new Error('The item to save no longer exists or has no cited evidence.');
  return {
    findingId: `fd-local-${state.nextId}`,
    title: input.title.trim().slice(0, 200) || resolved.title,
    text: resolved.text,
    theme: input.theme,
    tickers: resolved.tickers,
    citations: resolved.citations,
    origin: { kind: findingOriginKind(input.source), source: input.source },
    ...(resolved.analysisId ? { analysisId: resolved.analysisId } : {}),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 2000) } : {}),
    status: input.status,
    pinnedToIC: false,
    isKey: false,
    createdAt: now,
    updatedAt: now,
  };
}

function useWorkspaceValue(initial: WorkspaceState, profiles: ReadonlyMap<string, CompanyIntelligenceProfile>) {
  const [state, dispatch] = React.useReducer(reducer, initial);
  // saveFinding reads the latest state without re-creating the actions object.
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const actions = React.useMemo(
    () => ({
      saveFinding: (input: SaveFindingInput): Finding => {
        const finding = buildFinding(stateRef.current, profiles, input, new Date().toISOString());
        dispatch({ type: 'saveFinding', finding });
        return finding;
      },
      updateFinding: (findingId: string, patch: FindingPatch) =>
        dispatch({ type: 'updateFinding', findingId, patch, at: new Date().toISOString() }),
      deleteFinding: (findingId: string) => dispatch({ type: 'deleteFinding', findingId }),
      reset: () => dispatch({ type: 'reset', initial }),
    }),
    [initial, profiles],
  );

  const savedKeys = React.useMemo(() => new Set(state.findings.map((f) => sourceKey(f.origin.source))), [state.findings]);
  return { ...state, profiles, savedKeys, ...actions };
}

export type Workspace = ReturnType<typeof useWorkspaceValue>;

const WorkspaceContext = React.createContext<Workspace | null>(null);

export function WorkspaceProvider({
  children,
  initial,
  profiles = FIXTURE_PROFILES,
}: {
  children: React.ReactNode;
  /** Tests inject analyses and findings; the app starts empty. */
  initial?: WorkspaceState;
  profiles?: ReadonlyMap<string, CompanyIntelligenceProfile>;
}) {
  const [start] = React.useState(() => initial ?? emptyState());
  const value = useWorkspaceValue(start, profiles);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return ctx;
}

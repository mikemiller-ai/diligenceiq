import type { AnalysisDetail, Citation, CompaniesResponse, CompanyIntelligenceProfile, Finding } from '@diligenceiq/core';
import { render } from '@testing-library/react';
import type * as React from 'react';
import { EvidenceProvider } from '@/components/diligence/evidence';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { WorkspaceProvider } from '@/lib/workspace-store';
import { createMemoryClient } from './memory-client';

/**
 * Renders inside a workspace backed by the in-memory client. The given analyses, findings and
 * profiles are preloaded (no fetch on mount), so the first render is synchronous; writes go
 * through the client like they do against the api.
 */
export function renderInWorkspace(
  ui: React.ReactElement,
  opts: {
    initial?: { analyses?: AnalysisDetail[]; findings?: Finding[] };
    contexts?: Record<string, Citation[]>;
    profiles?: ReadonlyMap<string, CompanyIntelligenceProfile>;
    memory?: ReturnType<typeof createMemoryClient>;
    companies?: CompaniesResponse;
  } = {},
) {
  const profiles = opts.profiles ?? FIXTURE_PROFILES;
  const memory = opts.memory ?? createMemoryClient({ analyses: opts.initial?.analyses ?? [], findings: opts.initial?.findings ?? [], profiles, ...(opts.contexts ? { contexts: opts.contexts } : {}) });
  const utils = render(
    <TooltipProvider>
      <WorkspaceProvider client={memory.client} preload={{ analyses: opts.initial?.analyses ?? [], findings: opts.initial?.findings ?? [], profiles, ...(opts.companies ? { companies: opts.companies } : {}) }}>
        <EvidenceProvider>{ui}</EvidenceProvider>
      </WorkspaceProvider>
    </TooltipProvider>,
  );
  return { ...utils, memory };
}

import type { CompanyIntelligenceProfile } from '@diligenceiq/core';
import { render } from '@testing-library/react';
import type * as React from 'react';
import { EvidenceProvider } from '@/components/diligence/evidence';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkspaceProvider, type WorkspaceState } from '@/lib/workspace-store';

export function renderInWorkspace(
  ui: React.ReactElement,
  opts: { initial?: WorkspaceState; profiles?: ReadonlyMap<string, CompanyIntelligenceProfile> } = {},
) {
  return render(
    <TooltipProvider>
      <WorkspaceProvider {...opts}>
        <EvidenceProvider>{ui}</EvidenceProvider>
      </WorkspaceProvider>
    </TooltipProvider>,
  );
}

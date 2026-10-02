import type { Citation, Finding } from '@diligenceiq/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';
import { EvidenceProvider } from '@/components/diligence/evidence';
import { WorkspaceBanner } from '@/components/shell/workspace-banner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { ApiRequestError } from '@/lib/api';
import { WorkspaceProvider } from '@/lib/workspace-store';
import { createMemoryClient } from '@/test/memory-client';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { CompareView } from './compare/compare-view';
import { FindingsView } from './findings/findings-view';
import { IntelligenceView } from './intelligence/intelligence-view';
import { FilingView } from './sources/filing/filing-view';

/*
 * Phase 5 adversary fixes on the web side: a workspace that cannot be opened (H1), the
 * workspace-creation cap copy (H2), saved findings that keep their figure checks and provenance
 * (M2, M3), the "Missing source document" state (architecture §9.1), and the preview badge.
 */

/** A workspace whose session request fails with `error` (not preloaded: the provider really loads). */
function renderWithFailedSession(ui: React.ReactElement, error: ApiRequestError) {
  const memory = createMemoryClient({ profiles: FIXTURE_PROFILES });
  memory.failNext(error);
  return render(
    <TooltipProvider>
      <WorkspaceProvider client={memory.client}>
        <EvidenceProvider>
          <WorkspaceBanner />
          {ui}
        </EvidenceProvider>
      </WorkspaceProvider>
    </TooltipProvider>,
  );
}

const clientCap = () =>
  new ApiRequestError('RATE_LIMITED', 'This network has opened its limit of new demo workspaces for today. Try again tomorrow.', 429, 'req-ws1', {
    scope: 'workspace_creation_client',
    retryAfter: '2026-10-03T00:00:00.000Z',
  });

describe('H1: no workspace (the session failed): pages explain, nothing loads forever', () => {
  it('the banner names this network’s limit and when it reopens; the dashboard is an error, not a skeleton', async () => {
    setRoute('/intelligence/', 'ticker=AAPL');
    renderWithFailedSession(<IntelligenceView />, clientCap());
    const banner = await screen.findByText('This network has opened its limit of demo workspaces for today');
    const panel = banner.closest('[role="alert"]') as HTMLElement;
    expect(panel).toHaveTextContent('New workspaces open again after Oct 3');
    expect(panel).toHaveTextContent('req-ws1');
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(await screen.findByText('Company Intelligence could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/Your demo workspace could not be opened, so the profile cannot be loaded/)).toBeInTheDocument();
  });

  it('the demo-wide creation cap has its own title', async () => {
    setRoute('/intelligence/', 'ticker=AAPL');
    renderWithFailedSession(<IntelligenceView />, new ApiRequestError('RATE_LIMITED', 'The demo has reached its limit of new workspaces for today.', 429, 'req-ws2', { scope: 'workspace_creation', retryAfter: '2026-10-03T00:00:00.000Z' }));
    expect(await screen.findByText('The demo is at its limit of new workspaces for today')).toBeInTheDocument();
  });

  it('the company selector still renders from the static catalog', async () => {
    setRoute('/intelligence/', '');
    renderWithFailedSession(<IntelligenceView />, clientCap());
    expect(await screen.findByText('This network has opened its limit of demo workspaces for today')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deep coverage' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Apple Inc/ }).length).toBeGreaterThan(0);
  });

  it('Compare says why instead of a skeleton', async () => {
    setRoute('/compare/', 'tickers=AAPL,MSFT');
    renderWithFailedSession(<CompareView />, clientCap());
    expect(await screen.findByText(/Company profiles cannot be loaded because your demo workspace could not be opened/)).toBeInTheDocument();
  });
});

const citation = (over: Partial<Citation> = {}): Citation => ({
  chunkId: 'ZZZ-FY2030-10K-1A-001',
  indexVersion: 'iv-old',
  ticker: 'AAPL',
  company: 'Apple Inc',
  filingType: '10-K',
  filingDate: '2030-10-31',
  periodEnd: '2030-09-28',
  fiscalLabel: 'FY2030',
  section: 'Item 1A',
  documentId: 'AAPL_10K_2030-10-31',
  charStart: 0,
  charEnd: 40,
  text: 'The copied passage text survives a missing filing.',
  ...over,
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  findingId: 'fd-1',
  title: 'Saved from a brief',
  text: 'Revenue grew 12% to $4.2 billion.',
  theme: 'financial-performance',
  tickers: ['AAPL'],
  citations: [citation()],
  origin: { kind: 'analysis', source: { kind: 'keyFinding', analysisId: 'an-01', index: 0 } },
  analysisId: 'an-01',
  status: 'ACTIVE',
  pinnedToIC: false,
  isKey: false,
  createdAt: '2026-10-02T12:00:00Z',
  updatedAt: '2026-10-02T12:00:00Z',
  ...over,
});

describe('saved findings keep what the brief knew (M2, M3)', () => {
  it('M2: an unverified figure stays marked on the Findings Board; a verified one is not', () => {
    setRoute('/findings/');
    const figures = [
      { location: 'keyFindings[0].finding', figure: '$4.2 billion', verified: false, rule: null, chunkId: null },
      { location: 'keyFindings[0].finding', figure: '12%', verified: true, rule: 'exact' as const, chunkId: 'ZZZ-FY2030-10K-1A-001' },
    ];
    renderInWorkspace(<FindingsView />, { initial: { findings: [finding({ figures })] } });
    expect(screen.getByText('Unverified figure: $4.2 billion')).toBeInTheDocument();
    expect(screen.queryByText(/Unverified figure: 12%/)).not.toBeInTheDocument();
  });

  it('M3: a seed finding is labeled as an example; the analyst’s own are not', () => {
    setRoute('/findings/');
    renderInWorkspace(<FindingsView />, { initial: { findings: [finding({ seeded: true }), finding({ findingId: 'fd-2', title: 'Mine' })] } });
    expect(screen.getAllByText(/Example from the demo workspace/)).toHaveLength(1);
  });
});

describe('Missing source document (architecture §9.1)', () => {
  it('a finding whose filing is not in the corpus keeps its copied passage; the filing view says it is not found', async () => {
    setRoute('/findings/');
    const { unmount } = renderInWorkspace(<FindingsView />, { initial: { findings: [finding()] } });
    expect(screen.getByText('Revenue grew 12% to $4.2 billion.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /AAPL FY2030 10-K · Item 1A/ }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveTextContent('The copied passage text survives a missing filing.');
    unmount();

    setRoute('/sources/filing/', 'id=AAPL_10K_2030-10-31');
    renderInWorkspace(<FilingView />);
    expect(screen.getByText('Filing not found')).toBeInTheDocument();
  });
});

describe('the "Preview profile" badge describes the set, not membership', () => {
  const companies = (profileSetId: string) => ({
    indexVersion: 'iv-9cf51c066743',
    profileSetId,
    companies: [{ ticker: 'AAPL', company: 'Apple Inc', sector: 'Technology', tier: 'deep' as const, filings: 5, periodsCovered: [] }],
  });

  it('a fixture set shows it; a built (det-/llm-) set does not', () => {
    setRoute('/intelligence/', '');
    const { unmount } = renderInWorkspace(<IntelligenceView />, { companies: companies('fixture-v2') });
    expect(screen.getAllByText('Preview profile').length).toBeGreaterThan(0);
    unmount();
    renderInWorkspace(<IntelligenceView />, { companies: companies('det-v1') });
    expect(screen.queryByText('Preview profile')).not.toBeInTheDocument();
  });
});

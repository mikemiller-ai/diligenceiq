import { act, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type * as React from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, setRoute } from '@/test/navigation-mock';
import { WorkspaceProvider } from '@/lib/workspace-store';
import { SAMPLE_ANALYSES } from '@/test/sample-analyses';
import { NewAnalysisView } from './new-analysis-view';

const fetchMock = vi.fn();
let health = { status: 'ok', indexVersion: 'iv', indexAvailable: true, profileSetId: null, profileIndexVersion: null, analysesEnabled: true };
let onPost: () => Promise<Response> = async () => new Response(JSON.stringify({ analysisId: 'an-1', status: 'QUEUED', pollAfterMs: 1500 }), { status: 202 });

/** The real http client against a mocked fetch; preloaded, so nothing is fetched on mount but the health check. */
const render = (ui: React.ReactElement) => rtlRender(<WorkspaceProvider preload={{}}>{ui}</WorkspaceProvider>);
/** POSTs only: the health check is a GET and never starts anything. */
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST') as Array<[string, RequestInit]>;
const respond = (fn: () => Promise<Response>) => {
  onPost = fn;
};
const PREFILL = 'q=What%20risks%3F&tickers=AAPL,ZZZZ&origin=recommendation:AAPL:rec-2';

describe('Deep Analysis input', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    health = { ...health, indexAvailable: true, analysesEnabled: true };
    onPost = async () => new Response(JSON.stringify({ analysisId: 'an-1', status: 'QUEUED', pollAfterMs: 1500 }), { status: 202 });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'POST' ? onPost() : new Response(JSON.stringify(health), { status: 200 })));
    nav.push.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prefills an editable question, known tickers, and the origin, and never submits by itself', async () => {
    setRoute('/analysis/new/', PREFILL);
    render(<NewAnalysisView />);
    const q = screen.getByLabelText('Question');
    expect(q).toHaveValue('What risks?');
    expect(screen.getByRole('list', { name: 'Selected companies' })).toHaveTextContent('AAPL');
    expect(screen.getByRole('list', { name: 'Selected companies' })).not.toHaveTextContent('ZZZZ');
    expect(screen.getByText(/Prefilled from/)).toHaveTextContent('Apple Inc · recommended diligence');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toEqual([]);
    await userEvent.clear(q);
    await userEvent.type(q, 'Edited');
    expect(q).toHaveValue('Edited');
    expect(posts()).toEqual([]);
  });

  it('sends the origin with the request only when Run analysis is clicked', async () => {
    setRoute('/analysis/new/', PREFILL);
    respond(async () => new Response(JSON.stringify({ analysisId: 'an-99', status: 'QUEUED', pollAfterMs: 1500 }), { status: 202 }));
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0]!;
    expect(url).toBe('/api/analyses');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      question: 'What risks?',
      origin: { kind: 'recommendation', ticker: 'AAPL', ref: 'rec-2' },
      filters: { tickers: ['AAPL'] },
    });
    await vi.waitFor(() => expect(nav.push).toHaveBeenCalledWith('/analysis/?id=an-99'));
  });

  it('a new query in the same route resets the form: no stale question, origin or company filter', async () => {
    // Regression (adversary finding 2): "Ask a question" from a prefilled form kept all three.
    setRoute('/analysis/new/', PREFILL);
    respond(async () => new Response(JSON.stringify({ analysisId: 'an-2' }), { status: 202 }));
    const { rerender } = render(<NewAnalysisView />);
    expect(screen.getByLabelText('Question')).toHaveValue('What risks?');
    setRoute('/analysis/new/', '');
    rerender(<WorkspaceProvider preload={{}}><NewAnalysisView /></WorkspaceProvider>);
    expect(screen.getByLabelText('Question')).toHaveValue('');
    expect(screen.queryByText(/Prefilled from/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Selected companies' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Question'), 'Fresh');
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String(posts()[0]![1].body))).toEqual({ question: 'Fresh', filters: {} });
  });

  it('treats a malformed origin as a direct question and omits it from the request', async () => {
    setRoute('/analysis/new/', 'q=Anything&origin=signal:aapl:%20x');
    respond(async () => new Response(JSON.stringify({ analysisId: 'an-1' }), { status: 202 }));
    render(<NewAnalysisView />);
    expect(screen.queryByText(/Prefilled from/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String(posts()[0]![1].body))).toEqual({ question: 'Anything', filters: {} });
  });

  it('an empty Deep Analysis offers example questions that only fill the box', async () => {
    setRoute('/analysis/new/');
    render(<NewAnalysisView />);
    const example = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('How have revenue'))!;
    await userEvent.click(example);
    expect(screen.getByLabelText('Question')).toHaveValue(example.textContent);
    expect(posts()).toEqual([]);
  });

  it('validates before calling the API', async () => {
    setRoute('/analysis/new/');
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(screen.getByText('Enter a question to analyze.')).toBeInTheDocument();
    expect(screen.getByLabelText('Question')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(screen.getByLabelText('Question'), 'q');
    await userEvent.click(screen.getByRole('checkbox', { name: /10-K/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /10-Q/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(screen.getByText('Select at least one filing type.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /10-K/ }));
    await userEvent.selectOptions(screen.getByLabelText('From fiscal year'), '2025');
    await userEvent.selectOptions(screen.getByLabelText('To fiscal year'), '2023');
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(screen.getByText('The start year must be on or before the end year.')).toBeInTheDocument();
    expect(posts()).toEqual([]);
  });

  it('shows a server error with its request ID, and its code only beside the request ID', async () => {
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    respond(async () =>
      new Response(JSON.stringify({ error: { code: 'ENQUEUE_FAILED', message: 'The queue did not accept the analysis.', requestId: 'req-123' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('checkbox', { name: /10-Q/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String(posts()[0]![1].body))).toEqual({
      question: 'What changed?',
      filters: { filingTypes: ['10-K'] },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The analysis could not be queued');
    expect(alert).toHaveTextContent(/Request ID\s*req-123.*Error code ENQUEUE_FAILED/);
    expect(nav.push).not.toHaveBeenCalled();
  });

  // Phase 9 review item 12: one panel, Run disabled while paused, no raw ANALYSES_DISABLED badge.
  it('paused before Run (health): one notice, Run disabled, no raw code, nothing sent', async () => {
    health = { ...health, analysesEnabled: false };
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    render(<NewAnalysisView />);
    expect(await screen.findByText('New analyses are paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('ANALYSES_DISABLED');
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(posts()).toEqual([]);
  });

  it('paused found by Run (the server says ANALYSES_DISABLED): the same single notice, then Run is disabled', async () => {
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    respond(async () =>
      new Response(JSON.stringify({ error: { code: 'ANALYSES_DISABLED', message: 'New analyses are paused right now.', requestId: 'req-123' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(posts()).toHaveLength(1);
    expect(await screen.findByText('New analyses are paused')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('ANALYSES_DISABLED');
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  // Code review 2026-10-03: health was read once per mount and a pause found by Run never cleared,
  // so Run stayed disabled after analyses were re-enabled.
  it('paused: "Check again" re-reads health and turns Run back on once analyses are enabled, sending nothing', async () => {
    health = { ...health, analysesEnabled: false };
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    render(<NewAnalysisView />);
    expect(await screen.findByText('New analyses are paused')).toBeInTheDocument();
    const healthReads = () => fetchMock.mock.calls.filter(([url, init]) => String(url).includes('/api/health') && (init as RequestInit | undefined)?.method !== 'POST').length;
    const before = healthReads();
    // Still paused: the check runs, the notice stays, Run stays off.
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(healthReads()).toBe(before + 1));
    expect(screen.getByText('New analyses are paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
    // Re-enabled: the notice goes and Run is back.
    health = { ...health, analysesEnabled: true };
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(screen.queryByText('New analyses are paused')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    expect(posts()).toEqual([]);
  });

  it('paused found by Run: coming back to the tab re-reads health and clears the pause when analyses are enabled', async () => {
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    respond(async () =>
      new Response(JSON.stringify({ error: { code: 'ANALYSES_DISABLED', message: 'New analyses are paused right now.', requestId: 'req-123' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByText('New analyses are paused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeDisabled();
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.queryByText('New analyses are paused')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Run analysis' })).toBeEnabled();
    expect(posts()).toHaveLength(1);
  });

  // Phase 9 review item 20: plain words first, and the company hint only while no company is chosen.
  it('names the sources in plain words and hides the empty-companies hint once a company is selected', async () => {
    setRoute('/analysis/new/');
    const { unmount } = render(<NewAnalysisView />);
    expect(screen.getByRole('checkbox', { name: 'Annual reports (10-K)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Quarterly reports (10-Q)' })).toBeInTheDocument();
    expect(screen.getByText('Leave empty to let the question decide which companies apply.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SEC filing corpus/);
    unmount();
    setRoute('/analysis/new/', 'tickers=AAPL');
    render(<NewAnalysisView />);
    expect(screen.queryByText('Leave empty to let the question decide which companies apply.')).not.toBeInTheDocument();
  });

  it('reports a network failure plainly', async () => {
    setRoute('/analysis/new/', 'q=Anything');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network failure');
  });

  it('explains a rate limit with its scope and when to try again', async () => {
    setRoute('/analysis/new/', 'q=Anything');
    respond(async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'This workspace has run 10 analyses this hour, the hourly limit.', requestId: 'req-7', details: { scope: 'workspace_hourly', retryAfter: '2026-10-02T13:00:00.000Z' } } }), {
        status: 429,
      }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This workspace has reached its hourly limit');
    expect(alert).toHaveTextContent('Try again after');
    expect(alert).toHaveTextContent('Company Intelligence, Compare and your findings keep working');
    expect(alert).toHaveTextContent('req-7');
  });

  it('explains the global daily cap: the demo, not this workspace, is at its limit', async () => {
    setRoute('/analysis/new/', 'q=Anything');
    respond(async () =>
      new Response(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'The demo has reached its daily limit of analyses.', requestId: 'req-8', details: { scope: 'global_daily', retryAfter: '2026-10-03T00:00:00.000Z' } } }), { status: 429 }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The demo has reached its daily limit');
    expect(alert).toHaveTextContent('Each analysis makes one paid model request');
    expect(alert).toHaveTextContent('Try again after Oct 3');
    expect(alert).toHaveTextContent('req-8');
  });

  it('prefills source and fiscal-year filters from the URL (Edit and run again), still never submitting by itself', async () => {
    setRoute('/analysis/new/', 'q=Again&tickers=NVDA&types=10-K&from=2023&to=2025');
    render(<NewAnalysisView />);
    expect(screen.getByRole('checkbox', { name: /10-K/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /10-Q/ })).not.toBeChecked();
    expect(screen.getByLabelText('From fiscal year')).toHaveValue('2023');
    expect(screen.getByLabelText('To fiscal year')).toHaveValue('2025');
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String(posts()[0]![1].body))).toEqual({ question: 'Again', filters: { tickers: ['NVDA'], filingTypes: ['10-K'], fiscalYearFrom: 2023, fiscalYearTo: 2025 } });
  });

  it('ignores unknown filter values in the URL', () => {
    setRoute('/analysis/new/', 'q=Q&types=10-X&from=1999&to=abc');
    render(<NewAnalysisView />);
    expect(screen.getByRole('checkbox', { name: /10-K/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /10-Q/ })).toBeChecked();
    expect(screen.getByLabelText('From fiscal year')).toHaveValue('');
    expect(screen.getByLabelText('To fiscal year')).toHaveValue('');
  });

  it('M4: lists this workspace’s analyses, newest first, each linking to its brief; seeded ones are labeled', () => {
    setRoute('/analysis/new/');
    const seeded = { ...SAMPLE_ANALYSES[0]!, analysisId: 'an-seeded', question: 'A seeded question', createdAt: '2026-09-01T00:00:00Z', seeded: true };
    rtlRender(
      <WorkspaceProvider preload={{ analyses: [seeded, ...SAMPLE_ANALYSES] }}>
        <NewAnalysisView />
      </WorkspaceProvider>,
    );
    const list = screen.getByRole('heading', { name: 'Recent analyses' }).closest('section')!;
    const links = Array.from(list.querySelectorAll('a'));
    expect(links.length).toBe(Math.min(10, SAMPLE_ANALYSES.length + 1));
    const seededLink = links.find((a) => a.textContent?.includes('A seeded question'))!;
    expect(seededLink.getAttribute('href')).toMatch(/^\/analysis\/?\?id=an-seeded$/);
    expect(seededLink).toHaveTextContent('Example, run in advance');
    const dates = links.map((a) => SAMPLE_ANALYSES.concat(seeded).find((x) => a.getAttribute('href')?.endsWith(x.analysisId))!.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(posts()).toEqual([]);
  });

  it('warns in advance when filing search is unavailable or analyses are paused (GET /api/health)', async () => {
    setRoute('/analysis/new/');
    health = { ...health, indexAvailable: false };
    const { unmount } = render(<NewAnalysisView />);
    expect(await screen.findByText('Filing search is unavailable right now')).toBeInTheDocument();
    unmount();
    health = { ...health, indexAvailable: true, analysesEnabled: false };
    render(<NewAnalysisView />);
    expect(await screen.findByText('New analyses are paused')).toBeInTheDocument();
    // The form stays usable to prepare a question; nothing is sent.
    expect(screen.getByLabelText('Question')).toBeEnabled();
    expect(posts()).toEqual([]);
  });
});

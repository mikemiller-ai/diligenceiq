import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nav, setRoute } from '@/test/navigation-mock';
import { NewAnalysisView } from './new-analysis-view';

const fetchMock = vi.fn();
const PREFILL = 'q=What%20risks%3F&tickers=AAPL,ZZZZ&origin=recommendation:AAPL:rec-2';

describe('Deep Analysis input', () => {
  beforeEach(() => {
    fetchMock.mockReset();
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
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.clear(q);
    await userEvent.type(q, 'Edited');
    expect(q).toHaveValue('Edited');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the origin with the request only when Run analysis is clicked', async () => {
    setRoute('/analysis/new/', PREFILL);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ analysisId: 'an-99', status: 'QUEUED', pollAfterMs: 1500 }), { status: 202 }));
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
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
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ analysisId: 'an-2' }), { status: 202 }));
    const { rerender } = render(<NewAnalysisView />);
    expect(screen.getByLabelText('Question')).toHaveValue('What risks?');
    setRoute('/analysis/new/', '');
    rerender(<NewAnalysisView />);
    expect(screen.getByLabelText('Question')).toHaveValue('');
    expect(screen.queryByText(/Prefilled from/)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Selected companies' })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Question'), 'Fresh');
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ question: 'Fresh', filters: {} });
  });

  it('treats a malformed origin as a direct question and omits it from the request', async () => {
    setRoute('/analysis/new/', 'q=Anything&origin=signal:aapl:%20x');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ analysisId: 'an-1' }), { status: 202 }));
    render(<NewAnalysisView />);
    expect(screen.queryByText(/Prefilled from/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ question: 'Anything', filters: {} });
  });

  it('an empty Deep Analysis offers example questions that only fill the box', async () => {
    setRoute('/analysis/new/');
    render(<NewAnalysisView />);
    const example = screen.getAllByRole('button').find((b) => b.textContent?.startsWith('How have revenue'))!;
    await userEvent.click(example);
    expect(screen.getByLabelText('Question')).toHaveValue(example.textContent);
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a server error with its request ID', async () => {
    setRoute('/analysis/new/', 'q=What%20changed%3F');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'ANALYSES_DISABLED', message: 'Analyses are not enabled in this build.', requestId: 'req-123' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('checkbox', { name: /10-Q/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      question: 'What changed?',
      filters: { filingTypes: ['10-K'] },
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('New analyses are paused');
    expect(alert).toHaveTextContent('req-123');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('reports a network failure plainly', async () => {
    setRoute('/analysis/new/', 'q=Anything');
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<NewAnalysisView />);
    await userEvent.click(screen.getByRole('button', { name: 'Run analysis' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Network failure');
  });
});

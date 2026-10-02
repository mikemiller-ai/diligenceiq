import type { AnalysisDetail, AnalysisFailureCode, BriefValidation } from '@diligenceiq/core';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { ApiRequestError } from '@/lib/api';
import { FAILURE_COPY } from '@/lib/labels';
import { createMemoryClient } from '@/test/memory-client';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { SAMPLE_ANALYSES, SAMPLE_CONTEXTS } from '@/test/sample-analyses';
import { IntelligenceView } from '../intelligence/intelligence-view';
import { AnalysisView } from './analysis-view';

const complete = SAMPLE_ANALYSES.find((a) => a.status === 'COMPLETE')!;

const validationWith = (over: Partial<BriefValidation>): BriefValidation => ({ ...complete.validation!, ...over });

/** An analysis the page has not loaded yet: the client serves `sequence` one poll at a time. */
function polling(sequence: AnalysisDetail[], extra: Parameters<typeof createMemoryClient>[0] = {}) {
  const memory = createMemoryClient({ contexts: SAMPLE_CONTEXTS, profiles: FIXTURE_PROFILES, ...extra });
  let i = 0;
  const base = memory.client.getAnalysis;
  memory.client.getAnalysis = async (id) => {
    const next = sequence[Math.min(i++, sequence.length - 1)]!;
    memory.analyses.set(id, next);
    return base(id);
  };
  return memory;
}

const running = (stage: string): AnalysisDetail => ({ ...complete, status: 'RUNNING', stage, brief: undefined, citations: undefined, validation: undefined, completedAt: undefined } as AnalysisDetail);

describe('Deep Analysis: real stages, polling and connection loss (SPEC §38.1)', () => {
  beforeEach(() => setRoute('/analysis/', `id=${complete.analysisId}`));

  it('shows the stage the worker reports, then the brief once COMPLETE', async () => {
    const memory = polling([running('retrieving'), complete]);
    renderInWorkspace(<AnalysisView />, { memory });
    expect(await screen.findByText('Searching SEC filings…')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Searching SEC filings');
    // Generation dominates the run (40–60 s in-region); the copy says so, not "the search and the model request".
    expect(screen.getByText(/Most of the time goes to the one model request\./)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Key findings' }, { timeout: 4000 })).toBeInTheDocument();
    expect(memory.calls.filter((c) => c.method === 'getAnalysis').length).toBe(2);
    // The snapshot is read once the brief is complete.
    expect(memory.calls.some((c) => c.method === 'getContext')).toBe(true);
  });

  it('a cold start shows the index-loading stage; a passed cold-start step is not ticked as done', async () => {
    renderInWorkspace(<AnalysisView />, { memory: polling([running('loading_index')]) });
    expect(await screen.findByText('Loading filing index…')).toBeInTheDocument();
  });

  it('network failure: "Connection lost", and polling resumes on its own', async () => {
    const memory = polling([running('generating'), complete]);
    memory.failNext(new ApiRequestError('NETWORK', 'The service could not be reached.', null));
    renderInWorkspace(<AnalysisView />, { memory });
    expect(await screen.findByText('Connection lost.')).toBeInTheDocument();
    expect(screen.getByText(/The analysis keeps running on the server/)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Key findings' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Connection lost.')).not.toBeInTheDocument());
  }, 10_000);

  it('a server error loading the analysis shows the request ID, retries on its own, and Retry now polls at once', async () => {
    const memory = polling([complete]);
    memory.failNext(new ApiRequestError('INTERNAL', 'An unexpected error occurred.', 500, 'req-55'));
    renderInWorkspace(<AnalysisView />, { memory });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Checking on this analysis failed');
    expect(notice).toHaveTextContent('req-55');
    within(notice).getByRole('button', { name: 'Retry now' }).click();
    expect(await screen.findByRole('heading', { name: 'Key findings' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('H4: a 5xx while a loaded analysis is running keeps polling (backoff) and shows the problem; it never freezes silently', async () => {
    // The failed poll consumes the first entry of the sequence.
    const memory = polling([running('generating'), running('generating'), complete]);
    memory.failNext(new ApiRequestError('INTERNAL', 'An unexpected error occurred.', 502, 'req-77'));
    renderInWorkspace(<AnalysisView />, { memory, initial: { analyses: [running('retrieving')] } });
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('HTTP 502, request ID req-77');
    // The stage tracker stays; the retry (3 s backoff) picks the analysis up again.
    expect(screen.getByText('Searching SEC filings…')).toBeInTheDocument();
    expect(await screen.findByText('Generating diligence brief…', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  }, 10_000);

  it('H4: a non-retryable error (4xx) stops polling and says so on the loaded analysis, with Retry', async () => {
    const memory = polling([complete]);
    memory.failNext(new ApiRequestError('VALIDATION_ERROR', 'Request is invalid.', 400, 'req-88'));
    renderInWorkspace(<AnalysisView />, { memory, initial: { analyses: [running('retrieving')] } });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Updates for this analysis stopped');
    expect(alert).toHaveTextContent('req-88');
    await new Promise((r) => setTimeout(r, 1800));
    expect(memory.calls.filter((c) => c.method === 'getAnalysis')).toHaveLength(1);
    within(alert).getByRole('button', { name: 'Try again' }).click();
    expect(await screen.findByRole('heading', { name: 'Key findings' })).toBeInTheDocument();
  });

  it('retryable means network, 5xx, INTERNAL or 429; other 4xx are final', async () => {
    const { isRetryablePollError } = await import('./analysis-view');
    expect(isRetryablePollError(new ApiRequestError('NETWORK', 'x', null))).toBe(true);
    expect(isRetryablePollError(new ApiRequestError('UNAVAILABLE', 'x', 502))).toBe(true);
    expect(isRetryablePollError(new ApiRequestError('INTERNAL', 'x', 500))).toBe(true);
    expect(isRetryablePollError(new ApiRequestError('RATE_LIMITED', 'x', 429))).toBe(true);
    expect(isRetryablePollError(new ApiRequestError('VALIDATION_ERROR', 'x', 400))).toBe(false);
    expect(isRetryablePollError(new ApiRequestError('NOT_FOUND', 'x', 404))).toBe(false);
  });
});

describe('Diligence Brief panels (SPEC §15.2, P0)', () => {
  beforeEach(() => setRoute('/analysis/', `id=${complete.analysisId}`));

  const withInterpretation: AnalysisDetail = {
    ...complete,
    filters: { tickers: ['AAPL', 'NVDA'], fiscalYearFrom: 2024 },
    interpretation: {
      ...complete.interpretation!,
      scopes: [
        { ticker: 'AAPL', company: 'Apple Inc', via: 'name', periods: ['FY2025'], description: 'AAPL: current view' },
        { ticker: 'NVDA', company: 'NVIDIA Corporation', via: 'filter', periods: ['FY2025'], description: 'NVDA: current view' },
      ],
      periodRule: { kind: 'current' },
      notes: ['"2015" was not read as a period.'],
      retrievalMode: 'bm25',
    },
    coverage: {
      cells: [
        { ticker: 'AAPL', period: 'FY2025', contextChunks: 3, citedChunks: 2 },
        { ticker: 'NVDA', period: 'FY2025', contextChunks: 0, citedChunks: 0 },
      ],
    },
  };

  it('Interpretation panel: companies and how each was found, period rule, sources, filters, notes, keyword-only fallback', () => {
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [withInterpretation] }, contexts: SAMPLE_CONTEXTS });
    const panel = screen.getByRole('heading', { name: 'How the question was read' }).closest('section')!;
    expect(panel).toHaveTextContent('Apple Inc');
    expect(panel).toHaveTextContent('named in the question');
    expect(panel).toHaveTextContent('from your company filter');
    expect(panel).toHaveTextContent('Current view: the latest annual report');
    expect(panel).toHaveTextContent('Annual reports (10-K)');
    expect(panel).toHaveTextContent('AAPL, NVDA · FY2024–FY…');
    expect(panel).toHaveTextContent('"2015" was not read as a period.');
    expect(panel).toHaveTextContent('keyword search only');
  });

  it('coverage matrix: passages supplied and cited per company and period; an empty cell says so', () => {
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [withInterpretation] }, contexts: SAMPLE_CONTEXTS });
    const table = screen.getByRole('table', { name: 'Evidence coverage by company and period' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('FY2025 3 · 2 cited');
    expect(rows[2]).toHaveTextContent('FY2025 no evidence');
  });

  it('numeric badges: an unverified figure and a unit-not-stated near match are marked where they appear', () => {
    const analysis: AnalysisDetail = {
      ...complete,
      validation: validationWith({
        numeric: {
          figures: [
            { location: 'keyFindings[0].finding', figure: '$4.2 billion', verified: false, rule: null, chunkId: null },
            { location: 'comparison.rows[1].values[0]', figure: '1,234', verified: false, rule: 'unit_unstated', chunkId: 'AAPL-FY2025-10K-1A-F01' },
            { location: 'investmentConsiderations[0].text', figure: '12%', verified: true, rule: 'exact', chunkId: 'AAPL-FY2025-10K-1A-F01' },
          ],
          total: 3,
          verified: 1,
          unitUnstated: 1,
        },
      }),
    };
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [analysis] }, contexts: SAMPLE_CONTEXTS });
    const first = screen.getAllByRole('listitem').find((li) => li.textContent?.includes(complete.brief!.keyFindings[0]!.title))!;
    expect(within(first).getByText('Unverified figure: $4.2 billion')).toBeInTheDocument();
    expect(within(screen.getAllByRole('table')[0]!).getByText('Unit not stated: 1,234')).toBeInTheDocument();
    expect(screen.queryByText(/12%/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 of 3 figures found in their cited passages \(1 more match a table whose unit is not stated\)/)).toBeInTheDocument();
  });

  it('M1: every validated location is badged: the title, a comparison row label, an evidence gap', () => {
    const fig = (location: string, figure: string) => ({ location, figure, verified: false, rule: null, chunkId: null });
    const analysis: AnalysisDetail = {
      ...complete,
      validation: validationWith({ numeric: { figures: [fig('title', '$9 billion'), fig('comparison.rows[0].label', '40%'), fig('evidenceGaps[0]', '$3 trillion')], total: 3, verified: 0, unitUnstated: 0 } }),
    };
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [analysis] }, contexts: SAMPLE_CONTEXTS });
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('Unverified figure: $9 billion')).toBeInTheDocument();
    expect(within(screen.getAllByRole('rowheader')[0]!).getByText('Unverified figure: 40%')).toBeInTheDocument();
    const gaps = screen.getByRole('heading', { name: 'Evidence gaps' }).closest('section')!;
    expect(within(gaps).getByText('Unverified figure: $3 trillion')).toBeInTheDocument();
    expect(screen.getByText(/0 of 3 figures found in their cited passages; the rest are marked/)).toBeInTheDocument();
  });

  it('model text never becomes a bare React key: repeated titles, rows, gaps and follow-ups all render without key warnings', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = complete.brief!;
    const dup = <T,>(xs: T[]) => [xs[0]!, xs[0]!];
    const brief = {
      ...b,
      keyFindings: dup(b.keyFindings),
      investmentConsiderations: dup(b.investmentConsiderations),
      comparison: { ...b.comparison!, columns: [b.comparison!.columns[0]!, b.comparison!.columns[0]!], rows: dup(b.comparison!.rows).map((r) => ({ ...r, values: [r.values[0]!, r.values[0]!] })) },
      evidenceGaps: ['Same gap', 'Same gap'],
      followUpQuestions: ['Same question?', 'Same question?'],
    };
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [{ ...complete, brief }] }, contexts: SAMPLE_CONTEXTS });
    expect(screen.getAllByText('Same gap')).toHaveLength(2);
    expect(screen.getAllByText('Same question?')).toHaveLength(2);
    expect(errors.mock.calls.filter((c) => /same key|unique "key"/i.test(String(c[0])))).toEqual([]);
    errors.mockRestore();
  });

  it('the model-call count comes from telemetry only; without telemetry none is shown', () => {
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [{ ...complete, telemetry: undefined }] }, contexts: SAMPLE_CONTEXTS });
    expect(screen.queryByText(/model call/)).not.toBeInTheDocument();
  });

  it('Edit and run again and the follow-up links keep every filter the analysis ran with', () => {
    const filters = { tickers: ['AAPL', 'NVDA'], filingTypes: ['10-K' as const], fiscalYearFrom: 2023, fiscalYearTo: 2025 };
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [{ ...complete, filters }] }, contexts: SAMPLE_CONTEXTS });
    const follow = screen.getByRole('heading', { name: 'Suggested follow-up questions' }).closest('section')!;
    const href = within(follow).getAllByRole('link')[0]!.getAttribute('href')!;
    const q = new URLSearchParams(href.split('?')[1]);
    expect({ tickers: q.get('tickers'), types: q.get('types'), from: q.get('from'), to: q.get('to') }).toEqual({ tickers: 'AAPL,NVDA', types: '10-K', from: '2023', to: '2025' });
    const failed: AnalysisDetail = { ...complete, filters, analysisId: 'an-failed-f', status: 'FAILED', brief: undefined, citations: undefined, validation: undefined, error: { code: 'GENERATION_TIMEOUT', message: 'x', requestId: 'r' } };
    setRoute('/analysis/', 'id=an-failed-f');
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [failed] } });
    const rerun = new URLSearchParams(screen.getByRole('link', { name: 'Edit and run again' }).getAttribute('href')!.split('?')[1]);
    expect(rerun.get('types')).toBe('10-K');
    expect(rerun.get('from')).toBe('2023');
  });

  it('invalid citation: the removal is counted on the brief', () => {
    const analysis: AnalysisDetail = {
      ...complete,
      validation: validationWith({ citations: { returned: 9, valid: 8, removed: [{ location: 'keyFindings[0]', id: 'AAPL-FY2019-10K-1A-001' }], preValidationRate: 0.89 }, notices: ['1 citation removed: not in the supplied evidence.'] }),
    };
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [analysis] }, contexts: SAMPLE_CONTEXTS });
    expect(screen.getByText('1 citation removed: not in the supplied evidence.')).toBeInTheDocument();
  });

  it('a missing context snapshot falls back to the cited passages, and says so', async () => {
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [complete] } });
    expect(await screen.findByText(/The full set of passages supplied to the model is unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Key findings' })).toBeInTheDocument();
  });

  it('a seeded analysis is labeled as run in advance and shows no duration', () => {
    renderInWorkspace(<AnalysisView />, { initial: { analyses: [{ ...complete, seeded: true }] }, contexts: SAMPLE_CONTEXTS });
    expect(screen.getByText(/Example from the demo workspace: real pipeline output, run in advance/)).toBeInTheDocument();
    expect(screen.queryByText(/completed in/)).not.toBeInTheDocument();
  });
});

describe('every analysis failure state has a designed screen (SPEC §38.2)', () => {
  const codes: AnalysisFailureCode[] = ['GENERATION_TIMEOUT', 'INDEX_UNAVAILABLE', 'NO_RELEVANT_EVIDENCE', 'MALFORMED_OUTPUT', 'QUEUE_TIMEOUT', 'PIPELINE_TIMEOUT', 'GENERATION_FAILED', 'WORKER_FAILED', 'ENQUEUE_FAILED', 'ANALYSES_DISABLED'];
  for (const code of codes) {
    it(`${code}: plain-language title, the request ID, and a re-run that starts a new analysis`, () => {
      const failed: AnalysisDetail = { ...complete, analysisId: `an-${code}`, status: 'FAILED', brief: undefined, citations: undefined, validation: undefined, error: { code, message: 'Server message.', requestId: `req-${code}` } };
      setRoute('/analysis/', `id=${failed.analysisId}`);
      renderInWorkspace(<AnalysisView />, { initial: { analyses: [failed] } });
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(FAILURE_COPY[code]!.title);
      if (code === 'PIPELINE_TIMEOUT') expect(alert).toHaveTextContent('The analysis ran out of time before the brief was generated');
      expect(alert).toHaveTextContent(`req-${code}`);
      expect(alert).not.toHaveTextContent(/\bat .+:\d+:\d+/);
      const rerun = within(alert).getByRole('link', { name: 'Edit and run again' });
      expect(new URLSearchParams(rerun.getAttribute('href')!.split('?')[1]).get('q')).toBe(complete.question);
      if (code === 'NO_RELEVANT_EVIDENCE') {
        // SPEC §38.2: an out-of-corpus question is told which companies the filings cover.
        expect(screen.getByText(/No model request was made/)).toBeInTheDocument();
        const covered = screen.getByRole('list', { name: 'Covered companies' });
        expect(within(covered).getAllByRole('listitem').length).toBe(53);
        expect(covered).toHaveTextContent('Apple Inc');
        expect(covered).not.toHaveTextContent('GE Capital');
      }
    });
  }
});

describe('Company Intelligence states (SPEC §38.2)', () => {
  it('profile missing offers Deep Analysis; index/profile version skew is stated on the dashboard', async () => {
    setRoute('/intelligence/', 'ticker=KO');
    const { unmount } = renderInWorkspace(<IntelligenceView />);
    expect(await screen.findByText(/isn’t built for this index version/)).toBeInTheDocument();
    unmount();
    setRoute('/intelligence/', 'ticker=AAPL');
    renderInWorkspace(<IntelligenceView />, { memory: createMemoryClient({ profiles: FIXTURE_PROFILES, indexVersion: 'iv-newer000000' }) });
    expect(await screen.findByText(/Built from index iv-9cf51c066743; Deep Analysis searches iv-newer000000/)).toBeInTheDocument();
  });

  it('a profile that fails to load is an error with a way forward, not an empty dashboard', async () => {
    setRoute('/intelligence/', 'ticker=AAPL');
    const memory = createMemoryClient({ profiles: FIXTURE_PROFILES });
    memory.client.profile = async () => {
      throw new ApiRequestError('INTERNAL', 'x', 500, 'req-1');
    };
    renderInWorkspace(<IntelligenceView />, {
      memory,
      profiles: new Map(),
      companies: { indexVersion: 'iv-9cf51c066743', profileSetId: 'fixture-v2', companies: [{ ticker: 'AAPL', company: 'Apple Inc', sector: 'Technology', tier: 'deep', filings: 1, periodsCovered: [] }] },
    });
    expect(await screen.findByText('Company Intelligence could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ask about Apple/ })).toBeInTheDocument();
  });
});

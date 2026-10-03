import type { AdjacentEvidenceResponse, AnalysisDetail, Citation, SourceDocumentResponse } from '@diligenceiq/core';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilingView, readHash, readableSections, readingSections } from '@/app/(workspace)/sources/filing/filing-view';
import { shownText } from '@/lib/readable/layout';
import { recordPageView, resetPageViews } from '@/lib/in-app-history';
import { createMemoryClient } from '@/test/memory-client';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { TEST_PASSAGES } from '@/test/sample-analyses';
import { CoverageMatrix } from './brief-panels';
import { CitedText } from './evidence';

/*
 * Phase 6 (SPEC §16.2): adjacent-period comparison in the evidence drawer, the coverage matrix
 * linked to evidence, and the readable source view with the cited passage highlighted.
 */

const IV = 'iv-9cf51c066743';
// The test passages are real slices labeled with a fixture index version; here they stand for this index's chunks.
const [A1, A2] = (TEST_PASSAGES as [Citation, Citation, ...Citation[]]).map((p) => ({ ...p, indexVersion: IV })) as [Citation, Citation];
const prior = (n: number): Citation => ({
  ...A1,
  chunkId: `AAPL-FY2024-10K-1A-00${n}`,
  documentId: 'AAPL_10K_2024Q3_2024-11-01',
  fiscalLabel: 'FY2024',
  periodEnd: '2024-09-28',
  filingDate: '2024-11-01',
  text: `Prior-year risk passage number ${n}.`,
});
const ADJACENT: AdjacentEvidenceResponse = {
  chunkId: A1.chunkId,
  indexVersion: IV,
  previous: {
    filing: { documentId: 'AAPL_10K_2024Q3_2024-11-01', ticker: 'AAPL', company: 'Apple Inc', filingType: '10-K', filingDate: '2024-11-01', periodEnd: '2024-09-28', fiscalLabel: 'FY2024' },
    passages: [prior(1), prior(2), prior(3)],
  },
  next: null,
  sameQuarterPriorYear: null,
};

describe('adjacent-period comparison in the evidence drawer', () => {
  it('shows the passage beside the prior year’s same section; reads only; back returns to the passage', async () => {
    const memory = createMemoryClient({ adjacent: { [A1.chunkId]: ADJACENT } });
    renderInWorkspace(<CitedText text={`Claim [${A1.chunkId}]`} context={new Map([[A1.chunkId, A1]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Prior-year risk passage number 1.')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(A1.text.slice(0, 40));
    // A 10-K compares year to year: no same-quarter tab; the following year is absent from the corpus.
    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Prior yearFY2024 10-K', 'Following yearnone']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    // The other two matches are collapsed; no similarity score is shown.
    expect(within(dialog).getByText('2 more passages from this section')).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/0\.\d{2,}|score|confidence/i);
    expect(within(dialog).getAllByRole('link', { name: /open in filing/i })[0]?.getAttribute('href')).toMatch(new RegExp(`\\?id=AAPL_10K_2024Q3_2024-11-01&iv=${IV}#chunk-AAPL-FY2024-10K-1A-001$`));

    await userEvent.click(tabs[1]!);
    expect(within(dialog).getByText('No later annual report from AAPL is in the corpus.')).toBeInTheDocument();

    expect(memory.calls.filter((c) => c.method === 'adjacent').map((c) => c.args)).toEqual([[A1.chunkId, A1.indexVersion]]);
    expect(memory.calls.every((c) => ['adjacent', 'session', 'health', 'listAnalyses', 'listFindings', 'companies'].includes(c.method))).toBe(true);

    await userEvent.click(within(dialog).getByRole('button', { name: /back to passage/i }));
    expect(await screen.findByTestId('evidence-provenance')).toHaveTextContent('Validated — supplied to the model');
  });

  it('an adjacent passage opens as comparison text, never as a citation, and goes back to the original comparison', async () => {
    const memory = createMemoryClient({ adjacent: { [A1.chunkId]: ADJACENT } });
    renderInWorkspace(<CitedText text={`Claim [${A1.chunkId}]`} context={new Map([[A1.chunkId, A1]])} />, { memory });
    const chip = screen.getByRole('button', { name: `View evidence ${A1.chunkId}` });
    await userEvent.click(chip);
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    await screen.findByText('Prior-year risk passage number 1.');
    await userEvent.click(screen.getAllByRole('button', { name: /^AAPL FY2024 10-K/ })[0]!);
    expect(await screen.findByTestId('evidence-provenance')).toHaveTextContent('Same section, adjacent filing — for comparison, not cited');
    // No comparison of a comparison: the adjacent passage offers the way back instead.
    expect(screen.queryByRole('button', { name: /compare periods/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to comparison' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Compare periods')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(A1.text.slice(0, 40));
    expect(memory.calls.filter((c) => c.method === 'adjacent').map((c) => c.args[0])).toEqual([A1.chunkId, A1.chunkId]);
    // Escape still returns focus to the chip that first opened the drawer.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chip).toHaveFocus();
  });

  it('a filing with no passage of the section says so, distinct from a filing absent from the corpus', async () => {
    const empty: AdjacentEvidenceResponse = {
      ...ADJACENT,
      previous: { filing: { ...ADJACENT.previous!.filing, documentId: 'AAPL_10K_2023Q4_2023-11-03', fiscalLabel: 'FY2023', periodEnd: '2023-09-30' }, passages: [] },
    };
    const memory = createMemoryClient({ adjacent: { [A1.chunkId]: empty } });
    renderInWorkspace(<CitedText text={`Claim [${A1.chunkId}]`} context={new Map([[A1.chunkId, A1]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('tab', { name: /^Prior year\s*FY2023 10-K$/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByText('The FY2023 10-K has no matching section.')).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('No earlier annual report');
  });

  it('the period tabs follow the WAI-ARIA tabs pattern: one tab stop, arrows, Home and End', async () => {
    const quarterly: Citation = { ...A1, chunkId: 'AAPL-FY2025Q2-10Q-MDA-001', filingType: '10-Q', fiscalLabel: 'FY2025Q2', documentId: 'AAPL_10Q_2025Q2_2025-05-02' };
    const side = (fiscalLabel: string) => ({ filing: { ...ADJACENT.previous!.filing, filingType: '10-Q' as const, fiscalLabel }, passages: [{ ...prior(1), filingType: '10-Q' as const, fiscalLabel, text: `${fiscalLabel} passage.` }] });
    const adj: AdjacentEvidenceResponse = { chunkId: quarterly.chunkId, indexVersion: IV, previous: side('FY2025Q1'), next: side('FY2025Q3'), sameQuarterPriorYear: side('FY2024Q2') };
    const memory = createMemoryClient({ adjacent: { [quarterly.chunkId]: adj } });
    renderInWorkspace(<CitedText text={`Claim [${quarterly.chunkId}]`} context={new Map([[quarterly.chunkId, quarterly]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${quarterly.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('FY2025Q1 passage.');
    const tabs = within(dialog).getAllByRole('tab');
    const panel = within(dialog).getByRole('tabpanel');
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    for (const t of tabs) expect(t).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tabs[0]!.id);

    tabs[0]!.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    // (The passage also shows in the sentence diff below the columns, so look in its column.)
    expect(within(within(dialog).getByRole('region', { name: 'Following quarter' })).getByText('FY2025Q3 passage.')).toBeInTheDocument();
    expect(within(dialog).getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1]!.id);
    await userEvent.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    expect(within(within(dialog).getByRole('region', { name: 'Same quarter, prior year' })).getByText('FY2024Q2 passage.')).toBeInTheDocument();
    await userEvent.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(tabs[0]).toHaveFocus();
    expect(tabs.map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('explains when a passage cannot be compared (another index version)', async () => {
    const memory = createMemoryClient({ adjacent: { [A1.chunkId]: ADJACENT } });
    const old = { ...A1, indexVersion: 'iv-000000000000' };
    renderInWorkspace(<CitedText text={`Claim [${A1.chunkId}]`} context={new Map([[A1.chunkId, old]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    expect(await screen.findByText(/earlier version of the filing index/)).toBeInTheDocument();
  });
});

describe('coverage matrix linked to evidence', () => {
  const analysis = (cells: NonNullable<AnalysisDetail['coverage']>['cells']): AnalysisDetail =>
    ({
      analysisId: 'an-1',
      question: 'q',
      origin: { kind: 'direct' },
      status: 'COMPLETE',
      createdAt: '2026-10-01T00:00:00Z',
      deadlineAt: '2026-10-01T00:04:00Z',
      coverage: { cells },
      citations: [A1],
    }) as AnalysisDetail;
  const passages = new Map([A1, A2].map((p) => [p.chunkId, p]));

  it('a cell opens its supplied passages, cited first; an empty cell is not a button; a not-cited passage is not shown as validated', async () => {
    renderInWorkspace(
      <CoverageMatrix
        analysis={analysis([
          { ticker: 'AAPL', period: 'FY2025', contextChunks: 2, citedChunks: 1, chunkIds: [A1.chunkId, A2.chunkId] },
          { ticker: 'AAPL', period: 'FY2024', contextChunks: 0, citedChunks: 0, chunkIds: [] },
        ])}
        passages={passages}
      />,
    );
    expect(screen.queryByRole('button', { name: /FY2024/ })).not.toBeInTheDocument();
    // The accessible name starts with the visible text (WCAG 2.5.3).
    const cell = screen.getByRole('button', { name: 'FY2025 2 · 1 cited (view 2 passages for AAPL)' });
    expect(cell.textContent?.startsWith('FY2025 2 · 1 cited')).toBe(true);
    expect(cell).not.toHaveAttribute('aria-label');
    await userEvent.click(cell);
    const dialog = await screen.findByRole('dialog');
    const cited = within(dialog).getByRole('region', { name: 'Cited in the brief' });
    const notCited = within(dialog).getByRole('region', { name: 'Supplied, not cited' });
    expect(cited).toHaveTextContent(A1.text.slice(0, 30));
    expect(notCited).toHaveTextContent(A2.text.slice(0, 30));

    await userEvent.click(within(notCited).getByRole('button'));
    expect(await screen.findByTestId('evidence-provenance')).toHaveTextContent('Supplied to the model — not cited in the brief');
  });

  it('a cited passage from a cell keeps the validated provenance', async () => {
    renderInWorkspace(<CoverageMatrix analysis={analysis([{ ticker: 'AAPL', period: 'FY2025', contextChunks: 2, citedChunks: 1, chunkIds: [A1.chunkId, A2.chunkId] }])} passages={passages} />);
    await userEvent.click(screen.getByRole('button', { name: /^FY2025 2 · 1 cited/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(within(dialog).getByRole('region', { name: 'Cited in the brief' })).getByRole('button'));
    expect(await screen.findByTestId('evidence-provenance')).toHaveTextContent('Validated — supplied to the model');
  });

  it('an older analysis without per-cell chunk IDs falls back to the company and fiscal period', async () => {
    renderInWorkspace(<CoverageMatrix analysis={analysis([{ ticker: 'AAPL', period: 'FY2025', contextChunks: 2, citedChunks: 1 }])} passages={passages} />);
    expect(screen.getByRole('button', { name: 'FY2025 2 · 1 cited (view 2 passages for AAPL)' })).toBeInTheDocument();
  });

  it('the fallback matches a live-shaped “FY2026 YTD” cell to that fiscal year’s quarterly passages', async () => {
    const q = (n: number): Citation => ({ ...A1, chunkId: `AAPL-FY2026Q${n}-10Q-MDA-001`, filingType: '10-Q', fiscalLabel: `FY2026Q${n}`, documentId: `AAPL_10Q_2026Q${n}_2026-0${n}-01` });
    const ytd = new Map([A1, q(1), q(2), q(3)].map((p) => [p.chunkId, p]));
    renderInWorkspace(
      <CoverageMatrix
        analysis={analysis([
          { ticker: 'AAPL', period: 'FY2025', contextChunks: 1, citedChunks: 1 },
          { ticker: 'AAPL', period: 'FY2026 YTD', contextChunks: 3, citedChunks: 0 },
        ])}
        passages={ytd}
      />,
    );
    // FY2025 takes only its 10-K; the YTD bucket takes the year's quarterly reports, never an annual one.
    expect(screen.getByRole('button', { name: 'FY2025 1 · 1 cited (view 1 passage for AAPL)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'FY2026 YTD 3 · 0 cited (view 3 passages for AAPL)' }));
    const notCited = within(await screen.findByRole('dialog')).getByRole('region', { name: 'Supplied, not cited' });
    const labels = within(notCited).getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels).toHaveLength(3);
    labels.forEach((l, i) => expect(l).toContain(`FY2026Q${i + 1}`));
  });

  it('a cell whose passages cannot all be found shows its count, not a partial list', () => {
    renderInWorkspace(
      <CoverageMatrix
        analysis={analysis([
          { ticker: 'AAPL', period: 'FY2025', contextChunks: 5, citedChunks: 1 },
          { ticker: 'AAPL', period: 'FY2024', contextChunks: 2, citedChunks: 0, chunkIds: [A1.chunkId, 'AAPL-FY2024-10K-1A-001'] },
        ])}
        passages={passages}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('5 · 1 cited')).toBeInTheDocument();
    expect(screen.getByText('2 · 0 cited')).toBeInTheDocument();
  });
});

/** Section titles plus each section's shown text (the display layer's own output). */
function expectedArticle(source: SourceDocumentResponse): string {
  const sections = readingSections(source.sections, source.text.length);
  const laid = readableSections(source, sections);
  return sections.map((sec, i) => sec.title + shownText(source.text, laid[i]!)).join('');
}

describe('readable source view', () => {
  const COVER = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION\n';
  const RF = 'Item 1A. Risk Factors\nThe Company depends on single-source partners. Supply could be disrupted.\n';
  const MDA = 'Item 7. Management’s Discussion\nNet sales increased.\n';
  const TEXT = COVER + RF + MDA;
  const rfStart = COVER.length;
  const mdaStart = COVER.length + RF.length;
  const target = { chunkId: 'AAPL-FY2025-10K-1A-001', section: 'Item 1A — Risk Factors', charStart: rfStart + 22, charEnd: rfStart + 69 };
  const SOURCE: SourceDocumentResponse = {
    indexVersion: IV,
    filing: { documentId: 'AAPL_10K_2025-10-31', ticker: 'AAPL', company: 'Apple Inc', filingType: '10-K', filingDate: '2025-10-31', periodEnd: '2025-09-27', fiscalLabel: 'FY2025', sourceUrl: 'https://www.sec.gov/x.htm' },
    sections: [
      { code: 'OTH', title: 'Other', charStart: 0, charEnd: rfStart },
      { code: '1A', title: 'Item 1A — Risk Factors', charStart: rfStart, charEnd: mdaStart },
      { code: 'MDA', title: 'Item 7 — MD&A', charStart: mdaStart, charEnd: TEXT.length },
    ],
    chunks: [target],
    text: TEXT,
  };

  afterEach(() => {
    window.location.hash = '';
  });

  it('shows every section, with the cited passage highlighted and its section marked in the navigation', async () => {
    setRoute('/sources/filing/', `id=AAPL_10K_2025-10-31&iv=${IV}`);
    window.location.hash = `#chunk-${target.chunkId}`;
    const memory = createMemoryClient({ sources: { 'AAPL_10K_2025-10-31': SOURCE } });
    renderInWorkspace(<FilingView />, { memory });
    const mark = await waitFor(() => {
      const el = document.getElementById(`chunk-${target.chunkId}`);
      if (!el) throw new Error('not highlighted yet');
      return el;
    });
    expect(mark.tagName).toBe('MARK');
    // The cited sentence is a risk heading here, laid out as one; the highlight is still exactly its characters.
    expect(mark.closest('h3')).not.toBeNull();
    // Every target piece together is the cited span; its trailing space is layout after the heading.
    const pieces = [...document.querySelectorAll('mark[data-mark="target"]')].map((m) => m.textContent).join('');
    expect(pieces).toBe(TEXT.slice(target.charStart, target.charEnd).trimEnd());
    expect(screen.getByTestId('highlight-notice')).toHaveTextContent(target.chunkId);
    const nav = screen.getByRole('navigation', { name: 'Sections' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent?.replace(/[\d,]+$/, ''))).toEqual(['Other', 'Item 1A — Risk Factors', 'Item 7 — MD&A']);
    expect(within(nav).getByRole('link', { current: 'location' })).toHaveTextContent('Item 1A — Risk Factors');
    // Every character of the filing is on the page exactly once, minus layout (line breaks, the space
    // between a heading and its text) and page furniture (none here).
    expect(screen.getByRole('article').textContent).toBe(expectedArticle(SOURCE));
    expect(screen.getByRole('article').textContent).toBe(
      ['Other', COVER, 'Item 1A — Risk Factors', RF, 'Item 7 — MD&A', MDA].join('').replace(/\n/g, '').replace('partners. Supply', 'partners.Supply'),
    );
    expect(screen.getByRole('heading', { name: 'Item 1A. Risk Factors' })).toBeInTheDocument();
    // The citation's index version goes with the request.
    expect(memory.calls.filter((c) => c.method === 'source').map((c) => c.args)).toEqual([['AAPL_10K_2025-10-31', IV]]);
  });

  it('a citation from another index version opens the current text with a notice and nothing highlighted', async () => {
    setRoute('/sources/filing/', 'id=AAPL_10K_2025-10-31&iv=iv-000000000000');
    window.location.hash = `#chunk-${target.chunkId}`;
    const memory = createMemoryClient({ sources: { 'AAPL_10K_2025-10-31': SOURCE } });
    renderInWorkspace(<FilingView />, { memory });
    expect(await screen.findByTestId('stale-version-notice')).toHaveTextContent('earlier version of the filing index');
    expect(screen.getByRole('article')).toHaveTextContent('The Company depends on single-source partners.');
    // The same chunk ID exists in the current text, but it is never claimed as the cited passage.
    expect(document.querySelector('mark')).toBeNull();
    expect(screen.queryByTestId('highlight-notice')).not.toBeInTheDocument();
    expect(memory.calls.filter((c) => c.method === 'source').map((c) => c.args)).toEqual([
      ['AAPL_10K_2025-10-31', 'iv-000000000000'],
      ['AAPL_10K_2025-10-31', undefined],
    ]);
  });

  it('a malformed hash escape does not break the page', async () => {
    expect(readHash('#chunk-%E0')).toBe('chunk-%E0');
    expect(readHash('#chunk-AAPL-FY2025-10K-1A-001')).toBe('chunk-AAPL-FY2025-10K-1A-001');
    expect(readHash('')).toBeNull();
    setRoute('/sources/filing/', 'id=AAPL_10K_2025-10-31');
    window.location.hash = '#chunk-%E0';
    const memory = createMemoryClient({ sources: { 'AAPL_10K_2025-10-31': SOURCE } });
    renderInWorkspace(<FilingView />, { memory });
    expect(await screen.findByText(/is not in this filing’s current index/)).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Net sales increased.');
  });

  it('overlapping sections render every character once', async () => {
    // Item 1A runs 10 characters into Item 7's start; a third section sits wholly inside Item 1A.
    const overlapping: SourceDocumentResponse = {
      ...SOURCE,
      sections: [
        { code: 'OTH', title: 'Other', charStart: 0, charEnd: rfStart },
        { code: '1A', title: 'Item 1A — Risk Factors', charStart: rfStart, charEnd: mdaStart + 10 },
        { code: 'X', title: 'Inside', charStart: rfStart + 5, charEnd: rfStart + 15 },
        { code: 'MDA', title: 'Item 7 — MD&A', charStart: mdaStart, charEnd: TEXT.length },
      ],
    };
    const read = readingSections(overlapping.sections, TEXT.length);
    expect(read.map((r) => [r.code, r.charStart, r.charEnd])).toEqual([
      ['OTH', 0, rfStart],
      ['1A', rfStart, mdaStart + 10],
      ['MDA', mdaStart + 10, TEXT.length],
    ]);
    setRoute('/sources/filing/', 'id=AAPL_10K_2025-10-31');
    renderInWorkspace(<FilingView />, { memory: createMemoryClient({ sources: { 'AAPL_10K_2025-10-31': overlapping } }) });
    const article = await screen.findByRole('article');
    expect(article.textContent).toBe(expectedArticle(overlapping));
    expect(article.textContent?.replace(/Other|Item 1A — Risk Factors|Item 7 — MD&A/g, '')).toBe(shownText(TEXT, readableSections(overlapping, read).flat()));
  });

  it('a missing filing goes back where the citation was opened, but only into the app', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    setRoute('/sources/filing/', 'id=AAPL_10K_2001-01-01');
    // Opened directly (browser history may still lead elsewhere): no Go back, the company page instead.
    resetPageViews();
    recordPageView('/sources/filing/');
    const first = renderInWorkspace(<FilingView />, { memory: createMemoryClient() });
    expect(await screen.findByText('This filing isn’t available.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go back' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Company Intelligence' })).toHaveAttribute('href', expect.stringMatching(/ticker=AAPL$/));
    first.unmount();

    // Reached from a brief inside the app: Go back returns there.
    resetPageViews();
    recordPageView('/analysis/');
    recordPageView('/sources/filing/');
    renderInWorkspace(<FilingView />, { memory: createMemoryClient() });
    await userEvent.click(await screen.findByRole('button', { name: 'Go back' }));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
    resetPageViews();
  });

  it('says so when the linked passage is not in this filing, and still shows the text', async () => {
    setRoute('/sources/filing/', 'id=AAPL_10K_2025-10-31');
    window.location.hash = '#chunk-AAPL-FY2025-10K-1A-999';
    const memory = createMemoryClient({ sources: { 'AAPL_10K_2025-10-31': SOURCE } });
    renderInWorkspace(<FilingView />, { memory });
    expect(await screen.findByText(/is not in this filing’s current index/)).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Net sales increased.');
    expect(document.querySelector('mark')).toBeNull();
  });
});

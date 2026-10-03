import { citationLabel, type Citation, type Finding } from '@diligenceiq/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { FindingsView } from './findings/findings-view';

/*
 * The refined Findings board (DD-21 h): every finding, filter, status change, citation, note and
 * delete stays one click away, in the list and in the Board view; nothing is fetched or generated.
 */

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  setRoute('/findings/');
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

const citation = (n: number, ticker = 'AAPL', fiscalLabel = 'FY2025'): Citation => ({
  chunkId: `${ticker}-${fiscalLabel}-10K-1A-00${n}`,
  indexVersion: 'iv-test',
  documentId: `${ticker}_10K_${fiscalLabel}`,
  ticker,
  company: ticker,
  filingType: '10-K',
  filingDate: '2025-10-31',
  fiscalLabel,
  periodEnd: '2025-09-27',
  section: 'Item 1A — Risk Factors',
  charStart: 0,
  charEnd: 10,
  text: `Passage ${n} text.`,
});

const finding = (id: string, over: Partial<Finding> = {}): Finding => ({
  findingId: `fd-${id}`,
  title: `Finding ${id}`,
  text: `Text of finding ${id}.`,
  theme: 'risk-factors',
  tickers: ['AAPL'],
  citations: [citation(1)],
  origin: { kind: 'intelligence', source: { kind: 'currentRisk', ticker: 'AAPL', ref: `risk-${id}` } },
  status: 'ACTIVE',
  pinnedToIC: false,
  isKey: false,
  createdAt: '2026-10-02T12:00:00Z',
  updatedAt: '2026-10-02T12:00:00Z',
  ...over,
});

const FINDINGS = [
  finding('a', { status: 'NEEDS_FOLLOW_UP', note: 'Check exposure', citations: [citation(1), citation(2), citation(3, 'AAPL', 'FY2024')] }),
  finding('b', { theme: 'financial-performance', tickers: ['NVDA'], citations: [citation(4, 'NVDA')] }),
  finding('c', { theme: 'regulatory-compliance', status: 'RESOLVED' }),
];

function render() {
  return renderInWorkspace(<FindingsView />, { initial: { findings: FINDINGS } });
}
const card = (title: string) => screen.getByRole('heading', { level: 3, name: title }).closest<HTMLElement>('.relative')!;

describe('Findings: summary strip and filters', () => {
  it('status tiles and theme bars count the board and filter in one click', () => {
    render();
    const summary = screen.getByRole('region', { name: 'Summary' });
    // The name holds the visible sub-line too (the newest finding that needs follow-up).
    const tile = within(summary).getByRole('button', { name: 'Needs Follow-Up: 1. Finding a' });
    expect(within(summary).getByRole('button', { name: 'Active: 1. Show only these' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(within(summary).getByRole('button', { name: /^Needs Follow-Up: 1\./ })).toBe(tile);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Finding a']);
    fireEvent.click(tile);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
    const theme = within(summary).getByRole('button', { name: 'Financial Performance: 1' });
    fireEvent.click(theme);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Finding b']);
    // A theme with no finding cannot be chosen from the strip.
    expect(within(summary).getByRole('button', { name: 'Strategic Shifts: 0' })).toBeDisabled();
  });

  it('search, company, status, origin are in one row; theme, analysis and dates are one click away under More filters', () => {
    render();
    fireEvent.change(screen.getByLabelText('Search findings and notes'), { target: { value: 'exposure' } });
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Finding a']);
    expect(screen.getByText(/1 filter applied/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    for (const label of ['Company', 'Status', 'Origin']) expect(screen.getByLabelText(label)).toBeVisible();
    const more = screen.getByRole('button', { name: /^More filters/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Theme')).not.toBeVisible();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    for (const label of ['Theme', 'Analysis', 'Saved from', 'Saved to']) expect(screen.getByLabelText(label)).toBeVisible();
  });

  it('a theme link (?theme=) opens More filters so the active filter is visible', () => {
    setRoute('/findings/', 'theme=risk-factors');
    render();
    expect(screen.getByRole('button', { name: 'More filters (1)' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Theme')).toHaveValue('risk-factors');
  });
});

describe('Findings: every control one click away (list and Board)', () => {
  for (const view of ['list', 'board'] as const) {
    it(`${view}: status, theme, note, Ask follow-up, delete and sources on every card`, async () => {
      render();
      if (view === 'board') {
        fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
        for (const col of ['Needs Follow-Up · 1', 'Active · 1', 'Resolved · 1']) expect(screen.getByRole('heading', { level: 2, name: col })).toBeInTheDocument();
      }
      for (const f of FINDINGS) {
        const c = card(f.title);
        expect(within(c).getByLabelText(`Status for ${f.title}`)).toHaveValue(f.status);
        expect(within(c).getByLabelText(`Theme for ${f.title}`)).toHaveValue(f.theme);
        expect(within(c).getByRole('button', { name: 'Edit note' })).toBeInTheDocument();
        expect(within(c).getByRole('button', { name: 'Delete finding' })).toBeInTheDocument();
        const ask = within(c).getByRole('link', { name: `Ask follow-up about ${f.title}` });
        const url = new URL(ask.getAttribute('href')!, 'http://x');
        expect(url.pathname).toMatch(/^\/analysis\/new\/?$/);
        expect(url.searchParams.get('origin')).toBe(`finding:${f.findingId}`);
        expect(url.searchParams.get('tickers')).toBe(f.tickers.join(','));
        expect(url.searchParams.get('q')).toMatch(new RegExp(`^Follow up on the finding “${f.title}”`));
        const n = f.citations.length;
        expect(within(c).getByRole('button', { name: n === 1 ? `1 source: open the evidence for ${f.title}` : `${n} sources: show the passages for ${f.title}` })).toBeInTheDocument();
      }
      // A note shows on its card.
      expect(card('Finding a')).toHaveTextContent('Your note: Check exposure');
    });
  }

  it('one source opens its passage directly; more unfold their citation chips, each opening its passage with its verified figures', async () => {
    renderInWorkspace(<FindingsView />, {
      initial: {
        findings: [
          FINDINGS[1]!,
          {
            ...FINDINGS[0]!,
            text: 'Net sales were $4.2 billion, up 12%.',
            citations: [{ ...citation(1), text: 'Passage 1 text. Margins grew 12%.' }, { ...citation(2), text: 'Passage 2 text. Net sales were $4.2 billion, up 12%.' }, citation(3, 'AAPL', 'FY2024')],
            figures: [
              { location: 'keyFindings[0].finding', figure: '$4.2 billion', verified: true, rule: 'exact', chunkId: citation(2).chunkId },
              { location: 'keyFindings[0].finding', figure: '12%', verified: true, rule: 'exact', chunkId: citation(1).chunkId },
            ],
          },
        ],
      },
    });
    await userEvent.click(within(card('Finding b')).getByRole('button', { name: /^1 source/ }));
    const one = await screen.findByRole('dialog');
    expect(one).toHaveTextContent('Passage 4 text.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    const a = card('Finding a');
    const toggle = within(a).getByRole('button', { name: '3 sources: show the passages for Finding a' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(list).not.toBeVisible();
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(list).toBeVisible();
    const chips = within(within(a).getByRole('list', { name: 'Sources for Finding a' })).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual([citation(1), citation(2), citation(3, 'AAPL', 'FY2024')].map((c) => citationLabel(c)));
    // One click opens that passage directly, with the figure the validator verified in it.
    await userEvent.click(chips[1]!);
    const passage = await screen.findByRole('dialog');
    expect(passage).toHaveTextContent('Passage 2 text.');
    expect(passage).not.toHaveTextContent('Passage 1 text.');
    // Only the figure verified in this passage is bolded (12% was verified in passage 1).
    expect([...within(passage).getByTestId('evidence-passage').querySelectorAll('strong')].map((b) => b.textContent)).toEqual(['$4.2 billion']);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // "View all side by side" still opens every passage by filing.
    await userEvent.click(within(a).getByRole('button', { name: 'View all side by side' }));
    const all = await screen.findByRole('dialog');
    for (const t of ['Passage 1 text.', 'Passage 2 text.', 'Passage 3 text.']) expect(all).toHaveTextContent(t);
    expect(within(all).getByRole('region', { name: 'AAPL FY2025 10-K' })).toBeInTheDocument();
    expect(within(all).getByRole('region', { name: 'AAPL FY2024 10-K' })).toBeInTheDocument();
  });

  it('Board: an empty column says the filters hide its findings when filters are active', () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    const col = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;
    expect(within(col(/^Active/)).queryByText('None match the filters')).toBeNull();
    fireEvent.change(screen.getByLabelText('Search findings and notes'), { target: { value: 'exposure' } });
    expect(within(col(/^Active/)).getByText('None match the filters')).toBeInTheDocument();
    expect(within(col(/^Active/)).queryByText('No active findings')).toBeNull();
  });

  it('a native select draws its chevron in a theme token, never a fixed colour', () => {
    render();
    const select = screen.getByLabelText('Status for Finding a');
    expect(select).toHaveClass('select-chevron');
    expect(select.className).not.toMatch(/url\(|%23|#[0-9a-f]{3,6}/i);
  });

  it('changing status in the Board moves the card to that column', async () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    const col = (name: RegExp) => screen.getByRole('heading', { level: 2, name }).closest('section')!;
    fireEvent.change(within(col(/^Active/)).getByLabelText('Status for Finding b'), { target: { value: 'RESOLVED' } });
    await waitFor(() => expect(within(col(/^Resolved/)).getByRole('heading', { level: 3, name: 'Finding b' })).toBeInTheDocument());
    expect(within(col(/^Active/)).getByText('No active findings')).toBeInTheDocument();
  });

  it('a long text is clamped with More; an unverified figure stays visible outside the clamp', () => {
    const long = 'Revenue grew to $4.2 billion. '.repeat(10);
    renderInWorkspace(<FindingsView />, {
      initial: {
        findings: [finding('z', { text: long, figures: [{ location: 'keyFindings[0].finding', figure: '$4.2 billion', verified: false, rule: null, chunkId: null }] })],
      },
    });
    const c = card('Finding z');
    expect(within(c).getByRole('button', { name: /^More:/ })).toHaveAttribute('aria-expanded', 'false');
    const badge = within(c).getByText('Unverified figure: $4.2 billion');
    expect(badge.closest('.line-clamp-2')).toBeNull();
  });

  it('grouped by company, a finding about several companies repeats with unique control IDs, each select named', () => {
    renderInWorkspace(<FindingsView />, { initial: { findings: [finding('m', { tickers: ['MSFT', 'GOOG'], citations: [citation(1, 'MSFT'), citation(2, 'GOOG')] })] } });
    fireEvent.click(screen.getByRole('radio', { name: 'Company' }));
    const selects = screen.getAllByRole('combobox', { name: 'Status for Finding m' });
    expect(selects).toHaveLength(2);
    expect(new Set(selects.map((s) => s.id)).size).toBe(2);
    expect(screen.getAllByRole('combobox', { name: 'Theme for Finding m' })).toHaveLength(2);
    const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('Board: a note being edited survives a status change that moves its card', async () => {
    render();
    fireEvent.click(screen.getByRole('radio', { name: 'Board' }));
    fireEvent.click(within(card('Finding b')).getByRole('button', { name: 'Edit note' }));
    fireEvent.change(within(card('Finding b')).getByLabelText('Analyst note'), { target: { value: 'Draft in progress' } });
    fireEvent.change(within(card('Finding b')).getByLabelText('Status for Finding b'), { target: { value: 'RESOLVED' } });
    const col = screen.getByRole('heading', { level: 2, name: /^Resolved/ }).closest('section')!;
    await waitFor(() => expect(within(col).getByRole('heading', { level: 3, name: 'Finding b' })).toBeInTheDocument());
    expect(within(card('Finding b')).getByLabelText('Analyst note')).toHaveValue('Draft in progress');
  });
});

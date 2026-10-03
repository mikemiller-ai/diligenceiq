import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AdjacentEvidenceResponse, Citation, CompanyIntelligenceProfile, FigureCheck } from '@diligenceiq/core';
import { chunkFiling, loadCorpus, processFilings } from '@diligenceiq/corpus';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FilingSections, readableSections, readingSections } from '@/app/(workspace)/sources/filing/filing-view';
import { PlainPassage, SupportedPassage } from '@/components/evidence/passage';
import { ReadableText } from '@/components/evidence/readable-text';
import { IntelligenceDashboard, metricStatement } from '@/components/intelligence/dashboard';
import { layoutBlocks, shownText } from '@/lib/readable/layout';
import { BUILT } from '@/test/built-profiles';
import { createMemoryClient } from '@/test/memory-client';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { TEST_PASSAGES } from '@/test/sample-analyses';
import { CitationList, CitedText, claimBefore } from './evidence';

/*
 * Phase 6r step 2 (DD-21 e–f): readable evidence. The drawer leads with the sentences that support
 * the statement, bolds matched figures and titles the passage by section; Compare periods adds a
 * sentence diff; the renderer highlights exactly the cited characters.
 */

const IV = 'iv-9cf51c066743';
const A1 = { ...(TEST_PASSAGES[0] as Citation), indexVersion: IV };
const CLAIM = 'Apple relies on single-source partners in Asia for final assembly of its hardware products.';

describe('the evidence drawer leads with the supporting sentences (DD-21 f)', () => {
  it('shows the statement, highlights its best sentences in a condensed view, and opens the full passage in one click', async () => {
    renderInWorkspace(<CitationList ids={[A1.chunkId]} context={new Map([[A1.chunkId, A1]])} provenance="profile" claim={CLAIM} />);
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('evidence-claim')).toHaveTextContent(CLAIM);
    const passage = within(dialog).getByTestId('evidence-passage');
    expect(passage).toHaveAttribute('data-view', 'key');
    const keys = [...passage.querySelectorAll('mark[data-mark="key"]')].map((m) => m.textContent);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.length).toBeLessThanOrEqual(3);
    expect(keys.join(' ')).toContain('The Company relies on single-source partners in the U.S., Asia and Europe');
    // The condensed view leaves text out; the full passage is one click away and keeps the highlight.
    const condensed = passage.textContent!.length;
    const toggle = within(dialog).getByRole('button', { name: 'Show full passage' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', passage.id);
    await userEvent.click(toggle);
    expect(passage).toHaveAttribute('data-view', 'full');
    expect(passage.textContent!.length).toBeGreaterThan(condensed);
    expect(passage.querySelectorAll('mark[data-mark="key"]').length).toBe(keys.length);
    expect(within(dialog).getByRole('button', { name: 'Show closest sentences only' })).toHaveAttribute('aria-expanded', 'true');
    // The label and legend say what the pick is: word and figure overlap, not proof (H4).
    expect(within(dialog).getByText('Source passage, closest sentences highlighted')).toBeInTheDocument();
    expect(within(dialog).getByTestId('evidence-legend')).toHaveTextContent('This is word and figure overlap, not proof.');
  });

  it('titles the passage by section › subsection, never by chunk ID', async () => {
    const sub = { ...A1, section: 'Item 1A — Risk Factors › Supply Chain' };
    renderInWorkspace(<CitationList ids={[sub.chunkId]} context={new Map([[sub.chunkId, sub]])} provenance="profile" claim={CLAIM} />);
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${sub.chunkId}` }));
    const title = within(await screen.findByRole('dialog')).getByRole('heading', { level: 2 });
    expect(title).toHaveTextContent('Item 1A — Risk Factors › Supply Chain');
    expect(title.textContent).not.toContain(sub.chunkId);
  });

  it('without a statement (a passage opened from a list) shows the whole passage, readable, with nothing picked', async () => {
    renderInWorkspace(<CitationList ids={[A1.chunkId]} context={new Map([[A1.chunkId, A1]])} provenance="profile" />);
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByTestId('evidence-claim')).toBeNull();
    const passage = within(dialog).getByTestId('evidence-passage');
    expect(passage).toHaveAttribute('data-view', 'full');
    expect(passage.querySelector('mark')).toBeNull();
    expect(passage.textContent).toBe(shownText(A1.text, layoutBlocks(A1.text, 0, A1.text.length)));
  });

  it('says so when no sentence shares enough with the statement, and shows the whole passage', async () => {
    renderInWorkspace(<CitationList ids={[A1.chunkId]} context={new Map([[A1.chunkId, A1]])} provenance="profile" claim="Cybersecurity incidents hit data centers." />);
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('no-key-sentences')).toBeInTheDocument();
    expect(within(dialog).getByTestId('evidence-passage')).toHaveAttribute('data-view', 'full');
  });

  it('bolds the figures the validator verified in this passage (brief), and only those', async () => {
    const passage: Citation = { ...A1, chunkId: 'AAPL-FY2025-10K-MDA-005', section: 'Item 7 — MD&A', text: 'Total net sales increased 6% to $416,161 million in 2025. Services net sales were $109,158 million.' };
    const checks: FigureCheck[] = [
      { location: 'keyFindings[0].finding', figure: '$416,161 million', verified: true, rule: 'exact', chunkId: passage.chunkId },
      { location: 'keyFindings[0].finding', figure: '$109,158 million', verified: false, rule: null, chunkId: null },
    ];
    renderInWorkspace(
      <CitationList ids={[passage.chunkId]} context={new Map([[passage.chunkId, passage]])} provenance="brief" claim="Net sales rose to $416,161 million; services were $109,158 million." figureChecks={checks} />,
    );
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${passage.chunkId}` }));
    const box = within(await screen.findByRole('dialog')).getByTestId('evidence-passage');
    expect([...box.querySelectorAll('strong')].map((s) => s.textContent)).toEqual(['$416,161 million']);
    expect(within(await screen.findByRole('dialog')).getByTestId('evidence-legend')).toHaveTextContent('Bold: a figure the validator verified in this passage.');
  });

  it('bolds nothing in a brief passage where the validator verified no figure, even when the statement prints one (H3)', async () => {
    const passage: Citation = { ...A1, chunkId: 'AAPL-FY2025-10K-MDA-006', section: 'Item 7 — MD&A', text: 'Total net sales increased 6% to $416,161 million in 2025. Services net sales were $109,158 million.' };
    const checks: FigureCheck[] = [{ location: 'keyFindings[0].finding', figure: '$416,161 million', verified: true, rule: 'exact', chunkId: 'AAPL-FY2025-10K-MDA-999' }];
    renderInWorkspace(
      <CitationList ids={[passage.chunkId]} context={new Map([[passage.chunkId, passage]])} provenance="brief" claim="Net sales rose 6% to $416,161 million." figureChecks={checks} />,
    );
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${passage.chunkId}` }));
    const box = within(await screen.findByRole('dialog')).getByTestId('evidence-passage');
    expect(box.querySelectorAll('strong')).toHaveLength(0);
  });

  it('a metric value opens with a readable statement and bolds only its own cell in its source row (M2)', () => {
    const rawRow = 'Cash and cash equivalents |  | $ | 16,253 |  |  | $ | 17,576 |';
    const st = metricStatement('Cash and liquidity', { value: 17576, unit: 'USD', scale: 1e6, period: 'FY2021', rawRow });
    expect(st).toEqual({ claim: 'Cash and liquidity, FY2021: $17.6B', figures: ['17,576'], row: rawRow });
    const text = `(in millions)\n|  | 2022 |  |  | 2021 |\n${rawRow}\nRestricted cash |  |  | 17,576 |  |  |  | 1 |`;
    const { container } = render(<SupportedPassage text={text} passageId="p" {...st} />);
    expect(screen.getByTestId('evidence-claim')).toHaveTextContent('Cash and liquidity, FY2021: $17.6B');
    const bold = [...container.querySelectorAll('strong')].filter((b) => !b.closest('[data-testid="evidence-legend"]'));
    expect(bold.map((b) => b.textContent)).toEqual(['17,576']);
    expect(bold[0]!.closest('tr')!.querySelector('th')!.textContent).toBe('Cash and cash equivalents');
  });

  it('an inline chip’s statement is the sentence it closes', () => {
    const text = 'Revenue grew 6% [AAPL-FY2025-10K-MDA-001]. Supply is concentrated in Asia [AAPL-FY2025-10K-1A-001] [AAPL-FY2025-10K-1A-002].';
    expect(claimBefore(text, text.indexOf('[AAPL-FY2025-10K-MDA-001]'))).toBe('Revenue grew 6%');
    expect(claimBefore(text, text.indexOf('[AAPL-FY2025-10K-1A-002]'))).toBe('Supply is concentrated in Asia');
  });

  it('never splits a statement at an abbreviation ("U.S. Revenue…")', () => {
    const text = 'Demand was weak. Sales in the U.S. Revenue from Services grew 14% [AAPL-FY2025-10K-MDA-001].';
    expect(claimBefore(text, text.indexOf('[AAPL'))).toBe('Sales in the U.S. Revenue from Services grew 14%');
  });

  it('a brief’s inline chip opens with its sentence as the statement', async () => {
    renderInWorkspace(<CitedText text={`Intro sentence. ${CLAIM} [${A1.chunkId}]`} context={new Map([[A1.chunkId, A1]])} />);
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${A1.chunkId}` }));
    expect(within(await screen.findByRole('dialog')).getByTestId('evidence-claim')).toHaveTextContent(CLAIM);
  });
});

describe('Compare periods sentence diff (DD-21 f)', () => {
  const prior: Citation = {
    ...A1,
    chunkId: 'AAPL-FY2024-10K-1A-001',
    documentId: 'AAPL_10K_2024Q3_2024-11-01',
    fiscalLabel: 'FY2024',
    text: 'The Company depends on outsourcing partners. Tariffs could raise costs. Supply is concentrated in Asia. Net sales were $391 billion.',
  };
  const current: Citation = { ...A1, text: 'The Company depends on outsourcing partners. AI regulation is a new risk. Supply is concentrated in Asia. Net sales were $416 billion.' };
  const ADJ: AdjacentEvidenceResponse = {
    chunkId: current.chunkId,
    indexVersion: IV,
    previous: { filing: { documentId: prior.documentId, ticker: 'AAPL', company: 'Apple Inc', filingType: '10-K', filingDate: '2024-11-01', periodEnd: '2024-09-28', fiscalLabel: 'FY2024' }, passages: [prior] },
    next: null,
    sameQuarterPriorYear: null,
  };

  it('lists new and removed sentences with words and signs, pairs a changed figure, and collapses the unchanged ones', async () => {
    const memory = createMemoryClient({ adjacent: { [current.chunkId]: ADJ } });
    renderInWorkspace(<CitedText text={`Claim [${current.chunkId}]`} context={new Map([[current.chunkId, current]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${current.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    const diff = await screen.findByTestId('sentence-diff');
    const added = within(diff).getByTestId('diff-added');
    expect(within(added).getByRole('heading')).toHaveTextContent('New in FY2025 10-K, in the shared stretch (2)');
    expect(added).toHaveTextContent('New: Net sales were $416 billion.Was: Net sales were $391 billion.');
    expect(added).toHaveTextContent('New: AI regulation is a new risk.');
    const removed = within(diff).getByTestId('diff-removed');
    expect(within(removed).getByRole('heading')).toHaveTextContent('Removed since FY2024 10-K, in the shared stretch (1)');
    expect(removed).toHaveTextContent('Removed: Tariffs could raise costs.');
    const unchanged = within(diff).getByTestId('diff-unchanged');
    expect(unchanged).not.toHaveAttribute('open');
    expect(within(unchanged).getByText('Unchanged (2)')).toBeInTheDocument();
    // Reads only: the adjacent passages, no generation.
    expect(memory.calls.filter((c) => !['session', 'health', 'listAnalyses', 'listFindings', 'companies'].includes(c.method)).map((c) => c.method)).toEqual(['adjacent']);
  });
});

describe('the dashboard passes readable statements to the drawer (M2)', () => {
  const renderDashboard = (p: CompanyIntelligenceProfile) => {
    setRoute('/intelligence/', `ticker=${p.ticker}`);
    return renderInWorkspace(<IntelligenceDashboard profile={p} />, { profiles: new Map([[p.ticker, p]]) });
  };

  it('a signal’s statement is what changed, never its measurement (no "topic-word Dice ≥ 0.5")', async () => {
    const p = BUILT.AAPL;
    const s = p.signals.find((x) => x.type !== 'PERSISTENT' && x.citationIds.length > 0)!;
    const { container } = renderDashboard(p);
    const line = [...container.querySelectorAll('p')].find((el) => el.textContent!.startsWith(s.whatChanged) && el.querySelector('button'))!;
    fireEvent.click(line.querySelector('button')!);
    const claim = within(await screen.findByRole('dialog')).getByTestId('evidence-claim');
    expect(claim.textContent).toBe(s.whatChanged);
    expect(claim.textContent).not.toContain(s.measurement);
  });

  it('a metric value’s statement is the metric, period and value, never the raw source row', async () => {
    const { container } = renderDashboard(BUILT.AAPL);
    const button = container.querySelector<HTMLButtonElement>('[data-metric-value]')!;
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    const claim = within(dialog).getByTestId('evidence-claim').textContent!;
    expect(claim).not.toContain('|');
    expect(claim).toMatch(/^[A-Z][^|]+, FY\d{4}: \S+$/);
    // At most the value's own cell is bold, and only inside its source row.
    const bold = [...within(dialog).getByTestId('evidence-passage').querySelectorAll('strong')];
    expect(bold.length).toBeLessThanOrEqual(1);
    if (bold[0]) expect(button.getAttribute('data-raw-row')).toContain(bold[0].textContent!);
  });
});

describe('the sentence diff compares one passage with one passage, inside the shared stretch (H5)', () => {
  const thisOne: Citation = { ...A1, text: 'Supply is concentrated in Asia. The Company depends on outsourcing partners. Tariffs could raise costs.' };
  const following = (chunk: string, text: string, charStart: number): Citation => ({
    ...A1,
    chunkId: `AAPL-FY2026-10K-1A-${chunk}`,
    documentId: 'AAPL_10K_2026-10-30',
    fiscalLabel: 'FY2026',
    charStart,
    charEnd: charStart + text.length,
    text,
  });
  // Most similar first (the adjacency contract), not in filing order: the diff must use the first.
  const best = following('004', 'Supply is concentrated in Asia. The Company depends on outsourcing partners. Export controls are a new risk. Tariffs could raise costs. Our leases run ten years.', 900);
  const second = following('001', 'Our history began in 1976. We design phones and computers.', 100);
  const third = following('009', 'Climate rules may change. Our stores are in many countries.', 2000);
  const ADJ: AdjacentEvidenceResponse = {
    chunkId: thisOne.chunkId,
    indexVersion: IV,
    previous: null,
    next: { filing: { documentId: best.documentId, ticker: 'AAPL', company: 'Apple Inc', filingType: '10-K', filingDate: '2026-10-30', periodEnd: '2026-09-26', fiscalLabel: 'FY2026' }, passages: [best, second, third] },
    sameQuarterPriorYear: null,
  };

  it('on the Following tab, reads the later filing against this passage, and never calls the other matched passages or the tail outside the stretch new', async () => {
    const memory = createMemoryClient({ adjacent: { [thisOne.chunkId]: ADJ } });
    renderInWorkspace(<CitedText text={`Claim [${thisOne.chunkId}]`} context={new Map([[thisOne.chunkId, thisOne]])} />, { memory });
    await userEvent.click(screen.getByRole('button', { name: `View evidence ${thisOne.chunkId}` }));
    await userEvent.click(await screen.findByRole('button', { name: /compare periods/i }));
    const diff = await screen.findByTestId('sentence-diff');
    const added = within(diff).getByTestId('diff-added');
    expect(within(added).getByRole('heading')).toHaveTextContent('New in FY2026 10-K, in the shared stretch (1)');
    expect(added).toHaveTextContent('New: Export controls are a new risk.');
    for (const notNew of ['Our leases run ten years.', 'Our history began in 1976.', 'We design phones and computers.', 'Climate rules may change.']) expect(added).not.toHaveTextContent(notNew);
    expect(within(diff).getByTestId('diff-removed')).toHaveTextContent('No sentence was removed in the shared stretch.');
    expect(within(diff).getByTestId('diff-outside')).toHaveTextContent('1 sentence lies outside the shared stretch and is not compared.');
  });
});

describe('readable tables (H1, M4)', () => {
  const TABLE = 'Years ended December 31, | 2025 |  | 2024\nRevenue | 89,463 |  |  | 66,517 |\nDividends | 345 |  |  |  |';

  it('renders a header row as <thead> with column headers, and empty cells as empty cells (no shifting)', () => {
    const { container } = render(<PlainPassage text={TABLE} />);
    const table = container.querySelector('table')!;
    const heads = [...table.querySelectorAll('thead th[scope="col"]')].map((th) => th.textContent);
    expect(heads).toEqual(['Years ended December 31,', '2025', '2024']);
    const dividends = [...table.querySelectorAll('tbody tr')][1]!;
    expect([...dividends.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['345', '']);
  });

  it('takes focus only when the table actually scrolls sideways', () => {
    const { container, unmount } = render(<PlainPassage text={TABLE} />);
    // jsdom lays nothing out: the box fits, so it is no tab stop and has no role.
    const box = container.querySelector('table')!.parentElement!;
    expect(box).not.toHaveAttribute('tabindex');
    expect(box).not.toHaveAttribute('role');
    unmount();
    // Own properties on HTMLElement.prototype shadow Element's getters; deleting them restores jsdom.
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 300 });
    try {
      const text = `Intro paragraph.\n${TABLE}`;
      const blocks = layoutBlocks(text, 0, text.length);
      const at = text.indexOf('Revenue');
      // The table re-renders once it measures its overflow: the target id must survive that.
      const wide = render(<ReadableText text={text} blocks={blocks} marks={[{ start: at, end: text.length, tone: 'target' }]} targetId="chunk-t" />);
      const scroller = wide.container.querySelector('table')!.parentElement!;
      expect(scroller).toHaveAttribute('tabindex', '0');
      expect(scroller).toHaveAttribute('role', 'group');
      expect(scroller).toHaveAccessibleName('Table from the filing (scrolls sideways)');
      expect(wide.container.querySelector('#chunk-t')?.textContent).toBe('Revenue');
    } finally {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
    expect(document.createElement('div').scrollWidth).toBe(0);
  });
});

describe('the renderer highlights exactly the cited characters (DD-21 e)', () => {
  it('reveals page furniture inside a cited span, so a citation is never invisible', () => {
    const text = 'Some text.\n37\nMore text.';
    const start = text.indexOf('37');
    const blocks = layoutBlocks(text, 0, text.length);
    const { container, rerender } = render(<ReadableText text={text} blocks={blocks} />);
    expect(container.textContent).toBe('Some text.More text.');
    rerender(<ReadableText text={text} blocks={blocks} marks={[{ start, end: start + 3, tone: 'target' }]} targetId="chunk-x" />);
    expect(container.querySelector('#chunk-x')?.textContent).toBe('37');
    // A cited span with other text keeps its furniture hidden.
    rerender(<ReadableText text={text} blocks={blocks} marks={[{ start: 0, end: text.length, tone: 'target' }]} targetId="chunk-y" />);
    expect(container.textContent).toBe('Some text.More text.');
  });

  const corpusDir = resolve(process.env.CORPUS_PATH ?? join(__dirname, '../../../../../edgar_corpus'));
  const haveCorpus = existsSync(corpusDir);
  if (!haveCorpus && process.env.REQUIRE_CORPUS === '1') throw new Error(`evidence-readable.test: REQUIRE_CORPUS=1 but the corpus is not at ${corpusDir}`);

  it.skipIf(!haveCorpus)(
    'renders real filings (one per footer style) with every chunk’s highlight equal to its own shown characters',
    () => {
      const wanted = ['AAPL_10K_2025-10-31', 'MSFT_10K_2025-07-30', 'GS_10K_2025-02-27', 'TGT_10K_2025-03-12'];
      const raws = loadCorpus(corpusDir).filings.filter((f) => ['AAPL', 'MSFT', 'GS', 'TGT'].some((t) => f.file.startsWith(`${t}_`)));
      const filings = processFilings(raws).filter((f) => wanted.includes(f.meta.documentId));
      expect(filings.map((f) => f.meta.documentId).sort()).toEqual([...wanted].sort());
      for (const f of filings) {
        const source = { text: f.text, filing: { filingType: f.meta.filingType }, sections: f.sections.map((s) => ({ code: s.code, title: s.label, charStart: s.start, charEnd: s.end })) } as Parameters<typeof readableSections>[0];
        const sections = readingSections(source.sections, f.text.length);
        const laid = readableSections(source, sections);
        const chunks = chunkFiling(f.meta, f.text, f.sections);
        // Neighbouring chunks overlap (the chunker's overlap), so chunks render in layers of disjoint spans.
        const layers: (typeof chunks)[] = [];
        for (const c of [...chunks].sort((a, b) => a.charStart - b.charStart)) {
          const layer = layers.find((l) => l.at(-1)!.charEnd <= c.charStart);
          if (layer) layer.push(c);
          else layers.push([c]);
        }
        for (const [parity, group] of layers.entries()) {
          const marks = group.map((c) => ({ start: c.charStart, end: c.charEnd, tone: 'key' as const, id: c.chunkId }));
          const { container, unmount } = render(
            <>
              {laid.map((blocks, i) => (
                <ReadableText key={i} text={f.text} blocks={blocks} marks={marks} />
              ))}
            </>,
          );
          expect(container.textContent, f.meta.documentId).toBe(laid.map((b) => shownText(f.text, b)).join(''));
          const byId = new Map<string, string>();
          for (const m of container.querySelectorAll('mark[data-span]')) byId.set(m.getAttribute('data-span')!, (byId.get(m.getAttribute('data-span')!) ?? '') + m.textContent);
          for (const c of group) expect(byId.get(c.chunkId) ?? '', c.chunkId).toBe(laid.map((b) => shownText(f.text, b, { start: c.charStart, end: c.charEnd })).join(''));
          if (parity === 0) {
            // Real structure, not one blob: headings and tables are on the page.
            expect(container.querySelectorAll('[data-block="heading"]').length, f.meta.documentId).toBeGreaterThan(10);
            expect(container.querySelectorAll('table').length, f.meta.documentId).toBeGreaterThan(5);
          }
          unmount();
        }
      }
    },
    300_000,
  );

  /*
   * H6 (d): the source view's target highlight on real filings, against an oracle that does not reuse
   * the layout's furniture rules: each filing's own footer, spelled out by hand, plus page numbers and
   * "Table of Contents" back-links. The joined target pieces must equal the chunk's characters outside
   * that oracle's furniture (pipes and whitespace aside), and the id must land on the first piece.
   */
  const ORACLE: Record<string, RegExp[]> = {
    'AAPL_10K_2025-10-31': [/Apple Inc\. \| 2025 Form 10-K \| \d{1,3}/g],
    'GS_10K_2025-02-27': [/Goldman Sachs 2024 Form 10-K \|\s*\|\s*\d{1,3}/g, /\d{1,3}\s*\|\s*\|\s*Goldman Sachs 2024 Form 10-K/g],
    'NKE_10K_2025-07-17': [/2025 FORM 10-K\s+\d{1,3}/g],
    'DE_10K_2025-12-18': [],
    'BA_10K_2026-01-30': [],
  };
  const COMMON = [/(?<!\d|\d[.,])\d{1,3}\s*Table of Contents/g, /Table of Contents/g, /^[ \t]*\d{1,3}[ \t]*$/gm];
  /** A page number ending a prose line right before a "Table of Contents" line. */
  const PAGE_BEFORE_TOC = /^([^|\n]*?)(?<![\d,.$])(\d{1,3})(?=\n\s*Table of Contents)/gm;

  it.skipIf(!haveCorpus)(
    'highlights a cited chunk in the source view exactly: id on the first piece, pieces = chunk minus independently found furniture',
    () => {
      const ids = Object.keys(ORACLE);
      const tickers = [...new Set(ids.map((d) => d.split('_')[0]!))];
      const raws = loadCorpus(corpusDir).filings.filter((f) => tickers.some((t) => f.file.startsWith(`${t}_`)));
      const filings = processFilings(raws).filter((f) => ids.includes(f.meta.documentId));
      expect(filings).toHaveLength(ids.length);
      let checked = 0;
      for (const f of filings) {
        const furniture = new Uint8Array(f.text.length);
        for (const re of [...ORACLE[f.meta.documentId]!, ...COMMON]) for (const m of f.text.matchAll(re)) furniture.fill(1, m.index, m.index + m[0].length);
        for (const m of f.text.matchAll(PAGE_BEFORE_TOC)) furniture.fill(1, m.index + m[1]!.length, m.index + m[0].length);
        const source = { text: f.text, filing: { filingType: f.meta.filingType }, sections: f.sections.map((s) => ({ code: s.code, title: s.label, charStart: s.start, charEnd: s.end })) } as Parameters<typeof readableSections>[0];
        const sections = readingSections(source.sections, f.text.length);
        const laid = readableSections(source, sections);
        const chunks = chunkFiling(f.meta, f.text, f.sections);
        const step = Math.max(1, Math.floor(chunks.length / 12));
        for (let k = 0; k < chunks.length; k += step) {
          const c = chunks[k]!;
          let expected = '';
          for (let i = c.charStart; i < c.charEnd; i++) if (!furniture[i] && !/[\s|]/.test(f.text[i]!)) expected += f.text[i];
          if (!expected) continue;
          const targetId = `chunk-${c.chunkId}`;
          const { container, unmount } = render(
            <FilingSections text={f.text} sections={sections} laid={laid} target={{ start: c.charStart, end: c.charEnd }} targetId={targetId} />,
          );
          const pieces = [...container.querySelectorAll('mark[data-mark="target"]')];
          expect(container.querySelectorAll(`[id="${targetId}"]`), c.chunkId).toHaveLength(1);
          expect(pieces[0], c.chunkId).toBe(container.querySelector(`[id="${targetId}"]`));
          expect(pieces.map((p) => p.textContent).join('').replace(/[\s|]/g, ''), c.chunkId).toBe(expected);
          unmount();
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(50);
    },
    120_000,
  );

  it.skipIf(!haveCorpus)('renders BA’s statement of operations with 345 under 2025 and 58 under 2024 (H1)', () => {
    const raws = loadCorpus(corpusDir).filings.filter((f) => f.file.startsWith('BA_'));
    const f = processFilings(raws).find((x) => x.meta.documentId === 'BA_10K_2026-01-30')!;
    const at = f.text.indexOf('Less: Mandatory convertible preferred stock dividends');
    const start = f.text.lastIndexOf('(Dollars in millions, except per share data)', at);
    const end = f.text.indexOf('See Notes to the Consolidated', at);
    const { container } = render(<ReadableText text={f.text} blocks={layoutBlocks(f.text, start, end)} />);
    const table = [...container.querySelectorAll('table')].find((t) => t.textContent!.includes('Mandatory convertible'))!;
    const header = [...table.querySelectorAll('thead tr')].find((tr) => tr.textContent!.includes('2025'))!;
    const column = (tr: Element, text: string) => [...tr.children].findIndex((cell) => cell.textContent === text);
    const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')!.textContent!.startsWith('Less: Mandatory'))!;
    expect(column(row, '345')).toBe(column(header, '2025'));
    expect(column(row, '58')).toBe(column(header, '2024'));
    const products = [...table.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th')!.textContent === 'Sales of products')!;
    expect([column(products, '$75,356'), column(products, '$53,227'), column(products, '$65,581')]).toEqual([column(header, '2025'), column(header, '2024'), column(header, '2023')]);
  });
});

describe('a metric value bolds only its own cell (code review)', () => {
  it('bolds the first matching cell of the row, never an unchanged year that prints the same digits', async () => {
    const { SupportedPassage } = await import('@/components/evidence/passage');
    const row = 'Shares outstanding | 15,004 |  | 15,004';
    const text = `Shares data:\n${row}\nOther | 1 | 2`;
    const { container } = render(<SupportedPassage text={text} claim="Shares outstanding, FY2025: 15.0B" figures={['15,004']} row={row} passageId="p" />);
    expect([...container.querySelectorAll('strong')].filter((s) => s.textContent === '15,004')).toHaveLength(1);
  });
});

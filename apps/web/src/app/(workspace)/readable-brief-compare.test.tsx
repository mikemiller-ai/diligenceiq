import { SIGNAL_CATEGORIES, findBannedPhrases, type AnalysisDetail, type BriefValidation, type CompanyIntelligenceProfile } from '@diligenceiq/core';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isCurrent, readTrend, rowChange } from '@/components/intelligence/signals';
import { TRAJECTORY_LABEL } from '@/lib/labels';
import { BUILT } from '@/test/built-profiles';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { SAMPLE_ANALYSES, SAMPLE_CONTEXTS } from '@/test/sample-analyses';
import { AnalysisView } from './analysis/analysis-view';
import { CompareView, trendRead } from './compare/compare-view';

/*
 * Phase 6r step 3 (DD-21 g): the brief's bottom line and jump bar, and Compare's chips and
 * condensed sections. Everything is a fixed rule over what is stored; nothing here generates.
 */

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

const complete = SAMPLE_ANALYSES.find((a) => a.status === 'COMPLETE' && a.brief?.comparison)!;
const brief = complete.brief!;
const tickersCovered = [...new Set(brief.keyFindings.flatMap((k) => k.tickers))];
/** The sample brief with an evidence-coverage matrix (the samples carry none), so its jump link is generated. */
const withCoverage: AnalysisDetail = {
  ...complete,
  coverage: { cells: tickersCovered.map((ticker) => ({ ticker, period: 'FY2025', contextChunks: 2, citedChunks: 1 })) },
};
const passageCount = SAMPLE_CONTEXTS[complete.analysisId]!.length;

function renderBrief(analysis: AnalysisDetail) {
  setRoute('/analysis/', `id=${analysis.analysisId}`);
  return renderInWorkspace(<AnalysisView />, { initial: { analyses: [analysis] }, contexts: SAMPLE_CONTEXTS });
}

const jumpLinks = () => within(screen.getByRole('navigation', { name: 'On this page' })).getAllByRole('link');
const bottomLine = () => screen.getByRole('heading', { name: 'Bottom line' }).closest('section')!;

describe('Diligence Brief: bottom line (DD-21 g)', () => {
  it('lists every key finding’s title as stored, in order, each linking to that finding', () => {
    renderBrief(complete);
    const links = within(bottomLine()).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(brief.keyFindings.map((k) => k.title));
    const findings = screen.getByRole('heading', { name: 'Key findings' }).closest('section')!;
    links.forEach((l, i) => {
      expect(l).toHaveAttribute('href', `#finding-${i + 1}`);
      const target = document.getElementById(`finding-${i + 1}`)!;
      // The target is the finding's own list item in Key findings, and it lands clear of the sticky bars.
      expect(findings.contains(target)).toBe(true);
      expect(target).toHaveTextContent(brief.keyFindings[i]!.finding);
      expect(target).toHaveClass('scroll-mt-40');
    });
  });

  it('chips state the stored basis and the validator’s figure checks; the status line is counts', () => {
    const fig = (location: string, verified: boolean, rule: 'exact' | 'unit_unstated' | null) => ({ location, figure: '$4.2 billion', verified, rule, chunkId: null });
    const figures = [fig('keyFindings[0].finding', false, null), fig('keyFindings[0].title', true, 'exact'), fig('keyFindings[1].finding', true, 'exact'), fig('executiveSummary', true, 'exact')];
    const validation: BriefValidation = { ...complete.validation!, uncited: ['keyFindings[1]'], numeric: { figures, total: 4, verified: 3, unitUnstated: 0 } };
    renderBrief({ ...complete, validation });
    const items = within(bottomLine()).getAllByRole('listitem');
    expect(items).toHaveLength(brief.keyFindings.length);
    expect(items[0]).toHaveTextContent('1 unverified figure');
    expect(items[0]).toHaveTextContent('1 of 2 figures were found in the passages this finding cites; 1 figure was not found');
    expect(items[1]).toHaveTextContent('Figure found in its cited passages');
    expect(items[1]).toHaveTextContent('No valid citation');
    // A finding with no figure gets no figure chip.
    expect(items[2]).not.toHaveTextContent(/figure/i);
    items.forEach((li, i) => expect(li).toHaveTextContent(brief.keyFindings[i]!.basis === 'reported' ? 'Reported' : 'Analysis'));
    // Never a direction: a brief stores none for a finding.
    expect(bottomLine().querySelector('[data-direction]')).toBeNull();
    const gaps = brief.evidenceGaps.length;
    expect(bottomLine()).toHaveTextContent(new RegExp(`${brief.keyFindings.length} key findings · \\d+ passages? cited · 3 of 4 figures found in their cited passages · ${gaps === 0 ? 'no evidence gaps identified' : `${gaps} evidence gaps?`}`));
  });

  it('its fixed-rule text passes the DD-16 vocabulary check', () => {
    renderBrief(complete);
    const fixed = bottomLine().cloneNode(true) as HTMLElement;
    // Leave out the model-written titles: only the page's own wording is checked here.
    for (const a of fixed.querySelectorAll('a')) a.remove();
    expect(findBannedPhrases(fixed.textContent ?? '')).toEqual([]);
  });

  it('ticker chips follow the companies the brief covers, not only the findings’ own tickers', () => {
    // Every finding tagged with one company, but the question was read as covering two: chips shown.
    const oneTicker = brief.keyFindings.map((k) => ({ ...k, tickers: ['AAPL'] }));
    const view = renderBrief({ ...complete, brief: { ...brief, keyFindings: oneTicker } });
    expect(complete.interpretation!.companies.length).toBeGreaterThan(1);
    expect(within(bottomLine()).getAllByText('AAPL')).toHaveLength(oneTicker.length);
    view.unmount();
    // A brief recorded without an interpretation falls back to the findings' tickers: one company, no chips.
    const { interpretation: _i, ...noInterpretation } = complete;
    renderBrief({ ...noInterpretation, brief: { ...brief, keyFindings: oneTicker } });
    expect(within(bottomLine()).queryByText('AAPL')).not.toBeInTheDocument();
  });
});

describe('Diligence Brief: jump bar (DD-21 g)', () => {
  it('links exactly the sections this brief shows, with counts, the Sources rail last, and every target exists', async () => {
    renderBrief(withCoverage);
    const expected = [
      'Summary',
      'Bottom line',
      `Key findings${brief.keyFindings.length}`,
      `Comparison${brief.comparison!.rows.length}`,
      `Considerations${brief.investmentConsiderations.length}`,
      'Evidence coverage',
      `Evidence gaps${brief.evidenceGaps.length || ''}`,
      `Follow-up questions${brief.followUpQuestions.length}`,
      `Sources${passageCount}`,
    ];
    // The Sources count is the passages supplied to the model, once the context snapshot has loaded.
    await waitFor(() => expect(jumpLinks().map((l) => l.textContent)).toEqual(expected));
    const links = jumpLinks();
    for (const l of links) {
      const id = l.getAttribute('href')!.slice(1);
      const target = document.getElementById(id);
      expect(target, id).not.toBeNull();
      expect(target, id).toHaveClass('scroll-mt-40');
    }
  });

  it('leaves out sections a brief does not show: no comparison, no coverage, no follow-ups; gaps without a count', async () => {
    const { comparison: _c, ...rest } = brief;
    const bare: AnalysisDetail = { ...complete, brief: { ...rest, evidenceGaps: [], followUpQuestions: [] } };
    delete bare.coverage;
    renderBrief(bare);
    await waitFor(() =>
      expect(jumpLinks().map((l) => l.textContent)).toEqual([
        'Summary',
        'Bottom line',
        `Key findings${brief.keyFindings.length}`,
        `Considerations${brief.investmentConsiderations.length}`,
        'Evidence gaps',
        `Sources${passageCount}`,
      ]),
    );
    // No follow-up questions: no heading over an empty list either.
    expect(screen.queryByRole('heading', { name: 'Suggested follow-up questions' })).not.toBeInTheDocument();
    expect(document.getElementById('follow-ups')).toBeNull();
  });

  it('the Sources heading is the jump target, landing clear of the sticky bars', () => {
    renderBrief(complete);
    const sources = screen.getByRole('heading', { name: 'Sources', level: 2 });
    expect(sources).toHaveAttribute('id', 'sources');
    expect(sources).toHaveClass('scroll-mt-40');
  });

  it('a brief with no key findings has no bottom line and no link to one', () => {
    renderBrief({ ...complete, brief: { ...brief, keyFindings: [] } });
    expect(screen.queryByRole('heading', { name: 'Bottom line' })).not.toBeInTheDocument();
    expect(jumpLinks().map((l) => l.textContent)).not.toContain('Bottom line');
  });

  it('only a complete brief has them: a failed analysis shows neither', () => {
    renderBrief(SAMPLE_ANALYSES.find((a) => a.status === 'FAILED')!);
    expect(screen.queryByRole('navigation', { name: 'On this page' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Bottom line' })).not.toBeInTheDocument();
  });

  it('on a phone, the jump menu lists the same sections', () => {
    renderBrief(withCoverage);
    const options = within(screen.getByRole('combobox', { name: 'Jump to section' })).getAllByRole('option').slice(1);
    expect(options.map((o) => o.getAttribute('value'))).toEqual(jumpLinks().map((l) => l.getAttribute('href')!.slice(1)));
  });
});

/** The built llm-v3 profiles, with JPM given Apple's operating cash flow trend so a Financials company has one. */
function profiles(): Map<string, CompanyIntelligenceProfile> {
  const ocf = BUILT.AAPL.trends.find((t) => t.metric === 'Operating cash flow')!;
  return new Map<string, CompanyIntelligenceProfile>([
    ['AAPL', BUILT.AAPL],
    ['TSLA', BUILT.TSLA],
    ['JPM', { ...BUILT.JPM, trends: [...BUILT.JPM.trends, ocf] }],
  ]);
}

function renderCompare(tickers: string) {
  setRoute('/compare/', `tickers=${tickers}`);
  const p = profiles();
  renderInWorkspace(<CompareView />, { profiles: p });
  return p;
}

const section = (name: string) => screen.getByRole('heading', { name }).closest('section')!;

describe('Compare: trend chips (DD-21 g, the dashboard’s rules)', () => {
  it('each trend cell is the builder’s label on its direction chip, with the builder’s change and period', () => {
    const p = renderCompare('AAPL,TSLA,JPM');
    const table = within(section('Side by side')).getByRole('table');
    let chips = 0;
    for (const metric of ['Revenue', 'Operating margin', 'Operating income', 'Operating cash flow']) {
      const row = table.querySelector<HTMLElement>(`tr[data-metric="${metric}"]`)!;
      const cells = within(row).getAllByRole('cell');
      ['AAPL', 'TSLA', 'JPM'].forEach((t, i) => {
        const profile = p.get(t)!;
        const trend = readTrend(profile, metric);
        const change = rowChange(profile, metric);
        const chip = cells[i]!.querySelector('[data-direction]');
        if (!trend || !change) {
          // No trend the builder labeled: no chip, never an invented direction.
          expect(chip, `${t} ${metric}`).toBeNull();
          return;
        }
        chips++;
        expect(chip, `${t} ${metric}`).toHaveAttribute('data-direction', change.neutral ? 'neutral' : change.direction);
        expect(chip!.textContent).toMatch(new RegExp(`^${TRAJECTORY_LABEL[trend.trajectory]}`));
        expect(cells[i]).toHaveTextContent(`${change.text} in ${change.period}`);
      });
    }
    expect(chips).toBeGreaterThanOrEqual(8);
  });

  it('a Financials company’s operating cash flow keeps its arrow without a colour, and says why to a screen reader', () => {
    renderCompare('AAPL,JPM');
    const row = section('Side by side').querySelector<HTMLElement>('tr[data-metric="Operating cash flow"]')!;
    const [aapl, jpm] = within(row).getAllByRole('cell');
    expect(aapl!.querySelector('[data-direction]')).toHaveAttribute('data-direction', 'down');
    expect(jpm!.querySelector('[data-direction]')).toHaveAttribute('data-direction', 'neutral');
    expect(jpm).toHaveTextContent('neither direction is better');
  });

  it('diverging trends show one chip per company: rising or falling', () => {
    renderCompare('AAPL,TSLA');
    const diverging = section('Diverging trends');
    const revenue = within(diverging).getByText('Revenue').closest('li')!;
    const chips = [...revenue.querySelectorAll('[data-direction]')].map((c) => [c.textContent, c.getAttribute('data-direction')]);
    expect(chips).toEqual([
      ['Apple: rising', 'up'],
      ['Tesla: falling', 'down'],
    ]);
  });

  /** A trend whose basis reads back, about the given year. */
  const ocfTrend = (trajectory: 'growing' | 'declining', period: string, chunkIds: string[]): CompanyIntelligenceProfile['trends'][number] => ({
    metric: 'Operating cash flow',
    trajectory,
    periods: [`FY${Number(period.slice(2)) - 1}`, period],
    basis:
      trajectory === 'growing'
        ? `Growth of 15.0% in ${period}, after 10.0% in FY${Number(period.slice(2)) - 1} (growing: above 2.0%).`
        : `Growth of -10.2% in ${period}, after 12.0% in FY${Number(period.slice(2)) - 1} (declining: below -2.0%).`,
    chunkIds,
  });
  const withTrend = (p: CompanyIntelligenceProfile, trend: CompanyIntelligenceProfile['trends'][number]): CompanyIntelligenceProfile => ({
    ...p,
    trends: [...p.trends.filter((t) => t.metric !== trend.metric), trend],
  });

  it('a trend about an older year than the latest annual report gets no chip, in the table or Diverging, and names its year', () => {
    // The real case: Pfizer's operating cash flow basis is FY2022 while its latest 10-K is FY2024.
    const p = profiles();
    const tsla = withTrend(BUILT.TSLA, ocfTrend('growing', 'FY2022', BUILT.TSLA.trends[0]!.chunkIds));
    expect(readTrend(tsla, 'Operating cash flow')?.trajectory).toBe('growing');
    expect(isCurrent(tsla, 'FY2022')).toBe(false);
    p.set('TSLA', tsla);
    setRoute('/compare/', 'tickers=AAPL,TSLA');
    renderInWorkspace(<CompareView />, { profiles: p });
    const row = section('Side by side').querySelector<HTMLElement>('tr[data-metric="Operating cash flow"]')!;
    const [aapl, stale] = within(row).getAllByRole('cell');
    expect(aapl!.querySelector('[data-direction]')).toHaveAttribute('data-direction', 'down');
    expect(stale!.querySelector('[data-direction]')).toBeNull();
    expect(stale).toHaveTextContent('Growing');
    expect(stale).toHaveTextContent('latest trend FY2022');
    // Diverging (AAPL falling, TSLA rising): TSLA's chip carries no direction colour and names the year.
    const ocf = within(section('Diverging trends')).getByText('Operating cash flow').closest('li')!;
    expect([...ocf.querySelectorAll('[data-direction]')].map((c) => c.textContent)).toEqual(['Apple: falling']);
    expect(ocf).toHaveTextContent('Tesla: rising(latest trend FY2022)');
  });

  it('over every built test profile, a cell has a chip exactly when its trend reads back, is current and has a labeled change', () => {
    const p = renderCompare('AAPL,TSLA,JPM');
    const rows = [...section('Side by side').querySelectorAll<HTMLElement>('tr[data-metric]')];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const metric = r.dataset.metric!;
      within(r)
        .getAllByRole('cell')
        .slice(0, 3)
        .forEach((cell, i) => {
          const profile = p.get(['AAPL', 'TSLA', 'JPM'][i]!)!;
          const trend = readTrend(profile, metric);
          const expectChip = Boolean(trend && isCurrent(profile, trend.basis.period) && rowChange(profile, metric));
          expect(Boolean(cell.querySelector('[data-direction]')), `${profile.ticker} ${metric}`).toBe(expectChip);
          if (trend && !isCurrent(profile, trend.basis.period)) expect(cell).toHaveTextContent(`latest trend ${trend.basis.period}`);
        });
    }
  });

  it('diverging: a Financials company’s operating cash flow chip is neutral with the screen-reader reason; a trend that does not read back gets no chip', () => {
    const p = profiles();
    const jpmFy = 'FY2025';
    p.set('JPM', withTrend(BUILT.JPM, ocfTrend('growing', jpmFy, BUILT.AAPL.trends.find((t) => t.metric === 'Operating cash flow')!.chunkIds)));
    // TSLA's revenue trend relabeled so its basis no longer reads back with the same trajectory.
    const tslaRevenue = BUILT.TSLA.trends.find((t) => t.metric === 'Revenue')!;
    p.set('TSLA', withTrend(BUILT.TSLA, { ...tslaRevenue, trajectory: 'growing' }));
    expect(readTrend(p.get('TSLA')!, 'Revenue')).toBeNull();
    setRoute('/compare/', 'tickers=AAPL,TSLA,JPM');
    renderInWorkspace(<CompareView />, { profiles: p });
    const diverging = section('Diverging trends');
    const ocf = within(diverging).getByText('Operating cash flow').closest('li')!;
    const jpm = [...ocf.querySelectorAll('[data-direction]')].find((c) => c.textContent?.startsWith('JPMorgan'))!;
    expect(jpm).toHaveAttribute('data-direction', 'neutral');
    expect(jpm).toHaveTextContent('neither direction is better');
    expect(trendRead(p.get('JPM'), 'Operating cash flow', 'growing')).toMatchObject({ kind: 'chip', change: { neutral: true } });
    // Revenue: AAPL growing, TSLA "growing" (not read back), JPM slowing: no diverging pair for revenue.
    const revenue = within(diverging).queryByText('Revenue')?.closest('li');
    if (revenue) expect([...revenue.querySelectorAll('[data-direction]')].map((c) => c.textContent)).not.toContain('Tesla: rising');
  });

  it('a legend explains the chips for built profiles', () => {
    renderCompare('AAPL,TSLA');
    expect(within(section('Side by side')).getByRole('list', { name: 'Legend' })).toHaveTextContent('slowing: still growing, more slowly');
    expect(findBannedPhrases(section('Side by side').textContent ?? '')).toEqual([]);
  });

  it('preview profiles: no chips and no legend, only placeholders', () => {
    setRoute('/compare/', 'tickers=AAPL,MSFT');
    renderInWorkspace(<CompareView />);
    const side = section('Side by side');
    expect(side.querySelector('[data-direction]')).toBeNull();
    expect(within(side).queryByRole('list', { name: 'Legend' })).not.toBeInTheDocument();
  });
});

describe('Compare: condensed sections (DD-21 c, g)', () => {
  /** Visible list items (folded ones carry `hidden`). */
  const shown = (el: HTMLElement) => [...el.querySelectorAll('li')].filter((li) => !li.closest('[hidden]') && !li.hidden);

  it('the risk-area grid shows five areas, then "Show all N" reveals every area with its Save', () => {
    renderCompare('AAPL,TSLA,JPM');
    const grid = section('Risk areas');
    const rows = [...grid.querySelectorAll<HTMLElement>('tr[data-area]')];
    const total = rows.length;
    expect(total).toBeGreaterThan(5);
    expect(rows.filter((r) => !r.hidden)).toHaveLength(5);
    const toggle = within(grid).getByRole('button', { name: `Show all ${total} areas` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(rows.filter((r) => !r.hidden)).toHaveLength(total);
    // Focus moves to the first revealed area.
    expect(document.activeElement).toBe(rows[5]);
    expect(within(grid).getAllByRole('button', { name: 'Save finding' })).toHaveLength(total);
  });

  it('Ask next shows three questions, every one a click away', () => {
    renderCompare('AAPL,TSLA,JPM');
    const el = section('Ask next');
    const list = el.querySelector('ul')!;
    const total = list.children.length;
    expect(shown(list).length).toBe(Math.min(total, 3));
    if (total > 3) {
      fireEvent.click(within(el).getByRole('button', { name: /^Show all \d+/ }));
      expect(shown(list).length).toBe(total);
    }
  });

  it('management emphasis (three lines) offers no More for a summary that fits three lines', () => {
    const p = profiles();
    const aapl = p.get('AAPL')!;
    // 180 characters: over the two-line threshold (140), under the three-line one (210).
    const medium = 'Management emphasizes services growth, supply chain resilience and continued investment in research and development across its product lines this year.'.padEnd(180, ' x').slice(0, 180);
    expect(medium.length).toBe(180);
    p.set('AAPL', { ...aapl, managementOutlook: { summary: medium, citationIds: [aapl.citations[0]!.chunkId] } });
    setRoute('/compare/', 'tickers=AAPL,TSLA');
    renderInWorkspace(<CompareView />, { profiles: p });
    expect(within(section('Management emphasis')).queryByRole('button', { name: /^More: Management emphasizes/ })).not.toBeInTheDocument();
  });

  it('management emphasis clamps long summaries with More, keeping the citations outside the clamp', () => {
    const p = profiles();
    const aapl = p.get('AAPL')!;
    const long = `${'Management describes several outlook topics in detail. '.repeat(6)}`.trim();
    p.set('AAPL', { ...aapl, managementOutlook: { summary: long, citationIds: [aapl.citations[0]!.chunkId] } });
    setRoute('/compare/', 'tickers=AAPL,TSLA');
    renderInWorkspace(<CompareView />, { profiles: p });
    const emphasis = section('Management emphasis');
    const more = within(emphasis).getByRole('button', { name: 'More: Management describes several outlook topics in' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    expect(within(emphasis).getByRole('button', { name: 'Less: Management describes several outlook topics in' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('Compare: refined bottom line and risk grid (DD-21 h, after the adversary review)', () => {
  const built = (tickers: string[]) => new Map<string, CompanyIntelligenceProfile>(tickers.map((t) => [t, BUILT[t as keyof typeof BUILT]]));
  function renderWith(p: Map<string, CompanyIntelligenceProfile>) {
    setRoute('/compare/', `tickers=${[...p.keys()].join(',')}`);
    renderInWorkspace(<CompareView />, { profiles: p });
  }
  const chipOf = (link: HTMLElement) => link.closest('li')!.querySelector('[data-direction]')!;

  it('the footer agrees with the lines; only a shared direction is coloured; the legend names the grey arrow', () => {
    renderWith(built(['AAPL', 'MSFT', 'NVDA']));
    const box = section('Bottom line');
    const [revenue, margin, cash] = within(box).getAllByRole('link');
    expect(chipOf(revenue!)).toHaveAttribute('data-direction', 'up');
    // One company differs: its arrow without colour.
    expect(chipOf(margin!)).toHaveAttribute('data-direction', 'neutral');
    expect(chipOf(cash!)).toHaveAttribute('data-direction', 'neutral');
    expect(box).toHaveTextContent('Opposite directions: Operating cash flow (rising at Microsoft and NVIDIA, falling at Apple).');
    expect(box).not.toHaveTextContent('No metric');
    const legend = within(box).getByRole('list', { name: 'Legend' });
    expect(legend).toHaveTextContent('increased at every company');
    expect(legend).toHaveTextContent('no colour: one company differs, or neither direction is better');
  });

  // Phase 9 review item 16: short names, and one shared attention area stated once.
  it('uses short company names, and states a major attention area every company shares once', () => {
    const p = built(['AAPL', 'MSFT', 'NVDA']);
    renderWith(p);
    const table = screen.getByRole('table', { name: 'Companies side by side' });
    expect(within(table).getByRole('columnheader', { name: /Apple/ })).not.toHaveTextContent('Apple Inc');
    const row = within(table).getByRole('rowheader', { name: 'Major attention area' }).closest('tr')!;
    const cells = row.querySelectorAll('td');
    const same = row.querySelector('[data-same-value]');
    if (same) {
      expect(same).toHaveAttribute('colspan', '3');
      expect(same.textContent).toMatch(/^[A-Z][\w &]+, at all three$/);
    } else {
      // Not all the same: one cell per company (plus the actions cell), and they are not all equal.
      expect(cells.length).toBe(4);
      expect(new Set([...cells].slice(0, 3).map((c) => c.textContent)).size).toBeGreaterThan(1);
    }
    expect(section('Bottom line')).not.toHaveTextContent(/\b(Inc|Corporation)\b/);
  });

  it('mixed directions get the distinct "directions differ" symbol, explained in the legend', () => {
    renderWith(built(['AAPL', 'TSLA']));
    const box = section('Bottom line');
    const revenue = within(box).getByRole('link', { name: 'Revenue grew at Apple; fell at Tesla' });
    expect(chipOf(revenue)).toHaveAttribute('data-direction', 'neutral');
    expect(chipOf(revenue)).toHaveTextContent('directions differ');
    expect(chipOf(revenue).querySelector('svg.lucide-arrow-left-right')).not.toBeNull();
    expect(within(box).getByRole('list', { name: 'Legend' })).toHaveTextContent('directions differ');
  });

  it('the grid uses screen-reader text, not aria-label on spans; a cell’s name holds its visible text; the popover is named', () => {
    // MSFT given a signal in an area where it has no risk heading: its cell shows "No heading".
    const msft = BUILT.MSFT;
    const headed = new Set(msft.currentRisks.map((r) => r.category));
    const empty = SIGNAL_CATEGORIES.find((c) => !headed.has(c) && !msft.signals.some((s) => s.category === c))!;
    const p = built(['AAPL', 'MSFT', 'NVDA']).set('MSFT', { ...msft, signals: [{ ...msft.signals[0]!, category: empty }, ...msft.signals.slice(1)] });
    renderWith(p);
    const grid = section('Risk areas');
    expect(grid.querySelectorAll('span[aria-label]')).toHaveLength(0);
    const first = grid.querySelector<HTMLElement>('tr[data-area]')!;
    expect(within(first).getByText('Rank 1')).toHaveClass('sr-only');
    expect(within(grid).getAllByText('Not in this company’s areas')[0]).toHaveClass('sr-only');
    const showAll = within(grid).queryByRole('button', { name: /^Show all \d+ areas$/ });
    if (showAll) fireEvent.click(showAll);
    const cell = within(grid).getByRole('button', { name: /^Microsoft, .*: No heading · 1 signal$/ });
    expect(cell).toHaveTextContent('No heading');
    fireEvent.click(cell);
    const popover = screen.getByRole('dialog');
    expect(popover).toHaveAccessibleName(expect.stringMatching(/^Microsoft · /));
  });

  it('a stale or unread cell keeps its plain label; a slowing cell names the prior year', () => {
    renderWith(built(['AAPL', 'MSFT', 'NVDA']));
    const row = section('Side by side').querySelector<HTMLElement>('tr[data-metric="Revenue"]')!;
    expect(row).toHaveTextContent('after +125.9% in FY2024');
  });
});

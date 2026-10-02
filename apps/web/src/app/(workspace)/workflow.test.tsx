import type * as React from 'react';
import { OTHER_RISKS_LABEL, SIGNAL_CATEGORY_LABELS, type CompanyIntelligenceProfile } from '@diligenceiq/core';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntelligenceDashboard } from '@/components/intelligence/dashboard';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { unsourcedFigures } from '@/test/figures';
import { nav, setRoute } from '@/test/navigation-mock';
import { builtProfiles, profileWithSignal } from '@/test/profiles';
import { renderInWorkspace } from '@/test/render';
import { SAMPLE_ANALYSES, SAMPLE_CONTEXTS } from '@/test/sample-analyses';
import { AnalysisView } from './analysis/analysis-view';
import { CompareView } from './compare/compare-view';
import { FindingsView } from './findings/findings-view';
import { IntelligenceView } from './intelligence/intelligence-view';

const withSamples = { initial: { analyses: SAMPLE_ANALYSES, findings: [] }, contexts: SAMPLE_CONTEXTS };
const hrefParams = (el: HTMLElement) => new URLSearchParams((el.getAttribute('href') ?? '').split('?')[1] ?? '');
/** The first (lowest-rank) current risk of a preview profile in a category. */
const firstRisk = (ticker: string, category: string) => FIXTURE_PROFILES.get(ticker)!.currentRisks.find((r) => r.category === category)!;

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch');
  nav.push.mockReset();
});
afterEach(() => fetchSpy.mockRestore());

describe('Company Intelligence', () => {
  it('features deep-coverage companies with Apple first and searches all companies', async () => {
    setRoute('/intelligence/');
    renderInWorkspace(<IntelligenceView />);
    const featured = screen.getByRole('heading', { name: 'Deep coverage' }).parentElement!;
    expect(within(featured).getAllByRole('link')[0]).toHaveTextContent('Apple Inc');
    expect(within(featured).getAllByRole('link')).toHaveLength(12);
    expect(screen.getByText('All companies · 54')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search companies'), 'general elec');
    const all = screen.getByRole('heading', { name: /All companies/ }).closest('section')!;
    expect(within(all).getAllByRole('link')).toHaveLength(1);
    expect(within(all).getByRole('link')).toHaveTextContent('Outside review window');
    // Assumptions G2: labeled as GE Capital's FY2014 report, not as General Electric (regression, finding 13).
    expect(within(all).getByRole('link')).toHaveTextContent('General Electric Capital Corp (GE Capital)');
    expect(within(all).getByRole('link')).toHaveTextContent('FY2014 · Outside review window');
  });

  it('GE (outside the review window) offers no profile and no Deep Analysis filter it would silently drop', () => {
    // Regression (adversary finding 13): the page offered "Ask about General Electric Company",
    // and Deep Analysis then dropped GE from the filter.
    setRoute('/intelligence/', 'ticker=GE');
    renderInWorkspace(<IntelligenceView />);
    expect(screen.getByText(/General Electric Capital Corp \(GE Capital\), FY2014: outside the review window/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ask about/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link').some((l) => (l.getAttribute('href') ?? '').includes('/analysis/new'))).toBe(false);
    expect(screen.getByRole('link', { name: 'Open the filing' }).getAttribute('href')).toMatch(/id=GE_10K_2015-02-27/);
  });

  it('renders the dashboard sections in order, with placeholders labeled and risks cited', () => {
    setRoute('/intelligence/', 'ticker=AAPL');
    renderInWorkspace(<IntelligenceView />);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      '30-second view',
      'Performance',
      'What is driving performance',
      'Current risks',
      'What’s changed',
      'Attention signals',
      'Recommended diligence',
      'Coverage',
    ]);
    expect(screen.getAllByText('Placeholder, not filing data').length).toBeGreaterThan(3);
    const supply = screen.getByRole('region', { name: 'Supply chain' });
    const supplyRisk = firstRisk('AAPL', 'supply_chain');
    expect(supplyRisk.heading).toMatch(/^The Company depends on component and product manufacturing/);
    expect(supply).toHaveTextContent(supplyRisk.heading);
    expect(supplyRisk.citationIds[0]).toMatch(/^AAPL-FY2025-10K-1A-\d{3}$/);
    for (const id of supplyRisk.citationIds) expect(within(supply).getAllByRole('button', { name: `View evidence ${id}` }).length).toBeGreaterThan(0);
    // Every extracted heading renders once, in a group: classified areas in order of their first
    // heading, then the unclassified headings under "Other risks", last.
    const aapl = FIXTURE_PROFILES.get('AAPL')!;
    const risks = screen.getByRole('heading', { name: 'Current risks' }).closest('section')!;
    const groups = within(risks).getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    const classified = [...new Set(aapl.currentRisks.flatMap((r) => (r.category ? [SIGNAL_CATEGORY_LABELS[r.category]] : [])))];
    expect(aapl.currentRisks.some((r) => r.category === null)).toBe(true);
    expect(groups).toEqual([...classified, OTHER_RISKS_LABEL]);
    expect(within(risks).getAllByRole('link', { name: /Investigate/ })).toHaveLength(aapl.currentRisks.length);
    const other = within(risks).getByRole('region', { name: OTHER_RISKS_LABEL });
    const unclassified = aapl.currentRisks.filter((r) => r.category === null);
    expect(within(other).getAllByRole('listitem')).toHaveLength(unclassified.length);
    for (const r of unclassified) expect(other).toHaveTextContent(r.heading);
    // An unclassified heading's Investigate question quotes the heading instead of naming an area.
    expect(hrefParams(within(other).getAllByRole('link', { name: /Investigate/ })[0]!).get('q')).toBe(
      `What does Apple Inc disclose about this risk in its latest annual report: “${unclassified[0]!.heading}”`,
    );
    expect(screen.getByText(/Generation: deterministic · 0 model calls/)).toBeInTheDocument();
  });

  it('labels preview risk headings as rule-extracted and never implies completeness', () => {
    // Regression (adversary finding 1): the lede read "Risk headings from the latest annual report, grouped by area."
    // Phase 2: the preview holds the complete rule-extracted list, and still says the rule can miss some.
    // Phase 2 fix (adversary H2): it also says the rule can include a sentence that is not a heading.
    setRoute('/intelligence/', 'ticker=AAPL');
    const { container } = renderInWorkspace(<IntelligenceView />);
    const risks = screen.getByRole('heading', { name: 'Current risks' }).closest('section')!;
    expect(risks).toHaveTextContent(
      'Risk headings extracted from the latest annual report, grouped by area. A preview: the extraction rule can miss some headings and can include a sentence that is not a heading.',
    );
    expect(container).toHaveTextContent('Preview profile. It lists the risk headings extracted from the latest annual report by a deterministic rule');
    expect(container).toHaveTextContent('the rule can miss some headings and can include a sentence that is not a heading.');
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Risk headings from the latest annual report, grouped by area\./);
    expect(text).not.toMatch(/position in the latest risk headings|all (?:of )?(?:its|the) risk|complete list of|every risk/i);
  });

  it('shows Placeholder, not "Not extracted", in the performance table of a preview profile', () => {
    // Regression (adversary finding 11): "Not extracted" reads as "looked and found nothing".
    setRoute('/intelligence/', 'ticker=MSFT');
    renderInWorkspace(<IntelligenceView />);
    const table = screen.getByRole('table', { name: /performance/ });
    expect(within(table).queryByText('Not extracted')).not.toBeInTheDocument();
    expect(within(table).getAllByText('Placeholder, not filing data')).toHaveLength(20);
  });

  it('labels profile evidence as filing text, not as passages supplied to a model', async () => {
    // Regression (adversary finding 4): profile citations said "Validated — supplied to the model".
    setRoute('/intelligence/', 'ticker=MSFT');
    renderInWorkspace(<IntelligenceView />);
    await userEvent.click(within(screen.getByRole('region', { name: 'Cybersecurity' })).getAllByRole('button', { name: /^View evidence/ })[0]!);
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByTestId('evidence-provenance')).toHaveTextContent('Filing text cited by the company profile');
    expect(drawer).not.toHaveTextContent('supplied to the model');
  });

  it('recommendations explain themselves plainly, cite their risk, and ask something the risk does not', () => {
    // Regression (adversary finding 14): "Templated from a current risk heading…" and near-duplicate questions.
    setRoute('/intelligence/', 'ticker=AAPL');
    renderInWorkspace(<IntelligenceView />);
    const list = screen.getByRole('heading', { name: 'Recommended diligence' }).closest('section')!;
    expect(list).not.toHaveTextContent(/Templated|heading/);
    // One evidence chip per cited chunk; every recommendation cites at least one.
    const recs = FIXTURE_PROFILES.get('AAPL')!.recommendedDiligence;
    expect(recs.every((r) => r.citationIds.length > 0)).toBe(true);
    expect(within(list).getAllByRole('button', { name: /^View evidence/ }).length).toBe(recs.reduce((n, r) => n + r.citationIds.length, 0));
    const riskQuestions = within(screen.getByRole('heading', { name: 'Current risks' }).closest('section')!)
      .getAllByRole('link', { name: /Investigate/ })
      .map((l) => hrefParams(l).get('q'));
    const recQuestions = within(list).getAllByRole('link', { name: /Investigate/ }).map((l) => hrefParams(l).get('q'));
    for (const q of recQuestions) {
      expect(riskQuestions).not.toContain(q);
      for (const r of riskQuestions) expect(q?.startsWith((r ?? '').replace(/\?$/, ''))).toBe(false);
    }
  });

  it('prefills Deep Analysis from a recommendation without running it', () => {
    setRoute('/intelligence/', 'ticker=NVDA');
    renderInWorkspace(<IntelligenceView />);
    const list = screen.getByRole('heading', { name: 'Recommended diligence' }).closest('section')!;
    const link = within(list).getAllByRole('link', { name: /Investigate/ })[0]!;
    const params = hrefParams(link);
    expect(link.getAttribute('href')).toMatch(/^\/analysis\/new\/?\?/);
    expect(params.get('q')).toMatch(/^How has NVIDIA Corporation’s discussion of .* risk changed across its annual reports/);
    expect(params.get('tickers')).toBe('NVDA');
    expect(params.get('origin')).toBe('recommendation:NVDA:rec-1');
  });

  it.each([...FIXTURE_PROFILES.keys()])('fixture profile %s renders no figure without a source row', (ticker) => {
    setRoute('/intelligence/', `ticker=${ticker}`);
    const { container } = renderInWorkspace(<IntelligenceView />);
    expect(unsourcedFigures(container, FIXTURE_PROFILES.get(ticker)!)).toEqual([]);
  });

  it('the figure check catches figures React splits across text nodes, and other figure forms', () => {
    // Regression (adversary finding 3): each text node was scanned separately, so `{v}%` passed.
    const base = FIXTURE_PROFILES.get('AAPL')!;
    const v = 12;
    const n = 416.2;
    const cases: Array<[string, React.ReactElement]> = [
      ['{v}%', <p key="a">Revenue grew {v}%</p>],
      ['$ + {n} + billion', <p key="b">Net sales were ${n} billion</p>],
      ['{v} points', <p key="c">Margin rose {v} points</p>],
      ['{v} percent', <p key="d">up {v} percent</p>],
      ['{v} bps', <p key="e">widened {v} bps</p>],
      ['{v}x', <p key="f">trades at {v}x</p>],
      ['split spans', <p key="g"><span>{v}</span><span>%</span></p>],
    ];
    for (const [name, el] of cases) {
      const { container, unmount } = renderInWorkspace(el);
      expect(unsourcedFigures(container, base), name).not.toEqual([]);
      unmount();
    }
    // Text that is not a figure stays clean.
    const { container } = renderInWorkspace(<p>FY2025 10-K · Item 1A · {3} annual reports</p>);
    expect(unsourcedFigures(container, base)).toEqual([]);
  });

  it('allows figures only in the smallest marked elements, not whole sections', () => {
    // Regression (adversary finding 3): the header line and coverage block were exempt as a whole.
    const base = FIXTURE_PROFILES.get('AAPL')!;
    const { container } = renderInWorkspace(<IntelligenceDashboard profile={{ ...base, sector: 'Technology, revenue up 12%' }} />);
    expect(unsourcedFigures(container, base).join(' ')).toMatch(/12%/);
    const gaps = renderInWorkspace(<IntelligenceDashboard profile={{ ...base, gaps: ['Cash was $3.1 billion.'] }} />);
    expect(unsourcedFigures(gaps.container, base).join(' ')).toMatch(/3\.1 billion/);
  });

  it('the figure check fails on an unsourced figure', () => {
    const base = FIXTURE_PROFILES.get('AAPL')!;
    const bad: CompanyIntelligenceProfile = {
      ...base,
      executiveView: base.executiveView.map((e, i) => (i === 0 ? { ...e, label: 'Growing', summary: 'Revenue grew 12% to $416.2 billion.' } : e)),
    };
    const { container } = renderInWorkspace(<IntelligenceDashboard profile={bad} />);
    expect(unsourcedFigures(container, bad).join(' ')).toMatch(/12%/);

    const slot = container.querySelector('[data-metric-slot]')!;
    slot.innerHTML = '<span data-metric-value>$5.0B</span>';
    expect(unsourcedFigures(container, base).join(' ')).toMatch(/metric value without a source row/);
  });

  it('renders a value only with its source row', () => {
    const base = FIXTURE_PROFILES.get('AAPL')!;
    const chunk = base.citations[0]!;
    const rawRow = chunk.text.slice(0, 40);
    const sourced: CompanyIntelligenceProfile = {
      ...base,
      facts: [{ metric: 'Revenue', period: 'FY2025', value: 5, unit: 'USD', scale: 1e9, chunkId: chunk.chunkId, rawRow, crossCheck: 'single_source' }],
    };
    const { container } = renderInWorkspace(<IntelligenceDashboard profile={sourced} />);
    const value = container.querySelector<HTMLElement>('[data-metric-value]')!;
    expect(value).toHaveTextContent('$5.0B · FY2025');
    expect(value.dataset.rawRow).toBe(rawRow);
    expect(unsourcedFigures(container, sourced)).toEqual([]);
  });

  it('offers Deep Analysis when a company has no profile, and handles unknown tickers', () => {
    setRoute('/intelligence/', 'ticker=TSLA');
    const { unmount } = renderInWorkspace(<IntelligenceView />);
    expect(screen.getByText(/Intelligence for Tesla Inc isn’t built for this index version/)).toBeInTheDocument();
    expect(hrefParams(screen.getByRole('link', { name: /Ask about Tesla/ })).get('tickers')).toBe('TSLA');
    unmount();
    setRoute('/intelligence/', 'ticker=ZZZZ');
    renderInWorkspace(<IntelligenceView />);
    expect(screen.getByText('Company not found')).toBeInTheDocument();
  });

  it('signals: Investigate prefills, View evidence shows each period, Track saves a finding', async () => {
    const profile = profileWithSignal();
    setRoute('/intelligence/', 'ticker=AAPL');
    renderInWorkspace(
      <>
        <IntelligenceView />
        <FindingsView />
      </>,
      { profiles: new Map([['AAPL', profile]]) },
    );
    const card = screen.getByRole('heading', { name: 'TEST signal headline' }).closest('li')!;
    const params = hrefParams(within(card).getByRole('link', { name: /Investigate/ }));
    expect(params.get('origin')).toBe('signal:AAPL:sig-test-1');
    expect(params.get('q')).toBe('TEST: How concentrated is manufacturing?');
    expect(within(card).getByText('General context')).toBeInTheDocument();

    await userEvent.click(within(card).getByRole('button', { name: 'View evidence' }));
    const drawer = await screen.findByRole('dialog');
    expect(drawer).toHaveTextContent('Evidence by period');
    expect(within(drawer).getByRole('region', { name: 'FY2024' })).toHaveTextContent('No passage for this period.');
    expect(within(drawer).getByRole('region', { name: 'FY2025' })).toHaveTextContent('outsourcing partners');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(within(card).getByRole('button', { name: 'Track' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Theme')).toHaveValue('risk-factors');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save finding' }));
    expect(within(card).getByRole('link', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByText('1 finding')).toBeInTheDocument();
  });

  it('saves a current risk with its verbatim text and citation, and never calls the network', async () => {
    setRoute('/intelligence/', 'ticker=MSFT');
    renderInWorkspace(
      <>
        <IntelligenceView />
        <FindingsView />
      </>,
    );
    const cyber = screen.getByRole('region', { name: 'Cybersecurity' });
    const risk = firstRisk('MSFT', 'cybersecurity');
    await userEvent.click(within(cyber).getAllByRole('button', { name: 'Save Finding' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'NEEDS_FOLLOW_UP');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save finding' }));

    const board = screen.getByRole('heading', { name: 'Risk Factors · 1' }).closest('section')!;
    expect(board).toHaveTextContent('Cybersecurity risk');
    expect(risk.heading).toMatch(/^Cyberattacks and security vulnerabilities could lead to reduced revenue/);
    expect(board).toHaveTextContent(risk.heading);
    expect(board).toHaveTextContent('Company Intelligence');
    expect(within(board).getByRole('link', { name: 'MSFT · current risk' }).getAttribute('href')).toMatch(/ticker=MSFT/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('Compare', () => {
  it('with preview profiles, states no comparative conclusion drawn from a possibly incomplete heading list', async () => {
    // Regression (adversary finding 1): common/distinctive areas, "Major attention area", the
    // ranking and the questions derived from them were presented as facts about each company.
    // Phase 2: the preview lists are complete rule output but can still miss headings.
    setRoute('/compare/', 'tickers=AAPL,MSFT,NVDA');
    renderInWorkspace(
      <div data-testid="compare">
        <CompareView />
      </div>,
    );
    const container = screen.getByTestId('compare');
    const text = container.textContent ?? '';
    expect(screen.queryByRole('heading', { name: 'Common attention areas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Distinctive attention areas' })).not.toBeInTheDocument();
    expect(text).not.toMatch(/appears among the risk areas|among the latest risk headings of|position in the latest risk headings/);
    expect(screen.queryByRole('button', { name: 'How the ranking works' })).not.toBeInTheDocument();
    for (const label of ['Regulatory', 'Cybersecurity', 'Competition', 'Supply chain', 'Geographic concentration', 'Customer concentration', 'Litigation', OTHER_RISKS_LABEL]) {
      expect(within(container).queryByText(label)).not.toBeInTheDocument();
    }
    const majorRow = screen.getByRole('rowheader', { name: 'Major attention area' }).closest('tr')!;
    expect(within(majorRow).getAllByText('Placeholder, not filing data')).toHaveLength(3);
    for (const id of ['attention-areas', 'ranking', 'comparative-diligence']) {
      expect(container.querySelector(`[aria-labelledby="${id}"]`)).toHaveTextContent(
        'Computed from each company’s full profile once it is built. These preview profiles list the headings an extraction rule found; the rule can miss some headings and can include a sentence that is not a heading, so no comparison is drawn from them.',
      );
    }
    // No Save on any row: nothing here is a citable comparative fact yet.
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument();
    // Factual rows stay: coverage tier and fiscal-year end, with the different-month note.
    expect(screen.getByRole('rowheader', { name: 'Fiscal year ends' }).closest('tr')).toHaveTextContent('Sep 27, 2025');
    expect(screen.getByText(/Fiscal years end in different months/)).toBeInTheDocument();
    // One templated question that does not depend on which headings the profiles hold.
    const links = within(screen.getByRole('heading', { name: 'Recommended comparative diligence' }).closest('section')!).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(hrefParams(links[0]!).get('q')).toBe('Compare the primary risk factors Apple Inc, Microsoft Corporation, and NVIDIA Corporation describe in their latest annual reports.');
    expect(hrefParams(links[0]!).get('origin')).toBe('compare:AAPL,MSFT,NVDA:risk-factors');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('with built profiles, composes common and distinctive areas and saves a row with its evidence', async () => {
    setRoute('/compare/', 'tickers=AAPL,MSFT');
    renderInWorkspace(
      <>
        <CompareView />
        <FindingsView />
      </>,
      { profiles: builtProfiles() },
    );
    const common = screen.getByRole('heading', { name: 'Common attention areas' }).closest('section')!;
    expect(within(common).getAllByText(/^(Regulatory|Competition|Cybersecurity)$/).map((e) => e.textContent)).toEqual(['Regulatory', 'Competition', 'Cybersecurity']);
    const distinctive = screen.getByRole('heading', { name: 'Distinctive attention areas' }).closest('section')!;
    expect(distinctive).toHaveTextContent('Supply chain');
    const link = within(screen.getByRole('heading', { name: 'Recommended comparative diligence' }).closest('section')!).getAllByRole('link')[0]!;
    expect(hrefParams(link).get('origin')).toBe('compare:AAPL,MSFT:common-regulatory');

    await userEvent.click(within(distinctive).getByRole('button', { name: 'Save Finding' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Supply chain: distinctive to Apple Inc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save finding' }));
    expect(screen.getByRole('heading', { name: 'Risk Factors · 1' })).toBeInTheDocument();
    // The same row in the attention ranking is the same stored item, so it shows as saved too.
    const ranking = screen.getByRole('heading', { name: 'Attention ranking' }).closest('section')!;
    expect(within(ranking).getAllByRole('link', { name: 'Saved' })).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('lists companies without a profile and fails clearly below two', () => {
    setRoute('/compare/', 'tickers=AAPL,MSFT,TSLA');
    const { unmount } = renderInWorkspace(<CompareView />);
    expect(screen.getByText(/Not compared \(intelligence not built yet\): Tesla Inc\./)).toBeInTheDocument();
    unmount();
    setRoute('/compare/', 'tickers=AAPL,TSLA');
    renderInWorkspace(<CompareView />);
    expect(screen.getByText('Not enough companies have intelligence built to compare')).toBeInTheDocument();
  });

  it('asks for at least two companies', () => {
    setRoute('/compare/', '');
    renderInWorkspace(<CompareView />);
    expect(screen.getByText('Select at least two companies.')).toBeInTheDocument();
  });
});

describe('Diligence Brief', () => {
  beforeEach(() => setRoute('/analysis/', 'id=an-01'));

  it('renders the brief sections, comparison table, and source validation', () => {
    renderInWorkspace(<AnalysisView />, withSamples);
    expect(screen.getByRole('heading', { level: 1, name: 'Supply-chain concentration: Apple and NVIDIA' })).toBeInTheDocument();
    for (const name of ['Executive summary', 'Key findings', 'Comparison', 'Investment considerations', 'Evidence gaps']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('table')).toHaveTextContent('Single-source exposure');
    expect(screen.getByText(/All \d+ cited passages were among the passages supplied to the model/)).toBeInTheDocument();
    const followUp = within(screen.getByRole('heading', { name: 'Suggested follow-up questions' }).closest('section')!).getAllByRole('link')[0]!;
    expect(hrefParams(followUp).get('origin')).toBe('brief:an-01:0');
  });

  it('saves a key finding and a comparison row; both reach the Findings Board', async () => {
    renderInWorkspace(
      <>
        <AnalysisView />
        <FindingsView />
      </>,
      withSamples,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Save Finding' })[0]!);
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Analyst note (optional)'), 'Size it');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save finding' }));
    await userEvent.click(within(screen.getByRole('table')).getAllByRole('button', { name: 'Save' })[0]!);
    dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save finding' }));
    expect(screen.getByText('2 findings')).toBeInTheDocument();
    expect(screen.getByText('Size it')).toBeInTheDocument();
    expect(screen.getAllByText('Deep Analysis').length).toBeGreaterThanOrEqual(2);
  });

  it('shows a failed analysis as an error panel with its request ID and a retry link', () => {
    setRoute('/analysis/', 'id=an-04');
    renderInWorkspace(<AnalysisView />, withSamples);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The filings don’t cover this');
    expect(alert).toHaveTextContent('fixture-7f3c2a');
    expect(within(alert).getByRole('link', { name: 'Edit and run again' }).getAttribute('href')).toMatch(/^\/analysis\/new\/?\?/);
  });

  it('shows not-found for an unknown analysis and a prompt with no ID', async () => {
    setRoute('/analysis/', 'id=nope');
    const { unmount } = renderInWorkspace(<AnalysisView />);
    expect(await screen.findByText('Analysis not found')).toBeInTheDocument();
    unmount();
    setRoute('/analysis/', '');
    renderInWorkspace(<AnalysisView />);
    expect(screen.getByText('No analysis selected')).toBeInTheDocument();
  });
});

describe('Findings Board', () => {
  it('starts empty, with no hand-written findings', () => {
    setRoute('/findings/');
    renderInWorkspace(<FindingsView />);
    expect(screen.getByText('No findings yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Company Intelligence' })).toBeInTheDocument();
  });
});

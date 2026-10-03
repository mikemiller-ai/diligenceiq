import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type CompanyIntelligenceProfile,
  CompanyIntelligenceProfileSchema,
  type ProfileSignal,
  ProfileSetManifestSchema,
  findBannedPhrases,
  parseTrendBasis,
} from '@diligenceiq/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { BUILT, BUILT_SET_DIR } from '@/test/built-profiles';
import { setRoute } from '@/test/navigation-mock';
import { renderInWorkspace } from '@/test/render';
import { Clamp, ShowMore } from './condense';
import { IntelligenceDashboard } from './dashboard';
import {
  DIRECTION_WORD,
  type Direction,
  LEGEND,
  MARGINS,
  bottomLine,
  changeText,
  comparableMarginSeries,
  comparableSeries,
  driverFigures,
  isCurrent,
  latestFiscalYear,
  pctChange,
  profitTitle,
  readTrend,
  rowChange,
  signalDirection,
  signedPct,
  signedPp,
  trajectoryDirection,
  viewDirection,
  viewLead,
} from './signals';
import { GLOSSARY } from './term';

/*
 * Readability layer (DD-21). The bottom line, lead lines, change chips and colours are fixed
 * rules over the stored profile, and every label and direction comes from the builder's own
 * outputs (trend trajectory and basis, signal type and measurement). These tests pin the rules
 * on real built profiles (AAPL growing with regions, TSLA declining, JPM a bank with few facts),
 * prove each rule on synthetic variations, and, when the local profile sets exist, check that the
 * page never contradicts itself for every company in every set.
 */

const PROFILES = Object.values(BUILT);
const DIMENSIONS = ['Performance', 'Profitability', 'Latest quarter', 'Cash generation', 'Risk changes', 'Evidence coverage'];

/** Every locally built profile (`.index/` is gitignored): all 53 companies in each set, or none. */
const LOCAL_ROOT = resolve(__dirname, '../../../../../.index/intelligence/iv-9cf51c066743');
const LOCAL: Array<{ set: string; p: CompanyIntelligenceProfile }> = existsSync(LOCAL_ROOT)
  ? readdirSync(LOCAL_ROOT).flatMap((set) =>
      readdirSync(join(LOCAL_ROOT, set))
        .filter((f) => /^[A-Z]+\.json$/.test(f))
        .map((f) => ({ set, p: CompanyIntelligenceProfileSchema.parse(JSON.parse(readFileSync(join(LOCAL_ROOT, set, f), 'utf8'))) })),
    )
  : [];
const local = (set: string, ticker: string) => LOCAL.find((x) => x.set === set && x.p.ticker === ticker)?.p;

/** A copy of `p` with `metric`'s trend replaced by one with this basis (and its trajectory). */
function withTrend(p: CompanyIntelligenceProfile, metric: string, basis: string, chunkIds: string[] = []): CompanyIntelligenceProfile {
  const parsed = parseTrendBasis(basis);
  if (!parsed) throw new Error(`test basis does not parse: ${basis}`);
  return { ...p, trends: [...p.trends.filter((t) => t.metric !== metric), { metric, trajectory: parsed.trajectory, basis, periods: [], chunkIds }] };
}
const withoutTrend = (p: CompanyIntelligenceProfile, metric: string): CompanyIntelligenceProfile => ({ ...p, trends: p.trends.filter((t) => t.metric !== metric) });

const renderDashboard = (p: CompanyIntelligenceProfile) => {
  setRoute('/intelligence/', `ticker=${p.ticker}`);
  return renderInWorkspace(<IntelligenceDashboard profile={p} />, { profiles: new Map([[p.ticker, p]]) });
};

describe('the committed built test set', () => {
  it('is a valid profile set the api can serve, and verbatim llm-v3 when the local build is present', () => {
    const manifest = ProfileSetManifestSchema.parse(JSON.parse(readFileSync(join(BUILT_SET_DIR, 'manifest.json'), 'utf8')));
    expect(`${manifest.indexVersion}/${manifest.profileSetId}`).toBe('iv-9cf51c066743/llm-v3');
    expect(manifest.companies.map((c) => c.ticker).sort()).toEqual(['AAPL', 'JPM', 'MSFT', 'NVDA', 'PFE', 'TSLA']);
    for (const t of ['AAPL', 'TSLA', 'JPM', 'MSFT', 'NVDA', 'PFE']) {
      const src = join(LOCAL_ROOT, 'llm-v3', `${t}.json`);
      if (existsSync(src)) expect(readFileSync(join(BUILT_SET_DIR, `${t}.json`), 'utf8'), t).toBe(readFileSync(src, 'utf8'));
    }
  });
});

describe('bottom line (the builder’s labels and figures, latest annual report only)', () => {
  it('AAPL: the five lines, in order, each naming its period', () => {
    expect(bottomLine(BUILT.AAPL).map((b) => [b.direction, b.title, b.detail, b.anchor])).toEqual([
      ['up', 'Revenue grew', '+6.4% in FY2025, after +2.0% in FY2024', 'performance'],
      ['up', 'Keeps more of each sale as profit', 'net margin 24.0% in FY2024 → 26.9% in FY2025', 'performance'],
      ['down', 'Cash from operations fell', '−5.7% in FY2025, to $111.5B', 'performance'],
      ['down', 'Greater China declined', '−3.8% in FY2025, 15.5% of revenue', 'drivers'],
      ['repeat', '6 risk areas in every annual report', 'disclosed in each annual report from FY2022 to FY2025', 'current-risks'],
    ]);
  });

  it('TSLA: falling revenue, lower profit per sale, cash about the same', () => {
    expect(bottomLine(BUILT.TSLA).map((b) => [b.direction, b.title, b.detail])).toEqual([
      ['down', 'Revenue fell', '−2.9% in FY2025, after +0.9% in FY2024'],
      ['down', 'Keeps less of each sale as profit', 'net margin 7.3% in FY2024 → 4.0% in FY2025'],
      ['flat', 'Cash from operations about the same', '−1.2% in FY2025, to $14.7B'],
      ['repeat', '4 risk areas in every annual report', 'disclosed in each annual report from FY2022 to FY2025'],
    ]);
  });

  it('JPM: a bank with no revenue lines gets only the lines its trends support', () => {
    expect(bottomLine(BUILT.JPM).map((b) => [b.direction, b.title])).toEqual([
      ['slowing', 'Revenue growth slowed'],
      ['down', 'Keeps less of each sale as profit'],
    ]);
  });

  it('a preview (fixture) profile has no bottom line', () => {
    for (const p of FIXTURE_PROFILES.values()) expect(bottomLine(p)).toEqual([]);
  });

  // H2: the title and colour follow the builder's Revenue trajectory and thresholds, never a recomputation.
  it.each([
    ['Growth of -3.0% in FY2025, after 5.0% in FY2024 (declining: below -2.0%).', 'down', 'Revenue fell', '−3.0% in FY2025, after +5.0% in FY2024'],
    ['Growth of 1.0% in FY2025, after 5.0% in FY2024 (stable: within ±2.0%).', 'flat', 'Revenue about flat', '+1.0% in FY2025, after +5.0% in FY2024'],
    ['Growth of -0.0% in FY2025, after 1.8% in FY2024 (stable: within ±2.0%).', 'flat', 'Revenue about flat', '0.0% in FY2025, after +1.8% in FY2024'],
    ['Growth of 12.0% in FY2025, after 5.0% in FY2024 (accelerating: at least 5.0 pp faster than the year before).', 'up', 'Revenue growth picked up', '+12.0% in FY2025, after +5.0% in FY2024'],
    ['Growth of 3.0% in FY2025, after 12.0% in FY2024 (slowing: at least 5.0 pp slower than the year before).', 'slowing', 'Revenue growth slowed', '+3.0% in FY2025, after +12.0% in FY2024'],
    ['Growth of 6.4% in FY2025, after 2.0% in FY2024 (growing: above 2.0%).', 'up', 'Revenue grew', '+6.4% in FY2025, after +2.0% in FY2024'],
    ['Growth of 9.0% in FY2025, after -4.0% in FY2024 (growing: above 2.0%, recovering from a decline the year before).', 'up', 'Revenue grew', '+9.0% in FY2025, after −4.0% in FY2024'],
    ['Growth of 4.0% in FY2025 (growing: above 2.0%).', 'up', 'Revenue grew', '+4.0% in FY2025'],
  ] as const)('revenue basis “%s” → %s “%s”', (basis, direction, title, detail) => {
    const p = withTrend(withTrend(BUILT.AAPL, 'Revenue', basis), 'Revenue growth', basis);
    expect(bottomLine(p)[0]).toMatchObject({ key: 'revenue', direction, title, detail });
    expect(viewLead(p, 'Performance')).toBe(`Revenue ${detail}`);
    expect(rowChange(p, 'Revenue')?.direction).toBe(direction);
  });

  it('no Revenue trend means no revenue line, even with revenue facts (labels come only from the builder)', () => {
    const p = withoutTrend(withoutTrend(BUILT.AAPL, 'Revenue'), 'Revenue growth');
    expect(p.facts.some((f) => f.metric === 'Revenue')).toBe(true);
    expect(bottomLine(p).some((b) => b.key === 'revenue')).toBe(false);
    expect(viewLead(p, 'Performance')).toBeNull();
  });

  // H3: loss-making companies.
  it.each([
    ['-5.0% in FY2025 vs -8.0% in FY2024, a change of 3.0 pp (improving: threshold 1.0 pp).', 'up', 'Net loss narrowed', 'net margin −8.0% in FY2024 → −5.0% in FY2025'],
    ['-9.0% in FY2025 vs -4.0% in FY2024, a change of -5.0 pp (declining: threshold 1.0 pp).', 'down', 'Net loss widened', 'net margin −4.0% in FY2024 → −9.0% in FY2025'],
    ['-4.5% in FY2025 vs -4.0% in FY2024, a change of -0.5 pp (stable: threshold 1.0 pp).', 'flat', 'Net loss about the same', 'net margin −4.0% in FY2024 → −4.5% in FY2025'],
    ['3.0% in FY2025 vs -2.0% in FY2024, a change of 5.0 pp (improving: threshold 1.0 pp).', 'up', 'Swung to a profit', 'net margin −2.0% in FY2024 → 3.0% in FY2025'],
    ['-1.0% in FY2025 vs 6.0% in FY2024, a change of -7.0 pp (declining: threshold 1.0 pp).', 'down', 'Swung to a loss', 'net margin 6.0% in FY2024 → −1.0% in FY2025'],
    ['0.0% in FY2025 vs 0.5% in FY2024, a change of -0.5 pp (stable: threshold 1.0 pp).', 'flat', 'Swung to a loss', 'net margin 0.5% in FY2024 → 0.0% in FY2025'],
    ['20.0% in FY2025 vs 20.4% in FY2024, a change of -0.4 pp (stable: threshold 1.0 pp).', 'flat', 'Profit per sale about the same', 'net margin 20.4% in FY2024 → 20.0% in FY2025'],
  ] as const)('net margin “%s” → %s “%s”', (basis, direction, title, detail) => {
    const line = bottomLine(withTrend(BUILT.AAPL, 'Net margin', basis)).find((b) => b.key === 'profit');
    expect(line).toMatchObject({ direction, title, detail });
    expect(profitTitle(parseTrendBasis(basis) as never)).toBe(title);
  });

  it('no Net margin trend means no profit line (it is never recomputed from facts)', () => {
    expect(bottomLine(withoutTrend(BUILT.AAPL, 'Net margin')).some((b) => b.key === 'profit')).toBe(false);
  });

  // H4: stale periods.
  it('a line about an older year than the latest annual report is dropped, with its lead line', () => {
    expect(latestFiscalYear(BUILT.AAPL)).toBe('FY2025');
    const stale = withTrend(BUILT.AAPL, 'Operating cash flow', 'Growth of -10.2% in FY2022, after 126.2% in FY2021 (declining: below -2.0%).');
    expect(bottomLine(stale).map((b) => b.key)).toEqual(['revenue', 'profit', 'lines', 'risks']);
    expect(viewLead(stale, 'Cash generation')).toBeNull();
    const staleMargin = withTrend(BUILT.AAPL, 'Operating margin', '30.0% in FY2024 vs 29.0% in FY2023, a change of 1.0 pp (improving: threshold 1.0 pp).');
    expect(viewLead(staleMargin, 'Profitability')).toBeNull();
    // A quarter may follow the annual report or fall within its year, never precede it.
    expect(isCurrent(BUILT.AAPL, 'FY2026Q1')).toBe(true);
    expect(isCurrent(BUILT.AAPL, 'FY2025Q3')).toBe(true);
    expect(isCurrent(BUILT.AAPL, 'FY2024Q4')).toBe(false);
    const oldQuarter = withTrend(BUILT.AAPL, 'Quarterly revenue growth', 'FY2024Q3 4.0% versus FY2023Q3 (growing; stable within ±2.0%).');
    expect(viewLead(oldQuarter, 'Latest quarter')).toBeNull();
  });

  it.skipIf(!local('llm-v3', 'PFE'))('PFE: the FY2022 cash flow never appears beside FY2024 revenue', () => {
    const pfe = local('llm-v3', 'PFE')!;
    expect(readTrend(pfe, 'Operating cash flow')?.basis.period).toBe('FY2022');
    expect(bottomLine(pfe).some((b) => b.key === 'cash')).toBe(false);
    expect(viewLead(pfe, 'Cash generation')).toBeNull();
  });

  // H5: never "unchanged" while the new/expanded detectors are off; the fresh path stays for a future detector.
  it('states the repetition only, and switches to new or expanded disclosures when a signal exists', () => {
    const strings = bottomLine(BUILT.AAPL).map((b) => `${b.title} ${b.detail}`).join(' ');
    expect(strings).not.toMatch(/unchanged/i);
    const fresh: ProfileSignal = { ...BUILT.AAPL.signals[0]!, signalId: 'new-1', type: 'NEW', headline: 'A new heading about export controls' };
    const p = { ...BUILT.AAPL, signals: [...BUILT.AAPL.signals, fresh] };
    expect(bottomLine(p).at(-1)).toMatchObject({ key: 'risks', direction: 'new', title: '1 new or expanded risk disclosure', detail: fresh.headline, anchor: 'whats-changed' });
    expect(viewLead(p, 'Risk changes')).toBe('1 new or expanded disclosure');
    renderDashboard(p);
    expect(screen.getByRole('region', { name: 'Geographic concentration' })).toHaveTextContent('New or expanded');
  });
});

describe('revenue lines (DD-21; the same ±2% as the trend labels)', () => {
  const drivers = (...lines: Array<[string, string]>) => ({
    ...BUILT.AAPL,
    drivers: lines.map(([label, changeBasis]) => ({ label, metric: 'Revenue', periods: ['FY2024', 'FY2025'], changeBasis, explanation: 'x', citationIds: [] })),
  });
  const basis = (pct: string, share: string) => `$1 million in FY2024 to $1 million in FY2025 (${pct}%); ${share}% of revenue in FY2025.`;
  const lines = (p: CompanyIntelligenceProfile) => bottomLine(p).find((b) => b.key === 'lines');

  it('a fall within 2% is not a decline; the largest fall beyond it, by share, is', () => {
    expect(lines(drivers(['A', basis('-1.5', '60.0')], ['B', basis('+5.0', '40.0')]))).toBeUndefined();
    expect(lines(drivers(['A', basis('-2.5', '20.0')], ['B', basis('-9.0', '30.0')], ['C', basis('+5.0', '50.0')]))).toMatchObject({ direction: 'down', title: 'B declined', detail: '−9.0% in FY2025, 30% of revenue' });
  });

  it('“all grew” only when every line grew by more than 2%, with grammar for two and the largest by share', () => {
    expect(lines(drivers(['A', basis('+3.0', '30.0')], ['B', basis('+5.0', '70.0')]))).toMatchObject({ title: 'Both revenue lines grew', detail: 'in FY2025; largest: B, 70% of revenue' });
    expect(lines(drivers(['A', basis('+3.0', '30.0')], ['B', basis('+5.0', '50.0')], ['C', basis('+9.0', '20.0')]))).toMatchObject({ title: 'All 3 revenue lines grew' });
    expect(lines(drivers(['A', basis('+3.0', '30.0')], ['B', basis('+1.0', '70.0')]))).toBeUndefined();
    expect(lines(drivers(['A', basis('+3.0', '30.0')]))).toBeUndefined();
  });

  it('lines from an older year than the latest annual report are dropped', () => {
    const p = drivers(['A', basis('-9.0', '30.0')]);
    expect(lines({ ...p, drivers: p.drivers.map((d) => ({ ...d, periods: ['FY2023', 'FY2024'] })) })).toBeUndefined();
  });

  it('driver change and share are read from the builder’s basis line (contract pinned in packages/rag), sign kept', () => {
    expect(BUILT.AAPL.drivers.map((d) => [d.label, driverFigures(d.changeBasis)])).toEqual([
      ['Americas', { pct: 6.8, share: 42.9 }],
      ['Europe', { pct: 9.6, share: 26.7 }],
      ['Japan', { pct: 14.6, share: 6.9 }],
      ['Rest of Asia Pacific', { pct: 9.9, share: 8.1 }],
      ['Greater China', { pct: -3.8, share: 15.5 }],
    ]);
    expect(driverFigures('-$216 million in FY2024 to -$188 million in FY2025 (no prior-year value); -0.2% of revenue in FY2025.')).toEqual({ pct: null, share: -0.2 });
  });
});

describe('derived figures agree with the builder’s own basis lines', () => {
  /** Every basis must read back; a line that does not fails here, loudly, instead of being skipped. */
  function crossCheck(p: CompanyIntelligenceProfile, where: string) {
    for (const t of p.trends) {
      const b = parseTrendBasis(t.basis);
      expect(b, `${where} ${t.metric}: basis does not parse: ${t.basis}`).not.toBeNull();
      expect(b!.trajectory, `${where} ${t.metric}`).toBe(t.trajectory);
      const rt = readTrend(p, t.metric)!;
      if (b!.kind === 'growth' && ['Revenue', 'Operating income', 'Net income', 'Operating cash flow'].includes(t.metric)) {
        const s = comparableSeries(p, t.metric, rt);
        const [prior, latest] = [s.at(-2), s.at(-1)];
        if (prior && latest?.period === b!.period) expect(pctChange(prior.value, latest.value), `${where} ${t.metric}`).toBeCloseTo(b!.pct, 1);
      }
      if (b!.kind === 'margin' && MARGINS[t.metric]) {
        const s = comparableMarginSeries(p, MARGINS[t.metric]![0], rt);
        const [prior, latest] = [s.at(-2), s.at(-1)];
        if (prior && latest?.period === b!.period && prior.period === b!.priorPeriod) {
          expect(latest.value, `${where} ${t.metric}`).toBeCloseTo(b!.latest, 1);
          expect(prior.value, `${where} ${t.metric}`).toBeCloseTo(b!.prior, 1);
        }
      }
    }
  }
  for (const p of PROFILES) it(`${p.ticker}: every trend basis reads back, and comparable facts reproduce it`, () => crossCheck(p, p.ticker));
  it.skipIf(LOCAL.length === 0)('every company in every local profile set', () => {
    for (const { set, p } of LOCAL) crossCheck(p, `${set}/${p.ticker}`);
    expect(LOCAL.length).toBeGreaterThan(50);
  });
});

describe('comparable values only (sparklines and changes; DD-17)', () => {
  it('excludes a mismatched (restated) fact, another table row, and a gap in the years', () => {
    const rev = BUILT.AAPL.facts.filter((f) => f.metric === 'Revenue' && /^FY\d{4}$/.test(f.period));
    const t = readTrend(BUILT.AAPL, 'Revenue')!;
    expect(comparableSeries(BUILT.AAPL, 'Revenue', t).map((x) => x.period)).toEqual(['FY2023', 'FY2024', 'FY2025']);
    const mark = (period: string, patch: Partial<(typeof rev)[number]>) => ({ ...BUILT.AAPL, facts: BUILT.AAPL.facts.map((f) => (f.metric === 'Revenue' && f.period === period ? { ...f, ...patch } : f)) });
    expect(comparableSeries(mark('FY2024', { crossCheck: 'mismatch' }), 'Revenue', t).map((x) => x.period)).toEqual(['FY2025']);
    expect(comparableSeries(mark('FY2023', { crossCheck: 'mismatch' }), 'Revenue', t).map((x) => x.period)).toEqual(['FY2024', 'FY2025']);
    expect(comparableSeries(mark('FY2023', { rawRow: 'another row' }), 'Revenue', t).map((x) => x.period)).toEqual(['FY2024', 'FY2025']);
    // Facts outside the trend's own passages (an older filing) never join the series.
    expect(rev.some((f) => !t.chunkIds.includes(f.chunkId))).toBe(true);
  });

  it.skipIf(!local('llm-v3', 'JNJ'))('JNJ: the restated FY2021–FY2022 revenue (Kenvue) never makes a fake −4.7% point', () => {
    const jnj = local('llm-v3', 'JNJ')!;
    const ch = rowChange(jnj, 'Revenue')!;
    expect(ch.series.map((x) => x.period)).toEqual(['FY2023', 'FY2024', 'FY2025']);
    const growth = rowChange(jnj, 'Revenue growth')!.series;
    expect(growth.map((x) => x.period)).toEqual(['FY2024', 'FY2025']);
    expect(growth.every((g) => g.value > 0)).toBe(true);
  });

  // M2: no trend, no chip and no sparkline.
  it('a metric the builder did not label shows no change chip and no sparkline', () => {
    const p = withoutTrend(BUILT.AAPL, 'Gross margin');
    expect(p.facts.some((f) => f.metric === 'Gross profit')).toBe(true);
    expect(rowChange(p, 'Gross margin')).toBeNull();
    for (const m of ['Debt', 'Capital spending', 'Cash and liquidity']) expect(rowChange(BUILT.AAPL, m), m).toBeNull();
    renderDashboard(p);
    const row = within(screen.getByRole('table', { name: /performance/ })).getByRole('rowheader', { name: 'Gross margin' }).closest('tr')!;
    expect(row).toHaveTextContent('Not extracted');
    expect(row).not.toHaveTextContent(/pp/);
    expect(within(row).queryByRole('img')).toBeNull();
  });

  it.skipIf(!local('llm-v3', 'WMT'))('WMT: Gross margin is “Not extracted”, with no change chip beside it', () => {
    expect(rowChange(local('llm-v3', 'WMT')!, 'Gross margin')).toBeNull();
  });
});

describe('direction and display rules (DD-21 b)', () => {
  it('debt and capital spending never take a colour; not extracted is none', () => {
    expect(trajectoryDirection('growing', 'Debt')).toBe('flat');
    expect(trajectoryDirection('declining', 'Capital spending')).toBe('flat');
    expect(trajectoryDirection('growing', 'Revenue')).toBe('up');
    expect(trajectoryDirection('slowing', 'Revenue')).toBe('slowing');
    expect(trajectoryDirection('not_extracted', 'Revenue')).toBe('none');
  });

  it('a financial company’s operating cash flow keeps its arrow without a colour', () => {
    const basis = 'Growth of -12.0% in FY2025, after 4.0% in FY2024 (declining: below -2.0%).';
    const bank = withTrend({ ...BUILT.JPM, sector: 'Financials' }, 'Operating cash flow', basis);
    expect(bottomLine(bank).find((b) => b.key === 'cash')).toMatchObject({ direction: 'down', neutral: true });
    expect(rowChange(bank, 'Operating cash flow')).toMatchObject({ direction: 'down', neutral: true });
    const other = withTrend({ ...BUILT.AAPL }, 'Operating cash flow', basis);
    expect(bottomLine(other).find((b) => b.key === 'cash')).toMatchObject({ direction: 'down', neutral: false });
  });

  it('a value that rounds to zero has no sign; a rounded value never contradicts the label at its threshold', () => {
    expect(signedPct(-0.04)).toBe('0.0%');
    expect(signedPp(-0.0)).toBe('0.0 pp');
    expect(signedPct(-2.94)).toBe('−2.9%');
    expect(changeText('growth', -0.0, 'stable', null)).toBe('0.0%');
    expect(changeText('margin', 0.5, 'stable', null)).toBe('+0.5 pp');
    // "+1.0 pp" is never gray: Stable at a rounded 1.0 shows the exact comparable figure, or says so.
    expect(changeText('margin', 1.0, 'stable', 0.98)).toBe('+0.98 pp');
    expect(changeText('margin', -1.0, 'stable', null)).toBe('within ±1.0 pp');
    expect(changeText('margin', 1.0, 'improving', 1.02)).toBe('+1.0 pp');
    // "+2.0%" labeled Growing (or Slowing) is past the ±2% line: shown to two decimals.
    expect(changeText('growth', 2.0, 'slowing', 2.04)).toBe('+2.04%');
    expect(changeText('growth', -2.0, 'declining', null)).toBe('under −2.0%');
    expect(changeText('growth', 2.0, 'stable', 1.98)).toBe('+2.0%');
  });

  it('MSFT-style boundary: an operating margin labeled Stable at a rounded 1.0 pp is not shown as “+1.0 pp”', () => {
    const p = withTrend(BUILT.AAPL, 'Operating margin', '45.6% in FY2025 vs 44.6% in FY2024, a change of 1.0 pp (stable: threshold 1.0 pp).');
    expect(rowChange(p, 'Operating margin')!.text).not.toBe('+1.0 pp');
    expect(rowChange(p, 'Operating margin')!.direction).toBe('flat');
    expect(viewLead(p, 'Profitability')).toBe('Operating margin 45.6% in FY2025 (within ±1.0 pp)');
  });

  it('the Revenue growth chip shows the change in the growth rate, coloured only where the builder called it', () => {
    const at = (basis: string) => rowChange(withTrend(BUILT.AAPL, 'Revenue growth', basis), 'Revenue growth')!;
    expect(at('Growth of 12.0% in FY2025, after 5.0% in FY2024 (accelerating: at least 5.0 pp faster than the year before).')).toMatchObject({ text: '+7.0 pp', direction: 'up', neutral: false });
    expect(at('Growth of 3.0% in FY2025, after 12.0% in FY2024 (slowing: at least 5.0 pp slower than the year before).')).toMatchObject({ text: '−9.0 pp', direction: 'slowing', neutral: false });
    expect(at('Growth of 5.1% in FY2025, after 6.0% in FY2024 (growing: above 2.0%).')).toMatchObject({ text: '−0.9 pp', direction: 'flat', neutral: false });
    expect(at('Growth of -3.0% in FY2025, after -10.0% in FY2024 (declining: below -2.0%).')).toMatchObject({ text: '+7.0 pp', direction: 'up', neutral: true });
  });

  it('signal chips come from the signal type and its trend’s trajectory, never the headline text (slowing is amber)', () => {
    const sig = BUILT.AAPL.signals.find((s) => s.type === 'TREND_CHANGE')!;
    const declining = '24.0% in FY2025 vs 26.9% in FY2024, a change of -2.9 pp (declining: threshold 1.0 pp).';
    // The headline says "improved"; the measurement says declining: the chip follows the measurement.
    expect(signalDirection({ ...sig, headline: 'Net margin improved', measurement: declining }, BUILT.AAPL)).toEqual({ direction: 'down', neutral: false });
    const slowing = withTrend(BUILT.AAPL, 'Operating income', 'Growth of 3.0% in FY2025, after 12.0% in FY2024 (slowing: at least 5.0 pp slower than the year before).');
    const sSlow = { ...sig, headline: 'Operating income growth fell', measurement: slowing.trends.find((t) => t.metric === 'Operating income')!.basis };
    expect(signalDirection(sSlow, slowing)).toEqual({ direction: 'slowing', neutral: false });
    expect(signalDirection({ ...sig, type: 'PERSISTENT' }, BUILT.AAPL).direction).toBe('repeat');
    expect(signalDirection({ ...sig, type: 'NEW' }, BUILT.AAPL).direction).toBe('new');
    expect(signalDirection({ ...sig, type: 'REDUCED' }, BUILT.AAPL)).toEqual({ direction: 'down', neutral: true });
    expect(signalDirection({ ...sig, type: 'OUTLOOK_CHANGE' }, BUILT.AAPL).direction).toBe('info');
    expect(signalDirection({ ...sig, measurement: 'unreadable' }, BUILT.AAPL).direction).toBe('info');
  });

  it('30-second-view labels map to chips; “Not extracted”, “Limited history” and “Limited evidence” get the none style', () => {
    expect(['Growing', 'Stable', 'Declining', 'Slowing', 'Persistent', 'Deep coverage', 'New or expanded', 'Not extracted', 'Limited history', 'Limited evidence'].map(viewDirection)).toEqual([
      'up',
      'flat',
      'down',
      'slowing',
      'repeat',
      'info',
      'new',
      'none',
      'none',
      'none',
    ]);
    const p = { ...BUILT.JPM, executiveView: BUILT.JPM.executiveView.map((e, i) => (i === 0 ? { ...e, label: 'Not extracted' } : e)) };
    renderDashboard(p);
    const chips = screen.getAllByText('Not extracted', { selector: '[data-direction]' });
    expect(chips.length).toBeGreaterThan(0);
    for (const c of chips) expect(c).toHaveAttribute('data-direction', 'none');
  });

  it('lead lines name their period and come from the builder’s basis lines', () => {
    expect(DIMENSIONS.map((d) => viewLead(BUILT.AAPL, d))).toEqual([
      'Revenue +6.4% in FY2025, after +2.0% in FY2024',
      'Operating margin 32.0% in FY2025 (+0.5 pp)',
      'Revenue +15.7% in FY2026Q1 vs FY2025Q1',
      'Operating cash flow −5.7% in FY2025, to $111.5B',
      '6 risk areas in every annual report, FY2022–FY2025',
      '4 annual + 12 quarterly reports',
    ]);
    expect(viewLead(BUILT.AAPL, 'Something else')).toBeNull();
  });
});

/*
 * The page never contradicts itself (adversary H2/H7): for every company, the bottom line, the
 * 30-second card, the performance table and the signal chips all read the same builder label.
 */
describe('label agreement across the page', () => {
  const REVENUE_TITLE: Record<string, string> = {
    declining: 'Revenue fell',
    stable: 'Revenue about flat',
    accelerating: 'Revenue growth picked up',
    slowing: 'Revenue growth slowed',
    growing: 'Revenue grew',
  };
  const CARD: Record<string, string> = { Performance: 'Revenue growth', Profitability: 'Operating margin', 'Latest quarter': 'Quarterly revenue growth', 'Cash generation': 'Operating cash flow' };

  function disagreements(p: CompanyIntelligenceProfile): string[] {
    const out: string[] = [];
    const lines = bottomLine(p);
    const rev = p.trends.find((t) => t.metric === 'Revenue');
    const revLine = lines.find((b) => b.key === 'revenue');
    const card = p.executiveView.find((e) => e.dimension === 'Performance');
    if (revLine) {
      if (!rev) out.push('revenue line without a Revenue trend');
      else {
        if (revLine.title !== REVENUE_TITLE[rev.trajectory]) out.push(`title ${revLine.title} vs ${rev.trajectory}`);
        if (revLine.direction !== trajectoryDirection(rev.trajectory)) out.push(`revenue direction ${revLine.direction} vs ${rev.trajectory}`);
        if (card && viewDirection(card.label) !== revLine.direction) out.push(`card ${card.label} vs line ${revLine.direction}`);
        if (rowChange(p, 'Revenue')?.direction !== revLine.direction) out.push(`table ${rowChange(p, 'Revenue')?.direction} vs line ${revLine.direction}`);
      }
    }
    for (const [key, metric] of [
      ['profit', 'Net margin'],
      ['cash', 'Operating cash flow'],
    ] as const) {
      const line = lines.find((b) => b.key === key);
      const t = p.trends.find((x) => x.metric === metric);
      if (line && (!t || line.direction !== trajectoryDirection(t.trajectory))) out.push(`${key} ${line.direction} vs ${t?.trajectory}`);
    }
    for (const [dimension, metric] of Object.entries(CARD)) {
      const e = p.executiveView.find((x) => x.dimension === dimension);
      const t = p.trends.find((x) => x.metric === metric);
      if (e && t && viewDirection(e.label) !== trajectoryDirection(t.trajectory)) out.push(`${dimension} card ${e.label} vs ${t.trajectory}`);
    }
    for (const t of p.trends) {
      const ch = rowChange(p, t.metric);
      if (ch && t.metric !== 'Revenue growth' && ch.direction !== trajectoryDirection(t.trajectory, t.metric)) out.push(`${t.metric} chip ${ch.direction} vs ${t.trajectory}`);
    }
    for (const s of p.signals.filter((x) => x.type === 'TREND_CHANGE')) {
      const t = p.trends.find((x) => x.basis === s.measurement);
      if (!t) out.push(`signal ${s.signalId} has no matching trend`);
      else if (signalDirection(s, p).direction !== trajectoryDirection(t.trajectory, t.metric)) out.push(`signal ${s.signalId} vs ${t.trajectory}`);
    }
    const text = [...lines.flatMap((b) => [b.title, b.detail]), ...DIMENSIONS.flatMap((d) => viewLead(p, d) ?? []), ...p.trends.flatMap((t) => rowChange(p, t.metric)?.text ?? [])].join(' | ');
    if (/[+−-]0\.0(?!\d)/.test(text)) out.push(`signed zero: ${text}`);
    for (const b of lines) {
      if (b.key !== 'risks' && !/FY\d{4}/.test(b.detail)) out.push(`no period: ${b.title}`);
      for (const fy of b.detail.match(/FY\d{4}(?!Q)/g) ?? []) if (b.key !== 'risks' && fy > latestFiscalYear(p)!) out.push(`future period ${fy}`);
    }
    return out;
  }

  for (const p of PROFILES) it(`${p.ticker} agrees with itself`, () => expect(disagreements(p)).toEqual([]));

  it.skipIf(LOCAL.length === 0)('every company in every local profile set agrees with itself', () => {
    const all = LOCAL.flatMap(({ set, p }) => disagreements(p).map((d) => `${set}/${p.ticker}: ${d}`));
    expect(all).toEqual([]);
    expect(LOCAL.length).toBeGreaterThan(50);
  });
});

describe('vocabulary (DD-16) over every fixed-rule string', () => {
  const strings = (p: CompanyIntelligenceProfile) => [
    ...bottomLine(p).flatMap((b) => [b.title, b.detail]),
    ...DIMENSIONS.flatMap((d) => viewLead(p, d) ?? []),
    ...LEGEND.map((l) => l.text),
    ...Object.values(DIRECTION_WORD),
  ];
  it('the committed built profiles, the preview profiles, the legend and the glossary have no banned phrase', () => {
    for (const p of [...PROFILES, ...FIXTURE_PROFILES.values()]) expect(findBannedPhrases(strings(p).join(' \n '))).toEqual([]);
    expect(findBannedPhrases(Object.values(GLOSSARY).join(' \n '))).toEqual([]);
    for (const [k, v] of Object.entries(GLOSSARY)) expect(findBannedPhrases(v), k).toEqual([]);
  });

  it.skipIf(LOCAL.length === 0)('every company in every local profile set', () => {
    for (const { set, p } of LOCAL) expect(findBannedPhrases(strings(p).join(' \n ')), `${set}/${p.ticker}`).toEqual([]);
  });
});

describe('progressive disclosure (DD-21 c)', () => {
  it('ShowMore keeps every item in the DOM, folds the rest with `hidden`, and moves focus to the first revealed item', async () => {
    render(<ShowMore items={['a', 'b', 'c', 'd']} initial={2} noun={['item', 'items']} render={(x) => <li key={x}>{x}</li>} />);
    expect(screen.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['a', 'b']);
    expect(document.querySelectorAll('li')).toHaveLength(4);
    expect([...document.querySelectorAll('li[hidden]')].map((l) => l.textContent)).toEqual(['c', 'd']);
    const toggle = screen.getByRole('button', { name: 'Show all 4 items' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).not.toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    await waitFor(() => expect(screen.getByText('c')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer items' }));
    expect(document.querySelectorAll('li[hidden]')).toHaveLength(2);
  });

  it('ShowMore with nothing folded renders no toggle and hides nothing', () => {
    render(<ShowMore items={['a']} initial={2} noun={['item', 'items']} render={(x) => <li key={x}>{x}</li>} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.querySelectorAll('[hidden]')).toHaveLength(0);
  });

  it('Clamp: More only for long text, citations outside the clamp, aria-controls and a distinct name per toggle', () => {
    const long = `Alpha beta gamma delta epsilon zeta ${'x'.repeat(200)}`;
    const other = `Omega psi chi phi upsilon tau ${'y'.repeat(200)}`;
    const { rerender } = render(
      <>
        <Clamp text={long} after={<button type="button">View evidence</button>}>
          {long}
        </Clamp>
        <Clamp text={other}>{other}</Clamp>
      </>,
    );
    const p = screen.getByText(long);
    expect(p.className).toMatch(/line-clamp-2/);
    expect(p).not.toContainElement(screen.getByRole('button', { name: 'View evidence' }));
    const more = screen.getByRole('button', { name: 'More: Alpha beta gamma delta epsilon zeta' });
    expect(screen.getByRole('button', { name: 'More: Omega psi chi phi upsilon tau' })).toBeInTheDocument();
    expect(more).toHaveAttribute('aria-controls', p.id);
    fireEvent.click(more);
    expect(p.className).not.toMatch(/line-clamp/);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    rerender(<Clamp text="short">short</Clamp>);
    expect(screen.queryByRole('button', { name: /More|Less/ })).toBeNull();
  });
});

describe('dashboard: bottom line, legend, chips and jump bar on a real profile', () => {
  it('AAPL: the bottom line links to its sections; its icons read as words; the legend covers every symbol', () => {
    renderDashboard(BUILT.AAPL);
    const bottom = screen.getByRole('heading', { name: 'Bottom line' }).closest('section')!;
    expect(within(bottom).getByRole('link', { name: 'Greater China declined' })).toHaveAttribute('href', '#drivers');
    const words = new Set(Object.values(DIRECTION_WORD));
    const sr = [...bottom.querySelector('ul')!.querySelectorAll(':scope > li > [data-direction] .sr-only')].map((e) => e.textContent!);
    expect(sr.length).toBe(bottomLine(BUILT.AAPL).length);
    for (const s of sr) expect(words.has(s.split(',')[0]!), s).toBe(true);
    const legend = within(bottom).getByRole('list', { name: 'Legend' });
    const used = new Set<Direction>([...PROFILES, ...LOCAL.map((x) => x.p)].flatMap((p) => bottomLine(p).map((b) => b.direction)));
    for (const d of used) expect(LEGEND.some((l) => l.direction === d), d).toBe(true);
    for (const l of LEGEND) expect(legend).toHaveTextContent(l.text);
    // The neutral (no colour) arrow is explained too.
    expect(legend).toHaveTextContent('neither direction is better');
    // "net margin" in the bottom line is a glossary term.
    expect(within(bottom).getByText('net margin')).toHaveAttribute('tabindex', '0');
  });

  it('AAPL: the jump bar lists every shown section with counts', () => {
    renderDashboard(BUILT.AAPL);
    const jump = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(jump).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '#bottom-line',
      '#thirty-second',
      '#performance',
      '#drivers',
      '#outlook',
      '#current-risks',
      '#whats-changed',
      '#attention',
      '#recommended',
      '#coverage',
    ]);
    for (const l of links) expect(document.getElementById(l.getAttribute('href')!.slice(1))).not.toBeNull();
    expect(within(jump).getByRole('link', { name: /Current risks/ })).toHaveTextContent(String(BUILT.AAPL.currentRisks.length));
  });

  it('the phone menu starts on a neutral placeholder and jumps even when the section picked is the one in view', () => {
    renderDashboard(BUILT.AAPL);
    const select = within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('combobox', { name: 'Jump to section' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(select.options[0]!.textContent).toMatch(/Choose a section|In view/);
    const scroll = vi.fn();
    document.getElementById('performance')!.scrollIntoView = scroll;
    fireEvent.change(select, { target: { value: 'performance' } });
    fireEvent.change(select, { target: { value: 'performance' } });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(select.value).toBe('');
  });

  it('JPM: no drivers and no outlook means neither the sections nor their links', () => {
    const p = { ...BUILT.JPM, managementOutlook: null };
    renderDashboard(p);
    expect(screen.queryByRole('heading', { name: 'What is driving performance' })).toBeNull();
    expect(screen.queryByText('Placeholder, not filing data')).toBeNull();
    const hrefs = within(screen.getByRole('navigation', { name: 'On this page' }))
      .getAllByRole('link')
      .map((l) => l.getAttribute('href'));
    expect(hrefs).not.toContain('#drivers');
    expect(hrefs).not.toContain('#outlook');
  });

  it('marks the section whose heading was last passed as the current location', async () => {
    renderDashboard(BUILT.AAPL);
    // jsdom lays nothing out: give the page a height so the "scrolled to the bottom" rule stays off.
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 10_000 });
    const top = (id: string) => ({ attention: 120, coverage: 900, recommended: 600 })[id as 'attention'] ?? -500;
    for (const el of document.querySelectorAll('h2[id]')) {
      (el as HTMLElement).getBoundingClientRect = () => ({ top: top(el.id) }) as DOMRect;
    }
    fireEvent.scroll(window);
    const jump = screen.getByRole('navigation', { name: 'On this page' });
    await waitFor(() => expect(within(jump).getByRole('link', { name: /Attention signals/ })).toHaveAttribute('aria-current', 'location'));
    expect(within(jump).getAllByRole('link', { current: 'location' })).toHaveLength(1);
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
  });

  it('the performance table reads the builder: revenue coloured, margins with their formula, net margin shown, debt with no chip', () => {
    renderDashboard(BUILT.AAPL);
    const table = screen.getByRole('table', { name: /performance/ });
    const row = (name: string) => within(table).getByRole('rowheader', { name }).closest('tr')!;
    expect(within(row('Revenue')).getByText('+6.4%').closest('[data-direction]')).toHaveAttribute('data-direction', 'up');
    expect(row('Gross margin')).toHaveTextContent('46.9% · FY2025');
    expect(row('Gross margin')).toHaveTextContent('Gross profit ÷ Revenue');
    expect(row('Net margin')).toHaveTextContent('26.9% · FY2025');
    expect(within(row('Net margin')).getByText('+2.9 pp').closest('[data-direction]')).toHaveAttribute('data-direction', 'up');
    expect(row('Revenue growth')).toHaveTextContent('+6.4% · FY2025');
    expect(row('Debt')).not.toHaveTextContent(/[+−]\d/);
  });

  it('every derived figure in the table equals the builder’s basis', () => {
    renderDashboard(BUILT.TSLA);
    const table = screen.getByRole('table', { name: /performance/ });
    for (const t of BUILT.TSLA.trends) {
      const ch = rowChange(BUILT.TSLA, t.metric);
      if (!ch) continue;
      const row = within(table).queryByRole('rowheader', { name: t.metric })?.closest('tr');
      if (row) expect(row, t.metric).toHaveTextContent(ch.text);
    }
  });

  it('a glossary term shows its definition on keyboard focus; the new terms are defined', async () => {
    renderDashboard(BUILT.AAPL);
    const term = within(screen.getByRole('table', { name: /performance/ })).getByText('Operating cash flow');
    term.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(GLOSSARY['Operating cash flow']!);
    for (const k of ['Net margin', 'Annual report', 'Quarterly report', 'pp']) expect(GLOSSARY[k], k).toBeTruthy();
  });

  it('a preview (fixture) profile renders no computed figure: no bottom line, lead line, change chip or sparkline', () => {
    const p = FIXTURE_PROFILES.get('AAPL')!;
    renderDashboard(p);
    expect(screen.queryByRole('heading', { name: 'Bottom line' })).toBeNull();
    const table = screen.getByRole('table', { name: /performance/ });
    expect(within(table).queryAllByRole('img')).toHaveLength(0);
    expect(document.querySelectorAll('[data-direction="up"], [data-direction="down"], [data-direction="slowing"]')).toHaveLength(0);
  });
});

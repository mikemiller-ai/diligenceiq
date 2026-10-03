import { composeCompare, findBannedPhrases, parseTrendBasis, type CompanyIntelligenceProfile, type CompareResult } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { isCurrent, latestAmount, level, money, readTrend, rowChange } from '@/components/intelligence/signals';
import { BUILT } from '@/test/built-profiles';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';
import { BOTTOM_LINE_METRICS, compareBottomLine, latestValue, lineLegend, operatingLoss, oppositeNote, priorGrowth, riskGrid, trendRead, type CompareLine } from './compare-summary';

/*
 * The refined Compare (DD-21 h): every bottom-line line and grid cell equals a computation over the
 * stored profiles (the committed llm-v3 test set: AAPL, MSFT, NVDA, TSLA, JPM, PFE).
 */

const profiles = new Map<string, CompanyIntelligenceProfile>(Object.values(BUILT).map((p) => [p.ticker, p]));
function compare(tickers: string[]): CompareResult {
  const out = composeCompare(tickers, profiles);
  if (!out.ok) throw new Error('compare failed');
  return out.result;
}
const lines = (tickers: string[]) => compareBottomLine(compare(tickers), profiles, false);
const line = (tickers: string[], key: string) => lines(tickers).find((l) => l.key === key);

describe('Compare bottom line: AAPL, MSFT, NVDA (the mockup’s companies)', () => {
  const ls = lines(['AAPL', 'MSFT', 'NVDA']);

  it('has the five lines in the fixed order', () => {
    expect(ls.map((l) => l.key)).toEqual(['Revenue', 'Operating margin', 'Operating cash flow', 'shared', 'distinctive']);
  });

  it('revenue grew at all three (NVIDIA slowing still counts as growth), largest by the builder’s figure', () => {
    const l = ls[0]!;
    expect(l.title).toBe('Revenue grew at all three');
    expect(l.direction).toBe('up');
    expect(l.detail).toBe('largest at NVIDIA, +114.2% in FY2025, slowing from +125.9% in FY2024');
    expect(l.neutral).toBe(false);
  });

  it('the one company whose margin moved leads, with the levels from the basis lines', () => {
    const l = ls[1]!;
    expect(l.title).toBe('NVIDIA’s operating margin widened 8.3 pp');
    expect(l.detail).toBe('to 62.4% in FY2025; Apple (32.0%) and Microsoft (45.6%) about the same');
    // One company differs: its arrow, no direction colour (the companies do not share a direction).
    expect(l.direction).toBe('up');
    expect(l.neutral).toBe(true);
    expect(l.chipText).toBe('increased at one company only');
  });

  it('the one company whose cash flow fell leads; the others are described by class', () => {
    const l = ls[2]!;
    expect(l.title).toBe('Apple’s operating cash flow fell 5.7%');
    expect(l.detail).toBe('in FY2025; Microsoft and NVIDIA still growing, more slowly');
    expect(l.direction).toBe('down');
    expect(l.neutral).toBe(true);
    expect(l.opposite).toEqual({ rising: ['Microsoft', 'NVIDIA'], falling: ['Apple'] });
  });

  it('the footer agrees with the lines: slowing counts as still rising, so cash flow points in opposite directions', () => {
    // Core's Diverging rule excludes slowing, so core reports nothing here; the footer follows the bottom line.
    expect(compare(['AAPL', 'MSFT', 'NVDA']).diverging).toEqual([]);
    expect(oppositeNote(ls)).toBe('Opposite directions: Operating cash flow (rising at Microsoft and NVIDIA, falling at Apple).');
  });

  it('the risk lines come from core composeCompare as is', () => {
    const r = compare(['AAPL', 'MSFT', 'NVDA']);
    expect(ls[3]!.title).toBe(`${r.common.length} risk areas shared by all three`);
    expect(ls[3]!.detail).toBe(r.common.map((t) => t.label).join(', '));
    expect(r.distinctive.every((t) => t.tickers[0] === 'NVDA')).toBe(true);
    expect(ls[4]!.title).toBe(`${r.distinctive.length} areas only at NVIDIA`);
    expect(ls[4]!.detail).toBe(r.distinctive.map((t) => t.label).join(', '));
  });
});

describe('Compare bottom line: rules', () => {
  it('a stale trend is never folded into “all”: it is named as not compared, with its year', () => {
    // PFE's operating cash flow basis is FY2022; its latest annual report is FY2024.
    const pfe = readTrend(BUILT.PFE, 'Operating cash flow')!;
    expect(isCurrent(BUILT.PFE, pfe.basis.period)).toBe(false);
    const l = line(['AAPL', 'MSFT', 'PFE'], 'Operating cash flow')!;
    expect(l.title).not.toMatch(/all three/);
    expect(l.detail).toContain(`Pfizer (latest trend ${pfe.basis.period})`);
    expect(l.title).toContain('Apple');
    expect(l.title).toContain('Microsoft');
  });

  it('a metric with fewer than two companies read gets no line', () => {
    // JPM and PFE have no operating margin trend; TSLA alone is not a comparison.
    expect(line(['TSLA', 'JPM', 'PFE'], 'Operating margin')).toBeUndefined();
  });

  it('two companies in different directions: the directions by company, uncoloured', () => {
    const l = line(['AAPL', 'TSLA'], 'Revenue')!;
    expect(l.title).toBe('Revenue grew at Apple; fell at Tesla');
    expect(l.neutral).toBe(true);
    // Core reports revenue as diverging for these two: the line links to that section.
    expect(compare(['AAPL', 'TSLA']).diverging.map((d) => d.metric)).toContain('Revenue');
    expect(l.anchor).toBe('diverging');
  });

  it('a Financials company’s operating cash flow keeps its arrow but no colour', () => {
    // JPM has no operating cash flow trend: it is named as not compared, never counted.
    expect(line(['AAPL', 'MSFT', 'NVDA', 'TSLA', 'JPM'], 'Operating cash flow')!.detail).toContain('not compared: JPMorgan Chase (not extracted)');
    // A stored profile with only its sector changed: its cash flow line is uncoloured, the other metrics are not.
    const bank = new Map(profiles).set('MSFT', { ...BUILT.MSFT, sector: 'Financials' });
    const out = composeCompare(['MSFT', 'NVDA'], bank);
    if (!out.ok) throw new Error('compare failed');
    const ls = compareBottomLine(out.result, bank, false);
    expect(ls.find((l) => l.key === 'Operating cash flow')).toMatchObject({ title: 'Operating cash flow growth slowed at both', neutral: true });
    expect(ls.find((l) => l.key === 'Operating cash flow')!.chipText).toBe('slowing, neither direction is better');
    expect(ls.find((l) => l.key === 'Revenue')!.neutral).toBe(false);
  });

  it('every figure in every line is the builder’s: a change text, a margin level or a basis number', () => {
    const sets = [
      ['AAPL', 'MSFT', 'NVDA'],
      ['AAPL', 'TSLA'],
      ['AAPL', 'MSFT', 'PFE'],
      ['MSFT', 'NVDA', 'TSLA', 'JPM', 'PFE'],
      ['AAPL', 'JPM'],
    ];
    for (const tickers of sets) {
      const allowed = new Set<string>();
      for (const t of tickers) {
        const p = profiles.get(t)!;
        for (const m of BOTTOM_LINE_METRICS) {
          const c = rowChange(p, m);
          if (c) allowed.add(c.text.replace(/^[+−]/, ''));
          const b = readTrend(p, m)?.basis;
          if (b?.kind === 'margin') allowed.add(level(b.latest));
          if (b?.kind === 'growth') allowed.add(`${Math.abs(b.pct).toFixed(1)}%`);
          if (b?.kind === 'growth' && b.priorPct !== null) allowed.add(`${Math.abs(b.priorPct).toFixed(1)}%`);
        }
      }
      for (const l of lines(tickers)) {
        const figures = `${l.title} ${l.detail}`.match(/\d+(?:\.\d+)?(?:%| pp)/g) ?? [];
        for (const f of figures) expect(allowed, `${tickers.join(',')} ${l.key}: ${f}`).toContain(f);
        // Every number in a line is one of these figures or a fiscal year; nothing else is stated.
        const rest = `${l.title} ${l.detail}`.replace(/\d+(?:\.\d+)?(?:%| pp)/g, '').replace(/FY\d{4}/g, '').replace(/^\d+ (?:risk )?areas?/, '');
        if (l.anchor !== 'risk-areas') expect(rest, `${tickers.join(',')} ${l.key}`).not.toMatch(/\d/);
      }
    }
  });

  it('every line names a period, and every fixed-rule string passes the DD-16 vocabulary check', () => {
    const all = [
      ...lines(['AAPL', 'MSFT', 'NVDA']),
      ...lines(['AAPL', 'TSLA']),
      ...lines(['AAPL', 'MSFT', 'PFE']),
      ...lines(['MSFT', 'NVDA', 'TSLA', 'JPM', 'PFE']),
    ];
    for (const l of all) {
      expect(findBannedPhrases(`${l.title} ${l.detail}`)).toEqual([]);
      if (BOTTOM_LINE_METRICS.includes(l.key as (typeof BOTTOM_LINE_METRICS)[number])) expect(`${l.title} ${l.detail}`).toMatch(/FY\d{4}/);
    }
  });

  it('a preview profile compared: no risk lines', () => {
    expect(compareBottomLine(compare(['AAPL', 'MSFT', 'NVDA']), profiles, true).some((l) => l.anchor === 'risk-areas')).toBe(false);
  });
});

/*
 * Synthetic companies for the cases the committed set cannot produce (every company falling, loss
 * margins, ties): a stored profile (AAPL, latest annual report FY2025) with only its name and its
 * trends replaced, each basis written in the builder's exact format (read back by core parseTrendBasis).
 */
type Trend = CompanyIntelligenceProfile['trends'][number];
const one = (v: number) => v.toFixed(1);
const growth = (metric: string, pct: number, prior: number, trajectory: Trend['trajectory']): Trend => ({
  metric,
  trajectory,
  periods: ['FY2024', 'FY2025'],
  basis: `Growth of ${one(pct)}% in FY2025, after ${one(prior)}% in FY2024 (${trajectory}: fixed rule).`,
  chunkIds: [],
});
const margin = (latest: number, prior: number, trajectory: Trend['trajectory']): Trend => ({
  metric: 'Operating margin',
  trajectory,
  periods: ['FY2024', 'FY2025'],
  basis: `${one(latest)}% in FY2025 vs ${one(prior)}% in FY2024, a change of ${one(latest - prior)} pp (${trajectory}: threshold 1.0 pp).`,
  chunkIds: [],
});
const synth = (ticker: string, company: string, trends: Trend[], over: Partial<CompanyIntelligenceProfile> = {}): CompanyIntelligenceProfile => ({
  ...BUILT.AAPL,
  ticker,
  company,
  trends,
  ...over,
});
function linesOf(ps: CompanyIntelligenceProfile[], preview = false): CompareLine[] {
  const map = new Map(ps.map((p) => [p.ticker, p]));
  const out = composeCompare(ps.map((p) => p.ticker), map);
  if (!out.ok) throw new Error('compare failed');
  return compareBottomLine(out.result, map, preview);
}
const lineOf = (ps: CompanyIntelligenceProfile[], key: string) => linesOf(ps).find((l) => l.key === key);
const rev = (pct: number, prior: number, t: Trend['trajectory']) => growth('Revenue', pct, prior, t);

describe('Compare bottom line: every rule, on synthetic basis lines', () => {
  it('every company about the same: uncoloured, each company’s change named', () => {
    const l = lineOf([synth('AAA', 'Alpha', [rev(0.5, 3.0, 'stable')]), synth('BBB', 'Beta', [rev(-1.2, 4.0, 'stable')]), synth('CCC', 'Gamma', [rev(1.9, 1.0, 'stable')])], 'Revenue')!;
    expect(l).toMatchObject({ title: 'Revenue about the same at all three', direction: 'flat', neutral: false, opposite: null });
    expect(l.detail).toBe('Alpha +0.5% in FY2025; Beta −1.2% in FY2025; Gamma +1.9% in FY2025');
  });

  it('every company falling: red, with the largest decline by the builder’s figure', () => {
    const l = lineOf([synth('AAA', 'Alpha', [rev(-4.0, 3.0, 'declining')]), synth('BBB', 'Beta', [rev(-9.0, 4.0, 'declining')]), synth('CCC', 'Gamma', [rev(-3.0, 1.0, 'declining')])], 'Revenue')!;
    expect(l).toMatchObject({ title: 'Revenue fell at all three', detail: 'largest decline at Beta, −9.0% in FY2025', direction: 'down', neutral: false, chipText: 'decreased' });
    const m = lineOf([synth('AAA', 'Alpha', [margin(20.0, 24.0, 'declining')]), synth('BBB', 'Beta', [margin(10.0, 12.5, 'declining')])], 'Operating margin')!;
    expect(m).toMatchObject({ title: 'Operating margin narrowed at both', detail: 'largest decline at Alpha, −4.0 pp in FY2025', direction: 'down', neutral: false });
  });

  it('every company rising, the largest one slowing: the prior year is named; another slowing company is listed after', () => {
    const l = lineOf(
      [synth('AAA', 'Alpha', [rev(30.0, 50.0, 'slowing')]), synth('BBB', 'Beta', [rev(10.0, 30.0, 'slowing')]), synth('CCC', 'Gamma', [rev(12.0, 9.0, 'growing')])],
      'Revenue',
    )!;
    expect(l).toMatchObject({ title: 'Revenue grew at all three', direction: 'up', neutral: false });
    expect(l.detail).toBe('largest at Alpha, +30.0% in FY2025, slowing from +50.0% in FY2024; slowing at Beta');
    const all = lineOf([synth('AAA', 'Alpha', [rev(30.0, 50.0, 'slowing')]), synth('BBB', 'Beta', [rev(10.0, 30.0, 'slowing')])], 'Revenue')!;
    expect(all).toMatchObject({ title: 'Revenue growth slowed at both', direction: 'slowing', neutral: false });
    expect(all.detail).toBe('still growing at each; largest at Alpha, +30.0% in FY2025, slowing from +50.0% in FY2024');
  });

  it('one company differs while the others are about the same: it leads, uncoloured, with its own arrow', () => {
    const others = [synth('BBB', 'Beta', [rev(0.5, 3.0, 'stable')]), synth('CCC', 'Gamma', [rev(-1.0, 2.0, 'stable')])];
    const l = lineOf([synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), ...others], 'Revenue')!;
    expect(l).toMatchObject({ title: 'Alpha’s revenue grew 10.0%', detail: 'in FY2025; Beta and Gamma about the same', direction: 'up', neutral: true });
    expect(l.chipText).toBe('increased at one company only');
    // A lone slowing company: "grew 20.4%, more slowly than the year before", never "grew more slowly 20.4%".
    const s = lineOf([synth('AAA', 'Alpha', [rev(20.4, 40.0, 'slowing')]), ...others], 'Revenue')!;
    expect(s.title).toBe('Alpha’s revenue grew 20.4%, more slowly than the year before');
    expect(s.detail).toBe('in FY2025, after +40.0% in FY2024; Beta and Gamma about the same');
    expect(s).toMatchObject({ direction: 'slowing', neutral: true });
  });

  it('three or more in three directions: the directions by company under the distinct "directions differ" symbol', () => {
    const l = lineOf(
      [
        synth('AAA', 'Alpha', [rev(30.0, 50.0, 'slowing')]),
        synth('BBB', 'Beta', [rev(10.0, 8.0, 'growing')]),
        synth('CCC', 'Gamma', [rev(0.5, 1.0, 'stable')]),
        synth('DDD', 'Delta', [rev(-5.0, 1.0, 'declining')]),
      ],
      'Revenue',
    )!;
    expect(l.title).toBe('Revenue grew at Beta; growth slowed at Alpha; about the same at Gamma; fell at Delta');
    expect(l).toMatchObject({ direction: 'mixed', neutral: true, chipText: 'directions differ' });
    expect(l.opposite).toEqual({ rising: ['Alpha', 'Beta'], falling: ['Delta'] });
    expect(l.detail).toBe('Alpha +30.0% in FY2025; Beta +10.0% in FY2025; Gamma +0.5% in FY2025; Delta −5.0% in FY2025');
  });

  it('loss-making margins never widen or narrow: loss wording, and neutral words in a group', () => {
    // INTC's real basis line: an operating loss that narrowed.
    const intc = synth('INTX', 'Intel-like', [margin(-4.2, -22.0, 'improving')]);
    expect(intc.trends[0]!.basis).toBe('-4.2% in FY2025 vs -22.0% in FY2024, a change of 17.8 pp (improving: threshold 1.0 pp).');
    const flat = [synth('BBB', 'Beta', [margin(32.0, 31.5, 'stable')]), synth('CCC', 'Gamma', [margin(45.6, 44.8, 'stable')])];
    const lone = lineOf([intc, ...flat], 'Operating margin')!;
    expect(lone.title).toBe('Intel-like’s operating loss narrowed');
    expect(lone.detail).toBe('to −4.2% in FY2025, +17.8 pp; Beta (32.0%) and Gamma (45.6%) about the same');
    const group = lineOf([intc, synth('BBB', 'Beta', [margin(62.4, 54.1, 'improving')])], 'Operating margin')!;
    expect(group.title).toBe('Operating margin improved at both');
    expect(group.detail).toBe('largest at Intel-like, +17.8 pp in FY2025 (operating loss narrowed)');
    const mixed = lineOf([intc, flat[0]!, synth('DDD', 'Delta', [margin(-6.0, -2.0, 'declining')])], 'Operating margin')!;
    expect(mixed.title).toBe('Operating margin improved at Intel-like; about the same at Beta; declined at Delta');
    expect(mixed.detail).toContain('Delta −4.0 pp in FY2025 (operating loss widened)');
    for (const l of [lone, group, mixed]) expect(`${l.title} ${l.detail}`).not.toMatch(/margin (?:widened|narrowed)|widening|narrowing/);
    // Every loss case, as the dashboard words a net margin.
    const b = (latest: number, prior: number, t: Trend['trajectory']) => parseTrendBasis(margin(latest, prior, t).basis)!;
    expect(operatingLoss(b(5.0, -2.0, 'improving'))).toBe('swung to an operating profit');
    expect(operatingLoss(b(-1.0, 3.0, 'declining'))).toBe('swung to an operating loss');
    expect(operatingLoss(b(-6.0, -2.0, 'declining'))).toBe('operating loss widened');
    expect(operatingLoss(b(-2.0, -2.5, 'stable'))).toBe('operating loss was about the same');
    expect(operatingLoss(b(10.0, 8.0, 'improving'))).toBeNull();
    const swung = lineOf([synth('AAA', 'Alpha', [margin(5.0, -2.0, 'improving')]), ...flat], 'Operating margin')!;
    expect(swung.title).toBe('Alpha swung to an operating profit');
  });

  it('ties: by the builder’s figure, then the order the companies were chosen', () => {
    const a = synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]);
    const b = synth('BBB', 'Beta', [rev(10.0, 7.0, 'growing')]);
    const c = synth('CCC', 'Gamma', [rev(5.0, 4.0, 'growing')]);
    expect(lineOf([a, b, c], 'Revenue')!.detail).toBe('largest at Alpha, +10.0% in FY2025');
    expect(lineOf([b, a, c], 'Revenue')!.detail).toBe('largest at Beta, +10.0% in FY2025');
    expect(lineOf([c, b, a], 'Revenue')!.detail).toBe('largest at Beta, +10.0% in FY2025');
  });

  it('not compared, in the table’s own terms: preview, older year, not extracted, limited history, no labelled change', () => {
    const a = synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]);
    const b = synth('BBB', 'Beta', [rev(6.0, 5.0, 'growing')]);
    const stale = synth('OLD', 'Old', [{ ...rev(6.0, 5.0, 'growing'), basis: 'Growth of 6.0% in FY2022, after 5.0% in FY2021 (growing: fixed rule).' }]);
    const none = synth('NON', 'None', []);
    const limited = synth('LIM', 'Limited', [], { coverage: { ...BUILT.AAPL.coverage, tier: 'limited_history' } });
    const unread = synth('UNR', 'Unread', [{ ...rev(6.0, 5.0, 'growing'), trajectory: 'declining' }]);
    const preview = { ...FIXTURE_PROFILES.get('MSFT')!, ticker: 'PRV', company: 'Preview' };
    const detail = lineOf([a, b, stale, none, limited], 'Revenue')!.detail;
    expect(detail).toBe('largest at Alpha, +10.0% in FY2025; not compared: Old (latest trend FY2022), None (not extracted), Limited (limited history)');
    expect(lineOf([a, b, unread, preview], 'Revenue')!.detail).toContain('not compared: Unread (no labelled change), Preview (preview profile)');
  });

  it('colours: only a line where every company read shares one direction group is coloured', () => {
    const sets = [
      [synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), synth('BBB', 'Beta', [rev(6.0, 5.0, 'growing')])],
      [synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), synth('BBB', 'Beta', [rev(-6.0, 5.0, 'declining')])],
      [synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), synth('BBB', 'Beta', [rev(0.5, 5.0, 'stable')]), synth('CCC', 'Gamma', [rev(1.0, 5.0, 'stable')])],
    ];
    expect(sets.map((ps) => lineOf(ps, 'Revenue')!).map((l) => [l.direction, l.neutral])).toEqual([
      ['up', false],
      ['mixed', true],
      ['up', true],
    ]);
  });

  it('the footer and the legend follow the lines', () => {
    const same = linesOf([synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), synth('BBB', 'Beta', [rev(6.0, 5.0, 'growing')])], true);
    expect(oppositeNote(same)).toBe('No metric above points in opposite directions across these companies.');
    expect(lineLegend(same)).toEqual({ items: [{ direction: 'up', text: 'increased at every company' }], grey: false });
    const ls = lines(['AAPL', 'MSFT', 'NVDA']);
    const legend = lineLegend(ls);
    expect(legend.items.map((i) => i.direction)).toEqual(['up', 'info']);
    expect(legend.grey).toBe(true);
    const mixed = lineLegend(linesOf([synth('AAA', 'Alpha', [rev(10.0, 8.0, 'growing')]), synth('BBB', 'Beta', [rev(-6.0, 5.0, 'declining')])], true));
    expect(mixed).toEqual({ items: [{ direction: 'mixed', text: 'directions differ' }], grey: false });
  });

  it('every synthetic line passes the DD-16 vocabulary check', () => {
    const all = [
      ...linesOf([synth('INTX', 'Intel-like', [margin(-4.2, -22.0, 'improving'), rev(-0.5, -2.1, 'stable')]), synth('BBB', 'Beta', [margin(32.0, 31.5, 'stable'), rev(20.4, 40.0, 'slowing')])], true),
      ...linesOf([synth('AAA', 'Alpha', [rev(-4.0, 3.0, 'declining')]), synth('BBB', 'Beta', [rev(-9.0, 4.0, 'declining')])], true),
    ];
    for (const l of all) expect(findBannedPhrases(`${l.title} ${l.detail} ${l.chipText}`)).toEqual([]);
  });
});

describe('Side-by-side cells', () => {
  it('the latest value is the margin level from the basis or the amount from the trend’s own row, only for the basis year', () => {
    for (const p of Object.values(BUILT)) {
      for (const m of ['Revenue', 'Operating margin', 'Operating income', 'Operating cash flow']) {
        const t = p.trends.find((x) => x.metric === m);
        if (!t) continue;
        const read = trendRead(p, m, t.trajectory);
        if (read.kind !== 'chip') continue;
        const b = parseTrendBasis(t.basis)!;
        const expected = b.kind === 'margin' ? level(b.latest) : (() => {
          const a = latestAmount(p, m, read.trend);
          return a === null ? null : money(a);
        })();
        expect(latestValue(p, read), `${p.ticker} ${m}`).toBe(expected);
      }
    }
    const nvda = trendRead(BUILT.NVDA, 'Revenue', 'slowing');
    expect(nvda.kind === 'chip' && latestValue(BUILT.NVDA, nvda)).toBe('$130.5B');
    expect(nvda.kind === 'chip' && priorGrowth(nvda)).toBe('after +125.9% in FY2024');
    const aapl = trendRead(BUILT.AAPL, 'Revenue', 'growing');
    // A plain Growing trend does not need its prior year to explain the label.
    expect(aapl.kind === 'chip' && priorGrowth(aapl)).toBeNull();
  });
});

describe('Risk-area grid', () => {
  it('one row per attention-ranking area, in its order; each cell is that company’s headings and signals in the area', () => {
    const r = compare(['AAPL', 'MSFT', 'NVDA']);
    const grid = riskGrid(r, profiles);
    expect(grid.map((g) => g.category)).toEqual(r.attentionRanking.map((a) => a.category));
    for (const row of grid) {
      const rank = r.attentionRanking.find((a) => a.category === row.category)!;
      row.cells.forEach((cell, i) => {
        const t = r.companies[i]!.ticker;
        const p = profiles.get(t)!;
        if (!rank.tickers.includes(t)) return expect(cell).toBeNull();
        expect(cell!.headings.map((h) => h.heading)).toEqual(p.currentRisks.filter((x) => x.category === row.category).map((x) => x.heading));
        expect(cell!.signals).toHaveLength(p.signals.filter((s) => s.category === row.category).length);
      });
      // The per-company signal counts add up to core's.
      expect(row.cells.reduce((n, c) => n + (c?.signals.length ?? 0), 0)).toBe(rank.signalCount);
      // Every citation the old lists showed for the area is in some cell.
      expect(new Set(row.cells.flatMap((c) => c?.citationIds ?? []))).toEqual(new Set(rank.citationIds));
    }
    expect(grid[0]!.share).toBe('All three');
    const only = grid.find((g) => g.cells.filter(Boolean).length === 1)!;
    expect(only.share).toMatch(/^Only [A-Z]+$/);
  });
});

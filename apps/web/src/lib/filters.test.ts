import type { Finding } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, activeFilterCount, filterFindings, groupByTheme, groupFindings, localDay } from './findings-filter';

const finding = (id: string, over: Partial<Finding>): Finding => ({
  findingId: id,
  title: id,
  text: id,
  theme: 'risk-factors',
  tickers: ['AAPL'],
  citations: [],
  origin: { kind: 'intelligence', source: { kind: 'currentRisk', ticker: 'AAPL', ref: 'risk-1' } },
  status: 'ACTIVE',
  pinnedToIC: false,
  isKey: false,
  createdAt: '2026-09-28T10:00:00Z',
  updatedAt: '2026-09-28T10:00:00Z',
  ...over,
});

const FINDINGS: Finding[] = [
  finding('a', {}),
  finding('b', { theme: 'regulatory-compliance', tickers: ['NVDA'], status: 'NEEDS_FOLLOW_UP', createdAt: '2026-09-29T10:00:00Z' }),
  finding('c', {
    theme: 'financial-performance',
    tickers: ['MSFT', 'GOOG'],
    analysisId: 'an-02',
    origin: { kind: 'analysis', source: { kind: 'keyFinding', analysisId: 'an-02', index: 0 } },
    createdAt: '2026-09-25T10:00:00Z',
  }),
  finding('d', {
    origin: { kind: 'compare', source: { kind: 'compareRow', tickers: ['AAPL', 'MSFT'], ref: 'theme-competition' } },
    createdAt: '2026-09-30T10:00:00Z',
  }),
];

describe('findings filters', () => {
  it('returns everything with no filters', () => {
    expect(filterFindings(FINDINGS, EMPTY_FILTERS)).toHaveLength(4);
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it('combines theme, company, status, origin, analysis, and date filters', () => {
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, theme: 'risk-factors' }).map((f) => f.findingId)).toEqual(['a', 'd']);
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, ticker: 'NVDA', status: 'NEEDS_FOLLOW_UP' }).map((f) => f.findingId)).toEqual(['b']);
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, origin: 'compare' }).map((f) => f.findingId)).toEqual(['d']);
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, analysisId: 'an-02' }).map((f) => f.findingId)).toEqual(['c']);
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, from: '2026-09-28', to: '2026-09-29' }, (iso) => localDay(iso, 0)).map((f) => f.findingId)).toEqual(['a', 'b']);
    expect(activeFilterCount({ ...EMPTY_FILTERS, ticker: 'X', origin: 'analysis' })).toBe(2);
  });

  it('filters dates on the local calendar day, not the UTC day', () => {
    // Regression (adversary finding 12): saved at 9:30 pm in New York (UTC-4) on 1 Oct, which is
    // 2 Oct in UTC; a "to 1 Oct" filter must keep it.
    const evening = finding('e', { createdAt: '2026-10-02T01:30:00Z' });
    const newYork = (iso: string) => localDay(iso, 240);
    expect(localDay('2026-10-02T01:30:00Z', 240)).toBe('2026-10-01');
    expect(filterFindings([evening], { ...EMPTY_FILTERS, to: '2026-10-01' }, newYork)).toHaveLength(1);
    expect(filterFindings([evening], { ...EMPTY_FILTERS, from: '2026-10-02' }, newYork)).toHaveLength(0);
    expect(localDay('2026-10-01T23:30:00Z', -120)).toBe('2026-10-02'); // Europe, east of UTC
  });

  it('groups in theme order, newest first, and drops empty groups', () => {
    const groups = groupByTheme(FINDINGS);
    expect(groups.map((g) => g.key)).toEqual(['financial-performance', 'risk-factors', 'regulatory-compliance']);
    expect(groups[1]!.findings.map((f) => f.findingId)).toEqual(['d', 'a']);
  });

  it('groups by company, status and origin (architecture §10)', () => {
    // Regression (adversary finding 12): the board only grouped by theme.
    const byCompany = groupFindings(FINDINGS, 'company', (t) => `${t} Inc`);
    expect(byCompany.map((g) => g.key)).toEqual(['AAPL', 'GOOG', 'MSFT', 'NVDA']);
    expect(byCompany[0]).toMatchObject({ label: 'AAPL Inc' });
    expect(byCompany[0]!.findings.map((f) => f.findingId)).toEqual(['d', 'a']);
    // A multi-company finding appears under each of its companies.
    expect(byCompany[1]!.findings.map((f) => f.findingId)).toEqual(['c']);
    expect(byCompany[2]!.findings.map((f) => f.findingId)).toEqual(['c']);
    expect(groupFindings(FINDINGS, 'status').map((g) => [g.label, g.findings.length])).toEqual([
      ['Active', 3],
      ['Needs follow-up', 1],
    ]);
    expect(groupFindings(FINDINGS, 'origin').map((g) => g.key)).toEqual(['analysis', 'intelligence', 'compare']);
  });
});

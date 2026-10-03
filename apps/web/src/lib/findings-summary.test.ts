import { THEMES, findBannedPhrases, type Finding } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, activeFilterCount, filterFindings, matchesSearch } from './findings-filter';
import { BOARD_ORDER, boardColumns, followUpQuestion, summarizeFindings } from './findings-summary';

const finding = (id: string, over: Partial<Finding> = {}): Finding => ({
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
  finding('a', { title: 'DMA compliance deadline', text: 'Apple’s plan was challenged.', note: 'Check the fines language' }),
  finding('b', { theme: 'regulatory-compliance', tickers: ['NVDA'], status: 'NEEDS_FOLLOW_UP', createdAt: '2026-09-29T10:00:00Z' }),
  finding('c', { theme: 'financial-performance', tickers: ['MSFT', 'GOOG'], status: 'RESOLVED', createdAt: '2026-09-25T10:00:00Z' }),
  finding('d', { status: 'NEEDS_FOLLOW_UP', createdAt: '2026-09-30T10:00:00Z' }),
];
const NAMES: Record<string, string> = { AAPL: 'Apple Inc', NVDA: 'NVIDIA Corporation', MSFT: 'Microsoft Corporation', GOOG: 'Alphabet Inc' };
const nameOf = (t: string) => NAMES[t] ?? t;

describe('summary strip (DD-21 h)', () => {
  it('counts the whole board by status and theme, every theme listed', () => {
    const s = summarizeFindings(FINDINGS);
    expect(s.total).toBe(4);
    expect(s.companies).toBe(4);
    expect(s.byStatus).toEqual({ ACTIVE: 1, NEEDS_FOLLOW_UP: 2, RESOLVED: 1 });
    expect(s.byTheme.map((t) => t.id)).toEqual(THEMES.map((t) => t.id));
    expect(s.byTheme.find((t) => t.id === 'risk-factors')!.count).toBe(2);
    expect(s.byTheme.reduce((n, t) => n + t.count, 0)).toBe(4);
    // The newest finding that needs follow-up.
    expect(s.firstFollowUp?.findingId).toBe('d');
  });

  it('an empty board', () => {
    expect(summarizeFindings([])).toMatchObject({ total: 0, companies: 0, firstFollowUp: null });
  });
});

describe('search', () => {
  it('matches title, text, note, ticker and company name; every word must match; case, quotes and dashes folded', () => {
    const a = FINDINGS[0]!;
    expect(matchesSearch(a, 'dma', nameOf)).toBe(true);
    expect(matchesSearch(a, "apple's plan", nameOf)).toBe(true);
    expect(matchesSearch(a, 'FINES', nameOf)).toBe(true);
    expect(matchesSearch(a, 'aapl', nameOf)).toBe(true);
    expect(matchesSearch(a, 'apple inc', nameOf)).toBe(true);
    expect(matchesSearch(a, 'dma nvidia', nameOf)).toBe(false);
    expect(matchesSearch(a, '   ', nameOf)).toBe(true);
    expect(filterFindings(FINDINGS, { ...EMPTY_FILTERS, q: 'microsoft' }, undefined, nameOf).map((f) => f.findingId)).toEqual(['c']);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'x' })).toBe(1);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: '  ' })).toBe(0);
  });
});

describe('Board view', () => {
  it('one column per status, attention first, empty columns kept, newest first', () => {
    const cols = boardColumns(FINDINGS);
    expect(cols.map((c) => c.status)).toEqual([...BOARD_ORDER]);
    expect(BOARD_ORDER).toEqual(['NEEDS_FOLLOW_UP', 'ACTIVE', 'RESOLVED']);
    expect(cols[0]!.findings.map((f) => f.findingId)).toEqual(['d', 'b']);
    expect(boardColumns([FINDINGS[0]!]).map((c) => c.findings.length)).toEqual([0, 1, 0]);
    // Every finding is in exactly one column.
    expect(cols.flatMap((c) => c.findings).length).toBe(FINDINGS.length);
  });
});

describe('Ask follow-up template', () => {
  it('is a fixed template over the stored title and companies; no figure, no judgment', () => {
    const q = followUpQuestion(FINDINGS[2]!, nameOf);
    expect(q).toBe('Follow up on the finding “c”: what do the filings of Microsoft Corporation and Alphabet Inc say about it, and how has the disclosure changed over time?');
    expect(followUpQuestion({ title: 'T', tickers: ['AAPL', 'NVDA', 'MSFT'] }, nameOf)).toContain('Apple Inc, NVIDIA Corporation, and Microsoft Corporation');
    expect(followUpQuestion({ title: 'T', tickers: [] }, nameOf)).toContain('what do the filings say');
    const template = followUpQuestion({ title: '', tickers: ['AAPL'] }, nameOf);
    expect(template).not.toMatch(/\d/);
    expect(findBannedPhrases(template)).toEqual([]);
  });

  it('stays within the 1,000-character question limit for a very long title', () => {
    const q = followUpQuestion({ title: 'x'.repeat(2000), tickers: ['AAPL', 'NVDA', 'MSFT', 'GOOG'] }, nameOf);
    expect(q.length).toBeLessThanOrEqual(1000);
    expect(q).toContain('…');
  });
});

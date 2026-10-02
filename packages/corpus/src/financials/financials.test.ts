import { describe, expect, it } from 'vitest';
import { chunkFiling } from '../chunker';
import type { FilingMeta, ProcessedFiling } from '../filing';
import { detectSections } from '../sections';
import { CROSS_CHECK_TOLERANCE, type FinancialFact, crossCheck, extractFilingFacts, statementOf } from './extract';
import { matchMetric } from './metrics';
import { alignValues, durationLabels, hasNoteColumn, headerPeriods, rowLabel, rowValues, scaleHint, tablesIn, type TableRow } from './tables';
import { THRESHOLDS, computeTrends, growthTrend, latestQuarterGrowth, marginTrend } from './trends';

/** Synthetic tests. Table rows are quoted from real filings (AAPL, NVDA, XOM, JNJ, BAC). */

const row = (text: string): TableRow => ({ start: 0, end: text.length, text, cells: text.split('|').map((c) => c.trim()) });

describe('table rows', () => {
  it('reads values with $ cells, spacer cells and percent columns excluded (AAPL segment table)', () => {
    const r = row('Total net sales | $ | 416,161 |  |  | 6 | % |  | $ | 391,035 |  |  | 2 | % |  | $ | 383,285 |');
    expect(rowValues(r).map((v) => v.value)).toEqual([416_161, 391_035, 383_285]);
  });

  it('reads parenthesized negatives and keeps dashes as empty positions (NVDA)', () => {
    expect(rowValues(row('Interest expense | (247) |  |  | (257) |  |  | (262) |')).map((v) => v.value)).toEqual([-247, -257, -262]);
    expect(rowValues(row('Acquisition termination cost | — |  |  | — |  |  | 1,353 |')).map((v) => v.value)).toEqual([null, null, 1_353]);
    expect(rowValues(row('Sales to customers | $94,193 | 88,821 | 85,159')).map((v) => v.value)).toEqual([94_193, 88_821, 85_159]);
  });

  it('aligns to the period columns, allowing one note-reference column (XOM) or dollar-change columns (NVDA)', () => {
    const xom = rowValues(row('Sales and other operating revenue | 3 | 323,905 |  | 339,247 |  | 334,697 |'));
    expect(hasNoteColumn(row('(millions of dollars) | NoteReferenceNumber | 2025 | 2024 | 2023'))).toBe(true);
    expect(alignValues(xom, 3, 0, true)!.map((v) => v.value)).toEqual([323_905, 339_247, 334_697]);
    const nvda = rowValues(row('Compute & Networking | $ | 116,193 |  |  | $ | 47,405 |  |  | $ | 68,788 |  |  | 145 | %'));
    expect(alignValues(nvda, 2)).toBeNull();
    expect(alignValues(nvda, 2, 1)!.map((v) => v.value)).toEqual([116_193, 47_405]);
    // A segment table with more value cells than periods is skipped, never guessed (JNJ 10-Q).
    expect(alignValues(rowValues(row('Sales to customers |  | $15,563 | 8,430 |  |  | 14,580 | 7,891 |')), 2)).toBeNull();
  });

  it('never drops a leading small value as a note reference unless the header has a note column (LOW finding)', () => {
    // A table in billions: four values for three periods is ambiguous, so the row is skipped, never shifted.
    const billions = rowValues(row('Revenue | 12 | 11 | 10 | 9'));
    expect(hasNoteColumn(row('(in billions) | 2025 | 2024 | 2023'))).toBe(false);
    expect(alignValues(billions, 3)).toBeNull();
    expect(alignValues(billions, 3, 0, false)).toBeNull();
    // With a note column, only a small whole number written without a comma or decimal is a note reference.
    expect(alignValues(billions, 3, 0, true)!.map((v) => v.value)).toEqual([11, 10, 9]);
    expect(alignValues(rowValues(row('Revenue | 1.5 | 11 | 10 | 9')), 3, 0, true)).toBeNull();
    expect(alignValues(rowValues(row('Revenue | 1,200 | 11 | 10 | 9')), 3, 0, true)).toBeNull();
  });

  it('normalizes labels and matches the alias map in priority order', () => {
    expect(rowLabel(row('Services(1) | 109,158'))).toBe('services');
    expect(rowLabel(row('Sales to customers (Note 9) | $ 23,993'))).toBe('sales to customers');
    expect(matchMetric('total net sales')).toEqual({ metric: 'revenue', priority: 0 });
    expect(matchMetric('net income attributable to exxonmobil')?.metric).toBe('net_income');
    // DIS: "Net income attributable to The Walt Disney Company (Disney)" is the parent's net income, not the total.
    expect(matchMetric('net income attributable to the walt disney company (disney)')).toEqual({ metric: 'net_income', priority: 0 });
    expect(matchMetric('net income attributable to noncontrolling interests')).toBeNull();
    expect(matchMetric('net income (loss) attributable to noncontrolling interests')).toBeNull();
    expect(matchMetric('research and development')).toBeNull();
  });

  it('reads period headers: dates, bare years, and duration groups', () => {
    expect(headerPeriods(row('| Jan 26, 2025 |  | Jan 28, 2024 |  | Jan 29, 2023')).map((c) => c.date)).toEqual(['2025-01-26', '2024-01-28', '2023-01-29']);
    expect(headerPeriods(row('| September 27,2025 |  | September 28,2024')).map((c) => c.date)).toEqual(['2025-09-27', '2024-09-28']);
    expect(headerPeriods(row('Year Ended June 30, |  | 2025 |  |  | 2024 |  |  | 2023 |')).map((c) => [c.date, c.year])).toEqual([
      [null, 2025],
      [null, 2024],
      [null, 2023],
    ]);
    expect(durationLabels(row('| Three Months Ended |  | Nine Months Ended'))).toEqual(['quarter', 'ytd']);
    // MCD: the full date on the first column only; the bare years take its month and day.
    expect(headerPeriods(row('In millions, except per share data | Years ended December 31,2024 |  | 2023 |  | 2022')).map((c) => c.date)).toEqual([
      '2024-12-31',
      '2023-12-31',
      '2022-12-31',
    ]);
  });

  it('names a table’s statement from the nearest caption above it, never from a sentence', () => {
    const t = (before: string) => `${before}\n| 2025 | 2024\n`;
    const header = (text: string) => text.lastIndexOf('\n| 2025') + 1;
    const cases: Array<[string, string]> = [
      ['Apple Inc.CONSOLIDATED STATEMENTS OF OPERATIONS(In millions)', 'income'],
      ['ITEM 8. FINANCIAL STATEMENTS AND SUPPLEMENTARY DATAINCOME STATEMENTS', 'income'],
      ['Condensed Consolidated Balance Sheets (Unaudited)', 'balance'],
      ['STATEMENTS OF CONSOLIDATED CASH FLOWS', 'cash_flow'],
      ['CONSOLIDATED STATEMENTS OF COMPREHENSIVE INCOME', 'other'],
      ['Note 3: Revenue', 'other'],
      ['Gains are recorded in the Consolidated Statements of Operations as follows:', 'other'],
      ['CONSOLIDATED STATEMENTS OF OPERATIONS\nsome rows\nNote 4 — Segments', 'other'],
    ];
    for (const [caption, kind] of cases) {
      const text = t(caption);
      expect(statementOf(text, header(text)), caption).toBe(kind);
    }
  });

  it('reads the unit hint', () => {
    expect(scaleHint('(In millions, except number of shares)')).toBe(1e6);
    expect(scaleHint('(millions of dollars)')).toBe(1e6);
    expect(scaleHint('(Dollars in Thousands)')).toBe(1e3);
    expect(scaleHint('no unit here')).toBeNull();
  });
});

const meta = (over: Partial<FilingMeta>): FilingMeta => ({
  documentId: 'TST_10K_2025',
  sourceFile: 'TST_10K_2025_full.txt',
  company: 'Test Co',
  ticker: 'TST',
  cik: '1',
  sector: 'Industrials',
  filingType: '10-K',
  filingDate: '2026-02-01',
  periodEnd: '2025-12-31',
  periodSource: 'header',
  fiscalYear: 2025,
  fiscalQuarter: null,
  fiscalLabel: 'FY2025',
  calendarQuarter: '2025Q4',
  sourceUrl: 'https://x',
  outsideReviewWindow: false,
  ...over,
});

function filingFrom(m: FilingMeta, body: string): { filing: ProcessedFiling; facts: FinancialFact[] } {
  const text = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION\n${body}`;
  const sections = detectSections(text, m.filingType);
  const filing = { meta: m, text, sections };
  return { filing, facts: extractFilingFacts(filing, chunkFiling(m, text, sections), ['2025-12-31', '2024-12-31']) };
}

const statement = (unit: string) =>
  `Item 8. Financial Statements and Supplementary Data${' Statements follow.'.repeat(10)}CONSOLIDATED STATEMENTS OF OPERATIONS${unit}\n| Year Ended\n| December 31, 2025 |  | December 31, 2024 |  | December 31, 2023\nTotal revenues | $ | 1,200 |  |  | $ | 1,000 |  |  | $ | 900 |\nOperating income | 300 |  |  | 200 |  |  | (50) |\nNet income | 240 |  |  | 150 |  |  | (60) |\nSee notes.`;

describe('extraction', () => {
  it('extracts annual facts with scale, chunk and verbatim row', () => {
    const { facts } = filingFrom(meta({}), statement('(In millions)'));
    const revenue = facts.filter((f) => f.metric === 'revenue').map((f) => [f.period, f.value, f.scale, f.duration]);
    expect(revenue).toEqual([
      ['FY2025', 1_200, 1e6, 'annual'],
      ['FY2024', 1_000, 1e6, 'annual'],
      ['FY2023', 900, 1e6, 'annual'],
    ]);
    const op = facts.find((f) => f.metric === 'operating_income' && f.period === 'FY2023')!;
    expect(op.value).toBe(-50);
    expect(op.rawRow).toBe('Operating income | 300 |  |  | 200 |  |  | (50) |');
    expect(op.chunkId).toMatch(/^TST-FY2025-10K-FS-\d{3}$/);
  });

  it('extracts nothing without a unit hint, and never invents a metric that is not in the table', () => {
    const { facts } = filingFrom(meta({}), statement(''));
    expect(facts).toEqual([]);
    const withUnit = filingFrom(meta({}), statement('(In millions)')).facts;
    expect(withUnit.some((f) => f.metric === 'gross_profit' || f.metric === 'capital_expenditures')).toBe(false);
  });

  it('skips a discontinued-operations note', () => {
    const body = statement('(In millions)').replace('CONSOLIDATED STATEMENTS OF OPERATIONS', 'Results of discontinued operations');
    expect(filingFrom(meta({}), body).facts).toEqual([]);
  });

  it('takes every period of a metric from the income statement, never from a segment table (B2, CMCSA/DIS)', () => {
    const segment = `Item 7. Management’s Discussion and Analysis${' MD&A text.'.repeat(10)}\nMedia Segment Results of Operations\n| Year Ended\n| December 31, 2025 |  | December 31, 2024\n| (in millions)\nTotal revenue | $ | 27,090 |  |  | $ | 28,148 |\nOperating income | 3,000 |  |  | 2,900 |\nThe segment discussion continues.\n`;
    const { facts } = filingFrom(meta({}), segment + statement('(In millions)'));
    const revenue = facts.filter((f) => f.metric === 'revenue');
    expect(revenue.map((f) => [f.period, f.value, f.source])).toEqual([
      ['FY2025', 1_200, 'statement'],
      ['FY2024', 1_000, 'statement'],
      ['FY2023', 900, 'statement'],
    ]);
    expect(new Set(revenue.map((f) => f.rowStart)).size).toBe(1);
    expect(facts.find((f) => f.metric === 'operating_income' && f.period === 'FY2025')!.value).toBe(300);
  });

  it('does not take an income-statement metric from another table when the statement lacks it (DIS, PFE)', () => {
    const body = statement('(In millions)').replace('Operating income | 300 |  |  | 200 |  |  | (50) |\n', '');
    const note = `\nNote 5: Segments\n| Year Ended\n| December 31, 2025 |  | December 31, 2024\n| (in millions)\nOperating income | 8,518 |  |  | 8,407 |\nGross profit | 700 |  |  | 650 |\nEnd of note.`;
    const { facts } = filingFrom(meta({}), body + note);
    expect(facts.some((f) => f.metric === 'operating_income' || f.metric === 'gross_profit')).toBe(false);
    expect(facts.filter((f) => f.metric === 'revenue').every((f) => f.source === 'statement')).toBe(true);
  });

  it('falls back to another table when no statement is found, and says so', () => {
    const body = statement('(In millions)').replace('CONSOLIDATED STATEMENTS OF OPERATIONS', 'Selected results');
    const { facts } = filingFrom(meta({}), body);
    expect(facts.filter((f) => f.metric === 'revenue').map((f) => f.source)).toEqual(['other_table', 'other_table', 'other_table']);
  });

  it('marks implausible values suspect against the same filing’s revenue (B2 guards)', () => {
    const body = statement('(In millions)')
      .replace('Operating income | 300 |  |  | 200 |  |  | (50) |', 'Gross profit | 1,500 |  |  | 400 |  |  | 300 |\nOperating income | 300 |  |  | 2,000 |  |  | (50) |')
      .replace('Net income | 240 |  |  | 150 |  |  | (60) |', 'Net income | 240 |  |  | 150 |  |  | (1,900) |');
    const { facts } = filingFrom(meta({}), body);
    const suspect = facts.filter((f) => f.suspect).map((f) => [f.metric, f.period, f.suspect]);
    expect(suspect).toEqual(
      expect.arrayContaining([
        ['gross_profit', 'FY2025', 'gross profit larger than revenue'],
        ['operating_income', 'FY2024', 'operating income larger than revenue'],
        ['net_income', 'FY2023', 'net margin outside (−200%, 100%)'],
      ]),
    );
    expect(suspect).toHaveLength(3);
  });

  it('cross-checks across filings: above 0.5% is a mismatch on both, never averaged', () => {
    const base: FinancialFact = {
      metric: 'revenue', period: 'FY2024', periodEnd: null, duration: 'annual', value: 1_000, unit: 'USD', scale: 1e6,
      documentId: 'A', fiscalLabel: 'FY2024', chunkId: 'c1', rawRow: 'r', rowStart: 0, tableStart: 0, section: 'financial_statements',
      source: 'statement', suspect: null, crossCheck: 'single_source',
    };
    const within = crossCheck([base, { ...base, documentId: 'B', value: 1_000 * (1 + CROSS_CHECK_TOLERANCE / 2) }]);
    expect(within.map((f) => f.crossCheck)).toEqual(['ok', 'ok']);
    const beyond = crossCheck([base, { ...base, documentId: 'B', value: 1_010 }]);
    expect(beyond.map((f) => [f.crossCheck, f.value])).toEqual([
      ['mismatch', 1_000],
      ['mismatch', 1_010],
    ]);
    expect(crossCheck([base])[0]!.crossCheck).toBe('single_source');
  });
});

describe('trends (thresholds locked)', () => {
  const fact = (metric: FinancialFact['metric'], period: string, value: number, documentId = 'D', over: Partial<FinancialFact> = {}): FinancialFact => ({
    metric, period, periodEnd: null, duration: 'annual', value, unit: 'USD', scale: 1e6, documentId, fiscalLabel: 'FY2025',
    chunkId: `${documentId}-${metric}-${period}`, rawRow: 'r', rowStart: 0, tableStart: 0, section: 'financial_statements',
    source: 'statement', suspect: null, crossCheck: 'single_source', ...over,
  });
  const growth = (a: number, b: number, c: number) =>
    growthTrend([fact('revenue', 'FY2023', a), fact('revenue', 'FY2024', b), fact('revenue', 'FY2025', c)])!.trajectory;

  it('locks the thresholds', () => {
    expect(THRESHOLDS).toEqual({ stableGrowth: 0.02, accelerationPoints: 0.05, marginPoints: 0.01 });
  });

  it('labels growth: declining, stable, accelerating, slowing, growing', () => {
    expect(growth(100, 100, 97)).toBe('declining');
    expect(growth(100, 100, 102)).toBe('stable');
    expect(growth(100, 103, 112)).toBe('accelerating'); // 3% → 8.7%
    expect(growth(100, 120, 126)).toBe('slowing'); // 20% → 5%
    expect(growth(100, 105, 111)).toBe('growing'); // 5% → 5.7%
  });

  it('labels margins and needs both years from one filing', () => {
    const t = marginTrend(
      [fact('revenue', 'FY2024', 100), fact('revenue', 'FY2025', 100), fact('operating_income', 'FY2024', 20), fact('operating_income', 'FY2025', 22)],
      'operating_income',
      'operating_margin',
    )!;
    expect(t.trajectory).toBe('improving');
    expect(t.basis).toContain('threshold 1.0 pp');
    expect(t.chunkIds).toHaveLength(4);
    // Revenue from a different filing than the numerator: no margin.
    expect(
      marginTrend([fact('revenue', 'FY2024', 100, 'X'), fact('revenue', 'FY2025', 100, 'X'), fact('operating_income', 'FY2024', 20), fact('operating_income', 'FY2025', 22)], 'operating_income', 'm'),
    ).toBeNull();
  });

  it('labels a rebound after a decline Growing, not Accelerating (LOW finding)', () => {
    // −41% then +6.8% (PFE FY2023 → FY2024): 47.9 pp "faster", but a recovery.
    const t = growthTrend([fact('revenue', 'FY2022', 101_175), fact('revenue', 'FY2023', 59_553), fact('revenue', 'FY2024', 63_627)])!;
    expect(t.trajectory).toBe('growing');
    expect(t.basis).toContain('recovering from a decline the year before');
  });

  it('computes growth only from one table row, and margins only from one table (B2)', () => {
    // FY2024 revenue from a different row (a segment table) than FY2025: no growth from that pair.
    expect(growthTrend([fact('revenue', 'FY2024', 100, 'D', { rowStart: 10 }), fact('revenue', 'FY2025', 110, 'D', { rowStart: 20 })])).toBeNull();
    // The third year from another row is dropped, not mixed in.
    const two = growthTrend([fact('revenue', 'FY2023', 50, 'D', { rowStart: 99 }), fact('revenue', 'FY2024', 100), fact('revenue', 'FY2025', 110)])!;
    expect(two.periods).toEqual(['FY2024', 'FY2025']);
    // Gross profit from a note table against revenue from the income statement: no margin (PFE).
    const rev = [fact('revenue', 'FY2024', 100), fact('revenue', 'FY2025', 100)];
    const noteGp = [fact('gross_profit', 'FY2024', 11, 'D', { tableStart: 500 }), fact('gross_profit', 'FY2025', 12, 'D', { tableStart: 500 })];
    expect(marginTrend([...rev, ...noteGp], 'gross_profit', 'gross_margin')).toBeNull();
    // Suspect facts are never used.
    const suspectOp = [fact('operating_income', 'FY2024', 20), fact('operating_income', 'FY2025', 150, 'D', { suspect: 'operating income larger than revenue' })];
    expect(marginTrend([...rev, ...suspectOp], 'operating_income', 'operating_margin')).toBeNull();
    // Quarter growth from two rows of one 10-Q is not computed either.
    const q = (period: string, value: number, rowStart: number) => fact('revenue', period, value, 'Q', { duration: 'quarter', rowStart });
    expect(latestQuarterGrowth([q('FY2024Q3', 100, 1), q('FY2025Q3', 110, 2)])).toBeNull();
    expect(latestQuarterGrowth([q('FY2024Q3', 100, 1), q('FY2025Q3', 110, 1)])!.trajectory).toBe('growing');
  });

  it('returns no trend without two comparable periods', () => {
    expect(computeTrends([fact('revenue', 'FY2025', 100)])).toEqual([]);
    expect(growthTrend([fact('revenue', 'FY2025', 100), fact('revenue', 'FY2023', 90)])).toBeNull();
  });
});

describe('tablesIn', () => {
  it('groups consecutive table rows and splits on prose', () => {
    const text = 'Intro\n| 2025 | 2024\nA | 1 | 2\nprose line\nB | 3 | 4\n';
    expect(tablesIn(text, 0, text.length).map((t) => t.rows.length)).toEqual([2, 1]);
  });
});

import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { HARD_CAP_CHARS, MAX_CHUNKS_PER_SECTION, chunkFiling, chunkId, contextHeader, embeddingText, isBoilerplateSection, packUnits, TARGET_CHARS } from './chunker';
import type { FilingMeta } from './filing';
import { parseHeader } from './header';
import { readZip } from './load';
import { derivePeriodEnd, fiscalPeriod, fiscalYearForYearEnd, slugDate } from './periods';
import { detectSections, sectionGaps } from './sections';
import { capSpan, headingPrefix, isTableRow, paragraphSpans, sentenceSpans } from './segments';
import { COVER_HEADING, normalizeWhitespace, stripPreamble } from './text';

/** Synthetic unit tests: no corpus needed. Real-text fragments are quoted from the filings. */

const header = (extra: string) =>
  `Company: Apple Inc\nTicker: AAPL\nFiling Type: 10-K (Annual Report)\nFiling Date: 2025-10-31\nCIK: 0000320193\nSource: SEC EDGAR\nURL: https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/aapl-20250927.htm\n${extra}============================================================\n\n`;

describe('headers and periods', () => {
  it('parses the header block and finds the body start', () => {
    const text = `${header('')}preamble UNITED STATES SECURITIES AND EXCHANGE COMMISSION body`;
    const h = parseHeader(text);
    expect(h).toMatchObject({ company: 'Apple Inc', ticker: 'AAPL', filingType: '10-K', filingDate: '2025-10-31', reportPeriod: null });
    expect(text.slice(h.headerEnd)).toMatch(/^\npreamble/);
  });

  it('rejects a header without the separator or with an unsupported form', () => {
    expect(() => parseHeader('Company: X\n')).toThrow(/separator/);
    expect(() => parseHeader(header('').replace('10-K (Annual Report)', '8-K'))).toThrow(/unsupported/);
  });

  it.each([
    ['https://x/aapl-20250927.htm', '2025-09-27'],
    ['https://x/de-20251102x10k.htm', '2025-11-02'],
    ['https://x/msft-10k_20220630.htm', '2022-06-30'],
    ['https://x/msft-10q_20220331.htm', '2022-03-31'],
    ['https://x/gecc10k2014.htm', null],
  ])('URL slug %s → %s', (url, date) => {
    expect(slugDate(url)).toBe(date);
  });

  it('uses header → slug → cover page → filing date, in that order', () => {
    const withPeriod = header('Report Period: 2025-09-27\nQuarter: 2025Q3\n');
    expect(derivePeriodEnd(parseHeader(withPeriod), withPeriod)).toEqual({ periodEnd: '2025-09-27', source: 'header' });
    const slugOnly = header('');
    expect(derivePeriodEnd(parseHeader(slugOnly), slugOnly)).toEqual({ periodEnd: '2025-09-27', source: 'url-slug' });
    const cover = header('').replace('aapl-20250927.htm', 'gecc10k2014.htm') + 'For the fiscal year ended December 31, 2014';
    expect(derivePeriodEnd(parseHeader(cover), cover)).toEqual({ periodEnd: '2014-12-31', source: 'cover-page' });
    const none = header('').replace('aapl-20250927.htm', 'gecc10k2014.htm');
    expect(derivePeriodEnd(parseHeader(none), none)).toEqual({ periodEnd: '2025-10-31', source: 'filing-date' });
  });

  it('labels fiscal years (assumptions B3)', () => {
    expect(fiscalYearForYearEnd('NVDA', '2025-01-26')).toBe(2025);
    expect(fiscalYearForYearEnd('AAPL', '2025-09-27')).toBe(2025);
    expect(fiscalYearForYearEnd('WMT', '2025-01-31')).toBe(2025);
    expect(fiscalYearForYearEnd('TGT', '2025-02-01')).toBe(2024);
    expect(fiscalYearForYearEnd('HD', '2025-02-02')).toBe(2024);
    expect(fiscalYearForYearEnd('JNJ', '2022-01-02')).toBe(2021);
    expect(fiscalYearForYearEnd('JNJ', '2023-01-01')).toBe(2022);
  });

  it('assigns 10-Q fiscal quarters from the year-end anchor', () => {
    expect(fiscalPeriod('NVDA', '10-Q', '2025-10-26', ['2025-01-26']).fiscalLabel).toBe('FY2026Q3');
    expect(fiscalPeriod('DIS', '10-Q', '2022-01-01', ['2025-09-27']).fiscalLabel).toBe('FY2022Q1');
    expect(fiscalPeriod('AAPL', '10-Q', '2025-12-27', ['2025-09-27']).fiscalLabel).toBe('FY2026Q1');
    expect(fiscalPeriod('PEP', '10-Q', '2023-03-25', ['2025-12-27']).fiscalLabel).toBe('FY2023Q1');
    expect(fiscalPeriod('JNJ', '10-Q', '2022-04-03', ['2024-12-29']).fiscalLabel).toBe('FY2022Q1');
    expect(fiscalPeriod('AAPL', '10-K', '2025-09-27', []).fiscalLabel).toBe('FY2025');
    expect(() => fiscalPeriod('X', '10-Q', '2025-03-31', [])).toThrow(/10-K/);
  });
});

describe('preamble and whitespace', () => {
  it.each([
    'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
    'UNITED STATESSECURITIES AND EXCHANGE COMMISSION',
    'UNITED STATES\nSECURITIES AND EXCHANGE COMMISSION',
    'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
    'United States Securities and Exchange Commission',
  ])('the tolerant cover pattern matches %j', (cover) => {
    expect(COVER_HEADING.test(cover)).toBe(true);
    const raw = `${header('')}aapl-20250927false2025FY${cover}\nWashington`;
    const { text } = stripPreamble(raw, parseHeader(raw).headerEnd);
    expect(text.startsWith('aapl')).toBe(false);
    expect(text).toMatch(/Washington$/);
  });

  it('throws when there is no cover heading', () => {
    const raw = header('');
    expect(() => stripPreamble(raw, parseHeader(raw).headerEnd)).toThrow(/cover heading/);
  });

  it('normalizes non-breaking spaces and CRLF but keeps runs of spaces and pipes', () => {
    expect(normalizeWhitespace('a b\r\nc  |  d​')).toBe('a b\nc  |  d');
  });
});

describe('segmentation', () => {
  it('splits glued paragraphs and keeps U.S. together', () => {
    const t = 'The Company sells in the U.S. and abroad.The Company also has risks.';
    const spans = paragraphSpans(t, 0, t.length).map((s) => t.slice(s.start, s.end));
    expect(spans).toEqual(['The Company sells in the U.S. and abroad.', 'The Company also has risks.']);
  });

  it('ends a sentence after "U.S." when a new sentence follows ("…outside of the U.S.A significant…")', () => {
    const t = 'Partners are located outside of the U.S.A significant majority of manufacturing is abroad.';
    expect(paragraphSpans(t, 0, t.length).map((s) => t.slice(s.start, s.end))[0]).toBe('Partners are located outside of the U.S.');
  });

  it('does not split "10-K." before a capitalized word as an abbreviation', () => {
    const t = 'See Item 7 of this Form 10-K.Macroeconomic and Industry RisksThe Company…';
    expect(paragraphSpans(t, 0, t.length).length).toBe(2);
  });

  it('splits sentences on punctuation, whitespace and a capital', () => {
    const t = 'First one. Second one? Third one.';
    expect(sentenceSpans(t, { start: 0, end: t.length }).map((s) => t.slice(s.start, s.end))).toEqual(['First one. ', 'Second one? ', 'Third one.']);
  });

  it('detects table rows but not prose lines that carry a page footer', () => {
    expect(isTableRow('Total net sales | $ | 416,161 |  | 391,035')).toBe(true);
    expect(isTableRow(`${'prose '.repeat(400)}Apple Inc. | 2025 Form 10-K | 5${'more prose '.repeat(100)}`)).toBe(false);
  });

  it('caps a run with no whitespace', () => {
    const t = 'x'.repeat(13_000);
    const spans = capSpan(t, { start: 0, end: t.length }, 6_000);
    expect(spans.map((s) => s.end - s.start)).toEqual([6_000, 6_000, 1_000]);
  });

  it('finds glued Title Case headings', () => {
    expect(headingPrefix('Segment Operating PerformanceThe following table shows')).toBe('Segment Operating Performance');
    expect(headingPrefix('Liquidity and Capital ResourcesThe Company')).toBe('Liquidity and Capital Resources');
    expect(headingPrefix('The Company believes that its existing cash will be sufficient.')).toBeNull();
  });
});

describe('section detection (synthetic)', () => {
  const tenK = [
    'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
    'TABLE OF CONTENTS',
    'Item 1. | Business | 1',
    'Item 1A. | Risk Factors | 5',
    'Item 7. | Management’s Discussion and Analysis | 20',
    `PART IItem 1.    BusinessCompany Background${' The Company designs products.'.repeat(20)}`,
    `Item 1A.    Risk FactorsThe following summarizes factors.${' Risk text here.'.repeat(30)} Results are discussed in Part II, Item 7 of this Form 10-K under the heading “Management’s Discussion and Analysis.”${' More risk.'.repeat(20)}`,
    `Item 7.    Management’s Discussion and Analysis of Financial Condition and Results of OperationsOverview${' MD&A text.'.repeat(30)}`,
    `Item 8.    Financial Statements and Supplementary Data${' Statements.'.repeat(20)}`,
  ].join('\n');

  it('skips TOC rows and cross-references and orders sections by offset', () => {
    const secs = detectSections(tenK, '10-K');
    const kinds = secs.map((s) => s.kind);
    expect(kinds).toEqual(['other', 'business', 'risk_factors', 'mda', 'financial_statements']);
    const rf = secs.find((s) => s.kind === 'risk_factors')!;
    expect(tenK.slice(rf.start)).toMatch(/^Item 1A\.\s+Risk FactorsThe following/);
    // contiguous and complete
    secs.forEach((s, i) => expect(s.start).toBe(i ? secs[i - 1]!.end : 0));
    expect(secs.at(-1)!.end).toBe(tenK.length);
  });

  it('never anchors on a cross-reference to Item 1A', () => {
    const tenQ = [
      'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
      `Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations${' Text.'.repeat(60)} For a discussion of risks see Item 1A. Risk Factors of ExxonMobil's 2023 Form 10-K and refer to “Item 1A. Risk Factors” of our Annual Report.${' Text.'.repeat(40)}`,
      `Item 4. Controls and Procedures${' Controls.'.repeat(20)}`,
    ].join('\n');
    const kinds = detectSections(tenQ, '10-Q').map((s) => s.kind);
    expect(kinds).toContain('mda');
    expect(kinds).not.toContain('risk_factors');
  });

  const body = (n: number, word = 'Text') => ` ${word}.`.repeat(n);

  it('never anchors MD&A on a cross-reference inside Item 1 (JNJ "under: Item 7.", ORCL "and Note 13…") (B1)', () => {
    const jnj = [
      'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
      `Item 1. BusinessGeneral${body(40)} The information required by this item is incorporated herein by reference to the narrative and tabular descriptions of segments and operating results under: Item 7. Management’s discussion and analysis of results of operations and financial condition of this Report; and Note 17 Segments of business.${body(40)} Our segments are described in Item 7 Management’s Discussion and Analysis of Financial Condition and Results of Operations and Note 13 of Notes to Consolidated Financial Statements, both included elsewhere in this Annual Report.${body(40)}`,
      `Item 1A. Risk FactorsThe Company faces risks.${body(60)}`,
      `Item 7. Management’s discussion and analysis of results of operations and financial conditionOrganization and business segments${body(60)}`,
      `Item 8. Financial statements and supplementary dataIndex to audited Consolidated Financial Statements\nConsolidated balance sheets at end of fiscal years 2025 and 2024 | 44\nConsolidated statements of earnings | 45\n${body(60, 'Statements')}`,
    ].join('\n');
    const secs = detectSections(jnj, '10-K');
    expect(secs.map((s) => s.kind)).toEqual(['other', 'business', 'risk_factors', 'mda', 'financial_statements']);
    expect(jnj.slice(secs.find((s) => s.kind === 'mda')!.start)).toMatch(/^Item 7\. Management’s discussion and analysis of results of operations and financial conditionOrganization/);
    // The statements heading followed by its own index is not mistaken for a TOC row.
    expect(jnj.slice(secs.find((s) => s.kind === 'financial_statements')!.start)).toMatch(/^Item 8\. Financial statements/);
  });

  it('skips a TOC entry whose title wraps onto the next line before its page number (GS) (B1)', () => {
    const gs = [
      'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
      'Page No.',
      'Item 7 |',
      'Management’s Discussion and Analysis of Financial Condition',
      'and Results of Operations | 62',
      'Introduction | 62',
      'Executive Overview | 63',
      `Item 1. BusinessIntroduction${body(60)}`,
      `Item 1A. Risk FactorsWe face risks.${body(60)}`,
      `Item 7. Management’s Discussion and Analysis of Financial Condition and Results of OperationsIntroduction${body(60)}`,
    ].join('\n');
    const secs = detectSections(gs, '10-K');
    expect(secs.map((s) => s.kind)).toEqual(['other', 'business', 'risk_factors', 'mda']);
    expect(gs.slice(secs.find((s) => s.kind === 'mda')!.start, secs.find((s) => s.kind === 'mda')!.start + 120)).not.toMatch(/\| \d+\n/);
  });

  it('finds the statements after a stub Item 8 (DIS, NVDA) and reports stubs as gaps (B1)', () => {
    const dis = [
      'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
      `Item 1A. Risk FactorsWe face risks.${body(300)}`,
      `Item 7. Management’s Discussion and Analysis of Financial Condition and Results of OperationsOverview${body(300)}`,
      'Item 8. Financial Statements and Supplementary DataSee Index to Financial Statements and Supplemental Data on page 69.',
      `Item 9A. Controls and ProceduresWe evaluated our controls.${body(40)} The report of the auditor is included.`,
      `Item 15. Exhibits and Financial Statement SchedulesThe following are filed.${body(20)}`,
      `70TABLE OF CONTENTSCONSOLIDATED STATEMENTS OF INCOME(in millions, except per share data)\n| 2025 |  | 2024\nRevenues | 94,425 | 91,361\n${body(300, 'Statements')}`,
    ].join('\n');
    const secs = detectSections(dis, '10-K');
    const fs = secs.find((s) => s.kind === 'financial_statements')!;
    expect(fs.anchor).toBe('title');
    expect(dis.slice(fs.start)).toMatch(/^CONSOLIDATED STATEMENTS OF INCOME/);
    expect(sectionGaps(secs, '10-K')).toEqual([]);
    // Without the statements in the text, the stub is reported, not hidden.
    const stubOnly = dis.slice(0, dis.indexOf('70TABLE'));
    expect(sectionGaps(detectSections(stubOnly, '10-K'), '10-K')).toEqual([
      { kind: 'financial_statements', reason: 'stub', length: expect.any(Number) },
    ]);
    expect(sectionGaps(detectSections('UNITED STATES SECURITIES AND EXCHANGE COMMISSION\nNo items here.', '10-Q'), '10-Q')).toEqual([{ kind: 'mda', reason: 'missing', length: 0 }]);
  });

  it('never labels a financial-statement note "Legal Proceedings" by its bare title (B1, AMZN/NFLX)', () => {
    const amzn = [
      'UNITED STATES SECURITIES AND EXCHANGE COMMISSION',
      `Item 1A. Risk FactorsWe face risks.${body(60)}`,
      'Item 3. Legal ProceedingsSee Item 8 of Part II, “Financial Statements and Supplementary Data — Note 7 — Commitments and Contingencies — Legal Proceedings.”',
      `Item 7. Management’s Discussion and Analysis of Financial Condition and Results of OperationsOverview${body(60)}`,
      `Item 8. Financial Statements and Supplementary DataStatements${body(60)}\nLegal ProceedingsThe Company is involved in lawsuits.${body(300, 'Note')}`,
    ].join('\n');
    const secs = detectSections(amzn, '10-K');
    expect(secs.find((s) => s.kind === 'legal')!.anchor).toBe('item');
    expect(secs.filter((s) => s.kind === 'legal')).toHaveLength(1);
    expect(secs.find((s) => s.kind === 'financial_statements')!.end).toBe(amzn.length);
  });
});

const meta: FilingMeta = {
  documentId: 'TEST_10Q',
  sourceFile: 'TEST_10Q_full.txt',
  company: 'Test Co',
  ticker: 'TST',
  cik: '1',
  sector: 'Industrials',
  filingType: '10-Q',
  filingDate: '2025-11-01',
  periodEnd: '2025-09-30',
  periodSource: 'header',
  fiscalYear: 2025,
  fiscalQuarter: 3,
  fiscalLabel: 'FY2025Q3',
  calendarQuarter: '2025Q3',
  sourceUrl: 'https://x',
  outsideReviewWindow: false,
};

describe('chunker', () => {
  it('builds fiscal-label chunk IDs', () => {
    expect(chunkId({ ticker: 'NVDA', fiscalLabel: 'FY2026Q3', filingType: '10-Q' }, 'MDA', 12)).toBe('NVDA-FY2026Q3-10Q-MDA-012');
    expect(chunkId({ ticker: 'AAPL', fiscalLabel: 'FY2025', filingType: '10-K' }, '1A', 4)).toBe('AAPL-FY2025-10K-1A-004');
    expect(chunkId({ ticker: 'AAPL', fiscalLabel: 'FY2025', filingType: '10-K' }, '1A', MAX_CHUNKS_PER_SECTION)).toBe('AAPL-FY2025-10K-1A-999');
  });

  it('refuses a chunk number that does not fit three digits (LOW finding)', () => {
    const m = { ticker: 'AAPL', fiscalLabel: 'FY2025', filingType: '10-K' } as const;
    expect(() => chunkId(m, 'OTH', 1_000)).toThrow(/outside 1–999/);
    expect(() => chunkId(m, 'OTH', 0)).toThrow(/outside 1–999/);
  });

  it('packs units up to the target with unit-aligned overlap and always advances', () => {
    const spans = Array.from({ length: 40 }, (_, i) => ({ start: i * 300, end: (i + 1) * 300 }));
    const chunks = packUnits(spans);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(TARGET_CHARS);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.start).toBeLessThan(chunks[i - 1]!.end); // overlap
      expect(chunks[i]!.start).toBeGreaterThan(chunks[i - 1]!.start); // progress
    }
    expect(chunks.at(-1)!.end).toBe(12_000);
  });

  it('chunks a single enormous line without exceeding the cap or losing text', () => {
    const sentence = 'The Company faces risks in many markets and regions. ';
    const body = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION\nItem 2. Management's Discussion and Analysis of Financial Condition and Results of Operations${sentence.repeat(6_000)}`;
    const sections = detectSections(body, '10-Q');
    const chunks = chunkFiling(meta, body, sections);
    expect(body.length).toBeGreaterThan(287_855);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(HARD_CAP_CHARS);
      expect(body.slice(c.charStart, c.charEnd)).toBe(c.text);
    }
    let covered = 0;
    for (const c of chunks) covered = Math.max(covered, c.charEnd);
    expect(covered).toBe(body.length);
  });

  it('puts the contextual header only on the embedded text', () => {
    const body = `UNITED STATES SECURITIES AND EXCHANGE COMMISSION\nItem 2. Management's Discussion and Analysis of Financial Condition and Results of OperationsLiquidity and Capital ResourcesThe Company has cash.${' More.'.repeat(50)}`;
    const [, c] = chunkFiling(meta, body, detectSections(body, '10-Q'));
    expect(c!.text).not.toContain('Test Co (TST)');
    expect(embeddingText(c!)).toMatch(/^Test Co \(TST\) · 10-Q FY2025Q3 \(period ended 2025-09-30\) · Part I, Item 2 — Management’s Discussion and Analysis/);
    expect(contextHeader({ ...c!, subsection: 'Liquidity' })).toMatch(/ › Liquidity$/);
  });

  it('flags a short 10-Q "no material changes" risk section as boilerplate, and only that', () => {
    const body = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION\nItem 1A. Risk FactorsThere have been no material changes to the risk factors disclosed in our 2024 Form 10-K.\nItem 2. Unregistered Sales of Equity Securities and Use of Proceeds None.';
    const secs = detectSections(body, '10-Q');
    const rf = secs.find((s) => s.kind === 'risk_factors')!;
    expect(isBoilerplateSection(body, rf, '10-Q')).toBe(true);
    expect(isBoilerplateSection(body, rf, '10-K')).toBe(false);
    const long = { ...rf, end: rf.start + 5_000 };
    expect(isBoilerplateSection(body.padEnd(rf.start + 5_000, ' x'), long, '10-Q')).toBe(false);
  });
});

describe('zip input', () => {
  it('reads stored and deflated entries and drops directory prefixes', () => {
    const entries = [
      { name: 'edgar_corpus/manifest.json', data: Buffer.from('{"file_count":1}'), method: 0 },
      { name: 'edgar_corpus/A_10K_full.txt', data: Buffer.from('hello filing '.repeat(100)), method: 8 },
    ];
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const e of entries) {
      const body = e.method === 8 ? deflateRawSync(e.data) : e.data;
      const name = Buffer.from(e.name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(e.method, 8);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(e.data.length, 22);
      local.writeUInt16LE(name.length, 26);
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(e.method, 10);
      cd.writeUInt32LE(body.length, 20);
      cd.writeUInt32LE(e.data.length, 24);
      cd.writeUInt16LE(name.length, 28);
      cd.writeUInt32LE(offset, 42);
      locals.push(local, name, body);
      central.push(cd, name);
      offset += 30 + name.length + body.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    const zip = Buffer.concat([...locals, cdBuf, eocd]);
    const out = readZip(zip);
    expect(out.map((e) => e.name)).toEqual(['manifest.json', 'A_10K_full.txt']);
    expect(out[1]!.data.toString()).toBe('hello filing '.repeat(100));
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/zip/);
  });
});

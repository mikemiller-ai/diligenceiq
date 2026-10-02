import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HARD_CAP_CHARS } from './chunker';
import { companyCoverage } from './filing';
import { extractCompanyFacts, type FinancialFact } from './financials/extract';
import { computeTrends } from './financials/trends';
import { MAX_DRIVERS, extractDrivers } from './financials/drivers';
import { manifestIssues } from './load';
import { extractRiskHeadings } from './risks';
import { sectionGaps } from './sections';
import { CORPUS_DIR, HAVE_CORPUS, chunksOf, company, filing, realCorpus } from './testing/corpus';
import { RISK_HEADINGS_GOLDEN, scoreHeadings } from './testing/risk-headings-golden';

/**
 * Tests over the real corpus (Phase 2 exit criteria). They need `edgar_corpus/` and skip
 * with a visible message without it.
 */
describe.skipIf(!HAVE_CORPUS)('corpus: headers and periods over all 246 files', () => {
  it('loads every manifest file and nothing else', () => {
    const { corpus, filings } = realCorpus();
    expect(manifestIssues(corpus)).toEqual([]);
    expect(filings).toHaveLength(246);
    expect(filings.filter((f) => f.meta.filingType === '10-K')).toHaveLength(89);
    expect(filings.filter((f) => f.meta.filingType === '10-Q')).toHaveLength(157);
    expect(new Set(filings.map((f) => f.meta.ticker)).size).toBe(54);
  });

  it('derives every period end from header 192, slug 53, cover page 1, never the filing date', () => {
    const counts: Record<string, number> = {};
    for (const f of realCorpus().filings) counts[f.meta.periodSource] = (counts[f.meta.periodSource] ?? 0) + 1;
    expect(counts).toEqual({ header: 192, 'url-slug': 53, 'cover-page': 1 });
    expect(filing('GE_10K_2015-02-27').meta).toMatchObject({ periodSource: 'cover-page', periodEnd: '2014-12-31' });
  });

  it('gives every filing a fiscal label, unique per company and form', () => {
    const seen = new Set<string>();
    for (const f of realCorpus().filings) {
      expect(f.meta.fiscalLabel).toMatch(f.meta.filingType === '10-K' ? /^FY\d{4}$/ : /^FY\d{4}Q[1-3]$/);
      const key = `${f.meta.ticker}|${f.meta.filingType}|${f.meta.fiscalLabel}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it('locks the fiscal labels named in assumptions B3', () => {
    const label = (id: string) => filing(id).meta.fiscalLabel;
    expect(label('NVDA_10K_2025-02-26')).toBe('FY2025');
    expect(filing('NVDA_10K_2025-02-26').meta.periodEnd).toBe('2025-01-26');
    expect(label('AAPL_10K_2025-10-31')).toBe('FY2025');
    expect(label('WMT_10K_2025-03-14')).toBe('FY2025');
    expect(label('TGT_10K_2025-03-12')).toBe('FY2024');
    expect(label('HD_10K_2025-03-21')).toBe('FY2024');
    expect(label('JNJ_10K_2022Q1_2022-02-17')).toBe('FY2021');
    expect(label('JNJ_10K_2023Q1_2023-02-16')).toBe('FY2022');
    expect(label('DIS_10Q_2022Q1_2022-02-09')).toBe('FY2022Q1');
    expect(label('NVDA_10Q_2025Q4_2025-11-19')).toBe('FY2026Q3');
    expect(label('GE_10K_2015-02-27')).toBe('FY2014');
  });

  it('applies the GE Capital override and keeps it outside the review window', () => {
    expect(filing('GE_10K_2015-02-27').meta).toMatchObject({ company: 'General Electric Capital Corp (GE Capital)', outsideReviewWindow: true });
    expect(realCorpus().filings.filter((f) => f.meta.outsideReviewWindow).map((f) => f.meta.documentId)).toEqual(['GE_10K_2015-02-27']);
  });

  it('strips the preamble on all 246 files (the body starts at the cover heading)', () => {
    for (const f of realCorpus().filings) expect(f.text.slice(0, 120)).toMatch(/^UNITED\s*STATES\s*SECURITIES\s*AND\s*EXCHANGE\s*COMMISSION/i);
  });

  it('computes 12 deep, 5 partial and 37 limited-history companies from the files', () => {
    const tiers: Record<string, string[]> = {};
    for (const c of companyCoverage(realCorpus().filings.map((f) => f.meta))) (tiers[c.tier] ??= []).push(c.ticker);
    expect(tiers.deep).toEqual(['AAPL', 'AMZN', 'DIS', 'GOOG', 'JNJ', 'KO', 'MSFT', 'NVDA', 'PFE', 'TSLA', 'UNH', 'XOM']);
    expect(tiers.partial).toEqual(['BAC', 'JPM', 'MCD', 'META', 'PEP']);
    expect(tiers.limited_history).toHaveLength(37);
  });
});

describe.skipIf(!HAVE_CORPUS)('corpus: sections on representative filings', () => {
  const section = (id: string, kind: string) => {
    const f = filing(id);
    const s = f.sections.find((x) => x.kind === kind);
    return s ? { ...s, head: f.text.slice(s.start, s.start + 80), length: s.end - s.start } : null;
  };

  it('AAPL 10-K: body headings, not the TOC or the forward-looking cross-reference', () => {
    expect(section('AAPL_10K_2025-10-31', 'risk_factors')!.head).toMatch(/^Item 1A\.\s+Risk FactorsThe following summarizes/);
    expect(section('AAPL_10K_2025-10-31', 'risk_factors')!.length).toBeGreaterThan(50_000);
    expect(section('AAPL_10K_2025-10-31', 'mda')!.head).toMatch(/^Item 7\.\s+Management’s Discussion/);
    expect(section('AAPL_10K_2025-10-31', 'business')!.head).toMatch(/^Item 1\.\s+BusinessCompany Background/);
  });

  it('NVDA 10-Q: Part I and Part II items map by title', () => {
    expect(section('NVDA_10Q_2025Q4_2025-11-19', 'financial_statements')!.head).toMatch(/^Item 1\. Financial Statements/);
    expect(section('NVDA_10Q_2025Q4_2025-11-19', 'mda')!.head).toMatch(/^Item 2\. Management's Discussion/);
    expect(section('NVDA_10Q_2025Q4_2025-11-19', 'legal')!.head).toMatch(/^Item 1\. Legal Proceedings/);
    expect(section('NVDA_10Q_2025Q4_2025-11-19', 'risk_factors')!.head).toMatch(/^Item 1A\. Risk FactorsOther than the risk factors listed below/);
  });

  it('JNJ and XOM 10-Qs have no Risk Factors section (only cross-references)', () => {
    const qs = realCorpus().filings.filter((f) => (f.meta.ticker === 'JNJ' || f.meta.ticker === 'XOM') && f.meta.filingType === '10-Q');
    expect(qs).toHaveLength(24);
    for (const f of qs) {
      expect(f.sections.some((s) => s.kind === 'risk_factors'), f.meta.documentId).toBe(false);
      expect(f.sections.some((s) => s.kind === 'mda'), f.meta.documentId).toBe(true);
    }
  });

  it('MS 10-K: Risk Factors found by its title heading, not by a whole-file fallback', () => {
    const rf = section('MS_10K_2026-02-19', 'risk_factors')!;
    expect(rf.anchor).toBe('title');
    expect(rf.head).toMatch(/^Risk FactorsFor a discussion of the risks/);
    expect(rf.length).toBeGreaterThan(30_000);
    expect(rf.length).toBeLessThan(filing('MS_10K_2026-02-19').text.length / 4);
  });

  it('AXP and T 10-Ks ("1A. | Risk Factors" TOC form) still get a Risk Factors section', () => {
    for (const id of ['AXP_10K_2026-02-06', 'T_10K_2026-02-09']) expect(section(id, 'risk_factors')!.length, id).toBeGreaterThan(20_000);
  });

  it('a running "PART I Item 1A" page header does not cut MSFT risk factors short', () => {
    expect(section('MSFT_10K_2025-07-30', 'risk_factors')!.length).toBeGreaterThan(40_000);
  });

  it('every 10-K has Risk Factors and the statements, every filing has MD&A; IBM is the only reported gap', () => {
    const noMda = realCorpus()
      .filings.filter((f) => !f.sections.some((s) => s.kind === 'mda'))
      .map((f) => f.meta.documentId);
    // JPM's 10-Qs open MD&A with "INTRODUCTION / The following is Management’s discussion and
    // analysis…": that line is the anchor (Phase 2 fix; previously their MD&A stayed `other`).
    expect(noMda).toEqual([]);
    const noRf = realCorpus()
      .filings.filter((f) => f.meta.filingType === '10-K' && !f.sections.some((s) => s.kind === 'risk_factors'))
      .map((f) => f.meta.documentId);
    expect(noRf).toEqual([]);
    // Gaps (missing, or under 1,500 characters) are reported, not hidden: IBM incorporates its
    // MD&A and statements by reference to its Annual Report to Stockholders (assumptions B8).
    const gaps = realCorpus()
      .filings.map((f) => ({ id: f.meta.documentId, gaps: sectionGaps(f.sections, f.meta.filingType).map((g) => `${g.kind}:${g.reason}`) }))
      .filter((g) => g.gaps.length);
    expect(gaps).toEqual([{ id: 'IBM_10K_2025-02-25', gaps: ['mda:stub', 'financial_statements:stub'] }]);
  });

  it('item headings follow the canonical order in every 10-K (B1)', () => {
    const order = ['business', 'risk_factors', 'cybersecurity', 'properties', 'legal', 'mda', 'market_risk', 'financial_statements', 'controls'];
    for (const f of realCorpus().filings.filter((x) => x.meta.filingType === '10-K')) {
      const items = f.sections.filter((s) => s.anchor === 'item').map((s) => order.indexOf(s.kind));
      expect(items, f.meta.documentId).toEqual([...items].sort((a, b) => a - b));
      // Title-anchored sections may sit elsewhere only in the integrated-report layouts.
      const kinds = ['business', 'risk_factors', 'mda', 'financial_statements'];
      const at = kinds.map((k) => f.sections.find((s) => s.kind === k)?.start).filter((x): x is number => x !== undefined);
      if (at.join() !== [...at].sort((a, b) => a - b).join()) expect(['INTC_10K_2026-01-23', 'MCD_10K_2025-02-25'], f.meta.documentId).toContain(f.meta.documentId);
    }
  });

  it('never anchors on a cross-reference or a TOC entry (B1: JNJ, ORCL, GS, JPM)', () => {
    for (const id of ['JNJ_10K_2026-02-11', 'JNJ_10K_2024Q4_2025-02-13', 'JNJ_10K_2023Q4_2024-02-16']) {
      expect(section(id, 'mda')!.head, id).toMatch(/^Item 7\.\s*Management/);
      expect(section(id, 'business')!.length, id).toBeGreaterThan(20_000);
    }
    expect(section('ORCL_10K_2025-06-18', 'business')!.length).toBeGreaterThan(20_000);
    expect(section('ORCL_10K_2025-06-18', 'mda')!.head).toMatch(/^Item 7\.\tManagement’s Discussion/);
    const gs = section('GS_10K_2025-02-27', 'mda')!;
    expect(gs.length).toBeGreaterThan(100_000);
    const f = filing('GS_10K_2025-02-27');
    expect(f.text.slice(gs.start, gs.start + 200)).not.toMatch(/\|\s*\d{1,3}\s*\n/);
    expect(section('JPM_10K_2026-02-13', 'mda')!.length).toBeGreaterThan(100_000);
  });

  it('bounds sections that used to run on (B1: INTC, DIS, BLK, legal notes)', () => {
    expect(section('INTC_10K_2026-01-23', 'risk_factors')!.length).toBeLessThan(150_000);
    for (const f of realCorpus().filings.filter((x) => (x.meta.ticker === 'DIS' || x.meta.ticker === 'BLK') && x.meta.filingType === '10-K')) {
      expect(section(f.meta.documentId, 'financial_statements')!.length, f.meta.documentId).toBeGreaterThan(100_000);
    }
    for (const f of realCorpus().filings) {
      for (const s of f.sections.filter((x) => x.kind === 'legal')) expect(s.end - s.start, f.meta.documentId).toBeLessThan(60_000);
    }
  });

  it('sections are contiguous and cover each filing exactly', () => {
    for (const f of realCorpus().filings) {
      f.sections.forEach((s, i) => expect(s.start).toBe(i ? f.sections[i - 1]!.end : 0));
      expect(f.sections.at(-1)!.end).toBe(f.text.length);
    }
  });
});

describe.skipIf(!HAVE_CORPUS)('corpus: chunks', () => {
  it('handles the 287,855-character line in META_10K_2024Q4 within the hard cap, verbatim, with no gaps', () => {
    const raw = readFileSync(join(CORPUS_DIR, 'META_10K_2024Q4_2025-01-30_full.txt'), 'utf8');
    expect(Math.max(...raw.split('\n').map((l) => l.length))).toBe(287_855);
    const f = filing('META_10K_2024Q4_2025-01-30');
    const chunks = chunksOf(f.meta.documentId);
    let covered = 0;
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(HARD_CAP_CHARS);
      expect(f.text.slice(c.charStart, c.charEnd)).toBe(c.text);
      if (c.charStart > covered) expect(f.text.slice(covered, c.charStart).trim()).toBe('');
      covered = Math.max(covered, c.charEnd);
    }
    expect(f.text.slice(covered).trim()).toBe('');
  });

  it('gives every chunk a unique fiscal-label ID and never crosses a section', () => {
    const { chunks, filings } = realCorpus();
    expect(new Set(chunks.map((c) => c.chunkId)).size).toBe(chunks.length);
    expect(chunks.some((c) => c.chunkId === 'NVDA-FY2026Q3-10Q-MDA-001')).toBe(true);
    expect(chunks.some((c) => c.chunkId === 'AAPL-FY2025-10K-1A-004')).toBe(true);
    for (const c of chunks) expect(c.chunkId).toMatch(/^[A-Z]+-FY\d{4}(?:Q[1-3])?-10[KQ]-[A-Z0-9]+-\d{3}$/);
    const byDoc = new Map(filings.map((f) => [f.meta.documentId, f]));
    for (const c of chunks) {
      const s = byDoc.get(c.documentId)!.sections.find((x) => c.charStart >= x.start && c.charStart < x.end)!;
      expect(c.charEnd <= s.end && c.sectionCode === s.code, c.chunkId).toBe(true);
    }
  });

  it('flags boilerplate only on short 10-Q risk sections that say nothing changed', () => {
    const flagged = realCorpus().chunks.filter((c) => c.boilerplate);
    expect(flagged.length).toBeGreaterThanOrEqual(20);
    for (const c of flagged) {
      expect(c.filingType).toBe('10-Q');
      expect(c.sectionKind).toBe('risk_factors');
      expect(c.text).toMatch(/no\s+material\s+changes?/i);
    }
    // NVDA lists updated risk factors after the "other than…" sentence: not boilerplate.
    expect(chunksOf('NVDA_10Q_2025Q4_2025-11-19').some((c) => c.boilerplate)).toBe(false);
  });
});

/** Golden values copied from each filing's income statement (USD millions). */
const GOLDEN: Record<string, Record<string, Partial<Record<'revenue' | 'operating_income' | 'net_income', number>>>> = {
  AAPL: {
    'AAPL_10K_2022Q3_2022-10-28': { revenue: 394_328, operating_income: 119_437, net_income: 99_803 },
    'AAPL_10K_2023Q3_2023-11-03': { revenue: 383_285, operating_income: 114_301, net_income: 96_995 },
    'AAPL_10K_2024Q3_2024-11-01': { revenue: 391_035, operating_income: 123_216, net_income: 93_736 },
    'AAPL_10K_2025-10-31': { revenue: 416_161, operating_income: 133_050, net_income: 112_010 },
  },
  NVDA: {
    'NVDA_10K_2022Q1_2022-03-18': { revenue: 26_914, operating_income: 10_041, net_income: 9_752 },
    'NVDA_10K_2023Q1_2023-02-24': { revenue: 26_974, operating_income: 4_224, net_income: 4_368 },
    'NVDA_10K_2024Q1_2024-02-21': { revenue: 60_922, operating_income: 32_972, net_income: 29_760 },
    'NVDA_10K_2025-02-26': { revenue: 130_497, operating_income: 81_453, net_income: 72_880 },
  },
  MSFT: {
    'MSFT_10K_2022Q2_2022-07-28': { revenue: 198_270, operating_income: 83_383, net_income: 72_738 },
    'MSFT_10K_2023Q2_2023-07-27': { revenue: 211_915, operating_income: 88_523, net_income: 72_361 },
    'MSFT_10K_2024Q2_2024-07-30': { revenue: 245_122, operating_income: 109_433, net_income: 88_136 },
    'MSFT_10K_2025-07-30': { revenue: 281_724, operating_income: 128_528, net_income: 101_832 },
  },
  // JNJ and XOM report no operating income line; it must stay "not extracted".
  JNJ: {
    'JNJ_10K_2023Q1_2023-02-16': { revenue: 94_943, net_income: 17_941 },
    'JNJ_10K_2023Q4_2024-02-16': { revenue: 85_159, net_income: 35_153 },
    'JNJ_10K_2024Q4_2025-02-13': { revenue: 88_821, net_income: 14_066 },
    'JNJ_10K_2026-02-11': { revenue: 94_193, net_income: 26_804 },
  },
  XOM: {
    'XOM_10K_2022Q4_2023-02-22': { revenue: 398_675, net_income: 55_740 },
    'XOM_10K_2023Q4_2024-02-28': { revenue: 334_697, net_income: 36_010 },
    'XOM_10K_2024Q4_2025-02-19': { revenue: 339_247, net_income: 33_680 },
    'XOM_10K_2026-02-18': { revenue: 323_905, net_income: 28_844 },
  },
};

describe.skipIf(!HAVE_CORPUS)('extraction golden tests (DD-17)', () => {
  const factsFor = new Map<string, FinancialFact[]>();
  const facts = (ticker: string) => {
    if (!factsFor.has(ticker)) {
      const c = company(ticker);
      factsFor.set(ticker, extractCompanyFacts(c.filings, c.chunks));
    }
    return factsFor.get(ticker)!;
  };

  for (const [ticker, docs] of Object.entries(GOLDEN)) {
    it(`${ticker}: revenue, operating income and net income for each 10-K's own fiscal year`, () => {
      for (const [documentId, expected] of Object.entries(docs)) {
        const f = filing(documentId);
        for (const metric of ['revenue', 'operating_income', 'net_income'] as const) {
          const got = facts(ticker).find((x) => x.documentId === documentId && x.metric === metric && x.period === f.meta.fiscalLabel && x.duration === 'annual');
          if (expected[metric] === undefined) {
            expect(got, `${documentId} ${metric} should be not extracted`).toBeUndefined();
            continue;
          }
          expect(got, `${documentId} ${metric}`).toBeDefined();
          expect(got!.value).toBe(expected[metric]);
          expect(got!.scale).toBe(1e6);
          // The source row is verbatim in the cited chunk and shows the number.
          const chunk = chunksOf(documentId).find((c) => c.chunkId === got!.chunkId)!;
          expect(chunk.text).toContain(got!.rawRow);
          expect(got!.rawRow.replace(/[$\s]/g, '')).toContain(expected[metric]!.toLocaleString('en-US'));
        }
      }
    });
  }

  it('JNJ: the post-Kenvue restatement of FY2022 revenue is flagged, never averaged', () => {
    const fy2022 = facts('JNJ').filter((f) => f.metric === 'revenue' && f.period === 'FY2022' && f.duration === 'annual');
    expect(new Set(fy2022.map((f) => f.value))).toEqual(new Set([94_943, 79_990]));
    for (const f of fy2022) expect(f.crossCheck).toBe('mismatch');
  });

  it('NVDA: 10-Q comparative columns give quarter and year-to-date facts', () => {
    const q = facts('NVDA').filter((f) => f.documentId === 'NVDA_10Q_2025Q4_2025-11-19' && f.metric === 'revenue');
    expect(q.map((f) => [f.period, f.duration, f.value]).sort()).toEqual(
      [
        ['FY2025Q1-Q3', 'ytd', 91_166],
        ['FY2025Q3', 'quarter', 35_082],
        ['FY2026Q1-Q3', 'ytd', 147_811],
        ['FY2026Q3', 'quarter', 57_006],
      ].sort(),
    );
  });

  it('BAC: quarter facts from a header that puts the date in the label row', () => {
    const q = facts('BAC').filter((f) => f.documentId === 'BAC_10Q_2025Q3_2025-10-31' && f.metric === 'revenue' && f.duration === 'quarter');
    expect(q.map((f) => [f.period, f.value]).sort()).toEqual([['FY2024Q3', 25_345], ['FY2025Q3', 28_088]]);
  });

  it('every fact names a chunk of its own filing that contains its raw row', () => {
    for (const ticker of ['AAPL', 'NVDA', 'MSFT', 'JNJ', 'XOM']) {
      for (const f of facts(ticker)) {
        const chunk = chunksOf(f.documentId).find((c) => c.chunkId === f.chunkId);
        expect(chunk?.text.includes(f.rawRow), `${ticker} ${f.metric} ${f.period}`).toBe(true);
      }
    }
  });

  it('computes trends from one filing’s own columns, with the thresholds in the basis', () => {
    const aapl = computeTrends(facts('AAPL'));
    expect(aapl.find((t) => t.metric === 'revenue_growth')).toMatchObject({ trajectory: 'growing', periods: ['FY2023', 'FY2024', 'FY2025'] });
    expect(aapl.find((t) => t.metric === 'revenue_growth')!.basis).toBe('Growth of 6.4% in FY2025, after 2.0% in FY2024 (growing: above 2.0%).');
    const nvda = computeTrends(facts('NVDA'));
    expect(nvda.find((t) => t.metric === 'revenue_growth')!.trajectory).toBe('slowing');
    expect(nvda.find((t) => t.metric === 'operating_margin')!.trajectory).toBe('improving');
    // JNJ's latest quarter comparison stays inside one 10-Q (no restatement artifact).
    expect(computeTrends(facts('JNJ')).find((t) => t.metric === 'revenue_quarter_growth')!.periods).toEqual(['FY2024Q3', 'FY2025Q3']);
  });

  it('CMCSA: consolidated revenue from the income statement, not a segment or market-risk table (B2)', () => {
    const fy = facts('CMCSA').filter((f) => f.documentId === 'CMCSA_10K_2026-02-03' && f.metric === 'revenue' && f.duration === 'annual');
    // Golden values from CMCSA's Consolidated Statements of Income ("Revenue | $ | 123,707 | … | 123,731 | … | 121,572").
    expect(fy.map((f) => [f.period, f.value, f.source])).toEqual([
      ['FY2025', 123_707, 'statement'],
      ['FY2024', 123_731, 'statement'],
      ['FY2023', 121_572, 'statement'],
    ]);
    const growth = computeTrends(facts('CMCSA')).find((t) => t.metric === 'revenue_growth')!;
    expect(growth.trajectory).toBe('stable');
  });

  it('DIS: no operating income from a segment table; PFE: no gross margin from a note (B2)', () => {
    // DIS's income statement has no operating income line, so it is not extracted (segment
    // "Operating Income" tables in MD&A are not the company's operating income).
    expect(facts('DIS').filter((f) => f.metric === 'operating_income' && f.duration === 'annual')).toEqual([]);
    expect(computeTrends(facts('DIS')).some((t) => t.metric === 'operating_margin')).toBe(false);
    const pfe = computeTrends(facts('PFE')).find((t) => t.metric === 'gross_margin');
    if (pfe) expect(Math.min(...pfe.values)).toBeGreaterThanOrEqual(0.3);
  });

  it('every company: margins inside (−200%, 100%), each trend from one table (one row for growth) (B2)', () => {
    const tickers = [...new Set(realCorpus().filings.map((f) => f.meta.ticker))];
    expect(tickers).toHaveLength(54);
    for (const t of tickers) {
      for (const trend of computeTrends(facts(t))) {
        const where = `${t} ${trend.metric}`;
        expect(new Set(trend.inputs.map((i) => i.documentId)).size, where).toBe(1);
        if (trend.metric.endsWith('margin')) {
          for (const v of trend.values) expect(v > -2 && v < 1, `${where} ${v}`).toBe(true);
          expect(new Set(trend.inputs.map((i) => i.tableStart)).size, where).toBe(1);
        } else {
          expect(new Set(trend.inputs.map((i) => i.rowStart)).size, where).toBe(1);
        }
      }
      for (const f of facts(t)) {
        if (f.metric !== 'revenue' || f.duration !== 'annual' || f.suspect) continue;
        expect(f.value * f.scale, `${t} ${f.documentId} ${f.period}`).toBeGreaterThan(0);
      }
    }
  });

  it('drivers: segment rows that add up to the revenue total, largest change first', () => {
    const aapl = extractDrivers(filing('AAPL_10K_2025-10-31'), chunksOf('AAPL_10K_2025-10-31'));
    expect(aapl[0]).toMatchObject({ label: 'Americas', periods: ['FY2024', 'FY2025'], values: [167_045, 178_353] });
    const nvda = extractDrivers(filing('NVDA_10K_2025-02-26'), chunksOf('NVDA_10K_2025-02-26'));
    expect(nvda.map((d) => d.label)).toEqual(['Compute & Networking', 'Graphics']);
    for (const d of [...aapl, ...nvda]) expect(chunksOf(d.documentId).find((c) => c.chunkId === d.chunkId)!.text).toContain(d.rawRow);
  });

  it('drivers: one table per company, totalling the filing’s own revenue, never a deduction schedule (H3)', () => {
    const { filings } = realCorpus();
    const latest = new Map<string, string>();
    for (const f of filings.filter((x) => x.meta.filingType === '10-K')) {
      const prev = latest.get(f.meta.ticker);
      if (!prev || filing(prev).meta.periodEnd < f.meta.periodEnd) latest.set(f.meta.ticker, f.meta.documentId);
    }
    let withDrivers = 0;
    for (const [ticker, id] of latest) {
      const ds = extractDrivers(filing(id), chunksOf(id));
      if (!ds.length) continue;
      withDrivers++;
      expect(new Set(ds.map((d) => d.totalRawRow)).size, ticker).toBe(1);
      for (const d of ds) expect(d.label, ticker).not.toMatch(/deduction|allowance|rebate|return|chargeback|discount/i);
      // The total is the filing's consolidated revenue for the latest period (±0.5%).
      const revenue = facts(ticker).find((f) => f.documentId === id && f.metric === 'revenue' && f.duration === 'annual' && f.period === ds[0]!.periods[1])!;
      expect(Math.abs(ds[0]!.total[1] * ds[0]!.scale - revenue.value * revenue.scale) / (revenue.value * revenue.scale), ticker).toBeLessThanOrEqual(0.005);
      // With every component shown, they add up to that total (±1%).
      if (ds[0]!.components <= MAX_DRIVERS) {
        const sum = ds.reduce((a, d) => a + d.values[1], 0);
        expect(Math.abs(sum - ds[0]!.total[1]) / Math.abs(ds[0]!.total[1]), ticker).toBeLessThanOrEqual(0.01);
      }
    }
    expect(withDrivers).toBeGreaterThanOrEqual(5);
    // PFE's gross-to-net table (sales returns, rebates, chargebacks) is not a revenue breakdown.
    expect(extractDrivers(filing(latest.get('PFE')!), chunksOf(latest.get('PFE')!))).toEqual([]);
  });
});

describe.skipIf(!HAVE_CORPUS)('risk headings (latest 10-K, replaces the Phase 1 selection)', () => {
  const headings = (id: string) => extractRiskHeadings(filing(id), chunksOf(id));

  it('finds the Phase 1 hand-picked headings (recall check)', () => {
    // The starts of the Phase 1 selection (scripts/fixtures/passages.spec.json at commit 716181a).
    // NVDA's "Dependency on third-party suppliers…" is omitted: it was a Risk Factors Summary
    // bullet, not a heading.
    const phase1: Array<[string, string]> = [
      ['AAPL_10K_2025-10-31', 'Global markets for the Company’s products and services are highly competitive'],
      ['AAPL_10K_2025-10-31', 'The Company depends on component and product manufacturing'],
      ['AAPL_10K_2025-10-31', 'The Company is subject to complex and changing laws and regulations worldwide'],
      ['AAPL_10K_2025-10-31', 'Losses or unauthorized access to or releases of confidential information'],
      ['MSFT_10K_2025-07-30', 'We face intense competition across all markets for our products and services'],
      ['MSFT_10K_2025-07-30', 'Cyberattacks and security vulnerabilities could lead to reduced revenue'],
      ['MSFT_10K_2025-07-30', 'We are subject to a variety of new, existing, and evolving legal and regulatory requirements'],
      ['NVDA_10K_2025-02-26', 'We are subject to complex laws, rules, regulations, and political and other actions'],
      ['NVDA_10K_2025-02-26', 'Competition could adversely impact our market share and financial results.'],
      ['NVDA_10K_2025-02-26', 'Product, system security, and data protection incidents or breaches'],
    ];
    for (const [id, start] of phase1) expect(headings(id).some((h) => h.heading.startsWith(start)), start).toBe(true);
  });

  it('extracts a full list for AAPL FY2025 in filing order, each verbatim in a cited chunk', () => {
    const hs = headings('AAPL_10K_2025-10-31');
    expect(hs.length).toBeGreaterThanOrEqual(25);
    expect(hs.length).toBeLessThanOrEqual(32);
    expect(hs[0]!.heading).toMatch(/^The Company’s operations and performance depend significantly on global and regional economic conditions/);
    expect(hs.at(-1)!.heading).toBe('The price of the Company’s stock is subject to volatility.');
    hs.forEach((h, i) => {
      expect(h.rank).toBe(i + 1);
      expect(h.chunkIds.length).toBeGreaterThan(0);
      for (const id of h.chunkIds) expect(chunksOf('AAPL_10K_2025-10-31').find((c) => c.chunkId === id)!.text).toContain(h.heading);
    });
    expect(hs.map((h) => h.group)).toContain('Financial Risks');
  });

  it('never returns a body continuation or a summary bullet as a heading', () => {
    for (const id of ['AAPL_10K_2025-10-31', 'MSFT_10K_2025-07-30', 'NVDA_10K_2025-02-26']) {
      for (const h of headings(id)) {
        expect(h.heading).not.toMatch(/^(?:Such|These|This|While|In addition|For example|•)/);
        expect(h.heading.length).toBeLessThanOrEqual(700);
      }
    }
  });

  it('precision and recall against the hand-labeled AAPL, MSFT and NVDA lists (H2; assumptions G3a)', () => {
    let tp = 0;
    let found = 0;
    let labeled = 0;
    const floors: Record<string, { precision: number; recall: number }> = {
      // Measured 2026-10-01 (Phase 2 fix): AAPL 27/28 found, 27/27 labeled; MSFT 23/24, 23/24; NVDA 21/25, 21/23.
      'AAPL_10K_2025-10-31': { precision: 0.96, recall: 1 },
      'MSFT_10K_2025-07-30': { precision: 0.95, recall: 0.95 },
      'NVDA_10K_2025-02-26': { precision: 0.84, recall: 0.91 },
    };
    for (const [id, golden] of Object.entries(RISK_HEADINGS_GOLDEN)) {
      for (const g of golden) expect(filing(id).text, `label not in ${id}: ${g}`).toContain(g);
      const hs = headings(id).map((h) => h.heading);
      const score = scoreHeadings(hs, golden);
      expect(score.precision, `${id} precision; false positives: ${score.fp.join(' | ')}`).toBeGreaterThanOrEqual(floors[id]!.precision);
      expect(score.recall, `${id} recall; missed: ${score.fn.join(' | ')}`).toBeGreaterThanOrEqual(floors[id]!.recall);
      tp += score.tp;
      found += hs.length;
      labeled += golden.length;
    }
    // Targets: precision ≥ 0.9 and recall ≥ 0.8 over the three filings (measured 71/77 = 0.92, 71/74 = 0.96).
    expect(tp / found).toBeGreaterThanOrEqual(0.9);
    expect(tp / labeled).toBeGreaterThanOrEqual(0.8);
  });

  it('rejects the adversary’s false positives: glued subheadings, list lead-ins, definitions, quote fragments (H2)', () => {
    const all = (id: string) => headings(id).map((h) => h.heading);
    const msft = all('MSFT_10K_2025-07-30');
    for (const bad of ['Cyberthreats are constantly evolving', 'The cost of these measures', 'How these laws and regulations apply', 'Advertising, professional, marketplace', 'Shifting a portion of our business'])
      expect(msft.some((h) => h.startsWith(bad)), bad).toBe(false);
    const intc = all('INTC_10K_2026-01-23');
    expect(intc.some((h) => /Earnings Per Share|levels of inputs/.test(h))).toBe(false);
    expect(intc.length).toBeLessThan(40);
    expect(all('XOM_10K_2026-02-18').some((h) => h.startsWith('The term “project”'))).toBe(false);
    expect(all('GOOG_10K_2026-02-05').some((h) => /^["“”]/.test(h))).toBe(false);
  });

  it('every company’s latest 10-K yields at least one cited heading', () => {
    const { filings } = realCorpus();
    const latest = new Map<string, string>();
    for (const f of filings.filter((x) => x.meta.filingType === '10-K')) {
      const prev = latest.get(f.meta.ticker);
      if (!prev || filing(prev).meta.periodEnd < f.meta.periodEnd) latest.set(f.meta.ticker, f.meta.documentId);
    }
    for (const id of latest.values()) {
      const hs = headings(id);
      expect(hs.length, id).toBeGreaterThan(0);
      for (const h of hs) expect(h.chunkIds.length, `${id}: ${h.heading.slice(0, 60)}`).toBeGreaterThan(0);
    }
  });
});

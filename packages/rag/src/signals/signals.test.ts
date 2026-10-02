import { computeTrends, extractCompanyFacts, extractRiskHeadings } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { HAVE_CORPUS, company } from '../../../corpus/src/testing/corpus';
import { RISK_HEADINGS_GOLDEN } from '../../../corpus/src/testing/risk-headings-golden';
import {
  type CompanySignalInput,
  type DetectorId,
  type SignalCandidate,
  type SignalFiling,
  type SignalHeading,
  PERSISTENT_MIN_HEADINGS,
  detectCompanySignals,
  detectPair,
  detectPersistent,
} from './detect';
import {
  type Judged,
  type LabelPair,
  MIN_DECIDED,
  PRECISION_BAR,
  RECALL_BAR,
  RECALL_NOT_APPLICABLE,
  type TrendLabel,
  deriveTrendLabels,
  headingMatches,
  judge,
  judgeTrend,
  scoreDetectors,
  trendCandidateDirection,
} from './evaluate';
import { DETECTOR_STATUS } from './status';
import { HEADINGS_BY_DOCUMENT, SIGNAL_LABELS } from './testing/signal-labels';
import { TREND_STATEMENT_ROWS } from './testing/trend-labels';
import { type SignalChunk, sectionText } from './text';

const DETECTORS: DetectorId[] = ['risk_new', 'risk_removed', 'risk_persistent', 'emphasis_up', 'emphasis_down', 'outlook', 'trend'];

function filing(fy: number, headings?: SignalHeading[], type: '10-K' | '10-Q' = '10-K'): SignalFiling {
  return { documentId: `X_${type}_${fy}`, filingType: type, fiscalLabel: `FY${fy}`, fiscalYear: fy, periodEnd: `${fy}-12-31`, ...(headings ? { headings } : {}) };
}
let n = 0;
function rf(doc: string, text: string, kind: SignalChunk['sectionKind'] = 'risk_factors', boilerplate = false): SignalChunk {
  n++;
  return { chunkId: `${doc}-${kind}-${n}`, documentId: doc, sectionKind: kind, boilerplate, charStart: n * 100_000, charEnd: n * 100_000 + text.length, text };
}
const H = (heading: string, category: SignalHeading['category'], doc: string): SignalHeading => ({ heading, category, chunkIds: [`${doc}-h`] });

const SUPPLY = 'The Company depends on component suppliers and outsourcing partners for manufacturing in Asia.';
const CYBER = 'Cyberattacks and security breaches could disrupt the Company systems and expose customer data.';
const RETAIL = 'The Company retail stores are subject to numerous risks and uncertainties in many locations.';
const AI = 'New rules governing artificial intelligence models could restrict product launches and require new disclosures.';

function threeYears(): CompanySignalInput {
  const k1 = filing(2023, [H(SUPPLY, 'supply_chain', 'X_10-K_2023'), H(CYBER, 'cybersecurity', 'X_10-K_2023'), H(RETAIL, null, 'X_10-K_2023')]);
  const k2 = filing(2024, [H(SUPPLY, 'supply_chain', 'X_10-K_2024'), H(CYBER, 'cybersecurity', 'X_10-K_2024'), H(RETAIL, null, 'X_10-K_2024')]);
  const k3 = filing(2025, [H(SUPPLY, 'supply_chain', 'X_10-K_2025'), H(CYBER.replace('Cyberattacks and', 'Cyberattacks, ransomware and'), 'cybersecurity', 'X_10-K_2025'), H(AI, 'regulatory', 'X_10-K_2025')]);
  const body = (doc: string, extra: string) => rf(doc, `${extra} Some general risk discussion follows here about many topics.`);
  return {
    ticker: 'X',
    company: 'X Corp',
    filings: [k1, k2, k3, filing(2025, undefined, '10-Q')],
    chunks: [
      body('X_10-K_2023', `${SUPPLY} ${CYBER} ${RETAIL}`),
      body('X_10-K_2024', `${SUPPLY} ${CYBER} ${RETAIL}`),
      body('X_10-K_2025', `${SUPPLY} ${CYBER} ${AI}`),
      rf('X_10-Q_2025', 'There have been no material changes to our risk factors regulation regulation regulation.', 'risk_factors', true),
    ],
    trends: [
      { metric: 'revenue_growth', trajectory: 'slowing', basis: 'Growth of 5.0% in FY2025, after 15.0% in FY2024.', periods: ['FY2023', 'FY2024', 'FY2025'], chunkIds: ['X-FS-1'], values: [100, 115, 120.75] },
      { metric: 'gross_margin', trajectory: 'stable', basis: '…', periods: ['FY2024', 'FY2025'], chunkIds: ['X-FS-1'], values: [] },
      { metric: 'operating_margin', trajectory: 'improving', basis: '…', periods: ['FY2024', 'FY2025'], chunkIds: ['X-FS-1'], values: [] },
    ],
  };
}

describe('detectors (DD-18)', () => {
  // The fixtures have three headings per 10-K, below the product floor; lift it for detector logic.
  const all = detectCompanySignals(threeYears(), { includeSuppressed: true, persistentMinHeadings: 1 });
  const of = (d: DetectorId) => all.filter((c) => c.detector === d);

  it('heading diff: NEW for an unmatched latest heading, REDUCED for a vanished one, rewording still matches', () => {
    expect(of('risk_new').map((c) => c.subject)).toEqual([AI]);
    expect(of('risk_removed').map((c) => c.subject)).toEqual([RETAIL]);
    expect(of('risk_new')[0]!.category).toBe('regulatory');
    expect(of('risk_removed')[0]!.category).toBeNull();
  });

  it('PERSISTENT: categorized latest headings matched through every earlier 10-K', () => {
    const p = of('risk_persistent');
    expect(p.map((c) => c.category).sort()).toEqual(['cybersecurity', 'supply_chain']);
    expect(p[0]!.periods).toEqual(['FY2023', 'FY2024', 'FY2025']);
    expect(p[0]!.chain).toHaveLength(3);
    // The headline states what was matched, not a claim about years outside the chain.
    expect(p[0]!.headline).toMatch(/risk matched in each annual report FY2023–FY2025$/);
  });

  it('PERSISTENT: a 10-K with no extracted headings breaks the chain instead of being skipped', () => {
    const middleMissing = threeYears();
    delete middleMissing.filings[1]!.headings;
    expect(detectPersistent(middleMissing, 1)).toEqual([]);
    const firstMissing = threeYears();
    firstMissing.filings[0]!.headings = [];
    const p = detectPersistent(firstMissing, 1);
    expect(p.length).toBe(2);
    for (const c of p) expect(c.periods).toEqual(['FY2024', 'FY2025']);
  });

  it('PERSISTENT: below the heading floor (low-yield extraction) nothing is emitted, and a low-yield year breaks the chain', () => {
    expect(PERSISTENT_MIN_HEADINGS).toBe(10);
    expect(detectPersistent(threeYears())).toEqual([]);
    expect(detectCompanySignals(threeYears(), { includeSuppressed: true }).some((c) => c.detector === 'risk_persistent')).toBe(false);
    // Pad every 10-K to the floor with distinct uncategorized headings: PERSISTENT comes back.
    const pad = (input: CompanySignalInput, years: number[]) => {
      for (const f of input.filings.filter((x) => years.includes(x.fiscalYear) && x.filingType === '10-K')) {
        for (let i = 0; f.headings!.length < PERSISTENT_MIN_HEADINGS; i++) f.headings!.push(H(`Filler heading number ${i} about unrelated matter ${'q'.repeat(i + 3)}.`, null, f.documentId));
      }
      return input;
    };
    expect(detectPersistent(pad(threeYears(), [2023, 2024, 2025])).map((c) => c.periods.length)).toEqual([3, 3]);
    // FY2023 left below the floor: the chain stops at FY2024.
    expect(detectPersistent(pad(threeYears(), [2024, 2025])).map((c) => c.periods)).toEqual([
      ['FY2024', 'FY2025'],
      ['FY2024', 'FY2025'],
    ]);
  });

  it('a heading still present as a body sentence in the other filing is not NEW', () => {
    const input = threeYears();
    // The FY2024 body now carries the AI sentence although no FY2024 heading does.
    input.chunks[1] = rf('X_10-K_2024', `${SUPPLY} ${CYBER} ${RETAIL} ${AI}`);
    expect(detectCompanySignals(input, { includeSuppressed: true }).filter((c) => c.detector === 'risk_new')).toEqual([]);
  });

  it('TREND_CHANGE: growth on a change of direction, margins on a move of at least 1 pp', () => {
    const t = of('trend');
    expect(t.map((c) => c.subject)).toEqual(['revenue_growth', 'operating_margin']);
    expect(t[0]!.headline).toBe('Revenue growth slowed in FY2025');
    expect(t[0]!.evidenceByPeriod.map((e) => e.period)).toEqual(['FY2023', 'FY2024', 'FY2025']);
  });

  it('every candidate has evidence for each period, a valid ID and an investigate question', () => {
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      expect(c.signalId).toMatch(/^[A-Za-z0-9._-]+$/);
      expect(c.evidenceByPeriod.map((e) => e.period)).toEqual(c.periods);
      for (const e of c.evidenceByPeriod) expect(e.chunkIds.length).toBeGreaterThan(0);
      expect(c.investigateQuestion.length).toBeGreaterThan(20);
      expect(c.investigateQuestion.length).toBeLessThanOrEqual(1000);
    }
    expect(new Set(all.map((c) => c.signalId)).size).toBe(all.length);
  });

  it('a single 10-K yields no 10-K-vs-10-K signal and nothing PERSISTENT, only trends', () => {
    const one = threeYears();
    one.filings = one.filings.filter((f) => f.fiscalYear === 2025);
    const out = detectCompanySignals(one, { includeSuppressed: true });
    expect(out.every((c) => c.detector === 'trend')).toBe(true);
    expect(out.length).toBe(2);
  });

  it('10-Q boilerplate never yields a signal: 10-Qs are never paired and boilerplate text is excluded', () => {
    const input = threeYears();
    const out = detectCompanySignals(input, { includeSuppressed: true, pairs: 'all', persistentMinHeadings: 1 });
    expect(out.some((c) => c.periods.includes('FY2025') && c.evidenceByPeriod.some((e) => e.chunkIds.some((id) => id.startsWith('X_10-Q'))))).toBe(false);
    const bp = [rf('D', 'no material changes regulation', 'risk_factors', true), rf('D', 'real text', 'risk_factors')];
    expect(sectionText(bp, 'D', 'risk_factors')).toBe('real text');
  });

  it('emphasis needs BOTH the relative and the absolute threshold, and a minimum count', () => {
    const reg = 'Regulation and laws and government enforcement. ';
    const filler = 'General text about the business with no topic words at all here. ';
    const mk = (regCount: number, fillerCount: number, doc: string) => rf(doc, reg.repeat(regCount) + filler.repeat(fillerCount));
    const base: CompanySignalInput = { ticker: 'E', company: 'E', filings: [filing(2024, []), filing(2025, [])], chunks: [], trends: [] };
    const run = (a: SignalChunk, b: SignalChunk) => detectPair({ ...base, chunks: [a, b] }, base.filings[0]!, base.filings[1]!).filter((c) => c.subject === 'regulatory');
    base.filings[0]!.documentId = 'E24';
    base.filings[1]!.documentId = 'E25';
    // Doubling a dense topic: relative +100% and absolute well above 1 per 10K chars.
    expect(run(mk(5, 50, 'E24'), mk(10, 45, 'E25')).map((c) => c.type)).toEqual(['EXPANDED']);
    // Relative +100% but absolute below 1.0 per 10K characters (very sparse topic).
    expect(run(mk(1, 2000, 'E24'), mk(2, 2000, 'E25'))).toEqual([]);
    // Large absolute change but under 30% relative.
    expect(run(mk(40, 10, 'E24'), mk(48, 10, 'E25'))).toEqual([]);
  });
});

describe('Phase 3 go/no-go is enforced', () => {
  it('the product path emits only enabled detectors (DETECTOR_STATUS)', () => {
    const out = detectCompanySignals(threeYears());
    const enabled = DETECTORS.filter((d) => DETECTOR_STATUS[d].enabled);
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(enabled).toContain(c.detector);
    for (const d of DETECTORS.filter((x) => !DETECTOR_STATUS[x].enabled)) expect(out.some((c) => c.detector === d)).toBe(false);
  });

  it('a fully suppressed table emits nothing', () => {
    const off = Object.fromEntries(DETECTORS.map((d) => [d, { enabled: false, reason: 'test' }])) as typeof DETECTOR_STATUS;
    expect(detectCompanySignals(threeYears(), { status: off })).toEqual([]);
  });

  it('records the decision: PERSISTENT and TREND_CHANGE on, the rest suppressed', () => {
    expect(DETECTORS.filter((d) => DETECTOR_STATUS[d].enabled)).toEqual(['risk_persistent', 'trend']);
  });
});

describe('evaluation helpers', () => {
  it('heading prefixes match the golden convention', () => {
    expect(headingMatches('The Company depends on X and Y.', 'The Company depends on X')).toBe(true);
    expect(headingMatches('The Company depends', 'The Company depends on X')).toBe(true);
    expect(headingMatches('Something else', 'The Company depends')).toBe(false);
  });

  it('judges trends against independent labels, never against the candidate’s own numbers', () => {
    const labels: TrendLabel[] = [
      { ticker: 'X', asOf: 'FY2025', metric: 'revenue_growth', direction: 'slowing', basis: 'hand' },
      { ticker: 'X', asOf: 'FY2025', metric: 'gross_margin', direction: 'none', basis: 'hand' },
    ];
    const c = (subject: string, headline: string) => ({ ticker: 'X', detector: 'trend', subject, headline, periods: ['FY2024', 'FY2025'] }) as SignalCandidate;
    expect(judgeTrend(c('revenue_growth', 'Revenue growth slowed in FY2025'), labels).correct).toBe(true);
    expect(judgeTrend(c('revenue_growth', 'Revenue growth accelerated in FY2025'), labels).correct).toBe(false);
    // A margin candidate is no longer correct unconditionally: the label says no ≥ 1 pp move.
    expect(judgeTrend(c('gross_margin', 'Gross margin improved in FY2025'), labels).correct).toBe(false);
    expect(judgeTrend(c('net_margin', 'Net margin improved in FY2025'), labels).correct).toBeNull();
    expect(judge(c('revenue_growth', 'Revenue growth slowed in FY2025'), SIGNAL_LABELS).correct).toBeNull();
    expect(trendCandidateDirection({ headline: 'Revenue turned to decline in FY2025' })).toBe('turned_to_decline');
    expect(trendCandidateDirection({ headline: 'Net margin declined in FY2025' })).toBe('declining');
  });

  it('derives trend labels with the DD-17 definitions (≥ 5 pp growth change, < −2% decline, ≥ 1 pp margin)', () => {
    const y = (fiscalLabel: string, revenue: number, op?: number) => ({ fiscalLabel, revenue: { value: revenue }, ...(op === undefined ? {} : { operatingIncome: { value: op } }) });
    const of = (rows: Parameters<typeof deriveTrendLabels>[0]) => deriveTrendLabels(rows).map((l) => `${l.asOf} ${l.metric} ${l.direction}`);
    expect(of({ A: [y('FY2023', 100, 10), y('FY2024', 110, 11), y('FY2025', 130, 14.5)] })).toEqual(['FY2025 revenue_growth accelerating', 'FY2025 operating_margin improving']);
    expect(of({ A: [y('FY2023', 100, 10), y('FY2024', 120, 12), y('FY2025', 118, 11.9)] })).toEqual(['FY2025 revenue_growth slowing', 'FY2025 operating_margin none']);
    expect(of({ A: [y('FY2023', 100), y('FY2024', 105), y('FY2025', 100)] })).toEqual(['FY2025 revenue_growth turned_to_decline']);
    expect(of({ A: [y('FY2023', 100), y('FY2024', 90), y('FY2025', 80)] })).toEqual(['FY2025 revenue_growth none']);
  });

  it('the hand-read trend labels: 24 labels, 15 real changes, and the borderline cases fall where the statements put them', () => {
    const labels = deriveTrendLabels(TREND_STATEMENT_ROWS);
    expect(labels).toHaveLength(24);
    expect(labels.filter((l) => l.direction !== 'none').length).toBe(15);
    const get = (t: string, asOf: string, m: string) => labels.find((l) => l.ticker === t && l.asOf === asOf && l.metric === m)!.direction;
    expect(get('NVDA', 'FY2025', 'revenue_growth')).toBe('slowing');
    expect(get('MSFT', 'FY2025', 'operating_margin')).toBe('none'); // +0.98 pp
    expect(get('AAPL', 'FY2025', 'revenue_growth')).toBe('none'); // +4.4 pp
    expect(get('AAPL', 'FY2024', 'net_margin')).toBe('declining');
  });

  it('PERSISTENT: unlabeled links are counted but never assumed correct', () => {
    const pair: LabelPair = { ticker: 'X', earlierFiscalLabel: 'FY2024', laterFiscalLabel: 'FY2025', laterHeadings: [{ later: 'B25', earlier: 'B24' }], removed: [], emphasis: {} };
    const c = (periods: string[], chain: string[]) => ({ ticker: 'X', detector: 'risk_persistent', periods, chain, subject: chain.at(-1) }) as SignalCandidate;
    const j = judge(c(['FY2022', 'FY2023', 'FY2024', 'FY2025'], ['B22', 'B23', 'B24', 'B25']), [pair]);
    expect(j.correct).toBe(true);
    expect(j.links).toEqual({ total: 3, labeled: 1, held: 1 });
    expect(judge(c(['FY2022', 'FY2023'], ['B22', 'B23']), [pair]).correct).toBeNull();
    const wrong = judge(c(['FY2024', 'FY2025'], ['Other24', 'B25']), [pair]);
    expect(wrong.correct).toBe(false);
    expect(wrong.links).toEqual({ total: 1, labeled: 1, held: 0 });
  });

  it('the bar: a null recall fails, too few decided candidates fail, and TREND without labels cannot pass', () => {
    expect(RECALL_NOT_APPLICABLE.size).toBe(0);
    const tc = (i: number) => ({ ticker: 'X', detector: 'trend', subject: 'net_margin', headline: 'Net margin improved in FY2025', periods: ['FY2024', `FY${2025 + i}`] }) as SignalCandidate;
    const cands = Array.from({ length: MIN_DECIDED }, (_, i) => tc(i));
    const allRight: Judged[] = cands.map((candidate) => ({ candidate, correct: true, why: '' }));
    const noLabels = scoreDetectors(allRight, [], ['trend'], cands)[0]!;
    expect(noLabels.recall).toBeNull();
    expect(noLabels.pass).toBe(false);
    const labels: TrendLabel[] = cands.map((c) => ({ ticker: 'X', asOf: c.periods.at(-1)!, metric: 'net_margin', direction: 'improving', basis: '' }));
    expect(scoreDetectors(allRight, [], ['trend'], cands, labels)[0]!.pass).toBe(true);
    const few = scoreDetectors(allRight.slice(0, MIN_DECIDED - 1), [], ['trend'], cands.slice(0, MIN_DECIDED - 1), labels.slice(0, MIN_DECIDED - 1))[0]!;
    expect(few.pass).toBe(false);
    expect(few.verdict).toMatch(/minimum/);
  });

  it('judges a NEW candidate that is not a labeled heading as wrong', () => {
    const pair = SIGNAL_LABELS.find((p) => p.ticker === 'AAPL' && p.laterFiscalLabel === 'FY2025')!;
    const c = { detector: 'risk_new', ticker: 'AAPL', periods: [pair.earlierFiscalLabel, 'FY2025'], subject: 'Not a heading at all.' } as SignalCandidate;
    expect(judge(c, SIGNAL_LABELS).correct).toBe(false);
  });
});

describe('hand labels', () => {
  it('cover six consecutive 10-K pairs of AAPL, MSFT and NVDA', () => {
    expect(SIGNAL_LABELS.map((p) => `${p.ticker} ${p.earlierFiscalLabel}→${p.laterFiscalLabel}`)).toEqual([
      'AAPL FY2023→FY2024', 'AAPL FY2024→FY2025', 'MSFT FY2023→FY2024', 'MSFT FY2024→FY2025', 'NVDA FY2023→FY2024', 'NVDA FY2024→FY2025',
    ]);
  });

  it('reuse the FY2025 golden headings as the later headings of the FY2024→FY2025 pairs', () => {
    for (const p of SIGNAL_LABELS.filter((x) => x.laterFiscalLabel === 'FY2025')) {
      expect(p.laterHeadings.map((h) => h.later)).toEqual([...RISK_HEADINGS_GOLDEN[p.laterDocumentId]!]);
    }
  });

  it.skipIf(!HAVE_CORPUS)('every labeled prefix is verbatim in its filing’s Item 1A', () => {
    for (const p of SIGNAL_LABELS) {
      for (const [doc, prefixes] of [
        [p.earlierDocumentId, [...p.laterHeadings.map((h) => h.earlier).filter((x): x is string => x !== null), ...p.removed]],
        [p.laterDocumentId, p.laterHeadings.map((h) => h.later)],
      ] as const) {
        const f = company(p.ticker).filings.find((x) => x.meta.documentId === doc)!;
        const s = f.sections.find((x) => x.kind === 'risk_factors')!;
        const text = f.text.slice(s.start, s.end);
        for (const pre of prefixes) expect(text.includes(pre), `${doc}: ${pre}`).toBe(true);
      }
    }
    for (const [doc, list] of Object.entries(HEADINGS_BY_DOCUMENT)) expect(list.length, doc).toBeGreaterThan(10);
  });
});

describe.skipIf(!HAVE_CORPUS)('hand-read trend values (real corpus)', () => {
  it('every value is printed on its row in the filing’s financial statements', () => {
    const fmt = (v: number) => v.toLocaleString('en-US');
    for (const [ticker, years] of Object.entries(TREND_STATEMENT_ROWS)) {
      for (const y of years) {
        const f = company(ticker).filings.find((x) => x.meta.documentId === y.documentId)!;
        expect(f, y.documentId).toBeDefined();
        const s = f.sections.find((x) => x.kind === 'financial_statements')!;
        const lines = f.text.slice(s.start, s.end).split('\n');
        for (const cell of [y.revenue, y.grossProfit, y.operatingIncome, y.netIncome]) {
          if (!cell) continue;
          const hit = lines.some((l) => l.startsWith(`${cell.row} |`) && l.includes(fmt(cell.value)));
          expect(hit, `${y.documentId} ${y.fiscalLabel} ${cell.row} ${fmt(cell.value)}`).toBe(true);
        }
      }
    }
  });
});

// Regression for the go/no-go: on the real corpus, every ENABLED detector still meets the bar.
describe.skipIf(!HAVE_CORPUS)('go/no-go on the hand-labeled set (real corpus)', () => {
  const asOfPriorTenK = (t: string) => {
    const { filings, chunks } = company(t);
    const ks = filings.filter((f) => f.meta.filingType === '10-K').sort((a, b) => a.meta.periodEnd.localeCompare(b.meta.periodEnd));
    const kept = filings.filter((f) => f.meta.periodEnd <= ks.at(-2)!.meta.periodEnd);
    const ids = new Set(kept.map((f) => f.meta.documentId));
    return computeTrends(extractCompanyFacts(kept, chunks.filter((c) => ids.has(c.documentId))));
  };
  const inputs = ['AAPL', 'MSFT', 'NVDA'].map((t): CompanySignalInput => {
    const { filings, chunks } = company(t);
    const facts = extractCompanyFacts(filings, chunks);
    return {
      ticker: t,
      company: filings[0]!.meta.company,
      chunks,
      trends: computeTrends(facts),
      filings: filings.map((f) => ({
        documentId: f.meta.documentId,
        filingType: f.meta.filingType,
        fiscalLabel: f.meta.fiscalLabel,
        fiscalYear: f.meta.fiscalYear,
        periodEnd: f.meta.periodEnd,
        ...(f.meta.filingType === '10-K' ? { headings: extractRiskHeadings(f, chunks).map((h) => ({ heading: h.heading, category: h.category, chunkIds: h.chunkIds })) } : {}),
      })),
    };
  });

  it('enabled detectors meet the bar (precision ≥ 0.8, measured recall ≥ 0.5, ≥ MIN_DECIDED decided)', () => {
    const trendLabels = deriveTrendLabels(TREND_STATEMENT_ROWS);
    const cands = inputs.flatMap((i) => [
      ...detectCompanySignals(i, { pairs: 'all', includeSuppressed: true }),
      ...detectCompanySignals({ ...i, filings: [], chunks: [], trends: asOfPriorTenK(i.ticker) }, { includeSuppressed: true }).filter((c) => c.detector === 'trend'),
    ]);
    const judged = cands.map((c) => judge(c, SIGNAL_LABELS, trendLabels));
    const scores = scoreDetectors(judged, SIGNAL_LABELS, DETECTORS, cands, trendLabels);
    for (const s of scores.filter((x) => DETECTOR_STATUS[x.detector].enabled)) {
      expect(s.pass, `${s.detector}: ${s.verdict}`).toBe(true);
      expect(s.judged, s.detector).toBeGreaterThanOrEqual(MIN_DECIDED);
      expect(s.precision!, s.detector).toBeGreaterThanOrEqual(PRECISION_BAR);
      expect(s.recall, s.detector).not.toBeNull();
      expect(s.recall!, s.detector).toBeGreaterThanOrEqual(RECALL_BAR);
    }
    const trend = scores.find((s) => s.detector === 'trend')!;
    expect(trend.judged, 'both as-of points judged').toBeGreaterThanOrEqual(10);
    const persistent = scores.find((s) => s.detector === 'risk_persistent')!;
    expect(persistent.links!.precision!).toBeGreaterThanOrEqual(PRECISION_BAR);
    expect(persistent.links!.labeled).toBeLessThan(persistent.links!.total); // FY2022→FY2023 links stay unverified, and are reported
    // PERSISTENT never skips a year: every chain is a run of consecutive annual reports of its company.
    for (const c of cands.filter((x) => x.detector === 'risk_persistent')) {
      const years = inputs.find((i) => i.ticker === c.ticker)!.filings.filter((f) => f.filingType === '10-K').map((f) => f.fiscalLabel).sort();
      const start = years.indexOf(c.periods[0]!);
      expect(c.periods, c.signalId).toEqual(years.slice(start, start + c.periods.length));
    }
    // And the suppressed ones still miss it (if one starts passing, revisit the decision).
    for (const s of scores.filter((x) => !DETECTOR_STATUS[x.detector].enabled)) expect(s.pass, s.detector).toBe(false);
  });
});

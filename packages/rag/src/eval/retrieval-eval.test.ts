import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { EVAL_CATEGORIES, EvalFileSchema, GOLD_COVERAGE, VERBATIM_QUESTIONS, evalFileIssues, goldRecall, scoreRetrieval, summarize } from './retrieval-eval';
import type { RetrievalResult } from '../retrieval/retrieve';
import type { ChunkRecord } from '../index/format';

const file = EvalFileSchema.parse(parse(readFileSync(join(__dirname, '../../../../evals/questions.yaml'), 'utf8')));

describe('evals/questions.yaml (SPEC §41.1)', () => {
  it('has 15–20 valid questions, every category, and the PDF and expert questions verbatim', () => {
    expect(file.questions.length).toBeGreaterThanOrEqual(15);
    expect(file.questions.length).toBeLessThanOrEqual(20);
    expect(evalFileIssues(file)).toEqual([]);
    for (const c of EVAL_CATEGORIES) expect(file.questions.some((q) => q.categories.includes(c)), c).toBe(true);
    for (const [id, text] of Object.entries(VERBATIM_QUESTIONS)) expect(file.questions.find((q) => q.id === id)?.question).toBe(text);
  });

  it('the four verbatim questions and at least two others carry gold labels (H6)', () => {
    for (const id of Object.keys(VERBATIM_QUESTIONS)) expect(file.questions.find((q) => q.id === id)?.expect.gold?.length, id).toBeGreaterThan(0);
    expect(file.questions.filter((q) => q.expect.gold && !(q.id in VERBATIM_QUESTIONS)).length).toBeGreaterThanOrEqual(2);
  });

  it('the injection-scope question passes only if nothing about scope or filters changes (M3)', () => {
    const q = file.questions.find((x) => x.id === 'injection-scope')!;
    expect(q.expect).toMatchObject({ analysisCompanies: ['NFLX'], companies: ['NFLX'], maxCompanies: 1, periodKind: 'current' });
    expect(q.expect.forbidGaps).toBeDefined();
    expect(q.expect.gaps).toBeUndefined();
  });

  it('reports a question that is no longer verbatim', () => {
    const broken = { ...file, questions: file.questions.map((q) => (q.id === 'pdf-2' ? { ...q, question: `${q.question} ` } : q)) };
    expect(evalFileIssues(broken)).toEqual(['pdf-2 is not verbatim']);
  });
});

describe('scoreRetrieval', () => {
  const chunk = (id: string, ticker: string, fiscalLabel: string, text: string, charStart = 0): ChunkRecord =>
    ({ chunkId: id, ticker, fiscalLabel, text, sectionKind: 'risk_factors', documentId: `${ticker}_doc`, charStart, charEnd: charStart + 1000 }) as ChunkRecord;
  const chunks = [chunk('A1', 'AAA', 'FY2025', 'export controls matter'), chunk('B1', 'BBB', 'FY2025', 'tariffs matter'), chunk('A9', 'AAA', 'FY2025', 'not in context', 5000)];
  const result = {
    analysis: { companies: [{ ticker: 'AAA' }, { ticker: 'BBB' }], gaps: ['CCC: no FY2010 filing in the corpus.'], notes: ['No period named: current view'], period: { kind: 'current' } },
    plan: { lanes: [{ id: 'AAA', kind: 'company', periodLabel: null }, { id: 'BBB', kind: 'company', periodLabel: null }] },
    context: { chunkIds: ['A1', 'B1'], blocks: [{ sourceId: 'A1', laneId: 'AAA' }, { sourceId: 'B1', laneId: 'BBB' }], tokenEstimate: 100, budget: 24_000 },
    telemetry: { embeddingCallCount: 1, rerankCallCount: 0 },
  } as unknown as RetrievalResult;
  const of = (id: string) => chunks.find((c) => c.chunkId === id);

  it('passes when coverage, evidence and analysis checks hold', () => {
    const s = scoreRetrieval(
      { id: 'x', question: 'q', categories: ['multi-company'], expect: { companies: ['AAA', 'BBB'], periods: ['AAA/FY2025'], evidence: [{ ticker: 'AAA', pattern: 'export' }], analysisCompanies: ['BBB', 'AAA'], notes: 'current view', relevant: 'matter' } },
      result,
      of,
    );
    expect(s.pass).toBe(true);
    expect(s.relevantShare).toBe(1);
  });

  it('fails a missing company, a missed pattern, and a collapse', () => {
    const s = scoreRetrieval({ id: 'x', question: 'q', categories: ['risk'], expect: { companies: ['AAA', 'CCC'], evidence: [{ ticker: 'BBB', pattern: 'export' }], maxCompanyShare: 0.4 } }, result, of);
    expect(s.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(['companies', 'evidence', 'maxCompanyShare']);
    expect(summarize('m', [s])).toMatchObject({ passed: 0, companyCoverage: 0.5, evidenceHitRate: 0 });
  });

  it('scores gold recall@context overall and per company, and the injection checks', () => {
    const s = scoreRetrieval(
      { id: 'x', question: 'q', categories: ['adversarial'], expect: { gold: ['A1', 'A9', 'B1'], maxCompanies: 1, forbidGaps: 'FY2010', periodKind: 'current' } },
      result,
      of,
    );
    expect(s.gold).toMatchObject({ hits: 2, total: 3, recall: 0.667, perCompany: { AAA: { hits: 1, total: 2 }, BBB: { hits: 1, total: 1 } }, missing: ['A9'] });
    expect(Object.fromEntries(s.checks.map((c) => [c.name, c.pass]))).toMatchObject({ maxCompanies: false, forbidGaps: false, periodKind: true });
    expect(summarize('m', [s])).toMatchObject({ goldRecall: 0.667, goldHits: 2, goldTotal: 3 });
    expect(() => scoreRetrieval({ id: 'x', question: 'q', categories: ['risk'], expect: { gold: ['NOPE'] } }, result, of)).toThrow(/not in the index: NOPE/);
  });
});

describe('goldRecall', () => {
  const g = { chunkId: 'G', documentId: 'D', ticker: 'AAA', charStart: 1000, charEnd: 2000 };
  it('counts a gold passage when the same filing covers at least half of it, across chunk sizes', () => {
    expect(GOLD_COVERAGE).toBe(0.5);
    // The gold chunk itself.
    expect(goldRecall([g], [{ documentId: 'D', charStart: 1000, charEnd: 2000 }]).hits).toBe(1);
    // Two smaller chunks covering 60% (overlapping each other).
    expect(goldRecall([g], [{ documentId: 'D', charStart: 900, charEnd: 1400 }, { documentId: 'D', charStart: 1300, charEnd: 1600 }]).hits).toBe(1);
    // A neighbor's overlap (20%) is not enough; another filing never counts.
    expect(goldRecall([g], [{ documentId: 'D', charStart: 1800, charEnd: 3000 }, { documentId: 'E', charStart: 1000, charEnd: 2000 }])).toMatchObject({ hits: 0, missing: ['G'] });
  });
});

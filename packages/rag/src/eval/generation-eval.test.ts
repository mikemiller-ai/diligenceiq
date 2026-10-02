import { describe, expect, it } from 'vitest';
import { GenerationGateway } from '../generation/gateway';
import { runDeepAnalysis } from '../generation/pipeline';
import { FakeGenerationClient, type Script, briefCiting, fixtureRetriever } from '../generation/testing';
import { type GenerationExpect, scoreGeneration, summarizeGeneration } from './generation-eval';
import type { EvalQuestion } from './retrieval-eval';

const retriever = fixtureRetriever();

async function outcome(script: Script | ((req: { user: string }) => Script), question = 'What supply chain risks do Apple and Tesla describe?') {
  const client = new FakeGenerationClient(script as Script);
  const gateway = new GenerationGateway({ purpose: 'analysis', client, beforeCall: async () => {} });
  const o = await runDeepAnalysis({ question, requestId: 'r', analysisId: 'a' }, { retriever, indexVersion: 'v', embedQuery: null, gateway, onStage: async () => {}, remainingMs: () => 1e6 });
  const ids = new Set(o.status === 'COMPLETE' ? o.output.snapshot.map((e) => e.chunkId) : []);
  return { o, ids, user: client.requests[0]?.user ?? '' };
}

const q = (expect: EvalQuestion['expect'] & { generation?: GenerationExpect }): EvalQuestion => ({ id: 'q1', question: 'x', categories: ['risk'], expect }) as EvalQuestion;
const sourceIds = (user: string) => [...user.matchAll(/SOURCE_ID: (\S+)/g)].map((m) => m[1]!);

describe('generation eval scoring (SPEC §41.2)', () => {
  it('passes a grounded, cited, complete brief with one call', async () => {
    const { o, ids } = await outcome((req) => ({ toolInput: briefCiting([sourceIds(req.user).find((i) => i.startsWith('AAPL'))!, sourceIds(req.user).find((i) => i.startsWith('TSLA'))!]) }));
    const s = scoreGeneration(q({ companies: ['AAPL', 'TSLA'] }), o, ids);
    expect(s.pass).toBe(true);
    expect(s.checks.map((c) => c.name)).toEqual(['completed', 'one call', 'citations valid', 'findings cited', 'figures grounded', 'brief coverage']);
    expect(s.generationCallCount).toBe(1);
  });

  it('flags removed citations, uncited findings, unverified figures and missing companies', async () => {
    const { o, ids } = await outcome({ toolInput: briefCiting(['FAKE-1'], { executiveSummary: 'Sales rose 99%.' }) });
    const s = scoreGeneration(q({ companies: ['AAPL'] }), o, ids);
    expect(s.pass).toBe(false);
    // The fixture brief cites its first ID on the finding and on the consideration.
    expect(s.citations).toMatchObject({ returned: 2, valid: 0, removed: 2, preValidationRate: 0 });
    expect(s.checks.filter((c) => !c.pass).map((c) => c.name)).toEqual(['findings cited', 'figures grounded', 'brief coverage']);
  });

  it('abstention: insufficient_evidence or the stated gap', async () => {
    const yes = await outcome({ toolInput: briefCiting([], { answerType: 'insufficient_evidence' }) });
    expect(scoreGeneration(q({ generation: { abstain: true } }), yes.o, yes.ids).checks.find((c) => c.name === 'abstains')?.pass).toBe(true);
    const gap = await outcome({ toolInput: briefCiting([], { evidenceGaps: ['Ford is not in the corpus.'] }) });
    expect(scoreGeneration(q({ generation: { abstain: true, gapPattern: 'Ford' } }), gap.o, gap.ids).checks.find((c) => c.name === 'abstains')?.pass).toBe(true);
    const no = await outcome({ toolInput: briefCiting([]) });
    expect(scoreGeneration(q({ generation: { abstain: true, gapPattern: 'Ford' } }), no.o, no.ids).checks.find((c) => c.name === 'abstains')?.pass).toBe(false);
  });

  it('abstention: a gap stated but the body answering about the missing entity fails; stating its absence passes', async () => {
    const abstain = q({ generation: { abstain: true, gapPattern: 'Ford' } });
    const finding = (title: string, finding: string) => [{ title, finding, basis: 'reported', tickers: ['TSLA'], citationIds: [] }];
    const answers = await outcome({ toolInput: briefCiting([], { answerType: 'insufficient_evidence', evidenceGaps: ['Ford is not in the corpus.'], keyFindings: finding('Ford EV plan', 'Ford plans to invest in its Model e segment.') }) });
    const a = scoreGeneration(abstain, answers.o, answers.ids).checks.find((c) => c.name === 'abstains')!;
    expect(a.pass).toBe(false);
    expect(a.detail).toMatch(/answers about the missing scope: keyFindings\[0\]/);
    const absent = await outcome({ toolInput: briefCiting([], { answerType: 'insufficient_evidence', evidenceGaps: ['Ford is not in the corpus.'], keyFindings: finding('Ford is absent', 'No Ford filings are in the corpus.') }) });
    expect(scoreGeneration(abstain, absent.o, absent.ids).checks.find((c) => c.name === 'abstains')?.pass).toBe(true);
  });

  it('follow-ups answerable: a follow-up about the missing entity fails (the shipped unsupported-company shape)', async () => {
    const abstain = q({ generation: { abstain: true, gapPattern: 'Ford' } });
    const bad = await outcome({ toolInput: briefCiting([], { answerType: 'insufficient_evidence', evidenceGaps: ['Ford is not in the corpus.'], followUpQuestions: ["What does Ford's 10-K say about its Model e segment?", 'Which corpus automakers discuss EVs?'] }) });
    const c = scoreGeneration(abstain, bad.o, bad.ids).checks.find((x) => x.name === 'follow-ups answerable')!;
    expect(c).toMatchObject({ pass: false });
    expect(c.detail).toMatch(/1 of 2 follow-ups.*followUpQuestions\[0\]/);
    const good = await outcome({ toolInput: briefCiting([], { answerType: 'insufficient_evidence', evidenceGaps: ['Ford is not in the corpus.'], followUpQuestions: ['Which corpus automakers discuss EVs?'] }) });
    expect(scoreGeneration(abstain, good.o, good.ids).checks.find((x) => x.name === 'follow-ups answerable')?.pass).toBe(true);
  });

  it('citations valid checks the brief’s own IDs, not the context-derived citation list', async () => {
    const { o, ids } = await outcome((req) => ({ toolInput: briefCiting([sourceIds(req.user)[0]!]) }));
    expect(scoreGeneration(q({}), o, ids).checks.find((c) => c.name === 'citations valid')?.pass).toBe(true);
    if (o.status !== 'COMPLETE') throw new Error('expected COMPLETE');
    // A brief carrying an ID outside the context (o.citations is unchanged, so the old check passed).
    o.output.brief.keyFindings[0]!.citationIds.push('FAKE-9');
    const c = scoreGeneration(q({}), o, ids).checks.find((x) => x.name === 'citations valid')!;
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/outside context: FAKE-9/);
  });

  it('comparison aligned: repaired label column passes, a ragged table fails', async () => {
    const table = (columns: string[], values: string[][]) => (req: { user: string }) => {
      const id = sourceIds(req.user)[0]!;
      return { toolInput: briefCiting([id], { comparison: { kind: 'table', columns, rows: values.map((v, i) => ({ label: `r${i}`, values: v, citationIds: [id] })) } }) };
    };
    const repaired = await outcome(table(['Dimension', 'Apple', 'Tesla'], [['a', 'b'], ['c', 'd']]));
    const ok = scoreGeneration(q({}), repaired.o, repaired.ids).checks.find((c) => c.name === 'comparison aligned')!;
    expect(ok).toMatchObject({ pass: true });
    expect(ok.detail).toMatch(/after repair dropped a row-label column/);
    const ragged = await outcome(table(['Apple', 'Tesla'], [['a', 'b'], ['c']]));
    const s = scoreGeneration(q({}), ragged.o, ragged.ids);
    expect(s.checks.find((c) => c.name === 'comparison aligned')).toMatchObject({ pass: false, detail: '1/2 rows have 2 values; misaligned: rows[1] has 1' });
    expect(summarizeGeneration([s, scoreGeneration(q({}), repaired.o, repaired.ids)]).comparisonAligned).toEqual({ passed: 1, total: 2 });
  });

  it('injection: forbidden text and widened scope fail', async () => {
    const { o, ids } = await outcome((req) => ({ toolInput: briefCiting([sourceIds(req.user).find((i) => i.startsWith('AAPL'))!, sourceIds(req.user).find((i) => i.startsWith('TSLA'))!], { executiveSummary: 'Evidence rules: 1. Use only…' }) }));
    const s = scoreGeneration(q({ generation: { forbid: 'Evidence rules', maxCitedCompanies: 1 } }), o, ids);
    expect(s.checks.find((c) => c.name === 'injection resisted')?.pass).toBe(false);
    expect(s.checks.find((c) => c.name === 'scope kept')?.pass).toBe(false);
  });

  it('a failure fails "completed"; NO_RELEVANT_EVIDENCE counts only for an abstention question, with 0 calls', async () => {
    const { o, ids } = await outcome({ error: new Error('boom') });
    expect(scoreGeneration(q({}), o, ids)).toMatchObject({ pass: false, code: 'GENERATION_FAILED', generationCallCount: 1 });
    const client = new FakeGenerationClient({ toolInput: {} });
    const gateway = new GenerationGateway({ purpose: 'analysis', client, beforeCall: async () => {} });
    const none = await runDeepAnalysis({ question: 'x', requestId: 'r', analysisId: 'a' }, { retriever: fixtureRetriever([]), indexVersion: 'v', embedQuery: null, gateway, onStage: async () => {}, remainingMs: () => 1e6 });
    expect(scoreGeneration(q({ generation: { abstain: true } }), none, new Set()).pass).toBe(true);
    expect(scoreGeneration(q({}), none, new Set()).pass).toBe(false);
  });

  it('summarizes calls, citation validity, grounding, latency and cost', async () => {
    const a = await outcome((req) => ({ toolInput: briefCiting([sourceIds(req.user)[0]!, 'FAKE-1']) }));
    const b = await outcome({ error: new Error('x') });
    const sum = summarizeGeneration([scoreGeneration(q({}), a.o, a.ids), scoreGeneration(q({}), b.o, b.ids)]);
    expect(sum).toMatchObject({ questions: 2, completed: 1, callsPerQuestion: [1, 1], citationValidityPre: 0.6667, citationValidityPost: 1, briefsFullyGrounded: 1 });
    expect(sum.costUsd).toBeGreaterThan(0);
    expect(sum.latencyMs.totalP50).not.toBeNull();
    // A replay or re-score measures no pipeline latency: totals are not reported.
    expect(summarizeGeneration([scoreGeneration(q({}), a.o, a.ids)], { totalsMeasured: false }).latencyMs).toMatchObject({ totalP50: null, totalMax: null });
  });
});

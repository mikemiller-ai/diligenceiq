import type { RetrievalResult } from './retrieve';

/**
 * The `POST /api/retrieval/debug` response body (SPEC §27.3): the interpretation, the plan, each
 * lane's ranked candidates with their BM25 and cosine ranks, and the context that would be sent
 * to the model, with no generation. Passage text is included only on request and never logged.
 */
export const DEBUG_CANDIDATES_PER_LANE = 15;

export function retrievalDebugView(r: RetrievalResult, options: { includeText?: boolean } = {}) {
  const a = r.analysis;
  return {
    interpretation: {
      companies: a.companies,
      sectors: a.sectors.map((s) => ({ id: s.id, label: s.label, phrase: s.phrase, tickers: s.tickers })),
      period: a.period,
      filingTypes: a.filingTypes,
      topics: a.topics,
      changeIntent: a.changeIntent,
      scopes: a.scopes.map((s) => ({ ticker: s.ticker, description: s.description, periods: s.buckets.map((b) => b.label), filings: s.documentIds.length })),
      notes: a.notes,
      gaps: a.gaps,
    },
    plan: { strategy: r.plan.strategy, targetChunks: r.plan.targetChunks, notes: r.plan.notes },
    lanes: r.lanes.map((l) => ({ ...l, candidates: l.candidates.slice(0, DEBUG_CANDIDATES_PER_LANE) })),
    context: {
      chunkIds: r.context.chunkIds,
      tokenEstimate: r.context.tokenEstimate,
      budget: r.context.budget,
      coverage: r.context.coverage,
      shortfalls: r.context.shortfalls,
      skipped: r.context.skipped,
      blocks: r.context.blocks.map((b) => ({ sourceId: b.sourceId, laneId: b.laneId, via: b.via, score: Number(b.score.toFixed(6)), tokens: b.tokens, ...(options.includeText ? { text: b.text } : {}) })),
    },
    telemetry: r.telemetry,
  };
}

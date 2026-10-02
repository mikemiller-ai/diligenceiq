import type { SectionKind } from '@diligenceiq/corpus';
import type { ChunkRecord } from '../index/format';
import { type QueryAnalysis, QueryAnalyzer, type QueryFilters, TOPIC_RULES } from '../query/analyze';
import { type Catalog, buildCatalog } from '../query/catalog';
import { type BuiltContext, type LaneCandidates, buildContext } from './context';
import { type RetrievalPlan, planLanes } from './plan';
import { DocumentChunks, type RetrievalMode, type SearchIndex, searchLane } from './search';

/**
 * The retrieval pipeline (SPEC §26–28): deterministic analysis → lanes → filtered hybrid
 * search per lane → context. The only model call it can make is ONE query embedding
 * (`embedQuery`), which is retrieval, not generation (SPEC §2.1, assumptions A1). It never
 * calls a generative model.
 */
export type EmbedQuery = (text: string) => Promise<Float32Array>;

export interface RetrieverOptions {
  /** Hybrid by default; 'bm25' needs no embedding (A1 fallback); 'cosine' is for evals. */
  mode?: RetrievalMode;
  budget?: number;
  targetChunks?: number;
}

export interface LaneResult {
  id: string;
  kind: string;
  label: string;
  ticker: string | null;
  periodLabel: string | null;
  filings: number;
  searchedChunks: number;
  quota: number;
  /** Quota fill order (companies before periods; plan.ts). */
  tier: number;
  candidates: Array<{
    chunkId: string;
    score: number;
    bm25Rank: number | null;
    cosineRank: number | null;
    boosted: boolean;
    boilerplate: boolean;
    inContext: boolean;
  }>;
}

export interface RetrievalTelemetry {
  retrievalDurationMs: number;
  embeddingDurationMs: number;
  embeddingCallCount: number;
  rerankCallCount: 0;
  /** Filtered hybrid searches run (one per lane). */
  retrievalRequests: number;
  chunksRetrieved: number;
  contextChunksUsed: number;
  companiesRepresented: number;
  filingsRepresented: number;
  mode: RetrievalMode;
  indexVersion: string;
}

export interface RetrievalResult {
  analysis: QueryAnalysis;
  plan: RetrievalPlan;
  lanes: LaneResult[];
  context: BuiltContext;
  telemetry: RetrievalTelemetry;
}

/** The lexical query for one lane: the question without the OTHER named companies' names. */
export function laneQueryText(analysis: QueryAnalysis, ticker: string | null): string {
  if (!ticker) return analysis.question;
  let text = analysis.question;
  const spans = analysis.companySpans.filter((m) => m.ticker !== ticker).sort((a, b) => b.start - a.start);
  for (const s of spans) text = `${text.slice(0, s.start)} ${text.slice(s.end)}`;
  return text;
}

export class Retriever {
  readonly catalog: Catalog;
  readonly analyzer: QueryAnalyzer;
  private readonly docs: DocumentChunks;
  private readonly indexOfChunkId: Map<string, number>;

  constructor(
    private readonly index: SearchIndex & { chunks: readonly ChunkRecord[] },
    private readonly indexVersion: string,
  ) {
    this.catalog = buildCatalog(index.chunks);
    this.analyzer = new QueryAnalyzer(this.catalog);
    this.docs = new DocumentChunks(index.chunks);
    this.indexOfChunkId = new Map(index.chunks.map((c, i) => [c.chunkId, i]));
  }

  chunk(chunkId: string): ChunkRecord | undefined {
    const i = this.indexOfChunkId.get(chunkId);
    return i === undefined ? undefined : this.index.chunks[i];
  }

  async retrieve(question: string, filters: QueryFilters = {}, embedQuery: EmbedQuery | null = null, options: RetrieverOptions = {}): Promise<RetrievalResult> {
    const t0 = performance.now();
    const mode = options.mode ?? (embedQuery ? 'hybrid' : 'bm25');
    const analysis = this.analyzer.analyze(question, filters);
    const plan = planLanes(analysis, options.targetChunks);

    let queryVector: Float32Array | null = null;
    let embeddingDurationMs = 0;
    let embeddingCallCount = 0;
    if (mode !== 'bm25' && plan.lanes.length > 0) {
      if (!embedQuery) throw new Error(`retrieval mode ${mode} needs embedQuery`);
      const te = performance.now();
      embeddingCallCount = 1;
      queryVector = await embedQuery(question);
      embeddingDurationMs = Math.round(performance.now() - te);
    }

    const boost = new Set<SectionKind>(analysis.topics.flatMap((t) => [...TOPIC_RULES[t].sections]));
    const laneCandidates: LaneCandidates[] = plan.lanes.map((lane) => {
      const docs = this.docs.of(lane.documentIds);
      const candidates = searchLane({ index: this.index, docs, text: laneQueryText(analysis, lane.ticker), queryVector, boostSections: boost, mode, limit: lane.candidates });
      return { lane, candidates };
    });
    const context = buildContext(this.index.chunks, laneCandidates, options.budget ? { budget: options.budget } : {});
    const inContext = new Set(context.blocks.map((b) => b.doc));

    const lanes: LaneResult[] = laneCandidates.map(({ lane, candidates }) => ({
      id: lane.id,
      kind: lane.kind,
      label: lane.label,
      ticker: lane.ticker,
      periodLabel: lane.periodLabel,
      filings: lane.documentIds.length,
      searchedChunks: this.docs.of(lane.documentIds).length,
      quota: lane.quota,
      tier: lane.tier,
      candidates: candidates.map((c) => ({
        chunkId: this.index.chunks[c.doc]!.chunkId,
        score: Number(c.score.toFixed(6)),
        bm25Rank: c.bm25Rank,
        cosineRank: c.cosineRank,
        boosted: c.boosted,
        boilerplate: c.boilerplate,
        inContext: inContext.has(c.doc),
      })),
    }));

    return {
      analysis,
      plan,
      lanes,
      context,
      telemetry: {
        retrievalDurationMs: Math.round(performance.now() - t0),
        embeddingDurationMs,
        embeddingCallCount,
        rerankCallCount: 0,
        retrievalRequests: plan.lanes.length,
        chunksRetrieved: laneCandidates.reduce((n, l) => n + l.candidates.length, 0),
        contextChunksUsed: context.blocks.length,
        companiesRepresented: context.companies.length,
        filingsRepresented: context.filings.length,
        mode,
        indexVersion: this.indexVersion,
      },
    };
  }
}

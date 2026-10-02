import type { SectionKind } from '@diligenceiq/corpus';
import { type Bm25Index, scoreBm25 } from '../index/bm25';
import type { ChunkRecord } from '../index/format';

/**
 * Hybrid search over the in-memory index (SPEC §27.1; architecture §6.6):
 * - lexical: BM25 over the precomputed inverted index;
 * - semantic: EXACT cosine (dot product of normalized vectors) over the embedding matrix;
 * - both restricted by the lane's hard metadata filter (its filings);
 * - fused with Reciprocal Rank Fusion, k = 60: score = Σ 1 / (60 + rank), ranks from 1;
 * - then soft multipliers: topic section boost, boilerplate down-weight.
 * Rerank is off (SPEC §2.1, assumptions A1): there is no rerank stage.
 */
export const RRF_K = 60;
/** Ranks taken from each list into the fusion. */
export const FUSION_DEPTH = 200;
/** Topic hints multiply a chunk's fused score when its section matches (soft; never filters). */
export const TOPIC_SECTION_BOOST = 1.25;
/** 10-Q "no material changes" risk-factor boilerplate (SPEC §27.1). */
export const BOILERPLATE_WEIGHT = 0.2;

export type RetrievalMode = 'hybrid' | 'bm25' | 'cosine';

export interface SearchIndex {
  chunks: readonly ChunkRecord[];
  bm25: Bm25Index;
  /** Null in BM25-only mode (no embeddings loaded). */
  vectors: Float32Array | null;
  dims: number;
}

export interface Candidate {
  doc: number;
  score: number;
  /** 1-based ranks in each list (null when absent from that list's top FUSION_DEPTH). */
  bm25Rank: number | null;
  cosineRank: number | null;
  bm25: number | null;
  cosine: number | null;
  boosted: boolean;
  boilerplate: boolean;
}

/** Chunk indexes per document, built once per loaded index. */
export class DocumentChunks {
  private readonly byDoc = new Map<string, number[]>();

  constructor(chunks: readonly Pick<ChunkRecord, 'documentId'>[]) {
    chunks.forEach((c, i) => {
      const list = this.byDoc.get(c.documentId);
      if (list) list.push(i);
      else this.byDoc.set(c.documentId, [i]);
    });
  }

  of(documentIds: readonly string[]): number[] {
    return documentIds.flatMap((d) => this.byDoc.get(d) ?? []);
  }
}

/** Top `depth` documents of `scores`, highest first; ties by chunk order. */
function topRanked(entries: Iterable<[number, number]>, depth: number): Array<[number, number]> {
  return [...entries].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, depth);
}

export function cosineOver(vectors: Float32Array, dims: number, query: Float32Array, docs: readonly number[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const d of docs) {
    let s = 0;
    const base = d * dims;
    for (let k = 0; k < dims; k++) s += vectors[base + k]! * query[k]!;
    out.push([d, s]);
  }
  return out;
}

/** Reciprocal Rank Fusion of ranked lists (each already in rank order). */
export function rrf(lists: ReadonlyArray<ReadonlyArray<number>>, k = RRF_K): Map<number, number> {
  const fused = new Map<number, number>();
  for (const list of lists) list.forEach((doc, i) => fused.set(doc, (fused.get(doc) ?? 0) + 1 / (k + i + 1)));
  return fused;
}

export interface LaneSearchInput {
  index: SearchIndex;
  docs: readonly number[];
  /** Lexical query text for this lane. */
  text: string;
  /** Query embedding (null in BM25-only mode). */
  queryVector: Float32Array | null;
  boostSections: ReadonlySet<SectionKind>;
  mode: RetrievalMode;
  limit: number;
}

export function searchLane(input: LaneSearchInput): Candidate[] {
  const { index, docs, text, queryVector, boostSections, mode, limit } = input;
  if (docs.length === 0) return [];
  const allowed = new Uint8Array(index.chunks.length);
  for (const d of docs) allowed[d] = 1;

  const lists: number[][] = [];
  const bm25Scores = new Map<number, number>();
  const cosScores = new Map<number, number>();
  let bm25Ranked: Array<[number, number]> = [];
  let cosRanked: Array<[number, number]> = [];
  if (mode !== 'cosine') {
    const s = scoreBm25(index.bm25, text, (d) => allowed[d] === 1);
    bm25Ranked = topRanked(s, FUSION_DEPTH);
    for (const [d, v] of bm25Ranked) bm25Scores.set(d, v);
    lists.push(bm25Ranked.map(([d]) => d));
  }
  if (mode !== 'bm25') {
    if (!queryVector || !index.vectors) throw new Error(`retrieval mode ${mode} needs a query embedding and loaded vectors`);
    cosRanked = topRanked(cosineOver(index.vectors, index.dims, queryVector, docs), FUSION_DEPTH);
    for (const [d, v] of cosRanked) cosScores.set(d, v);
    lists.push(cosRanked.map(([d]) => d));
  }
  const bm25Rank = new Map(bm25Ranked.map(([d], i) => [d, i + 1]));
  const cosRank = new Map(cosRanked.map(([d], i) => [d, i + 1]));
  const out: Candidate[] = [];
  for (const [doc, fusedScore] of rrf(lists)) {
    const c = index.chunks[doc]!;
    const boosted = boostSections.has(c.sectionKind);
    let score = fusedScore;
    if (boosted) score *= TOPIC_SECTION_BOOST;
    if (c.boilerplate) score *= BOILERPLATE_WEIGHT;
    out.push({
      doc,
      score,
      bm25Rank: bm25Rank.get(doc) ?? null,
      cosineRank: cosRank.get(doc) ?? null,
      bm25: bm25Scores.get(doc) ?? null,
      cosine: cosScores.get(doc) ?? null,
      boosted,
      boilerplate: c.boilerplate,
    });
  }
  return out.sort((a, b) => b.score - a.score || a.doc - b.doc).slice(0, limit);
}

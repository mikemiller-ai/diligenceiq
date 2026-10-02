import type { ChunkRecord } from './format';

/**
 * Adjacent-period comparison (SPEC §24.4; architecture §6.4): for each chunk, the most
 * similar passages of the SAME section in the previous and the next comparable filing of the
 * same company, ranked by cosine similarity of the stored embeddings. Computed offline at
 * index build; no model call.
 *
 * "Comparable filing" means the adjacent filing of the same form, ordered by period end:
 * 10-K ↔ 10-K (prior / next fiscal year) and 10-Q ↔ 10-Q (prior / next quarter, so a Q1
 * 10-Q's `previous` is the prior fiscal year's Q3 10-Q, since there is no Q4 10-Q). For 10-Qs,
 * `sameQuarterPriorYear` adds the year-over-year comparison: the 10-Q for the same fiscal
 * quarter one fiscal year earlier. It is null for 10-Ks and when that 10-Q is not in the corpus.
 */
export const ADJACENT_TOP_K = 3;

export interface AdjacentMatch {
  chunkId: string;
  score: number;
}

export interface AdjacentSide {
  documentId: string;
  fiscalLabel: string;
  periodEnd: string;
  matches: AdjacentMatch[];
}

export interface AdjacencyEntry {
  previous: AdjacentSide | null;
  next: AdjacentSide | null;
  /** 10-Q only: same fiscal quarter, prior fiscal year. Always null for 10-Ks. */
  sameQuarterPriorYear: AdjacentSide | null;
}

/** Every side of an entry, for consumers that check all references. */
export function adjacencySides(e: AdjacencyEntry): AdjacentSide[] {
  return [e.previous, e.next, e.sameQuarterPriorYear].filter((s): s is AdjacentSide => s !== null);
}

/** Per ticker: chunkId → entry. Chunks in sections the other filing lacks get empty match lists. */
export type AdjacencyFile = Record<string, AdjacencyEntry>;

export function computeAdjacency(chunks: readonly ChunkRecord[], vectors: Float32Array, dims: number): Map<string, AdjacencyFile> {
  const indexOf = new Map(chunks.map((c, i) => [c.chunkId, i]));
  // documentId → sectionKind → chunk indexes
  const byDoc = new Map<string, Map<string, number[]>>();
  const docs = new Map<string, ChunkRecord>();
  chunks.forEach((c, i) => {
    docs.set(c.documentId, c);
    let m = byDoc.get(c.documentId);
    if (!m) byDoc.set(c.documentId, (m = new Map()));
    const list = m.get(c.sectionKind) ?? [];
    list.push(i);
    m.set(c.sectionKind, list);
  });
  // ticker + form → documents ordered by period end
  const series = new Map<string, ChunkRecord[]>();
  for (const d of docs.values()) {
    const key = `${d.ticker}|${d.filingType}`;
    series.set(key, [...(series.get(key) ?? []), d]);
  }
  for (const list of series.values()) list.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));

  const out = new Map<string, AdjacencyFile>();
  const side = (c: ChunkRecord, other: ChunkRecord | undefined): AdjacentSide | null => {
    if (!other) return null;
    const qi = indexOf.get(c.chunkId)!;
    const candidates = byDoc.get(other.documentId)?.get(c.sectionKind) ?? [];
    const scored: AdjacentMatch[] = candidates.map((j) => {
      let s = 0;
      for (let k = 0; k < dims; k++) s += vectors[qi * dims + k]! * vectors[j * dims + k]!;
      return { chunkId: chunks[j]!.chunkId, score: Math.round(s * 10_000) / 10_000 };
    });
    scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
    return { documentId: other.documentId, fiscalLabel: other.fiscalLabel, periodEnd: other.periodEnd, matches: scored.slice(0, ADJACENT_TOP_K) };
  };
  for (const c of chunks) {
    const list = series.get(`${c.ticker}|${c.filingType}`)!;
    const pos = list.findIndex((d) => d.documentId === c.documentId);
    let file = out.get(c.ticker);
    if (!file) out.set(c.ticker, (file = {}));
    const yoy =
      c.filingType === '10-Q' && c.fiscalQuarter !== null
        ? list.find((d) => d.fiscalQuarter === c.fiscalQuarter && d.fiscalYear === c.fiscalYear - 1)
        : undefined;
    file[c.chunkId] = { previous: side(c, list[pos - 1]), next: side(c, list[pos + 1]), sameQuarterPriorYear: side(c, yoy) };
  }
  return out;
}

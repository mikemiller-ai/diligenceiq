import { tokenize } from './tokenize';

/**
 * Precomputed BM25 inverted index (architecture §6.4). Built offline once per index version
 * and loaded by the worker; the query path only scores postings.
 *
 * Serialized as `bm25.json` (vocabulary, document frequencies, posting offsets, document
 * lengths, parameters) plus `bm25-postings.bin` (Uint32 document indexes followed by Uint16
 * term frequencies), because a JSON array of ~8M postings would be several times larger
 * and slower to parse on a cold start.
 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

export interface Bm25Meta {
  k1: number;
  b: number;
  docCount: number;
  avgDocLength: number;
  docLengths: number[];
  terms: string[];
  /** Document frequency per term (same order as `terms`). */
  df: number[];
  /** Start of each term's postings; `offsets[terms.length]` is the total posting count. */
  offsets: number[];
  tokenizerVersion: string;
}

export interface Bm25Index {
  meta: Bm25Meta;
  termIndex: Map<string, number>;
  docs: Uint32Array;
  tfs: Uint16Array;
}

export function buildBm25(texts: readonly string[], tokenizerVersion: string): { meta: Bm25Meta; postings: Buffer } {
  const perTerm = new Map<string, Array<[number, number]>>();
  const docLengths: number[] = [];
  texts.forEach((text, doc) => {
    const tokens = tokenize(text);
    docLengths.push(tokens.length);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      let list = perTerm.get(t);
      if (!list) perTerm.set(t, (list = []));
      list.push([doc, Math.min(n, 65_535)]);
    }
  });
  const terms = [...perTerm.keys()].sort();
  const offsets: number[] = [];
  const df: number[] = [];
  let total = 0;
  for (const t of terms) {
    offsets.push(total);
    const n = perTerm.get(t)!.length;
    df.push(n);
    total += n;
  }
  offsets.push(total);
  const docs = new Uint32Array(total);
  const tfs = new Uint16Array(total);
  let i = 0;
  for (const t of terms) {
    for (const [d, n] of perTerm.get(t)!) {
      docs[i] = d;
      tfs[i] = n;
      i++;
    }
  }
  const postings = Buffer.concat([Buffer.from(docs.buffer), Buffer.from(tfs.buffer)]);
  const avgDocLength = docLengths.reduce((a, b) => a + b, 0) / Math.max(1, docLengths.length);
  return {
    meta: { k1: BM25_K1, b: BM25_B, docCount: texts.length, avgDocLength, docLengths, terms, df, offsets, tokenizerVersion },
    postings,
  };
}

export function loadBm25(meta: Bm25Meta, postings: Buffer): Bm25Index {
  const total = meta.offsets[meta.offsets.length - 1]!;
  if (postings.byteLength !== total * 6) throw new Error(`bm25 postings: expected ${total * 6} bytes, got ${postings.byteLength}`);
  // Copy into aligned buffers; a Buffer slice may not be 4-byte aligned.
  const docs = new Uint32Array(total);
  docs.set(new Uint32Array(postings.buffer.slice(postings.byteOffset, postings.byteOffset + total * 4)));
  const tfs = new Uint16Array(total);
  tfs.set(new Uint16Array(postings.buffer.slice(postings.byteOffset + total * 4, postings.byteOffset + total * 6)));
  return { meta, termIndex: new Map(meta.terms.map((t, i) => [t, i])), docs, tfs };
}

/** BM25 scores for a query over all documents, or only those `allowed` (a metadata filter). */
export function scoreBm25(index: Bm25Index, query: string, allowed?: (doc: number) => boolean): Map<number, number> {
  const { k1, b, docCount, avgDocLength, docLengths, df, offsets } = index.meta;
  const scores = new Map<number, number>();
  for (const term of new Set(tokenize(query))) {
    const ti = index.termIndex.get(term);
    if (ti === undefined) continue;
    const idf = Math.log(1 + (docCount - df[ti]! + 0.5) / (df[ti]! + 0.5));
    for (let p = offsets[ti]!; p < offsets[ti + 1]!; p++) {
      const doc = index.docs[p]!;
      if (allowed && !allowed(doc)) continue;
      const tf = index.tfs[p]!;
      const norm = tf + k1 * (1 - b + (b * docLengths[doc]!) / avgDocLength);
      scores.set(doc, (scores.get(doc) ?? 0) + (idf * (tf * (k1 + 1))) / norm);
    }
  }
  return scores;
}

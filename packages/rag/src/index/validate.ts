import { type AdjacencyFile, adjacencySides } from './adjacency';
import type { LoadedIndex } from './format';
import type { IngestReport } from './summary';

/**
 * Index validation, run after every build (SPEC §24.5). Returns problems; empty means valid.
 * - counts agree: chunks, vectors, BM25 documents, report documents;
 * - chunk IDs are unique and every chunk belongs to a reported filing;
 * - every vector is finite and unit-length (Titan v2 `normalize: true`);
 * - no chunk exceeds the hard cap, and none is empty;
 * - every adjacency reference names a chunk of the same company and section kind.
 */
export function validateIndex(index: LoadedIndex, report: IngestReport, adjacency: Map<string, AdjacencyFile>, hardCap = 6_000): string[] {
  const problems: string[] = [];
  const { chunks, vectors, dims } = index;
  if (vectors.length !== chunks.length * dims) problems.push(`vectors: ${vectors.length / dims} rows for ${chunks.length} chunks`);
  if (index.bm25.meta.docCount !== chunks.length) problems.push(`bm25: ${index.bm25.meta.docCount} documents for ${chunks.length} chunks`);
  if (index.manifest.counts.chunks !== chunks.length) problems.push('manifest chunk count differs');
  const docs = new Set(report.filings.map((f) => f.documentId));
  if (new Set(chunks.map((c) => c.documentId)).size !== docs.size) problems.push('not every reported filing has chunks');
  const byId = new Map<string, (typeof chunks)[number]>();
  chunks.forEach((c, i) => {
    if (byId.has(c.chunkId)) problems.push(`duplicate chunk ID ${c.chunkId}`);
    byId.set(c.chunkId, c);
    if (!docs.has(c.documentId)) problems.push(`${c.chunkId}: unknown document ${c.documentId}`);
    if (!c.text.trim()) problems.push(`${c.chunkId}: empty text`);
    if (c.text.length > hardCap) problems.push(`${c.chunkId}: ${c.text.length} chars exceeds the ${hardCap} cap`);
    if (c.charEnd - c.charStart !== c.text.length) problems.push(`${c.chunkId}: offsets disagree with text length`);
    let norm = 0;
    for (let k = 0; k < dims; k++) {
      const v = vectors[i * dims + k]!;
      if (!Number.isFinite(v)) {
        problems.push(`${c.chunkId}: non-finite vector value`);
        break;
      }
      norm += v * v;
    }
    if (Math.abs(Math.sqrt(norm) - 1) > 1e-3) problems.push(`${c.chunkId}: vector norm ${Math.sqrt(norm).toFixed(4)}`);
  });
  for (const [ticker, file] of adjacency) {
    for (const [id, entry] of Object.entries(file)) {
      const c = byId.get(id);
      if (!c || c.ticker !== ticker) problems.push(`adjacency/${ticker}: unknown chunk ${id}`);
      for (const side of adjacencySides(entry)) {
        for (const m of side.matches) {
          const o = byId.get(m.chunkId);
          if (!o || o.ticker !== ticker || o.sectionKind !== c?.sectionKind || o.documentId !== side.documentId) {
            problems.push(`adjacency/${ticker}: ${id} → ${m.chunkId} is not the same company, section and filing`);
          }
        }
      }
    }
  }
  return problems;
}

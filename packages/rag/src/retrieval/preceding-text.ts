import type { ChunkRecord } from '../index/format';

/**
 * The filing text immediately before a chunk, for the numeric validator's preceding-unit rule
 * (architecture §6.9). A table's "(In millions)" caption often ends the previous chunk, so the
 * cited passage starts with bare table cells and states no unit itself.
 *
 * Bounded and same-filing only: at most `MAX_PRECEDING_CHUNKS` chunks back, each the previous
 * chunk of the SAME document and the SAME section (chunkIndex one lower), and contiguous in the
 * filing text (it starts at or before the boundary and reaches it: chunks overlap or abut, never
 * leave a gap). A chunk whose text is not the verbatim slice of its offsets stops the walk. The
 * result is the verbatim filing text from the earliest walked chunk's start up to the cited
 * chunk's start (the overlap is not repeated), or null. The validator only reads its last line.
 */
export const MAX_PRECEDING_CHUNKS = 2;

export type PrecedingChunk = Pick<ChunkRecord, 'documentId' | 'section' | 'chunkIndex' | 'charStart' | 'charEnd' | 'text'>;

export function precedingFilingText<C extends PrecedingChunk>(chunk: C, previous: (c: C) => C | undefined, maxChunks = MAX_PRECEDING_CHUNKS): string | null {
  let bound = chunk.charStart;
  let cur = chunk;
  let out = '';
  for (let k = 0; k < maxChunks; k++) {
    const p = previous(cur);
    if (!p || p.documentId !== chunk.documentId || p.section !== chunk.section || p.chunkIndex !== cur.chunkIndex - 1) break;
    if (p.text.length !== p.charEnd - p.charStart) break;
    if (!(p.charStart <= bound && p.charEnd >= bound)) break;
    out = p.text.slice(0, bound - p.charStart) + out;
    bound = p.charStart;
    cur = p;
  }
  return out ? out : null;
}

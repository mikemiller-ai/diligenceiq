import type { ChunkRecord } from '../index/format';
import { CONTEXT_CLOSE, CONTEXT_OPEN, estimateTokens, formatBlock } from '../retrieval/context';
import type { RetrievalResult } from '../retrieval/retrieve';

/**
 * Document-level prompt-injection eval (Phase 7; evals/robustness.yaml). EVAL ONLY: the worker
 * and api never call this.
 *
 * The real retrieved context gets one extra passage inside `<filing_excerpts>`, rendered by the
 * same `formatBlock` (so it is defanged exactly like filing text) and borrowing a real chunk's
 * filing metadata. Its text carries an instruction. Everything else in the context, and the one
 * generation call, is unchanged.
 *
 * Two shapes (`plant` in evals/robustness.yaml):
 * - the first run's obvious one: ID `PLANTED-<ticker>-001`, appended last;
 * - realistic ones: an `id` shaped like a real chunk ID of the borrowed filing and section, which
 *   no index chunk has (the CLI checks), placed `last` or in the `middle` of the context. The
 *   scorer tracks it by that ID (`forbidCite`), so the model sees nothing that marks it.
 */
export const PLANTED_ID_PREFIX = 'PLANTED-';

export type PlantPosition = 'last' | 'middle';

export function plantedChunk(template: ChunkRecord, text: string, id?: string): ChunkRecord {
  return { ...template, chunkId: id ?? `${PLANTED_ID_PREFIX}${template.ticker}-001`, chunkIndex: -1, charStart: 0, charEnd: text.length, text };
}

/** Where the planted block goes: after every block, or after the first half of them. */
export function plantIndex(blocks: number, position: PlantPosition = 'last'): number {
  return position === 'middle' ? Math.floor(blocks / 2) : blocks;
}

export function plantPassage(result: RetrievalResult, chunk: ChunkRecord, position: PlantPosition = 'last'): RetrievalResult {
  const ctx = result.context;
  if (!ctx.text.endsWith(CONTEXT_CLOSE)) throw new Error('plantPassage: context has no closing tag');
  const block = formatBlock(chunk);
  const tokens = estimateTokens(block);
  const at = plantIndex(ctx.blocks.length, position);
  const insert = <T>(xs: readonly T[], x: T): T[] => [...xs.slice(0, at), x, ...xs.slice(at)];
  const blocks = insert(ctx.blocks, { sourceId: chunk.chunkId, laneId: 'planted', doc: -1, score: 0, via: 'fill' as const, tokens, text: block });
  return {
    ...result,
    context: {
      ...ctx,
      // The builder's own layout (retrieval/context.ts): one block per passage, blank line between.
      text: `${CONTEXT_OPEN}\n${blocks.map((b) => b.text).join('\n\n')}\n${CONTEXT_CLOSE}`,
      chunkIds: insert(ctx.chunkIds, chunk.chunkId),
      tokenEstimate: ctx.tokenEstimate + tokens,
      blocks,
      snapshot: insert(ctx.snapshot, {
        chunkId: chunk.chunkId,
        documentId: chunk.documentId,
        ticker: chunk.ticker,
        company: chunk.company,
        filingType: chunk.filingType,
        filingDate: chunk.filingDate,
        periodEnd: chunk.periodEnd,
        fiscalLabel: chunk.fiscalLabel,
        section: chunk.section,
        subsection: chunk.subsection,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        text: chunk.text,
        laneId: 'planted',
        score: 0,
      }),
    },
  };
}

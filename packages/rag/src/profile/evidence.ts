import type { CompanyIntelligenceProfile } from '@diligenceiq/core';
import type { ChunkRecord } from '../index/format';
import { CONTEXT_CLOSE, CONTEXT_OPEN, estimateTokens, formatBlock } from '../retrieval/context';
import type { Retriever } from '../retrieval/retrieve';

/*
 * Balanced evidence for the profile call (DD-16 step 4; architecture §4.4 step 6). Deterministic
 * and fixed: the same company, index and profile always give the same excerpts.
 *
 * 1. Anchors: the passages the deterministic profile already cites, so the model can read what
 *    it explains: each signal's latest-period evidence (and the earliest, for persistence), the
 *    first heading of each risk area, and each driver's table.
 * 2. Topic lanes: fixed questions answered by the same retriever as Deep Analysis, filtered to
 *    the company, in BM25 mode (no query embedding, so no model call and no spend), for what the
 *    extraction does not cover: management's outlook, the discussion of results, liquidity.
 *
 * Anchors come first; the lanes then share the rest of the budget equally, in lane order.
 */
export const PROFILE_TOPIC_LANES = [
  { id: 'outlook', question: 'management outlook expectations for demand, investment and the year ahead' },
  { id: 'results', question: 'results of operations: what drove the change in net sales, revenue, gross margin and operating income' },
  { id: 'liquidity', question: 'liquidity and capital resources: cash, borrowings, capital spending and capital return' },
] as const;

export const PROFILE_CONTEXT_BUDGET = 18_000;
export const PROFILE_ANCHOR_SHARE = 0.55;

export interface ProfileEvidence {
  /** The `<filing_excerpts>` block. */
  text: string;
  chunkIds: string[];
  tokenEstimate: number;
  lanes: Array<{ id: string; chunkIds: string[] }>;
}

function anchorIds(p: CompanyIntelligenceProfile): string[] {
  const out: string[] = [];
  for (const s of p.signals) {
    const first = s.evidenceByPeriod[0]?.chunkIds[0];
    const last = s.evidenceByPeriod.at(-1)?.chunkIds[0];
    if (last) out.push(last);
    if (s.type === 'PERSISTENT' && first) out.push(first);
  }
  const areas = new Set<string>();
  for (const r of p.currentRisks) {
    if (areas.has(r.plainLabel)) continue;
    areas.add(r.plainLabel);
    out.push(r.citationIds[0]!);
  }
  for (const d of p.drivers) out.push(...d.citationIds);
  return [...new Set(out)];
}

export async function selectProfileEvidence(
  p: CompanyIntelligenceProfile,
  chunk: (id: string) => ChunkRecord | undefined,
  retriever: Pick<Retriever, 'retrieve'>,
  budget = PROFILE_CONTEXT_BUDGET,
): Promise<ProfileEvidence> {
  let used = estimateTokens(`${CONTEXT_OPEN}\n${CONTEXT_CLOSE}`);
  const blocks: string[] = [];
  const chosen = new Set<string>();
  const add = (c: ChunkRecord, cap: number): boolean => {
    if (chosen.has(c.chunkId)) return false;
    const text = formatBlock(c);
    const tokens = estimateTokens(`${text}\n\n`);
    if (used + tokens > cap) return false;
    used += tokens;
    blocks.push(text);
    chosen.add(c.chunkId);
    return true;
  };

  for (const id of anchorIds(p)) {
    const c = chunk(id);
    if (c) add(c, budget * PROFILE_ANCHOR_SHARE);
  }
  const lanes: ProfileEvidence['lanes'] = [];
  for (const [i, lane] of PROFILE_TOPIC_LANES.entries()) {
    // Each lane gets an equal share of what is left; what a lane does not use passes to the next.
    const cap = used + (budget - used) / (PROFILE_TOPIC_LANES.length - i);
    const result = await retriever.retrieve(lane.question, { tickers: [p.ticker] }, null, { mode: 'bm25' });
    const got: string[] = [];
    for (const id of result.context.chunkIds) {
      const c = chunk(id);
      if (c && c.ticker === p.ticker && add(c, cap)) got.push(id);
    }
    lanes.push({ id: lane.id, chunkIds: got });
  }
  const text = `${CONTEXT_OPEN}\n${blocks.join('\n\n')}\n${CONTEXT_CLOSE}`;
  return { text, chunkIds: [...chosen], tokenEstimate: used, lanes };
}

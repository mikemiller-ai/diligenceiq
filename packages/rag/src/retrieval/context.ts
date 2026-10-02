import type { ChunkRecord } from '../index/format';
import type { Lane } from './plan';
import type { Candidate } from './search';

/**
 * Deterministic context builder (SPEC §28; architecture §6.7):
 * 1. Lane quotas first: each lane contributes up to its quota, best fused score first, so every
 *    requested company and period is represented before anything is filled by score.
 * 2. Then fill by fused score across every lane's remaining candidates.
 * 3. Deduplicate: a candidate is skipped when it overlaps an already chosen chunk of the same
 *    filing by more than half its characters, or its 5-word shingle Jaccard with a chosen
 *    chunk in the same lane exceeds 0.8. Near-identical passages in DIFFERENT period lanes are
 *    kept on purpose: an unchanged risk factor in FY2023 and FY2025 is evidence of persistence.
 *    Outside period lanes (company, sector, global), the duplicate check spans the company.
 * 4. Budget: ~24K tokens, estimated conservatively at 3.5 characters a token over the full
 *    block (header lines and text). A block that does not fit is skipped; smaller ones may
 *    still fit. The budget is never exceeded.
 * 5. Order: lane order (companies as named, periods ascending), then filing and chunk order,
 *    so adjacent chunks of one filing sit together ("adjacent merge"). Each block keeps its own
 *    SOURCE_ID and verbatim text, so every citation maps to exactly one chunk.
 * 6. Untrusted-content framing: one `<filing_excerpts>` block. Inside a passage, any
 *    `<filing_excerpts>` or `</filing_excerpts>` tag is defanged, including variants with
 *    spaces, zero-width characters or soft hyphens inside the tag, so filing text cannot close
 *    the block; and a line that starts with a block header label (`SOURCE_ID:`, `COMPANY:`,
 *    `FILING:`, `SECTION:`, `TEXT:`) is prefixed with `[filing text]`, so filing text cannot
 *    pose as the start of another block.
 *
 * Quota passes (H2): each pass gives one block to every lane still under its quota, visiting
 * lanes by `tier` (then lane order), so every company's tier-0 lane is served before any
 * company's second period, and an early company cannot use up the budget.
 *
 * Citation IDs are the chunk IDs (immutable within the index version, SPEC §25.2). The snapshot
 * (persisted per analysis for the evidence drawer) is capped at SNAPSHOT_MAX_BYTES. Over the
 * cap, the builder degrades instead of failing: it drops the lowest-scoring fill blocks (then,
 * only if still needed, the lowest-scoring quota blocks) until the snapshot fits, and records
 * the count in `skipped.snapshotCap`.
 */
export const CONTEXT_TOKEN_BUDGET = 24_000;
export const CHARS_PER_TOKEN = 3.5;
export const DEDUPE_JACCARD = 0.8;
export const SNAPSHOT_MAX_BYTES = 350 * 1024;

export interface LaneCandidates {
  lane: Lane;
  candidates: Candidate[];
}

export interface ContextBlock {
  sourceId: string;
  laneId: string;
  doc: number;
  score: number;
  /** How it got in: its lane's quota, or the score fill. */
  via: 'quota' | 'fill';
  tokens: number;
  text: string;
}

export interface CoverageCell {
  ticker: string;
  period: string;
  chunks: number;
}

export interface SnapshotEntry {
  chunkId: string;
  documentId: string;
  ticker: string;
  company: string;
  filingType: string;
  filingDate: string;
  periodEnd: string;
  fiscalLabel: string;
  section: string;
  subsection: string | null;
  charStart: number;
  charEnd: number;
  text: string;
  laneId: string;
  score: number;
}

export interface BuiltContext {
  blocks: ContextBlock[];
  /** The prompt text: one untrusted-content block. */
  text: string;
  chunkIds: string[];
  tokenEstimate: number;
  budget: number;
  coverage: CoverageCell[];
  companies: string[];
  filings: string[];
  snapshot: SnapshotEntry[];
  /** Quota shortfalls: lanes with fewer candidates than their quota. */
  shortfalls: Array<{ laneId: string; quota: number; got: number }>;
  skipped: { duplicates: number; overBudget: number; capped: number; snapshotCap: number };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function shingles(text: string): Set<string> {
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 5 <= words.length; i++) out.add(words.slice(i, i + 5).join(' '));
  if (out.size === 0 && words.length) out.add(words.join(' '));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const s of small) if (large.has(s)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Whitespace and invisible characters a tag could hide behind (zero-width space/joiners, word joiner, BOM, soft hyphen). */
const GAP = '[\\s\\u200B-\\u200D\\u2060\\uFEFF\\u00AD]*';
const TAG = new RegExp(`<${GAP}(/?)${GAP}${[...'filing_excerpts'].join(GAP)}${GAP}>`, 'gi');
/** A line that starts like one of the block's header lines. */
const HEADER_LINE = new RegExp(`^(${GAP})(SOURCE${GAP}[_ ]?${GAP}ID|COMPANY|FILING|SECTION|TEXT)(${GAP}:)`, 'gim');
export const HEADER_LINE_PREFIX = '[filing text] ';
/** Filing text can never open or close the untrusted-content block, or pose as a block header. */
export function defang(text: string): string {
  return text
    .replace(TAG, (_m, slash: string) => `[${slash ? '/' : ''}filing_excerpts tag removed]`)
    .replace(HEADER_LINE, (_m, lead: string, label: string, colon: string) => `${lead}${HEADER_LINE_PREFIX}${label}${colon}`);
}

function filingLine(c: ChunkRecord): string {
  return `${c.filingType} · filed ${c.filingDate} · period ended ${c.periodEnd} (${c.fiscalLabel})`;
}

export function formatBlock(c: ChunkRecord): string {
  const section = c.subsection ? `${c.section} › ${c.subsection}` : c.section;
  return [`SOURCE_ID: ${c.chunkId}`, `COMPANY: ${c.company} (${c.ticker})`, `FILING: ${filingLine(c)}`, `SECTION: ${section}`, 'TEXT:', defang(c.text.trim())].join('\n');
}

export const CONTEXT_OPEN = '<filing_excerpts>';
export const CONTEXT_CLOSE = '</filing_excerpts>';

export function buildContext(
  chunks: readonly ChunkRecord[],
  lanes: readonly LaneCandidates[],
  options: { budget?: number } = {},
): BuiltContext {
  const budget = options.budget ?? CONTEXT_TOKEN_BUDGET;
  // The wrapper tags and the blank lines between blocks count against the budget.
  let used = estimateTokens(`${CONTEXT_OPEN}\n${CONTEXT_CLOSE}`);
  const chosen: ContextBlock[] = [];
  const chosenDocs = new Set<number>();
  const shingleCache = new Map<number, Set<string>>();
  const sh = (d: number) => {
    let s = shingleCache.get(d);
    if (!s) shingleCache.set(d, (s = shingles(chunks[d]!.text)));
    return s;
  };
  const perLane = new Map<string, number>();
  const perCompany = new Map<string, number>();
  // Distinct candidates skipped per reason (a candidate retried in the fill counts once).
  const skippedDocs = { duplicates: new Set<number>(), overBudget: new Set<number>(), capped: new Set<number>() };
  const laneById = new Map(lanes.map((l) => [l.lane.id, l.lane]));

  const isDuplicate = (doc: number, lane: Lane): boolean => {
    const c = chunks[doc]!;
    for (const b of chosen) {
      const o = chunks[b.doc]!;
      if (o.documentId === c.documentId) {
        const overlap = Math.min(o.charEnd, c.charEnd) - Math.max(o.charStart, c.charStart);
        if (overlap > 0.5 * (c.charEnd - c.charStart)) return true;
      }
      const sameScope = lane.kind === 'company_period' ? b.laneId === lane.id : o.ticker === c.ticker;
      if (sameScope && jaccard(sh(doc), sh(b.doc)) > DEDUPE_JACCARD) return true;
    }
    return false;
  };

  const tryAdd = (cand: Candidate, lane: Lane, via: ContextBlock['via']): boolean => {
    if (chosenDocs.has(cand.doc)) return false;
    const c = chunks[cand.doc]!;
    if (lane.perCompanyCap !== null && (perCompany.get(c.ticker) ?? 0) >= lane.perCompanyCap) {
      skippedDocs.capped.add(cand.doc);
      return false;
    }
    if (isDuplicate(cand.doc, lane)) {
      skippedDocs.duplicates.add(cand.doc);
      return false;
    }
    const text = formatBlock(c);
    const tokens = estimateTokens(`${text}\n\n`);
    if (used + tokens > budget) {
      skippedDocs.overBudget.add(cand.doc);
      return false;
    }
    used += tokens;
    chosen.push({ sourceId: c.chunkId, laneId: lane.id, doc: cand.doc, score: cand.score, via, tokens, text });
    chosenDocs.add(cand.doc);
    perLane.set(lane.id, (perLane.get(lane.id) ?? 0) + 1);
    perCompany.set(c.ticker, (perCompany.get(c.ticker) ?? 0) + 1);
    return true;
  };

  // 1. Quotas, one block per lane per pass, tier by tier (companies before periods), so an early
  //    lane cannot use up the budget before a later one starts.
  const passOrder = [...lanes].sort((a, b) => a.lane.tier - b.lane.tier);
  const cursors = new Map(lanes.map((l) => [l.lane.id, 0]));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const { lane, candidates } of passOrder) {
      if ((perLane.get(lane.id) ?? 0) >= lane.quota) continue;
      let i = cursors.get(lane.id)!;
      while (i < candidates.length) {
        const added = tryAdd(candidates[i]!, lane, 'quota');
        i++;
        if (added) {
          progressed = true;
          break;
        }
      }
      cursors.set(lane.id, i);
    }
  }
  const shortfalls = lanes
    .filter((l) => (perLane.get(l.lane.id) ?? 0) < l.lane.quota)
    .map((l) => ({ laneId: l.lane.id, quota: l.lane.quota, got: perLane.get(l.lane.id) ?? 0 }));

  // 2. Fill by fused score across lanes.
  const rest = lanes
    .flatMap(({ lane, candidates }) => candidates.map((c) => ({ c, lane })))
    .filter(({ c }) => !chosenDocs.has(c.doc))
    .sort((a, b) => b.c.score - a.c.score || a.c.doc - b.c.doc);
  for (const { c, lane } of rest) tryAdd(c, lane, 'fill');

  // 3. Order: lane order, then filing and chunk order.
  const laneOrder = new Map(lanes.map((l, i) => [l.lane.id, i]));
  chosen.sort((a, b) => {
    const ca = chunks[a.doc]!;
    const cb = chunks[b.doc]!;
    return (
      laneOrder.get(a.laneId)! - laneOrder.get(b.laneId)! ||
      ca.periodEnd.localeCompare(cb.periodEnd) ||
      ca.documentId.localeCompare(cb.documentId) ||
      ca.chunkIndex - cb.chunkIndex
    );
  });

  // Snapshot cap (L1): degrade, never fail. Drop the lowest-scoring fill blocks, then quota blocks.
  const entryOf = (b: ContextBlock): SnapshotEntry => {
    const c = chunks[b.doc]!;
    return {
      chunkId: c.chunkId,
      documentId: c.documentId,
      ticker: c.ticker,
      company: c.company,
      filingType: c.filingType,
      filingDate: c.filingDate,
      periodEnd: c.periodEnd,
      fiscalLabel: c.fiscalLabel,
      section: c.section,
      subsection: c.subsection,
      charStart: c.charStart,
      charEnd: c.charEnd,
      text: c.text,
      laneId: b.laneId,
      score: b.score,
    };
  };
  const entryBytes = new Map(chosen.map((b) => [b.doc, Buffer.byteLength(JSON.stringify(entryOf(b)))]));
  // JSON array: brackets plus one comma between entries.
  let snapshotBytes = 2 + Math.max(0, chosen.length - 1) + [...entryBytes.values()].reduce((a, b) => a + b, 0);
  let snapshotCap = 0;
  if (snapshotBytes > SNAPSHOT_MAX_BYTES) {
    const dropOrder = [...chosen].sort((a, b) => (a.via === b.via ? 0 : a.via === 'fill' ? -1 : 1) || a.score - b.score || b.doc - a.doc);
    const drop = new Set<number>();
    for (const b of dropOrder) {
      if (snapshotBytes <= SNAPSHOT_MAX_BYTES) break;
      drop.add(b.doc);
      snapshotBytes -= entryBytes.get(b.doc)! + 1;
    }
    snapshotCap = drop.size;
    for (let i = chosen.length - 1; i >= 0; i--) if (drop.has(chosen[i]!.doc)) chosen.splice(i, 1);
  }

  // Coverage matrix: company × period (the lane's period label, or the chunk's fiscal label in a global lane).
  const cells = new Map<string, CoverageCell>();
  for (const b of chosen) {
    const c = chunks[b.doc]!;
    const lane = laneById.get(b.laneId)!;
    const period = lane.kind === 'company_period' ? lane.periodLabel! : c.fiscalLabel;
    const key = `${c.ticker}|${period}`;
    const cell = cells.get(key) ?? { ticker: c.ticker, period, chunks: 0 };
    cell.chunks++;
    cells.set(key, cell);
  }

  const snapshot: SnapshotEntry[] = chosen.map(entryOf);

  const text = `${CONTEXT_OPEN}\n${chosen.map((b) => b.text).join('\n\n')}\n${CONTEXT_CLOSE}`;
  return {
    blocks: chosen,
    text,
    chunkIds: chosen.map((b) => b.sourceId),
    tokenEstimate: estimateTokens(text),
    budget,
    coverage: [...cells.values()],
    companies: [...new Set(chosen.map((b) => chunks[b.doc]!.ticker))],
    filings: [...new Set(chosen.map((b) => chunks[b.doc]!.documentId))],
    snapshot,
    shortfalls,
    skipped: { duplicates: skippedDocs.duplicates.size, overBudget: skippedDocs.overBudget.size, capped: skippedDocs.capped.size, snapshotCap },
  };
}

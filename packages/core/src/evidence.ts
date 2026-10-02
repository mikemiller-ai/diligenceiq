import { z } from 'zod';
import { type Citation, CitationSchema, FilingTypeSchema } from './domain';

/**
 * Evidence routes (SPEC §16.2; architecture §9, Phase 6): the readable source view and
 * adjacent-period comparison for a citation. Both are deterministic reads of offline build
 * outputs (`processed/<indexVersion>/` and `index/<indexVersion>/adjacency/`); no model call.
 */

/**
 * A chunk ID without anchors or captures, for finding IDs inside text: `AAPL-FY2025-10K-1A-004`,
 * `NVDA-FY2026Q3-10Q-MDA-012` (architecture §6.3). The chunk number is zero-padded to at least three
 * digits; the chunker caps a section at 999 chunks today, and a fourth digit would still match.
 */
export const CHUNK_ID_SOURCE = '[A-Z]{1,5}-FY\\d{4}(?:Q[1-4])?-10[KQ]-[A-Z0-9]{1,6}-\\d{3,}';
export const CHUNK_ID_PATTERN = /^([A-Z]{1,5})-FY\d{4}(?:Q[1-4])?-10[KQ]-[A-Z0-9]{1,6}-\d{3,}$/;
/** `AAPL_10K_2025-10-31`, `AAPL_10K_2022Q3_2022-10-28`, `NVDA_10Q_2025Q3_2025-11-19`. */
export const DOCUMENT_ID_PATTERN = /^([A-Z]{1,5})_10[KQ]_(?:\d{4}Q[1-4]_)?\d{4}-\d{2}-\d{2}$/;

/** The ticker a chunk ID or document ID belongs to; null when the ID is not well formed. */
export function tickerOfChunkId(chunkId: string): string | null {
  return CHUNK_ID_PATTERN.exec(chunkId)?.[1] ?? null;
}
export function tickerOfDocumentId(documentId: string): string | null {
  return DOCUMENT_ID_PATTERN.exec(documentId)?.[1] ?? null;
}

export const SourceFilingSchema = z.object({
  documentId: z.string(),
  ticker: z.string(),
  company: z.string(),
  filingType: FilingTypeSchema,
  filingDate: z.string(),
  periodEnd: z.string(),
  fiscalLabel: z.string(),
  sourceUrl: z.string(),
});
export type SourceFiling = z.infer<typeof SourceFilingSchema>;

/** `GET /api/sources/:documentId`: the processed filing text with its sections and chunk spans. */
export const SourceDocumentResponseSchema = z.object({
  indexVersion: z.string(),
  filing: SourceFilingSchema,
  sections: z.array(z.object({ code: z.string(), title: z.string(), charStart: z.number().int(), charEnd: z.number().int() })),
  /** Every index chunk of this filing, so any citation can be located and highlighted. */
  chunks: z.array(z.object({ chunkId: z.string(), section: z.string(), charStart: z.number().int(), charEnd: z.number().int() })),
  text: z.string(),
});
export type SourceDocumentResponse = z.infer<typeof SourceDocumentResponseSchema>;

export const AdjacentSideSchema = z.object({
  filing: SourceFilingSchema.omit({ sourceUrl: true }),
  /** Same section, same form, most similar first (offline cosine; never shown as certainty). */
  passages: z.array(CitationSchema),
});
export type AdjacentSide = z.infer<typeof AdjacentSideSchema>;

/**
 * `GET /api/evidence/adjacent?chunkId=`: the same section in the previous and next comparable
 * filing (10-K ↔ 10-K, 10-Q ↔ 10-Q), plus the same quarter a year earlier for a 10-Q. A side is
 * null at either end of a company's history in the corpus.
 */
export const AdjacentEvidenceResponseSchema = z.object({
  chunkId: z.string(),
  indexVersion: z.string(),
  previous: AdjacentSideSchema.nullable(),
  next: AdjacentSideSchema.nullable(),
  sameQuarterPriorYear: AdjacentSideSchema.nullable(),
});
export type AdjacentEvidenceResponse = z.infer<typeof AdjacentEvidenceResponseSchema>;

export const AdjacentEvidenceQuerySchema = z
  .object({
    chunkId: z.string().regex(CHUNK_ID_PATTERN),
    /** The citation's index version; a different one is answered 404 (chunk IDs are per version). */
    indexVersion: z.string().regex(/^iv-[a-z0-9]+$/).optional(),
  })
  .strict();

/**
 * A bracketed inline citation as briefs write it and the web renders it as a chip
 * (`[AAPL-FY2025-10K-1A-004]`). Deliberately looser than a chunk ID, so a malformed citation is
 * caught (flagged chip, `pnpm evidence:check` failure) instead of read as plain text. Global: use
 * with `matchAll`, which never shares `lastIndex`.
 */
export const INLINE_CITATION = /\[([A-Z0-9][A-Z0-9.-]*-[A-Z0-9]+)\]/g;

/**
 * Every citation in a brief: each `citationIds` entry anywhere in it, and each bracketed inline
 * citation in any of its text. `malformed` holds the ones that are not chunk IDs.
 */
export function briefCitationIds(brief: unknown): { ids: Set<string>; malformed: Set<string> } {
  const ids = new Set<string>();
  const malformed = new Set<string>();
  const add = (id: string) => (CHUNK_ID_PATTERN.test(id) ? ids : malformed).add(id);
  const walk = (o: unknown, key?: string): void => {
    if (typeof o === 'string') {
      if (key === 'citationIds') add(o);
      for (const m of o.matchAll(INLINE_CITATION)) add(m[1] ?? '');
    } else if (Array.isArray(o)) for (const x of o) walk(x, key);
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, k);
  };
  walk(brief);
  return { ids, malformed };
}

/** Whether `citation` is exactly the span `[charStart, charEnd)` of the source text. */
export function citationMatchesSource(citation: Pick<Citation, 'charStart' | 'charEnd' | 'text'>, text: string): boolean {
  return citation.charEnd <= text.length && text.slice(citation.charStart, citation.charEnd) === citation.text;
}

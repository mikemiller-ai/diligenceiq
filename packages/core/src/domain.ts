import { z } from 'zod';
import { ThemeIdSchema } from './themes';

/** Shapes from architecture §7 (model output) and §9 (API contract). */

export const FilingTypeSchema = z.enum(['10-K', '10-Q']);
export type FilingType = z.infer<typeof FilingTypeSchema>;

export const CitationSchema = z.object({
  chunkId: z.string().min(1),
  indexVersion: z.string().min(1),
  ticker: z.string().min(1),
  company: z.string().min(1),
  filingType: FilingTypeSchema,
  filingDate: z.string(),
  periodEnd: z.string(),
  fiscalLabel: z.string(),
  section: z.string(),
  documentId: z.string().min(1),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
  text: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

export const FindingStatusSchema = z.enum(['ACTIVE', 'NEEDS_FOLLOW_UP', 'RESOLVED']);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSchema = z.object({
  findingId: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  theme: ThemeIdSchema,
  tickers: z.array(z.string()),
  citations: z.array(CitationSchema),
  origin: z.lazy(() => FindingOriginSchema),
  analysisId: z.string().min(1).optional(),
  note: z.string().max(2000).optional(),
  status: FindingStatusSchema,
  pinnedToIC: z.boolean(),
  isKey: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const AnalysisStatusSchema = z.enum(['QUEUED', 'RUNNING', 'COMPLETE', 'FAILED']);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisSummarySchema = z.object({
  analysisId: z.string().min(1),
  question: z.string().min(1).max(1000),
  origin: z.lazy(() => AnalysisOriginSchema),
  status: AnalysisStatusSchema,
  stage: z.string().optional(),
  createdAt: z.string(),
  completedAt: z.string().optional(),
});
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;

export function citationLabel(c: Pick<Citation, 'ticker' | 'fiscalLabel' | 'filingType' | 'section'>): string {
  return `${c.ticker} ${c.fiscalLabel} ${c.filingType} · ${c.section}`;
}

/*
 * Provenance unions (architecture §9). IDs and refs are restricted to URL-safe
 * characters without ':' so an origin can round-trip through the
 * /analysis/new?origin= query parameter (encodeOrigin / parseOrigin).
 */
export const TickerSchema = z.string().regex(/^[A-Z]{1,5}$/);
const RefSchema = z.string().min(1).max(120).regex(/^[A-Za-z0-9._-]+$/);
const IndexSchema = z.number().int().nonnegative().max(1000);
/** Two to five distinct tickers (Compare, architecture §9). */
const CompareTickersSchema = z
  .array(TickerSchema)
  .min(2)
  .max(5)
  .refine((t) => new Set(t).size === t.length, { message: 'tickers must be distinct' });

/** Where a Deep Analysis came from. Provenance only: retrieval uses the question and filters. */
export const AnalysisOriginSchema = z.union([
  z.object({ kind: z.literal('direct') }).strict(),
  z
    .object({
      kind: z.enum(['signal', 'recommendation', 'executiveView', 'driver', 'currentRisk']),
      ticker: TickerSchema,
      ref: RefSchema,
    })
    .strict(),
  z.object({ kind: z.literal('compare'), tickers: CompareTickersSchema, ref: RefSchema }).strict(),
  z.object({ kind: z.literal('thesis'), thesisId: RefSchema }).strict(),
  z.object({ kind: z.literal('watchEvent'), ticker: TickerSchema, signalId: RefSchema }).strict(),
  z.object({ kind: z.literal('finding'), findingId: RefSchema }).strict(),
  z.object({ kind: z.literal('brief'), analysisId: RefSchema, index: IndexSchema }).strict(),
]);
export type AnalysisOrigin = z.infer<typeof AnalysisOriginSchema>;
export type AnalysisOriginKind = AnalysisOrigin['kind'];

/** What a finding was saved from. Every variant names stored server-side content to copy. */
export const FindingSourceSchema = z.union([
  z
    .object({ kind: z.enum(['keyFinding', 'consideration', 'comparisonRow']), analysisId: RefSchema, index: IndexSchema })
    .strict(),
  z
    .object({
      kind: z.enum(['signal', 'executiveView', 'recommendation', 'driver', 'currentRisk']),
      ticker: TickerSchema,
      ref: RefSchema,
    })
    .strict(),
  z.object({ kind: z.literal('compareRow'), tickers: CompareTickersSchema, ref: RefSchema }).strict(),
  z.object({ kind: z.literal('watchEvent'), ticker: TickerSchema, signalId: RefSchema }).strict(),
]);
export type FindingSource = z.infer<typeof FindingSourceSchema>;

export const FINDING_ORIGIN_KINDS = ['analysis', 'intelligence', 'compare', 'watch'] as const;
export type FindingOriginKind = (typeof FINDING_ORIGIN_KINDS)[number];

/** `origin.kind` is always derived from `source.kind`, never accepted from a client. */
export function findingOriginKind(source: FindingSource): FindingOriginKind {
  switch (source.kind) {
    case 'keyFinding':
    case 'consideration':
    case 'comparisonRow':
      return 'analysis';
    case 'compareRow':
      return 'compare';
    case 'watchEvent':
      return 'watch';
    default:
      return 'intelligence';
  }
}

export const FindingOriginSchema = z
  .object({ kind: z.enum(FINDING_ORIGIN_KINDS), source: FindingSourceSchema })
  .strict()
  .refine((o) => o.kind === findingOriginKind(o.source), { message: 'origin.kind must match source.kind' });
export type FindingOrigin = z.infer<typeof FindingOriginSchema>;

/** Serializes an origin for the `origin` query parameter of /analysis/new. */
export function encodeOrigin(origin: AnalysisOrigin): string {
  switch (origin.kind) {
    case 'direct':
      return 'direct';
    case 'compare':
      return `compare:${origin.tickers.join(',')}:${origin.ref}`;
    case 'thesis':
      return `thesis:${origin.thesisId}`;
    case 'watchEvent':
      return `watchEvent:${origin.ticker}:${origin.signalId}`;
    case 'finding':
      return `finding:${origin.findingId}`;
    case 'brief':
      return `brief:${origin.analysisId}:${origin.index}`;
    default:
      return `${origin.kind}:${origin.ticker}:${origin.ref}`;
  }
}

/** Parses the `origin` query parameter. Anything unrecognized is a direct question. */
export function parseOrigin(raw: string | null | undefined): AnalysisOrigin {
  const parts = (raw ?? '').split(':');
  const [kind, a, b] = parts;
  let candidate: unknown = { kind: 'direct' };
  if (parts.length === 3 && kind === 'compare') candidate = { kind, tickers: (a ?? '').split(','), ref: b };
  else if (parts.length === 3 && kind === 'watchEvent') candidate = { kind, ticker: a, signalId: b };
  else if (parts.length === 3 && kind === 'brief') candidate = { kind, analysisId: a, index: /^\d+$/.test(b ?? '') ? Number(b) : NaN };
  else if (parts.length === 3) candidate = { kind, ticker: a, ref: b };
  else if (parts.length === 2 && kind === 'thesis') candidate = { kind, thesisId: a };
  else if (parts.length === 2 && kind === 'finding') candidate = { kind, findingId: a };
  const parsed = AnalysisOriginSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { kind: 'direct' };
}

const CitationIdsSchema = z.array(z.string());

/** Model output (architecture §7). Server-side fields are added separately. */
export const DiligenceBriefSchema = z.object({
  title: z.string(),
  executiveSummary: z.string(),
  answerType: z.enum(['single_company', 'comparison', 'trend', 'sector', 'insufficient_evidence']),
  keyFindings: z.array(
    z.object({
      title: z.string(),
      finding: z.string(),
      basis: z.enum(['reported', 'analysis']),
      tickers: z.array(z.string()),
      citationIds: CitationIdsSchema,
    }),
  ),
  comparison: z
    .object({
      kind: z.enum(['table', 'trend']),
      columns: z.array(z.string()),
      rows: z.array(z.object({ label: z.string(), values: z.array(z.string()), citationIds: CitationIdsSchema })),
    })
    .optional(),
  investmentConsiderations: z.array(z.object({ text: z.string(), citationIds: CitationIdsSchema })),
  evidenceGaps: z.array(z.string()),
  followUpQuestions: z.array(z.string()),
});
export type DiligenceBrief = z.infer<typeof DiligenceBriefSchema>;

export const AnalysisFiltersSchema = z.object({
  tickers: z.array(TickerSchema).max(10).optional(),
  filingTypes: z.array(FilingTypeSchema).min(1).optional(),
  fiscalYearFrom: z.number().int().min(2000).max(2100).optional(),
  fiscalYearTo: z.number().int().min(2000).max(2100).optional(),
});
export type AnalysisFilters = z.infer<typeof AnalysisFiltersSchema>;

export const CreateAnalysisRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    /** Provenance only: retrieval uses the question and filters (SPEC §14.2). */
    origin: z.lazy(() => AnalysisOriginSchema).optional(),
    filters: AnalysisFiltersSchema.optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.filters?.fiscalYearFrom === undefined ||
      r.filters.fiscalYearTo === undefined ||
      r.filters.fiscalYearFrom <= r.filters.fiscalYearTo,
    { message: 'fiscalYearFrom must be ≤ fiscalYearTo', path: ['filters', 'fiscalYearFrom'] },
  );
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;

/**
 * `POST /api/retrieval/debug` (SPEC §27.3): retrieval only, no generation. Development only:
 * the deployed api never registers the route.
 */
export const RetrievalDebugRequestSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    filters: AnalysisFiltersSchema.optional(),
    mode: z.enum(['hybrid', 'bm25', 'cosine']).optional(),
    /** Include each context block's prompt text (never logged). */
    includeText: z.boolean().optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.filters?.fiscalYearFrom === undefined ||
      r.filters.fiscalYearTo === undefined ||
      r.filters.fiscalYearFrom <= r.filters.fiscalYearTo,
    { message: 'fiscalYearFrom must be ≤ fiscalYearTo', path: ['filters', 'fiscalYearFrom'] },
  );
export type RetrievalDebugRequest = z.infer<typeof RetrievalDebugRequestSchema>;

/** Resolved scope shown above a brief (server-computed; architecture §7; the Interpretation panel). */
export interface AnalysisInterpretation {
  companies: string[];
  periods: string[];
  filingTypes: FilingType[];
  coverageWarnings: string[];
  /** Phase 4 worker additions: how each company's period was resolved, sectors, notes and the plan strategy. */
  scopes?: Array<{ ticker: string; company: string; via: string; periods: string[]; description: string }>;
  sectors?: Array<{ phrase: string; tickers: string[] }>;
  periodRule?: { kind: string; phrase?: string; assumption?: string };
  notes?: string[];
  strategy?: string;
  /** Set when query embedding failed and retrieval fell back to BM25 only (assumptions A1). */
  retrievalMode?: 'hybrid' | 'bm25';
}

/** Deterministic validation of one brief (SPEC §31; architecture §6.9). Never a second model call. */
export const BriefValidationSchema = z.object({
  /** Deterministic repairs applied before the schema parse (empty when none were needed). */
  repairs: z.array(z.string()),
  citations: z.object({
    /** Citation IDs the model returned (with duplicates inside one item removed). */
    returned: z.number().int().nonnegative(),
    valid: z.number().int().nonnegative(),
    /** Removed: not among the chunks supplied in the context. */
    removed: z.array(z.object({ location: z.string(), id: z.string() })),
    /** valid / returned before removal (1 when nothing was cited). */
    preValidationRate: z.number(),
  }),
  /** Items left with no valid citation (findings, comparison rows, considerations). */
  uncited: z.array(z.string()),
  numeric: z.object({
    figures: z.array(
      z.object({
        location: z.string(),
        figure: z.string(),
        verified: z.boolean(),
        /**
         * How it matched a cited passage (packages/rag validate.ts matchFigure): `exact` (same value and
         * unit printed), `scaled` (an equal amount under another scale word, or a table that states its
         * unit), or `unit_unstated`: the digits are a table cell in a passage that states no unit. A
         * `unit_unstated` figure is NOT verified.
         */
        rule: z.enum(['exact', 'scaled', 'unit_unstated']).nullable(),
        chunkId: z.string().nullable(),
      }),
    ),
    total: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    /** Unverified figures whose digits match a table cell in a passage that states no unit (reported separately). */
    unitUnstated: z.number().int().nonnegative().default(0),
  }),
  /** Comparison rows whose number of values differs from the number of columns (after repair). */
  comparisonMisaligned: z.array(z.string()).default([]),
  /** Plain-language notices for the brief ("1 citation removed: not in the supplied evidence"). */
  notices: z.array(z.string()),
});
export type BriefValidation = z.infer<typeof BriefValidationSchema>;

/** Company × period coverage matrix (SPEC §15.2): every resolved cell, with context and cited chunk counts. */
export const BriefCoverageSchema = z.object({
  cells: z.array(z.object({ ticker: z.string(), period: z.string(), contextChunks: z.number().int().nonnegative(), citedChunks: z.number().int().nonnegative() })),
});
export type BriefCoverage = z.infer<typeof BriefCoverageSchema>;

/** One telemetry summary per analysis (SPEC §30.1). The question is logged; prompts and chunk text never are. */
export interface AnalysisTelemetry {
  retrievalDurationMs: number;
  generationDurationMs: number;
  totalDurationMs: number;
  chunksRetrieved: number;
  contextChunksUsed: number;
  companiesRepresented: number;
  filingsRepresented: number;
  embeddingCallCount: number;
  rerankCallCount: number;
  generationCallCount: number;
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  promptVersion: string;
  indexVersion: string;
  estimatedCostUsd: number;
  /** Phase 4 worker additions (SPEC §30.1). */
  requestId?: string;
  analysisId?: string;
  query?: string;
  retrievalRequests?: number;
  indexLoadMs?: number;
  coldStart?: boolean;
  embeddingDurationMs?: number;
  generationFirstTokenMs?: number | null;
  stopReason?: string;
  contextTokenEstimate?: number;
  /** The generation was sent but returned no usage (timeout or error): inputTokens is estimated from the prompt and output is unknown, so estimatedCostUsd is a lower bound. */
  costIncomplete?: boolean;
}

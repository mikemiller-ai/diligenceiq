import { z } from 'zod';
import {
  AnalysisStatusSchema,
  FindingSourceSchema,
  FindingStatusSchema,
  TickerSchema,
  type AnalysisFilters,
  type AnalysisInterpretation,
  type AnalysisSummary,
  type AnalysisTelemetry,
  type BriefCoverage,
  type BriefValidation,
  type Citation,
  type DiligenceBrief,
  type Finding,
  FINDING_ORIGIN_KINDS,
} from './domain';
import type { AnalysisFailureCode } from './errors';
import type { CoverageTier } from './intelligence';
import { ThemeIdSchema } from './themes';

/** Request and response shapes of the session-scoped API (architecture §9), shared by the api and the web. */

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

export interface SessionResponse {
  workspaceId: string;
  /** True when this request created the workspace (and seeded it). */
  created: boolean;
  expiresAt: string;
}

export interface CreateAnalysisResponse {
  analysisId: string;
  status: 'QUEUED';
  pollAfterMs: number;
}

/** `GET /api/analyses/:id`: the poll response. Never includes the context snapshot. */
export type AnalysisDetail = AnalysisSummary & {
  deadlineAt: string;
  /** The optional retrieval filters the analysis ran with. */
  filters?: AnalysisFilters;
  error?: { code: AnalysisFailureCode; message: string; requestId: string };
  interpretation?: AnalysisInterpretation;
  coverage?: BriefCoverage;
  brief?: DiligenceBrief;
  citations?: Citation[];
  validation?: BriefValidation;
  telemetry?: AnalysisTelemetry;
  /** Set on analyses copied from the seed: real pipeline output, pre-run (SPEC §40). */
  seeded?: boolean;
};

export interface AnalysisContextResponse {
  indexVersion: string;
  passages: Citation[];
}

export interface WorkspaceResponse {
  workspaceId: string;
  createdAt: string;
  seedVersion: string | null;
  stats: { analyses: number; findings: number };
  recentAnalyses: AnalysisSummary[];
  recentFindings: Finding[];
  /** P1 (Phase 8b). Always empty until then. */
  watchlist: string[];
}

export interface CompanySummary {
  ticker: string;
  company: string;
  sector: string;
  tier: CoverageTier;
  filings: number;
  periodsCovered: string[];
  headline?: string;
}

export interface CompaniesResponse {
  indexVersion: string | null;
  profileSetId: string | null;
  companies: CompanySummary[];
}

export interface HealthResponse {
  status: 'ok';
  /** The index the worker searches (null when not configured). */
  indexVersion: string | null;
  /** False when the index manifest could not be read: Deep Analysis shows the missing-index banner. */
  indexAvailable: boolean;
  profileSetId: string | null;
  profileIndexVersion: string | null;
  analysesEnabled: boolean;
}

const cursor = z.string().min(1).max(512).optional();
const limit = z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).optional();

export const ListAnalysesQuerySchema = z.object({ status: AnalysisStatusSchema.optional(), cursor, limit }).strict();
export type ListAnalysesQuery = z.infer<typeof ListAnalysesQuerySchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/);

export const ListFindingsQuerySchema = z
  .object({
    theme: ThemeIdSchema.optional(),
    ticker: TickerSchema.optional(),
    status: FindingStatusSchema.optional(),
    origin: z.enum(FINDING_ORIGIN_KINDS).optional(),
    analysisId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    pinned: z.enum(['true', 'false']).optional(),
    cursor,
    limit,
  })
  .strict();
export type ListFindingsQuery = z.infer<typeof ListFindingsQuerySchema>;

export const FINDING_TITLE_MAX = 200;
export const FINDING_NOTE_MAX = 2000;

/** `POST /api/findings`: the client names the source; text and citations are copied server-side. */
export const CreateFindingRequestSchema = z
  .object({
    source: FindingSourceSchema,
    theme: ThemeIdSchema.optional(),
    title: z.string().trim().max(FINDING_TITLE_MAX).optional(),
    note: z.string().trim().max(FINDING_NOTE_MAX).optional(),
    status: FindingStatusSchema.optional(),
  })
  .strict();
export type CreateFindingRequest = z.infer<typeof CreateFindingRequestSchema>;

export const PatchFindingRequestSchema = z
  .object({
    status: FindingStatusSchema.optional(),
    note: z.string().trim().max(FINDING_NOTE_MAX).optional(),
    pinnedToIC: z.boolean().optional(),
    isKey: z.boolean().optional(),
    theme: ThemeIdSchema.optional(),
    title: z.string().trim().min(1).max(FINDING_TITLE_MAX).optional(),
  })
  .strict()
  .refine((p) => Object.keys(p).length > 0, { message: 'Nothing to update.' });
export type PatchFindingRequest = z.infer<typeof PatchFindingRequestSchema>;

/** `GET /api/compare?tickers=`. */
export const CompareQuerySchema = z
  .object({
    tickers: z
      .string()
      .max(40)
      .transform((s) => s.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)),
  })
  .strict();

/** Stage names the worker writes (architecture §4.1), in order. */
export const ANALYSIS_STAGES = ['queued', 'claimed', 'loading_index', 'analyzing', 'retrieving', 'balancing', 'context', 'generating', 'validating', 'complete', 'failed'] as const;
export type AnalysisStageName = (typeof ANALYSIS_STAGES)[number];

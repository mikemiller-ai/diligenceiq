import { z } from 'zod';

/** Request-level error codes and their HTTP status (architecture §9). */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  SESSION_REQUIRED: 401,
  NOT_FOUND: 404,
  LIMIT_REACHED: 409,
  PROFILE_MISSING: 404,
  SOURCE_MISSING: 404,
  RATE_LIMITED: 429,
  ANALYSES_DISABLED: 503,
  ENQUEUE_FAILED: 503,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** Analysis-level failure codes, returned inside a 200 poll response. */
export const ANALYSIS_FAILURE_CODES = [
  'QUEUE_TIMEOUT',
  'PIPELINE_TIMEOUT',
  'GENERATION_TIMEOUT',
  'GENERATION_FAILED',
  'MALFORMED_OUTPUT',
  'NO_RELEVANT_EVIDENCE',
  'INDEX_UNAVAILABLE',
  'WORKER_FAILED',
  'ANALYSES_DISABLED',
  'ENQUEUE_FAILED',
] as const;
export type AnalysisFailureCode = (typeof ANALYSIS_FAILURE_CODES)[number];

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function apiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): { status: number; body: ApiError } {
  return {
    status: ERROR_STATUS[code],
    body: { error: { code, message, requestId, ...(details ? { details } : {}) } },
  };
}

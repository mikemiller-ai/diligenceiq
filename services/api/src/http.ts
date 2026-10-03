import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { apiError, type ErrorCode } from '@diligenceiq/core';

export type HttpResponse = APIGatewayProxyStructuredResultV2 & {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export function json(
  statusCode: number,
  body: unknown,
  requestId: string,
  extra: { cookies?: string[]; /** Overrides the default `no-store` (only the evidence routes' 200s do). */ cacheControl?: string } = {},
): HttpResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': extra.cacheControl ?? 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
    },
    body: JSON.stringify(body),
    ...(extra.cookies ? { cookies: extra.cookies } : {}),
  };
}

/** 204 with no body (DELETE). */
export function noContent(requestId: string): HttpResponse {
  return { statusCode: 204, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-request-id': requestId }, body: '' };
}

export function error(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): HttpResponse {
  const { status, body } = apiError(code, message, requestId, details);
  return json(status, body, requestId);
}

/**
 * One JSON object per line so CloudWatch Logs Insights can query fields directly and the metric
 * filters' JSON selectors (`{ $.event = ... }`) match. Written raw to stdout, so each event is
 * exactly the JSON object with no runtime prefix. (Production check, 2026-10-03: CloudWatch's
 * JSON filters also match a `console.log` line under Lambda's Text-format prefix, so this is
 * tidiness, not a fix; architecture §12.)
 */
export function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  process.stdout.write(`${JSON.stringify({ level, msg, ...fields })}\n`);
}

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
  extra: { cookies?: string[] } = {},
): HttpResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-request-id': requestId,
    },
    body: JSON.stringify(body),
    ...(extra.cookies ? { cookies: extra.cookies } : {}),
  };
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

/** One JSON object per line so CloudWatch Logs Insights can query fields directly. */
export function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> = {},
): void {
  console.log(JSON.stringify({ level, msg, ...fields }));
}

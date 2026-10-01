import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { CreateAnalysisRequestSchema } from '@diligenceiq/core';
import { error, json, log, type HttpResponse } from './http';
import type { KillSwitch } from './kill-switch';

export const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTED_ISSUES = 10;

export const PROBE_COOKIE = 'diq_probe=1';
const PROBE_SET_COOKIE = `${PROBE_COOKIE}; Path=/api; Max-Age=300; HttpOnly; Secure; SameSite=Lax`;

export interface AppDeps {
  killSwitch: KillSwitch;
}

interface RequestContext {
  event: APIGatewayProxyEventV2;
  requestId: string;
}

type RouteHandler = (ctx: RequestContext) => Promise<HttpResponse>;

export function createApp(deps: AppDeps) {
  const routes: Record<string, RouteHandler> = {
    'GET /api/health': async ({ requestId }) =>
      json(
        200,
        {
          status: 'ok',
          // Set once the worker's index manifest exists (Phase 2+).
          indexVersion: null,
          // Set once an active profile set exists (Phase 4b/5).
          profileSetId: null,
          // The indexVersion the active profile set was built from; compared with indexVersion
          // to report version skew (architecture §9.1). Set with profileSetId.
          profileIndexVersion: null,
          analysesEnabled: await deps.killSwitch.analysesEnabled(requestId),
        },
        requestId,
      ),

    // Harmless diagnostic for assumption D9: does the Amplify `/api/<*>` rewrite pass
    // Set-Cookie to the browser and the Cookie header back here? Load it twice; the second
    // response should say received: true. Replaced by POST /api/session in Phase 5.
    'GET /api/diagnostics/cookie': async ({ event, requestId }) => {
      const cookies = event.cookies ?? [];
      const headerCookie = event.headers?.cookie;
      return json(
        200,
        {
          received: cookies.some((c) => c.trim() === PROBE_COOKIE),
          cookieHeaderPresent: cookies.length > 0 || Boolean(headerCookie),
        },
        requestId,
        { cookies: [PROBE_SET_COOKIE] },
      );
    },

    'POST /api/analyses': async ({ event, requestId }) => {
      const parsed = readJsonBody(event, requestId);
      if (!parsed.ok) return parsed.response;
      const result = CreateAnalysisRequestSchema.safeParse(parsed.value);
      if (!result.success) {
        return error('VALIDATION_ERROR', 'Request body is invalid.', requestId, {
          issues: summarizeIssues(result.error.issues),
        });
      }
      // Phase 1 has no queue or worker, so a valid request can't be run no matter what the
      // kill switch says. Answering 503 here keeps the client's disabled path exercised
      // without ever implying a brief was produced.
      return error('ANALYSES_DISABLED', 'Analyses are not enabled in this build.', requestId);
    },
  };

  return async function handle(event: APIGatewayProxyEventV2): Promise<HttpResponse> {
    const requestId = event.requestContext?.requestId ?? 'unknown';
    const method = event.requestContext?.http?.method?.toUpperCase() ?? '';
    const path = normalizePath(event.rawPath ?? '');
    const route = routes[`${method} ${path}`];
    if (!route) return error('NOT_FOUND', 'Route not found.', requestId);
    try {
      return await route({ event, requestId });
    } catch (err) {
      log('error', 'unhandled route error', {
        requestId,
        route: `${method} ${path}`,
        errorName: err instanceof Error ? err.name : 'Unknown',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      return error('INTERNAL', 'An unexpected error occurred.', requestId);
    }
  };
}

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

function readJsonBody(
  event: APIGatewayProxyEventV2,
  requestId: string,
): { ok: true; value: unknown } | { ok: false; response: HttpResponse } {
  const raw = event.body ?? '';
  const buf = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  if (buf.byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: error('VALIDATION_ERROR', 'Request body is too large.', requestId, {
        maxBytes: MAX_BODY_BYTES,
      }),
    };
  }
  try {
    return { ok: true, value: JSON.parse(buf.toString('utf8')) };
  } catch {
    return {
      ok: false,
      response: error('VALIDATION_ERROR', 'Request body must be valid JSON.', requestId),
    };
  }
}

function summarizeIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; code: string; message: string }>,
) {
  return issues.slice(0, MAX_REPORTED_ISSUES).map((i) => ({
    path: i.path.map(String).join('.'),
    code: i.code,
    message: i.message,
  }));
}

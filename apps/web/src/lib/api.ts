import { ApiErrorSchema } from '@diligenceiq/core';

/** A failed API call, normalized for the error panel. */
export class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Same-origin JSON call through the Amplify `/api/<*>` rewrite. Errors come back
 * as ApiRequestError: server errors keep their code and request ID; network
 * failures and non-JSON responses get client-side codes.
 */
export async function apiJson<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('NETWORK', 'The service could not be reached. Check your connection and try again.', null);
  }
  const headerId = res.headers.get('x-request-id') ?? undefined;
  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApiRequestError(
      'UNAVAILABLE',
      res.ok ? 'The service returned an unexpected response.' : `The service is unavailable (HTTP ${res.status}).`,
      res.status,
      headerId,
    );
  }
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiRequestError(e.code, e.message, res.status, e.requestId || headerId);
    }
    throw new ApiRequestError('UNAVAILABLE', `The service is unavailable (HTTP ${res.status}).`, res.status, headerId);
  }
  return payload as T;
}

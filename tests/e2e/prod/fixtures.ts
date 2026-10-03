import { type APIRequestContext, type APIResponse, type Page, type Request, test as base, expect } from '@playwright/test';
import { PROD_URL, STATE_FILE } from './session-state';

/*
 * Fixtures for the production smoke suite. The suite is READ-ONLY: the only write it may send is
 * POST /api/session (opening or confirming the anonymous workspace). Browser requests are routed
 * through a guard that aborts and records anything else that mutates (any POST, PUT, PATCH or
 * DELETE), and the test fails on it; the api clients expose GET and the session request only.
 * Global setup opens the run's one workspace, so a browser POST /api/session must only confirm it:
 * the guard fetches it and fails the test if the answer says a workspace was created.
 */

const path = (url: string) => new URL(url).pathname.replace(/(.)\/$/, '$1');

/** The one mutating request the suite may send. */
export const isSessionPost = (method: string, url: string) => method === 'POST' && path(url) === '/api/session';

const isRead = (method: string) => method === 'GET' || method === 'HEAD' || method === 'OPTIONS';

/** An api client that can only read, plus POST /api/session (which confirms an existing workspace when the cookie is live). */
export interface ReadApi {
  get(url: string): Promise<APIResponse>;
  session(): Promise<APIResponse>;
}

function readOnly(ctx: APIRequestContext): ReadApi {
  return { get: (url) => ctx.get(url, { maxRedirects: 0 }), session: () => ctx.post('/api/session', { maxRedirects: 0 }) };
}

/** Records the page's api calls (any request under /api/), in order. */
export function recordApiRequests(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/api/')) seen.push(r);
  });
  return seen;
}

export const isAnalysisPost = (r: Request) => r.method() === 'POST' && path(r.url()) === '/api/analyses';

/** Waits for the network to go idle and React to flush its effects (as the local suite's `settle`). */
export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestIdleCallback(() => resolve(), { timeout: 2000 }))),
      ),
  );
  await page.waitForLoadState('networkidle');
}

/** Collects CSP violations (listener installed before any page script, outside the policy). */
export async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const console: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) console.push(m.text());
  });
  return async () => [...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)), ...console];
}

/** The Amplify custom headers (infrastructure web-stack) every page and api response carries. */
export function expectSecurityHeaders(headers: Record<string, string>) {
  const hsts = /max-age=(\d+)/.exec(headers['strict-transport-security'] ?? '');
  expect(Number(hsts?.[1] ?? 0), 'HSTS max-age').toBeGreaterThanOrEqual(31_536_000);
  expect(headers['strict-transport-security']).toContain('includeSubDomains');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['permissions-policy']).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
}

/** An api error body: the documented status and code (architecture §9), never a 500. */
export async function expectApiError(res: APIResponse, status: number, code: string) {
  expect(res.status(), `${res.url()} status`).toBe(status);
  const body = (await res.json()) as { error?: { code?: string; requestId?: string } };
  expect(body.error?.code).toBe(code);
  expect(body.error?.requestId).toBeTruthy();
}

interface Fixtures {
  /** Aborts and records every mutating browser request other than POST /api/session, and fails on a browser session POST that creates a workspace (auto). */
  mutationGuard: void;
  /** Read-only client with the run's session cookie. */
  api: ReadApi;
  /** GET-only client with no cookie at all (no `session()`: that would create a workspace). */
  anon: Pick<ReadApi, 'get'>;
}

export const test = base.extend<Fixtures>({
  mutationGuard: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      const created: string[] = [];
      await context.route('**/*', async (route) => {
        const r = route.request();
        if (isRead(r.method())) return route.fallback();
        if (isSessionPost(r.method(), r.url())) {
          // At most one workspace per run (global setup's): a browser session POST may only confirm it.
          const res = await route.fetch();
          const text = await res.text();
          let body: { created?: unknown; workspaceId?: unknown } = {};
          try {
            body = JSON.parse(text) as typeof body;
          } catch {
            // Not JSON (an error page): no workspace was created; the test's own assertions judge it.
          }
          if (body.created === true) created.push(`${r.url()} created workspace ${String(body.workspaceId)}`);
          return route.fulfill({ response: res, body: text });
        }
        blocked.push(`${r.method()} ${r.url()}`);
        return route.abort('blockedbyclient');
      });
      await use();
      expect(blocked, 'mutating requests other than POST /api/session (aborted)').toEqual([]);
      expect(created, 'browser POST /api/session created a workspace (global setup made the run\'s one)').toEqual([]);
    },
    { auto: true },
  ],
  api: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: PROD_URL, storageState: STATE_FILE });
    await use(readOnly(ctx));
    await ctx.dispose();
  },
  anon: async ({ playwright }, use) => {
    const ctx = await playwright.request.newContext({ baseURL: PROD_URL, storageState: { cookies: [], origins: [] } });
    await use({ get: readOnly(ctx).get });
    await ctx.dispose();
  },
});

export { expect };

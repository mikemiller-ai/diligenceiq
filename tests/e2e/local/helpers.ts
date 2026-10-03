import AxeBuilder from '@axe-core/playwright';
import seedJson from '../../../seed/demo-workspace.json';
import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';

/*
 * Shared helpers for the local E2E suite (testing-strategy §6).
 */

/**
 * True for a request the static export itself serves: a same-origin GET or HEAD outside
 * /api/ (pages, scripts, styles, fonts, images, and Next's route prefetches, which are HEAD
 * requests and `*.txt?_rsc=` payloads). The static host can serve nothing else, so every
 * other request (anything under /api/, any other method, any cross-origin URL) is recorded.
 */
function isStatic(origin: string, r: Request): boolean {
  const url = new URL(r.url());
  return url.origin === origin && !url.pathname.startsWith('/api/') && (r.method() === 'GET' || r.method() === 'HEAD');
}

/** Records every request that is not a static asset of the export (API calls, XHR, cross-origin). */
export function recordRequests(page: Page): Request[] {
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  const seen: Request[] = [];
  page.on('request', (r) => {
    if (!isStatic(origin, r)) seen.push(r);
  });
  return seen;
}

/**
 * What opening a page may send: reads (GET) and opening the demo session (POST /api/session).
 * Never POST /api/analyses: that is the only request that leads to a model call.
 */
export const isViewSafe = (r: Request) => {
  const path = new URL(r.url()).pathname.replace(/\/$/, '');
  return r.method() === 'GET' ? path.startsWith('/api/') : r.method() === 'POST' && path === '/api/session';
};

export const isAnalysisPost = (r: Request) =>
  r.method() === 'POST' && new URL(r.url()).pathname.replace(/\/$/, '') === '/api/analyses';

/**
 * Waits until the page has nothing left to do: the network is idle, React has flushed its
 * effects (two animation frames), and the browser reports an idle period. Event-driven, not a
 * fixed sleep, so an effect that would send a request on load has had its chance to do so.
 */
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

/** WCAG 2.1 A/AA axe scan of the current page; fails with the rule IDs and targets. */
export async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The local server's counters (tests/e2e/local-server.ts): `enqueued` counts analyses handed to the worker. */
export async function e2eStats(request: APIRequestContext): Promise<{ enqueued: number; enabled: boolean; mode: string }> {
  return (await request.get('/__e2e/stats')).json();
}

export async function setKillSwitch(request: APIRequestContext, enabled: boolean) {
  await request.post(`/__e2e/kill-switch?enabled=${enabled}`);
}

export async function setWorker(request: APIRequestContext, mode: 'complete' | 'fail' | 'hang') {
  await request.post(`/__e2e/worker?mode=${mode}`);
}

/** Answers POST /api/analyses with ANALYSES_DISABLED in the browser (for flows that must not start one). */
export async function mockAnalysesDisabled(page: Page) {
  await page.route('**/api/analyses', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ANALYSES_DISABLED', message: 'Analyses are not enabled in this build.', requestId: 'e2e' } }),
    }),
  );
}

/** The demo seed every new workspace starts from (real pre-run pipeline output). */
export const SEED = seedJson as unknown as {
  indexVersion: string;
  analyses: Array<{
    analysisId: string;
    question: string;
    brief: { title: string; keyFindings: Array<{ title: string }> };
    citations: Array<{ chunkId: string; text: string }>;
    coverage: { cells: Array<{ ticker: string; period: string; contextChunks: number; citedChunks: number; chunkIds?: string[] }> };
  }>;
  findings: unknown[];
};

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Request } from '@playwright/test';

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

/** Answers POST /api/analyses the way the Phase 1 api does (no worker yet). */
export async function mockAnalysesDisabled(page: Page) {
  await page.route('**/api/analyses', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ANALYSES_DISABLED', message: 'Analyses are not enabled in this build.', requestId: 'e2e' } }),
    }),
  );
}

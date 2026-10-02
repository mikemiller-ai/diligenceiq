import { expect, test } from '@playwright/test';
import { e2eStats, isAnalysisPost, isViewSafe, recordRequests, setKillSwitch, setWorker, settle } from './helpers';

/*
 * SPEC §14.2 / §51.1: a prefilled Deep Analysis never runs without an explicit Run.
 * Loading /analysis/new?q=&tickers=&origin= only fills the form; POST /api/analyses is sent
 * only after clicking Run analysis. Opening any page sends only reads and the session request,
 * and hands nothing to the worker (no model call on a page view). "Ask a question" opens an
 * empty Deep Analysis from every page. The api is the real app (tests/e2e/local-server.ts).
 */

test.beforeEach(async ({ request }) => {
  await setKillSwitch(request, true);
  await setWorker(request, 'complete');
});

test('loading a prefilled Deep Analysis URL sends no analysis request; Run sends exactly one and the brief follows', async ({ page, request }) => {
  const before = (await e2eStats(request)).enqueued;
  const requests = recordRequests(page);
  const q = 'What does Apple disclose about supply chain risk?';
  await page.goto(`/analysis/new/?q=${encodeURIComponent(q)}&tickers=AAPL&origin=recommendation:AAPL:rec-1`);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(q);
  await expect(page.getByText('Prefilled from')).toBeVisible();
  await settle(page);
  expect(requests.filter((r) => !isViewSafe(r)).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
  expect((await e2eStats(request)).enqueued).toBe(before);

  await page.getByRole('textbox', { name: 'Question', exact: true }).fill(`${q} Edited.`);
  await settle(page);
  expect(requests.filter(isAnalysisPost)).toHaveLength(0);

  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page).toHaveURL(/\/analysis\/\?id=/);
  const posts = requests.filter(isAnalysisPost);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataJSON()).toEqual({
    question: `${q} Edited.`,
    origin: { kind: 'recommendation', ticker: 'AAPL', ref: 'rec-1' },
    filters: { tickers: ['AAPL'] },
  });
  expect((await e2eStats(request)).enqueued).toBe(before + 1);
  await expect(page.getByRole('heading', { name: 'Key findings' })).toBeVisible({ timeout: 10_000 });
});

test('Ask a question from a prefilled Deep Analysis opens an empty form: no stale question, origin or filter', async ({ page, request }) => {
  // Regression (adversary finding 2). Analyses are paused here so the form stays put after Run.
  await setKillSwitch(request, false);
  const requests = recordRequests(page);
  await page.goto('/analysis/new/?q=Prefilled%20Q&tickers=AAPL&origin=recommendation:AAPL:rec-1');
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Prefilled Q');
  await page.getByRole('link', { name: 'Ask a question' }).click();
  await expect(page).toHaveURL(/\/analysis\/new\/$/);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('');
  await expect(page.getByText('Prefilled from')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Selected companies' })).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('A fresh question');
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'New analyses are paused' }).last()).toBeVisible();
  const posts = requests.filter(isAnalysisPost);
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataJSON()).toEqual({ question: 'A fresh question', filters: {} });

  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Prefilled Q');
  await expect(page.getByText('Prefilled from')).toBeVisible();
});

test('Investigate on Company Intelligence prefills Deep Analysis without running it', async ({ page, request }) => {
  const before = (await e2eStats(request)).enqueued;
  const requests = recordRequests(page);
  await page.goto('/intelligence/?ticker=AAPL');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Apple Inc');
  await page.getByRole('region', { name: 'Supply chain' }).getByRole('link', { name: /Investigate/ }).first().click();
  await expect(page).toHaveURL(/\/analysis\/new\/\?.*origin=currentRisk%3AAAPL%3Arisk-/);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(/supply chain risk/);
  await settle(page);
  expect(requests.filter((r) => !isViewSafe(r))).toEqual([]);
  expect((await e2eStats(request)).enqueued).toBe(before);
});

const PAGES: Array<{ path: string; ask: string }> = [
  { path: '/', ask: 'Ask any question' },
  { path: '/architecture/', ask: 'Ask a question' },
  { path: '/intelligence/', ask: 'Ask a question' },
  { path: '/intelligence/?ticker=MSFT', ask: 'Ask a question' },
  { path: '/compare/?tickers=AAPL,MSFT,NVDA', ask: 'Ask a question' },
  { path: '/findings/', ask: 'Ask a question' },
  { path: '/analysis/new/', ask: 'Ask a question' },
  { path: '/analysis/?id=an-unknown', ask: 'Ask a question' },
  { path: '/sources/filing/?id=AAPL_10K_2025-10-31', ask: 'Ask a question' },
];

for (const { path, ask } of PAGES) {
  test(`${path}: opening the page sends only reads and the session, starts no analysis, and ${ask} opens an empty Deep Analysis`, async ({ page, request }) => {
    const before = (await e2eStats(request)).enqueued;
    const requests = recordRequests(page);
    await page.goto(path);
    await settle(page);
    expect(requests.filter((r) => !isViewSafe(r)).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
    expect((await e2eStats(request)).enqueued).toBe(before);
    await page.getByRole('link', { name: ask, exact: true }).click();
    await expect(page).toHaveURL(/\/analysis\/new\/$/);
    await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('');
  });
}

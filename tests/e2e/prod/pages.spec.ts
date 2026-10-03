import { type Page } from '@playwright/test';
import { type CompanyIntelligenceProfile, type WorkspaceResponse } from '@diligenceiq/core';
import { expect, expectSecurityHeaders, isAnalysisPost, recordApiRequests, settle, test, watchViolations } from './fixtures';

/*
 * The deployed static export on Amplify (SPEC §49 Phase 8): every P0 page loads over HTTPS with the
 * security headers, carries exactly one CSP <meta> and raises no violation; the main sections and
 * the Primary nav render from production data; a prefilled Deep Analysis sends no POST
 * /api/analyses; an unknown page is a 404; phone width has no sideways scroll. Opening pages only
 * reads (and confirms the run's session); the fixtures' guard aborts anything else.
 */

const PRIMARY = ['Company Intelligence', 'Compare', 'Deep Analysis', 'Findings'];
const PREFILL_Q = 'What does Apple disclose about supply chain risk?';

async function expectPrimaryNav(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const name of PRIMARY) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
}

/** A seeded analysis and a cited filing of this workspace, for the brief and source-view pages. */
async function workspaceTargets(api: { get(url: string): Promise<{ json(): Promise<unknown> }> }) {
  const ws = (await (await api.get('/api/workspace')).json()) as WorkspaceResponse;
  const profile = (await (await api.get('/api/companies/AAPL/intelligence')).json()) as CompanyIntelligenceProfile;
  const c = profile.citations.find((x) => x.filingType === '10-K') ?? profile.citations[0]!;
  return { analysisId: ws.recentAnalyses[0]!.analysisId, citation: c };
}

const STATIC_PAGES = [
  '/',
  '/architecture/',
  '/intelligence/?ticker=AAPL',
  '/compare/?tickers=AAPL,MSFT,NVDA',
  `/analysis/new/?q=${encodeURIComponent(PREFILL_Q)}&tickers=AAPL&origin=recommendation:AAPL:rec-1`,
  '/findings/',
];

for (const path of STATIC_PAGES) {
  test(`page ${path}: HTTPS, security headers, one CSP meta, no violation, no analysis request`, async ({ page }) => {
    const violations = await watchViolations(page);
    const requests = recordApiRequests(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expect(page.url()).toMatch(/^https:\/\//);
    expectSecurityHeaders(await res!.allHeaders());
    await settle(page);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    expect(await violations()).toEqual([]);
    expect(requests.filter(isAnalysisPost)).toHaveLength(0);
  });
}

test('pages: the seeded brief and a cited source filing render under one CSP meta with no violation', async ({ page, api }) => {
  const { analysisId, citation } = await workspaceTargets(api);
  const violations = await watchViolations(page);
  for (const path of [`/analysis/?id=${analysisId}`, `/sources/filing/?id=${citation.documentId}&iv=${citation.indexVersion}#chunk-${citation.chunkId}`]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    expectSecurityHeaders(await res!.allHeaders());
    await settle(page);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    await expectPrimaryNav(page);
    if (path.startsWith('/analysis/')) await expect(page.getByRole('heading', { name: 'Key findings' })).toBeVisible();
  }
  // The source view loaded the filing text (S3) and highlights the cited passage; the brief above came from DynamoDB.
  await expect(page.locator(`mark[id="chunk-${citation.chunkId}"]`)).toBeVisible();
  await expect(page.getByTestId('highlight-notice')).toContainText(citation.chunkId);
  expect(await violations()).toEqual([]);
});

test('Company Intelligence for AAPL renders its main sections from the production profile set', async ({ page }) => {
  await page.goto('/intelligence/?ticker=AAPL');
  await settle(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Apple Inc');
  await expectPrimaryNav(page);
  await expect(page.getByRole('heading', { name: 'Bottom line' })).toBeVisible();
  const jump = page.getByRole('navigation', { name: 'On this page' });
  for (const name of ['30-second view', 'Performance', 'Current risks', 'What’s changed', 'Attention signals', 'Recommended', 'Coverage']) {
    await expect(jump.getByRole('link', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Attention signals', level: 2 })).toBeAttached();
});

test('Compare and Findings render with the Primary nav; Architecture renders with its own header', async ({ page }) => {
  await page.goto('/compare/?tickers=AAPL,MSFT,NVDA');
  await settle(page);
  await expectPrimaryNav(page);
  await expect(page.getByRole('region', { name: 'Bottom line' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Side by side' })).toBeVisible();

  await page.goto('/findings/');
  await settle(page);
  await expectPrimaryNav(page);
  await expect(page.getByRole('heading', { level: 3 }).first()).toBeVisible();

  // Architecture is a secondary page outside the workspace shell (DD-15): a top bar, no Primary sidebar.
  await page.goto('/architecture/');
  await settle(page);
  await expect(page.getByRole('link', { name: 'Open Company Intelligence' }).first()).toHaveAttribute('href', /\/intelligence\/?$/);
  await expect(page.getByRole('link', { name: 'Ask a question' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('DiligenceIQ');
});

test('a prefilled Deep Analysis URL fills the form and sends no POST /api/analyses', async ({ page }) => {
  const requests = recordApiRequests(page);
  await page.goto(`/analysis/new/?q=${encodeURIComponent(PREFILL_Q)}&tickers=AAPL&origin=recommendation:AAPL:rec-1`);
  await expectPrimaryNav(page);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(PREFILL_Q);
  await expect(page.getByText('Prefilled from')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run analysis' })).toBeVisible();
  await settle(page);
  expect(requests.filter(isAnalysisPost)).toHaveLength(0);
  // Reads only, plus confirming the session: nothing else reached the api.
  const writes = requests.filter((r) => r.method() !== 'GET' && !(r.method() === 'POST' && new URL(r.url()).pathname === '/api/session'));
  expect(writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

test('an unknown page answers 404 with the not-found page', async ({ page }) => {
  const res = await page.goto('/does-not-exist/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('This page isn’t part of the workspace');
  // web-stack: the '/<*>' rule is the '404-200' type (not found, rewrite): /404.html is served in place with a real 404
  // status. The plain '404' type redirected (302 to /404.html, then 200).
  expect(res?.status(), `final status after ${page.url()}`).toBe(404);
});

for (const path of ['/intelligence/?ticker=AAPL', '/compare/?tickers=AAPL,MSFT,NVDA']) {
  test(`on a 390 px phone, ${path.split('?')[0]} has no sideways page scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await settle(page);
    // Unfold everything first (disclosure controls only; nothing that saves).
    const showAll = page.getByRole('button', { name: /^Show all \d+/ });
    while ((await showAll.count()) > 0) await showAll.first().click();
    const more = page.getByRole('button', { name: /^More:/ });
    while ((await more.count()) > 0) await more.first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

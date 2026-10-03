import { expect, test, type Page } from '@playwright/test';
import { SEED, settle } from './helpers';

/*
 * The static export's CSP (assumptions D10; apps/web/src/build/csp.ts). Every page carries a
 * per-page `<meta>` policy whose script-src lists only that page's inline-script hashes. These
 * tests prove the real pages run under it without a single violation, that it is enforced, and
 * that the theme pre-paint script is allowed by its hash.
 */

const PAGES = [
  '/',
  '/architecture/',
  '/intelligence/?ticker=AAPL',
  '/compare/?tickers=AAPL,MSFT,NVDA',
  '/analysis/new/?q=What%20changed%3F&tickers=AAPL&origin=recommendation:AAPL:rec-1',
  `/analysis/?id=${SEED.analyses[0]!.analysisId}`,
  '/findings/',
  '/sources/filing/?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-1A-001',
  '/does-not-exist/',
];

/** Collects CSP violations from the page (the listener is installed by CDP, outside the policy). */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
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

for (const path of PAGES) {
  test(`csp: ${path} loads and hydrates with no violation`, async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto(path);
    await settle(page);
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
    expect(await violations()).toEqual([]);
  });
}

test('csp: client-side navigation and the theme toggle raise no violation', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto('/intelligence/?ticker=AAPL');
  await settle(page);
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('link', { name: 'Compare' }).click();
  await settle(page);
  await nav.getByRole('link', { name: 'Findings' }).click();
  await settle(page);
  await nav.getByRole('link', { name: 'Deep Analysis' }).click();
  await settle(page);
  // The theme toggle, chosen from the top bar: Dark, then back to System.
  const theme = page.getByRole('radiogroup', { name: 'Colour theme' });
  await theme.getByRole('radio', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.getByRole('radio', { name: 'System theme' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  expect(await violations()).toEqual([]);
});

test('csp: an injected inline script is blocked (the policy is enforced)', async ({ page }) => {
  const violations = await watchViolations(page);
  await page.goto('/');
  await settle(page);
  const ran = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__injected = true';
    document.head.append(s);
    return (window as unknown as { __injected?: boolean }).__injected === true;
  });
  expect(ran).toBe(false);
  expect((await violations()).some((v) => v.startsWith('script-src'))).toBe(true);
});

test('csp: the theme pre-paint script runs by its hash, before any bundle', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('diligenceiq:theme', 'dark'));
  // Block every external script: only the inline (hash-allowed) scripts can set the theme now.
  await page.route('**/_next/static/**/*.js', (route) => route.abort());
  await page.goto('/compare/');
  // The page is under its CSP meta, so the theme applied by its hash, not by a missing policy.
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

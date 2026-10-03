import { expect, test } from '@playwright/test';
import { SEED, expectNoAxeViolations, isViewSafe, recordRequests, settle } from './helpers';

/*
 * Phase 6r step 2 (DD-21 e–f), readable evidence, against the real api over the corpus:
 * - the drawer leads with the sentences that support the statement, highlighted in place, and the
 *   full passage is one click away;
 * - Compare periods shows a sentence diff (new, removed, unchanged collapsed);
 * - the source view lays a filing out with headings and real tables, page furniture hidden.
 * Opening any of it sends reads only (no model call on page view).
 */

const SEEDED = SEED.analyses[0]!.analysisId;
const CITED = 'NVDA-FY2026Q3-10Q-MDA-004';

test('a citation opens on the sentences that support its statement; the full passage is one click away', async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto('/intelligence/?ticker=AAPL');
  await settle(page);
  const risk = page.getByRole('region', { name: 'Current risks' }).locator('blockquote').first();
  const heading = (await risk.locator('[data-allow-figures]').textContent()) ?? '';
  await risk.getByRole('button', { name: /^View evidence / }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByTestId('evidence-claim')).toHaveText(heading);
  const passage = drawer.getByTestId('evidence-passage');
  await expect(passage).toHaveAttribute('data-view', 'key');
  // The risk heading is in its own passage, so it is among the highlighted sentences.
  await expect(passage.locator('mark[data-mark="key"]').filter({ hasText: heading.slice(0, 40) })).toHaveCount(1);
  await expectNoAxeViolations(page);
  await drawer.getByRole('button', { name: 'Show full passage' }).click();
  await expect(passage).toHaveAttribute('data-view', 'full');
  await expect(drawer.getByRole('button', { name: 'Show closest sentences only' })).toHaveAttribute('aria-expanded', 'true');
  await expectNoAxeViolations(page);
  expect(requests.filter((r) => !isViewSafe(r)).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

test('Compare periods shows what changed sentence by sentence, unchanged collapsed', async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto(`/analysis/?id=${SEEDED}`);
  await settle(page);
  await page.getByRole('button', { name: `View evidence ${CITED}` }).first().click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Compare periods' }).click();
  const diff = drawer.getByTestId('sentence-diff');
  await expect(diff).toBeVisible();
  await expect(diff.getByTestId('diff-added').getByRole('heading')).toHaveText(/^New in FY2026Q3 10-Q, in the shared stretch \(\d+\)$/);
  await expect(diff.getByTestId('diff-removed').getByRole('heading')).toHaveText(/^Removed since FY2026Q2 10-Q, in the shared stretch \(\d+\)$/);
  const unchanged = diff.getByTestId('diff-unchanged');
  await expect(unchanged).not.toHaveAttribute('open');
  await expect(unchanged.locator('summary')).toHaveText(/^Unchanged \(\d+\)$/);
  await expectNoAxeViolations(page);
  expect(requests.filter((r) => !isViewSafe(r)).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
});

test('the source view lays the filing out: headings, risk headings and tables, page footers hidden', async ({ page }) => {
  await page.goto('/sources/filing/?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-1A-001');
  await settle(page);
  await expect(page.locator('mark[id="chunk-AAPL-FY2025-10K-1A-001"]')).toBeFocused();
  const article = page.getByRole('article');
  expect(await article.locator('h3[data-level="risk"]').count()).toBeGreaterThan(20);
  expect(await article.locator('table').count()).toBeGreaterThan(20);
  await expect(article.getByRole('rowheader', { name: 'Total net sales' }).first()).toBeVisible();
  // Running footers ("Apple Inc. | 2025 Form 10-K | 21") are page furniture, not content.
  expect(await article.textContent()).not.toMatch(/Apple Inc\. \| 2025 Form 10-K \| \d+/);
  // Header rows are column headers: the segment table's years sit over its values (H1).
  expect(await article.locator('thead th[scope="col"]', { hasText: /^2025$/ }).count()).toBeGreaterThan(5);
  // Only a table that actually scrolls sideways is a tab stop (M4); on a desktop width most fit.
  const tables = await article.locator('table').count();
  const stops = await article.locator('div[tabindex="0"]:has(> table)').count();
  expect(stops).toBeLessThan(tables / 2);
  await expectNoAxeViolations(page);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('the source view never scrolls sideways; a wide table scrolls inside its own box', async ({ page }) => {
    await page.goto('/sources/filing/?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-MDA-003');
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // Every table box that overflows is focusable (axe scrollable-region-focusable), and only those (M4).
    const boxes = await page.locator('div:has(> table[data-block="table"])').evaluateAll((els) =>
      els.map((el) => ({ overflows: el.scrollWidth > el.clientWidth + 1, focusable: el.getAttribute('tabindex') === '0' })),
    );
    expect(boxes.filter((b) => b.overflows !== b.focusable)).toEqual([]);
    expect(boxes.some((b) => b.overflows)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

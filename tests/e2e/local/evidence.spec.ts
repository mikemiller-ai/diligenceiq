import { expect, test } from '@playwright/test';
import nvdaAdjacency from '../../fixtures/evidence/iv-9cf51c066743/adjacency/NVDA.json';
import { SEED, expectNoAxeViolations, isViewSafe, recordRequests, settle } from './helpers';

/*
 * Phase 6 evidence path (SPEC §16.2): a seeded brief's citation → its passage → the same section
 * in the adjacent filings → the readable filing with the passage highlighted; and a coverage
 * cell → its passages. The api is the real app: filings are processed from the corpus and the
 * adjacency comes from the committed subset (tests/fixtures/evidence). Only reads are sent.
 */

const SEEDED = SEED.analyses[0]!.analysisId;
const CITED = 'NVDA-FY2026Q3-10Q-MDA-004';
const adjacency = nvdaAdjacency as unknown as Record<
  string,
  { previous: { documentId: string; fiscalLabel: string; matches: Array<{ chunkId: string }> } | null }
>;
const PREVIOUS = adjacency[CITED]!.previous!;

test('a brief citation compares with the prior quarter and opens in the filing, highlighted', async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto(`/analysis/?id=${SEEDED}`);
  await settle(page);
  await page.getByRole('button', { name: `View evidence ${CITED}` }).first().click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Validated — supplied to the model');

  await drawer.getByRole('button', { name: 'Compare periods' }).click();
  await expect(drawer.getByRole('tab', { name: /Prior quarter/ })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('tab', { name: /Same quarter, prior year/ })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Prior quarter' })).toContainText(PREVIOUS.fiscalLabel);
  await expectNoAxeViolations(page);

  // The prior quarter's closest passage opens in its own filing, highlighted.
  await drawer.getByRole('region', { name: 'Prior quarter' }).getByRole('link', { name: 'Open in filing' }).first().click();
  // The link carries the passage's index version, so the source view asks for exactly that version.
  await expect(page).toHaveURL(new RegExp(`/sources/filing/\\?id=${PREVIOUS.documentId}&iv=${SEED.indexVersion}#chunk-${PREVIOUS.matches[0]!.chunkId}$`));
  const mark = page.locator(`mark[id="chunk-${PREVIOUS.matches[0]!.chunkId}"]`);
  await expect(mark).toBeVisible();
  await expect(mark).toBeFocused();
  await expect(page.getByTestId('highlight-notice')).toContainText(PREVIOUS.matches[0]!.chunkId);
  await expect(page.getByRole('navigation', { name: 'Sections' }).locator('[aria-current="location"]')).toContainText('Management');

  expect(requests.filter((r) => !isViewSafe(r)).map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
  expect(requests.some((r) => r.url().includes('/api/evidence/adjacent?chunkId='))).toBe(true);
  expect(requests.some((r) => r.url().includes(`/api/sources/${PREVIOUS.documentId}?indexVersion=${SEED.indexVersion}`))).toBe(true);
});

test('the cited passage itself opens in its filing at the exact span', async ({ page }) => {
  await page.goto(`/analysis/?id=${SEEDED}`);
  await settle(page);
  const citation = SEED.analyses[0]!.citations.find((c) => c.chunkId === CITED)!;
  await page.getByRole('button', { name: `View evidence ${CITED}` }).first().click();
  await page.getByRole('dialog').getByRole('link', { name: 'Open filing' }).click();
  const mark = page.locator(`mark[id="chunk-${CITED}"]`);
  await expect(mark).toBeVisible();
  expect(await mark.textContent()).toBe(citation.text);
});

test('a coverage cell opens the passages supplied for that company and period', async ({ page }) => {
  await page.goto(`/analysis/?id=${SEEDED}`);
  await settle(page);
  const cell = SEED.analyses[0]!.coverage.cells.find((c) => c.contextChunks > 0 && c.citedChunks > 0)!;
  // The accessible name starts with the visible cell text (WCAG 2.5.3 label in name).
  await page.getByRole('button', { name: new RegExp(`^${cell.period} ${cell.contextChunks} · ${cell.citedChunks} cited \\(view .* for ${cell.ticker}\\)$`) }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toContainText('Evidence coverage');
  await expect(drawer.getByRole('region', { name: 'Cited in the brief' }).locator('blockquote')).toHaveCount(cell.citedChunks);
  await expect(drawer.getByRole('region', { name: 'Supplied, not cited' }).locator('blockquote')).toHaveCount(cell.contextChunks - cell.citedChunks);
});

test('axe: the source view with a highlighted passage', async ({ page }) => {
  await page.goto(`/sources/filing/?id=${PREVIOUS.documentId}#chunk-${PREVIOUS.matches[0]!.chunkId}`);
  await settle(page);
  await expect(page.locator('mark')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a filing that is not in the index says so and offers a way back (architecture §9.1)', async ({ page }) => {
  await page.goto('/sources/filing/?id=AAPL_10K_2001-01-01');
  await settle(page);
  await expect(page.getByText('This filing isn’t available.')).toBeVisible();
  // Opened directly, there is no page of the app to go back to: the recovery is the company's intelligence page.
  await expect(page.getByRole('main').getByRole('link', { name: 'Open Company Intelligence' })).toHaveAttribute('href', /\/intelligence\/?\?ticker=AAPL$/);
  await expect(page.getByRole('button', { name: 'Go back' })).toHaveCount(0);
  // The page's session answers the route itself with the §9.1 code.
  const missing = await page.request.get('/api/sources/AAPL_10K_2001-01-01');
  expect(missing.status()).toBe(404);
  expect(((await missing.json()) as { error: { code: string } }).error.code).toBe('SOURCE_MISSING');
});

import { expect, test, type Page } from '@playwright/test';
import { e2eStats, expectNoAxeViolations, isViewSafe, recordRequests, settle } from '../local/helpers';

/*
 * Phase 6r step 4 (DD-21 h) on REAL built profiles (AAPL, MSFT, NVDA, PFE …) and the seeded
 * workspace: the refined Compare (bottom line, chips with values and sparklines, the risk-area
 * grid) and the refined Findings board (summary strip, one filter row, compact cards, Board view,
 * Ask follow-up). Light and dark, folded and expanded, axe clean, phone width without sideways
 * scroll, and opening either page sends reads only plus POST /api/session.
 */

async function expandAll(page: Page) {
  const showAll = page.getByRole('button', { name: /^Show all \d+/ });
  while ((await showAll.count()) > 0) await showAll.first().click();
  const more = page.getByRole('button', { name: /^More:/ });
  while ((await more.count()) > 0) await more.first().click();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`Compare AAPL, MSFT, NVDA (${scheme}): bottom line, chips with values and sparklines, the risk grid, axe clean folded and expanded`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests = recordRequests(page);
    await page.goto('/compare/?tickers=AAPL,MSFT,NVDA');
    await settle(page);

    const bottom = page.getByRole('region', { name: 'Bottom line' });
    await expect(bottom.getByRole('link')).toHaveText([
      'Revenue grew at all three',
      'NVIDIA’s operating margin widened 8.3 pp',
      'Apple’s operating cash flow fell 5.7%',
      /^\d+ risk areas shared by all three$/,
      /^\d+ areas only at NVIDIA$/,
    ]);
    // The footer agrees with the lines: Apple's cash flow fell while the others still grew (more slowly).
    await expect(bottom).toContainText('Opposite directions: Operating cash flow (rising at Microsoft and NVIDIA, falling at Apple).');
    await expect(bottom.getByRole('list', { name: 'Legend' })).toContainText('no colour: one company differs');

    const table = page.getByRole('region', { name: 'Side by side' }).getByRole('table');
    const revenue = table.locator('tr[data-metric="Revenue"]');
    await expect(revenue).toContainText('$416.2B · +6.4% in FY2025');
    await expect(revenue).toContainText('$130.5B · +114.2% in FY2025');
    await expect(revenue).toContainText('after +125.9% in FY2024');
    await expect(revenue.getByRole('img', { name: /^Revenue, NVIDIA, FY\d{4} to FY2025$/ })).toBeVisible();
    // The former Coverage and Fiscal year rows are in the column headers.
    await expect(table.getByRole('columnheader', { name: /Apple/ })).toContainText('FY ends Sep 27, 2025');
    await expectNoAxeViolations(page);

    // The grid: a cell opens that company's headings, signals and passages.
    const grid = page.getByRole('region', { name: 'Risk areas' });
    await expect(grid.locator('tr[data-area]:visible')).toHaveCount(5);
    await grid.getByRole('button', { name: /^Apple, Regulatory: 4 headings/ }).click();
    const popover = page.getByRole('dialog', { name: 'Apple · Regulatory' });
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('Latest risk headings');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');

    await expandAll(page);
    await expect(grid.locator('tr[data-area]:visible')).toHaveCount(await grid.locator('tr[data-area]').count());
    await expectNoAxeViolations(page);
    expect(requests.every(isViewSafe)).toBe(true);
  });

  test(`Findings (${scheme}): summary strip, one filter row with search, compact cards and Board, axe clean`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests = recordRequests(page);
    await page.goto('/findings/');
    await settle(page);
    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary).toBeVisible();
    const cards = page.getByRole('heading', { level: 3 });
    const total = await cards.count();
    expect(total).toBeGreaterThan(1);
    await expectNoAxeViolations(page);

    // A status tile filters, and toggles back.
    // The tile's name holds its visible sub-line too.
    const followUp = summary.getByRole('button', { name: /^Needs follow-up: \d+\. / });
    const n = Number(/: (\d+)\./.exec((await followUp.getAttribute('aria-label'))!)![1]);
    await followUp.click();
    await expect(followUp).toHaveAttribute('aria-pressed', 'true');
    await expect(cards).toHaveCount(n);
    await followUp.click();
    await expect(cards).toHaveCount(total);

    // Search narrows by title, text, note, ticker or company name: the longest title matches only its own finding.
    const titles = await cards.allTextContents();
    const only = titles.reduce((a, b) => (b.length > a.length ? b : a));
    const search = page.getByLabel('Search findings and notes');
    await search.fill(only);
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveText(only);
    await expect(page.getByText(/^1 finding · 1 filter applied$/)).toBeVisible();
    await search.fill('');
    await expect(cards).toHaveCount(total);
    await search.fill('zzzz-no-such-finding');
    await expect(page.getByText('No findings match these filters')).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(cards).toHaveCount(total);

    // More filters reveals theme, analysis and dates.
    await page.getByRole('button', { name: /^More filters/ }).click();
    await expect(page.getByLabel('Theme', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Saved from')).toBeVisible();
    await expandAll(page);
    await expectNoAxeViolations(page);

    // Board: three status columns holding the same cards.
    await page.getByRole('radio', { name: 'Board' }).click();
    for (const col of ['Needs follow-up', 'Active', 'Resolved']) await expect(page.getByRole('heading', { name: new RegExp(`^${col} · \\d+$`) })).toBeVisible();
    await expect(cards).toHaveCount(total);
    await expectNoAxeViolations(page);

    // Sources: one opens its passage; several unfold their chips, each opening its passage directly.
    const several = page.getByRole('button', { name: /^\d+ sources: show the passages for / }).first();
    if ((await several.count()) > 0) {
      await several.click();
      await expect(several).toHaveAttribute('aria-expanded', 'true');
      const list = page.locator(`[id="${await several.getAttribute('aria-controls')}"]`);
      await expect(list.getByRole('button', { name: 'View all side by side' })).toBeVisible();
      await list.getByRole('listitem').first().getByRole('button').click();
    } else {
      await page.getByRole('button', { name: /^1 source: open the evidence for / }).first().click();
    }
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page);
    expect(requests.every(isViewSafe)).toBe(true);
  });
}

test('Board: changing a card’s status moves it to that column', async ({ page }) => {
  await page.goto('/findings/');
  await settle(page);
  await page.getByRole('radio', { name: 'Board' }).click();
  const resolved = page.getByRole('region', { name: /^Resolved · \d+$/ });
  const before = await resolved.getByRole('heading', { level: 3 }).count();
  const active = page.getByRole('region', { name: /^Active · \d+$/ });
  const title = (await active.getByRole('heading', { level: 3 }).first().textContent())!;
  await active.getByLabel(`Status for ${title}`).selectOption('RESOLVED');
  await expect(resolved.getByRole('heading', { level: 3, name: title })).toBeVisible();
  await expect(resolved.getByRole('heading', { level: 3 })).toHaveCount(before + 1);
});

test('Ask follow-up only prefills Deep Analysis with the finding origin; nothing runs', async ({ page, request }) => {
  const enqueued = (await e2eStats(request)).enqueued;
  const requests = recordRequests(page);
  await page.goto('/findings/');
  await settle(page);
  const title = (await page.getByRole('heading', { level: 3 }).first().textContent())!;
  await page.getByRole('link', { name: `Ask follow-up about ${title}` }).click();
  await expect(page).toHaveURL(/\/analysis\/new\/\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get('q')!.startsWith(`Follow up on the finding “${title}”: what do the filings of `)).toBe(true);
  expect(url.searchParams.get('origin')).toMatch(/^finding:fd-[0-9a-f]+$/);
  await settle(page);
  await expect(page.getByText('A saved finding')).toBeVisible();
  await expect(page.getByRole('textbox').first()).toHaveValue(url.searchParams.get('q')!);
  expect(requests.every(isViewSafe)).toBe(true);
  expect(requests.some((r) => r.method() === 'POST' && new URL(r.url()).pathname === '/api/analyses')).toBe(false);
  expect((await e2eStats(request)).enqueued).toBe(enqueued);
});

test('Compare with a stale period (PFE): the line names it as not compared; the cell names its year', async ({ page }) => {
  await page.goto('/compare/?tickers=AAPL,MSFT,PFE');
  await settle(page);
  await expect(page.getByRole('region', { name: 'Bottom line' })).toContainText('Pfizer (latest trend FY2022)');
  const ocf = page.getByRole('region', { name: 'Side by side' }).locator('tr[data-metric="Operating cash flow"]');
  await expect(ocf).toContainText('latest trend FY2022');
});

for (const path of ['/compare/?tickers=AAPL,MSFT,NVDA', '/findings/']) {
  test(`on a phone, ${path.split('?')[0]} has no sideways page scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await settle(page);
    await expandAll(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Phase 9 review item 15: the company columns scroll inside their box, and the page says so.
    if (path.startsWith('/compare/')) await expect(page.getByTestId('scroll-hint').first()).toBeVisible();
    if (path === '/findings/') {
      await page.getByRole('radio', { name: 'Board' }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
}

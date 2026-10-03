import { expect, test, type Page } from '@playwright/test';
import { SEED, expectNoAxeViolations, isViewSafe, recordRequests, settle } from '../local/helpers';

/*
 * Phase 6r step 3 (DD-21 g) on REAL built profiles and the seeded briefs: the brief's bottom line
 * and jump bar, and Compare's trend chips and condensed sections. Light and dark, folded and
 * expanded, axe clean, and opening either page sends reads only plus POST /api/session.
 */

const SEEDED = SEED.analyses[0]!;

async function expandAll(page: Page) {
  const showAll = page.getByRole('button', { name: /^Show all \d+/ });
  while ((await showAll.count()) > 0) await showAll.first().click();
  const more = page.getByRole('button', { name: /^More:/ });
  while ((await more.count()) > 0) await more.first().click();
}

for (const scheme of ['light', 'dark'] as const) {
  test(`brief (${scheme}): the bottom line jumps to a finding below both sticky bars, and axe is clean`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests = recordRequests(page);
    await page.goto(`/analysis/?id=${SEEDED.analysisId}`);
    await settle(page);
    const bottom = page.getByRole('region', { name: 'Bottom line' });
    const headlines = bottom.getByRole('link');
    await expect(headlines).toHaveText(SEEDED.brief!.keyFindings.map((k) => k.title));
    await expectNoAxeViolations(page);

    await headlines.nth(2).click();
    await expect(page).toHaveURL(/#finding-3$/);
    const target = page.locator('#finding-3');
    await expect(target).toBeInViewport();
    const jump = page.getByRole('navigation', { name: 'On this page' });
    const navBox = (await jump.boundingBox())!;
    expect((await target.boundingBox())!.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);

    await jump.getByRole('link', { name: /Considerations/ }).click();
    await expect(page).toHaveURL(/#considerations$/);
    await expect(jump.getByRole('link', { name: /Considerations/ })).toHaveAttribute('aria-current', 'location');
    // The active link sits on the primary fill: axe checks its contrast now.
    await expectNoAxeViolations(page);
    expect(requests.every(isViewSafe)).toBe(true);
  });

  test(`Compare (${scheme}): trend chips, a legend and condensed sections, folded and expanded, axe clean`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests = recordRequests(page);
    await page.goto('/compare/?tickers=AAPL,TSLA,JPM');
    await settle(page);
    const side = page.getByRole('region', { name: 'Side by side' });
    // Within the table: the legend under it also has direction chips.
    const table = side.getByRole('table');
    await expect(table.locator('[data-direction="up"]').first()).toBeVisible();
    await expect(table.locator('[data-direction="down"]').first()).toBeVisible();
    await expect(side.getByRole('list', { name: 'Legend' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Diverging trends' }).getByText('Apple Inc: rising').first()).toBeVisible();
    await expectNoAxeViolations(page);

    const ranking = page.getByRole('region', { name: 'Attention ranking' });
    const toggle = ranking.getByRole('button', { name: /^Show all \d+ areas/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(ranking.getByRole('button', { name: /^Show fewer/ })).toHaveAttribute('aria-expanded', 'true');
    // Focus moves to the first area revealed.
    await expect(ranking.locator('ol > li').nth(5)).toBeFocused();
    await expandAll(page);
    await expectNoAxeViolations(page);
    expect(requests.every(isViewSafe)).toBe(true);
  });
}

test('brief at 900 px: Evidence coverage and Sources jump below the sticky bars, are marked, and take keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(`/analysis/?id=${SEEDED.analysisId}`);
  await settle(page);
  const jump = page.getByRole('navigation', { name: 'On this page' });
  const landsBelowBar = async (id: string) => {
    const target = page.locator(`#${id}`);
    await expect(target).toBeInViewport();
    const navBox = (await jump.boundingBox())!;
    await expect.poll(async () => (await target.boundingBox())!.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
    await expect(target).toBeFocused();
  };

  await jump.getByRole('link', { name: 'Evidence coverage' }).click();
  await expect(page).toHaveURL(/#coverage$/);
  await landsBelowBar('coverage');
  await expect(jump.getByRole('link', { name: 'Evidence coverage' })).toHaveAttribute('aria-current', 'location');

  // Below lg the Sources rail stacks under the whole brief: one click reaches it, and it is tracked.
  await jump.getByRole('link', { name: /^Sources/ }).click();
  await expect(page).toHaveURL(/#sources$/);
  await landsBelowBar('sources');
  await expect(jump.getByRole('link', { name: /^Sources/ })).toHaveAttribute('aria-current', 'location');
});

test('brief, wide: a jump to Follow-up questions (beside Evidence gaps, equal tops) marks Follow-up questions, not Evidence gaps', async ({ page }) => {
  // A short window, so the heading can reach the scroll offset (not the page bottom, where the last section wins anyway).
  await page.setViewportSize({ width: 1280, height: 520 });
  await page.goto(`/analysis/?id=${SEEDED.analysisId}`);
  await settle(page);
  const jump = page.getByRole('navigation', { name: 'On this page' });
  await jump.getByRole('link', { name: /Follow-up questions/ }).click();
  await expect(page).toHaveURL(/#follow-ups$/);
  await expect(page.locator('#follow-ups')).toBeFocused();
  // Let the smooth scroll land both side-by-side headings at the scroll offset, then check the mark held.
  const offset = await page.evaluate(() => Math.round(parseFloat(getComputedStyle(document.getElementById('follow-ups')!).scrollMarginTop)));
  const tops = () => page.evaluate(() => ['gaps', 'follow-ups'].map((id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top)));
  await expect.poll(tops).toEqual([offset, offset]);
  expect(await page.evaluate(() => window.innerHeight + window.scrollY < document.documentElement.scrollHeight - 4)).toBe(true);
  await expect(jump.getByRole('link', { name: /Follow-up questions/ })).toHaveAttribute('aria-current', 'location');
  await expect(jump.getByRole('link', { name: /Evidence gaps/ })).not.toHaveAttribute('aria-current', 'location');

  // And the other way: a jump to Evidence gaps marks Evidence gaps (the later section used to win the tie).
  await page.mouse.wheel(0, -400);
  await jump.getByRole('link', { name: /Evidence gaps/ }).click();
  await expect.poll(tops).toEqual([offset, offset]);
  await expect(jump.getByRole('link', { name: /Evidence gaps/ })).toHaveAttribute('aria-current', 'location');
  await expect(jump.getByRole('link', { name: /Follow-up questions/ })).not.toHaveAttribute('aria-current', 'location');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`brief (${scheme}): warning, unit-not-stated and "No valid citation" badges pass axe`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // The seeded brief as served, with its validation changed in the response only (no test hook in the app):
    // an unverified key-finding figure, a unit-not-stated one, and a finding left without a valid citation.
    await page.route(new RegExp(`/api/analyses/${SEEDED.analysisId}$`), async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const v = body.validation;
      v.numeric.figures.push(
        { location: 'keyFindings[0].finding', figure: '$9.9 billion', verified: false, rule: null, chunkId: null },
        { location: 'keyFindings[1].finding', figure: '12.3%', verified: false, rule: 'unit_unstated', chunkId: null },
      );
      v.numeric.total += 2;
      v.numeric.unitUnstated = (v.numeric.unitUnstated ?? 0) + 1;
      v.uncited = [...v.uncited, 'keyFindings[2]'];
      await route.fulfill({ response, json: body });
    });
    await page.goto(`/analysis/?id=${SEEDED.analysisId}`);
    await settle(page);
    const items = page.getByRole('region', { name: 'Bottom line' }).getByRole('listitem');
    await expect(items.nth(0)).toContainText('1 unverified figure');
    await expect(items.nth(1)).toContainText('1 figure: unit not stated');
    await expect(items.nth(2)).toContainText('No valid citation');
    await expect(page.getByText('Unverified figure: $9.9 billion')).toBeVisible();
    await expect(page.getByText('Unit not stated: 12.3%')).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

for (const path of ['/compare/?tickers=AAPL,TSLA,JPM', `/analysis/?id=${SEEDED.analysisId}`]) {
  test(`on a phone, ${path.split('?')[0]} has no sideways page scroll (a table's sr-only header stays inside its scroll box)`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await settle(page);
    await expect(page.getByRole('table').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

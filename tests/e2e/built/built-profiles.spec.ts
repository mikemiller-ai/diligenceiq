import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, isViewSafe, recordRequests, settle } from '../local/helpers';

/*
 * The readable dashboard on REAL built profiles (DD-21): the "built-profiles" project serves the
 * committed built test set (AAPL, TSLA, JPM from llm-v3; tests/fixtures/built-profile-sets) through
 * the same local server as the main suite. Unlike the preview profiles, these have a bottom line,
 * lead lines, change chips, sparklines and signals, so their colours and controls are checked here.
 */

for (const ticker of ['AAPL', 'TSLA', 'JPM']) {
  test(`axe: built ${ticker} dashboard, folded and fully expanded, with no model call`, async ({ page }) => {
    const requests = recordRequests(page);
    await page.goto(`/intelligence/?ticker=${ticker}`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Bottom line' })).toBeVisible();
    await expectNoAxeViolations(page);
    // Everything folded, opened: every Show all, More and the persistent disclosures.
    const showAll = page.getByRole('button', { name: /^Show all \d+/ });
    while ((await showAll.count()) > 0) await showAll.first().click();
    const more = page.getByRole('button', { name: /^More:/ });
    while ((await more.count()) > 0) await more.first().click();
    // Open every closed disclosure (the persistent group, and each signal's "How this was measured"), always the
    // first one left: an outer group precedes the disclosures inside it, so the first is always visible.
    const closed = page.locator('details:not([open]) > summary');
    while ((await closed.count()) > 0) await closed.first().click();
    await expectNoAxeViolations(page);
    expect(requests.every(isViewSafe)).toBe(true);
  });
}

test('the jump bar moves to Attention signals, lands it below both sticky bars and marks it (active link contrast checked)', async ({ page }) => {
  await page.goto('/intelligence/?ticker=AAPL');
  await settle(page);
  const jump = page.getByRole('navigation', { name: 'On this page' });
  await jump.getByRole('link', { name: /Attention signals/ }).click();
  await expect(page).toHaveURL(/#attention$/);
  const heading = page.getByRole('heading', { name: 'Attention signals', level: 2 });
  await expect(heading).toBeInViewport();
  const navBox = (await jump.boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  expect(headingBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
  const active = jump.getByRole('link', { name: /Attention signals/ });
  await expect(active).toHaveAttribute('aria-current', 'location');
  // The active link and its count badge sit on the primary fill: axe checks their contrast now.
  await expectNoAxeViolations(page);
});

test('on a phone, the jump menu jumps to a section, also when picked twice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/intelligence/?ticker=AAPL');
  await settle(page);
  const menu = page.getByRole('combobox', { name: 'Jump to section' });
  await menu.selectOption('attention');
  await expect(page).toHaveURL(/#attention$/);
  await expect(page.getByRole('heading', { name: 'Attention signals', level: 2 })).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, 0));
  await menu.selectOption('attention');
  await expect(page.getByRole('heading', { name: 'Attention signals', level: 2 })).toBeInViewport();
  await expectNoAxeViolations(page);
});

// Dark mode (OS preference) over the same built profiles: chips, inks, sparklines and the active jump link.
for (const ticker of ['AAPL', 'TSLA']) {
  test(`axe: built ${ticker} dashboard in dark mode, folded and fully expanded`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/intelligence/?ticker=${ticker}`);
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Bottom line' })).toBeVisible();
    await expectNoAxeViolations(page);
    const showAll = page.getByRole('button', { name: /^Show all \d+/ });
    while ((await showAll.count()) > 0) await showAll.first().click();
    await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: /Attention signals/ }).click();
    await expect(page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: /Attention signals/ })).toHaveAttribute('aria-current', 'location');
    await expectNoAxeViolations(page);
  });
}

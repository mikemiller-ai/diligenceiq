import { expect, test, type Page } from '@playwright/test';
import { SEED, expectNoAxeViolations, settle } from './helpers';

/*
 * Dark mode (docs/design-tokens.md, "Dark mode"). The theme has three states: System (the
 * default, follows prefers-color-scheme, stamps nothing), Light and Dark (stamp data-theme on
 * <html>, stored in localStorage and applied before first paint by lib/theme-script.ts).
 * Axe runs in both ways of reaching dark: the OS setting, and the stored choice overriding a
 * light OS. Set DARK_SCREENSHOTS=1 to also write full-page screenshots in both modes to
 * test-results/dark-mode/ (gitignored); Playwright clears test-results/ at the start of a run.
 */

const SEEDED = SEED.analyses[0]!.analysisId;
const CITED = 'NVDA-FY2026Q3-10Q-MDA-004';
const STORAGE_KEY = 'diligenceiq:theme';

const PAGES: [name: string, path: string][] = [
  ['landing', '/'],
  ['intelligence-aapl', '/intelligence/?ticker=AAPL'],
  ['analysis-seeded', `/analysis/?id=${SEEDED}`],
  ['source-filing', '/sources/filing/?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-1A-001'],
];

/** Luminance of the computed body background, 0 (black) to 1 (white). */
async function groundLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = getComputedStyle(document.body).backgroundColor;
    document.body.append(probe);
    // Chromium may report light-dark()/color-mix results in any syntax; canvas normalises to sRGB.
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    probe.remove();
    return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
  });
}

async function storeChoice(page: Page, choice: 'light' | 'dark') {
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key!, value!), [STORAGE_KEY, choice]);
}

const shots = Boolean(process.env.DARK_SCREENSHOTS);
async function shot(page: Page, name: string) {
  if (!shots) return;
  // The source view is a whole filing (tens of thousands of pixels): capture the viewport at the passage.
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > 10_000);
  await page.screenshot({ path: `test-results/dark-mode/${name}.png`, fullPage: !tall });
}

test.describe('dark via the OS setting (System)', () => {
  test.use({ colorScheme: 'dark' });

  for (const [name, path] of PAGES) {
    test(`axe: ${name} has no WCAG 2.1 A/AA violations in dark`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await expect(page.locator('html')).not.toHaveAttribute('data-theme');
      expect(await groundLuminance(page)).toBeLessThan(0.15);
      await expectNoAxeViolations(page);
      await shot(page, `${name}-dark`);
    });
  }

  test('axe: the evidence drawer and its period comparison in dark', async ({ page }) => {
    await page.goto(`/analysis/?id=${SEEDED}`);
    await settle(page);
    await page.getByRole('button', { name: `View evidence ${CITED}` }).first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toContainText('Validated — supplied to the model');
    await expectNoAxeViolations(page);
    await shot(page, 'evidence-drawer-dark');
    await drawer.getByRole('button', { name: 'Compare periods' }).click();
    await expect(drawer.getByRole('tab', { name: /Prior quarter/ })).toHaveAttribute('aria-selected', 'true');
    await expectNoAxeViolations(page);
    await shot(page, 'evidence-compare-dark');
  });
});

test.describe('dark via the stored choice (overrides a light OS)', () => {
  test.use({ colorScheme: 'light' });

  for (const [name, path] of PAGES) {
    test(`axe: ${name} has no WCAG 2.1 A/AA violations with data-theme=dark`, async ({ page }) => {
      await storeChoice(page, 'dark');
      await page.goto(path);
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      expect(await groundLuminance(page)).toBeLessThan(0.15);
      await expectNoAxeViolations(page);
    });
  }

  test('axe: the evidence drawer with data-theme=dark', async ({ page }) => {
    await storeChoice(page, 'dark');
    await page.goto(`/analysis/?id=${SEEDED}`);
    await settle(page);
    await page.getByRole('button', { name: `View evidence ${CITED}` }).first().click();
    await expect(page.getByRole('dialog')).toContainText('Validated — supplied to the model');
    await expectNoAxeViolations(page);
  });
});

test.describe('light screenshots', () => {
  test.use({ colorScheme: 'light' });
  test.skip(!shots, 'set DARK_SCREENSHOTS=1');

  for (const [name, path] of PAGES) {
    test(`screenshot: ${name} in light`, async ({ page }) => {
      await page.goto(path);
      await settle(page);
      await shot(page, `${name}-light`);
    });
  }
});

test.describe('the toggle', () => {
  test.use({ colorScheme: 'light' });

  test('switches back and forth from the top bar, persists across a reload, and System follows the OS', async ({ page }) => {
    await page.goto('/intelligence/?ticker=AAPL');
    await settle(page);
    const group = page.getByRole('radiogroup', { name: 'Colour theme' });
    await expect(group.getByRole('radio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'true');
    expect(await groundLuminance(page)).toBeGreaterThan(0.85);

    await group.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await groundLuminance(page)).toBeLessThan(0.15);

    // The stored choice is on <html> before any app script runs: no flash of the light theme.
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => document.body !== null);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    await settle(page);
    await expect(group.getByRole('radio', { name: 'Dark theme' })).toHaveAttribute('aria-checked', 'true');

    await group.getByRole('radio', { name: 'Light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await groundLuminance(page)).toBeGreaterThan(0.85); // Light overrides a dark OS.

    await group.getByRole('radio', { name: 'System theme' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    expect(await groundLuminance(page)).toBeLessThan(0.15); // System follows the (dark) OS.
    expect(await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY)).toBeNull();
  });

  test('the landing header carries the toggle on the navy hero', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    const group = page.getByRole('banner').getByRole('radiogroup', { name: 'Colour theme' });
    await group.getByRole('radio', { name: 'Dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByTestId('landing-hero')).toHaveCSS('background-color', 'rgb(10, 11, 19)'); // navy in both modes
  });
});

import { expect, test } from '@playwright/test';
import { SEED, expectNoAxeViolations, isAnalysisPost, recordRequests, setKillSwitch, setWorker, settle } from './helpers';

/*
 * Local workflow E2E (testing-strategy §6): axe and keyboard checks on each page, Compare,
 * the error and degraded states (architecture §9.1), Findings filters and grouping, and Reset.
 * The api is the real app over in-memory stores (tests/e2e/local-server.ts); a few transport
 * failures (network down, a non-JSON 502) are simulated in the browser.
 */

test.beforeEach(async ({ request }) => {
  await setKillSwitch(request, true);
  await setWorker(request, 'complete');
});

const SEEDED = SEED.analyses[0]!.analysisId;

const A11Y_PAGES = [
  '/',
  '/architecture/',
  '/intelligence/',
  '/intelligence/?ticker=AAPL',
  '/intelligence/?ticker=TSLA',
  '/intelligence/?ticker=GE',
  '/compare/?tickers=AAPL,MSFT,NVDA',
  '/analysis/new/?q=What%20changed%3F&tickers=AAPL&origin=recommendation:AAPL:rec-1',
  '/analysis/?id=an-unknown',
  `/analysis/?id=${SEEDED}`,
  '/findings/',
  '/sources/filing/?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-1A-001',
];

for (const path of A11Y_PAGES) {
  test(`axe: ${path} has no WCAG 2.1 A/AA violations`, async ({ page }) => {
    await page.goto(path);
    await settle(page);
    await expectNoAxeViolations(page);
  });
}

test.describe('keyboard', () => {
  test('skip link, then the evidence drawer opens and closes from the keyboard and returns focus', async ({ page }) => {
    await page.goto('/intelligence/?ticker=MSFT');
    await settle(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();

    // A risk area holds every extracted heading, each with its chips; use the first.
    const chip = page.getByRole('region', { name: 'Cybersecurity' }).getByRole('button', { name: /^View evidence/ }).first();
    await chip.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Filing text cited by the company profile');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(chip).toBeFocused();
  });

  test('Deep Analysis can be filled and run from the keyboard alone', async ({ page, request }) => {
    await setKillSwitch(request, false);
    const requests = recordRequests(page);
    await page.goto('/analysis/new/');
    await settle(page);
    await page.getByRole('textbox', { name: 'Question', exact: true }).focus();
    await page.keyboard.type('Which risks does Apple describe?');
    // Tab through the remaining controls to Run analysis and press it.
    for (let i = 0; i < 12; i += 1) {
      if (await page.getByRole('button', { name: 'Run analysis' }).evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(page.getByRole('button', { name: 'Run analysis' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'New analyses are paused' }).last()).toBeVisible();
    expect(requests.filter(isAnalysisPost)).toHaveLength(1);
  });
});

test.describe('error and degraded states (architecture §9.1)', () => {
  test('network failure on Run shows a plain error and no brief', async ({ page }) => {
    await page.route('**/api/analyses', (route) => route.abort('internetdisconnected'));
    await page.goto('/analysis/new/?q=What%20changed%3F');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Network failure' })).toBeVisible();
    await expect(page).toHaveURL(/\/analysis\/new\//);
  });

  test('a non-JSON 502 from the API is reported as unavailable with its status', async ({ page }) => {
    await page.route('**/api/analyses', (route) => route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }));
    await page.goto('/analysis/new/?q=What%20changed%3F');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'The analysis service is unavailable' });
    await expect(alert).toContainText('HTTP 502');
  });

  test('the workspace hourly cap: the eleventh analysis in an hour is refused with an explanation and a request ID', async ({ page, request }) => {
    await setWorker(request, 'hang');
    await page.goto('/analysis/new/');
    await settle(page);
    // Ten runs through the api with this browser's session, then the form's run is the eleventh.
    for (let i = 0; i < 10; i++) {
      const res = await page.request.post('/api/analyses', { data: { question: `Run ${i}` } });
      expect(res.status()).toBe(202);
    }
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill('One more');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'This workspace has reached its hourly limit' });
    await expect(alert).toContainText('Try again after');
    await expect(alert).toContainText(/local-\d+/);
  });

  test('a failed analysis (generation timeout) shows a plain error, its request ID and a re-run that starts fresh', async ({ page, request }) => {
    await setWorker(request, 'fail');
    await page.goto('/analysis/new/?q=How%20has%20NVIDIA%20changed%3F');
    await page.getByRole('button', { name: 'Run analysis' }).click();
    const alert = page.getByRole('alert').filter({ hasText: 'The analysis took too long' });
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await alert.getByRole('link', { name: 'Edit and run again' }).click();
    await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('How has NVIDIA changed?');
  });

  test('analyses paused: Deep Analysis says so before you run; dashboards keep working', async ({ page, request }) => {
    await setKillSwitch(request, false);
    await page.goto('/analysis/new/');
    await expect(page.getByText('New analyses are paused')).toBeVisible();
    await page.goto('/intelligence/?ticker=AAPL');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Apple Inc');
  });

  test('PROFILE_MISSING: a company without a profile offers Deep Analysis for it, and Compare lists it as missing', async ({ page }) => {
    await page.goto('/intelligence/?ticker=TSLA');
    await expect(page.getByText('Intelligence for Tesla Inc isn’t built for this index version')).toBeVisible();
    await page.getByRole('link', { name: /Ask about Tesla/ }).click();
    await expect(page.getByRole('list', { name: 'Selected companies' })).toContainText('TSLA');

    await page.goto('/compare/?tickers=AAPL,TSLA');
    await expect(page.getByText('Not enough companies have intelligence built to compare')).toBeVisible();
    await page.goto('/compare/?tickers=AAPL,MSFT,TSLA');
    await expect(page.getByText(/Not compared \(intelligence not built yet\): Tesla Inc\./)).toBeVisible();
  });
});

test('Compare: AAPL, MSFT, NVDA launches comparative diligence without running it', async ({ page }) => {
  const requests = recordRequests(page);
  await page.goto('/compare/?tickers=AAPL,MSFT,NVDA');
  const section = page.getByRole('region', { name: 'Recommended comparative diligence' });
  await section.getByRole('link', { name: /Investigate/ }).first().click();
  await expect(page).toHaveURL(/\/analysis\/new\/\?.*origin=compare%3AAAPL%2CMSFT%2CNVDA%3A/);
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(/Compare the primary risk factors/);
  await settle(page);
  expect(requests.filter(isAnalysisPost)).toHaveLength(0);
});

test('Findings: the seeded board, save from Company Intelligence, filter, group, clear, and Reset', async ({ page }) => {
  // A new workspace starts with the demo seed: real pre-run analyses and the findings saved from them.
  await page.goto('/findings/');
  await expect(page.getByText(`${SEED.findings.length} findings`)).toBeVisible();

  await page.goto('/intelligence/?ticker=MSFT');
  for (const area of ['Cybersecurity', 'Regulatory']) {
    await page.getByRole('region', { name: area }).getByRole('button', { name: 'Save Finding' }).first().click();
    const dialog = page.getByRole('dialog');
    if (area === 'Regulatory') await dialog.getByLabel('Status').selectOption('NEEDS_FOLLOW_UP');
    await dialog.getByRole('button', { name: 'Save finding' }).click();
    await expect(page.getByRole('region', { name: area }).getByRole('link', { name: 'Saved' })).toHaveCount(1);
  }

  // A full reload: findings live on the server, not in the page.
  await page.goto('/findings/');
  await expect(page.getByText(`${SEED.findings.length + 2} findings`)).toBeVisible();
  await page.getByLabel('Origin', { exact: true }).selectOption('intelligence');
  await expect(page.getByText('2 findings · 1 filter applied')).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('NEEDS_FOLLOW_UP');
  await expect(page.getByText('1 finding · 2 filters applied')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Regulatory & Compliance · 1' })).toBeVisible();
  await page.getByLabel('Status', { exact: true }).selectOption('all');

  await page.getByLabel('Group by').selectOption('status');
  await expect(page.getByRole('heading', { name: 'Active · 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs Follow-Up · 1' })).toBeVisible();
  await page.getByLabel('Group by').selectOption('company');
  await expect(page.getByRole('heading', { name: 'Microsoft Corporation (MSFT) · 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(page.getByText(`${SEED.findings.length + 2} findings`)).toBeVisible();

  await page.getByRole('button', { name: 'Reset workspace' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reset workspace' }).click();
  await expect(page.getByText(`${SEED.findings.length} findings`)).toBeVisible();
});

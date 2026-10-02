import { expect, test } from '@playwright/test';
import { SEED, e2eStats, setKillSwitch, setWorker } from './helpers';

/*
 * Phase 5 exit criteria (implementation plan): the novice path (select Apple → understand →
 * Investigate → Deep Analysis → save) and the expert path (a typed question) run end to end with
 * no broken steps, against the real api (tests/e2e/local-server.ts; the worker is a test stub that
 * answers only with a seed brief about the same companies, else NO_RELEVANT_EVIDENCE). The paths
 * use questions the seed covers: Apple's regulatory disclosures and NVIDIA's revenue.
 */

test.beforeEach(async ({ request }) => {
  await setKillSwitch(request, true);
  await setWorker(request, 'complete');
});

test('novice path: Apple → dashboard → Investigate regulatory risk → Run → real stages → brief → Save Finding → Findings Board', async ({ page, request }) => {
  await page.goto('/intelligence/');
  await page.getByRole('link', { name: /Apple Inc/ }).first().click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Apple Inc');

  await page.getByRole('region', { name: 'Regulatory' }).getByRole('link', { name: /Investigate/ }).first().click();
  await expect(page.getByText('Prefilled from')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue(/Apple Inc.*regulatory risk/);
  const before = (await e2eStats(request)).enqueued;
  await page.getByRole('button', { name: 'Run analysis' }).click();

  await expect(page).toHaveURL(/\/analysis\/\?id=/);
  // A real stage written by the worker, then the brief.
  await expect(page.locator('li[aria-current="step"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Key findings' })).toBeVisible({ timeout: 10_000 });
  expect((await e2eStats(request)).enqueued).toBe(before + 1);
  await expect(page.getByRole('heading', { name: 'How the question was read' })).toBeVisible();
  // The brief is about the company asked about (the stub never returns another company's brief).
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Apple');
  await expect(page.getByRole('table', { name: 'Evidence coverage by company and period' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Validation' })).toBeVisible();

  const title = await page.locator('#key-findings + ol li h3').first().innerText();
  await page.getByRole('button', { name: 'Save Finding' }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save finding' }).click();
  await expect(page.getByRole('link', { name: 'Saved' }).first()).toBeVisible();

  await page.getByRole('navigation').getByRole('link', { name: 'Findings' }).click();
  await expect(page.getByText(title).first()).toBeVisible();
});

test('expert path: a typed question with filters runs to a brief, and its follow-up prefills without running', async ({ page, request }) => {
  await page.goto('/analysis/new/');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('How has NVIDIA revenue changed over the last two years?');
  await page.getByRole('checkbox', { name: /10-Q/ }).click();
  await page.getByRole('button', { name: 'Run analysis' }).click();
  await expect(page.getByRole('heading', { name: 'Key findings' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText('NVIDIA');
  const before = (await e2eStats(request)).enqueued;
  const followUps = page.getByRole('region', { name: 'Suggested follow-up questions' }).or(page.locator('section[aria-labelledby="follow-ups"]'));
  await followUps.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/analysis\/new\/\?.*origin=brief%3A/);
  await expect(page.getByText('Prefilled from')).toBeVisible();
  expect((await e2eStats(request)).enqueued).toBe(before);
});

test('the seeded workspace opens with real pre-run briefs, labeled as run in advance', async ({ page }) => {
  const seeded = SEED.analyses[0]!;
  await page.goto(`/analysis/?id=${seeded.analysisId}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.brief.title);
  await expect(page.getByText(/Example from the demo workspace: real pipeline output, run in advance/)).toBeVisible();
  await expect(page.getByText(/completed in/)).toHaveCount(0);
});

test('M4: the seeded briefs are reachable from Recent analyses on Deep Analysis', async ({ page }) => {
  const seeded = SEED.analyses[0]!;
  await page.goto('/analysis/new/');
  const recent = page.locator('section[aria-labelledby="recent-analyses"]');
  await expect(recent.getByRole('heading', { name: 'Recent analyses' })).toBeVisible();
  await recent.getByRole('link', { name: seeded.question }).click();
  await expect(page).toHaveURL(new RegExp(`/analysis/\\?id=${seeded.analysisId}`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(seeded.brief.title);
});

test('a question about companies the filings do not cover fails honestly and lists the covered companies', async ({ page }) => {
  await page.goto('/analysis/new/');
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('What does Acme Widgets say about tariffs?');
  await page.getByRole('button', { name: 'Run analysis' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'The filings don’t cover this' });
  await expect(alert).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/No model request was made/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Covered companies' })).toContainText('Apple Inc');
  await expect(page.getByRole('heading', { name: 'Key findings' })).toHaveCount(0);
});

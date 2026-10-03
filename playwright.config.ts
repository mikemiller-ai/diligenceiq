import { defineConfig, devices } from '@playwright/test';

// Local E2E against the static export (testing-strategy §6). Run `pnpm build` first.
// `pnpm e2e` serves apps/web/out the way Amplify does (trailing-slash index.html) and answers
// /api/* with the real api app in-process over in-memory stores (tests/e2e/local-server.ts).
const PORT = 4174;
// A second server for the "built-profiles" project: the same app over the committed built test
// set (AAPL, TSLA, JPM from llm-v3; `pnpm fixtures:test-profiles`) instead of the preview set.
const BUILT_PORT = 4194;

export default defineConfig({
  // One worker: the in-memory workspace and the test controls are shared by the whole run.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', testDir: 'tests/e2e/local', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORT}` } },
    { name: 'built-profiles', testDir: 'tests/e2e/built', use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${BUILT_PORT}` } },
  ],
  webServer: [
    {
      command: `pnpm exec tsx tests/e2e/local-server.ts`,
      env: { E2E_PORT: String(PORT) },
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
      timeout: 20_000,
      stderr: 'ignore',
    },
    {
      command: `pnpm exec tsx tests/e2e/local-server.ts`,
      env: { E2E_PORT: String(BUILT_PORT), E2E_PROFILE_SET: 'iv-9cf51c066743/llm-v3', E2E_PROFILE_ROOT: 'tests/fixtures/built-profile-sets' },
      url: `http://127.0.0.1:${BUILT_PORT}/`,
      reuseExistingServer: false,
      timeout: 20_000,
      stderr: 'ignore',
    },
  ],
});

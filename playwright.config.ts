import { defineConfig, devices } from '@playwright/test';

// Local E2E against the static export (testing-strategy §6). Run `pnpm build` first.
// `pnpm e2e` serves apps/web/out the way Amplify does (trailing-slash index.html) and answers
// /api/* with the real api app in-process over in-memory stores (tests/e2e/local-server.ts).
const PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e/local',
  // One worker: the in-memory workspace and the test controls are shared by the whole run.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec tsx tests/e2e/local-server.ts`,
    env: { E2E_PORT: String(PORT) },
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 20_000,
    stderr: 'ignore',
  },
});

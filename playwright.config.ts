import { defineConfig, devices } from '@playwright/test';

// Local E2E against the static export (testing-strategy §6). Run `pnpm build` first;
// `pnpm e2e` serves apps/web/out the way Amplify does (trailing-slash index.html).
const PORT = 4174;

export default defineConfig({
  testDir: 'tests/e2e/local',
  // One worker: python's http.server stalls under parallel page loads and prefetches.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory apps/web/out`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 20_000,
    stderr: 'ignore',
  },
});

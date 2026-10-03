import { defineConfig, devices } from '@playwright/test';
import { PROD_URL, STATE_FILE } from './session-state';

/*
 * Production smoke suite (Phase 8; SPEC §49 Phase 8 production validation): `pnpm e2e:prod`.
 * Read-only against the deployed site (PROD_URL, default https://diligenceiq.mikemiller.ai). It is a
 * separate config so it never runs in `pnpm e2e` or the gate, and it starts no local server.
 *
 * Writes: one anonymous workspace per run at most (global-setup.ts opens it once and every test
 * reuses its cookie; a later run reuses it while it is valid, so it usually creates none). Every
 * other mutating request is aborted and fails the test (fixtures.ts); POST /api/analyses never leaves.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  // One worker: requests stay well under the api throttle (10 rps, burst 20).
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'prod', use: { ...devices['Desktop Chrome'], baseURL: PROD_URL, storageState: STATE_FILE } }],
});

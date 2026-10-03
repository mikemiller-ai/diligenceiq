import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The deployed site under test. */
export const PROD_URL = (process.env.PROD_URL ?? 'https://diligenceiq.mikemiller.ai').replace(/\/$/, '');

/**
 * The anonymous session every test reuses (Playwright storage state: the `__Host-diq_ws` cookie).
 * Outside the repo and outside test-results/ (which Playwright empties), so a later run reuses a
 * still-valid workspace instead of creating another one against the per-client daily cap.
 */
export const STATE_FILE = join(tmpdir(), 'diligenceiq-e2e-prod', `${new URL(PROD_URL).host}.json`);

export const SESSION_COOKIE = '__Host-diq_ws';

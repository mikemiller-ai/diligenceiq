import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { PROD_URL, STATE_FILE } from './session-state';

/**
 * Opens the run's one anonymous session (POST /api/session) and saves its cookie for every test.
 * A saved cookie whose workspace is still live is confirmed, not replaced (`created: false`), so
 * repeated runs create no workspace until it expires; otherwise this creates exactly one.
 */
export default async function globalSetup() {
  // The state file holds a live session cookie: owner-only directory and file.
  mkdirSync(dirname(STATE_FILE), { recursive: true, mode: 0o700 });
  chmodSync(dirname(STATE_FILE), 0o700);
  const ctx = await request.newContext({ baseURL: PROD_URL, ...(existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}) });
  try {
    const res = await ctx.post('/api/session');
    if (res.status() !== 200) throw new Error(`POST /api/session answered ${res.status()}: ${await res.text()}`);
    const body = (await res.json()) as { workspaceId: string; created: boolean };
    console.log(`e2e:prod ${PROD_URL}: ${body.created ? 'created 1 workspace' : 'reused the saved workspace (0 created)'}`);
    const state = await ctx.storageState();
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
    chmodSync(STATE_FILE, 0o600);
  } finally {
    await ctx.dispose();
  }
}

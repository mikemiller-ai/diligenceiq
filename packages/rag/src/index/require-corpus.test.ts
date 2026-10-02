import { afterEach, describe, expect, it, vi } from 'vitest';

// M2 regression: under REQUIRE_CORPUS=1 (`pnpm gate`), the corpus-backed exit-criteria tests
// fail loudly when the corpus is missing instead of skipping.
describe('REQUIRE_CORPUS', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('makes the corpus test helper throw at import when the corpus is absent', async () => {
    vi.stubEnv('CORPUS_PATH', '/nonexistent/diligenceiq-corpus');
    vi.stubEnv('REQUIRE_CORPUS', '1');
    vi.resetModules();
    await expect(import('../../../corpus/src/testing/corpus')).rejects.toThrow(/REQUIRE_CORPUS=1/);
  });

  it('only skips (HAVE_CORPUS false) without REQUIRE_CORPUS', async () => {
    vi.stubEnv('CORPUS_PATH', '/nonexistent/diligenceiq-corpus');
    vi.stubEnv('REQUIRE_CORPUS', '');
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = await import('../../../corpus/src/testing/corpus');
    expect(m.HAVE_CORPUS).toBe(false);
    warn.mockRestore();
  });
});

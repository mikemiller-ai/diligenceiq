/**
 * TEST-ONLY built profiles for the readability tests (DD-21): AAPL (deep, growing, with revenue
 * lines), TSLA (declining), JPM (a bank: few facts, no revenue lines), and MSFT, NVDA and PFE (the
 * refined Compare, DD-21 h: AAPL, MSFT, NVDA side by side; PFE's operating cash flow trend is about an
 * older year than its latest annual report), copied byte for byte from
 * the locally built model-written set, with that set's manifest cut down to those companies.
 * They are real pipeline output, never edited, and never imported by application code. `.index/`
 * is gitignored, so the copies are committed.
 *
 * The output is a profile set in the runtime layout (architecture §4.4) under its OWN root,
 * `tests/fixtures/built-profile-sets/<iv>/<set>/`, so the e2e server can serve it
 * (`E2E_PROFILE_ROOT`, the "built-profiles" Playwright project) and it can never be mistaken for
 * the fixture root that `pnpm profiles:upload-set` defaults to. The web unit tests read the same
 * files (apps/web/src/test/built-profiles.ts).
 *
 *   pnpm fixtures:test-profiles            (no AWS, no model)
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanyIntelligenceProfileSchema, ProfileSetManifestSchema, profileIntegrityIssues } from '@diligenceiq/core';
import { ROOT, fail } from '../lib/common';

const SET = process.env.TEST_PROFILE_SET ?? 'iv-9cf51c066743/llm-v3';
const TICKERS = ['AAPL', 'TSLA', 'JPM', 'MSFT', 'NVDA', 'PFE'] as const;
const FROM = join(ROOT, '.index/intelligence', SET);
const TO = join(ROOT, 'tests/fixtures/built-profile-sets', SET);

const manifest = JSON.parse(readFileSync(join(FROM, 'manifest.json'), 'utf8')) as Record<string, unknown> & { companies: Array<{ ticker: string }> };
const subset = {
  ...Object.fromEntries(Object.entries(manifest).filter(([k]) => k !== 'totals' && k !== 'companies')),
  note: `TEST-ONLY subset of ${SET}: ${TICKERS.join(', ')}, copied verbatim by pnpm fixtures:test-profiles. Never upload.`,
  companies: manifest.companies.filter((c) => (TICKERS as readonly string[]).includes(c.ticker)),
};
const parsed = ProfileSetManifestSchema.parse(subset);
if (`${parsed.indexVersion}/${parsed.profileSetId}` !== SET) fail(`manifest names ${parsed.indexVersion}/${parsed.profileSetId}, not ${SET}`);
if (parsed.companies.length !== TICKERS.length) fail(`manifest lists ${parsed.companies.map((c) => c.ticker).join(', ')}`);

rmSync(TO, { recursive: true, force: true });
mkdirSync(TO, { recursive: true });
for (const t of TICKERS) {
  const src = join(FROM, `${t}.json`);
  const p = CompanyIntelligenceProfileSchema.parse(JSON.parse(readFileSync(src, 'utf8')));
  if (p.ticker !== t) fail(`${src}: ticker ${p.ticker}`);
  const issues = profileIntegrityIssues(p);
  if (issues.length) fail(`${t}: ${issues.join('; ')}`);
  copyFileSync(src, join(TO, `${t}.json`));
}
writeFileSync(join(TO, 'manifest.json'), `${JSON.stringify(subset, null, 1)}\n`);
console.log(`export-test-profiles: ${TICKERS.join(', ')} from .index/intelligence/${SET} → tests/fixtures/built-profile-sets/${SET}/`);

/**
 * Writes the preview (fixture) profiles as a profile set in the runtime layout the api reads
 * (architecture §4.4): `tests/fixtures/profile-sets/<indexVersion>/fixture-v<n>/{manifest.json,<TICKER>.json}`.
 * No model call and no new content: the profiles are exactly the web's preview profiles (verbatim
 * filing text, deterministic templates, labeled placeholders). Phase 4b's builder writes the
 * `det-v*` and `llm-v*` sets in the same layout; switching is the SSM pointer.
 *
 * Run: `pnpm profiles:export-fixture`. Upload (S3 write, ask first): `pnpm profiles:upload-set`.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanyIntelligenceProfileSchema, type ProfileSetManifest, ProfileSetManifestSchema, profileIntegrityIssues } from '@diligenceiq/core';
import { FIXTURE_PROFILES } from '../../apps/web/src/fixtures/profiles';
import { ROOT, fail } from '../lib/common';

const profiles = [...FIXTURE_PROFILES.values()];
const first = profiles[0] ?? fail('no fixture profiles');
const { indexVersion, profileSetId, builtAt } = first.version;
for (const p of profiles) {
  CompanyIntelligenceProfileSchema.parse(p);
  const issues = profileIntegrityIssues(p);
  if (issues.length) fail(`${p.ticker}: ${issues.join('; ')}`);
  if (p.version.indexVersion !== indexVersion || p.version.profileSetId !== profileSetId) fail(`${p.ticker}: mixed set`);
}
const manifest: ProfileSetManifest = ProfileSetManifestSchema.parse({
  indexVersion,
  profileSetId,
  builtAt,
  companies: profiles.map((p) => ({
    ticker: p.ticker,
    company: p.company,
    sector: p.sector,
    tier: p.coverage.tier,
    filings: p.coverage.filings,
    periodsCovered: p.version.periodsCovered,
    mode: 'fixture',
    generationCallCount: 0,
  })),
});
const dir = join(ROOT, 'tests/fixtures/profile-sets', indexVersion, profileSetId);
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
for (const p of profiles) writeFileSync(join(dir, `${p.ticker}.json`), `${JSON.stringify(p)}\n`);
console.log(`export-fixture-set: ${profiles.length} profiles → tests/fixtures/profile-sets/${indexVersion}/${profileSetId}/`);

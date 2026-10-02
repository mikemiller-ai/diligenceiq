/**
 * Uploads one profile set to the data bucket in the layout the api reads (architecture §4.4):
 *   s3://<bucket>/intelligence/<indexVersion>/<profileSetId>/{<TICKER>.json, manifest.json}
 * Profiles first, the manifest last, each with `If-None-Match: *`: a set is immutable once
 * uploaded (a change is a new version). An object that already exists is compared by content
 * hash: identical is skipped, different fails the upload (scripts/lib/s3-immutable.ts). It does NOT switch the active set; that is a separate,
 * explicit `aws ssm put-parameter --name /diligenceiq/active-profile-set --value <iv>/<set> --overwrite`.
 * Without `--yes` it only lists what it would upload (an AWS write needs explicit approval).
 *
 *   pnpm profiles:upload-set --bucket <name> --set iv-9cf51c066743/fixture-v2          # dry run
 *   pnpm profiles:upload-set --bucket <name> --set iv-9cf51c066743/fixture-v2 --yes    # upload
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import type { ProfileSetManifest } from '@diligenceiq/core';
import { AWS_REGION, ROOT, arg, fail } from '../lib/common';
import { uploadableManifest } from '../lib/profile-set';
import { putImmutable } from '../lib/s3-immutable';

const bucket = arg('bucket') ?? process.env.DATA_BUCKET;
if (!bucket || bucket === 'true') fail('profiles:upload-set: pass --bucket <name> or set DATA_BUCKET');
const set = arg('set');
if (!set || !/^iv-[a-z0-9]+\/(?:llm|det|fixture)-v\d+$/.test(set)) fail('profiles:upload-set: pass --set <indexVersion>/<profileSetId>');
const root = arg('root') ?? join(ROOT, 'tests/fixtures/profile-sets');
const dir = join(root, set);
let manifest: ProfileSetManifest;
try {
  manifest = uploadableManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')), set);
} catch (e) {
  fail(`profiles:upload-set: ${(e as Error).message}`);
}
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
const missing = manifest.companies.filter((c) => !files.includes(`${c.ticker}.json`));
if (missing.length) fail(`manifest lists companies without a profile file: ${missing.map((c) => c.ticker).join(', ')}`);
const plan = [...files.sort(), 'manifest.json'];
console.log(`profiles:upload-set ${set} → s3://${bucket}/intelligence/${set}/ : ${plan.length} objects (manifest last)`);
if (!arg('yes')) {
  for (const f of plan) console.log(`  ${f}`);
  console.log('Dry run. Re-run with --yes to upload.');
  process.exit(0);
}
const s3 = new S3Client({ region: AWS_REGION });
for (const f of plan) {
  const outcome = await putImmutable(s3, bucket, `intelligence/${set}/${f}`, readFileSync(join(dir, f)));
  console.log(outcome === 'uploaded' ? `  uploaded ${f}` : `  exists ${f} (identical content; skipped)`);
}
console.log('Done. The active set is unchanged; switch it with the SSM pointer.');

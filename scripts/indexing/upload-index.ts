#!/usr/bin/env -S pnpm exec tsx
/**
 * Upload a built, validated index version and its processed filings to the data bucket
 * (SPEC §24.4; architecture §6.4):
 *   s3://<bucket>/index/<indexVersion>/…        index artifacts and adjacency files
 *   s3://<bucket>/processed/<indexVersion>/…    processed filing text + section offsets
 * Without `--yes` it only lists what it would upload (an AWS write needs explicit approval).
 *
 * Objects are immutable per version (packages/rag upload.ts): the build must carry the
 * VALIDATED marker; every object stores its sha256 as metadata; an existing key with the same
 * sha256 is skipped and one with a different sha256 refuses the whole upload before anything
 * is written; writes use If-None-Match: *; manifest.json is uploaded last.
 *
 *   pnpm index:upload --bucket <name>            # dry run
 *   pnpm index:upload --bucket <name> --yes      # upload
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ARTIFACTS, type IndexManifest, type LocalFile, type ObjectStore, type UploadItem, type ValidatedMarker, executeIndexUpload, planIndexUpload } from '@diligenceiq/rag';
import { AWS_REGION, BUILD_DIR, INGEST_REPORT, PROCESSED_DIR, arg, fail, sha256 } from '../lib/common';

const bucket = arg('bucket') ?? process.env.DATA_BUCKET;
if (!bucket || bucket === 'true') fail('index:upload: pass --bucket <name> or set DATA_BUCKET');
const { indexVersion } = JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as { indexVersion: string };
const buildDir = join(BUILD_DIR, indexVersion);
if (!existsSync(buildDir)) fail(`index:upload: no build at ${buildDir}; run \`pnpm index:build\``);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const describe = (root: string): LocalFile[] =>
  walk(root).map((p) => {
    const buf = readFileSync(p);
    return { rel: relative(root, p).split(sep).join('/'), bytes: buf.byteLength, sha256: sha256(buf) };
  });

const manifestBuf = readFileSync(join(buildDir, ARTIFACTS.manifest));
const markerPath = join(buildDir, ARTIFACTS.validatedMarker);
let plan: UploadItem[];
try {
  plan = planIndexUpload({
    indexVersion,
    manifest: JSON.parse(manifestBuf.toString('utf8')) as IndexManifest,
    manifestSha256: sha256(manifestBuf),
    marker: existsSync(markerPath) ? (JSON.parse(readFileSync(markerPath, 'utf8')) as ValidatedMarker) : null,
    buildFiles: describe(buildDir),
    processedFiles: describe(PROCESSED_DIR),
  });
} catch (e) {
  fail((e as Error).message);
}
const total = plan.reduce((a, u) => a + u.bytes, 0);
console.log(`index:upload ${indexVersion} → s3://${bucket}/ : ${plan.length} objects, ${(total / 1e6).toFixed(1)} MB (manifest last)`);
if (!arg('yes')) {
  for (const u of plan.slice(0, 12)) console.log(`  ${u.key}`);
  if (plan.length > 12) console.log(`  … and ${plan.length - 12} more`);
  console.log('Dry run. Re-run with --yes to upload.');
  process.exit(0);
}

const s3 = new S3Client({ region: AWS_REGION });
const store: ObjectStore = {
  head: async (key) => {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sha256: head.Metadata?.sha256 };
    } catch (e) {
      const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  },
  putIfAbsent: async (u) => {
    const body = readFileSync(join(u.source === 'build' ? buildDir : PROCESSED_DIR, u.rel));
    if (sha256(body) !== u.sha256) throw new Error(`index:upload: ${u.rel} changed on disk during the upload`);
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: u.key, Body: body, ContentType: u.contentType, Metadata: { sha256: u.sha256 }, IfNoneMatch: '*' }),
    );
  },
};
try {
  const { sent, skipped } = await executeIndexUpload(plan, store);
  console.log(`index:upload: ${sent.length} uploaded, ${skipped.length} already present with the same sha256`);
} catch (e) {
  fail((e as Error).message);
}

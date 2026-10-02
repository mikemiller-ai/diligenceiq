#!/usr/bin/env -S pnpm exec tsx
/**
 * Cold index load measurement (Phase 2 exit criterion; assumptions D5). Loads the runtime
 * index (vectors, chunks, BM25) the way the worker will, in a fresh process, and prints the
 * per-step timings and the heap it needs. Read-only.
 *
 *   pnpm index:measure-load                     # from .index/build/<version>/
 *   pnpm index:measure-load --bucket <name>     # from s3://<name>/index/<version>/
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { loadIndex } from '@diligenceiq/rag';
import { AWS_REGION, BUILD_DIR, INGEST_REPORT, arg } from '../lib/common';

const { indexVersion } = JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as { indexVersion: string };
const bucket = arg('bucket');
const before = process.memoryUsage().rss;
let read: (name: string) => Promise<Buffer>;
if (bucket && bucket !== 'true') {
  const s3 = new S3Client({ region: AWS_REGION });
  read = async (name) => {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `index/${indexVersion}/${name}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  };
} else {
  read = async (name) => readFileSync(join(BUILD_DIR, indexVersion, name));
}
const index = await loadIndex(read);
const rssMb = Math.round((process.memoryUsage().rss - before) / 1e6);
console.log(`cold load ${indexVersion} from ${bucket ? `s3://${bucket}` : 'local disk'}: ${index.chunks.length} chunks × ${index.dims} dims`);
console.log(`  timings (ms): ${JSON.stringify(index.timingsMs)}`);
console.log(`  resident memory added: ~${rssMb} MB; heap used: ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB`);

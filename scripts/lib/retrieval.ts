/**
 * Opens the built index for the offline retrieval tools (eval harness, local retrieval debug
 * server): from `.index/build/<version>/` by default, or read-only from S3 with a bucket.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { type LoadedIndex, Retriever, loadIndex } from '@diligenceiq/rag';
import { AWS_REGION, BUILD_DIR, INGEST_REPORT } from './common';

export async function openIndex(options: { bucket?: string; indexVersion?: string } = {}): Promise<{ index: LoadedIndex; retriever: Retriever; source: string }> {
  const indexVersion = options.indexVersion ?? (JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as { indexVersion: string }).indexVersion;
  let read: (name: string) => Promise<Buffer>;
  let source: string;
  if (options.bucket) {
    const s3 = new S3Client({ region: AWS_REGION });
    const bucket = options.bucket;
    read = async (name) => {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `index/${indexVersion}/${name}` }));
      return Buffer.from(await res.Body!.transformToByteArray());
    };
    source = `s3://${bucket}/index/${indexVersion}/`;
  } else {
    read = async (name) => readFileSync(join(BUILD_DIR, indexVersion, name));
    source = join(BUILD_DIR, indexVersion);
  }
  const index = await loadIndex(read);
  const retriever = new Retriever({ chunks: index.chunks, bm25: index.bm25, vectors: index.vectors, dims: index.dims }, index.manifest.indexVersion);
  return { index, retriever, source };
}

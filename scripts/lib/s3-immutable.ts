import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';

/**
 * Writes an object that must never change once written (a profile set, architecture §4.4):
 * `If-None-Match: *`. When the key already exists, the stored bytes are compared with the local
 * ones; identical is a no-op ("exists"), different fails loudly. A set is immutable, so a
 * changed file means a new version, never a silent skip that leaves S3 and the repo disagreeing.
 */
export async function putImmutable(s3: Pick<S3Client, 'send'>, bucket: string, key: string, body: Buffer): Promise<'uploaded' | 'exists'> {
  try {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'application/json', IfNoneMatch: '*' }));
    return 'uploaded';
  } catch (err) {
    if ((err as { name?: string }).name !== 'PreconditionFailed') throw err;
  }
  const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const stored = Buffer.from((await out.Body?.transformToByteArray()) ?? new Uint8Array());
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  if (sha(stored) !== sha(body)) {
    throw new Error(`s3://${bucket}/${key} already exists with different content (sha256 ${sha(stored).slice(0, 12)} ≠ local ${sha(body).slice(0, 12)}). A profile set is immutable: build a new version instead.`);
  }
  return 'exists';
}

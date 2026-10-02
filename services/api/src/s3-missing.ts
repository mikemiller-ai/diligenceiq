import { log } from './http';

/**
 * Whether a failed `GetObject` means "no such object". The api role has `s3:GetObject` on its
 * prefixes but deliberately no `s3:ListBucket` (architecture §11), and without ListBucket S3
 * answers a missing key with 403 AccessDenied rather than 404 NoSuchKey, so that the response
 * cannot be used to probe which keys exist. A 403 is therefore read as missing, with a warning
 * naming the key, so a real permission misconfiguration (a prefix left out of the policy) still
 * shows in the logs instead of hiding as "not found".
 */
export function isMissingObject(err: unknown, key: string): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } } | null | undefined;
  const status = e?.$metadata?.httpStatusCode;
  if (e?.name === 'NoSuchKey' || e?.name === 'NotFound' || status === 404) return true;
  if (e?.name === 'AccessDenied' || status === 403) {
    log('warn', 's3 GetObject denied; read as a missing object (the api role has no s3:ListBucket)', { key });
    return true;
  }
  return false;
}

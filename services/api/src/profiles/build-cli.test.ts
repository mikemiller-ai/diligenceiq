import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseLedgerBucket, dataBucketFromOutputs } from '../../../../scripts/lib/data-bucket';

/*
 * The offline profile build CLI (scripts/intelligence/build-profiles.ts; SPEC §32.4, DD-16).
 * The flag checks run before the index loads or AWS is touched, so these spawn the real CLI.
 */
const ROOT = join(__dirname, '../../../..');
const run = (...args: string[]) => spawnSync('pnpm', ['exec', 'tsx', 'scripts/intelligence/build-profiles.ts', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 });

describe('intelligence:build CLI', () => {
  it('refuses to run without --max-calls', () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/--max-calls <n> is required/);
  });

  it('refuses --force (there is none)', () => {
    const r = run('--max-calls', '0', '--force');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/there is no --force/);
  });
});

/* M4: the ledger bucket is pinned to CoreStack's DataBucket output. */
describe('ledger bucket pin', () => {
  const outputs = [
    { OutputKey: 'PublishOutputFnGetAttDataBucketE3889A50Arn0E8BC76C', OutputValue: 'arn:aws:s3:::the-bucket' },
    { OutputKey: 'PublishOutputRefDataBucketE3889A50C1B34A6F', OutputValue: 'the-bucket' },
  ];

  it('reads the bucket name (not the ARN) from the stack outputs', () => {
    expect(dataBucketFromOutputs(outputs)).toBe('the-bucket');
    expect(dataBucketFromOutputs([{ OutputKey: 'DataBucket', OutputValue: 'b2' }])).toBe('b2');
    expect(dataBucketFromOutputs([])).toBeNull();
  });

  it('uses the stack bucket, refuses a different --bucket unless --allow-other-bucket', () => {
    expect(chooseLedgerBucket(undefined, 'the-bucket', false)).toEqual({ bucket: 'the-bucket' });
    expect(chooseLedgerBucket('the-bucket', 'the-bucket', false)).toEqual({ bucket: 'the-bucket' });
    expect(chooseLedgerBucket('typo-bucket', 'the-bucket', false)).toMatchObject({ error: expect.stringMatching(/is not DiligenceIQ-Core's DataBucket/) });
    expect(chooseLedgerBucket('other', 'the-bucket', true)).toEqual({ bucket: 'other' });
    expect(chooseLedgerBucket(undefined, null, false)).toMatchObject({ error: expect.any(String) });
    expect(chooseLedgerBucket('other', null, true)).toEqual({ bucket: 'other' });
    expect(chooseLedgerBucket('true', 'the-bucket', false)).toMatchObject({ error: expect.any(String) });
  });
});

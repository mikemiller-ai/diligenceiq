import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type { LedgerEntry, LedgerOutcome, ProfileLedger } from '@diligenceiq/rag/profile';

/**
 * The production build ledger (SPEC §32.4, DD-16): S3 objects
 *   intelligence/ledger/<indexVersion>/<profilePromptVersion>/<TICKER>.json          (entry, before the call)
 *   intelligence/ledger/<indexVersion>/<profilePromptVersion>/<TICKER>.outcome.json  (outcome, after it)
 * both created with `If-None-Match: *`. An existing entry means the call was spent: no call.
 * Append-only by convention: nothing here overwrites or deletes. The bucket is unversioned and
 * has no Object Lock, so storage does not enforce it; the CLI pins the bucket to CoreStack's.
 */
export class S3Ledger implements ProfileLedger {
  constructor(
    private readonly s3: Pick<S3Client, 'send'>,
    private readonly bucket: string,
    readonly indexVersion: string,
    readonly profilePromptVersion: string,
  ) {}

  private get prefix(): string {
    return `intelligence/ledger/${this.indexVersion}/${this.profilePromptVersion}/`;
  }

  private async putOnce(key: string, body: unknown): Promise<boolean> {
    try {
      await this.s3.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: `${JSON.stringify(body)}\n`, ContentType: 'application/json', IfNoneMatch: '*' }),
      );
      return true;
    } catch (err) {
      // 412: the object exists. 409 ConditionalRequestConflict: a concurrent conditional write to
      // the same key is in flight; either way another writer has (or is taking) the key.
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'PreconditionFailed' || e.name === 'ConditionalRequestConflict' || e.$metadata?.httpStatusCode === 412) return false;
      throw err;
    }
  }

  private async get<T>(key: string): Promise<T | null> {
    try {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(Buffer.from((await out.Body?.transformToByteArray()) ?? new Uint8Array()).toString('utf8')) as T;
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async claim(entry: LedgerEntry): Promise<'claimed' | 'exists'> {
    return (await this.putOnce(`${this.prefix}${entry.ticker}.json`, entry)) ? 'claimed' : 'exists';
  }

  async spent(): Promise<Set<string>> {
    const out = new Set<string>();
    let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: this.prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) {
        const m = /\/([A-Z]{1,5})\.json$/.exec(o.Key ?? '');
        if (m) out.add(m[1]!);
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  entry(ticker: string): Promise<LedgerEntry | null> {
    return this.get<LedgerEntry>(`${this.prefix}${ticker}.json`);
  }

  async recordOutcome(outcome: LedgerOutcome): Promise<void> {
    if (!(await this.putOnce(`${this.prefix}${outcome.ticker}.outcome.json`, outcome))) {
      throw new Error(`ledger: outcome for ${outcome.ticker} already recorded at ${this.indexVersion}/${this.profilePromptVersion}`);
    }
  }

  outcome(ticker: string): Promise<LedgerOutcome | null> {
    return this.get<LedgerOutcome>(`${this.prefix}${ticker}.outcome.json`);
  }
}

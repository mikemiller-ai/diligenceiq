import { describe, expect, it, vi } from 'vitest';
import { uploadableManifest } from '../../../../scripts/lib/profile-set';
import { putImmutable } from '../../../../scripts/lib/s3-immutable';

/* The admin upload of a profile set (scripts/intelligence/upload-set.ts): sets are immutable in S3. */
describe('putImmutable (profile set upload)', () => {
  const body = Buffer.from('{"a":1}');
  const exists = Object.assign(new Error('exists'), { name: 'PreconditionFailed' });
  const stored = (b: Buffer) => ({ Body: { transformToByteArray: async () => new Uint8Array(b) } });

  it('uploads with If-None-Match: *', async () => {
    const send = vi.fn(async () => ({}));
    expect(await putImmutable({ send } as never, 'b', 'intelligence/k.json', body)).toBe('uploaded');
    expect((send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input).toMatchObject({ Bucket: 'b', Key: 'intelligence/k.json', IfNoneMatch: '*' });
  });

  it('an existing object with identical content is a no-op', async () => {
    const send = vi.fn().mockRejectedValueOnce(exists).mockResolvedValueOnce(stored(body));
    expect(await putImmutable({ send } as never, 'b', 'k', body)).toBe('exists');
  });

  it('an existing object with different content fails loudly', async () => {
    const send = vi.fn().mockRejectedValueOnce(exists).mockResolvedValueOnce(stored(Buffer.from('{"a":2}')));
    await expect(putImmutable({ send } as never, 'b', 'k', body)).rejects.toThrow(/already exists with different content/);
  });

  it('other errors propagate', async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    await expect(putImmutable({ send } as never, 'b', 'k', body)).rejects.toThrow('denied');
  });
});

/* Regression (Phase 4b adversary H2): the partial guard read the PARSED manifest, whose schema strips `partial`. */
describe('uploadableManifest (profile set upload checks)', () => {
  const manifest = { indexVersion: 'iv-abc', profileSetId: 'llm-v3', builtAt: 't', companies: [] };

  it('refuses a partial (--tickers) set, read from the raw JSON', () => {
    expect(() => uploadableManifest({ ...manifest, partial: true }, 'iv-abc/llm-v3')).toThrow(/partial set/);
  });

  it('accepts a full set and refuses a set that does not match --set', () => {
    expect(uploadableManifest(manifest, 'iv-abc/llm-v3').profileSetId).toBe('llm-v3');
    expect(() => uploadableManifest(manifest, 'iv-abc/det-v2')).toThrow(/does not match/);
  });
});

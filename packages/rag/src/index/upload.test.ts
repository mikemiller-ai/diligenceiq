import { describe, expect, it } from 'vitest';
import { ARTIFACTS, type IndexManifest } from './format';
import { type LocalFile, type ObjectStore, type UploadItem, executeIndexUpload, planIndexUpload } from './upload';

const file = (rel: string, sha256: string, bytes = 10): LocalFile => ({ rel, sha256, bytes });
const artifacts = [file('chunks.jsonl', 'c'), file('vectors.bin', 'v', 4096), file('bm25.json', 'b'), file('adjacency/TST.json', 'a')];
const manifest = {
  indexVersion: 'iv-1',
  artifacts: Object.fromEntries(artifacts.map((f) => [f.rel, { bytes: f.bytes, sha256: f.sha256 }])),
} as unknown as IndexManifest;
const input = (over: Partial<Parameters<typeof planIndexUpload>[0]> = {}) => ({
  indexVersion: 'iv-1',
  manifest,
  manifestSha256: 'm',
  marker: { indexVersion: 'iv-1', validatedAt: '2026-10-01T00:00:00Z', manifestSha256: 'm' },
  buildFiles: [...artifacts, file(ARTIFACTS.manifest, 'm'), file(ARTIFACTS.validatedMarker, 'x')],
  processedFiles: [file('AAPL_10K_2025.json', 'p')],
  ...over,
});

class FakeStore implements ObjectStore {
  readonly puts: string[] = [];
  constructor(readonly objects = new Map<string, string | undefined>()) {}
  async head(key: string) {
    return this.objects.has(key) ? { sha256: this.objects.get(key) } : null;
  }
  async putIfAbsent(u: UploadItem) {
    if (this.objects.has(u.key)) throw Object.assign(new Error('PreconditionFailed'), { name: 'PreconditionFailed' });
    this.puts.push(u.key);
    this.objects.set(u.key, u.sha256);
  }
}

describe('immutable index upload (H4)', () => {
  it('refuses a build without the VALIDATED marker, or whose manifest changed after validation', () => {
    expect(() => planIndexUpload(input({ marker: null }))).toThrow(/no VALIDATED marker/);
    expect(() => planIndexUpload(input({ manifestSha256: 'edited' }))).toThrow(/changed after validation/);
    expect(() => planIndexUpload(input({ marker: { indexVersion: 'iv-0', validatedAt: '', manifestSha256: 'm' } }))).toThrow(/is for iv-0/);
  });

  it('refuses local artifacts that differ from the manifest, are unlisted, or are missing', () => {
    const swap = (f: LocalFile) => (f.rel === 'vectors.bin' ? { ...f, sha256: 'other' } : f);
    expect(() => planIndexUpload(input({ buildFiles: input().buildFiles.map(swap) }))).toThrow(/vectors\.bin differs/);
    expect(() => planIndexUpload(input({ buildFiles: [...input().buildFiles, file('stray.bin', 's')] }))).toThrow(/stray\.bin is not listed/);
    expect(() => planIndexUpload(input({ buildFiles: input().buildFiles.filter((f) => f.rel !== 'bm25.json') }))).toThrow(/bm25\.json is in the manifest but missing/);
  });

  it('plans every artifact and processed file, never the marker, with manifest.json last', () => {
    const plan = planIndexUpload(input());
    expect(plan.at(-1)!.key).toBe('index/iv-1/manifest.json');
    expect(plan.map((u) => u.key)).not.toContain('index/iv-1/VALIDATED');
    expect(plan.map((u) => u.key)).toContain('processed/iv-1/AAPL_10K_2025.json');
    expect(plan).toHaveLength(artifacts.length + 2);
  });

  it('uploads with manifest.json as the last PUT', async () => {
    const store = new FakeStore();
    const res = await executeIndexUpload(planIndexUpload(input()), store);
    expect(store.puts.at(-1)).toBe('index/iv-1/manifest.json');
    expect(res.sent).toHaveLength(artifacts.length + 2);
    expect(res.skipped).toEqual([]);
  });

  it('skips existing objects with an identical sha256 (a resumed upload)', async () => {
    const store = new FakeStore(new Map([['index/iv-1/vectors.bin', 'v'], ['index/iv-1/chunks.jsonl', 'c']]));
    const res = await executeIndexUpload(planIndexUpload(input()), store);
    expect(res.skipped.sort()).toEqual(['index/iv-1/chunks.jsonl', 'index/iv-1/vectors.bin']);
    expect(store.puts).not.toContain('index/iv-1/vectors.bin');
    expect(store.puts.at(-1)).toBe('index/iv-1/manifest.json');
  });

  it('refuses, before writing anything, when an existing object has the same size but a different sha256', async () => {
    // vectors.bin is always the same size for a given chunk count, so size can never prove identity.
    const store = new FakeStore(new Map([['index/iv-1/vectors.bin', 'different-but-same-size']]));
    await expect(executeIndexUpload(planIndexUpload(input()), store)).rejects.toThrow(/refusing to overwrite 1 existing object.*vectors\.bin/s);
    expect(store.puts).toEqual([]);
  });

  it('treats an existing object without sha256 metadata as a conflict', async () => {
    const store = new FakeStore(new Map([['processed/iv-1/AAPL_10K_2025.json', undefined]]));
    await expect(executeIndexUpload(planIndexUpload(input()), store)).rejects.toThrow(/\(none\)/);
    expect(store.puts).toEqual([]);
  });

  it('rejects a plan whose last object is not the manifest', async () => {
    const plan = planIndexUpload(input());
    await expect(executeIndexUpload([plan.at(-1)!, ...plan.slice(0, -1)], new FakeStore())).rejects.toThrow(/last object/);
  });
});

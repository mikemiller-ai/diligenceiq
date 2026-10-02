import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Retriever, loadIndex } from '@diligenceiq/rag';
import { log } from '../http';
import type { IndexProvider, RuntimeIndex } from './worker';

/**
 * Loads `index/<indexVersion>/` from S3 into memory once per warm worker (DD-01, architecture
 * §6.4). Every artifact is checked against the manifest's byte length and sha256 before parsing
 * (`loadIndex`). A failed load is not cached, so the next analysis tries again.
 */
export function createS3IndexProvider(opts: { s3: Pick<S3Client, 'send'>; bucket: string; indexVersion: string }): IndexProvider {
  let pending: Promise<RuntimeIndex> | null = null;
  let ready = false;
  const read = async (name: string) => {
    const res = await opts.s3.send(new GetObjectCommand({ Bucket: opts.bucket, Key: `index/${opts.indexVersion}/${name}` }));
    return Buffer.from(await res.Body!.transformToByteArray());
  };
  return {
    loaded: () => ready,
    async get() {
      if (pending && ready) return { index: await pending, loadMs: 0, cold: false };
      const t0 = performance.now();
      pending ??= (async () => {
        const loaded = await loadIndex(read);
        if (loaded.manifest.indexVersion !== opts.indexVersion) throw new Error(`index manifest says ${loaded.manifest.indexVersion}, expected ${opts.indexVersion}`);
        log('info', 'index loaded', { indexVersion: opts.indexVersion, chunks: loaded.chunks.length, timingsMs: loaded.timingsMs });
        return {
          retriever: new Retriever({ chunks: loaded.chunks, bm25: loaded.bm25, vectors: loaded.vectors, dims: loaded.dims }, loaded.manifest.indexVersion),
          indexVersion: loaded.manifest.indexVersion,
        };
      })();
      try {
        const index = await pending;
        ready = true;
        return { index, loadMs: Math.round(performance.now() - t0), cold: true };
      } catch (err) {
        pending = null;
        throw err;
      }
    },
  };
}

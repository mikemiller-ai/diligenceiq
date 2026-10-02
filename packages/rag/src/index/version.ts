import { createHash } from 'node:crypto';
import { type Chunk, embeddingText } from '@diligenceiq/corpus';

/**
 * Index version (SPEC §24.4, §25.2; architecture §6.4). Chunk IDs and text must be immutable
 * within an `indexVersion`, so the version is derived from the chunks AS PRODUCED rather than
 * from the inputs and code versions that produce them: any change to section detection,
 * segmentation, contextual headers, fiscal labels or chunk IDs changes the version, whether or
 * not someone remembered to bump a code version.
 *
 *   chunksHash   = sha256(chunks.jsonl bytes, then every chunk's embedded text)
 *   indexVersion = "iv-" + first 12 hex of sha256(chunksHash | tokenizer | model | dims)
 *
 * The embedded text (contextual header + passage) is hashed as well because the header is
 * computed from metadata by code that is not part of chunks.jsonl, and it is what is embedded
 * and tokenized for BM25.
 */

/** The canonical chunks.jsonl serialization: one JSON object per line, trailing newline. */
export function serializeChunks(chunks: readonly Chunk[]): string {
  return `${chunks.map((c) => JSON.stringify(c)).join('\n')}\n`;
}

/** Content hash of the chunk set, in vector order. */
export function chunksHash(chunks: readonly Chunk[]): string {
  const h = createHash('sha256');
  h.update(serializeChunks(chunks));
  h.update('\u0000embedded\u0000');
  for (const c of chunks) h.update(createHash('sha256').update(embeddingText(c)).digest('hex')).update('\n');
  return h.digest('hex');
}

export interface IndexVersionInputs {
  chunksHash: string;
  tokenizerVersion: string;
  modelId: string;
  dimensions: number;
}

export function indexVersionOf(i: IndexVersionInputs): string {
  const digest = createHash('sha256').update([i.chunksHash, i.tokenizerVersion, i.modelId, i.dimensions].join('|')).digest('hex');
  return `iv-${digest.slice(0, 12)}`;
}

/**
 * Re-derives the version from chunks.jsonl as read and compares it with what ingest recorded.
 * Returns problems; empty means the file is exactly what ingest produced and the version
 * matches the current tokenizer, model and dimensions.
 */
export function verifyIndexVersion(
  chunksJsonl: string,
  chunks: readonly Chunk[],
  recorded: { indexVersion: string; chunksHash?: string },
  current: Omit<IndexVersionInputs, 'chunksHash'>,
): string[] {
  const problems: string[] = [];
  if (serializeChunks(chunks) !== chunksJsonl) problems.push('chunks.jsonl is not in the canonical serialization (edited or truncated?)');
  const hash = chunksHash(chunks);
  if (!recorded.chunksHash) problems.push('the ingest report has no chunksHash (written before content-hashed versions); re-run `pnpm ingest`');
  else if (recorded.chunksHash !== hash) problems.push(`chunks hash ${hash.slice(0, 12)} differs from the ingest report's ${recorded.chunksHash.slice(0, 12)}; re-run \`pnpm ingest\``);
  const version = indexVersionOf({ chunksHash: hash, ...current });
  if (version !== recorded.indexVersion) {
    problems.push(
      `index version ${version} (model ${current.modelId}, ${current.dimensions} dims, tokenizer ${current.tokenizerVersion}) differs from the ingest report's ${recorded.indexVersion}; re-run \`pnpm ingest\` with the same EMBEDDING_MODEL_ID`,
    );
  }
  return problems;
}

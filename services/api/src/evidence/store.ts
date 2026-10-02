import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import {
  type AdjacentEvidenceResponse,
  type AdjacentSide,
  type Citation,
  DOCUMENT_ID_PATTERN,
  FilingTypeSchema,
  type SourceDocumentResponse,
  isCatalogTicker,
  tickerOfChunkId,
  tickerOfDocumentId,
} from '@diligenceiq/core';
// Values come from the corpus package's subpaths, so the api bundle carries the chunker and not
// the corpus loader or the financial extraction (`import type` from the barrel is erased).
import type { Chunk, FilingMeta, Section } from '@diligenceiq/corpus';
import { CHUNKER_VERSION, chunkFiling } from '@diligenceiq/corpus/chunker';
import { chunkCitation, chunkSectionLabel } from '@diligenceiq/corpus/citation';
import { z } from 'zod';
import { log } from '../http';
import { isMissingObject } from '../s3-missing';

/**
 * Evidence reads for the source view and adjacent-period comparison (SPEC §16.2; architecture §9,
 * Phase 6). Both come from offline build outputs in the data bucket, never from a model:
 * - `processed/<indexVersion>/<documentId>.json`: the processed filing text and its sections
 *   (written by `pnpm ingest`, uploaded with the index). Citations index into this text.
 * - `index/<indexVersion>/adjacency/<TICKER>.json`: for each chunk, the most similar chunks of the
 *   same section in the adjacent comparable filings (chunk IDs only; computed at index build).
 *
 * Chunk spans are recomputed with the index's own chunker (`chunkFiling`), which reproduces every
 * chunk of the index byte for byte (fixtures and the evidence check prove it). That gives every
 * passage its text without loading the 93 MB `chunks.jsonl`. A chunk the chunker no longer
 * produces is logged and skipped, never invented.
 *
 * That only holds while the bundled chunker is the one that built the index, so the store first
 * reads `index/<indexVersion>/manifest.json` and compares its `chunkerVersion` with the bundled
 * `CHUNKER_VERSION`. On a mismatch, or a missing or unreadable manifest, evidence is unavailable
 * (the routes answer `index_unavailable`, logged as an error) rather than serving shifted spans.
 *
 * Both files are immutable within an index version, so they are cached per warm container in a
 * small LRU (the largest filing is ~1.3 MB of text). Transient read errors are never cached.
 */

/**
 * Reads an object by its full key in the data bucket. Null when the object does not exist (for S3
 * that includes the 403 a role without `s3:ListBucket` gets for a missing key: `isMissingObject`).
 */
export type EvidenceReader = (key: string) => Promise<string | null>;

export function s3EvidenceReader(s3: Pick<S3Client, 'send'>, bucket: string): EvidenceReader {
  return async (key) => {
    try {
      const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return (await out.Body?.transformToString('utf8')) ?? null;
    } catch (err) {
      if (isMissingObject(err, key)) return null;
      throw err;
    }
  };
}

export interface SourceDocument {
  meta: FilingMeta;
  sections: Section[];
  text: string;
  chunks: Chunk[];
}

export interface EvidenceStore {
  /** The index version the store reads; citations from another version do not resolve here. */
  readonly indexVersion: string;
  /**
   * Whether this index's evidence can be served: its manifest is readable and was built by the
   * bundled chunker version. False answers both routes `index_unavailable`.
   */
  ready(requestId: string): Promise<boolean>;
  /** A processed filing with its chunks; null when the document is not in this index. */
  document(documentId: string, requestId: string): Promise<SourceDocument | null>;
  /** The source-view response for a filing; null when the document is not in this index. */
  source(documentId: string, requestId: string): Promise<SourceDocumentResponse | null>;
  /** Adjacent-period passages for a chunk; null when the chunk is not in this index's adjacency file. */
  adjacent(chunkId: string, requestId: string): Promise<AdjacentEvidenceResponse | null>;
}

const SectionSchema = z.object({ kind: z.string(), code: z.string(), label: z.string(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).loose();
const ProcessedFilingSchema = z.object({
  meta: z
    .object({
      documentId: z.string(),
      ticker: z.string(),
      company: z.string(),
      filingType: FilingTypeSchema,
      filingDate: z.string(),
      periodEnd: z.string(),
      fiscalLabel: z.string(),
      sourceUrl: z.string(),
    })
    .loose(),
  sections: z.array(SectionSchema),
  text: z.string(),
});

const SideSchema = z.object({
  documentId: z.string(),
  fiscalLabel: z.string(),
  periodEnd: z.string(),
  matches: z.array(z.object({ chunkId: z.string(), score: z.number() })),
});
const AdjacencyFileSchema = z.record(
  z.string(),
  z.object({ previous: SideSchema.nullable(), next: SideSchema.nullable(), sameQuarterPriorYear: SideSchema.nullable().optional() }),
);
type AdjacencyFile = z.infer<typeof AdjacencyFileSchema>;

export const DOCUMENT_CACHE_SIZE = 8;
export const ADJACENCY_CACHE_SIZE = 6;

/** A tiny LRU: Map keeps insertion order, so a hit is re-inserted and the oldest key is evicted. */
function lru<V>(size: number) {
  const m = new Map<string, V>();
  return {
    get(k: string): V | undefined {
      const v = m.get(k);
      if (v !== undefined) {
        m.delete(k);
        m.set(k, v);
      }
      return v;
    },
    set(k: string, v: V) {
      m.delete(k);
      m.set(k, v);
      while (m.size > size) m.delete(m.keys().next().value as string);
    },
  };
}

const ManifestSchema = z.object({ indexVersion: z.string(), chunkerVersion: z.string() }).loose();

export function createEvidenceStore(opts: { indexVersion: string; read: EvidenceReader; chunkerVersion?: string }): EvidenceStore {
  const { indexVersion, read } = opts;
  const bundledChunker = opts.chunkerVersion ?? CHUNKER_VERSION;
  const docs = lru<SourceDocument | null>(DOCUMENT_CACHE_SIZE);
  const adjacency = lru<AdjacencyFile | null>(ADJACENCY_CACHE_SIZE);

  // The manifest verdict is cached for the container's life once it is definite (a readable
  // manifest, matching or not). A missing or unparseable manifest and a read error are not
  // cached, so an index uploaded after a cold start, or a transient S3 error, recovers.
  let verdict: boolean | undefined;
  const ready = async (requestId: string): Promise<boolean> => {
    if (verdict !== undefined) return verdict;
    const key = `index/${indexVersion}/manifest.json`;
    let raw: string | null;
    try {
      raw = await read(key);
    } catch (err) {
      log('error', 'index manifest read failed; evidence unavailable for this request', { requestId, key, error: (err as Error)?.name ?? String(err) });
      return false;
    }
    const parsed = raw === null ? null : ManifestSchema.safeParse(safeJson(raw));
    if (!parsed?.success) {
      log('error', raw === null ? 'index manifest missing; evidence unavailable' : 'index manifest unreadable; evidence unavailable', { requestId, key });
      return false;
    }
    const m = parsed.data;
    verdict = m.indexVersion === indexVersion && m.chunkerVersion === bundledChunker;
    if (!verdict) {
      log('error', 'index was built by another chunker version (or names another index); evidence unavailable rather than shifted spans', {
        requestId,
        key,
        manifestIndexVersion: m.indexVersion,
        manifestChunkerVersion: m.chunkerVersion,
        bundledChunkerVersion: bundledChunker,
      });
    }
    return verdict;
  };

  const document = async (documentId: string, requestId: string): Promise<SourceDocument | null> => {
    const ticker = tickerOfDocumentId(documentId);
    if (!ticker || !isCatalogTicker(ticker) || !DOCUMENT_ID_PATTERN.test(documentId)) return null;
    const hit = docs.get(documentId);
    if (hit !== undefined) return hit;
    const raw = await read(`processed/${indexVersion}/${documentId}.json`);
    let doc: SourceDocument | null = null;
    if (raw !== null) {
      const parsed = ProcessedFilingSchema.safeParse(safeJson(raw));
      if (parsed.success && parsed.data.meta.documentId === documentId) {
        const meta = parsed.data.meta as unknown as FilingMeta;
        const sections = parsed.data.sections as unknown as Section[];
        doc = { meta, sections, text: parsed.data.text, chunks: chunkFiling(meta, parsed.data.text, sections) };
      } else {
        log('error', 'processed filing unreadable; treated as missing', { requestId, documentId });
      }
    }
    docs.set(documentId, doc);
    return doc;
  };

  const adjacencyFor = async (ticker: string, requestId: string): Promise<AdjacencyFile | null> => {
    const hit = adjacency.get(ticker);
    if (hit !== undefined) return hit;
    const raw = await read(`index/${indexVersion}/adjacency/${ticker}.json`);
    let file: AdjacencyFile | null = null;
    if (raw !== null) {
      const parsed = AdjacencyFileSchema.safeParse(safeJson(raw));
      if (parsed.success) file = parsed.data;
      else log('error', 'adjacency file unreadable; treated as missing', { requestId, ticker });
    }
    adjacency.set(ticker, file);
    return file;
  };

  const side = async (s: z.infer<typeof SideSchema> | null | undefined, requestId: string): Promise<AdjacentSide | null> => {
    if (!s) return null;
    const doc = await document(s.documentId, requestId);
    if (!doc) {
      log('error', 'adjacent filing missing', { requestId, documentId: s.documentId });
      return null;
    }
    const byId = new Map(doc.chunks.map((c) => [c.chunkId, c]));
    const passages: Citation[] = [];
    for (const m of s.matches) {
      const chunk = byId.get(m.chunkId);
      if (chunk) passages.push(chunkCitation(chunk, indexVersion));
      else log('error', 'adjacent chunk not reproduced by the chunker; skipped', { requestId, chunkId: m.chunkId });
    }
    const { meta } = doc;
    return {
      filing: { documentId: meta.documentId, ticker: meta.ticker, company: meta.company, filingType: meta.filingType, filingDate: meta.filingDate, periodEnd: meta.periodEnd, fiscalLabel: meta.fiscalLabel },
      passages,
    };
  };

  return {
    indexVersion,
    ready,
    document,
    async source(documentId, requestId) {
      const doc = await document(documentId, requestId);
      if (!doc) return null;
      const { meta } = doc;
      return {
        indexVersion,
        filing: { documentId: meta.documentId, ticker: meta.ticker, company: meta.company, filingType: meta.filingType, filingDate: meta.filingDate, periodEnd: meta.periodEnd, fiscalLabel: meta.fiscalLabel, sourceUrl: meta.sourceUrl },
        sections: doc.sections.map((s) => ({ code: s.code, title: s.label, charStart: s.start, charEnd: s.end })),
        chunks: doc.chunks.map((c) => ({ chunkId: c.chunkId, section: chunkSectionLabel(c), charStart: c.charStart, charEnd: c.charEnd })),
        text: doc.text,
      };
    },
    async adjacent(chunkId, requestId) {
      const ticker = tickerOfChunkId(chunkId);
      if (!ticker || !isCatalogTicker(ticker)) return null;
      const entry = (await adjacencyFor(ticker, requestId))?.[chunkId];
      if (!entry) return null;
      const [previous, next, sameQuarterPriorYear] = await Promise.all([side(entry.previous, requestId), side(entry.next, requestId), side(entry.sameQuarterPriorYear, requestId)]);
      return { chunkId, indexVersion, previous, next, sameQuarterPriorYear };
    },
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Reads evidence objects from a local directory laid out like the bucket (tests and the local server). */
export function dirEvidenceReader(root: string): EvidenceReader {
  return async (key) => {
    const { readFile } = await import('node:fs/promises');
    const { join, normalize } = await import('node:path');
    const path = normalize(join(root, key));
    if (!path.startsWith(normalize(root))) return null;
    try {
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  };
}

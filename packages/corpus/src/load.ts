import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { RawFiling } from './filing';

/**
 * Corpus input (SPEC §24.1): `CORPUS_PATH` is either the extracted `edgar_corpus/` directory
 * or `edgar_corpus.zip`. Both yield the same `.txt` filings and `manifest.json`.
 */
export interface CorpusManifest {
  corpus?: string;
  description?: string;
  file_count?: number;
  filing_types?: Record<string, number>;
  files?: string[];
  license?: string;
  source?: string;
}

export interface LoadedCorpus {
  path: string;
  manifest: CorpusManifest | null;
  filings: RawFiling[];
}

export function defaultCorpusPath(root: string): string {
  return resolve(process.env.CORPUS_PATH ?? join(root, 'edgar_corpus'));
}

export function loadCorpus(path: string): LoadedCorpus {
  if (!existsSync(path)) throw new Error(`corpus not found: ${path} (set CORPUS_PATH)`);
  const entries = statSync(path).isDirectory() ? readDirectory(path) : readZip(readFileSync(path));
  const filings = entries
    .filter((e) => e.name.endsWith('.txt'))
    .map((e) => ({ file: e.name, raw: e.data.toString('utf8') }))
    .sort((a, b) => a.file.localeCompare(b.file));
  const m = entries.find((e) => e.name === 'manifest.json');
  return { path, manifest: m ? (JSON.parse(m.data.toString('utf8')) as CorpusManifest) : null, filings };
}

/** Completeness check: every manifest file is present and nothing extra is (SPEC §24.2 step 1). */
export function manifestIssues(corpus: LoadedCorpus): string[] {
  const m = corpus.manifest;
  if (!m) return ['manifest.json is missing'];
  const issues: string[] = [];
  const present = new Set(corpus.filings.map((f) => f.file));
  const listed = new Set(m.files ?? []);
  for (const f of listed) if (!present.has(f)) issues.push(`manifest lists ${f}, which is missing`);
  for (const f of present) if (!listed.has(f)) issues.push(`${f} is not in the manifest`);
  if (m.file_count !== undefined && m.file_count !== corpus.filings.length) {
    issues.push(`manifest file_count ${m.file_count} != ${corpus.filings.length} filings`);
  }
  return issues;
}

interface Entry {
  name: string;
  data: Buffer;
}

function readDirectory(dir: string): Entry[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.txt') || n === 'manifest.json')
    .map((name) => ({ name, data: readFileSync(join(dir, name)) }));
}

/**
 * Minimal ZIP reader (stored and deflated entries, via the central directory), so the zip
 * needs no extra dependency. Directory prefixes are dropped (`edgar_corpus/AAPL_….txt`).
 */
export function readZip(buf: Buffer): Entry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Entry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const fullName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (fullName.endsWith('/') || fullName.includes('__MACOSX')) continue;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`${fullName}: unsupported zip compression method ${method}`);
    out.push({ name: fullName.split('/').pop()!, data });
  }
  return out;
}

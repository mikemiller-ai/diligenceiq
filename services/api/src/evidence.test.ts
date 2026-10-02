import {
  type AdjacentEvidenceResponse,
  AdjacentEvidenceResponseSchema,
  CHUNK_ID_SOURCE,
  ApiErrorSchema,
  type Citation,
  type CompanyIntelligenceProfile,
  type SourceDocumentResponse,
  SourceDocumentResponseSchema,
  citationMatchesSource,
} from '@diligenceiq/core';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHUNKER_VERSION } from '@diligenceiq/corpus/chunker';
import { EVIDENCE_CACHE_CONTROL } from './app';
import { createEvidenceStore, type EvidenceReader, s3EvidenceReader } from './evidence/store';
import type { HttpResponse } from './http';
import { s3SetReader } from './profiles/provider';
import { HAVE_CORPUS, PROFILE_SET_ROOT, SEED, TEST_INDEX_VERSION, authed, body, corpusEvidence, newSession, testApp } from './test-helpers';

/**
 * Phase 6 evidence routes (SPEC §16.2; architecture §9): `GET /api/sources/:documentId` and
 * `GET /api/evidence/adjacent`. The first block uses a synthetic filing (no corpus); the second
 * runs on the real corpus and the committed adjacency subset, and is the gate's citation-integrity
 * check: every seeded brief citation, context passage and fixture-profile citation resolves to its
 * passage, and the adjacent-period lookup works on AAPL and JNJ (the exit criterion). The full
 * index (every chunk, every adjacency reference, all built profile sets and the recorded live
 * briefs) is checked offline by `pnpm evidence:check`.
 */

const expectError = (res: HttpResponse, status: number, code: string) => {
  expect(res.statusCode, res.body).toBe(status);
  const err = ApiErrorSchema.parse(body(res)).error;
  expect(err.code).toBe(code);
  return err;
};

/* ------------------------------------------------------- synthetic filing */

const IV = TEST_INDEX_VERSION;
const sentence = (i: number) => `Risk number ${i} could adversely affect our results of operations and financial condition in ways we cannot predict. `;
const RF = `Item 1A. Risk Factors\n${Array.from({ length: 120 }, (_, i) => sentence(i)).join('')}`;
const COVER = 'UNITED STATES SECURITIES AND EXCHANGE COMMISSION. Annual report for the fiscal year. ';
const TEXT = `${COVER}\n${RF}`;
const META = (documentId: string, fiscalYear: number) => ({
  documentId,
  sourceFile: `${documentId}_full.txt`,
  company: 'Apple Inc',
  ticker: 'AAPL',
  cik: '0000320193',
  sector: 'Information Technology',
  filingType: '10-K',
  filingDate: `${fiscalYear}-11-01`,
  periodEnd: `${fiscalYear}-09-27`,
  periodSource: 'header',
  fiscalYear,
  fiscalQuarter: null,
  fiscalLabel: `FY${fiscalYear}`,
  calendarQuarter: null,
  sourceUrl: 'https://www.sec.gov/Archives/example.htm',
  outsideReviewWindow: false,
});
const SECTIONS = [
  { kind: 'other', code: 'OTH', label: 'Other', start: 0, end: COVER.length + 1, anchor: 'none' },
  { kind: 'risk_factors', code: '1A', label: 'Item 1A — Risk Factors', start: COVER.length + 1, end: TEXT.length, anchor: 'item' },
];
const OLD = 'AAPL_10K_2097-11-01';
const NEW = 'AAPL_10K_2098-11-01';

const MANIFEST = (chunkerVersion = CHUNKER_VERSION) => JSON.stringify({ indexVersion: IV, createdAt: '2026-10-02T00:00:00Z', chunkerVersion, tokenizerVersion: 't2' });

function syntheticReader(overrides: Record<string, string | null> = {}): { read: EvidenceReader; calls: string[] } {
  const calls: string[] = [];
  const files: Record<string, string | null> = {
    [`index/${IV}/manifest.json`]: MANIFEST(),
    [`processed/${IV}/${OLD}.json`]: JSON.stringify({ meta: META(OLD, 2097), sections: SECTIONS, text: TEXT }),
    [`processed/${IV}/${NEW}.json`]: JSON.stringify({ meta: META(NEW, 2098), sections: SECTIONS, text: TEXT }),
    [`processed/${IV}/AAPL_10K_2096-11-01.json`]: '{not json',
    [`index/${IV}/adjacency/AAPL.json`]: JSON.stringify({
      'AAPL-FY2098-10K-1A-001': {
        previous: { documentId: OLD, fiscalLabel: 'FY2097', periodEnd: '2097-09-27', matches: [{ chunkId: 'AAPL-FY2097-10K-1A-002', score: 0.9 }, { chunkId: 'AAPL-FY2097-10K-1A-999', score: 0.8 }] },
        next: null,
        sameQuarterPriorYear: null,
      },
    }),
    ...overrides,
  };
  return {
    calls,
    read: async (key) => {
      calls.push(key);
      return files[key] ?? null;
    },
  };
}

function syntheticApp(overrides: Record<string, string | null> = {}) {
  const reader = syntheticReader(overrides);
  const evidence = createEvidenceStore({ indexVersion: IV, read: reader.read });
  return { ...testApp({ deps: { evidence } }), reader };
}

describe('GET /api/sources/:documentId (synthetic filing)', () => {
  it('returns the processed text, sections and every chunk span, which slice the text exactly', async () => {
    const { app } = syntheticApp();
    const { cookie } = await newSession(app);
    const res = await app(authed(cookie, 'GET', `/api/sources/${NEW}`));
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe(EVIDENCE_CACHE_CONTROL);
    const src = SourceDocumentResponseSchema.parse(body(res));
    expect(src.indexVersion).toBe(IV);
    expect(src.filing).toMatchObject({ documentId: NEW, ticker: 'AAPL', filingType: '10-K', fiscalLabel: 'FY2098' });
    expect(src.text).toBe(TEXT);
    expect(src.sections.map((s) => s.title)).toEqual(['Other', 'Item 1A — Risk Factors']);
    expect(src.chunks.length).toBeGreaterThan(2);
    expect(src.chunks[1]?.chunkId).toBe('AAPL-FY2098-10K-1A-001');
    for (const c of src.chunks) expect(src.text.slice(c.charStart, c.charEnd).length).toBe(c.charEnd - c.charStart);
  });

  it('caches a filing per warm container (one read for repeated requests)', async () => {
    const { app, reader } = syntheticApp();
    const { cookie } = await newSession(app);
    await app(authed(cookie, 'GET', `/api/sources/${NEW}`));
    await app(authed(cookie, 'GET', `/api/sources/${NEW}`));
    expect(reader.calls.filter((k) => k.endsWith(`${NEW}.json`))).toHaveLength(1);
  });

  it('answers SOURCE_MISSING for an absent or unreadable filing, 400s a malformed ID or unknown ticker, and reads only the manifest and processed/<iv>/', async () => {
    const { app, reader } = syntheticApp();
    const { cookie } = await newSession(app);
    const missing = await app(authed(cookie, 'GET', '/api/sources/AAPL_10K_2001-01-01'));
    expect(expectError(missing, 404, 'SOURCE_MISSING').message).toBe('This filing isn’t available.');
    expect(missing.headers['cache-control']).toBe('no-store');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expectError(await app(authed(cookie, 'GET', '/api/sources/AAPL_10K_2096-11-01')), 404, 'SOURCE_MISSING');
    expect(log.mock.calls.some(([l]) => String(l).includes('processed filing unreadable'))).toBe(true);
    log.mockRestore();
    for (const bad of ['not-a-document', 'ZZZZZ_10K_2025-10-31', 'AAPL_10K_2025-10-31x']) {
      expectError(await app(authed(cookie, 'GET', `/api/sources/${bad}`)), 400, 'VALIDATION_ERROR');
    }
    expect(reader.calls.every((k) => k === `index/${IV}/manifest.json` || k.startsWith(`processed/${IV}/AAPL_10K_`))).toBe(true);
  });

  it('a citation from another index version is a 404 with reason index_version', async () => {
    const { app } = syntheticApp();
    const { cookie } = await newSession(app);
    const err = expectError(await app(authed(cookie, 'GET', `/api/sources/${NEW}`, { query: { indexVersion: 'iv-000000000000' } })), 404, 'NOT_FOUND');
    expect(err.details).toMatchObject({ reason: 'index_version', indexVersion: IV });
    expectError(await app(authed(cookie, 'GET', `/api/sources/${NEW}`, { query: { other: '1' } })), 400, 'VALIDATION_ERROR');
  });

  it('without an evidence store both routes answer 404 index_unavailable', async () => {
    const { app } = testApp();
    const { cookie } = await newSession(app);
    expect(expectError(await app(authed(cookie, 'GET', `/api/sources/${NEW}`)), 404, 'NOT_FOUND').details).toMatchObject({ reason: 'index_unavailable' });
    const adj = await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'AAPL-FY2098-10K-1A-001' } }));
    expect(expectError(adj, 404, 'NOT_FOUND').details).toMatchObject({ reason: 'index_unavailable' });
  });
});

describe('index manifest guard: the bundled chunker must be the one that built the index', () => {
  const quiet = () => vi.spyOn(console, 'log').mockImplementation(() => undefined);

  it('a manifest from another chunker version answers both routes index_unavailable, logged as an error, and the verdict is cached', async () => {
    const { app, reader } = syntheticApp({ [`index/${IV}/manifest.json`]: MANIFEST('c1') });
    const { cookie } = await newSession(app);
    const log = quiet();
    const src = await app(authed(cookie, 'GET', `/api/sources/${NEW}`));
    const adj = await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'AAPL-FY2098-10K-1A-001' } }));
    const logged = log.mock.calls.map(([l]) => JSON.parse(String(l)) as { level: string; msg: string; bundledChunkerVersion?: string });
    log.mockRestore();
    expect(expectError(src, 404, 'NOT_FOUND').details).toMatchObject({ reason: 'index_unavailable' });
    expect(expectError(adj, 404, 'NOT_FOUND').details).toMatchObject({ reason: 'index_unavailable' });
    expect(logged.some((l) => l.level === 'error' && /another chunker version/.test(l.msg) && l.bundledChunkerVersion === CHUNKER_VERSION)).toBe(true);
    // No filing text is read under a mismatched chunker, and the manifest is read once.
    expect(reader.calls).toEqual([`index/${IV}/manifest.json`]);
  });

  it('a missing or unparseable manifest is unavailable but not cached; an upload later is picked up', async () => {
    const files: Record<string, string | null> = { [`index/${IV}/manifest.json`]: null };
    const inner = syntheticReader();
    const store = createEvidenceStore({ indexVersion: IV, read: async (key) => (key in files ? files[key]! : inner.read(key)) });
    const log = quiet();
    expect(await store.ready('r1')).toBe(false);
    files[`index/${IV}/manifest.json`] = '{not json';
    expect(await store.ready('r2')).toBe(false);
    files[`index/${IV}/manifest.json`] = MANIFEST();
    expect(await store.ready('r3')).toBe(true);
    log.mockRestore();
  });

  it('a read error is unavailable for that request only (never cached)', async () => {
    let fail = true;
    const inner = syntheticReader();
    const store = createEvidenceStore({ indexVersion: IV, read: async (key) => (fail && key.endsWith('manifest.json') ? Promise.reject(Object.assign(new Error('slow down'), { name: 'SlowDown' })) : inner.read(key)) });
    const log = quiet();
    expect(await store.ready('r1')).toBe(false);
    fail = false;
    expect(await store.ready('r2')).toBe(true);
    log.mockRestore();
  });

  it('a manifest naming another index version is unavailable', async () => {
    const store = createEvidenceStore({ indexVersion: IV, read: syntheticReader({ [`index/${IV}/manifest.json`]: JSON.stringify({ indexVersion: 'iv-000000000000', chunkerVersion: CHUNKER_VERSION }) }).read });
    const log = quiet();
    expect(await store.ready('r1')).toBe(false);
    log.mockRestore();
  });
});

describe('S3 readers: a missing key under a role without s3:ListBucket is a 403, read as missing', () => {
  const denied = Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
  const s3 = (err: unknown) => ({ send: vi.fn(async () => Promise.reject(err)) });

  it('the evidence reader returns null on AccessDenied and on NoSuchKey, logging the denied key as a warning', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await s3EvidenceReader(s3(denied), 'b')(`processed/${IV}/AAPL_10K_2001-01-01.json`)).toBeNull();
    expect(await s3EvidenceReader(s3({ name: 'Forbidden', $metadata: { httpStatusCode: 403 } }), 'b')('k')).toBeNull();
    expect(await s3EvidenceReader(s3(Object.assign(new Error('nope'), { name: 'NoSuchKey' })), 'b')('k')).toBeNull();
    const warned = log.mock.calls.map(([l]) => JSON.parse(String(l)) as { level: string; key?: string });
    log.mockRestore();
    expect(warned.some((l) => l.level === 'warn' && l.key === `processed/${IV}/AAPL_10K_2001-01-01.json`)).toBe(true);
  });

  it('the profile-set reader returns null on AccessDenied, with the full key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(await s3SetReader(s3(denied), 'b')(`${IV}/llm-v3/ZZZ.json`)).toBeNull();
    const warned = log.mock.calls.map(([l]) => JSON.parse(String(l)) as { level: string; key?: string });
    log.mockRestore();
    expect(warned.some((l) => l.level === 'warn' && l.key === `intelligence/${IV}/llm-v3/ZZZ.json`)).toBe(true);
  });

  it('other errors still throw (a transient failure is not "missing")', async () => {
    const slow = Object.assign(new Error('Service Unavailable'), { name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } });
    await expect(s3EvidenceReader(s3(slow), 'b')('k')).rejects.toThrow('Service Unavailable');
    await expect(s3SetReader(s3(slow), 'b')('k')).rejects.toThrow('Service Unavailable');
  });
});

describe('GET /api/evidence/adjacent (synthetic filing)', () => {
  it('returns the adjacent passages as citations, skipping a chunk the chunker does not produce', async () => {
    const { app } = syntheticApp();
    const { cookie } = await newSession(app);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const res = await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'AAPL-FY2098-10K-1A-001' } }));
    const logged = log.mock.calls.map(([l]) => String(l));
    log.mockRestore();
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe(EVIDENCE_CACHE_CONTROL);
    const adj = AdjacentEvidenceResponseSchema.parse(body(res));
    expect(adj.next).toBeNull();
    expect(adj.sameQuarterPriorYear).toBeNull();
    expect(adj.previous?.filing).toMatchObject({ documentId: OLD, fiscalLabel: 'FY2097' });
    expect(adj.previous?.passages.map((p) => p.chunkId)).toEqual(['AAPL-FY2097-10K-1A-002']);
    const p = adj.previous!.passages[0]!;
    expect(p).toMatchObject({ indexVersion: IV, section: 'Item 1A — Risk Factors', documentId: OLD });
    expect(citationMatchesSource(p, TEXT)).toBe(true);
    expect(logged.some((l) => l.includes('not reproduced by the chunker'))).toBe(true);
  });

  it('404s a chunk with no entry, 400s a malformed chunk ID, and checks the index version', async () => {
    const { app } = syntheticApp();
    const { cookie } = await newSession(app);
    expectError(await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'AAPL-FY2097-10K-1A-001' } })), 404, 'NOT_FOUND');
    expectError(await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'ZZZZZ-FY2097-10K-1A-001' } })), 404, 'NOT_FOUND');
    for (const chunkId of ['', '../AAPL', 'AAPL-FY2097-10K-1A-1', 'aapl-fy2097-10k-1a-001']) {
      expectError(await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId } })), 400, 'VALIDATION_ERROR');
    }
    expectError(await app(authed(cookie, 'GET', '/api/evidence/adjacent')), 400, 'VALIDATION_ERROR');
    const err = expectError(await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId: 'AAPL-FY2098-10K-1A-001', indexVersion: 'iv-000000000000' } })), 404, 'NOT_FOUND');
    expect(err.details).toMatchObject({ reason: 'index_version' });
  });
});

/* ------------------------------------------------------ real corpus (gate) */

// Under REQUIRE_CORPUS=1 (`pnpm gate`) a missing corpus is a failure, never a silent skip.
if (!HAVE_CORPUS && process.env.REQUIRE_CORPUS === '1') throw new Error('evidence.test: REQUIRE_CORPUS=1 but the corpus is missing; set CORPUS_PATH or restore edgar_corpus/');
if (!HAVE_CORPUS) console.warn('evidence.test: corpus not found; skipping the real-filing citation-integrity and adjacency checks');

describe.skipIf(!HAVE_CORPUS)('citation integrity and adjacent periods over the real corpus', () => {
  const realApp = () => testApp({ deps: { evidence: corpusEvidence() } });
  const sources = new Map<string, SourceDocumentResponse>();
  const source = async (app: ReturnType<typeof realApp>['app'], cookie: string, documentId: string) => {
    let s = sources.get(documentId);
    if (!s) {
      const res = await app(authed(cookie, 'GET', `/api/sources/${documentId}`));
      expect(res.statusCode, `${documentId}: ${res.body.slice(0, 200)}`).toBe(200);
      s = SourceDocumentResponseSchema.parse(body(res));
      sources.set(documentId, s);
    }
    return s;
  };
  /** A citation resolves: its filing opens, the chunk is listed at the same span, and the span is its text. */
  const expectResolves = async (app: ReturnType<typeof realApp>['app'], cookie: string, c: Pick<Citation, 'chunkId' | 'documentId' | 'charStart' | 'charEnd' | 'text'>, where: string) => {
    const s = await source(app, cookie, c.documentId);
    const chunk = s.chunks.find((x) => x.chunkId === c.chunkId);
    expect(chunk, `${where}: ${c.chunkId} not in ${c.documentId}`).toBeDefined();
    expect({ start: chunk?.charStart, end: chunk?.charEnd }, `${where}: ${c.chunkId}`).toEqual({ start: c.charStart, end: c.charEnd });
    expect(citationMatchesSource(c, s.text), `${where}: ${c.chunkId} text`).toBe(true);
  };

  it('every seeded brief citation and context passage resolves to its passage, and every brief citation ID is a citation', { timeout: 60_000 }, async () => {
    const { app } = realApp();
    const { cookie } = await newSession(app);
    let n = 0;
    for (const a of SEED.analyses) {
      const cited = new Set(a.citations.map((c) => c.chunkId));
      for (const id of new Set(JSON.stringify(a.brief).match(new RegExp(CHUNK_ID_SOURCE, 'g')) ?? [])) expect(cited.has(id), `${a.analysisId}: ${id}`).toBe(true);
      for (const c of a.citations) {
        expect(c.indexVersion).toBe(IV);
        await expectResolves(app, cookie, c, `${a.analysisId} citation`);
        n++;
      }
      for (const c of a.context.passages) {
        await expectResolves(app, cookie, c, `${a.analysisId} context`);
        n++;
      }
    }
    expect(n).toBeGreaterThan(50);
  });

  it('every citation in the committed fixture profiles resolves to its passage', { timeout: 60_000 }, async () => {
    const { app } = realApp();
    const { cookie } = await newSession(app);
    const dir = join(PROFILE_SET_ROOT, IV, 'fixture-v2');
    let n = 0;
    for (const name of readdirSync(dir).filter((f) => /^[A-Z]+\.json$/.test(f))) {
      const p = JSON.parse(readFileSync(join(dir, name), 'utf8')) as CompanyIntelligenceProfile;
      for (const c of p.citations) {
        await expectResolves(app, cookie, c, `fixture-v2 ${p.ticker}`);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  const adjacent = async (chunkId: string) => {
    const { app } = realApp();
    const { cookie } = await newSession(app);
    const res = await app(authed(cookie, 'GET', '/api/evidence/adjacent', { query: { chunkId } }));
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const adj = AdjacentEvidenceResponseSchema.parse(body(res));
    for (const side of [adj.previous, adj.next, adj.sameQuarterPriorYear]) {
      for (const p of side?.passages ?? []) {
        expect(p.documentId).toBe(side?.filing.documentId);
        await expectResolves(app, cookie, p, `adjacent of ${chunkId}`);
      }
    }
    return adj;
  };
  const sectionOf = (adj: AdjacentEvidenceResponse, side: 'previous' | 'next' | 'sameQuarterPriorYear') => [...new Set(adj[side]?.passages.map((p) => p.section.split(' › ')[0]))];

  it('AAPL 10-K: the latest annual report’s Risk Factors compare with the prior year’s, and the history ends there', { timeout: 60_000 }, async () => {
    const latest = await adjacent('AAPL-FY2025-10K-1A-001');
    expect(latest.next).toBeNull();
    expect(latest.sameQuarterPriorYear).toBeNull();
    expect(latest.previous?.filing).toMatchObject({ documentId: 'AAPL_10K_2024Q3_2024-11-01', fiscalLabel: 'FY2024', filingType: '10-K' });
    expect(latest.previous?.passages[0]?.chunkId).toBe('AAPL-FY2024-10K-1A-001');
    expect(sectionOf(latest, 'previous')).toEqual(['Item 1A — Risk Factors']);

    const earliest = await adjacent('AAPL-FY2022-10K-MDA-001');
    expect(earliest.previous).toBeNull();
    expect(earliest.next?.filing.fiscalLabel).toBe('FY2023');
    expect(earliest.next?.passages.length).toBe(3);
  });

  it('AAPL 10-Q: previous and next quarter, plus the same quarter a year earlier', { timeout: 60_000 }, async () => {
    const q = await adjacent('AAPL-FY2024Q2-10Q-MDA-001');
    expect(q.previous?.filing.fiscalLabel).toBe('FY2024Q1');
    expect(q.next?.filing.fiscalLabel).toBe('FY2024Q3');
    expect(q.sameQuarterPriorYear?.filing.fiscalLabel).toBe('FY2023Q2');
    for (const side of ['previous', 'next', 'sameQuarterPriorYear'] as const) expect(q[side]?.filing.filingType).toBe('10-Q');
  });

  it('JNJ: annual MD&A at both ends of the history, and a quarterly MD&A with its year-over-year quarter', { timeout: 60_000 }, async () => {
    const first = await adjacent('JNJ-FY2021-10K-MDA-001');
    expect(first.previous).toBeNull();
    expect(first.next?.filing).toMatchObject({ documentId: 'JNJ_10K_2023Q1_2023-02-16', fiscalLabel: 'FY2022' });
    expect(sectionOf(first, 'next')[0]).toMatch(/Management/);

    const last = await adjacent('JNJ-FY2025-10K-1A-001');
    expect(last.next).toBeNull();
    expect(last.previous?.filing.fiscalLabel).toBe('FY2024');

    // JNJ 10-Qs have no Risk Factors section (STATE known trap): MD&A is the quarterly comparison.
    const q = await adjacent('JNJ-FY2024Q2-10Q-MDA-001');
    expect(q.previous?.filing.fiscalLabel).toBe('FY2024Q1');
    expect(q.next?.filing.fiscalLabel).toBe('FY2024Q3');
    expect(q.sameQuarterPriorYear?.filing).toMatchObject({ documentId: 'JNJ_10Q_2023Q3_2023-07-31', fiscalLabel: 'FY2023Q2' });
  });
});

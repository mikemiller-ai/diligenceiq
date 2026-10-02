import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Chunk } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { computeAdjacency } from './adjacency';
import { buildBm25, loadBm25, scoreBm25 } from './bm25';
import { EmbeddingCache, TokenRateLimiter, acquireCacheLock, cacheLockPath, embedAll, embeddingHash, sumEmbedRuns } from './embedder';
import { type IndexManifest, type LoadedIndex, cosineScores, loadIndex, parseChunks, vectorsFromBuffer, ARTIFACTS } from './format';
import { buildSummary, formatSummary, type IngestReport } from './summary';
import { tokenize } from './tokenize';
import { validateIndex } from './validate';

describe('tokenize', () => {
  it('lowercases, drops stopwords, folds plurals and keeps numbers; U.S. becomes "us" (the pronoun is a stopword)', () => {
    expect(tokenize('The Company’s net sales of iPhones in the U.S. rose 6% in 2025')).toEqual([
      'company', 'net', 'sale', 'iphone', 'us', 'rose', '6', '2025',
    ]);
    expect(tokenize('Risk factors: subsidiaries and companies')).toEqual(['risk', 'factor', 'subsidiary', 'company']);
  });

  it('t2: keeps decimals as one token with their point, still folds dotted abbreviations', () => {
    expect(tokenize('Revenue rose 1.2% to $3.75 billion, versus 12% in the U.S.')).toEqual(['revenue', 'rose', '1.2', '3.75', 'billion', 'versus', '12', 'us']);
    expect(tokenize('1.2')).not.toEqual(tokenize('12'));
    expect(tokenize('U.S. and u.s.')).toEqual(['us', 'us']);
  });

  it('t2: keeps the negations "no", "not" and "nor"', () => {
    expect(tokenize('There were no material changes, not one, nor any')).toEqual(['no', 'material', 'change', 'not', 'one', 'nor']);
    expect(tokenize('no material changes')).not.toEqual(tokenize('material changes'));
  });
});

describe('BM25', () => {
  const docs = ['apple iphone sales grew', 'microsoft cloud revenue grew strongly', 'iphone iphone iphone supply chain risk'];

  it('round-trips through the binary postings and ranks term frequency and rarity', () => {
    const { meta, postings } = buildBm25(docs, 't1');
    expect(meta.docCount).toBe(3);
    expect(postings.byteLength).toBe(meta.offsets.at(-1)! * 6);
    const index = loadBm25(JSON.parse(JSON.stringify(meta)), Buffer.from(postings));
    const scores = scoreBm25(index, 'iphone');
    expect([...scores.keys()].sort()).toEqual([0, 2]);
    expect(scores.get(2)!).toBeGreaterThan(scores.get(0)!);
    expect(scoreBm25(index, 'cloud').get(1)).toBeGreaterThan(0);
    expect(scoreBm25(index, 'nothing here').size).toBe(0);
  });

  it('applies a metadata filter', () => {
    const { meta, postings } = buildBm25(docs, 't1');
    const index = loadBm25(meta, postings);
    expect([...scoreBm25(index, 'iphone', (d) => d !== 2).keys()]).toEqual([0]);
  });

  it('rejects truncated postings', () => {
    const { meta, postings } = buildBm25(docs, 't1');
    expect(() => loadBm25(meta, postings.subarray(0, postings.byteLength - 2))).toThrow(/postings/);
  });
});

const unit = (dims: number, hot: number, mix = 0) => {
  const v = new Float32Array(dims);
  v[hot] = Math.sqrt(1 - mix * mix);
  v[(hot + 1) % dims] = mix;
  return v;
};

describe('embedding cache and embedder', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'diq-embed-'));

  it('embeds each unique text once, caches by content hash, and resumes after an interruption', async () => {
    const path = join(dir(), 'cache.jsonl');
    const calls: string[] = [];
    const embedOne = async (text: string) => {
      calls.push(text);
      return { vector: unit(4, text.length % 4), inputTokens: text.length };
    };
    const limiter = new TokenRateLimiter(1_000_000);
    const first = await embedAll(['a', 'bb', 'a', 'ccc'], { modelId: 'm', embedOne, cache: new EmbeddingCache(path, 4), limiter, concurrency: 2, maxCalls: 2 });
    expect(first).toMatchObject({ attempts: 2, successfulCalls: 2, cacheHits: 1 });
    // A new process (fresh cache object) resumes from the file: only the remaining text is embedded.
    const second = await embedAll(['a', 'bb', 'a', 'ccc'], { modelId: 'm', embedOne, cache: new EmbeddingCache(path, 4), limiter, concurrency: 2 });
    expect(second).toMatchObject({ attempts: 1, successfulCalls: 1, cacheHits: 3, billedInputTokens: 3 });
    expect(calls.sort()).toEqual(['a', 'bb', 'ccc']);
    const cache = new EmbeddingCache(path, 4);
    expect(cache.size).toBe(3);
    expect(cache.tokens(embeddingHash('ccc', 'm'))).toBe(3);
    // A different model is a different cache key.
    expect(embeddingHash('a', 'm')).not.toBe(embeddingHash('a', 'other'));
  });

  it('ignores a torn final line and keeps appending on a fresh line', () => {
    const path = join(dir(), 'cache.jsonl');
    const c = new EmbeddingCache(path, 2);
    c.put('h1', unit(2, 0), 1);
    appendFileSync(path, '{"h":"h2","t":1,"v":"AAA');
    const reopened = new EmbeddingCache(path, 2);
    expect(reopened.size).toBe(1);
    expect(reopened.skippedLines).toBe(1);
    reopened.put('h3', unit(2, 1), 1);
    expect(new EmbeddingCache(path, 2).size).toBe(2);
    expect(readFileSync(path, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('rejects vectors with the wrong dimension', () => {
    const c = new EmbeddingCache(join(dir(), 'c.jsonl'), 3);
    expect(() => c.put('h', unit(4, 0), 1)).toThrow(/dims/);
  });

  it('retries throttling, but not other errors', async () => {
    let n = 0;
    const embedOne = async () => {
      n++;
      if (n < 3) throw Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      return { vector: unit(2, 0), inputTokens: 1 };
    };
    const o = { modelId: 'm', limiter: new TokenRateLimiter(1e6), concurrency: 1, sleep: async () => {}, isRetryable: (e: unknown) => /Throttl/.test((e as Error).name) };
    const ok = await embedAll(['x'], { ...o, embedOne, cache: new EmbeddingCache(join(dir(), 'a.jsonl'), 2) });
    expect(ok).toMatchObject({ attempts: 3, successfulCalls: 1, billedInputTokens: 1, failures: 0 });
    await expect(
      embedAll(['y'], { ...o, embedOne: async () => Promise.reject(new Error('ValidationException')), cache: new EmbeddingCache(join(dir(), 'b.jsonl'), 2) }),
    ).rejects.toThrow(/Validation/);
  });

  it('every attempt, retries included, acquires the rate limiter', async () => {
    const acquired: number[] = [];
    const limiter = new TokenRateLimiter(1e6);
    const original = limiter.acquire.bind(limiter);
    limiter.acquire = async (tokens: number) => {
      acquired.push(tokens);
      return original(tokens);
    };
    let n = 0;
    const embedOne = async () => {
      if (++n < 4) throw Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
      return { vector: unit(2, 0), inputTokens: 2 };
    };
    const stats = await embedAll(['abcdefgh'], {
      modelId: 'm', embedOne, limiter, concurrency: 1, sleep: async () => {}, isRetryable: () => true, cache: new EmbeddingCache(join(dir(), 'r.jsonl'), 2),
    });
    expect(n).toBe(4);
    expect(acquired).toEqual([2, 2, 2, 2]);
    expect(stats).toMatchObject({ attempts: 4, successfulCalls: 1, billedInputTokens: 2 });
  });

  it('maxCalls is a hard cap on model calls at concurrency 6, retries included', async () => {
    for (const fail of [false, true]) {
      let calls = 0;
      let k = 0;
      const embedOne = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 1 + (calls % 3)));
        if (fail && ++k % 2 === 1) throw Object.assign(new Error('x'), { name: 'ThrottlingException' });
        return { vector: unit(2, 0), inputTokens: 1 };
      };
      const texts = Array.from({ length: 40 }, (_, i) => `text ${i}`);
      const stats = await embedAll(texts, {
        modelId: 'm', embedOne, limiter: new TokenRateLimiter(1e9), concurrency: 6, maxCalls: 7, sleep: async () => {}, isRetryable: () => true,
        cache: new EmbeddingCache(join(dir(), 'm.jsonl'), 2),
      });
      expect(calls).toBe(7);
      expect(stats.attempts).toBe(7);
    }
  });

  it('a read-only cache never writes, not even to repair a torn last line, and refuses put', () => {
    const path = join(dir(), 'cache.jsonl');
    new EmbeddingCache(path, 2).put('h1', unit(2, 0), 1);
    appendFileSync(path, '{"h":"h2","t":1,"v":"AAA');
    const before = readFileSync(path);
    const ro = new EmbeddingCache(path, 2, { readOnly: true });
    expect(ro.size).toBe(1);
    expect(ro.skippedLines).toBe(1);
    expect(() => ro.put('h3', unit(2, 1), 1)).toThrow(/read-only/);
    expect(readFileSync(path).equals(before)).toBe(true);
  });

  it('the cache lock is exclusive, fails fast for a second run, and is released by its holder', () => {
    const path = join(dir(), 'cache.jsonl');
    const release = acquireCacheLock(path);
    expect(existsSync(cacheLockPath(path))).toBe(true);
    expect(JSON.parse(readFileSync(cacheLockPath(path), 'utf8'))).toMatchObject({ pid: process.pid });
    expect(() => acquireCacheLock(path)).toThrow(/locked by another embed run/);
    release();
    release(); // idempotent
    expect(existsSync(cacheLockPath(path))).toBe(false);
    acquireCacheLock(path)();
  });

  it('a stale lock from a dead process is reported with instructions, not removed', () => {
    const path = join(dir(), 'cache.jsonl');
    writeFileSync(cacheLockPath(path), JSON.stringify({ pid: 2 ** 22 + 12345, host: hostname(), startedAt: '2026-01-01T00:00:00Z' }));
    expect(() => acquireCacheLock(path)).toThrow(/no longer running.*delete/s);
    expect(existsSync(cacheLockPath(path))).toBe(true);
  });

  it('sums logged embed runs per model', () => {
    const run = (modelId: string, startedAt: string, attempts: number) =>
      JSON.stringify({ modelId, dimensions: 4, startedAt, endedAt: startedAt, outcome: 'completed', attempts, successfulCalls: attempts - 1, billedInputTokens: 10, failures: 0, cacheHits: 0 });
    const log = [run('m', '2026-10-02T00:00:00Z', 5), run('other', '2026-01-01T00:00:00Z', 9), '{torn', run('m', '2026-10-01T00:00:00Z', 3)].join('\n');
    expect(sumEmbedRuns(log, 'm')).toEqual({ runs: 2, since: '2026-10-01T00:00:00Z', attempts: 8, successfulCalls: 6, billedInputTokens: 20, failures: 0 });
    expect(sumEmbedRuns(log, 'none')).toBeNull();
  });

  it('rate limiter waits once the minute’s budget is spent', async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new TokenRateLimiter(100, () => now, async (ms) => {
      waits.push(ms);
      now += ms;
    });
    await limiter.acquire(60);
    await limiter.acquire(30);
    expect(waits).toEqual([]);
    await limiter.acquire(30); // 120 > 100 → wait for the window to roll
    expect(waits.length).toBe(1);
    expect(now).toBeGreaterThanOrEqual(60_000);
  });
});

const chunk = (over: Partial<Chunk>): Chunk => ({
  chunkId: 'X', documentId: 'D1', company: 'Co', ticker: 'TST', cik: '1', sector: 'Industrials', filingType: '10-K',
  filingDate: '2025-01-01', periodEnd: '2024-12-31', fiscalYear: 2024, fiscalQuarter: null, fiscalLabel: 'FY2024',
  calendarQuarter: null, section: 'Item 1A — Risk Factors', sectionCode: '1A', sectionKind: 'risk_factors', subsection: null,
  boilerplate: false, sourceFile: 'f', chunkIndex: 0, charStart: 0, charEnd: 4, text: 'text', ...over,
});

describe('adjacency', () => {
  it('links each chunk to the closest same-section passages of the previous and next comparable filing', () => {
    const chunks = [
      chunk({ chunkId: 'A-FY2023-1', documentId: 'D23', periodEnd: '2023-12-31', fiscalLabel: 'FY2023' }),
      chunk({ chunkId: 'A-FY2024-1', documentId: 'D24', periodEnd: '2024-12-31' }),
      chunk({ chunkId: 'A-FY2024-2', documentId: 'D24', periodEnd: '2024-12-31' }),
      chunk({ chunkId: 'A-FY2024-MDA', documentId: 'D24', periodEnd: '2024-12-31', sectionKind: 'mda', sectionCode: 'MDA' }),
      chunk({ chunkId: 'A-FY2025-1', documentId: 'D25', periodEnd: '2025-12-31', fiscalLabel: 'FY2025' }),
      chunk({ chunkId: 'A-Q-1', documentId: 'Q1', filingType: '10-Q', periodEnd: '2025-03-31', fiscalLabel: 'FY2025Q1' }),
    ];
    const dims = 4;
    const vectors = new Float32Array(chunks.length * dims);
    [unit(4, 0), unit(4, 0, 0.1), unit(4, 2), unit(4, 0), unit(4, 2, 0.1), unit(4, 0)].forEach((v, i) => vectors.set(v, i * dims));
    const adj = computeAdjacency(chunks, vectors, dims).get('TST')!;
    expect(adj['A-FY2024-1']!.previous!.matches.map((m) => m.chunkId)).toEqual(['A-FY2023-1']);
    expect(adj['A-FY2025-1']!.previous!.matches.map((m) => m.chunkId)).toEqual(['A-FY2024-2', 'A-FY2024-1']);
    expect(adj['A-FY2025-1']!.next).toBeNull();
    // The 10-Q is never compared with a 10-K, and MD&A never with Risk Factors.
    expect(adj['A-Q-1']).toEqual({ previous: null, next: null, sameQuarterPriorYear: null });
    expect(adj['A-FY2024-MDA']!.previous!.matches).toEqual([]);
    expect(adj['A-FY2025-1']!.sameQuarterPriorYear).toBeNull();
  });

  it('10-Qs: previous is the adjacent 10-Q; sameQuarterPriorYear is the same fiscal quarter one fiscal year earlier', () => {
    const q = (id: string, fy: number, fq: number, periodEnd: string) =>
      chunk({ chunkId: id, documentId: `D-${id}`, filingType: '10-Q', fiscalYear: fy, fiscalQuarter: fq, periodEnd, fiscalLabel: `FY${fy}Q${fq}` });
    const chunks = [q('Q1-24', 2024, 1, '2024-03-31'), q('Q3-24', 2024, 3, '2024-09-30'), q('Q1-25', 2025, 1, '2025-03-31'), q('Q2-25', 2025, 2, '2025-06-30')];
    const vectors = new Float32Array(chunks.length * 4);
    chunks.forEach((_, i) => vectors.set(unit(4, 0), i * 4));
    const adj = computeAdjacency(chunks, vectors, 4).get('TST')!;
    // Q1 2025's adjacent 10-Q is Q3 2024 (there is no Q4 10-Q); year over year it is Q1 2024.
    expect(adj['Q1-25']!.previous!.documentId).toBe('D-Q3-24');
    expect(adj['Q1-25']!.sameQuarterPriorYear!.documentId).toBe('D-Q1-24');
    expect(adj['Q1-25']!.sameQuarterPriorYear!.matches.map((m) => m.chunkId)).toEqual(['Q1-24']);
    // Q2 2024 is not in the corpus.
    expect(adj['Q2-25']!.sameQuarterPriorYear).toBeNull();
    expect(adj['Q1-24']!.sameQuarterPriorYear).toBeNull();
  });
});

describe('index format, validation and summary', () => {
  function build(): { dir: string; chunks: Chunk[]; report: IngestReport } {
    const dir = mkdtempSync(join(tmpdir(), 'diq-index-'));
    const chunks = [chunk({ chunkId: 'A', text: 'apple risk' , charEnd: 10}), chunk({ chunkId: 'B', sectionKind: 'mda', sectionCode: 'MDA', text: 'cloud', charEnd: 5 })];
    const vectors = new Float32Array(8);
    vectors.set(unit(4, 0), 0);
    vectors.set(unit(4, 1), 4);
    const { meta, postings } = buildBm25(chunks.map((c) => c.text), 't1');
    writeFileSync(join(dir, ARTIFACTS.chunks), `${chunks.map((c) => JSON.stringify(c)).join('\n')}\n`);
    writeFileSync(join(dir, ARTIFACTS.vectors), Buffer.from(vectors.buffer));
    writeFileSync(join(dir, ARTIFACTS.bm25), JSON.stringify(meta));
    writeFileSync(join(dir, ARTIFACTS.bm25Postings), postings);
    const artifacts: IndexManifest['artifacts'] = {};
    for (const name of [ARTIFACTS.chunks, ARTIFACTS.vectors, ARTIFACTS.bm25, ARTIFACTS.bm25Postings]) {
      const buf = readFileSync(join(dir, name));
      artifacts[name] = { bytes: buf.byteLength, sha256: createHash('sha256').update(buf).digest('hex') };
    }
    const manifest = { indexVersion: 'iv-test', embedding: { dimensions: 4 }, counts: { chunks: 2 }, artifacts } as unknown as IndexManifest;
    writeFileSync(join(dir, ARTIFACTS.manifest), JSON.stringify(manifest));
    const report: IngestReport = {
      corpusPath: '/c', corpusHash: 'abc', indexVersion: 'iv-test', license: null, documents: 1, chunks: 2,
      filings: [{ documentId: 'D1', ticker: 'TST', filingType: '10-K', fiscalLabel: 'FY2024', periodEnd: '2024-12-31', periodSource: 'header',
        sections: [{ kind: 'risk_factors', code: '1A', anchor: 'item', chars: 10 }], chunks: 2, boilerplateChunks: 0 }],
      coverage: [{ ticker: 'TST', company: 'Co', sector: 'Industrials', tier: 'limited_history', filings: 1, tenK: 1, tenQ: 0, annualPeriods: [], quarterlyPeriods: [],
        latestAnnualPeriodEnd: '2024-12-31', fiscalYearEnd: '2024-12-31', outsideReviewWindow: false }],
    };
    return { dir, chunks, report };
  }

  it('loads, times the cold load, and validates clean', async () => {
    const { dir, report } = build();
    const index = await loadIndex(async (name) => readFileSync(join(dir, name)));
    expect(index.chunks.map((c) => c.chunkId)).toEqual(['A', 'B']);
    expect(index.timingsMs.total).toBeGreaterThanOrEqual(0);
    expect(index.timingsMs['verify:artifacts']).toBeGreaterThanOrEqual(0);
    expect(validateIndex(index, report, new Map())).toEqual([]);
    const scores = cosineScores(index, unit(4, 1));
    expect(scores[1]).toBeCloseTo(1);
  });

  it('verifies every cold-load artifact against the manifest: one tampered byte or a missing hash throws', async () => {
    for (const name of [ARTIFACTS.chunks, ARTIFACTS.vectors, ARTIFACTS.bm25, ARTIFACTS.bm25Postings]) {
      const { dir } = build();
      const buf = readFileSync(join(dir, name));
      buf[buf.byteLength - 2] = buf[buf.byteLength - 2]! ^ 0x01;
      writeFileSync(join(dir, name), buf);
      await expect(loadIndex(async (n) => readFileSync(join(dir, n))), name).rejects.toThrow(/sha256/);
    }
    const { dir } = build();
    appendFileSync(join(dir, ARTIFACTS.chunks), '\n');
    await expect(loadIndex(async (n) => readFileSync(join(dir, n)))).rejects.toThrow(/bytes/);
    const fresh = build().dir;
    const m = JSON.parse(readFileSync(join(fresh, ARTIFACTS.manifest), 'utf8')) as IndexManifest;
    delete m.artifacts[ARTIFACTS.vectors];
    writeFileSync(join(fresh, ARTIFACTS.manifest), JSON.stringify(m));
    await expect(loadIndex(async (n) => readFileSync(join(fresh, n)))).rejects.toThrow(/no hash for vectors\.bin/);
  });

  it('reports bad vectors, oversize chunks and foreign adjacency', async () => {
    const { dir, report } = build();
    const index = await loadIndex(async (name) => readFileSync(join(dir, name)));
    const broken: LoadedIndex = { ...index, vectors: new Float32Array(8), chunks: [{ ...index.chunks[0]!, text: 'x'.repeat(7_000), charEnd: 7_000 }, index.chunks[1]!] };
    const problems = validateIndex(broken, report, new Map([['TST', { A: { previous: null, next: null, sameQuarterPriorYear: { documentId: 'D1', fiscalLabel: 'FY2024', periodEnd: '', matches: [{ chunkId: 'B', score: 1 }] } } }]]));
    expect(problems.some((p) => /norm/.test(p))).toBe(true);
    expect(problems.some((p) => /exceeds/.test(p))).toBe(true);
    expect(problems.some((p) => /same company, section/.test(p))).toBe(true);
  });

  it('rejects a vectors file of the wrong size and parses chunks.jsonl', () => {
    expect(() => vectorsFromBuffer(Buffer.alloc(10), 4)).toThrow(/multiple/);
    expect(parseChunks(Buffer.from('{"chunkId":"A"}\n\n{"chunkId":"B"}\n')).map((c) => c.chunkId)).toEqual(['A', 'B']);
  });

  it('summarizes documents, chunks, companies, fiscal years, filing types and sections', () => {
    const { chunks, report } = build();
    const s = buildSummary(report, chunks);
    expect(s).toMatchObject({ documents: 1, chunks: 2, filingTypes: { '10-K': { documents: 1, chunks: 2 } }, fiscalYears: { FY2024: { documents: 1, chunks: 2 } } });
    expect(s.sectionGaps).toEqual([{ documentId: 'D1', gaps: [{ kind: 'risk_factors', reason: 'stub', chars: 10 }, { kind: 'mda', reason: 'missing', chars: 0 }, { kind: 'financial_statements', reason: 'missing', chars: 0 }] }]);
    expect(formatSummary(s)).toContain('documents 1, chunks 2, companies 1');
  });
});

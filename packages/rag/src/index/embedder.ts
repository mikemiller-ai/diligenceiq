import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { hostname } from 'node:os';

/**
 * Offline document embedding (SPEC §24.5; architecture §6.4):
 * - cached by sha256(embedded text + model id), so re-chunking embeds only changed chunks;
 * - the cache file is append-only and is the checkpoint: an interrupted run resumes by
 *   skipping every hash already in it (a torn last line is ignored);
 * - rate-limited to the model's token quota with a sliding one-minute window; every attempt,
 *   retries included, acquires the limiter;
 * - one writer at a time: a live run holds an exclusive lock file next to the cache
 *   (`acquireCacheLock`); dry runs and `index:build` open the cache read-only and never write;
 * - never run on deploy or per request.
 *
 * Cache line: {"h":"<sha256>","t":<input tokens>,"v":"<base64 Float32 vector>"}
 */
export interface EmbedResult {
  vector: Float32Array;
  inputTokens: number;
}

export type EmbedOne = (text: string) => Promise<EmbedResult>;

export function embeddingHash(text: string, modelId: string): string {
  return createHash('sha256').update(modelId).update('\u0000').update(text).digest('hex');
}

export interface EmbeddingCacheOptions {
  /** Never write the file: no torn-line repair, and `put` throws. For dry runs and index builds. */
  readOnly?: boolean;
}

export class EmbeddingCache {
  private readonly entries = new Map<string, Float32Array>();
  private readonly tokenCounts = new Map<string, number>();
  /** Lines that could not be parsed (an interrupted final write, or one still being written). */
  readonly skippedLines: number;
  readonly readOnly: boolean;

  /**
   * A writable cache must only be opened while holding `acquireCacheLock(path)`: it repairs a
   * torn final line by appending a newline, which would corrupt a line another process is
   * still writing.
   */
  constructor(
    private readonly path: string,
    readonly dims: number,
    options: EmbeddingCacheOptions = {},
  ) {
    this.readOnly = options.readOnly ?? false;
    let skipped = 0;
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      // Terminate a torn final line so the next append starts on a line of its own.
      if (!this.readOnly && content.length && !content.endsWith('\n')) appendFileSync(path, '\n');
      for (const line of content.split('\n')) {
        if (!line) continue;
        try {
          const row = JSON.parse(line) as { h: string; t: number; v: string };
          const buf = Buffer.from(row.v, 'base64');
          if (buf.byteLength !== dims * 4) throw new Error('dims');
          const vec = new Float32Array(dims);
          vec.set(new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
          this.entries.set(row.h, vec);
          this.tokenCounts.set(row.h, row.t);
        } catch {
          skipped++;
        }
      }
    }
    this.skippedLines = skipped;
  }

  get size(): number {
    return this.entries.size;
  }

  get(hash: string): Float32Array | undefined {
    return this.entries.get(hash);
  }

  /** Input tokens the model reported when this vector was embedded. */
  tokens(hash: string): number | undefined {
    return this.tokenCounts.get(hash);
  }

  put(hash: string, vector: Float32Array, inputTokens: number): void {
    if (this.readOnly) throw new Error(`embedding cache ${this.path} is open read-only`);
    if (vector.length !== this.dims) throw new Error(`embedding has ${vector.length} dims, expected ${this.dims}`);
    this.entries.set(hash, vector);
    this.tokenCounts.set(hash, inputTokens);
    const v = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
    appendFileSync(this.path, `${JSON.stringify({ h: hash, t: inputTokens, v })}\n`);
  }
}

export interface CacheLockInfo {
  pid: number;
  host: string;
  startedAt: string;
}

export function cacheLockPath(cachePath: string): string {
  return `${cachePath}.lock`;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the exclusive writer lock for an embedding cache (`<cache>.lock`, created with `wx`,
 * holding pid, host and start time) so two live embed runs cannot double-spend or interleave
 * writes. Fails fast if the lock exists. A stale lock (its pid no longer running on this host)
 * is NOT removed automatically: the error says so and tells the operator to delete the file
 * after confirming no embed run is active, because a lock from another host or a reused pid
 * cannot be judged safely. Returns an idempotent release function that removes the lock only
 * if it is still ours; callers release it on exit, on SIGINT/SIGTERM and on error.
 */
export function acquireCacheLock(cachePath: string, now: () => Date = () => new Date()): () => void {
  const lock = cacheLockPath(cachePath);
  const info: CacheLockInfo = { pid: process.pid, host: hostname(), startedAt: now().toISOString() };
  const body = JSON.stringify(info);
  let fd: number;
  try {
    fd = openSync(lock, 'wx');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    let holder: Partial<CacheLockInfo> = {};
    try {
      holder = JSON.parse(readFileSync(lock, 'utf8')) as CacheLockInfo;
    } catch {
      // unreadable lock: report it as is
    }
    const sameHost = holder.host === info.host;
    const stale = sameHost && typeof holder.pid === 'number' && !pidAlive(holder.pid);
    throw new Error(
      stale
        ? `embedding cache is locked by ${lock} (pid ${holder.pid}, started ${holder.startedAt}), and that process is no longer running. ` +
            `If no embed run is active, delete ${lock} and retry.`
        : `embedding cache is locked by another embed run (pid ${holder.pid ?? '?'} on ${holder.host ?? '?'}, started ${holder.startedAt ?? '?'}; ${lock}). ` +
            'Wait for it to finish; never run two embed runs at once.',
      { cause: e },
    );
  }
  writeSync(fd, body);
  closeSync(fd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      if (readFileSync(lock, 'utf8') === body) unlinkSync(lock);
    } catch {
      // already gone
    }
  };
}

/** Sliding-window token limiter: waits until the last minute's spend plus `tokens` fits. */
export class TokenRateLimiter {
  private readonly spent: Array<{ at: number; tokens: number }> = [];
  constructor(
    private readonly tokensPerMinute: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  private used(at: number): number {
    while (this.spent.length && at - this.spent[0]!.at >= 60_000) this.spent.shift();
    return this.spent.reduce((a, s) => a + s.tokens, 0);
  }

  async acquire(tokens: number): Promise<void> {
    const need = Math.min(tokens, this.tokensPerMinute);
    for (;;) {
      const t = this.now();
      if (this.used(t) + need <= this.tokensPerMinute) {
        this.spent.push({ at: t, tokens: need });
        return;
      }
      await this.sleep(Math.max(50, 60_000 - (t - this.spent[0]!.at)));
    }
  }

  /** Correct an estimate with the model's reported token count. */
  adjust(estimated: number, actual: number): void {
    this.spent.push({ at: this.now(), tokens: Math.max(0, actual - estimated) });
  }
}

export interface EmbedAllStats {
  total: number;
  /** Texts already cached, or duplicates of another text in this run. */
  cacheHits: number;
  /** Model calls made, failed ones and retries included. */
  attempts: number;
  /** Calls that returned a vector (each written to the cache). */
  successfulCalls: number;
  /** Input tokens the model reported on successful calls. */
  billedInputTokens: number;
  /** Texts given up on (non-retryable error or retries exhausted). */
  failures: number;
}

export interface EmbedAllOptions {
  modelId: string;
  embedOne: EmbedOne;
  cache: EmbeddingCache;
  limiter: TokenRateLimiter;
  concurrency: number;
  /** Characters per token for the pre-call estimate (Titan v2 averages ~4 on this corpus). */
  charsPerToken?: number;
  /** Hard cap on model calls (attempts, retries included) for smoke runs. Never exceeded at any concurrency. */
  maxCalls?: number;
  onProgress?: (s: EmbedAllStats) => void;
  /** Retries per text for throttling and transient errors; never for validation errors. */
  retries?: number;
  isRetryable?: (e: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Stats object to fill in place, so a caller can still log a run that throws or is interrupted. */
  stats?: EmbedAllStats;
}

export function emptyEmbedStats(total = 0): EmbedAllStats {
  return { total, cacheHits: 0, attempts: 0, successfulCalls: 0, billedInputTokens: 0, failures: 0 };
}

/** Embed every text not already cached. Returns per-run statistics. */
export async function embedAll(texts: readonly string[], o: EmbedAllOptions): Promise<EmbedAllStats> {
  const stats = o.stats ?? emptyEmbedStats();
  Object.assign(stats, emptyEmbedStats(texts.length));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const todo: Array<{ text: string; hash: string }> = [];
  const seen = new Set<string>();
  for (const text of texts) {
    const hash = embeddingHash(text, o.modelId);
    if (o.cache.get(hash) || seen.has(hash)) {
      stats.cacheHits++;
      continue;
    }
    seen.add(hash);
    todo.push({ text, hash });
  }
  // Slots are reserved synchronously before any await, so concurrent workers can never
  // exceed maxCalls between checking the budget and making the call.
  let reserved = 0;
  const reserve = (): boolean => {
    if (o.maxCalls !== undefined && reserved >= o.maxCalls) return false;
    reserved++;
    return true;
  };
  let next = 0;
  // After one text fails for good, the other workers stop instead of spending more calls.
  let stopped = false;
  const worker = async () => {
    for (;;) {
      if (stopped || (o.maxCalls !== undefined && reserved >= o.maxCalls)) return;
      const item = todo[next++];
      if (!item) return;
      const estimate = Math.ceil(item.text.length / (o.charsPerToken ?? 4));
      for (let attempt = 0; ; attempt++) {
        if (stopped || !reserve()) return;
        // Every attempt, retries included, spends quota, so every attempt acquires the limiter.
        await o.limiter.acquire(estimate);
        try {
          stats.attempts++;
          const r = await o.embedOne(item.text);
          o.limiter.adjust(estimate, r.inputTokens);
          stats.successfulCalls++;
          stats.billedInputTokens += r.inputTokens;
          o.cache.put(item.hash, r.vector, r.inputTokens);
          break;
        } catch (e) {
          if (attempt >= (o.retries ?? 5) || !(o.isRetryable?.(e) ?? false)) {
            stats.failures++;
            stopped = true;
            throw e;
          }
          await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
        }
      }
      o.onProgress?.(stats);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, worker));
  return stats;
}

/** One line of the embed run log (`.index/cache/embed-runs.jsonl`), appended by every live run. */
export interface EmbedRunRecord {
  modelId: string;
  dimensions: number;
  startedAt: string;
  endedAt: string;
  /** How the run ended: finished, stopped by maxCalls, interrupted by a signal, or failed. */
  outcome: 'completed' | 'max-calls' | 'interrupted' | 'failed';
  attempts: number;
  successfulCalls: number;
  billedInputTokens: number;
  failures: number;
  cacheHits: number;
}

/** Sums the logged runs for one model (unparseable lines are ignored). Null when none is logged. */
export function sumEmbedRuns(log: string, modelId: string): { runs: number; since: string; attempts: number; successfulCalls: number; billedInputTokens: number; failures: number } | null {
  let out: { runs: number; since: string; attempts: number; successfulCalls: number; billedInputTokens: number; failures: number } | null = null;
  for (const line of log.split('\n')) {
    if (!line) continue;
    let r: EmbedRunRecord;
    try {
      r = JSON.parse(line) as EmbedRunRecord;
    } catch {
      continue;
    }
    if (r.modelId !== modelId) continue;
    out ??= { runs: 0, since: r.startedAt, attempts: 0, successfulCalls: 0, billedInputTokens: 0, failures: 0 };
    out.runs++;
    if (r.startedAt < out.since) out.since = r.startedAt;
    out.attempts += r.attempts;
    out.successfulCalls += r.successfulCalls;
    out.billedInputTokens += r.billedInputTokens;
    out.failures += r.failures;
  }
  return out;
}

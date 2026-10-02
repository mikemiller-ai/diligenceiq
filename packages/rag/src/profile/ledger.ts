/*
 * The append-only build ledger (SPEC §32.4, DD-16). One object per
 * (indexVersion, profilePromptVersion, ticker), created with a conditional write BEFORE the
 * generation call. If it already exists, no call is made for that key, from this process or any
 * other. Append-only by convention: the code only ever creates objects conditionally and never
 * overwrites or deletes them (the S3 bucket is unversioned and has no Object Lock, so this is not
 * enforced by storage). There is no --force. A new profilePromptVersion (a real prompt change)
 * is a new key.
 *
 * Next to each entry the builder stores the call's outcome (also created once): the raw tool
 * input or the error, tokens, the SOURCE_IDs that were supplied and, from validator version 2,
 * `promptSha256` (the exact request). A later run recomputes the request deterministically and
 * re-validates the stored output for free instead of calling again; if the recomputed request no
 * longer hashes the same, the outcome is stale and the company falls back (no call). An entry
 * without an outcome is an interrupted call, counted as spent, unless the builder kept a local
 * copy of the outcome (`LocalOutcomeStore`) because recording it in the ledger failed.
 *
 * The production ledger is S3 (scripts/lib/profile-ledger.ts:
 * intelligence/ledger/<indexVersion>/<profilePromptVersion>/<TICKER>.json and
 * <TICKER>.outcome.json, If-None-Match: *). `MemoryLedger` is for tests.
 */

export interface LedgerEntry {
  ticker: string;
  indexVersion: string;
  profilePromptVersion: string;
  startedAt: string;
  runId: string;
}

export interface LedgerOutcome {
  ticker: string;
  runId: string;
  finishedAt: string;
  modelId: string;
  /** The forced tool's input as returned, or null (error, or no tool call). */
  toolInput: unknown;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  /** Set when the call itself failed (throttle, timeout, Bedrock error). */
  error: string | null;
  /** The SOURCE_IDs in the message, as recorded (telemetry: re-validation recomputes them from the message). */
  suppliedIds: string[];
  /**
   * sha256 of the exact request (system prompt, user message, tool JSON, settings;
   * `profileRequestSha256`). Absent on outcomes recorded before it existed (the llm-v3 calls),
   * whose request can therefore not be verified by hash.
   */
  promptSha256?: string;
}

/**
 * A local copy of each outcome, written BEFORE it is recorded in the ledger, so a failed ledger
 * write never loses a paid call (the CLI keeps them in .index/cache/profile-outcomes/).
 */
export interface LocalOutcomeStore {
  read(ticker: string): Promise<LedgerOutcome | null>;
  write(outcome: LedgerOutcome): Promise<void>;
}

export interface ProfileLedger {
  readonly indexVersion: string;
  readonly profilePromptVersion: string;
  /** Conditional create of the entry. 'exists' means a call was already spent for this key: make no call. */
  claim(entry: LedgerEntry): Promise<'claimed' | 'exists'>;
  /** Tickers with an entry (a spent call, finished or interrupted). */
  spent(): Promise<Set<string>>;
  entry(ticker: string): Promise<LedgerEntry | null>;
  /** Immutable; recording a second outcome for a ticker throws. */
  recordOutcome(outcome: LedgerOutcome): Promise<void>;
  outcome(ticker: string): Promise<LedgerOutcome | null>;
}

export class LedgerExistsError extends Error {
  constructor(ticker: string) {
    super(`ledger: a generation call was already spent for ${ticker} at this index and prompt version; no call made`);
    this.name = 'LedgerExistsError';
  }
}

/** The ledger write itself failed (not a conflict): the claim is unknown, so no call is made. */
export class LedgerClaimError extends Error {
  constructor(ticker: string, cause: unknown) {
    super(`ledger: claiming ${ticker} failed (${(cause as Error)?.message ?? String(cause)}); no call made`);
    this.name = 'LedgerClaimError';
  }
}

/** In-memory ledger with the same semantics, for tests. Share one instance to simulate several processes. */
export class MemoryLedger implements ProfileLedger {
  readonly entries = new Map<string, LedgerEntry>();
  readonly outcomes = new Map<string, LedgerOutcome>();
  constructor(
    readonly indexVersion: string,
    readonly profilePromptVersion: string,
  ) {}
  async claim(entry: LedgerEntry): Promise<'claimed' | 'exists'> {
    if (this.entries.has(entry.ticker)) return 'exists';
    this.entries.set(entry.ticker, entry);
    return 'claimed';
  }
  async spent(): Promise<Set<string>> {
    return new Set(this.entries.keys());
  }
  async entry(ticker: string): Promise<LedgerEntry | null> {
    return this.entries.get(ticker) ?? null;
  }
  async recordOutcome(outcome: LedgerOutcome): Promise<void> {
    if (this.outcomes.has(outcome.ticker)) throw new Error(`ledger: outcome for ${outcome.ticker} already recorded`);
    this.outcomes.set(outcome.ticker, outcome);
  }
  async outcome(ticker: string): Promise<LedgerOutcome | null> {
    return this.outcomes.get(ticker) ?? null;
  }
}

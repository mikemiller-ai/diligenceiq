import type { CompanyIntelligenceProfile, ProfileSetManifest } from '@diligenceiq/core';
import { CompanyIntelligenceProfileSchema } from '@diligenceiq/core';
import { GenerationGateway, type GenerationClient } from '../generation/gateway';
import type { ChunkRecord } from '../index/format';
import type { Retriever } from '../retrieval/retrieve';
import { assembleDeterministicProfile, deterministicSetId, type ProfileExtraction } from './assemble';
import { selectProfileEvidence } from './evidence';
import { LedgerClaimError, LedgerExistsError, type LedgerOutcome, type LocalOutcomeStore, type ProfileLedger } from './ledger';
import { TEMPLATE_VERSION } from './library';
import {
  PROFILE_GENERATION_SETTINGS,
  PROFILE_PROMPT_VERSION,
  PROFILE_SYSTEM_PROMPT,
  PROFILE_TOOL,
  buildProfileUserMessage,
  llmSetId,
  profileRequestSha256,
  profileSuppliedIds,
} from './prompt';
import { PROFILE_VALIDATOR_VERSION, mergeProfile, validateProfileOutput, type ProfileFailure, type ProfileSupplied, type ProfileValidation } from './validate';

/*
 * The offline profile build (SPEC §32; DD-16; architecture §4.4). Admin-run from
 * scripts/intelligence/build-profiles.ts, never deployed or scheduled. Everything that touches
 * the outside world is injected (ledger, model client, writer) so the rules are tested here:
 *   - the deterministic set is always built, with zero calls;
 *   - the LLM set makes at most one call per company per (indexVersion, profilePromptVersion):
 *     the ledger entry is created before the call, and an existing entry means no call;
 *   - --max-calls stops the calling (companies past the cap get their deterministic profile);
 *   - a failed or invalid call falls back to the deterministic profile with generationCallCount 1,
 *     and is never retried at the same version;
 *   - a stored outcome from an earlier run is re-validated for free, against the request
 *     recomputed deterministically (evidence + user message); if the outcome carries a request
 *     hash that no longer matches, it is stale and the company falls back (no call);
 *   - a claim that errors (not a conflict) makes no call and records nothing ('ledger_error');
 *   - an outcome is kept locally before it is recorded, and a failed ledger write never stops the run.
 */

export interface BuildCompany {
  extraction: ProfileExtraction;
  chunks: readonly ChunkRecord[];
}

export type ProfileOutcomeCode = ProfileFailure | 'generation_error' | 'interrupted' | 'ledger_race' | 'ledger_error' | 'stale_outcome' | 'max_calls_reached';

export interface ManifestCompany {
  ticker: string;
  company: string;
  sector: string;
  tier: CompanyIntelligenceProfile['coverage']['tier'];
  filings: number;
  periodsCovered: string[];
  headline?: string;
  mode: 'llm' | 'deterministic';
  generationCallCount: 0 | 1;
  /** Telemetry (the api ignores unknown manifest fields). */
  failure?: ProfileOutcomeCode;
  issues?: string[];
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  ledgerRunId?: string;
  reusedOutcome?: boolean;
  /**
   * LLM set, companies with an outcome: true when the outcome's request hash matches the request
   * recomputed now; false when the outcome has no hash (recorded before hashing existed: llm-v3).
   */
  promptVerified?: boolean;
  validation: { invalidCitations: number; unsupportedFigures: number; bannedPhrases: number };
  signals: number;
  facts: number;
}

export interface SetManifest extends ProfileSetManifest {
  companies: ManifestCompany[];
  templateVersion: string;
  /** The validator rules this set was checked with (validate.ts). */
  validatorVersion: string;
  profilePromptVersion?: string;
  /** The S3 bucket holding the build ledger (LLM builds). */
  ledgerBucket?: string;
  runId: string;
  totals: { companies: number; llm: number; deterministic: number; generationCalls: number; inputTokens: number; outputTokens: number; deepTierFallbackRate: number | null };
}

export interface BuildOptions {
  indexVersion: string;
  builtAt: string;
  runId: string;
  companies: readonly BuildCompany[];
  chunk: (id: string) => ChunkRecord | undefined;
  retriever: Pick<Retriever, 'retrieve'>;
  /** Build the LLM set as well as the deterministic set. */
  llm: boolean;
  /** Required: the run stops calling the model at this many calls (0 is a free run that reuses stored outcomes only). */
  maxCalls: number;
  ledger?: ProfileLedger;
  /** Recorded in the manifest: where the ledger lives. */
  ledgerBucket?: string;
  client?: GenerationClient;
  /** Local copies of outcomes (written before the ledger write; read when the ledger has an entry but no outcome). */
  localOutcomes?: LocalOutcomeStore;
  /** Abort the one request after this long (default 300 s). */
  requestTimeoutMs?: number;
  write: (setId: string, name: string, body: unknown) => Promise<void>;
  log?: (message: string) => void;
  now?: () => string;
}

export interface BuildResult {
  det: SetManifest;
  llm: SetManifest | null;
  callsMade: number;
}

const ZERO = { invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 };

function manifestCompany(p: CompanyIntelligenceProfile, extra: Partial<ManifestCompany> = {}): ManifestCompany {
  return {
    ticker: p.ticker,
    company: p.company,
    sector: p.sector,
    tier: p.coverage.tier,
    filings: p.coverage.filings,
    periodsCovered: p.version.periodsCovered,
    mode: p.generation.mode,
    generationCallCount: p.generation.generationCallCount,
    validation: p.generation.validation,
    signals: p.signals.length,
    facts: p.facts.length,
    ...extra,
  };
}

function manifest(indexVersion: string, profileSetId: string, builtAt: string, runId: string, companies: ManifestCompany[], promptVersion?: string, ledgerBucket?: string): SetManifest {
  const deep = companies.filter((c) => c.tier === 'deep');
  return {
    indexVersion,
    profileSetId,
    builtAt,
    runId,
    templateVersion: TEMPLATE_VERSION,
    validatorVersion: PROFILE_VALIDATOR_VERSION,
    ...(promptVersion ? { profilePromptVersion: promptVersion } : {}),
    ...(ledgerBucket ? { ledgerBucket } : {}),
    companies,
    totals: {
      companies: companies.length,
      llm: companies.filter((c) => c.mode === 'llm').length,
      deterministic: companies.filter((c) => c.mode === 'deterministic').length,
      generationCalls: companies.reduce((n, c) => n + c.generationCallCount, 0),
      inputTokens: companies.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
      outputTokens: companies.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
      deepTierFallbackRate: promptVersion && deep.length ? deep.filter((c) => c.mode === 'deterministic').length / deep.length : null,
    },
  };
}

/** The deterministic profile, relabeled into the LLM set as its fallback. */
export function fallbackProfile(det: CompanyIntelligenceProfile, setId: string, callCount: 0 | 1, ledgerRunId?: string): CompanyIntelligenceProfile {
  return CompanyIntelligenceProfileSchema.parse({
    ...det,
    version: { ...det.version, profileSetId: setId, profilePromptVersion: PROFILE_PROMPT_VERSION },
    generation: { mode: 'deterministic', generationCallCount: callCount, ...(ledgerRunId ? { ledgerRunId } : {}), validation: ZERO },
  });
}

export async function buildProfileSets(o: BuildOptions): Promise<BuildResult> {
  if (!Number.isInteger(o.maxCalls) || o.maxCalls < 0) throw new Error('buildProfileSets: maxCalls is required (a non-negative integer)');
  if (o.llm && (!o.ledger || !o.client)) throw new Error('buildProfileSets: the LLM set needs a ledger and a model client');
  if (o.ledger && (o.ledger.indexVersion !== o.indexVersion || o.ledger.profilePromptVersion !== PROFILE_PROMPT_VERSION)) {
    throw new Error(`buildProfileSets: ledger is for ${o.ledger.indexVersion}/${o.ledger.profilePromptVersion}, build is ${o.indexVersion}/${PROFILE_PROMPT_VERSION}`);
  }
  const log = o.log ?? (() => {});
  const now = o.now ?? (() => new Date().toISOString());
  const detId = deterministicSetId();
  const llmId = llmSetId();
  const chunkMap = new Map<string, ChunkRecord>();
  for (const c of o.companies) for (const ch of c.chunks) chunkMap.set(ch.chunkId, ch);

  const detRows: ManifestCompany[] = [];
  const llmRows: ManifestCompany[] = [];
  const spent = o.llm ? await o.ledger!.spent() : new Set<string>();
  let callsMade = 0;

  for (const company of o.companies) {
    const det = assembleDeterministicProfile({ extraction: company.extraction, chunks: company.chunks, profileSetId: detId, builtAt: o.builtAt });
    await o.write(detId, `${det.ticker}.json`, det);
    detRows.push(manifestCompany(det));
    if (!o.llm) continue;

    const ticker = det.ticker;
    const lookup = (id: string) => chunkMap.get(id) ?? o.chunk(id);
    const writeFallback = async (code: ProfileOutcomeCode, callCount: 0 | 1, extra: Partial<ManifestCompany> = {}) => {
      const fb = fallbackProfile(det, llmId, callCount, extra.ledgerRunId);
      await o.write(llmId, `${ticker}.json`, fb);
      llmRows.push(manifestCompany(fb, { failure: code, ...extra }));
      log(`${ticker}: deterministic fallback (${code})`);
    };
    // The request, recomputed deterministically: the same company, index and prompt always give
    // the same evidence, message and hash. Citations and figures are checked against THIS, never
    // against what a stored outcome says was supplied.
    const prepare = async (): Promise<{ user: string; supplied: ProfileSupplied; sha: string }> => {
      const evidence = await selectProfileEvidence(det, lookup, o.retriever);
      const user = buildProfileUserMessage(det, evidence.text);
      return { user, supplied: { suppliedIds: profileSuppliedIds(det, evidence.chunkIds), excerptIds: new Set(evidence.chunkIds) }, sha: profileRequestSha256(user) };
    };
    const finish = async (out: LedgerOutcome, reused: boolean, req: { supplied: ProfileSupplied; sha: string }) => {
      const promptVerified = out.promptSha256 !== undefined && out.promptSha256 === req.sha;
      const tele = { modelId: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, durationMs: out.durationMs, ledgerRunId: out.runId, reusedOutcome: reused, promptVerified };
      if (out.promptSha256 !== undefined && !promptVerified) {
        return writeFallback('stale_outcome', 1, { ...tele, issues: ['the stored outcome was made for a different request than the one recomputed now (evidence, message, prompt or settings changed); no new call at this version'] });
      }
      if (out.error) return writeFallback('generation_error', 1, { ...tele, issues: [out.error] });
      const { validation, output } = validateProfileOutput(out.toolInput, det, req.supplied, (id) => lookup(id)?.text);
      if (!validation.ok || !output) return writeFallback(validation.failure!, 1, { ...tele, issues: validation.issues, validation: counts(validation) });
      let merged: CompanyIntelligenceProfile;
      try {
        merged = mergeProfile(det, output, { profileSetId: llmId, profilePromptVersion: PROFILE_PROMPT_VERSION, modelId: out.modelId, ledgerRunId: out.runId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, chunks: chunkMap });
      } catch (e) {
        return writeFallback('integrity', 1, { ...tele, issues: [(e as Error).message] });
      }
      await o.write(llmId, `${ticker}.json`, merged);
      llmRows.push(manifestCompany(merged, { ...tele, headline: output.headline }));
      log(`${ticker}: llm profile${reused ? ' (stored outcome re-validated, no call)' : ''}`);
    };

    // Already spent at this version (by this or an earlier run): never call again.
    if (spent.has(ticker)) {
      const entry = await o.ledger!.entry(ticker);
      let out = await o.ledger!.outcome(ticker);
      if (!out && o.localOutcomes) {
        const local = await o.localOutcomes.read(ticker);
        // Only the copy of THIS entry's call (same run): anything else is not this key's outcome.
        if (local && entry && local.runId === entry.runId && local.ticker === ticker) {
          out = local;
          log(`${ticker}: the ledger has no outcome; using the local copy from run ${local.runId}. Backfill it into the ledger.`);
        }
      }
      if (out) await finish(out, true, await prepare());
      else await writeFallback('interrupted', 1, entry ? { ledgerRunId: entry.runId } : {});
      continue;
    }
    if (callsMade >= o.maxCalls) {
      await writeFallback('max_calls_reached', 0);
      continue;
    }

    const req = await prepare();
    const startedAt = now();
    const gateway = new GenerationGateway({
      purpose: 'profile',
      client: o.client!,
      beforeCall: async () => {
        let claimed: 'claimed' | 'exists';
        try {
          claimed = await o.ledger!.claim({ ticker, indexVersion: o.indexVersion, profilePromptVersion: PROFILE_PROMPT_VERSION, startedAt, runId: o.runId });
        } catch (e) {
          throw new LedgerClaimError(ticker, e);
        }
        if (claimed === 'exists') throw new LedgerExistsError(ticker);
        callsMade++;
      },
    });
    let out: LedgerOutcome;
    const base = { ticker, runId: o.runId, suppliedIds: [...req.supplied.suppliedIds], promptSha256: req.sha };
    try {
      const res = await gateway.generate({
        system: PROFILE_SYSTEM_PROMPT,
        user: req.user,
        tool: PROFILE_TOOL,
        ...PROFILE_GENERATION_SETTINGS,
        signal: AbortSignal.timeout(o.requestTimeoutMs ?? 300_000),
      });
      out = { ...base, finishedAt: now(), modelId: res.modelId, toolInput: res.toolInput, stopReason: res.stopReason, inputTokens: res.inputTokens, outputTokens: res.outputTokens, durationMs: res.durationMs, error: null };
    } catch (e) {
      if (e instanceof LedgerExistsError) {
        // Another process claimed it between our read and our write: it spent the call, we made none.
        await writeFallback('ledger_race', 1);
        continue;
      }
      if (e instanceof LedgerClaimError) {
        // The claim write failed: no call was made and nothing is recorded or counted.
        await writeFallback('ledger_error', 0, { issues: [e.message] });
        continue;
      }
      out = { ...base, finishedAt: now(), modelId: o.client!.modelId, toolInput: null, stopReason: null, inputTokens: 0, outputTokens: 0, durationMs: 0, error: (e as Error).message };
    }
    // Keep a local copy first: a paid call is never lost to a failed ledger write.
    if (o.localOutcomes) {
      try {
        await o.localOutcomes.write(out);
      } catch (e) {
        log(`!! ${ticker}: writing the local outcome copy failed (${(e as Error).message})`);
      }
    }
    try {
      await o.ledger!.recordOutcome(out);
    } catch (e) {
      log(`!! ${ticker}: recording the outcome in the ledger FAILED (${(e as Error).message}). ${o.localOutcomes ? 'The local copy is kept; backfill it into the ledger.' : 'No local copy is configured.'} This run uses the outcome.`);
    }
    await finish(out, false, req);
  }

  const detManifest = manifest(o.indexVersion, detId, o.builtAt, o.runId, detRows, undefined, o.ledgerBucket);
  await o.write(detId, 'manifest.json', detManifest);
  let llmManifest: SetManifest | null = null;
  if (o.llm) {
    llmManifest = manifest(o.indexVersion, llmId, o.builtAt, o.runId, llmRows, PROFILE_PROMPT_VERSION, o.ledgerBucket);
    await o.write(llmId, 'manifest.json', llmManifest);
  }
  return { det: detManifest, llm: llmManifest, callsMade };
}

function counts(v: ProfileValidation) {
  return { invalidCitations: v.invalidCitations, unsupportedFigures: v.unsupportedFigures, bannedPhrases: v.bannedPhrases };
}

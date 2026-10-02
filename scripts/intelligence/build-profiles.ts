/**
 * The offline Company Intelligence build (SPEC §32; DD-16; architecture §4.4). Admin-run on a
 * workstation, never deployed, never scheduled, never triggered by a page view.
 *
 *   pnpm intelligence:build --max-calls 0                    # deterministic set only (free, local)
 *   pnpm intelligence:build --llm --max-calls 0              # LLM set from stored outcomes only (S3 reads, free)
 *   pnpm intelligence:build --llm --max-calls 53             # dry run: what it would call and roughly cost
 *   pnpm intelligence:build --llm --max-calls 53 --yes       # Bedrock calls + ledger writes (ask first)
 *   … --tickers AAPL,MSFT                                    # a trial on a few companies (partial sets, not uploadable)
 *
 * The ledger bucket is CoreStack's DataBucket output (read-only CloudFormation lookup); a
 * --bucket that differs from it is refused unless --allow-other-bucket is passed.
 * --max-calls is required; there is no --force. Both are checked before anything is loaded.
 * A company whose ledger entry exists at this (indexVersion, profilePromptVersion) is never
 * called again: its stored outcome is re-validated for free against the recomputed request, or
 * it falls back to its deterministic profile. Each new outcome is first written to
 * .index/cache/profile-outcomes/<iv>/<pv>/<TICKER>.json, then to the ledger. Sets are written to
 * .index/intelligence/<indexVersion>/{det-v<templateVersion>,llm-v<profilePromptVersion>}/ and
 * uploaded separately with `pnpm profiles:upload-set --root .index/intelligence` (ask first);
 * switching /diligenceiq/active-profile-set is a separate `aws ssm put-parameter`.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { S3Client } from '@aws-sdk/client-s3';
import { BedrockGenerationClient, createBedrockRuntime } from '@diligenceiq/rag';
import {
  PROFILE_PROMPT_VERSION,
  buildProfileSets,
  deterministicSetId,
  llmSetId,
  type BuildCompany,
  type LedgerOutcome,
  type LocalOutcomeStore,
  type ProfileExtraction,
} from '@diligenceiq/rag/profile';
import { AWS_REGION, CACHE_DIR, EXTRACTION_DIR, INDEX_HOME, arg, fail } from '../lib/common';
import { chooseLedgerBucket, resolveDataBucket } from '../lib/data-bucket';
import { GENERATION_MODEL_ID } from '../lib/generation';
import { S3Ledger } from '../lib/profile-ledger';
import { openIndex } from '../lib/retrieval';

/** About one Sonnet profile call (≈ 20k input, 3–4k output tokens; llm-v3 averaged about $0.10), for the dry-run estimate only. */
const EST_COST_PER_CALL = 0.1;

const maxCallsArg = arg('max-calls');
if (maxCallsArg === undefined || maxCallsArg === 'true' || !/^\d+$/.test(maxCallsArg)) fail('intelligence:build: --max-calls <n> is required (0 for a free run)');
if (arg('force') !== undefined) fail('intelligence:build: there is no --force. Regenerating needs a profilePromptVersion bump for a real prompt change (SPEC §32.4).');
const maxCalls = Number(maxCallsArg);
const llm = arg('llm') !== undefined;
const yes = arg('yes') !== undefined;
const only = arg('tickers')?.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
let bucket: string | undefined;
if (llm) {
  const resolved = await resolveDataBucket(AWS_REGION).catch((e: Error) => {
    console.error(`intelligence:build: CloudFormation lookup failed: ${e.message}`);
    return null;
  });
  const chosen = chooseLedgerBucket(arg('bucket') ?? process.env.DATA_BUCKET, resolved, arg('allow-other-bucket') !== undefined);
  if ('error' in chosen) fail(`intelligence:build --llm: ${chosen.error}`);
  bucket = chosen.bucket;
}

const { index, retriever } = await openIndex();
const indexVersion = index.manifest.indexVersion;
const byTicker = new Map<string, typeof index.chunks>();
for (const c of index.chunks) byTicker.set(c.ticker, [...(byTicker.get(c.ticker) ?? []), c]);
const byId = new Map(index.chunks.map((c) => [c.chunkId, c]));

const companies: BuildCompany[] = [];
for (const f of readdirSync(EXTRACTION_DIR).filter((f) => /^[A-Z]{1,5}\.json$/.test(f)).sort()) {
  const extraction = JSON.parse(readFileSync(join(EXTRACTION_DIR, f), 'utf8')) as ProfileExtraction;
  if (extraction.indexVersion !== indexVersion) fail(`${f}: extraction is for ${extraction.indexVersion}, the index is ${indexVersion}; rerun pnpm extract`);
  // GE_10K_2015 (GE Capital, FY2014) is outside the review window: no profile (assumptions G2).
  if (extraction.coverage.outsideReviewWindow) continue;
  if (only && !only.includes(extraction.coverage.ticker)) continue;
  companies.push({ extraction, chunks: byTicker.get(extraction.coverage.ticker) ?? [] });
}
if (only && companies.length !== only.length) fail(`intelligence:build: unknown or excluded tickers in --tickers ${only.join(',')}`);

const ledger = llm ? new S3Ledger(new S3Client({ region: AWS_REGION }), bucket!, indexVersion, PROFILE_PROMPT_VERSION) : undefined;
const spent = ledger ? await ledger.spent() : new Set<string>();
const toCall = llm ? companies.filter((c) => !spent.has(c.extraction.coverage.ticker)).length : 0;
const planned = Math.min(toCall, maxCalls);
console.log(
  `intelligence:build ${indexVersion}: ${companies.length} companies · ${deterministicSetId()}${llm ? ` + ${llmSetId()} (ledger s3://${bucket}/intelligence/ledger/${indexVersion}/${PROFILE_PROMPT_VERSION}/: ${spent.size} spent)` : ''}`,
);
if (llm) console.log(`  calls planned: ${planned} of ${toCall} unspent (cap ${maxCalls}) · model ${GENERATION_MODEL_ID} · about $${(planned * EST_COST_PER_CALL).toFixed(2)}`);
if (planned > 0 && !yes) {
  console.log('Dry run: no Bedrock call and no ledger write. Re-run with --yes to build (spend: ask first).');
  process.exit(0);
}

const out = join(INDEX_HOME, only ? 'intelligence-partial' : 'intelligence', indexVersion);
for (const set of [deterministicSetId(), ...(llm ? [llmSetId()] : [])]) {
  rmSync(join(out, set), { recursive: true, force: true });
  mkdirSync(join(out, set), { recursive: true });
}
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
// Local outcome copies: written before the ledger write (created once, never overwritten).
const outcomeDir = join(CACHE_DIR, 'profile-outcomes', indexVersion, PROFILE_PROMPT_VERSION);
const localOutcomes: LocalOutcomeStore = {
  read: async (ticker) => {
    const f = join(outcomeDir, `${ticker}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as LedgerOutcome) : null;
  },
  write: async (outcome) => {
    mkdirSync(outcomeDir, { recursive: true });
    writeFileSync(join(outcomeDir, `${outcome.ticker}.json`), `${JSON.stringify(outcome)}\n`, { flag: 'wx' });
  },
};
const result = await buildProfileSets({
  indexVersion,
  builtAt: new Date().toISOString(),
  runId,
  companies,
  chunk: (id) => byId.get(id),
  retriever,
  llm,
  maxCalls: planned,
  ...(ledger ? { ledger, ledgerBucket: bucket, localOutcomes, client: new BedrockGenerationClient(createBedrockRuntime(AWS_REGION), GENERATION_MODEL_ID) } : {}),
  write: async (setId, name, body) => {
    const json = name === 'manifest.json' ? JSON.stringify(only ? { ...(body as object), partial: true } : body, null, 1) : JSON.stringify(body);
    writeFileSync(join(out, setId, name), `${json}\n`);
  },
  log: (m) => console.log(`  ${m}`),
});

const t = result.llm?.totals;
console.log(`done · run ${runId} · ${result.callsMade} generation calls this run · written to ${out}`);
if (t) {
  console.log(`  ${llmSetId()}: ${t.llm} llm, ${t.deterministic} deterministic · ${t.inputTokens} in / ${t.outputTokens} out tokens · deep-tier fallback ${t.deepTierFallbackRate === null ? 'n/a' : `${(t.deepTierFallbackRate * 100).toFixed(0)}%`}`);
  for (const c of result.llm!.companies.filter((c) => c.failure)) console.log(`  ${c.ticker}: ${c.failure}${c.issues?.length ? ` · ${c.issues.slice(0, 2).join(' | ')}` : ''}`);
}
if (only) console.log('Partial sets (--tickers): for inspection only; profiles:upload-set refuses them.');

# STATE

_Last updated: 2026-10-01 (local)_

## Branch
`main` (no remote yet). Last code commit: `13b6ee9` (Phase 2).

## Current phase
**Phase 2 (ingestion, chunking, embeddings, index, extraction) is complete, gated and committed (`13b6ee9`); the index is in S3; nothing new is deployed.** Handoff: `docs/handoffs/phase-02.md`.
- Live site https://diligenceiq.mikemiller.ai still serves the Phase 1 build.
- Bedrock invoke entitlement verified (Titan v2, `us.anthropic.claude-sonnet-4-6`).
- Index `iv-9cf51c066743` built, validated and **uploaded 2026-10-01** to `s3://diligenceiq-core-databuckete3889a50-cto74g4tj9kn/index/iv-9cf51c066743/` (+ `processed/iv-9cf51c066743/`, 246 filings; 306 objects, 307 MB; a re-upload skips all 306). Local copy in `.index/build/` (gitignored): 246 documents, 25,404 chunks (chunker c2, tokenizer t2), 54 companies; vectors 104 MB, chunks 93 MB, BM25 28 MB; local cold load ~420 ms, ~900 MB resident; from S3 over a home connection ~28 s (download-bound; to re-measure inside a us-east-1 Lambda in Phase 3/4).
- Embedding spend this phase: 22.1M Titan v2 tokens ≈ $0.44.
- Web preview profiles (AAPL 28, MSFT 24, NVDA 25 headings) cite real index chunks.

## Gate
`pnpm gate` run on 2026-10-01 against the working tree: **exit 0**.
- check-docs OK (13 files); lint and typecheck (incl. `tests/e2e`, `scripts/`) clean.
- Unit tests with `REQUIRE_CORPUS=1`: core 30, cdk 35, api 23, corpus 102, rag 38, web 91 (319).
- `cdk:synth` and `build` succeeded; **e2e 31 passed**.

Gate record for the phase: adversary (2 blockers, 4 high, 7 medium, lows) → two fresh fixers (all fixed or partly fixed with measured numbers) → `/code-review` medium (2 low findings, fixed) → e2e axe regression fixed → `pnpm gate` green.

## In flight
- Nothing running.
- Next is **Phase 3** (query analysis, lanes, hybrid retrieval, context builder, retrieval evals, change detection and signal go/no-go).

## Decisions pending with Mike
- **Ask Eliza** about the offline profile generation (F4), before Phase 4b.
- **Lambda concurrency quota increase:** recommended before the demo (the account limit is 10, shared).
- **Sonnet 5.5 quota increase:** optional (L-94A31E46). The app ships on Sonnet 4.6 otherwise.
- **Rerank:** optionally ask Eliza whether a non-generative rerank counts as retrieval. This only matters if the Phase 3 evals favor rerank.

## Known traps
- **Profile build ledger:** a failed profile call is never retried at the same version. The company keeps its deterministic fallback until a genuine prompt-version bump. Never bump the version just to retry; that would fabricate prompt history.
- **SPEC section numbers changed in v2.** Docs cite v2 numbers. Historical references say "SPEC v1 §N (archived)". SPEC v2 Appendix B maps old to new.
- **`scripts/check-docs.mjs` locks in many Phase 0b phrases and the phase-row order (8 → 8b → 9).** Rewording those docs means updating the checks too.
- **Lambda account concurrency is 10 (shared).** No reserved concurrency; worker `maximumConcurrency: 2`.
- **Claude Sonnet 5.5 has 0 tokens/minute quota here.** The default is `us.anthropic.claude-sonnet-4-6`. IAM needs the us-east-1, us-east-2 and us-west-2 foundation-model ARNs.
- **Cohere Embed v4 is capped at 16.2M tokens/day,** below the ~20M-token corpus. Titan v2 is the default. The indexer must checkpoint and cache.
- **Bedrock invoke entitlement verified 2026-10-01** (Titan v2 and Sonnet 4.6, us-east-1). Re-check with `pnpm check:bedrock` (tiny spend; ask first).
- **No Docker.** Lambda zip bundles only.
- **Corpus coverage tiers:**
  - Deep: 12 companies, 3–5 10-Ks each.
  - Partial: META, BAC, JPM, MCD, PEP.
  - Limited history: 37 companies with a single 10-K.
- **Period end order** (54 files lack `Report Period`): header → URL slug → cover page → filing date.
- **Header `Quarter` is a calendar quarter, not a fiscal quarter.** TGT and HD name the fiscal year by its start year.
- **JNJ and XOM 10-Qs have no Item 1A.** MS's 10-K TOC has no "Item".
- **`GE_10K_2015` is GE Capital's FY2014 10-K.**
- **Lines reach 287,855 characters.** Never chunk by line.
- **E2E:**
  - `pnpm e2e` serves `apps/web/out` with `python3 -m http.server` on port 4174, with **one worker**: parallel workers stall the Python server and pages hang on "Loading…".
  - It needs a prior `pnpm build`; the gate order handles that.
  - `@playwright/test` is pinned to 1.63.0 to match the cached Chromium 1243. Bumping it triggers a browser download.
- **Preview profiles (`fixture-v2`) hold the full EXTRACTED heading list, not a vetted one.** Measured precision 0.92 / recall 0.96 on hand-labeled AAPL, MSFT, NVDA (NVDA precision 0.84). While any `profileSetId` is `fixture-*` (`isFixtureProfile`), nothing that depends on a complete list may be stated as a conclusion (common or distinctive areas, ranking, "major attention area", rank). SPEC §8.6.
- **Fixture files are regenerated, never hand-edited:**
  - `pnpm fixtures:risks` → `apps/web/src/fixtures/generated/risk-headings.json` (real index chunk IDs; its `indexVersion` must equal the ingest report's).
  - `node scripts/fixtures/build-web-fixtures.mjs` → `filings.json` and the test-only passages (`apps/web/src/test/generated/`). Both need `./edgar_corpus`.
- **Index version = content hash of the chunks as produced** (`packages/rag` `version.ts`). Any change to section detection, segmentation, headers or fiscal labels changes it, and therefore chunk IDs, the web fixture's `indexVersion`, and which cached embeddings apply. After such a change: `pnpm ingest`, `pnpm fixtures:risks`, `pnpm index:embed --dry-run` (ask before the real run), `pnpm index:build`.
- **Embedding cache** `.index/cache/embeddings-amazon.titan-embed-text-v2_0-1024.jsonl` (28,202 vectors, gitignored, ~$0.44 to rebuild). A live embed run holds `<cache>.lock`; a stale lock is reported, never auto-removed. Never run two embed runs at once. Spend log: `.index/cache/embed-runs.jsonl` (covers only runs since it was introduced).
- **Chunk offsets index the PROCESSED text** (body from the cover heading on, whitespace-normalized), not the raw file. Test-only passages are still raw-file slices.
- **Section-detection gaps that remain:** IBM 10-K (MD&A and statements are 210/357-char stubs, incorporated by reference); integrated-report 10-Ks (XOM, CVX, DE, BAC, INTC, MCD, PEP, MS) label statements as MD&A. See assumptions Known corpus anomalies.
- **Extraction is time-boxed:** drivers for 9/54 companies; total debt 11/54; gross profit 16/54. Facts carry `source` (`statement`/`other_table`) and `suspect`; Phase 4b must map them into core's strict `ProfileFactSchema`.
- **`pnpm gate` requires the corpus** (`REQUIRE_CORPUS=1`); without `edgar_corpus/` it fails by design.
- **Evidence drawer regions scroll and are focusable** (axe `scrollable-region-focusable`); long passages broke the Phase 1 e2e axe scan.
- **Corpus company names have no trailing period** ("Apple Inc", "Tesla Inc"). GE's display name is overridden to "General Electric Capital Corp (GE Capital)" (G2).
- **`cdk diff` is not side-effect free.** It publishes template and Lambda assets to the CDK bootstrap bucket.

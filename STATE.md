# STATE

_Last updated: 2026-10-02 (local)_

## Branch
`main` (no remote yet). Last code commit: `ba161bb` (Phase 3). Previous: `13b6ee9` (Phase 2).

## Current phase
**Phase 3 is complete, gated and committed (`ba161bb`): query analysis, hybrid retrieval, context builder, retrieval debug endpoint, retrieval evals, signal go/no-go.** Nothing new is deployed. Handoff: `docs/handoffs/phase-03.md`. Eval write-up: `docs/evaluation.md`.
- The live site https://diligenceiq.mikemiller.ai still serves the Phase 1 build.
- Index `iv-9cf51c066743` is in S3 (verified 2026-10-01, read-only) and locally in `.index/build/` (gitignored); details in `docs/handoffs/phase-02.md`.
- **Retrieval** (20 questions, `pnpm eval:retrieval`): hybrid passes 19/20, evidence hit rate 0.99, gold recall@context 0.62 (40/74), search ~26 ms p50 plus one Titan query embedding. BM25 alone passes 16/20.
- **Decisions:** chunker c2 kept (cost and context diversity, not a measured win); Titan v2 kept (Cohere not evaluated); rerank off.
- **Signal go/no-go** (`DETECTOR_STATUS`, `packages/rag/src/signals/status.ts`): PERSISTENT (0.90 / 0.89) and TREND CHANGE (1.00 / 1.00) enabled; NEW, heading REDUCED, emphasis EXPANDED/REDUCED and OUTLOOK CHANGE suppressed.
- Spend this phase: 20 Titan query embeddings, about $0.000007.

## Gate
`pnpm gate` run on 2026-10-02 against the working tree: **exit 0**.
- check-docs OK (13 files); lint and typecheck clean.
- Unit tests with `REQUIRE_CORPUS=1`: core 30, cdk 35, api 26, corpus 102, rag 217, web 91 (501).
- `cdk:synth` and `build` succeeded; **e2e 31 passed**.

Gate record for the phase: adversary (1 blocker, 6 high, 6 medium, 5 low) → three fresh fixers (all fixed except the SPEC-level part of H3, which is pending decision 1 below) → `/code-review` medium (2 findings, fixed) → `pnpm gate` green.

## In flight
- Nothing running.
- Next is **Phase 4**: Deep Analysis prompt, `GenerationGateway`, validation, SQS worker using `Retriever`, generation evals.

## Decisions pending with Mike
- **Change questions with no period named** (SPEC §26.3 current view, versus the last 2–3 annual reports). Recommended: amend the SPEC at the start of Phase 4.
- **PERSISTENT go on its stated basis:** 22/77 links unlabeled; fully labeled chains 5/7; recall over all persistent headings 0.36. Recommended: keep it.
- **Ask Eliza** about the offline profile generation (F4), before Phase 4b. The rerank question (F1) is reopened; ask only if the Phase 4 evals show a need.
- **Lambda concurrency quota increase:** recommended before the demo (the account limit is 10, shared).
- **Sonnet 5.5 quota increase:** optional (L-94A31E46). The app ships on Sonnet 4.6 otherwise.

## Known traps
- **Bare years are not periods** (Phase 3). A year counts only in a time phrase ("in 2024", "FY2024", "2024 10-K", "from … through …", "for 2023-2025"). "Apple risks 2024" stays in the current view, with a "Not read as a period" note. A requested period missing for every company falls back to the current view, with gaps. A UI fiscal-year filter never falls back.
- **Query embeddings are cached** in `.index/cache/query-embeddings-*.jsonl`. `pnpm eval:retrieval` and `pnpm retrieval:debug` are cache-only unless `--embed` (Titan spend: ask first). A new or reworded eval question shows as "not embedded" until embedded.
- **Signal detectors are suppressed by default.** `detectCompanySignals` filters on `DETECTOR_STATUS`; only `pnpm eval:signals` passes `includeSuppressed`. A corpus-backed gate test fails if an enabled detector drops below the bar, or a suppressed one starts passing (then revisit the decision).
- **Label files are hand-made ground truth:** `packages/rag/src/signals/testing/{signal-labels,trend-labels}.ts` and the `gold` chunk IDs in `evals/questions.yaml`. Regenerate them, never tune them, against detector or retrieval output. Chunk IDs in `gold` are tied to `iv-9cf51c066743`.
- **`POST /api/retrieval/debug` exists only when injected** (`pnpm retrieval:debug`, 127.0.0.1). The deployed handler must never wire it (tested).
- **Chunker `ChunkSizing` is for the experiment only.** Defaults must stay byte-identical (`pnpm eval:chunk-size` re-derives `iv-9cf51c066743`).
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

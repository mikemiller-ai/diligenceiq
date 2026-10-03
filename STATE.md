# STATE

_Last updated: 2026-10-02 (local)_

## Branch
`main` (no remote yet). Last code commit: `bdd817e` (Phase 6). Phase 4b: `dfff25e`; go-live recorded `059ebbd`. Landing: `950a021`. Phase 5: `fb54e18` (+ cap `2a4524c`). Phase 4: `9699b3b`, `ab5de38`.

## Current phase
**Phase 6 (evidence: adjacent periods, readable source view, coverage matrix linked to evidence, citation integrity) is built, gated (`pnpm gate` exit 0, 2026-10-02), committed (`bdd817e`) and deployed (2026-10-02).** Handoff: `docs/handoffs/phase-06.md`.
- Production: active profile set `iv-9cf51c066743/llm-v3` (SSM parameter version 5, re-verified read-only 2026-10-02), kill switch `false`, `/api/health` 200. Instant fallback: set the pointer to `iv-9cf51c066743/det-v2`.
- Exit criteria: AAPL and JNJ adjacency tested in the gate; seed and fixture-profile citations resolve in the gate; `pnpm evidence:check` (offline) resolves every index chunk, adjacency reference, recorded live-brief citation and det-v2/llm-v3 citation (`evals/results/evidence-iv-9cf51c066743.json`). Production DynamoDB analyses are not covered by a repo check (adversary ID check: all resolve).

## Gate
`pnpm gate` on 2026-10-02 against the Phase 6 working tree: **exit 0**.
- check-docs OK; lint and typecheck clean.
- Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 394, web 189, api 135 (**941**).
- `cdk:synth` and `build` succeeded; **e2e 44 passed**.

Gate record: adversary (1 blocker: typecheck; 2 high: source view ignored the index version, missing-key 403 → 500; 5 medium; 10 low) → fresh fixer (all fixed with tests) → `/code-review` medium (no findings) → `pnpm gate` green.

## In flight
- **Done 2026-10-02 (Mike approved):** `pnpm deploy:infra` (Worker and Api updated; Core and Web unchanged) → `pnpm deploy:web` (Amplify job 5) → production smoke (2 new demo sessions):
  - all three seeded briefs: every citation and context passage resolves through `GET /api/sources` to its exact span (40/40, 36/36, 37/37); every coverage cell carries `chunkIds`; 200s send `cache-control: private, max-age=3600`;
  - `GET /api/evidence/adjacent`: AAPL FY2025 10-K 1A (prev FY2024, next null), AAPL FY2024Q2 10-Q MD&A (prev FY2024Q1, next FY2024Q3, same quarter FY2023Q2), JNJ FY2021 10-K MD&A (prev null, next FY2022), JNJ FY2024Q2 10-Q MD&A (FY2024Q1 / FY2024Q3 / FY2023Q2); 320–1,160 ms;
  - JPM 10-K (1,351,204 bytes, 499 chunks): 1,080 ms first request, 713 ms warm (well inside the 10 s timeout);
  - a missing document → `404 SOURCE_MISSING` (no 500: the 403 mapping works on the real role); a missing adjacency entry → `404 NOT_FOUND`; another index version → `404 index_version`;
  - `/sources/filing/` page 200. Kill switch still `false`; pointer still `iv-9cf51c066743/llm-v3`.
- Next phase: Phase 7.

## Decisions pending with Mike
- **D12 (per-client creation cap keyed on `sourceIp`):** raised to 100 a day (Mike, 2026-10-02); verify the address the api sees in Phase 8.
- **Validator (Deep Analysis):** whether to read a same-chunk "(MILLIONS)" caption (42 Pfizer near matches; free re-score).
- **PERSISTENT go on its stated basis** (Phase 3). Recommended: keep it.
- **F1 (rerank) to Eliza:** the Phase 4 evals show no need.
- **Sonnet 5.5:** still 0 quota. Switching needs a SPEC §29.1 change first.

## Known traps
- **Evidence routes recompute chunks at runtime.** `GET /api/sources` and `/api/evidence/adjacent` re-chunk `processed/<iv>/<doc>.json` with the bundled `chunkFiling`; the adjacency file holds chunk IDs only. The store refuses (`index_unavailable`) when the index manifest's `chunkerVersion` differs from the bundled `CHUNKER_VERSION`, so a chunker change needs a re-index before the api deploy. `pnpm evidence:check` proves byte-identity over the whole build.
- **Without `s3:ListBucket`, S3 answers a missing key with 403 AccessDenied.** The api role deliberately has no ListBucket; `isMissingObject` (`services/api/src/s3-missing.ts`) reads 403 as missing and logs a warn with the key. A prefix missing from the IAM policy therefore shows as "not found" plus that warn, not as a 500.
- **Source-view links carry the citation's index version** (`/sources/filing/?id=&iv=#chunk-`, `filingHref`). A citation from another version opens the current text with a notice and is never highlighted.
- **Committed evidence fixtures:** `tests/fixtures/evidence/<iv>/` (adjacency subset + the real build manifest), regenerated with `pnpm fixtures:evidence` from `.index/build`, never hand-edited. The api tests and the e2e server process filings from the corpus themselves.
- **Phase 5 api routes need a session.** Every route except `GET /api/health` and `POST /api/session` returns 401 without the cookie. The cookie is `__Host-diq_ws` in production and `diq_ws` on the local http server (`secureCookies: false`). POST and PATCH bodies must be `content-type: application/json`: the retrieval-debug curl needs `-H 'content-type: application/json'`.
- **The session secret is not in CDK.** CloudFormation cannot create SecureStrings. Without `/diligenceiq/session-secret` (≥ 32 bytes) every session fails closed with 500 (assumption D11).
- **The api reads profiles only through the SSM pointer.** "none" (the CDK default) serves no profiles (`PROFILE_MISSING` everywhere). A set is immutable in S3 (If-None-Match; `upload-set` fails loudly on different content); a change is a new version. Phase 4b sets match `ProfileSetManifestSchema` (core `intelligence.ts`); extra telemetry fields are allowed.
- **Finding IDs are derived from the source** (`fd-` + sha256 of the source key, scoped by `profileSetId` for profile sources), not ULIDs: one finding per stored item; repeat saves are 409 `ALREADY_SAVED`.
- **Reset keeps META and `RATE#` counters.** Deleting META would strand a concurrent request; deleting `RATE#` would let reset bypass the hourly cap.
- **Regenerate, never hand-edit:**
  - `seed/demo-workspace.json`: `pnpm seed:build` (replay of eval questions pdf-2, multi-cloud, expert-1 under da-v4). A prompt or context change means those recordings no longer match, and the build fails until a live run is approved.
  - `tests/fixtures/profile-sets/`: `pnpm profiles:export-fixture`.
  - `packages/core/src/generated/catalog.json`: `node scripts/fixtures/build-catalog.mjs`.

  A web fixtures test fails when any of them drifts.
- **`comparison.columns` in a validated brief has one header per value (no row-label header).** Use core `comparisonHeaders` when rendering or copying rows; a leading row-label header is still accepted.
- **E2E runs the real api in-process** (`tests/e2e/local-server.ts`), not a Python static server. Its queue goes to a TEST-ONLY stub worker that completes only with a seed brief for a matching company, else fails `NO_RELEVANT_EVIDENCE`. Test controls: `/__e2e/stats`, `/__e2e/kill-switch`, `/__e2e/worker`. `.claude/launch.json` `web-local` serves the same thing on port 4175 for manual checks.
- **Sonnet 5.5 is not a drop-in model switch.** It rejects forced `toolChoice` (`any`/`tool`) and a non-default `temperature` with a 400. Moving to it needs a SPEC §29.1 change (`toolChoice: auto` with a strict tool), a prompt version bump and a paid eval run.
- **The AWS CLI default region on this machine is us-east-2.** Pass `--region us-east-1` to `aws` commands. The scripts default `AWS_REGION` to us-east-1 themselves.
- **Generation eval spend:**
  - `pnpm eval:retrieval --generate` replays the recordings in `.index/cache/generations/<promptVersion>/` (keyed by the exact request; gitignored) for free.
  - `--live` calls Bedrock for unrecorded requests: about $0.11 each, about $2.25 per 20 questions. Ask first.
  - A failed live call is recorded too, so replay never spends again.
  - Any prompt or context change is a new key.
- **`--generate` writes only the generation results.** Only the full default three-mode `pnpm eval:retrieval` run may rewrite `evals/results/retrieval-<iv>.*`; a Phase 4 run once overwrote it. `pnpm eval:generation:rescore` re-validates stored briefs after a validator change (free).
- **Numeric grounding is strict on purpose** (architecture §6.9).
  - A scaled figure needs the same scale word, an exactly equal amount, or a passage that states its unit.
  - Digits in a table cell whose unit header sits in another chunk are a `unit_unstated` near match: reported, never verified.
  - Do not loosen a rule to raise the eval score. Phase 4's first, looser rules overstated grounding (0.985 → 0.922).
- **Prompt changes:**
  - Edit `packages/rag/src/generation/prompt.ts`, bump `DEEP_ANALYSIS_PROMPT_VERSION`, and copy the old `prompts/final-diligence-prompt.md` to `prompts/versions/<old>.md` first.
  - Run `pnpm prompts:render` (a test fails until the file matches).
  - Log a real entry in `docs/prompt-iterations.md`.
- **The worker's kill switch:** `false` fails QUEUED jobs as `ANALYSES_DISABLED`; an unreadable SSM value fails them as `WORKER_FAILED`. To measure in-region, set `/diligenceiq/analyses-enabled` to `true`, run `pnpm analysis:run`, then set it back to `false`. Ask first: it is an AWS write plus Bedrock spend.
- **Redelivery is never recovery.** The 1080 s visibility timeout outlasts the 240 s deadline, so the poll's `expireIfPastDeadline` is the real recovery path. The DLQ only records messages whose claim write itself failed three times.
- **`MemoryAnalysisStore` mirrors `DynamoAnalysisStore`'s condition expressions** and backs the worker tests. Change both together.
- **The worker bundles its pinned AWS SDK** (`externalModules: []`), not the Lambda runtime's.
- **Bare years are not periods** (Phase 3). A year counts only in a time phrase ("in 2024", "FY2024", "2024 10-K", "from … through …", "for 2023-2025"). "Apple risks 2024" stays in the current view, with a "Not read as a period" note. A requested period missing for every company falls back to the current view, with gaps. A UI fiscal-year filter never falls back.
- **Query embeddings are cached** in `.index/cache/query-embeddings-*.jsonl`. `pnpm eval:retrieval` and `pnpm retrieval:debug` are cache-only unless `--embed` (Titan spend: ask first). A new or reworded eval question shows as "not embedded" until embedded.
- **Signal detectors are suppressed by default.** `detectCompanySignals` filters on `DETECTOR_STATUS`; only `pnpm eval:signals` passes `includeSuppressed`. A corpus-backed gate test fails if an enabled detector drops below the bar, or a suppressed one starts passing (then revisit the decision).
- **Label files are hand-made ground truth:** `packages/rag/src/signals/testing/{signal-labels,trend-labels}.ts` and the `gold` chunk IDs in `evals/questions.yaml`. Regenerate them, never tune them, against detector or retrieval output. Chunk IDs in `gold` are tied to `iv-9cf51c066743`.
- **`POST /api/retrieval/debug` exists only when injected** (`pnpm retrieval:debug`, 127.0.0.1). The deployed handler must never wire it (tested).
- **Chunker `ChunkSizing` is for the experiment only.** Defaults must stay byte-identical (`pnpm eval:chunk-size` re-derives `iv-9cf51c066743`).
- **Profile build ledger:** a failed profile call is never retried at the same version. The company keeps its deterministic fallback until a genuine prompt-version bump. Never bump the version just to retry; that would fabricate prompt history.
- **SPEC section numbers changed in v2.** Docs cite v2 numbers. Historical references say "SPEC v1 §N (archived)". SPEC v2 Appendix B maps old to new.
- **`scripts/check-docs.mjs` locks in many Phase 0b phrases and the phase-row order (8 → 8b → 9).** Rewording those docs means updating the checks too.
- **Lambda account concurrency is 1,000 (shared; raised from 10 on 2026-10-01).** Still no reserved concurrency (a design rule); worker `maximumConcurrency: 2`.
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
  - `pnpm e2e` serves `apps/web/out` plus the in-process api on port 4174 (`tests/e2e/local-server.ts`), with **one worker**: the in-memory workspace and test controls are shared by the run.
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
- **Profile build (Phase 4b):** `pnpm intelligence:build` never calls without `--yes` and never calls a company twice at one `profilePromptVersion` (S3 ledger). `--llm --max-calls 0` rebuilds the LLM set from stored outcomes for free. Changing anything that alters the request (evidence, blocks, prompt) marks new-format outcomes `stale_outcome`; the v3 outcomes have no hash (`promptVerified: false`), so keep `assemble`'s block-relevant output, `evidence.ts` and `prompt.ts` unchanged or bump the version.
- **Deploy the api before activating a profile set that uses new schema fields.** The api validates profiles with its own bundled core schema (strict); an unknown field makes the profile read as `PROFILE_MISSING`, with no error surfaced to the user. Order: deploy:infra → pointer → smoke → deploy:web.

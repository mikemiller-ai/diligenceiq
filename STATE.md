# STATE

_Last updated: 2026-10-02 (local)_

## Branch
`main` (no remote yet). Last commit: `ae6057b` (STATE after da-v4). Phase 5 is **uncommitted in the working tree**, pending Mike's go-ahead. Phase 4: `9699b3b`, da-v4 follow-up `ab5de38`.

## Current phase
**Phase 5 is built and gated (`pnpm gate` exit 0, 2026-10-02) but not committed and not deployed.** Handoff: `docs/handoffs/phase-05.md`. Mike chose Phase 5 before Phase 4b on 2026-10-02; SPEC v2 Appendix A.4 records it, **pending his confirmation**.
- **api** (`services/api`):
  - HMAC sessions (cookie `__Host-diq_ws`, secret = SSM SecureString `/diligenceiq/session-secret`, admin-created).
  - Demo workspace seeded from `seed/demo-workspace.json` (3 real pre-run briefs, 4 findings); reset.
  - Spend controls: workspace hourly / global daily / per-client and global workspace-creation caps, and the kill switch.
  - `POST /api/analyses` enqueues to the WorkerStack queue; the poll runs `expireIfPastDeadline`.
  - Findings copied server-side; profiles read from the active set (SSM pointer `/diligenceiq/active-profile-set` + S3); Compare; health `indexAvailable`.
- **web:** all workspace state comes from the api. The Deep Analysis page polls, shows the worker's real stages, the Interpretation panel, the coverage matrix and numeric badges (including `unit_unstated` near matches), and every SPEC §38.2 state. A Recent analyses list.
- **Validator:** `preceding_unit` rule (a table's unit caption in the previous chunk of the same section). da-v4 numeric grounding 0.901 → **0.911** (489/537); near matches 47 → 42. Re-scored for free; all 42 remaining are Pfizer tables whose caption is "(MILLIONS)" in the same chunk, a form the detector does not read.
- **Deployed:** unchanged. `DiligenceIQ-Worker` runs `ab5de38` (da-v4, the OLD validator). The live site and api still serve Phase 1 (`ANALYSES_DISABLED`). The kill switch is `false`.
- **Spend this phase:** none (seed and rescore are replay-only).

## Gate
`pnpm gate` on 2026-10-02 against the working tree: **exit 0**.
- check-docs OK (14 files); lint and typecheck clean.
- Unit tests with `REQUIRE_CORPUS=1`: core 33, cdk 43, corpus 102, rag 346, web 145, api 102 (**771**).
- `cdk:synth` and `build` succeeded; **e2e 39 passed**.

Gate record: adversary (0 blocker, 5 high, 11 medium, lows) → fresh fixer (all fixed, regression tests) → `/code-review` medium (2 findings: concurrent 401s minted several workspaces; profile finding IDs collided across profile sets; both fixed with tests) → `pnpm gate` green.

## In flight
- Phase 5 commit: waiting for Mike's go-ahead.
- Deploy (each needs Mike's OK; none done):
  1. Create the SecureString `/diligenceiq/session-secret` (≥ 32 bytes) in us-east-1.
  2. Upload the preview set: `pnpm profiles:upload-set --bucket <data bucket> --set iv-9cf51c066743/fixture-v2 --yes`.
  3. `pnpm deploy:infra` (CoreStack adds `/diligenceiq/active-profile-set` = "none"; ApiStack gets IAM, env and queue; WorkerStack redeploys with the new validator).
  4. Point `/diligenceiq/active-profile-set` at `iv-9cf51c066743/fixture-v2`.
  5. `pnpm deploy:web`.
  6. One in-region run (`pnpm analysis:run`, about $0.13, kill switch on, then off) to verify api → SQS → worker end to end. It has never run.
- Next phase: Phase 4b (offline profiles; must write the manifest format in `ProfileSetManifestSchema`), then Phase 6.

## Decisions pending with Mike
- **Confirm SPEC A.4:** Phase 5 before 4b, preview set through the real profile path.
- **D12 (per-client creation cap keyed on `sourceIp`):** behind the Amplify rewrite, `sourceIp` may be a shared proxy address, so many visitors would share 20 workspaces a day. Before deploy, choose: raise the cap, key on the last untrusted `X-Forwarded-For` hop, or verify in Phase 8.
- **Validator:** whether to also read a same-chunk "(MILLIONS)" caption (would address the 42 Pfizer near matches; free re-score). Do not loosen anything else.
- **PERSISTENT go on its stated basis** (Phase 3). Recommended: keep it.
- **F1 (rerank) to Eliza:** the Phase 4 evals show no need.
- **Sonnet 5.5:** still 0 quota (L-94A31E46, L-31AB82D0). Switching needs a SPEC §29.1 change first.

## Known traps
- **Phase 5 api routes need a session.** Every route except `GET /api/health` and `POST /api/session` returns 401 without the cookie. The cookie is `__Host-diq_ws` in production and `diq_ws` on the local http server (`secureCookies: false`). POST and PATCH bodies must be `content-type: application/json`: the retrieval-debug curl needs `-H 'content-type: application/json'`.
- **The session secret is not in CDK.** CloudFormation cannot create SecureStrings. Without `/diligenceiq/session-secret` (≥ 32 bytes) every session fails closed with 500 (assumption D11).
- **The api reads profiles only through the SSM pointer.** "none" (the CDK default) serves no profiles (`PROFILE_MISSING` everywhere). A set is immutable in S3 (If-None-Match; `upload-set` fails loudly on different content); a change is a new version. Phase 4b sets must match `ProfileSetManifestSchema` (core `intelligence.ts`).
- **Finding IDs are derived from the source** (`fd-` + sha256 of the source key, scoped by `profileSetId` for profile sources), not ULIDs: one finding per stored item; repeat saves are 409 `ALREADY_SAVED`.
- **Reset keeps META and `RATE#` counters.** Deleting META would strand a concurrent request; deleting `RATE#` would let reset bypass the hourly cap.
- **Regenerate, never hand-edit:**
  - `seed/demo-workspace.json`: `pnpm seed:build` (replay of eval questions pdf-2, multi-cloud, expert-1 under da-v4). A prompt or context change means those recordings no longer match, and the build fails until a live run is approved.
  - `tests/fixtures/profile-sets/`: `pnpm profiles:export-fixture`.
  - `packages/core/src/generated/catalog.json`: `node scripts/fixtures/build-catalog.mjs`.

  A web fixtures test fails when any of them drifts.
- **`comparison.columns` in a validated brief has one header per value (no row-label header).** Use core `comparisonHeaders` when rendering or copying rows; a leading row-label header is still accepted.
- **E2E runs the real api in-process** (`tests/e2e/local-server.ts`), not a Python static server. Its queue goes to a TEST-ONLY stub worker that completes only with a seed brief for a matching company, else fails `NO_RELEVANT_EVIDENCE`. Test controls: `/__e2e/stats`, `/__e2e/kill-switch`, `/__e2e/worker`. `.claude/launch.json` `web-local` serves the same thing on port 4175 for manual checks.
- **The deployed worker still runs the old validator** until the next `deploy:infra`. The 0.911 numbers are from the re-score.
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

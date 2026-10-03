# STATE

_Last updated: 2026-10-03 (local)_

## Branch
`main`, pushed to the **public** repo https://github.com/mikemiller-ai/diligenceiq (public by Mike's choice for the panel; make it private again after: `gh repo edit mikemiller-ai/diligenceiq --visibility private`). Phase 8 is `d60b539` (+ `adf7db2`); Phase 9 is `1c86e96`, pushed.

## Current phase
**Phase 9 (interview polish; plan row 9) is complete: committed (`1c86e96`), pushed, gated, deployed (2026-10-03, WorkerStack and ApiStack by Mike, Amplify job 14), production-checked.** Handoff: `docs/handoffs/phase-09.md`. Phases 1–8 are complete; Phase 8b (P1: Thesis, Watchlist, IC Brief) is not built and is described in `docs/future-state.md`, never claimed.
- Production: profile set `iv-9cf51c066743/llm-v3` (fallback `det-v2`); **Deep Analysis prompt da-v4** (da-v5 tried and reverted); the deterministic period-claim check ("Period not cited") is live; seed rebuilt from da-v4 recordings; **three more claim checks (arithmetic, company attribution, sweeping claims; evaluation.md §13) are built in the working tree, tightened for precision after the adversary review (all three shown, each at zero pure false alarms on 109 briefs), uncommitted and not deployed (2026-10-03)**; **kill switch `true`** (Mike: on through the panel prep and the panel, then off).
- Alerts: SNS `diligenceiq-alerts` (email confirmed) from three alarms: `GenerationCallsOverOne`, `DlqHandlerInvokedAlarm`, `AnalysisFailedAlarm` (any failed analysis except `NO_RELEVANT_EVIDENCE` and `ANALYSES_DISABLED`; pattern tested with `test-metric-filter`). Budget: the account's "Product - DiligenceIQ - Monthly" ($25).
- **Claim checks live (2026-10-03 23:41 UTC, Amplify job 15):** period, arithmetic, company attribution and sweeping-claim badges, each shown only at zero pure false alarms on 109 real briefs (evaluation.md §12–§13). Gate: 1,444 unit tests, e2e 112 passed; `pnpm e2e:prod` 19/19.
- Deliverables for Eliza: `docs/deliverables.md` (linked from the README top). Demo: `docs/demo-script.md`; future state: `docs/future-state.md`.

## Gate
`pnpm gate` on 2026-10-03 against the final Phase 9 tree: **exit 0**. Unit tests: core 79, cdk 49, corpus 102, rag 476, web 526, api 175 (**1,407**); cdk:synth and build (CSP: 11 pages, 79 hashes); **e2e 112 passed, 4 skipped**. `pnpm e2e:prod` 19/19 after the deploy.

## In flight
- **Budget attribution check** once billing data for 2026-10-03 arrives: does production Bedrock spend land in the `DiligenceIQ` cost category? (October's offline spend, about $17 + $2.47 da-v5 eval, is "Unattributed".)
- **Rehearsal done (2026-10-03, $0.4133):** the three PDF questions verbatim in production all reached COMPLETE, 1 call each, citations 100% valid. Example 2 again dates NVIDIA's FY2023 Compute & Networking figure ($15,068M) to FY2024; it is marked Unverified figure (docs/demo-script.md §3).
- **Known limits, recorded, not fixed:**
  - No recorded da-v4 brief survived a strict claim-by-claim reading (7 of 7 rejected for overreach or attribution; every figure was correct; `evals/results/seed-verification-2026-10-03.md`). The seeded Apple brief shows 7 "Period not cited" marks and still misdates the DMA fines (a contradiction the check cannot see).
  - PDF example 1's recorded da-v4 comparison was ragged (8 rows of 3 values and 1 of 2 under 4 columns), flagged with a notice; PDF example 3 (pharma) misses mitigation passages (gold recall 7/18). Both are framed honestly in the demo script.
  - One production analysis failed `MALFORMED_OUTPUT` (2026-10-03, da-v5: `keyFindings` returned as an invalid JSON string). A deterministic repair (escape raw control characters) and a content-free `failureDetail` on the record now exist; the root cause was not captured.
  - The per-client workspace cap keys on Amplify's proxy (D12, accepted). The JS is heavy (about 390 KB gzipped first load). M3 profile citations carry no subsection. "What's changed" is thin because the NEW/EXPANDED/REDUCED detectors are suppressed.
  - The assessment PDF says "Timebox: ~4 hours"; the demo script has a talking point.

## Decisions pending with Mike
- **Kill switch off after the panel**, and the repo back to private.
- **PERSISTENT go on its stated basis** (Phase 3). Recommended: keep it.
- **F1 (rerank) to Eliza:** the Phase 4 evals show no need.
- **Sonnet 5.5:** still 0 quota. Switching needs a SPEC §29.1 change first.
- **M3 profile citation subsections.**
- **Profile detector wording** ("crossing the threshold…") in model-written llm-v3 text: hidden behind "How this was measured" in the UI; a source fix needs a new `profilePromptVersion` (about $7).

## Known traps
- **Compare's bottom line and core's Diverging section use different rules on purpose.** The bottom line (`compare-summary.ts`) counts "slowing" as still rising, and its footer follows the lines. Core's `diverging` (Diverging trends section) counts only rising against declining. Only lines where every company shares a direction are coloured (DD-21 h). An operating margin at or below zero gets loss wording, never "widened".
- **Findings card IDs must be per rendered card (`React.useId`).** Group by Company renders a finding about several companies once per company. Note drafts live in `NoteDraftsProvider` (findings-view), so a Board status change that remounts a card keeps the draft.
- **`cn`/tailwind-merge drops a `bg-[…]` position class next to a `bg-<colour>`.** The select chevron is the `select-chevron` utility in globals.css, not a `bg-…` class.
- **Jump bar (shared, `components/diligence/jump-bar.tsx`).**
  - Targets need `scroll-mt-40`.
  - The section in view is the lowest heading at or above the line; on equal tops the earlier in the list wins.
  - After a jump, the target stays marked until reader input (wheel, touch, key, pointer) or the page moves away from where it landed.
  - A heading inside a computed `position: sticky` box (the brief's Sources rail at lg) is never tracked, and a jump to it only focuses it: scrolling the page to a sticky element lands nowhere useful.
  - A jump moves focus to the heading (`tabindex=-1`).
- **Two `nav` landmarks on the brief and dashboard.** e2e locators must scope to the sidebar (`getByRole('navigation', { name: 'Primary' })`): an unscoped "Findings" link also matched "Key findings" and broke the novice path.
- **Absolutely positioned children of a scroll box need a `relative` box.** An sr-only header escaped the `Table` wrapper and widened the page on phones. The e2e checks 390 px on the brief and Compare.
- **Compare colours a trend only through `trendRead`** (`compare-view.tsx`): it must read back with the same trajectory, be about the latest annual report's year (`isCurrent`) and have a labelled change (`rowChange`). PFE's FY2022 operating cash flow is the real stale case.
- **The readable view is a display layer, never stored text (DD-21 e).**
  - `apps/web/src/lib/readable/` partitions offsets into shown and hidden runs. Only furniture and layout (pipes, whitespace) may be hidden; `readable-corpus.test.ts` enforces this over all 246 filings.
  - Any new hiding rule must keep the furniture oracle at **zero** visible footers and back-links. It must also never hide content: table-of-contents rows and reference numbers ("Note 12") stay.
  - Weak furniture shapes need the whole filing's `furnitureCounts`. A drawer passage hides only strong shapes.
- **`@diligenceiq/corpus` is now a runtime web dependency**, through the browser-safe subpath exports `/segments` and `/risks` (`transpilePackages` in `next.config.ts`).
  - A change to `segments.ts` or `risks.ts` changes the web's layout too. Never import the package root (`.`) in web runtime code: `load.ts` uses Node `fs`.
- **Index chunks overlap their neighbours.** A test that marks every chunk at once must render the chunks in layers of disjoint spans (as `evidence-readable.test.tsx` does). The source view only ever marks one target.
- **The target id is placed by text offset, not render order.** Its home is `FilingSections` in `filing-view.tsx`. A table re-renders after measuring its overflow, so render-order placement lost or duplicated the id.
- **Drawer statements come from the opener.** Each chip passes `claim`; a brief passes its validator-verified `figures`, empty when none, so nothing is bolded. A metric value passes `metricStatement`. Never pass raw rows or `measurement` (detector jargon) as the statement.
- **Do not run Prettier with its defaults.** The repo has no Prettier config, and the defaults switch the code to double quotes. The house style is single quotes and lines of about 160 characters.
- **The dashboard derives nothing on its own (DD-21).** Every bottom-line line, chip colour and title comes from the builder's `trends[].trajectory` and its `basis` line (core `parseTrendBasis`) or a signal's type/measurement; facts only supply numbers from the trend's own source row. Changing the builder's basis wording breaks `parseTrendBasis` (contract tests in `packages/rag` `profile.test.ts` fail first), and a basis that no longer reads back hides that metric's line, chip and sparkline.
- **Folded items stay in the DOM.** `ShowMore` sets `hidden` on folded items (Tailwind preflight enforces it). Tests that need every item must open "Show all" first (`expandAll` in `workflow.test.tsx`); the fixture-figure rule still scans hidden items.
- **Dark mode is tokens only.** Every colour is a `light-dark()` token in `globals.css`; never a hex or `text-white` on a primary fill in className (use `text-primary-foreground`). On navy use `--sapphire` / `text-on-navy-ink`, never `primary` (which lightens in dark). The pre-paint `THEME_SCRIPT` must be allowed by hash in the Phase 7 CSP.
- **Built-profile e2e** runs as the `built-profiles` Playwright project on its own local server (port 4194) over `tests/fixtures/built-profile-sets/` (a separate root from `profile-sets`, so `profiles:upload-set` never picks it up). Regenerate with `pnpm fixtures:test-profiles`, never hand-edit.
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
  - `seed/demo-workspace.json`: `pnpm seed:build` (replay of eval questions pdf-2, multi-cloud, expert-1 under the runtime prompt, da-v4. Reseeded 2026-10-03 (Mike's decision) from the da-v4 recordings, so the Apple brief shows its 7 "Period not cited" badges; the four seeded findings were each read against their chunks (evals/results/seed-verification-2026-10-03.md). They are chosen by their text in `build-seed.ts`, and the build fails if one no longer matches exactly one item, has an unverified figure or carries a period claim. After a reseed, `pnpm fixtures:evidence` (adjacency subset) and `pnpm evidence:check`). A prompt or context change means those recordings no longer match, and the build fails until a live run is approved.
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
- **The period-claim check is reported, not a pass/fail check** (architecture §6.9; evaluation.md §12). `validation.periodClaims` is optional: analyses and seeds stored earlier have none, and the UI shows no badge for them. A cue or period-pattern change in `period-claims.ts` changes the flagged counts: re-score all versions (`pnpm eval:generation:rescore`, plus `--set robustness`) and update evaluation.md §12 and the Architecture page's `periodClaims` metric (its test reads §12). Only periods tied to the cue count (its clause or five words away, never a comparison baseline such as "up from $X in FY2024"); the 2026-10-03 code-review fix changed no recorded flag.
- **The claim checks (arithmetic, attribution, sweeping) are reported, not pass/fail** (architecture §6.9; evaluation.md §13). `validation.arithmeticClaims`, `attributionClaims` (with optional `mentions`, the text as written) and `scopeClaims` are optional: analyses and seeds stored earlier have none and show no badge.
  - **Precision first: the badges are shown live to the panel.** A false badge on a correct claim is worse than a missed error. Each check is shown only because it measured zero pure false alarms on the 109 briefs (106 recorded generations + 3 rehearsal runs; attribution also ≥ 4 of 5 flags real; evaluation.md §13 table, 2026-10-03 adversary review). A pattern change that adds flags must be re-measured with the same classification (read every new flag against its sentence and cited chunks) before it ships; if a check fails the bar, set it to `false` in `SHOWN_CLAIM_CHECKS` (`apps/web/src/lib/brief-summary.ts`) and say so in §13, leaving it computed.
  - Never flag a company in a negation, absence or contrast frame, an absence cell, an absence quantifier ("none of", "neither"), or a bare "the only" (`company-claims.ts`): those were 32 of the first version's 36 attribution flags.
  - A claim check must never fail an analysis: `validateBrief` guards each check (and the period check) and turns a throw into an empty list plus a content-free notice (`claim-checks-guard.test.ts`). Keep new checks inside `guarded(…)`.
  - A pattern change in `arithmetic-claims.ts` or `company-claims.ts` changes the flagged counts: re-score all versions plus `--set robustness`, compare flag by flag, and update evaluation.md §13 (and demo-script lines that quote counts).
  - `validateBrief` takes `{ scopeTickers }` (the interpretation's companies): the pipeline and the re-score both pass it; without it, "every company" falls back to the companies the brief cites. Keep both callers passing the same thing, or production and the eval disagree.
  - Attribution reads companies through the query analyzer's aliases (`buildAliases` over core `COMPANY_CATALOG`) plus AWS → Amazon, an alias kept local to `company-claims.ts` so retrieval is unchanged: a new curated alias in `query/companies.ts` changes attribution flags too.
  - `pnpm seed:build` fails if a seeded finding carries any of these flags (as for period claims). None does; the seeded cloud brief carries 1 ("Says “all three”; cites 2 companies"; evaluation.md §13).
  - Precise over broad: never add a pairing that guesses which value is "from" and which is "to", and keep "about the excerpts" sentences exempt (the period check's rule).
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
- **Log with `log()` (raw stdout).** Tests capture lines with `services/api/src/test-log.ts`; a `console.log` spy sees nothing. (CloudWatch JSON filters match prefixed `console.log` lines too, as tested in production on 2026-10-03, so a stray `console.log` would still be counted; it would just be untidy.)
- **`out/` HTML is rewritten after `next build`** (`node src/build/csp.ts out`). Never hand-edit `out/`. A new inline script anywhere is picked up by the next build. A new runtime `eval` or `new Function` (for example a library JIT) shows as a CSP violation in `security.spec.ts`; Zod must stay `jitless`, set by core's first import.
- **The caption rule is table-scoped.** A bare "(MILLIONS)" counts only as a table header's first cell. Any other scale caption ("(millions of shares)", a row label "(millions)") in the same passage turns the rule off, and it never overrides a preceding unit. Re-score all four prompt versions plus `--set robustness` after any validator change, and compare figure by figure against HEAD.
- **Architecture page numbers are tests.** `measured.test.ts` recomputes every value and every digit in its text from `evals/results/*` and `docs/evaluation.md` §5. Re-running an eval or editing §5 fails the gate until `measured.ts` matches.
- **Robustness plants must not be index chunk IDs** (the CLI refuses). Their position is replayed from the recorded context order, so changing `plant.ts` layout breaks replay of recorded requests (the "last" layout must stay byte-identical; `plant.test.ts` guards it).

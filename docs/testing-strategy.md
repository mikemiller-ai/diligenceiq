# DiligenceIQ — Testing Strategy

> Status: **Phase 4.** Phase 3 added query, retrieval, context, eval and signal tests. Phase 4 adds the generation tests (`packages/rag/src/generation/generation.test.ts`: prompt rules, prompt-file match, gateway, Bedrock stream assembly, repair, figures and citations, every pipeline path), the generation-eval scoring tests, the worker and store tests (`services/api/src/analyses/worker.test.ts`, the integration cases of §4 below with an in-memory store and the fixture index), and the WorkerStack CDK assertions (§5, including the bundle-content test). Earlier status: **Phase 2.** Unit, component, CDK assertion and local Playwright tests exist for the Phase 1 scope (shell, fixture profiles, Compare, Deep Analysis input, Findings, api health and kill switch, cost guard). Phase 2 adds `packages/corpus` (headers, periods, preamble, sections, segmentation, chunker, zip input, financial extraction, trends, drivers, risk headings; synthetic tests plus corpus-backed tests over all 246 files) and `packages/rag` index tests (tokenizer, BM25 round trip, embedding cache, resume and rate limiter, adjacency, validation, summary). Each later phase adds the tests listed for it, and `pnpm gate` grows with them. This file is updated when the plan changes.

## 1. Frameworks

| Layer | Tool | Notes |
|---|---|---|
| Unit + integration (TypeScript) | **Vitest** | Runs in Node, no AWS. Bedrock and AWS SDK clients are injected and mocked. |
| React components | **React Testing Library** (on Vitest, jsdom) | Behavior and accessibility queries (`getByRole`), not snapshots. |
| End-to-end | **Playwright** | Local workflow against the built static export with the API mocked (`pnpm e2e`, part of `pnpm gate`), with axe (`@axe-core/playwright`) and keyboard checks; smoke suite against `https://diligenceiq.mikemiller.ai`. |
| Infrastructure | **CDK assertions** (`aws-cdk-lib/assertions`) on Vitest | Asserts on synthesized templates; no deploy. |
| Retrieval/answer quality | **Eval harness** (`scripts/evaluation`) | Runs the real pipeline against the real index; on demand only. |

## 2. Where tests live

| Location | Contents |
|---|---|
| `packages/*/src/**/*.test.ts`, `services/api/src/**/*.test.ts` | Colocated unit and integration tests |
| `apps/web/**/*.test.tsx` | Component tests |
| `infrastructure/cdk/test/*.test.ts` | CDK assertion tests |
| `tests/e2e/` | Playwright specs (`local/`, `smoke/`) |
| `tests/fixtures/` | **Trimmed real filings** (header + selected sections, cut from `edgar_corpus/`), a small fixture index, and recorded Bedrock-shaped responses. Real text, never invented. |
| `evals/questions.yaml` | Eval questions with expected companies, periods, and abstention flags |

Tests that need the full corpus (e.g. header parsing over all 246 files) read `CORPUS_PATH` and **skip with a visible message** when it is absent, so CI without the corpus still passes the rest.

## 3. Unit tests (targets)

**Corpus (`packages/corpus`)**
- Header and period parsing over **all 246 files**: every file gets a `periodEnd`, its source (header 192 / slug 53 / cover 1), `fiscalYear`, and `fiscalQuarter`. Matches `scripts/ingestion/probe-corpus.mjs`.
- Fiscal labels: NVDA FY2025 = period ended 2025-01-26; AAPL FY2025 = 2025-09-27; WMT FY2025 = 2025-01-31; TGT FY2024 = 2025-02-01 and HD FY2024 = 2025-02-02 (overrides); JNJ FY2021 = 2022-01-02 and FY2022 = 2023-01-01 (January 1–7 rule); DIS 10-Q ended 2022-01-01 = FY2022 Q1.
- URL slug parsing: `aapl-20250927.htm`, `de-20251102x10k.htm`, `msft-10k_20220630.htm`, `gecc10k2014.htm` (no date → cover page).
- Metadata overrides: `GE_10K_2015` → "General Electric Capital Corp (GE Capital)", FY2014, outside the review window.
- Preamble stripping with the tolerant cover-heading pattern on all 246 files (`STATESSECURITIES`, newline, non-breaking-space, and LLY mixed-case variants).
- Section detection: AAPL 10-K and NVDA 10-Q (standard); **JNJ 10-Q and XOM 10-Q produce no Item 1A section** and never anchor on a cross-reference; **MS 10-K** Risk Factors found via the alternate TOC form; AXP and T `1A. | Risk Factors` TOC form; 10-Q Part I/II mapping.
- Boilerplate flag on 10-Q "no material changes" risk-factor text.
- Chunker: size/overlap bounds, sentence and table-row splitting, **the 287,855-character line in `META_10K_2024Q4`** (no chunk exceeds the hard cap; no text lost or duplicated beyond the overlap), contextual header only on the embedded text, deterministic fiscal-label IDs (`NVDA-FY2026Q3-10Q-MDA-012`).

**Financial extraction (`packages/corpus/financials`, DD-17)**
- Golden values for AAPL, NVDA, MSFT, JNJ, and XOM: revenue, operating income, and net income for each 10-K in the corpus, checked against the filing text.
- Unit and scale handling ("in millions"), parenthesized negatives, `$`/`%` cells, and multi-year columns.
- Overlapping-filing cross-check sets `crossCheck: 'mismatch'` above 0.5% and never blocks the build or averages values.
- Every extracted fact carries `scale`, `chunkId`, and `rawRow`; 10-Q comparative columns are extracted (BAC, JPM).
- Unmatched metrics return "not extracted" and are never fabricated.
- Growth and margin math only for comparable periods.
- Trajectory thresholds are locked by tests.

**Change detection (`packages/rag/signals`, DD-18)**
- Heading-diff NEW, REDUCED, and PERSISTENT on fixture heading lists. **With a single 10-K, nothing is PERSISTENT** (L5 regression); the headings appear as `currentRisks`.
- Emphasis deltas respect both thresholds.
- 10-Q boilerplate never yields a signal.
- JNJ and XOM risk signals come from 10-Ks only.
- Single-10-K companies yield no 10-K-vs-10-K signals, but do yield in-filing TREND CHANGE signals, `currentRisks`, and `drivers`.
- Every signal carries `evidenceByPeriod` with chunk IDs for each period compared, and a non-empty `investigateQuestion`.
- Signal types that the Phase 3 go/no-go suppresses are never emitted (config-driven, tested).

**Profiles and Compare (`packages/rag/src/profile`, `packages/core/src/compare.ts`, DD-16, DD-19)**
- The profile validator (`packages/rag/src/profile/validate.ts`, `PROFILE_VALIDATOR_VERSION` 2) rejects:
  - citations outside the supplied set, which is exactly the SOURCE_IDs printed in the user message (the deterministic blocks and the `<filing_excerpts>` headers), recomputed from the request, never read from a stored outcome; a test parses the message and compares;
  - currency or percent figures found neither in the FACTS block nor in a passage that the same item cites **and whose text was in `<filing_excerpts>`** (FACTS ∪ cited excerpt passages); a passage supplied only as an ID grounds nothing. A figure matches only under the verified rules (`exact`, `scaled`, `preceding_unit`); a near match (`unit_unstated`) does not count;
  - a change in points ("N pp", "N percentage points") that FACTS does not print as points; points never match a percentage, or the other way round;
  - figures in words: shares and multiples ("two-fifths", "a quarter of revenue", "doubled") and number words with percent or points ("five percentage points"), but not time phrases ("the last two quarters");
  - every phrase in the canonical banned list (DD-16), from `packages/core/src/vocabulary.ts` ("credit rating of" is not a score).
- **Banned-phrase list, both directions:** each banned pattern has a positive case ("Strong buy", "a 92/100 score", "rated a buy", "investors should sell", "undervalued"); each allow-listed term has a negative case ("share buybacks", "selling, general and administrative", "Apple sells iPhones", "strong demand", "credit ratings"). Deterministic coverage labels ("Strong evidence") and quoted passages are not scanned.
- The deterministic set produces a schema-valid profile for every coverage tier, and "General context" text never names a company or states a figure.
- **Build ledger:** a second run for the same (ticker, `indexVersion`, `profilePromptVersion`) makes no call, even from a fresh process; an interrupted run's call is still counted; a call that errors yields the deterministic fallback with `generationCallCount: 1` and is not retried at that version; there is no `--force` flag and `--max-calls` is required (both checked by spawning the CLI); a version bump is a new key (a ticker spent at version 1 is called once at the current version); `--max-calls` stops the run partway (two companies, cap 1: exactly one call); a claim that errors makes no call and records nothing (`ledger_error`, count 0), and S3's 409 conditional conflict reads as "exists"; a failed outcome write never stops the run and the local copy is reused later; a stored outcome whose request hash differs from the recomputed request falls back (`stale_outcome`) without a call; the ledger bucket is pinned to CoreStack's DataBucket output; `profiles:upload-set` refuses a partial set.
- **Merge:** a model-written item carries the model's citations only; signal evidence stays deterministic; the headline is kept (absent on deterministic profiles). det-v2 templates use the short company name and mention the quarterly report only when there is one, and a test shows that what the model saw (`profileBlocks`) does not depend on any field det-v2 changed.
- **Profile-set pointer:** changing `/diligenceiq/active-profile-set` switches `GET /api/companies/:ticker/intelligence` between `llm-v*` and `det-v*` with no rebuild (mocked SSM, cache expiry).
- **Prompt file match:** `prompts/company-intelligence-prompt.md` equals the runtime profile prompt, as for `prompts/final-diligence-prompt.md`.
- **Compare:** common, distinctive, diverging, management emphasis, and attention ranking are correct on fixture profiles, **including a pair with no change signals** (a deep-tier company vs a limited-history bank, the PDF Q1 shape); a missing profile lands in `missing`; fewer than two profiles → `PROFILE_MISSING`; its handlers never reach a model client.
- **Phase 1 fixture profiles:** a test renders each fixture profile and fails if any numeric figure (currency, percent or percentage points, basis points, scaled amounts, multiples, or any digit in a metric slot) appears without a fact carrying `chunkId` and `rawRow`. Text is scanned per block, so a figure React renders as several text nodes is still caught; only the smallest elements carrying verbatim filing text, dates, filing counts or the version footer are exempt. Fixture headings were a selection in Phase 1; since Phase 2 they are the complete extracted list, whose recall is imperfect, so a test still asserts that the fixture Compare page states no common, distinctive, ranking or derived-question conclusion.

**Query analysis and retrieval (`packages/rag`)**
- Company detection including collisions (assumptions C3): "the target market", "Target's margins", "a T-shaped team", "AT&T and T-Mobile", "visa requirements", "Visa and MA", "meta-analysis", "MS and GS", curated aliases (Google, Facebook, J&J, Coke, Exxon, Lilly, JPMorgan/Chase).
- Sector mapping ("major pharmaceutical companies" → JNJ, PFE, MRK, LLY, ABBV; not TMO/UNH).
- Periods: explicit years, ranges, "since 2023"; **"last two years" for NVDA → FY2024 + FY2025 + FY2026 YTD (Q1–Q3)**; BAC → FY2024 complete + FY2025 YTD; default "current view" per company (JPM = FY2025 10-K only; MCD and PEP exclude their stray 2023 10-Qs).
- RRF fusion (k = 60) ordering and ties; metadata filters as hard filters; topic boosts never filter; boilerplate down-weighting.
- Planner lanes and **lane quotas**: every named company and period represented before score fill. Sector lanes get quota ⌊22 / members⌋, smaller than a single company's.
- **Many lanes (H2):** companies before periods (tier-ordered quota passes); endpoint reduction above 11 company × period lanes with a plan note; 5 companies × 5 years keep each company's first and last period; 14 companies under a short budget all keep their latest period; on the real corpus (BM25), "big tech since 2022" keeps every company's earliest and latest annual period and a 14-company change question represents every company.
- Context builder: shingle-Jaccard dedupe, adjacent merge, **~24K-token budget never exceeded**, untrusted-content block format. `filing_excerpts` tags are defanged, including space, zero-width and soft-hyphen variants, and filing lines that pose as block headers are prefixed. Over the 350 KB snapshot cap the builder degrades: it drops the lowest-scoring fill blocks first and never throws.
- Periods with no filing: a named period falls back to the current view with a stated gap; an empty fiscal-year filter builds no lanes and makes no embedding call.
- Validation: citation validator (unknown IDs removed and flagged), uncited findings flagged, numeric grounding (currency/percent figures present in cited chunks or badged), deterministic JSON repair and `MALFORMED_OUTPUT`.
- `GenerationGateway`: the second call in one analysis throws; the Bedrock client is built with `maxAttempts: 1`.
- **Purpose guard:** a spy on the `GenerationGateway` constructor across every worker handler path (success, error, malformed output, duplicate delivery) sees only `purpose: 'analysis'`.

**Service (`services/api`)**
- Worker claim idempotency: claim succeeds once; a second delivery for the same analysis is acknowledged with no pipeline work and no Bedrock call; claim refused after `deadlineAt`; result write rejected if the claim token no longer matches.
- Stale-job handling: poll marks QUEUED past deadline → `QUEUE_TIMEOUT`; RUNNING → `PIPELINE_TIMEOUT` or `GENERATION_TIMEOUT` (depending on `generationStartedAt`); conditional writes don't overwrite COMPLETE; DLQ handler → `WORKER_FAILED`; `SendMessage` failure → `ENQUEUE_FAILED` + 503.
- Rate limits and spend controls: workspace hourly cap, global daily cap (conditional counter at the boundary), workspace-creation cap, kill switch (api and worker paths, 60 s cache).
- Session: HMAC cookie sign/verify, tampered cookie rejected, reset touches only the caller's partition.
- Phase 5 api routes (`services/api/src/app.test.ts`, `phase5-units.test.ts`): `401 SESSION_REQUIRED` on every session route without a valid cookie or with an expired workspace; the workspace-creation cap; a saved item saved again is `409 ALREADY_SAVED`; a missing context snapshot is `404` with `details.snapshot = 'missing'`; reset deletes the partition but not its `RATE#` counters.
- **No model client from the api:** a unit test walks the api handler's import graph and asserts no Bedrock client, no `@diligenceiq/rag` value import and no worker module.
- API contract: Zod validation and the error-code → HTTP-status map; `POST /api/findings` copies text and citations server-side.
- IC Brief assembly mapping (architecture §8.2) and Markdown output, with no model client reachable from those handlers.
- Profile, compare, thesis, watchlist, and watch-event handlers: Zod limits, partition scoping, `PROFILE_MISSING`, and no model client reachable.
- `POST /api/findings` for **every `FindingSource` variant** (keyFinding, consideration, comparisonRow, signal, executiveView, recommendation, driver, currentRisk, compareRow, watchEvent) copies text and citations from the stored brief or profile, and derives `origin.kind`.
- `POST /api/analyses` accepts every `AnalysisOrigin` variant and stores it; origin never changes retrieval filters.
- `GET /api/evidence/adjacent` returns same-section passages from the previous and next comparable filing (and a 10-Q's same quarter a year earlier), and `null` at the ends of a company's history; tested on AAPL and JNJ over the real corpus (`services/api/src/evidence.test.ts`).
- **Citation integrity (Phase 6):** in the gate, every seeded brief citation and context passage and every committed fixture-profile citation resolves through `GET /api/sources/:documentId` to its exact span (corpus-backed, `REQUIRE_CORPUS=1`). Offline, `pnpm evidence:check` (free, no AWS, no model) checks the whole index build: the index manifest's `chunkerVersion` is the bundled chunker's, every chunk in `chunks.jsonl` is reproduced by the api's evidence store, every adjacency reference resolves to the same section kind and form, and every citation in the seed, the recorded live briefs and all built profile sets resolves (`evals/results/evidence-<iv>.json`). "Recorded live briefs" are the Bedrock generations committed by the live eval runs (`evals/results/generation-<iv>-*.json`); a bracketed citation-like token in a brief that is not a chunk ID fails the check (core `briefCitationIds`, unit-tested). Production analyses in DynamoDB are not covered.
- **Evidence route rules (Phase 6, `services/api/src/evidence.test.ts`):** an absent catalog filing is `404 SOURCE_MISSING` (an unknown ticker or malformed ID is `400`); a citation from another index version is `404` with `details.reason = 'index_version'`; the **manifest guard** answers both routes `index_unavailable` when `index/<iv>/manifest.json` is missing, unreadable, names another index or another `chunkerVersion` (a definite verdict is cached; a read error is not); the 200s carry `cache-control: private, max-age=3600` and errors `no-store`; the S3 readers (evidence and profile sets) read a `403 AccessDenied` as a missing object with a warning, and still throw on other errors. The api bundle check also asserts that the corpus loader and the financial extraction stay out of the bundle (`phase5-units.test.ts`).
- **Evidence in the web (Phase 6, `evidence-phase6.test.tsx`, `evidence.test.tsx`, `landing.test.tsx`, `phase5-states.test.tsx`):** every filing link from a citation carries its index version (`&iv=`); a citation from another version opens the current text with a notice and nothing highlighted; a malformed `#chunk-` escape and overlapping sections render safely (every character once); the missing-filing state uses the §9.1 copy with Go back or Company Intelligence; coverage cells match "FY<year> YTD" to that year's quarterly passages for analyses without per-cell chunk IDs, are buttons only when every counted passage is found, and have accessible names that start with their visible text; supplied-but-not-cited passages open with the `context` provenance; Compare periods distinguishes "no comparable filing" from "the filing has no matching section", follows the WAI-ARIA tabs keyboard pattern, and an adjacent passage offers "Back to comparison" instead of another comparison.
- Thesis and watchlist caps (`LIMIT_REACHED` at 21 theses and 26 watches); `PUT /api/watchlist/:ticker` rejects unknown or malformed tickers; watch events include `kind: 'filing'` from the filing catalog and `kind: 'intelligence'` from profiles.

## 4. Integration tests

Full pipeline (`packages/rag` + `services/api` worker handler) with an **in-memory fixture index** built from `tests/fixtures/` and a **mocked Bedrock** client. Each case asserts `generationCallCount === 1` and exactly one mocked generation invocation:

| Case | Expected |
|---|---|
| Success | COMPLETE brief, valid citations, telemetry populated |
| Bedrock error | FAILED `GENERATION_FAILED`, count 1, no retry |
| Malformed output | FAILED `MALFORMED_OUTPUT` (or repaired), count 1 |
| Duplicate delivery (same message twice, concurrently) | One generation; second delivery acknowledged without work |
| Redelivery after claim (worker "crashed" after claim) | No second generation; record reaches FAILED via the deadline path |

Plus: no-evidence path (`NO_RELEVANT_EVIDENCE`, count 0, no generation call), kill switch flipped while queued (FAILED `ANALYSES_DISABLED`, count 0), and prompt-injection text inside a fixture chunk (it appears only inside the untrusted `<filing_excerpts>` block of the assembled prompt; the model's actual behavior is measured by the eval harness, §7).

## 5. CDK assertion tests (cost and security guard)

Synthesize all stacks and assert:
- **Absent:** OpenSearch (domain/serverless), NAT gateways, EC2 instances, ECS services/clusters, RDS/Aurora, WAF web ACLs, provisioned concurrency, reserved concurrency, EventBridge schedules / scheduled rules.
- **Present:** every log group has explicit 14-day retention; DynamoDB billing mode is PAY_PER_REQUEST with TTL enabled; the worker event source mapping has `batchSize: 1` and `maximumConcurrency: 2`; queue visibility timeout 1080 s and `maxReceiveCount: 3`; the DLQ has its own event source mapping to the dlq-handler.
- **IAM scoping:** Bedrock actions only on the configured inference profile and its foundation-model ARNs plus the embedding model; S3 read-only on `intelligence/*`, the index manifest, and (Phase 6) `index/<indexVersion>/adjacency/*` and `processed/<indexVersion>/*` (api) and `index/*` (worker); no `*` resources on data-plane actions; only the worker can invoke Bedrock; the api Lambda has no Bedrock permission.
- **No profile builder deployed:** no Lambda bundle contains `scripts/intelligence`, the profile prompt builder in `packages/rag/src/profile` (a separate entry, `@diligenceiq/rag/profile`, that the main entry does not re-export), or `prompts/company-intelligence-prompt.md` (bundle-content test over the esbuild metafiles).
- api Lambda IAM (Phase 5): exactly `ssm:GetParameter` (kill switch, active profile set, session secret), `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query/BatchWriteItem`, `sqs:SendMessage`, and `s3:GetObject` on `intelligence/*`, `index/<indexVersion>/manifest.json`, `index/<indexVersion>/adjacency/*` and `processed/<indexVersion>/*` only (exactly four resources; no raw corpus, no other index artifact, no wildcard version); the environment carries the queue URL, the session-secret and active-profile-set parameter names and the global daily cap; CoreStack creates `/diligenceiq/active-profile-set` as `none`; still no Bedrock action.

## 6. End-to-end (Playwright)

**How `pnpm e2e` runs (Phase 5).** Playwright (`playwright.config.ts`, one worker) starts `tests/e2e/local-server.ts` with `tsx`. It serves `apps/web/out` the way Amplify does (trailing-slash `index.html`, `404.html`) and answers `/api/*` with the **real api app** (`createApp` from `services/api`) over in-memory stores, the committed fixture profile set (`tests/fixtures/profile-sets/iv-9cf51c066743/fixture-v2/`) and the real seed. Only the edges are local: the session secret, the stores and the queue. The cookie is not `Secure` on this server only (and so uses the plain name `diq_ws`, not `__Host-diq_ws`). Every browser comes from 127.0.0.1 here, so this server alone lifts the per-client workspace-creation limit. The python `http.server` is no longer used.
- **Stub worker (TEST-ONLY).** The queue goes to a stub that claims the analysis, walks the real stage names and completes it with the stored result of the seed analysis about the **same companies** the question names (in its text, filters or origin). A question about companies no seed covers fails honestly with `NO_RELEVANT_EVIDENCE`; it never returns an unrelated brief. It never calls a model and is never deployed or bundled; the real worker is unit-tested in `services/api` (DD-20). The deployed in-region path (api → SQS → worker → Bedrock) is verified separately with `pnpm analysis:run`, only with Mike's approval.
- **Test controls** (this server only): `GET /__e2e/stats` (including `enqueued`, the analyses handed to the worker), `POST /__e2e/kill-switch?enabled=`, `POST /__e2e/worker?mode=complete|fail|hang`.
- **Page views:** on every P0 page the test asserts that the browser sends only reads plus `POST /api/session`, and that the worker received nothing (`enqueued` unchanged).

**Phase 5 adversary regressions** (unit level): the per-client creation limit, TTL extension and expiry, `META` kept through reset, the `__Host-` cookie, JSON-only bodies, COUNT queries, seed failure, corrupt profiles, seed telemetry, and an esbuild metafile check that the api bundle holds no model client (`services/api/src/app.test.ts`, `phase5-units.test.ts`); the http client's 401 recovery, 204 and absent-resource handling against a mocked fetch (`apps/web/src/lib/workspace-client.test.ts`); poll retry and stop rules, figure badges at every validated location, filters kept by re-runs, the covered-company list (`analysis-states.test.tsx`); a workspace that cannot be opened, cap copy, saved-finding figures and provenance, the missing-source-document state (`phase5-states.test.tsx`).

**Web unit tests** use an in-memory `WorkspaceClient` (`apps/web/src/test/memory-client.ts`) that mirrors the server rules the UI depends on (findings copied with core `resolveSource`, one per source) and records every call, with preloaded workspace state so the first render is synchronous (`apps/web/src/test/render.tsx`).

- **Local** (`tests/e2e/local`: `paths.spec.ts`, `prefill.spec.ts`, `workspace.spec.ts`, `evidence.spec.ts`), with keyboard navigation and axe accessibility checks on each page:
  - **Novice path:** landing → Company Intelligence → select Apple → 30-second view, What's Changed, a signal's Why This Matters and evidence → the Regulatory risk area's "Investigate" → Deep Analysis prefilled and edited → brief about Apple → evidence drawer → save finding.
  - **Expert path:** Deep Analysis with a typed NVIDIA revenue question and filters, to a brief about NVIDIA; its follow-up prefills without running (`paths.spec.ts`, which also opens a seeded brief labeled as run in advance, reaches a seeded brief from Recent analyses, and runs an out-of-corpus question to the `NO_RELEVANT_EVIDENCE` screen that lists the covered companies).
  - **Compare:** AAPL, MSFT, NVDA → launch comparative diligence; TSLA + JPM (no shared change signals) still shows common and distinctive attention areas.
  - **Prefill never auto-submits:** loading `/analysis/new?q=…&tickers=…&origin=…` issues **no** `POST /api/analyses` (network assertion); the request is sent only after clicking Run.
  - **Global "Ask a question"** opens an empty Deep Analysis from every P0 page.
  - **Error and degraded states** (architecture §9.1), driven through the real api and the test controls (hourly cap, kill switch, a failed analysis) or a Playwright-routed request (network failure, a non-JSON 502), plus `PROFILE_MISSING` (a company outside the preview set).
  - **Evidence (Phase 6, `evidence.spec.ts`):** a seeded brief citation → Compare periods → the prior quarter's passage opened in its filing (`&iv=` in the URL and in the source request), highlighted and focused; the cited passage at its exact span; a coverage cell's passages; a missing filing's `SOURCE_MISSING` state; axe on the source view.
  - **Findings Board:** filters.
  - **Phase 8b (P1):** thesis link and watchlist toggle.
  - **Reset.**
- **Prod smoke** (`tests/e2e/smoke`): landing, Company Intelligence for AAPL (profile loads, no model call), compare, a citation opening `/sources/filing` at its passage (the `/sources` explorer is P1, Phase 8b, and is smoke-tested only once built), one real analysis to COMPLETE with valid citations, security headers present. Runs against `https://diligenceiq.mikemiller.ai`.

## 7. Evaluation harness

`scripts/evaluation` runs `evals/questions.yaml` (15–20 questions covering every SPEC §41.1 category: single-company, multi-company, longitudinal, risk, revenue, regulatory, cross-sector, unsupported, ambiguous, and adversarial/injection; including the three assessment PDF examples verbatim) through the real pipeline and writes results to `evals/results/` and `docs/evaluation.md`. Deterministic metrics only:
- **Company coverage:** expected companies present in the context and the brief.
- **Period coverage:** expected fiscal periods present.
- **Citation validity:** share of citation IDs in the context set (target 100% after validation, with pre-validation rate reported).
- **Numeric grounding:** share of figures found in cited chunks.
- **Abstention:** out-of-corpus questions produce `insufficient_evidence` or explicit gaps.
- **Injection resistance:** planted instructions are not followed.
- Generation calls per question (must be 1) and token/latency telemetry.

A retrieval-only mode (no generation) supports the Phase 3 chunking, embedding, and rerank decisions: `pnpm eval:retrieval` (BM25 / cosine / hybrid over the 20 questions), `pnpm eval:chunk-size` (BM25-only chunk sizes) and `pnpm eval:signals` (signal go/no-go on the hand labels). Beyond coverage, which is 1.00 by construction, the retrieval eval reports **gold recall@context**: the share of hand-picked answering chunks (`gold` in `evals/questions.yaml`, 74 passages over 7 questions, chosen before any retrieval output was seen) present in the context, overall and per company. It is scored by character coverage, so it also compares chunk sizes. A question without a cached query embedding is reported as "not embedded" for cosine and hybrid, not as a crash. Results and decisions: [evaluation.md](evaluation.md). The gate re-checks the key outcomes on the real corpus without AWS: multi-company, sector and longitudinal balance in BM25-only retrieval, and the enabled signal detectors staying above the bar.

**Profile evaluation** (`evals/profiles.yaml`, run after a profile build). Pass bars are **provisional** until the first real build and are revisited then:

| Metric | Provisional bar |
|---|---|
| Citation validity: profile citations are index chunks of the company, and model-written citations are inside the request recomputed from the deterministic profile | 100% |
| Figure match: FACTS, or (model text) a passage the same item cites whose text was in the excerpts; points only as points; headline figures in FACTS | 100% |
| Banned-phrase matches in shipped profiles (canonical list, DD-16) | 0 |
| **Signal precision** on the hand-labeled AAPL, NVDA, MSFT set (Phase 3 go/no-go) | ≥ 0.8 |
| Signal recall sanity check on the same set | ≥ 0.5 of labeled real changes found |
| LLM-to-deterministic fallback rate, 12 deep-tier companies | ≤ 25% (revised from 10% after the first build; SPEC A.4) |
| Coverage-tier correctness, recomputed from the index's 10-K and 10-Q document counts (53 profiles: GE Capital is outside the review window and has none) | 53/53 |
| Generation calls per profile (from the ledger) | ≤ 1 |

The SPEC §51.3 expert question ("How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?") is added to `evals/questions.yaml`.

## 8. What runs where

| Suite | `pnpm gate` | On demand | Needs AWS |
|---|---|---|---|
| Unit, component, integration | Yes (`pnpm test`) | | No |
| Full-corpus tests | Yes when `CORPUS_PATH` is present, otherwise skipped with a message | | No |
| CDK assertion tests | Yes (`pnpm test` + `pnpm cdk:synth`) | | No |
| Playwright local (static export, real api in-process, stub worker) | Yes (`pnpm e2e`, after `pnpm build`) | Yes (`pnpm e2e`) | No |
| Playwright prod smoke | | Yes (`pnpm e2e:smoke`) | Yes (deployed app) |
| Eval harness | | Yes (`pnpm eval`) | Yes (Bedrock, real index) |
| Profile build + profile evals | | Yes (`pnpm intelligence:build`, `pnpm eval:profiles`) | Yes (Bedrock, real index) |
| Corpus probe | | Yes (`node scripts/ingestion/probe-corpus.mjs`) | No |

The Phase 0 gate is `scripts/check-docs.mjs` only; the full gate is defined in CLAUDE.md.

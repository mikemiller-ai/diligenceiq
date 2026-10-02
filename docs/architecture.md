# DiligenceIQ — Architecture

> Status: **Phase 0 design baseline, revised 2026-10-01 for the investment-intelligence direction** (DD-15 to DD-19). Nothing below is deployed yet. Sections are marked *(planned)* until the phase that builds them passes its gate; later phases update this file as the source of truth.

DiligenceIQ is an **investment-intelligence** product for a private-equity team. It tells an investor what is happening with a company, what changed, what deserves attention, and why, before they have to ask a question. Deep Analysis then answers any question with retrieval-augmented generation over SEC 10-K/10-Q filings. Journey: **Understand → Notice → Investigate → Verify → Capture → Monitor → Decide** (DD-15). It is not a chatbot.

Two planes use the model:
- **Live (per question):** Deep Analysis, exactly **one** generative call per analysis (§4.1, §5).
- **Offline build (per company, per index version):** Company Intelligence profiles, computed once like the embeddings and only read at runtime (§4.4, DD-16). This plane is an explicit, dated override of three cost-addendum lines (DD-16), and a zero-call deterministic profile set is always built alongside it.

Opening or rendering any page never calls an LLM.

Governing requirements: the Eliza assessment PDF (outer constraint) and [`SPEC.md`](../SPEC.md) (v2, the sole canonical specification; its cost rules are §35, with the offline profile build as the one named exception in §35.7 and DD-16). This document elaborates SPEC v2 and cannot override it. The superseded SPEC v1, cost addendum, and product direction are archived in [`docs/archive/`](archive/). Related: [implementation-plan.md](implementation-plan.md), [testing-strategy.md](testing-strategy.md).

---

## 1. System overview

```text
                         diligenceiq.mikemiller.ai (Route 53, existing mikemiller.ai zone)
                                          │
                     ┌────────────────────▼─────────────────────┐
                     │ AWS Amplify Hosting (static Next.js export)│  CDK: CfnApp / CfnBranch / CfnDomain
                     │  security headers via customHttp           │
                     │  rewrite  /api/<*>  →  HTTP API (same-origin)│
                     └────────────────────┬─────────────────────┘
                                          │  HTTPS, httpOnly session cookie
                     ┌────────────────────▼─────────────────────┐
                     │ API Gateway HTTP API (route throttling)    │
                     └────────────────────┬─────────────────────┘
                                          │
                     ┌────────────────────▼─────────────────────┐
                     │ api Lambda  (Node 22, arm64, ~10 s)        │
                     │  session · workspace · findings · sources  │
                     │  company intelligence + compare (read-only │
                     │  profiles) · thesis · watchlist            │
                     │  kill switch + spend caps · analysis create │
                     │  (202) / poll (lazy deadline enforcement)   │
                     └──────┬──────────────┬──────────────┬──────┘
                            │              │              │
                  DynamoDB (on-demand)   S3 (processed   SQS analysis-queue (visibility 1080 s)
                  single table, TTL      filings,        maxReceiveCount=3 → analysis-dlq
                                         intelligence/
                                         profiles)
                                                              │                    │
                                     event source mapping:    │                    │ event source mapping
                                     batchSize 1,             │                    ▼
                                     maximumConcurrency 2     │        dlq-handler Lambda: mark FAILED
                     ┌────────────────────────────────────────▼──┐
                     │ worker Lambda (Node 22, arm64, 3008 MB, 180 s) │
                     │  1 claim job (conditional QUEUED→RUNNING)   │
                     │    not QUEUED? acknowledge, do nothing      │
                     │  2 load + cache hybrid index from S3        │
                     │  3 deterministic query analysis             │
                     │  4 Bedrock embedding of the query (retrieval)│
                     │  5 hybrid retrieval: BM25 + exact cosine, RRF│
                     │  6 [rerank: off by default] (non-generative) │
                     │  7 context builder + citation IDs           │
                     │  8 persist generationStartedAt, then        │
                     │    ONE Bedrock generation request           │
                     │  9 schema / citation / numeric validation   │
                     │ 10 persist brief + telemetry → idle         │
                     └────────────────────────────────────────────┘
```

Region: **us-east-1** for every stack (matches Mike's other products; Amplify/ACM certificate requirements; Bedrock model availability verified there).

### 1.1 Why this shape

| Concern | Decision | Reason |
|---|---|---|
| Frontend hosting | Amplify Hosting, static Next.js export | House pattern (ResolveIQ, TrustResponse); no server compute to pay for or time out; CDN-served. |
| Long LLM call | Async job: API returns 202, SQS → worker, UI polls | A grounded brief over ~25K input tokens can take 25–45 s+. Amplify SSR and API Gateway both cap requests near 30 s. Same pattern as ResolveIQ / TrustResponse / CareerOps. |
| Search | Pre-built hybrid index in S3, loaded and cached by the worker | ~25K chunks fits in memory; exact search beats ANN on recall; no always-on cluster; nothing to fail mid-demo. See §6 and [design-decisions.md](design-decisions.md) DD-01. |
| State | DynamoDB on-demand, single table, TTL | Usage-billed; TTL cleans demo workspaces with no scheduled job. |
| Same-origin API | Amplify rewrite `/api/<*>` → HTTP API | Lets the session cookie be httpOnly + SameSite without CORS credential gymnastics (CareerOps pattern). Cookie forwarding through the rewrite is verified in Phase 1 (assumptions D9). |
| No Docker | Lambda zip bundles (esbuild) | Docker isn't installed on the build machine; zips are the house pattern. |
| Worker concurrency | SQS event source mapping `maximumConcurrency: 2`, no reserved concurrency | The account's Lambda concurrency limit was **10, shared with other apps**, and is now 1,000 (assumptions D7). The mapping cap still bounds this app's parallelism and Bedrock spend without reserving capacity. |

---

## 2. Repository layout *(planned, built in Phase 1+)*

```text
apps/web/              Next.js App Router (output: "export"), Tailwind v4, shadcn/ui
packages/core/         Shared types + Zod schemas: DiligenceBrief, Analysis, Finding, API contracts
packages/corpus/       Header parsing, period/fiscal labels, section detection, chunker, company catalog, aliases, sectors,
                       financials/ (deterministic table extraction, DD-17), risk-heading extraction
packages/rag/          query/ retrieval/ context/ generation/ validation/ signals/ (change detection, DD-18)
                       profile/ (profile context + validation, DD-16) compare/ pipeline.ts
services/api/          Lambda handlers (api, worker, dlq-handler), DynamoDB repositories, session, observability, local dev server
infrastructure/cdk/    CoreStack, ApiStack, WebStack, WorkerStack (Phase 4: analysis queue, DLQ, worker, dlq-handler) (+ CDK assertion tests)
scripts/ingestion/     probe-corpus.mjs (exists), corpus → processed filings + chunks
scripts/indexing/      Chunks → embeddings (cached, resumable) → index artifacts (incl. adjacency, §6.4) → S3; index summary/validation
scripts/intelligence/  build-profiles.mjs: offline, admin-run Company Intelligence build (DD-16); never deployed
scripts/evaluation/    Eval harness over evals/questions.yaml (Deep Analysis) and evals/profiles.yaml (profiles)
prompts/               final-diligence-prompt.md, company-intelligence-prompt.md + versions/
seed/                  Demo workspace seed (real pipeline outputs, with provenance)
examples/              Ready-to-run example request (`analysis-request.sh`: create an analysis, poll, print the brief) + sample output
evals/                 questions.yaml + recorded eval results
tests/e2e/             Playwright (local workflow + prod smoke)
tests/fixtures/        Trimmed real filings used by unit/integration tests
docs/                  architecture, assumptions, design-decisions, design-tokens, implementation-plan, testing-strategy,
                       evaluation, prompt-iterations, demo-script, future-state, handoffs/
```

Unit and integration tests are colocated (`*.test.ts`) inside each package and service. See [testing-strategy.md](testing-strategy.md).

---

## 3. Corpus facts the design depends on (verified in Phase 0)

Every number here is reproducible with `node scripts/ingestion/probe-corpus.mjs` (reads `$CORPUS_PATH`, default `./edgar_corpus`).

- **246 filings** (89 10-K, 157 10-Q) from **54 companies**, 81,354,556 characters (~79 MB, ~20M tokens at ~4 characters/token).
- **Coverage is uneven:**
  - 12 companies have 14–17 filings each (AAPL, AMZN, DIS, GOOG, JNJ, KO, MSFT, NVDA, PFE, TSLA, UNH, XOM).
  - META has 8 (10-Ks for FY2024 and FY2025, plus six 10-Qs).
  - BAC has 4: a **FY2024** 10-K (period ended 2024-12-31) plus 2025 Q1–Q3 10-Qs. JPM has 4: a **FY2025** 10-K plus 2025 Q1–Q3 10-Qs.
  - MCD and PEP have 2 each: one 10-K plus a stray 2023 Q1 10-Q.
  - 37 companies have exactly one filing, always a 10-K.
- `manifest.json` has `corpus`, `description`, `file_count`, `filing_types`, `files` (filenames only), `license`, and `source`. Its description says "15 companies have full quarterly coverage"; the files show 12 with deep coverage, so the system derives coverage from the files, never from the manifest text.
- **Headers:** `Company`, `Ticker`, `Filing Type`, `Filing Date`, `CIK`, `Source`, and `URL` are on all 246 files. `Report Period` and `Quarter` are on 192. Where both a header period and a URL slug date exist, they agree (192/192). The period end of the other 54 comes from the URL slug (53) or the cover page (1: `gecc10k2014.htm`).
- `Quarter` is the **calendar** quarter of the period end. Fiscal years differ by company, so the system normalizes to `periodEnd`, `fiscalYear`, and `fiscalQuarter` (assumptions B3).
- **Filing dates** run 2015-02-27 → 2026-02-19. All period ends are 2022-01-01 → 2025-12-31 except `GE_10K_2015`, which is General Electric **Capital** Corporation's FY2014 10-K (assumptions, Known corpus anomalies).
- **Text shape:** HTML flattened to text with an inline-XBRL preamble and pipe-delimited tables. The longest line is 287,855 characters (`META_10K_2024Q4`), and 69 files contain at least one line over 90,000 characters, so the chunker can never assume line breaks.
- **Cover heading:** the exact string `UNITED STATES SECURITIES AND EXCHANGE COMMISSION` appears in only 30/246 files (most have `STATESSECURITIES`, a newline, or non-breaking spaces). The whitespace-tolerant, case-insensitive pattern `/UNITED\s*STATES\s*SECURITIES\s*AND\s*EXCHANGE\s*COMMISSION/i` matches 246/246.
- **Section headings:** a naive `Item 1A … Risk Factors` pattern finds a TOC + body pair in 82/89 10-Ks and 124/157 10-Qs; MD&A is found at least twice in 246/246. JNJ and XOM 10-Qs (24 files) have **no Item 1A section**, only cross-references to the 10-K; MS's 10-K uses a TOC form without "Item" (`Risk Factors |  | 1A`). 46/157 10-Qs say risk factors had no material changes.

See [assumptions.md](assumptions.md) §B for how each irregularity is handled.

**Coverage tiers for Company Intelligence** (assumptions G1). These follow from the counts above:

| Tier | Companies | What the dashboard shows |
|---|---|---|
| Deep | the 12 with 14–17 filings (3–5 10-Ks each: JNJ 5; KO, PFE, UNH 3; the rest 4) | Multi-year trends; current risks and drivers; 10-K-vs-10-K changes (NEW, REDUCED, PERSISTENT, emphasis) and the quarters between them |
| Partial | META (8: two 10-Ks), BAC (4), JPM (4), MCD (2), PEP (2) | META: 10-K-vs-10-K changes. BAC and JPM: one 10-K plus 2025 10-Qs, so trends from the 10-K's columns and current-year trends from the 10-Qs' comparative columns, plus 10-Q-vs-10-Q emphasis and outlook changes. MCD and PEP: as limited history (their stray 10-Q predates the 10-K). All: current risks, drivers, in-filing trend changes |
| Limited history | the 37 single-10-K companies | Trends from the 10-K's own multi-year tables; **current risks** (the latest 10-K's risk headings, grouped by category, each cited); **drivers** (MD&A segment/product rows with the largest reported change, each cited); in-filing TREND CHANGE signals; recommended diligence from those. What's Changed says "Limited history: one annual report in the corpus" and shows only in-filing changes |

So every dashboard has a performance view, a cited risk section, drivers, and recommended diligence. Filing-to-filing change sections are full only where two comparable filings exist (13 of 54 companies have two or more 10-Ks).

---

## 4. Request flows

### 4.1 Run an analysis *(worker built in Phase 4; the api routes, sessions and caps built in Phase 5: `services/api/src/app.ts`)*

```text
Browser                         api Lambda                         SQS        worker Lambda                     Bedrock
  │ POST /api/analyses  ───────▶ validate (body ≤16 KB, Zod, ≤1,000 chars, tickers in the catalog)
  │                              kill switch (SSM, cached 60 s)
  │                              caps: workspace hourly, global daily (conditional counters)
  │                              put ANALYSIS (QUEUED, queuedAt, deadlineAt = queuedAt + 240 s)
  │                              send message ─────────────────────▶ │
  │ ◀── 202 {analysisId, pollAfterMs: 1500}  (send fails → mark FAILED ENQUEUE_FAILED, 503 + requestId)
  │                                                                 └──▶ claim (QUEUED→RUNNING + claimToken, conditional)
  │ GET /api/analyses/:id (poll ~1.5 s)                                  stage=analyzing   query analysis + lane plan
  │ ◀── {status, stage}  (past deadlineAt → lazily mark FAILED)          stage=retrieving  embed query ───────▶ embed (retrieval)
  │                                                                                        + hybrid search per lane (RRF)
  │                                                                      stage=balancing   context builder: lane quotas, caps, dedupe, budget
  │                                                                      stage=context     lane report + scope + user message
  │                                                                      stage=generating  persist generationStartedAt,
  │                                                                                        ONE request ───────▶ Claude (generation)
  │                                                                      stage=validating  schema/citations/numbers
  │ ◀── {status: COMPLETE, brief, interpretation, coverage, telemetry}   persist (conditional on claimToken)
```

The stages shown in the UI are the stages the worker actually writes (Phase 4): `queued` (before the claim), `claimed`, `loading_index` (cold start only), `analyzing`, `retrieving`, `balancing`, `context`, `generating`, `validating`, then `complete` or `failed`. There is no fake progress. Each stage is written when its work starts (`packages/rag/src/retrieval/retrieve.ts`; SPEC §38.1):
- `analyzing` ("Interpreting the question…"): deterministic query analysis and the company × period lane plan. The plan is part of reading the question: it decides which filings each lane may search, so it must precede the search.
- `retrieving` ("Searching SEC filings…"): the one query embedding (10 s timeout, BM25 fallback) and the filtered hybrid search of every lane.
- `balancing` ("Balancing evidence across companies and periods…"): the context builder fills each lane's quota (companies before periods), applies per-company caps, removes near-duplicates and keeps the token budget.
- `context` ("Preparing source context…"): the lane report and snapshot, then the scope description and user message with the `<filing_excerpts>` block.

The deterministic steps take milliseconds; the embedding and the generation dominate, so `retrieving` and `generating` are the stages a user actually sees for long. Cold-start index loading happens inside the async job and shows as the first stage; its duration is measured in Phase 2. A user-triggered prewarm is a documented future option, not part of v1.

**Phase 5 implementation (`POST /api/analyses`).** In order:
1. Body ≤ 16 KB and Zod (`CreateAnalysisRequestSchema`). Every ticker in `filters` and in `origin` must be in the core company catalog (`packages/core/src/generated/catalog.json`, 54 tickers, built by `scripts/fixtures/build-catalog.mjs`); otherwise `400 VALIDATION_ERROR`.
2. Kill switch: off → `503 ANALYSES_DISABLED`, before any counter moves.
3. Workspace hourly counter `WS#<id> / RATE#<yyyy-mm-ddThh>` (default 10), then the global daily counter `GLOBAL / RATE#<yyyy-mm-dd>` (default 200). Each is a conditional `ADD` (`attribute_not_exists(n) OR n < :cap`); at the cap the answer is `429 RATE_LIMITED` with `details: { scope: 'workspace_hourly' | 'global_daily', retryAfter }`. Counters are never refunded.
4. `createQueued`. The analysis ID is 9 base36 characters of milliseconds plus 10 random base64url characters, so IDs sort by creation time (`services/api/src/ids.ts`).
5. `SendMessage` (IDs only). On failure, `failQueued` marks it `ENQUEUE_FAILED` and the response is `503 ENQUEUE_FAILED` with `details.analysisId`.
6. `202 { analysisId, status: 'QUEUED', pollAfterMs: 1500 }`.

The Deep Analysis page polls every 1.5 s while the analysis is QUEUED or RUNNING and shows the stage the record carries. A failed poll (network) shows "Connection lost" and retries every 3 s; the analysis continues server-side.

### 4.2 Everything else at runtime is deterministic and LLM-free

All of the following run as plain api-Lambda reads and writes against DynamoDB and S3, with **no LLM call** and no Bedrock permission on the api Lambda:
- reading a Company Intelligence profile;
- composing Compare (DD-19);
- saving a finding from any origin, and updating its status or notes;
- thesis and watchlist CRUD;
- watchlist intelligence events;
- the brief coverage matrix and the P1 Diligence Gaps matrix;
- adjacent-period passage lookup for evidence (§6.4 adjacency);
- pinning to the IC Brief and assembling it (§8.2);
- the Sources explorer;
- reset.

### 4.3 Job lifecycle and stuck-job handling *(built in Phase 4: `services/api/src/analyses/store.ts`, `worker.ts`, `dlq-handler.ts`)*

`QUEUED → RUNNING → COMPLETE | FAILED`. Every transition is a DynamoDB conditional write, so concurrent writers (worker, poll, DLQ handler) cannot overwrite each other.

| Situation | Who acts | Result |
|---|---|---|
| `SendMessage` fails in `POST /api/analyses` | api Lambda | Analysis marked `FAILED` (`ENQUEUE_FAILED`); the response is an error with `requestId`. |
| Message waits in the queue past `deadlineAt` | Next `GET /api/analyses/:id` | Conditional write `status = QUEUED AND deadlineAt < now` → `FAILED` (`QUEUE_TIMEOUT`). A later delivery finds it not QUEUED and is acknowledged without work. |
| Worker claims too late to finish | Worker | Claim requires `deadlineAt > now`. Before generation the worker checks that the remaining time (bounded by `deadlineAt` and the Lambda's remaining time) covers the generation budget; otherwise it fails the job **without** calling Bedrock. The Bedrock call is aborted at that budget, so a healthy worker always finishes before `deadlineAt`. |
| Worker dies mid-job (crash, timeout) | Next poll after `deadlineAt` | `RUNNING` → `FAILED`: `GENERATION_TIMEOUT` if `generationStartedAt` is set, otherwise `PIPELINE_TIMEOUT`. |
| Message redelivered (visibility timeout expired, duplicate delivery) | Worker | Claim fails because the analysis is not QUEUED, or is past `deadlineAt` (the 1080 s visibility timeout always exceeds the 240 s deadline) → acknowledge, no work. Redelivery is never a recovery path; see DD-04. |
| Invoke throttled before the claim (account concurrency, now 1,000, is shared) | Next poll after `deadlineAt` | `QUEUED` → `FAILED` (`QUEUE_TIMEOUT`). No silent retry. The user re-runs, which creates a new analysis. |
| Worker fails before claiming, 3 times | SQS → DLQ → dlq-handler Lambda | Analysis marked `FAILED` (`WORKER_FAILED`) if still QUEUED/RUNNING. Event-driven, not scheduled. In practice the poll got there first (see below). |
| Kill switch unreadable in the worker (SSM error) | Worker | The QUEUED job is failed at once as `WORKER_FAILED` ("The analysis could not be started. Run it again."), with no claim and no spend. It is not reported as "paused" (`ANALYSES_DISABLED` is only for an explicit "off"), and it is not thrown for a redelivery, which would arrive after the deadline and surface only as `QUEUE_TIMEOUT`. The api keeps failing closed on a read error. |
| Generation-start write fails (not a lost claim) | Worker | The model is **not** called. A `ClaimLostError` means the claim was lost: nothing is written. Any other error (a throttled or failed DynamoDB write) fails the job `WORKER_FAILED`, with the detail "the model was not called". If that write actually landed and only its response was lost, the record keeps `generationStartedAt` and `generationCallCount = 1` (persisted before the call, so an upper bound), while `telemetry.generationCallCount` is 0: the gateway never handed the request to the client. |
| Context snapshot write fails after `complete` | Worker | The analysis stays `COMPLETE`. The snapshot is written only after the conditional `complete` succeeds (so a lost claim leaves no orphan snapshot), retried once, then logged (`context_snapshot_missing`; the summary carries `contextStored: false`). A missing `CONTEXT#` item means "snapshot unavailable"; the cited passages are still in `citations[]`. |
| Worker finishes after the record was marked FAILED | Worker | Final write is conditional on `status = RUNNING AND claimToken = mine`, so it is rejected; the outcome is logged. |

**Phase 4 implementation.** Every transition above is a conditional write in `DynamoAnalysisStore` (a `MemoryAnalysisStore` with the same conditions backs the tests). The worker claims before any fallible work; only a failure of the claim write itself throws (SQS redelivers, at most 3 times, then the DLQ handler). Before generation it checks that the time left (the earlier of `deadlineAt` and the Lambda's remaining time, less 5 s) covers the 120 s generation budget plus a 10 s finish margin; the request is aborted at 120 s (`GENERATION_TIMEOUT`). A failing query embedding falls back to BM25-only retrieval, stated in the Interpretation panel (assumptions A1). `expireIfPastDeadline` is the poll path's lazy expiry; since Phase 5 `GET /api/analyses/:id` runs it for a QUEUED or RUNNING record past `deadlineAt`.

**Redelivery and the DLQ in practice.** With a 1080 s visibility timeout, every SQS redelivery arrives after the 240 s `deadlineAt`, so a redelivered message can never be claimed. A worker that throws before its claim is therefore not "retried" in any useful sense: the next poll after `deadlineAt` marks the job `QUEUE_TIMEOUT` (or, once claimed, `PIPELINE_TIMEOUT` / `GENERATION_TIMEOUT`). The DLQ handler only records poison messages whose claim write itself failed three times, and usually finds the analysis already FAILED. **The poll's lazy expiry is the real recovery path.**

`generationStartedAt` and `generationCallCount = 1` are persisted **immediately before** the Bedrock call. If the worker crashes after that write, the record honestly shows that a generation was attempted. `generationCallCount` is 0 for jobs that failed before generation and never exceeds 1.

### 4.4 Offline Company Intelligence build *(planned: Phase 4b)*

An admin runs this from a workstation after an index build, never from a deployed Lambda or a schedule (DD-16):

```text
index/<indexVersion>/ ──▶ for each company (--max-calls budget required; no --force)
                           1 deterministic facts        packages/corpus/financials (DD-17)
                           2 signal candidates           packages/rag/signals (DD-18), evidenceByPeriod
                           3 current risks + drivers     latest 10-K risk headings; MD&A segment/product rows (cited)
                           4 deterministic profile       template library → intelligence/<indexVersion>/det-v<templateVersion>/<TICKER>.json
                           ── LLM set only ──
                           5 ledger entry                conditional create (If-None-Match) of the immutable object
                                                         intelligence/ledger/<indexVersion>/<profilePromptVersion>/<TICKER>.json;
                                                         already exists → no call (a prior run already spent it)
                           6 balanced evidence           fixed topic lanes × periods, same hybrid retrieval as §6.6
                           7 context block               same untrusted-content format as §6.7, plus FACTS, SIGNALS, RISKS, DRIVERS blocks
                           8 ONE generation request      submit_company_profile (forced tool), maxAttempts 1,
                                                         GenerationGateway purpose='profile'
                           9 validate                    schema · citations ⊂ supplied · figures ⊂ facts · banned phrases (DD-16)
                              └─ fails → the deterministic profile from step 4, generation.mode='deterministic'
                          10 write                       S3 intelligence/<indexVersion>/llm-v<profilePromptVersion>/<TICKER>.json
                         manifest.json per set: per-company mode, call count (0 or 1, from the ledger), tokens, model, durations, validation
```

At runtime the api Lambda reads the active set named by the SSM parameter `/diligenceiq/active-profile-set` (`<indexVersion>/<profileSetId>`, cached 60 s; read-only IAM on `intelligence/*`) and caches profiles in memory. Switching between the `llm-v*` and `det-v*` sets is a parameter change, with no rebuild or deploy. A profile is never regenerated because someone opened a page. It is regenerated only when the index version or the profile prompt version changes. An admin "refresh" (SPEC §32.5) is a `profilePromptVersion` bump, which is a new ledger key; the same key is never called twice.

**Runtime read path (built in Phase 5: `services/api/src/profiles/provider.ts`).** The builder above is still Phase 4b; the read side exists now.
- **Pointer.** CDK `CoreStack` creates `/diligenceiq/active-profile-set` with the value `none` (no set active). A value must match `iv-…/(llm|det|fixture)-vN`; anything else reads as no set. The pointer is cached 60 s, and a read error keeps the last good value.
- **Manifest.** `intelligence/<indexVersion>/<profileSetId>/manifest.json`, validated by `ProfileSetManifestSchema` in `packages/core`: `indexVersion`, `profileSetId`, `builtAt`, `companies[{ ticker, company, sector, tier, filings, periodsCovered, headline?, mode: llm | deterministic | fixture, generationCallCount: 0 | 1 }]`. Unknown fields are ignored, so the Phase 4b builder can add its per-company telemetry; **Phase 4b must write this format.** A manifest whose `indexVersion`/`profileSetId` disagree with the pointer is rejected.
- **Profiles.** `<TICKER>.json` in the same folder, schema- and integrity-checked on load (and its ticker and `profileSetId` must match). A bad file reads as missing (`PROFILE_MISSING`), never as content. A set is immutable once built, so the manifest and profiles are cached per warm container while the set stays active.
- **Preview set until Phase 4b.** The active set is the preview set `fixture-v2`: the web's fixture profiles, exported unchanged by `pnpm profiles:export-fixture` to `tests/fixtures/profile-sets/iv-9cf51c066743/fixture-v2/` and uploaded with `pnpm profiles:upload-set` (dry run unless `--yes`; each object `If-None-Match: *`; the manifest last; it does not switch the pointer, which is a separate `aws ssm put-parameter`). Phase 4b's `det-v*` and `llm-v*` sets use the same layout; switching is the pointer (DD-20).

---

## 5. Single-call guarantee (defense in depth) *(built in Phase 4)*

Assessment rule: the final answer comes from **exactly one generative LLM API request** per analysis. Query embedding (and, if ever enabled, reranking) is retrieval, not generation. Both are non-generative model calls and are documented and counted separately.

| Layer | Mechanism | What it prevents |
|---|---|---|
| Queue | Event source mapping `batchSize: 1`, `maximumConcurrency: 2`; visibility timeout 1080 s (6 × the 180 s worker timeout); `maxReceiveCount: 3` → DLQ | Unbounded redelivery. Redelivery is bounded, and the claim below makes any redelivery harmless. |
| Worker | Conditional claim `status = QUEUED AND deadlineAt > now → RUNNING` with a fresh `claimToken`; a message whose analysis is not QUEUED is acknowledged without work | Duplicate delivery or redelivery producing a second generation. **This is the layer the guarantee rests on.** |
| SDK | Bedrock runtime client for generation with `maxAttempts: 1` | AWS SDK silently retrying a throttled/failed call (each retry is a new API request) |
| Code | `GenerationGateway` per-analysis counter, throws on the 2nd call | Any code path invoking the model twice |
| Pipeline | No query rewriting, planning, critique, or repair LLM calls; JSON repair is deterministic | Hidden extra LLM calls |
| Telemetry | `generationCallCount` persisted before the call and logged | Proves the constraint per run |
| Tests | Unit + integration tests assert exactly one invocation on success, error, malformed output, duplicate delivery, and redelivery after a claim | Regressions |

A failed generation becomes a clear error state with a request ID. Re-running is an explicit user action that creates a **new** analysis.

**Phase 4 implementation.** `GenerationGateway` (`packages/rag/src/generation/gateway.ts`) takes its one call from the budget before `beforeCall` runs, so two concurrent calls can never both reach the client; `beforeCall` persists the start and, if it fails (claim lost), the model is never called. `BedrockGenerationClient` sends one `ConverseStream` request on a runtime built with `maxAttempts: 1`. The worker logs one `analysis_summary` event per analysis; a CloudWatch metric filter counts events with `generationCallCount > 1` and an alarm fires on any (its notification target arrives with the Phase 8 alerts). Tests: `packages/rag/src/generation/generation.test.ts` (gateway, client, pipeline paths) and `services/api/src/analyses/worker.test.ts` (success, Bedrock error, malformed output, concurrent duplicate delivery, redelivery after a claim and after a crash mid-generation, late delivery, kill switch, index failure, no evidence, lost claim; a constructor spy sees only `purpose: 'analysis'`); `infrastructure/cdk/test/stacks.test.ts` checks the queue settings, the IAM scope and that no bundle carries the profile builder.

**Abort and the "write nothing" rule.** The request is aborted at the 120 s budget. `BedrockGenerationClient` stops reading the stream on the abort and throws `AbortError`; and if any client returns after the abort (a stream that ends cleanly instead of throwing), the pipeline still treats it as `GENERATION_TIMEOUT` and discards the output, so a cut-off brief is never validated as `MALFORMED_OUTPUT`. Only a lost claim (`ClaimLostError`, matched with `instanceof` by the worker) makes the pipeline return `CLAIM_LOST`; any other `beforeCall` failure is a `WORKER_FAILED` job with no model call (§4.3).

**Idle cost of the worker plane.** Nothing runs on a schedule, but the two SQS event source mappings (the work queue and the DLQ) long-poll continuously. Those are billed SQS requests, at most a few cents a month (often inside the SQS free tier), and with the ~$0.10/month CloudWatch alarm on `generationCallCount > 1` they are the worker plane's whole idle cost (§13.1).

**Scope.** This guarantee covers every live analysis. The offline profile build (§4.4) is a separate, admin-run plane with its own one-call-per-profile rule. It uses the same `GenerationGateway` class with `purpose: 'profile'`, `maxAttempts: 1`, and per-profile call counts in the build manifest. The worker only ever constructs a gateway with `purpose: 'analysis'` (a unit test spies on the gateway constructor across the worker handler's paths), and a bundle test asserts that no deployed bundle includes `scripts/intelligence`, `packages/rag/profile`'s prompt builder, or `prompts/company-intelligence-prompt.md`.

---

## 6. RAG design *(§6.1–6.4 built in Phase 2; §6.5–6.7 built in Phase 3; §6.8–6.9 built in Phase 4)*

### 6.1 Ingestion (offline, admin-run)
1. **Parse the header block.** Apply the metadata override table for known anomalies (e.g. `GE_10K_2015` → "General Electric Capital Corp (GE Capital)", FY2014, outside the review window).
2. **Derive the period end** in this order: header `Report Period` → URL slug date (`aapl-20250927.htm`, `de-20251102x10k.htm`, `msft-10k_20220630.htm`) → cover-page "For the fiscal year/quarterly period ended <date>" (`gecc10k2014.htm`) → filing date (last resort, flagged). Then derive `fiscalYear` and `fiscalQuarter` (assumptions B3) and keep `calendarQuarter` as metadata.
3. **Strip the XBRL preamble:** the body starts at the first match of `/UNITED\s*STATES\s*SECURITIES\s*AND\s*EXCHANGE\s*COMMISSION/i`.
4. Normalize non-breaking spaces and whitespace.
5. **Section detection** by character offset:
   - Skip table-of-contents occurrences and pick the body heading followed by substantive text.
   - **Never anchor on a cross-reference** ("discussed under Item 1A. Risk Factors of ExxonMobil's 2023 Form 10-K"). JNJ and XOM 10-Qs have no Item 1A section; they get none rather than a false one.
   - Recognize TOC forms without "Item" (MS 10-K: `Risk Factors |  | 1A`; AXP and T: `1A. | Risk Factors`) and locate the matching body heading, rather than falling back to the whole file.
   - Map 10-Q Part I / Part II items (Part I Item 2 = MD&A, Part II Item 1A = Risk Factors). Text outside detected sections is `Other`.
6. **Boilerplate flag:** 10-Q Item 1A chunks that state there have been no material changes to the risk factors are stored with `boilerplate: true`.
7. Best-effort subsection breadcrumbs (e.g. "Liquidity and Capital Resources").
8. Write processed filing text + section offsets to S3 for the Sources viewer. The ingestion summary reports detection results per filing.

**As built (Phase 2, `packages/corpus`, `scripts/ingestion/ingest.ts`):**
- Input is `CORPUS_PATH`, a directory or the zip (a dependency-free ZIP reader). The manifest completeness check fails the run on a missing or extra file.
- Headings are classified by **title**, not item number, because the numbers differ between a 10-K and a 10-Q. A running page header ("PART I Item 1A") never ends a section, because only an explicit list of standard item titles counts as a boundary.
- **TOC entries are skipped:** a `|` row ending in a page number, or followed by another `|` row; a title that wraps onto the next lines before its page number (GS: `Item 7 |` / `Management’s Discussion…` / `and Results of Operations | 62`); and an `Item` match inside a dense TOC cluster (at least four within ~3,000 characters, at least half TOC-shaped, TOC rows on both sides).
- **Cross-references are skipped:** a reference word, an opening quote, a comma, colon or semicolon, or a lowercase word right before the `Item` (JNJ "…operating results under: Item 7."; ORCL "…as well as our discussion in Item 7"); or, after the full title, "of this Report", "in this Annual Report", "and Note 13…", "both included elsewhere" (JNJ, ORCL).
- **One heading per kind, in canonical order.** The `Item` headings chosen are the longest sequence that follows the standard item order (10-K: Business, 1A, 1C, 2, 3, 7, 7A, 8, 9A; 10-Q: Part I items in any order, then Part II Legal Proceedings, then Risk Factors), earliest first among equals. A cross-reference to Item 7 inside Item 1 cannot claim MD&A, because the real Risk Factors heading follows it.
- **Stubs fall back to bare headings.** An `Item 7` (or 10-K `Item 1A`) under 1,500 characters ("Reference is made to…", the integrated-report 10-Ks of XOM, CVX, DE, BAC, INTC, MCD, MS; JPM's 10-K) falls back to the bare title heading (Title Case or UPPER CASE, at a line start or glued to its first sentence; JPM's sentence-case running title "Management’s discussion and analysis" only at a line start). An `Item 8` under 1,500 characters, or none (DIS, BLK, NVDA, ORCL, PEP, the integrated reports), falls back to the bare heading that opens the statements after MD&A ("Financial Statements and Supplementary Data", "Index to Financial Statements", "Report of Independent Registered Public Accounting Firm" unless it is the internal-control or schedule report, "CONSOLIDATED STATEMENTS OF INCOME/OPERATIONS/EARNINGS", "STATEMENTS OF CONSOLIDATED INCOME"), at a line start or after page furniture; the candidate that opens the longest section wins. There is no bare-title fallback for Legal Proceedings: it relabeled financial-statement notes (AMZN, BA, CSCO, ADBE, NFLX, TSLA) as Legal Proceedings.
- **Gaps are reported.** `sectionGaps()` lists expected sections (MD&A for every filing; Risk Factors and the statements for a 10-K) that are missing or under 1,500 characters, so a filing whose MD&A is incorporated by reference is visible rather than silently thin.
- Detection over all 246 files (chunker `c2`): every filing has MD&A (246/246) and financial statements (246/246); every 10-K has Risk Factors (89/89); 10-K Business 86/89 (INTC, MCD and MS have no Business item heading). The only reported gap is IBM's 10-K: its MD&A (210 characters) and statements (357 characters) are incorporated by reference to IBM's Annual Report to Stockholders, which is not in the corpus. In every 10-K the `Item` headings follow the canonical order; INTC and MCD use an integrated layout whose bare-title MD&A precedes Risk Factors. The 24 JNJ and XOM 10-Qs get no Risk Factors section (133/157 10-Qs have one).
- **Chunk offsets index into the processed text** (the body from the cover heading on, whitespace-normalized), which is what is written to S3 for the readable source view.

### 6.2 Chunking
- Target **~900 tokens (~3,600 characters)** with **~120-token overlap**, split on paragraph, then sentence, boundaries. Pipe-delimited tables are kept intact when they fit, otherwise split on row boundaries.
- Lines are not paragraphs: a single line can be 287,855 characters, so the splitter works on sentence and table-row boundaries inside lines and enforces a hard character cap.
- A contextual header (`Apple Inc · 10-K FY2022 · Item 1A Risk Factors › Supply chain`) is prepended to the text used for embedding and BM25. The citation text shown to users is the raw passage.
- Rationale: a risk factor or MD&A argument, together with its supporting numbers, usually fits in one citable unit. At this size ~25–30 chunks fit in a ~24K-token context, which leaves room for multi-company and multi-year balance.
- **Phase 3 decision: keep `c2`, on cost, not on a measured win.** The BM25-only chunk-size experiment (`pnpm eval:chunk-size`; 1,800 / 2,700 / 3,600 / 5,400 characters at the same budget) slightly favors other sizes: `c2` passes the fewest questions (16/20) and has the lowest evidence hit rate, and 5,400 characters beats it on passing, evidence, section precision and on-topic share. `c2` has the highest gold recall (29 of 74 hand-picked passages against 23–25), a weak signal on a small set. The experiment is lexical only. `c2` stays because re-embedding another size costs ~$0.44 and an hour with no hybrid-mode evidence it would help, and because 5,400-character chunks cut the context from 22 blocks to 15, which squeezes sector and longitudinal questions. Details: [evaluation.md](evaluation.md) §2.
- **As built (chunker `c2`):** target 3,600 characters, overlap 480 characters (unit-aligned, so a chunk is always a verbatim slice), hard cap 6,000 characters, a final chunk under 900 characters folded into the previous one. Units are sentences inside paragraphs; paragraphs split at line breaks and at glued breaks (`…stock price.The Company…`); a table is one unit when it fits under the cap. A line is a table row only when its pipes are dense, so a prose line that carries a page footer ("Apple Inc. | 2025 Form 10-K | 5") is still split into sentences. `c2` (from `c1`) changes only the section boundaries (§6.1), which renumbers chunk IDs. Result: 25,404 chunks over 246 filings (median 3,451 characters, max 5,972); 28 boilerplate chunks. A section with more than 999 chunks fails the run (the ID has three digits).

### 6.3 Chunk / citation IDs
- Human-readable and built from **fiscal** labels: `AAPL-FY2025-10K-1A-004`, `NVDA-FY2026Q3-10Q-MDA-012`. The citation ID shown to the model **is** the chunk ID.
- IDs are stable within an `indexVersion`. A re-index (new chunker or embedding version) may renumber them, so evidence never depends on the live index after the fact: each analysis stores a context snapshot (§8), and each saved finding stores its cited passage text, source metadata, and `indexVersion`.
- Metadata: `chunkId, documentId, company, ticker, cik, sector, filingType, filingDate, periodEnd, fiscalYear, fiscalQuarter, calendarQuarter, section, sectionCode, subsection, boilerplate, sourceFile, chunkIndex, charStart, charEnd, text`.

### 6.4 Index artifacts (S3 `index/<version>/`)
- `vectors.bin`: Float32 matrix, **Amazon Titan Text Embeddings v2** (`amazon.titan-embed-text-v2:0`), 1024 dimensions, normalized. Dimension and quantization are confirmed in Phase 2 against load time. Cohere Embed v4 was not evaluated in Phase 3 (quota and cost; DD-08, evaluation.md §2).
- `bm25.json` + `bm25-postings.bin`: precomputed inverted index. The JSON holds the vocabulary, document frequencies, posting offsets, document lengths and parameters (k1 1.2, b 0.75); the binary file holds the postings (Uint32 chunk indexes, then Uint16 term frequencies), because ~8M postings as a JSON array would be several times larger and slower to parse on a cold start. The tokenizer (`packages/rag`, version `t2`: decimals such as `1.2` stay one token, dotted abbreviations fold (`U.S.` → `us`), and the negations `no`, `not`, `nor` are kept) is shared by the indexer and the query path.
- `chunks.jsonl`: chunk metadata + text.
- `adjacency/<TICKER>.json`: for each chunk, the top 3 chunks of the **same section** in the previous and the next comparable filing of the same company, ranked by cosine similarity of the stored embeddings. "Comparable" means the adjacent filing **of the same form** by period end: 10-K ↔ 10-K (prior/next fiscal year) and 10-Q ↔ 10-Q (prior/next quarter, so a Q1 10-Q's `previous` is the prior year's Q3 10-Q; there is no Q4 10-Q). For 10-Qs a third side, `sameQuarterPriorYear`, gives the year-over-year comparison (same fiscal quarter, one fiscal year earlier; null for 10-Ks or when that filing is not in the corpus). Computed offline at index build, no model call. It backs `GET /api/evidence/adjacent` (§9) for adjacent-period comparison of brief citations.
- `summary.json`: the index summary (SPEC §24.4): documents, chunks, companies, fiscal years, filing types, and detected sections per filing, plus any filing missing an expected section.
- Index version: `iv-` + the first 12 hex characters of sha256(chunks hash, tokenizer version, embedding model, dimensions), where the chunks hash is a sha256 over `chunks.jsonl` as produced plus every chunk's embedded text (contextual header + passage). Because it is derived from the chunks themselves, any change to section detection, segmentation, headers, fiscal labels or IDs yields a new version, so chunk IDs and text are immutable within a version (SPEC §25.2). `pnpm ingest` records it in the ingest report; `pnpm index:build` re-derives it from `chunks.jsonl` and the current `EMBEDDING_MODEL_ID` and refuses to build on any mismatch.
- The CLIs are `pnpm ingest`, `pnpm index:embed`, `pnpm index:build`, `pnpm index:upload`. The build writes to a temporary directory, validates the artifacts it wrote (counts, unique IDs, unit-norm finite vectors, hard cap, adjacency references), and only then writes a `VALIDATED` marker and moves the directory to `.index/build/<version>/`; a failed build leaves nothing there. `index:upload` (dry run unless `--yes`) refuses a build without the marker or whose files differ from the manifest, stores each object's sha256 as S3 metadata, skips an existing key with the same sha256, refuses (before writing anything) if any existing key has a different sha256, writes with `If-None-Match: *`, and uploads `manifest.json` last. The cold load (`loadIndex`) verifies each artifact's byte length and sha256 against the manifest before parsing.
- `manifest.json`: index version and the chunks hash it derives from, corpus hash, chunker and tokenizer versions, counts, per-artifact bytes and sha256, and embedding figures named for what they are: `embeddedTexts` (unique texts, one vector each) and `inputTokens` (the tokens the model reported for those texts, from the cache), plus `embedRuns`, the sum of the per-run log `.index/cache/embed-runs.jsonl` (attempts including retries and failures, successful calls, billed tokens). The run log only covers runs since it was introduced and spans the whole cache for the model, so it can include other versions' texts.

**Indexing is resumable and cached.**
- Embeddings are cached by `sha256(embedded text + model id)`, so re-chunking only embeds chunks whose text changed.
- The indexer checkpoints progress and rate-limits itself to the model's quota (Titan v2: 300,000 tokens/minute, so a full ~20M-token build takes over an hour); every attempt, retries included, acquires the limiter, and `--max-calls` is a hard cap on attempts. An interrupted run resumes from the checkpoint.
- One writer at a time: a live `index:embed` holds an exclusive lock file next to the cache (pid, host, start time), released on exit, SIGINT/SIGTERM and error; a second run fails fast. A stale lock from a dead process is reported with instructions, not removed automatically. `--dry-run` and `index:build` open the cache read-only and never write to it.

Documents are re-embedded **only** when their embedded text or the embedding model changes. Never on deploy, never per request.

### 6.5 Deterministic query analysis (no LLM)
- **Companies:** alias table generated from file headers (legal names, suffix-stripped names, tickers) plus curated aliases (Google→GOOG, Facebook→META, JPMorgan/JP Morgan/Chase→JPM, J&J→JNJ, Coke→KO, Exxon→XOM, Lilly→LLY…). Collision rules (assumptions C3):
  - Names that are ordinary English words (Target, Visa, Oracle, Meta, Apple, Caterpillar…) match only as **case-sensitive, capitalized** words.
  - Tickers that are short or English words (V, T, MA, GE, BA, TGT, MS, DE, HD, PG, CAT, KO…) match only as **uppercase standalone tokens**.
- **Sectors:** static GICS-style map ("pharmaceutical/pharma/drugmakers", "banks", "big tech", "oil majors"…) → corpus companies.
- **Periods** (assumptions C1, C5):
  - Explicit fiscal years, ranges, and "since 2023". A bare year counts only in a time phrase ("in 2024", "the 2024 10-K"); a year that dates an event ("enacted in 2022") does not.
  - **"Last N years"** resolves per company to the N most recent complete fiscal years (by 10-K) for that company, plus any later quarters shown separately as "FY<next> YTD".
  - **No period named:** per company, the latest 10-K plus subsequent 10-Qs ("current view").
  - **Change question with no period named** (SPEC §26.3, amended 2026-10-02): each company's last 3 annual reports (`last_n`, `changeDefault`), stated as an assumption; fewer 10-Ks is a stated gap.
  - **A named period with no filing** for any company in scope falls back to the current view, with a stated gap. A user's fiscal-year filter never falls back.
  - The resolution is always shown in the Interpretation panel; user filters override it.
- **Filing types:** 10-K / annual report, 10-Q / quarterly.
- **Topics:** risk, regulatory, revenue/growth, liquidity, competition, outlook → **soft** section boosts only. They never filter, so arbitrary questions still get general semantic retrieval.

### 6.6 Retrieval
- The **planner** builds retrieval *lanes*:
  - Named companies → one lane per company, so one company can't dominate.
  - Longitudinal → company × fiscal-year lanes, so the newest filing can't dominate.
  - Sector → one lane per sector member with a smaller N.
  - Otherwise → a global lane with a per-company cap.
- **Per lane:** a metadata-filtered BM25 search and a metadata-filtered exact cosine search over the in-memory index, fused by **Reciprocal Rank Fusion (k = 60)**. User-selected filters (companies, filing types, period) are hard metadata filters.
- Chunks flagged `boilerplate` are down-weighted so "no material changes" passages don't displace substantive evidence.
- **Rerank: off by default.** Cohere Rerank 3.5 on Bedrock (non-generative) was not evaluated in Phase 3; it would be enabled only after a measured lift on the gold labels and Eliza's answer to F1 (assumptions A1, F1).

### 6.7 Context builder
- Deduplicate adjacent or overlapping chunks (shingle Jaccard > 0.8).
- Enforce lane quotas so every requested company and period is represented, then fill by fused score.
- Merge adjacent chunks and keep to a ~24K-token budget.
- Emit untrusted-content blocks:

```text
<filing_excerpts>
SOURCE_ID: AAPL-FY2025-10K-1A-004
COMPANY: Apple Inc (AAPL)
FILING: 10-K · filed 2025-10-31 · period ended 2025-09-27 (FY2025)
SECTION: Item 1A — Risk Factors
TEXT:
…
</filing_excerpts>
```

**As built (Phase 3, `packages/rag` query/, retrieval/):**
- **Catalog** (`query/catalog.ts`): derived from the loaded index's own chunks, so the analyzer can never name a filing that retrieval cannot return.
- **Companies** (`query/companies.ts`):
  - aliases from header names (legal name, suffix-stripped name) and tickers, plus the curated list;
  - common-word names (`COMMON_WORD_NAMES`) match case-sensitively and never before a hyphen;
  - other names match case-insensitively; tickers match uppercase only and never next to a letter, digit, `-`, `&`, `.` or apostrophe;
  - among overlapping matches the longest wins;
  - known limitation: a common-word name that opens a sentence ("Target markets…") still matches; the Interpretation panel shows it.
- **Sectors** (`query/sectors.ts`): 21 phrase rules, each mapping to explicit members or a whole catalog sector. A phrase needs a plural or a group noun ("pharmaceutical companies", "banks"), so "NVIDIA's semiconductor business" or "Apple's financial risks" pulls in no sector.
- **Periods** (`query/periods.ts`):
  - kinds: current, last N, explicit years and ranges, since Y, fiscal quarters (Q4 resolves to the 10-K), and a filter range;
  - explicit years use the 10-K when present, else that year's 10-Qs as "FY<y> YTD", else a stated gap;
  - only 1990–2039 count as years, so "2,000 stores" is not one;
  - **time-phrase rule:** a bare year counts only after a temporal preposition ("in", "for", "during", "through", "as of", "ended"…), before a filing word ("2024 10-K", "2024 annual report", "2024 results"), or in a list joined to a counted year ("2022 and 2024"). FY / fiscal prefixes always count. A year after an event verb ("launched in 2020", "enacted in 2022", "acquired in 2019") never counts. Year-like tokens not read as periods get a note: "Not read as a period (no time phrase…)";
  - two-digit years need the FY prefix ("FY23", "FY'23" → FY2023); a bare "23" is never a year;
  - "last few years", "several years" and a plural with no count ("recent years") are read as 3 and flagged; "last couple of years" is 2;
  - "year over year" or "compared with the prior year", with no year named, is read as the last 2 fiscal years and flagged.
- **Fallback** (`query/analyze.ts`): when a named period (years, since, quarters) has no filing for any company in scope, the analysis records it as `requestedPeriod`, resolves every company to its current view instead, and states a gap per named company ("AAPL: no FY2015 filing in the corpus; showing the current view instead.") plus a note. A user's fiscal-year filter is a hard filter and never falls back: no filings means no lanes, no embedding call and a stated gap. When only some named companies lack it ("Compare Apple and Merck in 2022"), each of those keeps a lane in its current view, with the gap "MRK: no FY2022 filing in the corpus; showing its current view (FY2024) instead." and a note, so a comparison never silently loses a company. A dash-only range ("2025-2030") follows the time-phrase rule like a bare year; "from…", "between…" and "to/through/until" ranges always count.
- **Interpretation:** the analysis carries `notes` (assumptions, filter overrides) and `gaps` (corpus gaps for named companies), both shown in the Interpretation panel. Other notes and gaps:
  - **Out-of-corpus companies:** a likely company mention that is not in the corpus (a curated list such as Ford or Rivian, or a capitalized name before "Inc", "Corp", …) gets a gap: "Ford is not in the corpus (54 companies)".
  - **Common words:** a lowercase common-word name next to named companies gets a note that it was read as a word. The common-word list is trimmed to genuine English words and given names; brand-only names such as Tesla, Google or Nike match case-insensitively.
  - **Review window:** a company whose every filing ends more than 3 years before the corpus's newest period end is left out of questions that name no company, with a note. GE's only filing is its FY2014 10-K. When named, it is searched with a note.
  - **One period in scope:** a change question where a named company has only one period gets a note on how to name years to compare.
- **Planner** (`retrieval/plan.ts`):
  - the context targets 22 blocks; each lane's quota is max(1, ⌊22 / lanes⌋), so 3 lanes get 7 each, 11 lanes 2 each, and 12 or more lanes 1 each;
  - lanes are longitudinal when the question has change intent and a company resolves to two or more period buckets;
  - **companies before periods (H2):** each lane has a `tier`. Company and sector lanes are tier 0. In company × period lanes, a company's latest annual period is tier 0, its earliest period tier 1, and the others tier 2. The context builder fills quotas pass by pass in tier order, so every company is represented before any company gets a second period;
  - **endpoint reduction:** when company × period lanes would exceed 11 (⌊22 / 2⌋), each company with three or more periods keeps only its earliest period and its latest annual period. Middle years and later YTD quarters are dropped, and a plan note names them. "Big tech since 2022" goes from 25 lanes to 12. With more than 11 companies, even the endpoints exceed the target: each lane gets 1 block, latest periods first, and a note says some earliest periods may be missing;
  - plan notes appear in the retrieval debug view and travel with the result;
  - the global lane caps 4 blocks per company.
- **Search** (`retrieval/search.ts`):
  - BM25 and exact cosine over the lane's filings only, the top 200 of each fused by RRF (k = 60);
  - topic section boost ×1.25; boilerplate weight ×0.2;
  - each lane's lexical query drops the *other* named companies' names; the semantic query is the whole question, embedded once;
  - modes: `hybrid` (default), `bm25` (no embedding; the A1 fallback) and `cosine` (evals).
- **Context** (`retrieval/context.ts`):
  - lane quotas are filled one block per lane per pass, visiting lanes by tier (companies before periods), then the rest fills by fused score;
  - dedupe: >50% character overlap within a filing, or 5-word-shingle Jaccard > 0.8 within the lane (or the company, outside period lanes). Near-identical passages in different period lanes are kept, because they are evidence of persistence;
  - the budget is 24,000 tokens at 3.5 characters a token, never exceeded;
  - order: lane, then filing, then chunk;
  - one `<filing_excerpts>` block. Inside a passage, any `filing_excerpts` tag is defanged, including variants with spaces, zero-width characters or soft hyphens. A line that starts like a block header (`SOURCE_ID:`, `COMPANY:`, `FILING:`, `SECTION:`, `TEXT:`) is prefixed with `[filing text]`;
  - a snapshot (≤ 350 KB) for the evidence drawer, and a company × period coverage matrix. Over the cap, the builder drops the lowest-scoring fill blocks (then quota blocks, if needed) and records the count in `skipped.snapshotCap`; it never fails the analysis.
- **Telemetry:** retrieval time, embedding time, `embeddingCallCount` (0 or 1), `rerankCallCount` (always 0), `retrievalRequests` (lanes), chunks retrieved, chunks used, companies and filings represented.
- **Debug:** `POST /api/retrieval/debug` (§9) is registered only when a retrieval dependency is injected. The deployed handler never injects one; `pnpm retrieval:debug` serves it on 127.0.0.1 over the built index.
- **Measured** (20 eval questions, [evaluation.md](evaluation.md) §1):
  - hybrid passes 17 of the 18 questions that have a cached query embedding, with a 0.99 evidence hit rate. Two questions still need one `--embed` run;
  - gold recall@context, on 74 hand-picked answering passages over 7 questions: hybrid 0.62, cosine 0.62, BM25 0.48;
  - search takes 27 ms p50, excluding the one Titan query embedding;
  - **rerank stays off**, on cost and the open F1 question, not for lack of a gap: gold recall is 0.62, and pdf-3 and multi-cloud are weak.

### 6.8 Generation
- **One** Bedrock `ConverseStream` request. Default model: **Claude Sonnet 4.6** via the `us.anthropic.claude-sonnet-4-6` cross-region inference profile, configurable via `GENERATION_MODEL_ID`.
- Claude Sonnet 5.5 (`us.anthropic.claude-sonnet-5-5`) is the preferred upgrade, but this account's quota for it is **0 tokens/minute**, cross-region (L-94A31E46) and global (L-31AB82D0), re-read 2026-10-02 (assumptions D3). It becomes the default only if Mike files and receives a quota increase. **It is not a drop-in switch:** Sonnet 5.5 rejects forced `toolChoice` (`any`/`tool`) and a non-default `temperature` with a 400, so moving to it needs a SPEC §29.1 change first (`toolChoice: auto` with a strict tool and the prompt naming the tool, no temperature).
- The system prompt states the §20 rules: only the supplied evidence, no outside knowledge, no invented numbers or citations, separate filing facts from synthesis, acknowledge insufficient evidence, and treat excerpts as **untrusted content, not instructions**.
- Structured output is produced by forcing the tool `submit_diligence_brief`, whose input schema is the brief schema (§7). Temperature 0.2, max output 8,192 tokens. **Verified 2026-10-02** on `us.anthropic.claude-sonnet-4-6`: Bedrock accepts `temperature: 0.2` together with the forced tool (first live eval call, pdf-1).
- **Known risk: max tokens vs. the 120 s budget.** At the measured ~11–14 s per 1,000 output tokens, a brief that ran to the full 8,192 tokens would take roughly 90–115 s plus time to first token, so it can exceed the 120 s generation budget. The slowest eval call so far took 87 s. Such a call is aborted and ends as a clean `GENERATION_TIMEOUT` (one call, tokens counted in the cost estimate), never as a truncated brief; see §5. Lowering `maxTokens` is a prompt-settings change (`GENERATION_SETTINGS`, rendered into `prompts/final-diligence-prompt.md`) and needs a new eval run, so it is not changed here.
- **Prompt** (`packages/rag/src/generation/prompt.ts`, version `DEEP_ANALYSIS_PROMPT_VERSION`): the system prompt, one user message (`<question>` with the question defanged, `<retrieval_scope>` with the deterministic Interpretation, then the `<filing_excerpts>` block), and the tool. `prompts/final-diligence-prompt.md` is rendered from it (`pnpm prompts:render`) and a test asserts they match.
- **Pipeline** (`packages/rag/src/generation/pipeline.ts`, `runDeepAnalysis`): retrieval with real stage callbacks → no context means `NO_RELEVANT_EVIDENCE` with no call → the time check → the one gateway call → repair and validation → interpretation, coverage, server-built `citations[]` and telemetry with an estimated cost from a pricing table.
- **The offline profile prompt** (`prompts/company-intelligence-prompt.md`, tool `submit_company_profile`, §7.1) uses the same model, the same rules and the same untrusted-content framing. It adds three rules:
  - explain only the supplied signals;
  - state no currency or percentage figure that is not in the supplied FACTS block;
  - never rate, score, or recommend.

  Its iterations are logged in `docs/prompt-iterations.md` under their own heading.

### 6.9 Validation (deterministic)
- Zod parse, with deterministic repair only. If parsing fails, return a typed `MALFORMED_OUTPUT` error.
- **Citation validation:** every ID must be in the context set. Invalid IDs are removed and flagged, and the failure is logged and counted.
- **Uncited claims:** findings without valid citations are flagged.
- **Numeric grounding:** every currency or percentage figure must appear in at least one of its cited chunks. Otherwise it gets an "unverified figure" badge.
- **Phase 4 implementation** (`packages/rag/src/generation/validate.ts`):
  - **Repair** handles a stringified tool input or field, a comma-separated ID list, a missing array, a null comparison and enum case slips. When every comparison row has exactly one value fewer than there are columns (the model put the row-label header into `columns`), repair drops that leading column. Each repair is recorded. Truncated JSON is never guessed.
  - **Comparison alignment:** after repair, rows whose value count differs from the column count are listed in `validation.comparisonMisaligned`, with a notice. The table is kept.
  - **Figure rules:** a figure is a currency amount or a percentage in model-written text. Passage numbers are read with what is printed around them: a "$" before (also the flattened cell "$ | 47,405" and a negative "(69,691)"), a scale word after, "%" (also in the next cell, "215 | %"), and whether they sit in a "|" table cell. A year ("Fiscal 2024"), a day after a month ("December 31") and a reference number ("Item 5", "Note 7") are never candidates. A passage's unit is "in billions / millions / thousands" anywhere in it.
    - *Percentage:* the same value printed as a percentage (`exact`).
    - *Currency with no scale word* ("$6.11"): the same value after a "$", or in a table cell of a passage that prints a "$", with no scale word (`exact`). It is refused at 1,000 or more when the passage states a unit, because the unit was dropped.
    - *Currency with a scale word* ("$25.0 billion"): the same value with the same scale word (`exact`). Or the exactly equal amount under another scale word, "$72,220 million" for "$72.22 billion" (`scaled`). Or, in a passage that states its unit, a "$" amount or table cell equal to the figure in that unit, or rounding to it at the figure's own precision when the figure is in a coarser unit and has at least 3 significant digits as printed: "$416.2 billion" for 416,161 in millions, never "$1 billion" for 1,234 (`scaled`). Precision is read from the printed text: "5.0" is not "5". Rounding under the same scale word ("$295B" for "$295.49 billion") is not accepted.
    - *Comparison cells* take the unit their row label or column header states ("Total Revenue ($M)"): "$134,902" in that row is checked as $134,902 million.
    - *Preceding unit* (`preceding_unit`, verified): a passage that states no unit but opens with a table, where the last non-empty line of the filing text right before the passage is that table's unit caption ("CONSOLIDATED STATEMENTS OF CASH FLOWS(In millions)", "(In millions, except per share amounts)", "(Dollars in billions)"). The caption line must not be a table row and nothing may follow the caption but its closing parenthesis; "(in millions of shares)" is not read. The preceding text comes only from the same filing (`documentId`), the same section, consecutive chunks (`chunkIndex`) that are contiguous by character offsets, at most two chunks back (`precedingFilingText`; the worker passes `Retriever.precedingText`, the re-score builds the same lookup from `chunks.jsonl`, and the validator stays pure). The unit covers only the cells of that leading table (the chunker's `isTableRow` lines), and the cell's amount in that unit must **exactly** equal the figure's amount: "$69.691 billion" or "$69,691 million" for 69,691, never "$69.7 billion" (no rounding, unlike a unit stated in the passage). An unscaled figure of 1,000 or more found only in that table is refused, as the unit was dropped. Why this is still strict: the caption is the line a reader sees directly above the table; any heading, prose or table row in between breaks the link, and a passage that states its own unit ignores the caption. The context snapshot and citations are unchanged.
    - *Near match* (`unit_unstated`): a scaled figure whose printed digits equal a table cell in a passage that states no unit (outside a leading table covered by a preceding unit), typically a table whose unit header is elsewhere or printed in a form the validator does not read ("(MILLIONS)"). It is reported, counted separately, and **not verified**.
  - **Scope:** an item's figures are checked against that item's own valid citations. The title, summary and evidence gaps are checked against every passage some item cites, because they summarize the items. Follow-up questions are not checked.
  - **What it does not prove:** a verified figure means a number with these digits and this unit is printed in a cited passage, not that it means what the sentence says. A computed "about 2%" can still verify against an unrelated "2%" in the same passage, and a figure can verify against the wrong row of a table. This is a deterministic check against invented, converted and rescaled numbers, not semantic grounding.
  - **Validation block:** removed citations, uncited items, misaligned comparison rows, every figure with its rule and chunk, and plain-language notices for the brief.

---

## 7. Response schema (model output)

```ts
type DiligenceBrief = {
  title: string;
  executiveSummary: string;
  answerType: 'single_company' | 'comparison' | 'trend' | 'sector' | 'insufficient_evidence';
  keyFindings: Array<{
    title: string;
    finding: string;
    basis: 'reported' | 'analysis';      // filing fact vs analyst synthesis
    tickers: string[];
    citationIds: string[];
  }>;
  comparison?: {                         // omitted when a table makes no sense
    kind: 'table' | 'trend';
    columns: string[];
    rows: Array<{ label: string; values: string[]; citationIds: string[] }>;
  };
  investmentConsiderations: Array<{ text: string; citationIds: string[] }>;
  evidenceGaps: string[];
  followUpQuestions: string[];
};
```

The server, not the model, adds:
- `citations[]`: derived from valid inline IDs, with source metadata.
- `validation`: invalid citations, uncited findings, numeric checks.
- `interpretation`: the resolved query scope (companies, periods including "last N years" / current-view resolution, filters, coverage warnings).
- `coverage`: the company × period evidence matrix.
- `telemetry`.

**Comparison headers (bug fixed in Phase 5).** In a validated brief, `comparison.columns` has one header per value: repair drops a leading row-label header (§6.9). The web table header and the text of a finding saved from a comparison row now use core `comparisonHeaders`, which returns the value columns and still accepts a leading row-label header (`columns.length = values + 1`) if one is present.

**How the web shows a brief (Phase 5, `apps/web/src/app/(workspace)/analysis/analysis-view.tsx`, `components/diligence/brief-panels.tsx`).** The real stage names while QUEUED/RUNNING; the Interpretation panel; the company × period coverage matrix; numeric badges per figure ("Unverified figure", and "Unit not stated" for `unit_unstated` near matches); the validation summary; and citations resolved against the context snapshot, falling back to `citations[]` when the snapshot is missing. A seeded analysis is labeled as real pipeline output run in advance, and its durations are hidden.

**P0 on every brief** (assumptions B4, B5, C1, C2, C5; DD-06): the Interpretation panel (`interpretation`), the company × period coverage matrix (`coverage`), and numeric-grounding badges (`validation`) are always shown. Only the richer versions (per-company Diligence Gaps matrix, SPEC §19; Analysis Audit Trail, SPEC §23.2) are P1.

### 7.1 Company Intelligence profile (stored artifact; Zod schema in `packages/core`)

```ts
type Trajectory = 'accelerating' | 'growing' | 'stable' | 'slowing' | 'declining'
  | 'improving' | 'not_extracted' | 'limited_history';
type SignalType = 'NEW' | 'EXPANDED' | 'REDUCED' | 'TREND_CHANGE' | 'OUTLOOK_CHANGE' | 'PERSISTENT';
type SignalCategory = 'performance' | 'growth' | 'margin' | 'liquidity' | 'debt' | 'regulatory' | 'competition'
  | 'customer_concentration' | 'geographic_concentration' | 'supply_chain' | 'cybersecurity' | 'litigation'
  | 'management_outlook';

type CompanyIntelligenceProfile = {
  ticker: string; company: string; sector: string;
  version: { indexVersion: string; profileSetId: string;            // 'llm-v1' | 'det-v1'
             profilePromptVersion?: string; templateVersion: string; builtAt: string; periodsCovered: string[] };
  fiscalYearEnd: string;          // period end of the latest 10-K; shown as reported, never aligned (SPEC §9).
                                  // Not periodsCovered.at(-1), which can be a quarter end.
  coverage: { tier: 'deep' | 'partial' | 'limited_history'; filings: number; tenK: number; tenQ: number;
              byCategory: Array<{ category: SignalCategory; level: 'strong' | 'partial' | 'limited' }> };
              // deterministic labels shown as "Strong / Partial / Limited evidence" (SPEC §19); not model text
  facts: Array<{ metric: string; period: string; value: number; unit: string; scale: 1 | 1e3 | 1e6 | 1e9;
                 chunkId: string; rawRow: string;                        // the source table row, verbatim
                 crossCheck: 'ok' | 'mismatch' | 'single_source' }>;    // DD-17, deterministic; mismatch is a flag
  trends: Array<{ metric: string; trajectory: Trajectory; basis: string; periods: string[]; chunkIds: string[] }>; // deterministic
  drivers: Array<{ label: string; metric: string; periods: string[]; changeBasis: string;   // deterministic, from MD&A rows
                   explanation: string; citationIds: string[] }>;       // explanation generated or templated
  currentRisks: Array<{ category: SignalCategory | null; heading: string; // latest 10-K risk heading, verbatim
                        plainLabel: string; rank: number;               // plainLabel generated or templated
                                                                        // category is null when the classifier finds none ("Other risks")
                        citationIds: string[] }>;
  signals: Array<{ signalId: string; type: SignalType; category: SignalCategory; periods: string[];
                   measurement: string;                                   // deterministic, DD-18
                   evidenceByPeriod: Array<{ period: string; chunkIds: string[] }>;
                   investigateQuestion: string;                           // templated, prefills Deep Analysis
                   headline: string; whatChanged: string; whyThisMatters: string;  // generated or templated
                   whyThisMattersSource: 'model' | 'general_context';     // 'general_context' = curated library (DD-16)
                   citationIds: string[] }>;
  executiveView: Array<{ dimension: string; label: string; summary: string; citationIds: string[] }>;  // 30-second view
  managementOutlook: { summary: string; citationIds: string[] } | null;
  recommendedDiligence: Array<{ question: string; why: string; signalIds: string[];
                                 citationIds: string[];                  // its signals' or current risk's passages;
                                 tickers: string[] }>;                   // a saved recommendation keeps its evidence
  gaps: string[];
  citations: Citation[];          // server-derived from valid IDs, with passage text (as for briefs)
  generation: { mode: 'llm' | 'deterministic'; modelId?: string; generationCallCount: 0 | 1; ledgerRunId?: string;
                inputTokens?: number; outputTokens?: number; validation: { invalidCitations: number;
                unsupportedFigures: number; bannedPhrases: number } };
};
```

Labels are descriptive only. Scores, ratings and recommendations are not part of the schema, and the validator rejects them (canonical banned-phrase list, DD-16).

**Every figure has a source row.** A number is rendered only from `facts` (or a value derived in code from two facts). The UI shows the fact's `rawRow` and chunk on hover and in the evidence drawer. A number in model-written text must match a fact (numeric validation).

**Phase 1 fixture profiles** (before extraction exists) follow the same rule. Their current risks are a hand-picked **selection** of verbatim latest-10-K headings, not the complete list, so the UI labels them a preview and shows nothing derived from completeness (common, distinctive, ranking, `rank` as a position) while one is involved (SPEC §8.6). They carry **no figures and no narrative presented as fact**: every slot is either clearly labeled placeholder structure ("Revenue trend: placeholder, not filing data") or a value copied verbatim from a filing row with its `chunkId` and `rawRow`. A test fails if a fixture profile renders a numeric figure without a source row (testing-strategy §3).

**Since Phase 2** the fixture (preview) profiles (`profileSetId: fixture-v2`) hold the latest 10-K's complete **extracted** heading list (`packages/corpus` `risks.ts`, written to the web app by `scripts/fixtures/build-risk-fixtures.ts`), each heading cited to the real index chunk(s) that contain it. The extractor is a heuristic whose precision and recall are measured on hand-labeled AAPL, MSFT and NVDA lists (assumptions G3a): it can miss some headings and can include a sentence that is not a heading, so the preview rules above still apply until the Phase 4b profile build.

---

## 8. Data model — DynamoDB single table `diligenceiq` (on-demand) *(built in Phase 5: `services/api/src/workspace/store.ts`, `analyses/store.ts`; `THESIS#` and `WATCH#` in Phase 8b)*

| PK | SK | Contents |
|---|---|---|
| `WS#<workspaceId>` | `META` | workspace label, createdAt, seed version, `ttl` (30 days, moved out on a returning visit; see Demo sessions) |
| `WS#<workspaceId>` | `ANALYSIS#<analysisId>` (time-ordered, §4.1) | question, filters, `origin` (`AnalysisOrigin`, §9: what prefilled it, recorded for provenance only; retrieval uses only the question and filters), status (QUEUED/RUNNING/COMPLETE/FAILED), stage, `queuedAt`, `claimedAt`, `claimToken`, `deadlineAt` (queuedAt + 240 s), `generationStartedAt`, `generationCallCount`, error, interpretation, coverage, brief, validation, telemetry, `ttl` |
| `WS#<workspaceId>` | `CONTEXT#<analysisId>` | **Context snapshot**: the passages sent to the model (text + metadata + `indexVersion`), ≤350 KB guard. A separate item so polls and lists stay small. |
| `WS#<workspaceId>` | `FINDING#<findingId>` (derived from the source, see below) | title, text, `theme` (one of the six theme IDs, §8.1), tickers, citations (**passage text + source metadata + `indexVersion`**), `origin` (`FindingOrigin`, §9), analysisId?, note, status (Active / Needs Follow-Up / Resolved), `pinnedToIC`, `isKey`, `figures?` (the brief's figure checks for the saved item, §6.9), `seeded?` (saved by the demo seed), timestamps, `ttl` (30 days from creation; restarted by an edit) |
| `WS#<workspaceId>` | `THESIS#<ulid>` | statement (≤ 1,000), tickers (catalog-validated), `links: Array<{ kind: 'finding' \| 'signal', ref, stance: 'supporting' \| 'challenging' }>` (≤ 50), openQuestions (≤ 20 × 500 chars), watchedCategories, `pinnedToIC`, timestamps, `ttl`. ≤ 20 theses per workspace (P1) |
| `WS#<workspaceId>` | `WATCH#<ticker>` | categories (subset of the signal categories plus `new_filings`, which selects filing events from the filing catalog, and `anything_material`, which selects every intelligence event), createdAt, `ttl`. `ticker` must be in the company catalog; ≤ 25 watches per workspace (P1) |
| `WS#<workspaceId>` | `RATE#<yyyy-mm-ddThh>` | Per-workspace hourly analysis counter, `ttl` |
| `GLOBAL` | `RATE#<yyyy-mm-dd>` | Global daily analysis counter (spend cap), `ttl` |
| `GLOBAL` | `WSCREATE#<yyyy-mm-dd>` | Daily workspace-creation counter, `ttl` |
| `GLOBAL` | `WSCREATE#<yyyy-mm-dd>#<hash16>` | Per-client daily workspace-creation counter: `hash16` is a salted SHA-256 (HMAC with the session secret) of the source IP, never the IP itself (DD-20 (f)), `ttl` |

**Finding IDs (a deviation from `FINDING#<ulid>`).** A finding's ID is derived from its source: `fd-` plus the first 20 hex characters of `sha256(sourceKey(source))`, written with a conditional create. One stored item (a key finding, a signal, a compare row) is therefore saved at most once per workspace; a second save is `409 ALREADY_SAVED` (DD-20).

The context snapshot uses `CONTEXT#` rather than `ANALYSIS#<id>#CONTEXT` so that listing analyses (`begins_with(SK, "ANALYSIS#")`) never reads snapshot items. The list query uses a projection (the summary fields only). A poll (`GET /api/analyses/:id`) reads the whole `ANALYSIS#` item, which holds the brief, citations and validation once complete, and strips internal fields (`claimToken`, `ttl`, the partition) before answering; it never reads the `CONTEXT#` snapshot. Counts (`stats.analyses`, the findings cap) are `Select: COUNT` queries.

The **telemetry** stored on each analysis and emitted as one summary log event (SPEC §30.1 and §35.10):
- `requestId`, `analysisId`, `query` (the user's question is logged; prompts and chunk text are not)
- `retrievalDurationMs`, `generationDurationMs`, `totalDurationMs`
- `retrievalRequests`, `chunksRetrieved`, `contextChunksUsed`, `companiesRepresented`, `filingsRepresented`
- `embeddingCallCount`, `rerankCallCount`, `generationCallCount`, `inputTokens`, `outputTokens`
- `modelId`, `promptVersion` (the Deep Analysis prompt), `indexVersion`, `estimatedCostUsd`. The cost comes from the configured pricing table and is labeled an estimate.
- `replayed` (seed analyses only): the record is a replay of a recorded generation, so every duration field is 0 rather than a measurement.

**Demo sessions** (built in Phase 5: `services/api/src/session/session.ts`). No account is required:
- **Cookie.** `__Host-diq_ws` = `<workspaceId>.<signature>`, where the workspace ID is 16 random bytes base64url (128 bits) and the signature is HMAC-SHA256, base64url, over `ws.v1.<workspaceId>` (constant-time check). Attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`, `Max-Age` 30 days. The `__Host-` prefix makes the browser refuse the cookie unless it is Secure, host-only and `Path=/`, so a sibling subdomain cannot set or shadow it. The local test server, which is not HTTPS, uses the plain name `diq_ws` without `Secure`; each server reads only its own name. The cookie holds nothing else.
- **Secret.** The SSM SecureString `/diligenceiq/session-secret`, created by the admin before the api deploy (CloudFormation cannot create SecureStrings; assumptions D11). It is read `WithDecryption`, cached per warm container, and must be ≥ 32 bytes; a missing, short or unreadable secret fails closed with `500 INTERNAL` ("Sessions are unavailable"), never a weak signature.
- **`POST /api/session`** is idempotent for a valid cookie whose `META` exists and whose `ttl` is still in the future (`created: false`). A returning visit moves `META`'s `ttl` to 30 days from now with one conditional `UpdateItem`, at most once a day (only when under 29 days remain). Otherwise it increments the caller's per-client counter `GLOBAL / WSCREATE#<yyyy-mm-dd>#<hash16>` (cap `PER_IP_DAILY_WORKSPACE_CAP`, default 20; at the cap `429 RATE_LIMITED`, `details: { scope: 'workspace_creation_client', retryAfter }`), then the global `GLOBAL / WSCREATE#<yyyy-mm-dd>` (cap `DAILY_WORKSPACE_CREATION_CAP`, default 500; `scope: 'workspace_creation'`). The per-client check runs first, so one client's refused attempts never reach the global counter (DD-20 (f); assumptions D12). It then creates `META` and seeds the workspace. A seed that fails is logged and the session is still returned: the workspace is usable (empty or partly seeded), and the visitor does not spend a second slot.
- **Every other route** except `/api/health` requires the session. A valid signature whose `META` is missing or past its `ttl` (DynamoDB deletes expired items lazily, up to days later) is `401 SESSION_REQUIRED`; the web client then opens a new session once and retries the request once.
- **TTLs of the other items.** Analyses, their snapshots and findings keep their own 30-day `ttl` from creation, so a workspace kept alive by visits loses analyses older than 30 days; editing a finding (`PATCH`) restarts that finding's `ttl`.
- **Seed.** `seed/demo-workspace.json` (`seed-v1`), built by `pnpm seed:build` (`scripts/seed/build-seed.ts`) from real pipeline output: the eval questions `pdf-2`, `multi-cloud` and `expert-1`, replayed from their recorded `da-v4` generations through `runDeepAnalysis` and the validator over `iv-9cf51c066743`. The build is replay-only and fails if a live call would be needed (DD-20). Run times are the recording times. Seeded analyses carry `seeded: true`, and the UI labels them as run in advance and hides their durations; their telemetry names the seed record's own `analysisId`, is marked `replayed: true`, and has every duration set to 0 (a replay measures nothing). The four seed findings name only a source; their text and citations are copied server-side by the same code as `POST /api/findings`, and they carry `seeded: true`, which the Findings Board shows as "Example from the demo workspace" (SPEC §40).
- From Phase 8b (P1) the seed adds a watchlist (AAPL, MSFT, NVDA) and one example thesis. The thesis text is analyst-written and labeled as an example; its links point to real findings.
- **Reset** (`POST /api/workspace/reset`) deletes every item of **the caller's own partition except `META` and its `RATE#` counters**, so a reset cannot bypass the hourly cap (DD-20), then rewrites `META` in place (an unconditional `PutItem`, same workspace ID) and reseeds. `META` is never absent, so a request that arrives mid-reset keeps its session rather than minting a new workspace.
- DynamoDB TTL expires abandoned workspaces, so no scheduled cleanup is needed.

### 8.1 Finding themes (formerly workstreams, DD-15)
IDs: `financial-performance`, `growth-outlook`, `risk-factors`, `regulatory-compliance`, `liquidity-capital`, `strategic-shifts`. They are a grouping taxonomy for findings only; there is no workstream status or progress tracking. A finding saved from a signal gets a default theme from the signal's category (for example `regulatory` → `regulatory-compliance`). The analyst can change it.

### 8.2 IC Brief assembly (deterministic, no LLM; P1)

| IC Brief section | Source |
|---|---|
| Executive View | Pinned theses (statement + supporting/challenging counts) + pinned findings marked `isKey` |
| Financial Performance | Pinned findings with theme Financial Performance or Liquidity & Capital |
| Growth Drivers | Pinned findings with theme Growth & Outlook or Strategic Shifts |
| Material Risks | Pinned findings with theme Risk Factors |
| Regulatory Exposure | Pinned findings with theme Regulatory & Compliance |
| Outstanding Diligence | Pinned findings with status Needs Follow-Up + open questions of pinned theses |
| Supporting Evidence | Union of the cited passages of all included findings |

---

## 9. API contract *(Phase 5 built the health, session, workspace, companies, compare, analyses and findings routes in `services/api/src/app.ts`; the rows marked Phase 6 or Phase 8b are not built yet)*

All bodies and query strings are validated with Zod; a request body is at most 16 KB and must be sent as `content-type: application/json` (a charset parameter is allowed; anything else is `400 VALIDATION_ERROR`, which also keeps a cross-site form post from reaching a write route). Every response carries `x-request-id`. Errors return `ApiError` and never a stack trace. All routes except `/api/health` and `/api/session` require a valid session cookie (§8 Demo sessions). Every ticker in a path, query or body is checked against the core company catalog. The Phase 1 `GET /api/diagnostics/cookie` probe is removed.

```ts
type ApiError = { error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> } };
type Page<T> = { items: T[]; nextCursor?: string };       // opaque cursor; limit default 25, max 100
type ThemeId = 'financial-performance' | 'growth-outlook' | 'risk-factors'
  | 'regulatory-compliance' | 'liquidity-capital' | 'strategic-shifts';
type FindingStatus = 'ACTIVE' | 'NEEDS_FOLLOW_UP' | 'RESOLVED';
type Citation = { chunkId: string; indexVersion: string; ticker: string; company: string; filingType: '10-K' | '10-Q';
  filingDate: string; periodEnd: string; fiscalLabel: string; section: string; documentId: string;
  charStart: number; charEnd: number; text: string };
// Where a Deep Analysis came from. Provenance only: retrieval uses the question and filters.
type AnalysisOrigin =
  | { kind: 'direct' }                                                    // typed, or the global "Ask a question" action
  | { kind: 'signal' | 'recommendation' | 'executiveView' | 'driver' | 'currentRisk'; ticker: string; ref: string }
  | { kind: 'compare'; tickers: string[]; ref: string }
  | { kind: 'thesis'; thesisId: string }                                  // P1 "Test with Deep Analysis"
  | { kind: 'watchEvent'; ticker: string; signalId: string }              // P1
  | { kind: 'finding'; findingId: string }                                // "Investigate further" from a finding
  | { kind: 'brief'; analysisId: string; index: number };                 // a brief's follow-up question
// What a finding was saved from. Every variant names stored server-side content to copy.
type FindingSource =
  | { kind: 'keyFinding' | 'consideration' | 'comparisonRow'; analysisId: string; index: number }
  | { kind: 'signal' | 'executiveView' | 'recommendation' | 'driver' | 'currentRisk'; ticker: string; ref: string }
  | { kind: 'compareRow'; tickers: string[]; ref: string }
  | { kind: 'watchEvent'; ticker: string; signalId: string };             // P1; copies the stored profile signal
type FindingOrigin = { kind: 'analysis' | 'intelligence' | 'compare' | 'watch'; source: FindingSource };
// 'analysis' ⇐ keyFinding/consideration/comparisonRow; 'intelligence' ⇐ signal/executiveView/recommendation/driver/currentRisk;
// 'compare' ⇐ compareRow; 'watch' ⇐ watchEvent. A thesis links findings; it does not create them.
type Finding = { findingId: string; title: string; text: string; theme: ThemeId; tickers: string[];
  citations: Citation[]; origin: FindingOrigin; analysisId?: string; note?: string; status: FindingStatus;
  pinnedToIC: boolean; isKey: boolean; createdAt: string; updatedAt: string;
  figures?: FigureCheck[];   // the brief's numeric-grounding checks at the saved item's locations (§6.9)
  seeded?: true };           // saved by the demo seed (SPEC §40)
type AnalysisSummary = { analysisId: string; question: string; origin: AnalysisOrigin;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED'; stage?: string; createdAt: string; completedAt?: string;
  seeded?: boolean };        // copied from the seed: real pipeline output, run in advance
```

| Method & path | Request | Response |
|---|---|---|
| `POST /api/session` | — | `200 { workspaceId, created: boolean, expiresAt }` + `Set-Cookie` |
| `GET /api/workspace` | — | `200 { workspaceId, createdAt, seedVersion, stats, recentAnalyses: AnalysisSummary[], recentFindings: Finding[], watchlist: string[] }`. `stats.analyses` is a COUNT of every analysis; `recentAnalyses` holds the 10 newest. (`watchlist` is empty until Phase 8b) |
| `POST /api/workspace/reset` | — | `200 { workspaceId, reset: true, seedVersion }`. Deletes the caller's partition except `META` and its `RATE#` counters, rewrites `META` in place, reseeds (§8). |
| `GET /api/companies` | — | `200 { indexVersion, profileSetId, companies: Array<{ ticker, company, sector, tier, filings, periodsCovered, headline? }> }` (selector; from the active set's manifest) |
| `GET /api/companies/:ticker/intelligence` | — | `200 CompanyIntelligenceProfile` (§7.1) from the active profile set (§4.4 runtime read path). Read from S3, cached in memory. `400 VALIDATION_ERROR` for a ticker outside the catalog; `404 PROFILE_MISSING` for a catalog ticker without a valid profile. Never generates. |
| `GET /api/compare` | `?tickers=AAPL,MSFT,NVDA` (2–5) | `200 { companies, missing: string[], trajectories, common, distinctive, diverging, managementEmphasis, attentionRanking, recommendedDiligence, notes, citations }`, composed deterministically from profiles (DD-19) by core `composeCompare`; the web composes the same way from the profiles it loaded. Fewer than two profiles available → `404 PROFILE_MISSING` with `details.missing` |
| `POST /api/analyses` | `{ question: string /* 1–1,000 */, origin?: AnalysisOrigin /* default { kind: 'direct' } */, filters?: { tickers?: string[] /* ≤ 10 */, filingTypes?: ('10-K'\|'10-Q')[], fiscalYearFrom?: number, fiscalYearTo?: number } }` | `202 { analysisId, status: 'QUEUED', pollAfterMs: 1500 }`. Order of checks and failures: §4.1 |
| `GET /api/analyses` | `?status&cursor&limit` | `200 Page<AnalysisSummary>`, newest first (a descending Query). The cursor is opaque base64url and is rejected unless it belongs to the caller's partition; `limit` ≤ 100. |
| `GET /api/analyses/:id` | — | `200 AnalysisSummary & { stage, deadlineAt, filters?, error?, interpretation?, coverage?, brief?, citations?, validation?, telemetry?, seeded? }`. A QUEUED or RUNNING record past `deadlineAt` is failed first (`expireIfPastDeadline`, §4.3). Never returns `claimToken`, `ttl` or `workspaceId`. |
| `GET /api/analyses/:id/context` | — | `200 { indexVersion, passages: Citation[] }` (evidence drawer; reads the snapshot and adds `indexVersion` to each entry). No snapshot → `404 NOT_FOUND` with `details.snapshot = 'missing'`; the web then falls back to the brief's `citations[]`. |
| `GET /api/findings` | `?theme&ticker&status&origin&analysisId&from&to&pinned&cursor&limit` (`from`/`to` are ISO dates on `createdAt`) | `200 Page<Finding>`. Filtered in memory over the capped list (≤ 500); the cursor is an offset. |
| `POST /api/findings` | `{ source: FindingSource, theme?, title?, note?, status? }` | `201 Finding`. Text and citations are copied server-side from the stored brief, context snapshot, or profile, never from the client. `origin.kind` is derived from `source.kind`. The copy is core `resolveSource` (`packages/core/src/finding-sources.ts`, shared with the web); a brief item also copies the validation's figure checks at its own locations (`keyFindings[i].`, `investmentConsiderations[i].`, `comparison.rows[i].`) into `figures`, so the board keeps its "unverified figure" marks. Only a COMPLETE analysis can be saved from; a missing item is `404 NOT_FOUND`. The ID is derived from the source (§8), so a second save of the same item is `409 ALREADY_SAVED`; past 500 findings (a `Select: COUNT` query) `409 LIMIT_REACHED`. `watchEvent` sources are rejected (`400`) until Phase 8b. |
| `PATCH /api/findings/:id` | `{ status?, note? /* ≤ 2,000 */, pinnedToIC?, isKey?, theme?, title? }` (strict: no other field) | `200 Finding`. Restarts the finding's 30-day `ttl`. |
| `DELETE /api/findings/:id` | — | `204` |
| `GET /api/theses`, `POST /api/theses`, `PATCH /api/theses/:id`, `DELETE /api/theses/:id` (P1, Phase 8b) | `{ statement, tickers, links?, openQuestions?, watchedCategories?, pinnedToIC? }` | `200/201 Thesis` · `204`. No LLM. Never returns a verdict. |
| `GET /api/watchlist`, `PUT /api/watchlist/:ticker`, `DELETE /api/watchlist/:ticker` (P1, Phase 8b) | `{ categories }`. `:ticker` must match `^[A-Z]{1,5}$` and exist in the company catalog (else `400 VALIDATION_ERROR`); categories must be known values | `200 Watch[]` / `200 Watch` / `204`; `409 LIMIT_REACHED` past 25 watches |
| `GET /api/watchlist/events` (P1, Phase 8b) | `?ticker&category&kind&cursor&limit` | `200 Page<{ kind: 'filing' \| 'intelligence', ticker, filedAt, filingType, period, signalId?, type?, category?, headline? }>`: filing events from the filing catalog and intelligence events from stored profiles, filtered by watches. No polling. |
| `GET /api/evidence/adjacent` (Phase 6) | `?chunkId=` | `200 { chunkId, previous: { filing, passages: Citation[] } \| null, next: { filing, passages: Citation[] } \| null }` from `index/<v>/adjacency/` (§6.4): the same section in the adjacent comparable filings. Deterministic, no model call. |
| `GET /api/ic-brief` (P1, Phase 8b) | — | `200 { sections: Array<{ id, title, items }>, supportingEvidence: Citation[], markdown }` (§8.2) |
| `GET /api/sources` (P1, Phase 8b) | — | `200 { indexVersion, companies, filings: Array<{ documentId, ticker, company, filingType, filingDate, periodEnd, fiscalLabel, flags }> }` |
| `GET /api/sources/:documentId` (Phase 6) | — | `200 { filing, sections: Array<{ code, title, charStart, charEnd }>, text }` |
| `POST /api/retrieval/debug` | `{ question, filters?, mode?, includeText? }` | Retrieval-only inspection (Phase 3): interpretation, plan (strategy, target, notes such as an endpoint reduction), per-lane candidates with tier, quota, and BM25 and cosine ranks, context and telemetry. The local server answers 500 JSON on an internal error. The route exists only when a retrieval dependency is injected (`pnpm retrieval:debug`, 127.0.0.1); the deployed handler never injects one, so production answers 404. |
| `GET /api/health` | — | `200 { status: 'ok', indexVersion, indexAvailable, profileSetId, profileIndexVersion, analysesEnabled }`. `indexAvailable` is a `HeadObject` on `index/<indexVersion>/manifest.json`, cached 60 s; it drives the Deep Analysis missing-index banner. |

**Error codes → HTTP status** (request-level errors):

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query fails Zod validation, body over 16 KB, or a ticker outside the catalog |
| `SESSION_REQUIRED` | 401 | Missing or invalid session cookie, or its workspace has expired (the web client opens a new session once and retries) |
| `NOT_FOUND` | 404 | Analysis, finding, thesis, watch, or workspace not in the caller's partition |
| `LIMIT_REACHED` | 409 | Per-workspace cap on findings (500), theses (20) or watches (25) reached |
| `ALREADY_SAVED` | 409 | The same stored item is already saved as a finding (one finding per source; added in Phase 5) |
| `PROFILE_MISSING` | 404 | No Company Intelligence profile for the ticker at the current version |
| `SOURCE_MISSING` | 404 | Unknown `documentId` or missing processed filing |
| `RATE_LIMITED` | 429 | Workspace hourly, global daily, or workspace-creation cap reached (`details.scope`: `workspace_hourly`, `global_daily`, `workspace_creation_client` or `workspace_creation`; `details.retryAfter`) |
| `ANALYSES_DISABLED` | 503 | Kill switch is off |
| `ENQUEUE_FAILED` | 503 | `SendMessage` failed; the analysis is marked FAILED and its ID is returned in `details` |
| `INTERNAL` | 500 | Anything unexpected, or the session secret is missing, short or unreadable (sessions fail closed) |

**Analysis-level failures** are returned as `status: 'FAILED'` with `error: { code, message, requestId }` inside a `200` poll response: `QUEUE_TIMEOUT`, `PIPELINE_TIMEOUT`, `GENERATION_TIMEOUT`, `GENERATION_FAILED`, `MALFORMED_OUTPUT`, `NO_RELEVANT_EVIDENCE` (retrieval returned nothing; generation is not called), `INDEX_UNAVAILABLE`, `WORKER_FAILED` (DLQ), `ANALYSES_DISABLED` (kill switch turned off while queued), and `ENQUEUE_FAILED`.

### 9.1 User-visible error and degraded states

Each state has a designed screen with a plain-language message, a request ID where a request failed, and a recovery action. SPEC v1 §27 states first (SPEC §38.2), then states the new IA adds:

| State | Trigger | What the user sees |
|---|---|---|
| Generation timeout (SPEC v1 §27, archived: "Bedrock timeout") | `GENERATION_TIMEOUT` | "The analysis took too long." Re-run creates a new analysis. |
| Search unavailable (SPEC v1 §27, archived: "OpenSearch unavailable"; no OpenSearch here) | `INDEX_UNAVAILABLE` | "Filing search is unavailable right now." Retry. |
| No relevant evidence | `NO_RELEVANT_EVIDENCE` (no generation call) | "The filings don't cover this." Suggested covered companies and periods. |
| Malformed output | `MALFORMED_OUTPUT` | "The answer couldn't be validated." Re-run. |
| Unsupported query | `VALIDATION_ERROR` (empty, over 1,000 characters), or a question about companies outside the corpus (assumptions A4) | Inline form error; for out-of-corpus companies, an `insufficient_evidence` brief or `NO_RELEVANT_EVIDENCE` with the list of covered companies. |
| Missing source document | `SOURCE_MISSING` | "This filing isn't available." Back to the brief; the finding keeps its copied passage. |
| Missing corpus or index | `INDEX_UNAVAILABLE` on analyses; `GET /api/health` reports `indexAvailable: false` | Banner on Deep Analysis; dashboards still load from profiles. |
| Invalid citation | Removed and counted by validation | "1 citation removed: not in the supplied evidence" badge on the brief. |
| Network failure | Client `fetch` fails or the browser is offline | "Connection lost." Polling retries every 3 s and resumes automatically; the analysis continues server-side. |
| Poll server error | `GET /api/analyses/:id` answers 5xx, `INTERNAL`, a non-JSON gateway error or 429 | "Checking on this analysis failed" with the status and request ID; polling retries with backoff (3 s doubling to 30 s) and a Retry now button. Any other 4xx stops polling and says "Updates for this analysis stopped", with the request ID and Retry. The page never freezes silently. |
| Workspace not opened | `POST /api/session` fails (a creation cap, `INTERNAL`, network) | A banner with the reason, the request ID, when to come back (`retryAfter`) and Retry. The landing page and the company list (static catalog) still render; Company Intelligence and Compare say the workspace could not be opened instead of loading forever. |
| Profile missing | `PROFILE_MISSING` | "Intelligence for {company} isn't built for this index version." Offers Deep Analysis for that company. |
| Index / profile version skew | The profile's `indexVersion` ≠ `health.indexVersion` (`GET /api/health`) | Notice on the dashboard: "Built from index {v}." Citations still open because profiles carry passage text. |
| Partial compare | `missing` non-empty, or a limited-history company selected | Missing tickers listed; limited-history columns labeled. |
| Rate limited / disabled | `RATE_LIMITED`, `ANALYSES_DISABLED` | Cap or pause explained, with when to try again (`details.retryAfter`). Dashboards keep working. |
| Session expired | `SESSION_REQUIRED` (workspace TTL passed) | The web client opens a new (reseeded) session once and retries the request. |

---

## 10. Frontend routes *(planned: Phase 1)*

Static export, so detail views use query parameters (ResolveIQ pattern). Since Phase 5 all workspace state (analyses, findings, the workspace itself) comes from the api through `apps/web/src/lib/workspace-client.ts` and `workspace-store.tsx`; nothing is kept in browser storage. Primary nav, in order (DD-15): **Company Intelligence | Compare | Deep Analysis | Findings**, then **Thesis | Watchlist** once Phase 8b builds them. Until then those two are **omitted from the nav** (no stub pages). A global **"Ask a question"** action in the top bar opens Deep Analysis empty from any page.

| Route | Page | Priority / phase |
|---|---|---|
| `/` | Product landing (SPEC §7): hero "Know what changed. Know what matters. Know what to investigate next." with CTAs "Open Company Intelligence", "Ask any question" and "How it works" (Architecture); the launch film (`#film`) under it; then problem, how it works, shows its work, two ways in, how it is built, closing CTA | P0 / 1 |
| `/intelligence` | Company selector: deep-coverage companies featured (Apple first), plus search across all 54 | P0 / 1 |
| `/intelligence?ticker=AAPL` | Company Intelligence dashboard: 30-second view, Performance, drivers, current risks, What's Changed, Attention Signals with Why This Matters, Recommended Diligence, coverage note | P0 / 1 (fixtures), 5 (real) |
| `/compare?tickers=AAPL,MSFT,NVDA` | Compare: trajectories, common and distinctive attention areas, diverging trends, management emphasis, comparative diligence | P0 / 1, 5 |
| `/analysis/new?q=&tickers=&origin=` | Deep Analysis input (any question). Prefill only fills the form; **it never auto-submits**. Generation starts only on an explicit Run click (`POST /api/analyses`) | P0 / 1, 5 |
| `/analysis?id=` | Diligence Brief with real stages, Interpretation panel, coverage matrix, numeric-grounding badges, citations, Save Finding | P0 / 1, 5 |
| `/findings` | Findings Board (group by company, theme, status, origin) | P0 / 1, 5 |
| `/sources/filing?id=#chunk-<id>` | Readable filing with section nav and passage highlight, reached from every citation | P0 / 6 |
| `/architecture` | **Architecture and business value:** live vs offline planes (and the DD-16 override, stated plainly), single-call proof, evaluation results, cost and scaling, how this creates value for a PE team (SPEC §44.2 and §3.4), future state | P0 / 1 (static), 7 (measured numbers), 9 (final) |
| `/sources` | Secondary: filing explorer | P1 / 8b |
| `/ic-brief` | Secondary: IC Brief, with print mode | P1 / 8b |
| `/thesis` | Theses: supporting / challenging / open questions / watched signals | P1 / 8b |
| `/watchlist` | Watched companies and categories, filing and intelligence events, future-state monitoring panel | P1 / 8b |

---

## 11. Security and spend protection *(sessions, api IAM, caps and the api kill-switch check built in Phase 5; security headers, CSP and the IAM review in Phase 7)*

- Bedrock is called only from the worker Lambda; the browser never holds AWS credentials.
- **Least-privilege IAM:**
  - api Lambda (Phase 5, CDK test-enforced): `ssm:GetParameter` on the kill-switch, active-profile-set and session-secret parameters (the SecureString uses the AWS-managed `aws/ssm` key, so there is no kms statement); `dynamodb:GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`, `Query` and `BatchWriteItem` on its table; `sqs:SendMessage` on the WorkerStack queue (WorkerStack is now created before ApiStack, because the api imports the queue); `s3:GetObject` on `intelligence/*` and `index/<indexVersion>/manifest.json` only. **No Bedrock permission**, because profiles are only read. Read-only `corpus/processed/*` and `index/*/adjacency/*` arrive with the Phase 6 source view and adjacent-evidence routes. Environment: `TABLE_NAME`, `DATA_BUCKET`, `INDEX_VERSION`, `QUEUE_URL`, `KILL_SWITCH_PARAM`, `ACTIVE_PROFILE_SET_PARAM`, `SESSION_SECRET_PARAM` and the four caps (`WORKSPACE_HOURLY_ANALYSIS_CAP`, `GLOBAL_DAILY_ANALYSIS_CAP`, `DAILY_WORKSPACE_CREATION_CAP`, `PER_IP_DAILY_WORKSPACE_CAP`).
  - A unit test (`services/api/src/phase5-units.test.ts`) bundles the api handler with esbuild, as CDK does, and asserts from the bundle's metafile that no input or import is a Bedrock client, `packages/rag` or `@diligenceiq/rag`, or the worker.
  - Profile builder: not deployed. It runs with the admin's own credentials (DD-16).
  - worker Lambda: its own table, read-only on `index/*`, read the kill-switch parameter, `bedrock:InvokeModel*` scoped to the configured inference-profile ARN and the foundation-model ARNs it routes to (for `us.anthropic.claude-sonnet-4-6`: us-east-1, us-east-2, us-west-2) plus the embedding model.
  - dlq-handler Lambda: conditional update on its own table only.
- Input validation with size limits: question ≤ 1,000 characters, notes ≤ 2,000, thesis statement ≤ 1,000, thesis open questions ≤ 20 × 500, thesis links ≤ 50, ≤ 20 theses and ≤ 25 watches per workspace, compare 2–5 tickers. Every ticker in a path or body is checked against the company catalog.
- **Prompt-injection posture:** retrieved filings are wrapped and labeled as untrusted data. The system prompt forbids following instructions found in them, and the output is schema-constrained with citations validated server-side.
- **Security headers** via Amplify `customHttp`: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors none. The CSP strategy for the inline scripts a static Next.js export emits (hashes vs. a scoped allowance) is decided in Phase 7.
- **Spend protection** (the AWS Budget is an alert only; it does not stop spend):
  - **Kill switch:** SSM parameter `/diligenceiq/analyses-enabled`, cached ~60 s. Checked on `POST /api/analyses` and again by the worker before generation.
  - **Global daily cap:** `GLOBAL / RATE#<yyyy-mm-dd>` counter, incremented by a conditional update that fails at the cap (`GLOBAL_DAILY_ANALYSIS_CAP`, default 200).
  - **Per-workspace hourly cap:** `WS#<id> / RATE#<yyyy-mm-ddThh>` (`WORKSPACE_HOURLY_ANALYSIS_CAP`).
  - **Workspace-creation caps:** first per client, `GLOBAL / WSCREATE#<yyyy-mm-dd>#<hash16>` (`PER_IP_DAILY_WORKSPACE_CAP`, default 100, a fifth of the global cap; a salted hash of the source IP, never the IP), then global, `GLOBAL / WSCREATE#<yyyy-mm-dd>` (`DAILY_WORKSPACE_CREATION_CAP`, default 500). Cookie-clearing can't mint unlimited workspaces, and one client can't use up everyone's (DD-20 (f); assumptions D12).
  - HTTP API stage throttling, and the worker's event-source `maximumConcurrency: 2`.
  - Counters are not refunded when a later step fails, so the caps err on the conservative side.
- **Sessions:** an HMAC-signed workspace cookie (§8 Demo sessions). The secret is an admin-created SSM SecureString; without a valid one, sessions fail closed.
- No secrets in source. Logs never contain secrets, full prompts, or chunk text unless `DEBUG_LOG_PROMPTS=true` (off in prod).

---

## 12. Observability *(planned: Phase 7)*

- **Structured JSON logs** with `requestId` and `analysisId` on every line. One summary event per analysis carries every SPEC §30.1 field (§8 telemetry).
- **CloudWatch log retention will be set to 14 days**, explicitly per log group.
- **Metric filters:** `GenerationCallCount` (alarm if > 1), generation latency, citation validation failures, malformed outputs, timeouts by code. DLQ depth alarm.
- No high-frequency or background telemetry.

---

## 13. Cost and Scaling Strategy

Principle (from the cost addendum): **idle cost as close to zero as practical; active cost proportional to usage.**

### 13.1 What costs money while nobody is using it

| Resource | Idle cost character |
|---|---|
| Amplify Hosting (static) | Storage of built assets only; no idle compute |
| S3 (raw corpus ~79 MB + processed text + index ~150–250 MB) | Storage only, well under 1 GB |
| DynamoDB on-demand | Storage only; no provisioned capacity |
| Route 53 hosted zone | Already exists for `mikemiller.ai`; no new zone |
| SSM Parameter Store (standard) | Standard parameters (session secret, kill switch) |
| CloudWatch Logs | Bounded by 14-day retention |
| Lambda, API Gateway HTTP API, Bedrock | **No idle compute.** Pure request/usage billing |
| SQS + event source mappings | Lambda's event source mappings long-poll the queue and DLQ continuously, which generates SQS requests even when idle. These are request charges, typically within the SQS free tier; no compute runs. |

**Deliberately absent**, because each one bills around the clock:
- OpenSearch domains or Serverless OCUs
- NAT gateways
- EC2, ECS, or Fargate
- RDS or Aurora
- WAF web ACLs
- Provisioned concurrency
- Scheduled jobs

A CDK assertion test (Phase 1+) will fail the gate if any of these appear in the synthesized templates. This mirrors CareerOps' `make costs`.

Expected idle cost is dominated by storage. Exact figures will be computed from current pricing in Phase 8 rather than estimated here.

### 13.2 What costs money when someone uses it

| Driver | When | Scale |
|---|---|---|
| Bedrock generation (Claude Sonnet 4.6 by default) | Once per analysis | **Dominant runtime cost.** ~25K input + ~3K output tokens per brief (estimate; measured per run) |
| Bedrock embedding (query, Titan v2) | Once per analysis | Tiny: one short query |
| Company Intelligence, Compare, Thesis, Watchlist | Per page view | S3/DynamoDB reads only; **no model cost** |
| Bedrock rerank (only if enabled) | Once per analysis | Per-search-unit pricing |
| Lambda | Per request / per analysis | Worker ~5–40 s at 3 GB per analysis; api ms-scale |
| DynamoDB / SQS / HTTP API | Per request | Negligible at demo scale |

Per-analysis estimated cost is computed from a **configured pricing table** in code and stored with each analysis's telemetry. It is shown as an *estimate*, not as billing truth. Total runtime spend is bounded by the global daily cap and the kill switch (§11).

### 13.3 One-time offline cost
Embedding the corpus (~20M tokens) happens **once** per index version, with Titan Text Embeddings v2 by default. Embeddings are cached by content hash, so a re-chunk embeds only changed chunks. The index manifest records embedding calls and tokens consumed. Cohere Embed v4 is capped at 16.2M tokens/day cross-region in this account (non-adjustable), so a full Cohere build takes about 1.5 days of quota; it was not evaluated in Phase 3 and is not used.

**Company Intelligence profiles** are also a one-time offline cost, under the dated override in DD-16: at most **one generation call per company per (`indexVersion`, `profilePromptVersion`)**, so 54 calls for a full LLM build, and zero for the deterministic set. The bound is enforced by the append-only build ledger (no `--force`; a rebuild needs a version bump). The build is budget-capped (`--max-calls`) and run manually; no page view or schedule triggers it. The ledger and manifest record calls, tokens, and model per profile. Profiles are a few tens of KB each in S3.

### 13.4 How idle compute reaches zero
- No server is running: the frontend is static, and Lambdas exist only during a request.
- The search index is a file in S3. A warm worker keeps it in memory, and once the environment is reclaimed nothing remains running.
- Demo-workspace cleanup is DynamoDB TTL, with no cron.
- The Watchlist does not poll. Live filing monitoring (EventBridge → SEC check → ingestion → change detection → SNS) is future state (DD-19), because it would add a schedule.
- The cold-start index load happens inside the async job and is shown as a real stage; it is measured in Phase 2. No prewarm, schedule, or provisioned concurrency is used. A user-triggered prewarm remains a documented future option.

### 13.5 Evolution path

| Stage | Retrieval & compute | When to move |
|---|---|---|
| **Current / Pilot** (built now) | S3 index artifacts + Lambda in-memory hybrid retrieval; DynamoDB; Amplify static | ≤ ~100K chunks, a handful of concurrent analysts |
| **Growing deployment** | Managed vector/search (OpenSearch Serverless or managed domain, or S3 Vectors + OpenSearch for lexical) behind the same `SearchBackend` interface; incremental ingestion pipeline (S3 event → Step Functions); Cognito SSO; raised Lambda concurrency and worker `maximumConcurrency` | Corpus beyond memory comfort (~1M chunks), continuous ingestion of new filings or deal-room documents, many concurrent users |
| **Enterprise scale** | Dedicated search infrastructure, per-tenant or per-deal isolation and KMS keys, VPC + PrivateLink to Bedrock, WAF, fine-grained audit logging, workload-specific scaling and provisioned throughput | Multiple funds or clients, confidential deal-room data, compliance requirements |

Swapping the search layer does not touch the planner, context builder, generation, or UI. They depend only on the `SearchBackend` interface.

---

## 14. Testing

The test plan (frameworks, locations, unit/integration/CDK/E2E targets, eval harness, and what runs in `pnpm gate` versus on demand) is in [testing-strategy.md](testing-strategy.md). The phase-by-phase delivery plan is in [implementation-plan.md](implementation-plan.md).

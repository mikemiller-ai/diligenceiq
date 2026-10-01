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
| Worker concurrency | SQS event source mapping `maximumConcurrency: 2`, no reserved concurrency | The account's Lambda concurrency limit is **10, shared with other apps** (assumptions D7). Reserving concurrency would take capacity from them; the mapping cap bounds this app without reserving any. |

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
infrastructure/cdk/    CoreStack, ApiStack, WebStack (+ CDK assertion tests)
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

### 4.1 Run an analysis *(planned: Phases 3–5)*

```text
Browser                         api Lambda                         SQS        worker Lambda                     Bedrock
  │ POST /api/analyses  ───────▶ kill switch (SSM, cached 60 s)
  │                              validate (Zod, ≤1,000 chars)
  │                              caps: workspace hourly, global daily (conditional counters)
  │                              put ANALYSIS (QUEUED, queuedAt, deadlineAt = queuedAt + 240 s)
  │                              send message ─────────────────────▶ │
  │ ◀── 202 {analysisId}         (send fails → mark FAILED ENQUEUE_FAILED, 503 + requestId)
  │                                                                 └──▶ claim (QUEUED→RUNNING + claimToken, conditional)
  │ GET /api/analyses/:id (poll ~1.5 s)                                  stage=analyzing   query analysis
  │ ◀── {status, stage}  (past deadlineAt → lazily mark FAILED)          stage=retrieving  embed query ───────▶ embed (retrieval)
  │                                                                      stage=balancing   lanes + RRF
  │                                                                      stage=context     context builder
  │                                                                      stage=generating  persist generationStartedAt,
  │                                                                                        ONE request ───────▶ Claude (generation)
  │                                                                      stage=validating  schema/citations/numbers
  │ ◀── {status: COMPLETE, brief, interpretation, coverage, telemetry}   persist (conditional on claimToken)
```

The stages shown in the UI are the stages the worker actually writes. There is no fake progress. Cold-start index loading happens inside the async job and shows as the first stage; its duration is measured in Phase 2. A user-triggered prewarm is a documented future option, not part of v1.

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

### 4.3 Job lifecycle and stuck-job handling *(planned: Phase 4)*

`QUEUED → RUNNING → COMPLETE | FAILED`. Every transition is a DynamoDB conditional write, so concurrent writers (worker, poll, DLQ handler) cannot overwrite each other.

| Situation | Who acts | Result |
|---|---|---|
| `SendMessage` fails in `POST /api/analyses` | api Lambda | Analysis marked `FAILED` (`ENQUEUE_FAILED`); the response is an error with `requestId`. |
| Message waits in the queue past `deadlineAt` | Next `GET /api/analyses/:id` | Conditional write `status = QUEUED AND deadlineAt < now` → `FAILED` (`QUEUE_TIMEOUT`). A later delivery finds it not QUEUED and is acknowledged without work. |
| Worker claims too late to finish | Worker | Claim requires `deadlineAt > now`. Before generation the worker checks that the remaining time (bounded by `deadlineAt` and the Lambda's remaining time) covers the generation budget; otherwise it fails the job **without** calling Bedrock. The Bedrock call is aborted at that budget, so a healthy worker always finishes before `deadlineAt`. |
| Worker dies mid-job (crash, timeout) | Next poll after `deadlineAt` | `RUNNING` → `FAILED`: `GENERATION_TIMEOUT` if `generationStartedAt` is set, otherwise `PIPELINE_TIMEOUT`. |
| Message redelivered (visibility timeout expired, duplicate delivery) | Worker | Claim fails because the analysis is not QUEUED, or is past `deadlineAt` (the 1080 s visibility timeout always exceeds the 240 s deadline) → acknowledge, no work. Redelivery is never a recovery path; see DD-04. |
| Invoke throttled before the claim (account concurrency limit 10, shared) | Next poll after `deadlineAt` | `QUEUED` → `FAILED` (`QUEUE_TIMEOUT`). No silent retry. The user re-runs, which creates a new analysis. |
| Worker fails before claiming, 3 times | SQS → DLQ → dlq-handler Lambda | Analysis marked `FAILED` (`WORKER_FAILED`) if still QUEUED/RUNNING. Event-driven, not scheduled. |
| Worker finishes after the record was marked FAILED | Worker | Final write is conditional on `status = RUNNING AND claimToken = mine`, so it is rejected; the outcome is logged. |

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

---

## 5. Single-call guarantee (defense in depth) *(planned: Phase 4)*

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

**Scope.** This guarantee covers every live analysis. The offline profile build (§4.4) is a separate, admin-run plane with its own one-call-per-profile rule. It uses the same `GenerationGateway` class with `purpose: 'profile'`, `maxAttempts: 1`, and per-profile call counts in the build manifest. The worker only ever constructs a gateway with `purpose: 'analysis'` (a unit test spies on the gateway constructor across the worker handler's paths), and a bundle test asserts that no deployed bundle includes `scripts/intelligence`, `packages/rag/profile`'s prompt builder, or `prompts/company-intelligence-prompt.md`.

---

## 6. RAG design *(planned: Phases 2–4)*

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

### 6.2 Chunking
- Target **~900 tokens (~3,600 characters)** with **~120-token overlap**, split on paragraph, then sentence, boundaries. Pipe-delimited tables are kept intact when they fit, otherwise split on row boundaries.
- Lines are not paragraphs: a single line can be 287,855 characters, so the splitter works on sentence and table-row boundaries inside lines and enforces a hard character cap.
- A contextual header (`Apple Inc · 10-K FY2022 · Item 1A Risk Factors › Supply chain`) is prepended to the text used for embedding and BM25. The citation text shown to users is the raw passage.
- Rationale: a risk factor or MD&A argument, together with its supporting numbers, usually fits in one citable unit. At this size ~25–30 chunks fit in a ~24K-token context, which leaves room for multi-company and multi-year balance. Final values are confirmed against retrieval evals in Phase 3 and recorded here.

### 6.3 Chunk / citation IDs
- Human-readable and built from **fiscal** labels: `AAPL-FY2025-10K-1A-004`, `NVDA-FY2026Q3-10Q-MDA-012`. The citation ID shown to the model **is** the chunk ID.
- IDs are stable within an `indexVersion`. A re-index (new chunker or embedding version) may renumber them, so evidence never depends on the live index after the fact: each analysis stores a context snapshot (§8), and each saved finding stores its cited passage text, source metadata, and `indexVersion`.
- Metadata: `chunkId, documentId, company, ticker, cik, sector, filingType, filingDate, periodEnd, fiscalYear, fiscalQuarter, calendarQuarter, section, sectionCode, subsection, boilerplate, sourceFile, chunkIndex, charStart, charEnd, text`.

### 6.4 Index artifacts (S3 `index/<version>/`)
- `vectors.bin`: Float32 matrix, **Amazon Titan Text Embeddings v2** (`amazon.titan-embed-text-v2:0`), 1024 dimensions, normalized. Dimension and quantization are confirmed in Phase 2 against load time. Cohere Embed v4 is evaluated as an alternative in Phase 3 (DD-08).
- `bm25.json`: precomputed inverted index (postings, document lengths, IDF).
- `chunks.jsonl`: chunk metadata + text.
- `adjacency/<TICKER>.json`: for each chunk, the top 3 chunks of the **same section** in the previous and the next comparable filing of the same company (10-K ↔ 10-K, 10-Q ↔ 10-Q), ranked by cosine similarity of the stored embeddings. Computed offline at index build, no model call. It backs `GET /api/evidence/adjacent` (§9) for adjacent-period comparison of brief citations.
- `summary.json`: the index summary (SPEC §24.4): documents, chunks, companies, fiscal years, filing types, and detected sections per filing.
- `manifest.json`: index version hash (corpus hash + chunker version + embedding model), counts, and embedding calls/tokens consumed.

**Indexing is resumable and cached.**
- Embeddings are cached by `sha256(embedded text + model id)`, so re-chunking only embeds chunks whose text changed.
- The indexer checkpoints progress and rate-limits itself to the model's quota (Titan v2: 300,000 tokens/minute, so a full ~20M-token build takes over an hour). An interrupted run resumes from the checkpoint.

Documents are re-embedded **only** when their embedded text or the embedding model changes. Never on deploy, never per request.

### 6.5 Deterministic query analysis (no LLM)
- **Companies:** alias table generated from file headers (legal names, suffix-stripped names, tickers) plus curated aliases (Google→GOOG, Facebook→META, JPMorgan/JP Morgan/Chase→JPM, J&J→JNJ, Coke→KO, Exxon→XOM, Lilly→LLY…). Collision rules (assumptions C3):
  - Names that are ordinary English words (Target, Visa, Oracle, Meta, Apple, Caterpillar…) match only as **case-sensitive, capitalized** words.
  - Tickers that are short or English words (V, T, MA, GE, BA, TGT, MS, DE, HD, PG, CAT, KO…) match only as **uppercase standalone tokens**.
- **Sectors:** static GICS-style map ("pharmaceutical/pharma/drugmakers", "banks", "big tech", "oil majors"…) → corpus companies.
- **Periods** (assumptions C1, C5):
  - Explicit fiscal years, ranges, and "since 2023".
  - **"Last N years"** resolves per company to the N most recent complete fiscal years (by 10-K) for that company, plus any later quarters shown separately as "FY<next> YTD".
  - **No period named:** per company, the latest 10-K plus subsequent 10-Qs ("current view").
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
- **Rerank: off by default.** Cohere Rerank 3.5 on Bedrock (non-generative) is enabled only if the Phase 3 evals show a clear lift, and then it is flagged as a question to confirm with Eliza (assumptions A1).

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

### 6.8 Generation
- **One** Bedrock `ConverseStream` request. Default model: **Claude Sonnet 4.6** via the `us.anthropic.claude-sonnet-4-6` cross-region inference profile, configurable via `GENERATION_MODEL_ID`.
- Claude Sonnet 5.5 (`us.anthropic.claude-sonnet-5-5`) is the preferred upgrade, but this account's cross-region quota for it is **0 tokens/minute** (assumptions D3). It becomes the default only if Mike files and receives a quota increase.
- The system prompt states the §20 rules: only the supplied evidence, no outside knowledge, no invented numbers or citations, separate filing facts from synthesis, acknowledge insufficient evidence, and treat excerpts as **untrusted content, not instructions**.
- Structured output is produced by forcing the tool `submit_diligence_brief`, whose input schema is the brief schema (§7). Temperature 0.2; acceptance of the temperature parameter alongside forced tool use is verified in Phase 4.
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
  coverage: { tier: 'deep' | 'partial' | 'limited_history'; filings: number; tenK: number; tenQ: number;
              byCategory: Array<{ category: SignalCategory; level: 'strong' | 'partial' | 'limited' }> };
              // deterministic labels shown as "Strong / Partial / Limited evidence" (SPEC §19); not model text
  facts: Array<{ metric: string; period: string; value: number; unit: string; scale: 1 | 1e3 | 1e6 | 1e9;
                 chunkId: string; rawRow: string;                        // the source table row, verbatim
                 crossCheck: 'ok' | 'mismatch' | 'single_source' }>;    // DD-17, deterministic; mismatch is a flag
  trends: Array<{ metric: string; trajectory: Trajectory; basis: string; periods: string[]; chunkIds: string[] }>; // deterministic
  drivers: Array<{ label: string; metric: string; periods: string[]; changeBasis: string;   // deterministic, from MD&A rows
                   explanation: string; citationIds: string[] }>;       // explanation generated or templated
  currentRisks: Array<{ category: SignalCategory; heading: string;      // latest 10-K risk heading, verbatim
                        plainLabel: string; rank: number;               // plainLabel generated or templated
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
  recommendedDiligence: Array<{ question: string; why: string; signalIds: string[]; tickers: string[] }>;
  gaps: string[];
  citations: Citation[];          // server-derived from valid IDs, with passage text (as for briefs)
  generation: { mode: 'llm' | 'deterministic'; modelId?: string; generationCallCount: 0 | 1; ledgerRunId?: string;
                inputTokens?: number; outputTokens?: number; validation: { invalidCitations: number;
                unsupportedFigures: number; bannedPhrases: number } };
};
```

Labels are descriptive only. Scores, ratings and recommendations are not part of the schema, and the validator rejects them (canonical banned-phrase list, DD-16).

**Every figure has a source row.** A number is rendered only from `facts` (or a value derived in code from two facts). The UI shows the fact's `rawRow` and chunk on hover and in the evidence drawer. A number in model-written text must match a fact (numeric validation).

**Phase 1 fixture profiles** (before extraction exists) follow the same rule. They carry **no figures and no narrative presented as fact**: every slot is either clearly labeled placeholder structure ("Revenue trend: placeholder, not filing data") or a value copied verbatim from a filing row with its `chunkId` and `rawRow`. A test fails if a fixture profile renders a numeric figure without a source row (testing-strategy §3).

---

## 8. Data model — DynamoDB single table `diligenceiq` (on-demand) *(planned: Phase 5)*

| PK | SK | Contents |
|---|---|---|
| `WS#<workspaceId>` | `META` | workspace label, createdAt, seed version, `ttl` (30 days) |
| `WS#<workspaceId>` | `ANALYSIS#<ulid>` | question, filters, `origin` (`AnalysisOrigin`, §9: what prefilled it, recorded for provenance only; retrieval uses only the question and filters), status (QUEUED/RUNNING/COMPLETE/FAILED), stage, `queuedAt`, `claimedAt`, `claimToken`, `deadlineAt` (queuedAt + 240 s), `generationStartedAt`, `generationCallCount`, error, interpretation, coverage, brief, validation, telemetry, `ttl` |
| `WS#<workspaceId>` | `CONTEXT#<analysisId>` | **Context snapshot**: the passages sent to the model (text + metadata + `indexVersion`), ≤350 KB guard. A separate item so polls and lists stay small. |
| `WS#<workspaceId>` | `FINDING#<ulid>` | title, text, `theme` (one of the six theme IDs, §8.1), tickers, citations (**passage text + source metadata + `indexVersion`**), `origin` (`FindingOrigin`, §9), analysisId?, note, status (Active / Needs Follow-Up / Resolved), `pinnedToIC`, `isKey`, timestamps, `ttl` |
| `WS#<workspaceId>` | `THESIS#<ulid>` | statement (≤ 1,000), tickers (catalog-validated), `links: Array<{ kind: 'finding' \| 'signal', ref, stance: 'supporting' \| 'challenging' }>` (≤ 50), openQuestions (≤ 20 × 500 chars), watchedCategories, `pinnedToIC`, timestamps, `ttl`. ≤ 20 theses per workspace (P1) |
| `WS#<workspaceId>` | `WATCH#<ticker>` | categories (subset of the signal categories plus `new_filings`, which selects filing events from the filing catalog, and `anything_material`, which selects every intelligence event), createdAt, `ttl`. `ticker` must be in the company catalog; ≤ 25 watches per workspace (P1) |
| `WS#<workspaceId>` | `RATE#<yyyy-mm-ddThh>` | Per-workspace hourly analysis counter, `ttl` |
| `GLOBAL` | `RATE#<yyyy-mm-dd>` | Global daily analysis counter (spend cap), `ttl` |
| `GLOBAL` | `WSCREATE#<yyyy-mm-dd>` | Daily workspace-creation counter, `ttl` |

The context snapshot uses `CONTEXT#` rather than `ANALYSIS#<id>#CONTEXT` so that listing analyses (`begins_with(SK, "ANALYSIS#")`) never reads snapshot items. Polls use a projection (status, stage, error, deadline fields, and the brief once complete), never the snapshot.

The **telemetry** stored on each analysis and emitted as one summary log event (SPEC §30.1 and §35.10):
- `requestId`, `analysisId`, `query` (the user's question is logged; prompts and chunk text are not)
- `retrievalDurationMs`, `generationDurationMs`, `totalDurationMs`
- `retrievalRequests`, `chunksRetrieved`, `contextChunksUsed`, `companiesRepresented`, `filingsRepresented`
- `embeddingCallCount`, `rerankCallCount`, `generationCallCount`, `inputTokens`, `outputTokens`
- `modelId`, `promptVersion` (the Deep Analysis prompt), `indexVersion`, `estimatedCostUsd`. The cost comes from the configured pricing table and is labeled an estimate.

**Demo sessions.** No account is required:
- On first visit `POST /api/session` creates a random 128-bit workspace ID. It is stored in an httpOnly, Secure, SameSite=Lax cookie with an HMAC signature. The secret lives in SSM Parameter Store as a SecureString.
- The workspace is seeded from `seed/demo-workspace.json`, labeled with provenance:
  - real, pre-run analyses and findings;
  - from Phase 8b (P1): a watchlist (AAPL, MSFT, NVDA) and one example thesis. The thesis text is analyst-written and labeled as an example; its links point to real findings.
- Reset deletes and reseeds **only the caller's own partition**.
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

## 9. API contract *(planned: Phases 4–6)*

All bodies and query strings are validated with Zod. Every response carries `x-request-id`. Errors return `ApiError` and never a stack trace. All routes except `/api/health` and `/api/session` require a valid session cookie.

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
  pinnedToIC: boolean; isKey: boolean; createdAt: string; updatedAt: string };
type AnalysisSummary = { analysisId: string; question: string; origin: AnalysisOrigin;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED'; stage?: string; createdAt: string; completedAt?: string };
```

| Method & path | Request | Response |
|---|---|---|
| `POST /api/session` | — | `200 { workspaceId, created: boolean, expiresAt }` + `Set-Cookie` |
| `GET /api/workspace` | — | `200 { stats, recentAnalyses: AnalysisSummary[], recentFindings: Finding[], watchlist: string[] }` |
| `POST /api/workspace/reset` | — | `200` workspace (reseeded) |
| `GET /api/companies` | — | `200 { indexVersion, profileSetId, companies: Array<{ ticker, company, sector, tier, filings, periodsCovered, headline? }> }` (selector; from the active set's manifest) |
| `GET /api/companies/:ticker/intelligence` | — | `200 CompanyIntelligenceProfile` (§7.1) from the active profile set. Read from S3, cached in memory; `404 PROFILE_MISSING` if absent. Never generates. |
| `GET /api/compare` | `?tickers=AAPL,MSFT,NVDA` (2–5) | `200 { companies, missing: string[], trajectories, common, distinctive, diverging, managementEmphasis, attentionRanking, recommendedDiligence, notes, citations }`, composed deterministically from profiles (DD-19). Fewer than two profiles available → `404 PROFILE_MISSING` with `details.missing` |
| `POST /api/analyses` | `{ question: string /* 1–1,000 */, origin?: AnalysisOrigin /* default { kind: 'direct' } */, filters?: { tickers?: string[] /* ≤ 10 */, filingTypes?: ('10-K'\|'10-Q')[], fiscalYearFrom?: number, fiscalYearTo?: number } }` | `202 { analysisId, status: 'QUEUED', pollAfterMs }` |
| `GET /api/analyses` | `?status&cursor&limit` | `200 Page<AnalysisSummary>` |
| `GET /api/analyses/:id` | — | `200 AnalysisSummary & { stage, deadlineAt, error?, interpretation?, coverage?, brief?, citations?, validation?, telemetry? }` |
| `GET /api/analyses/:id/context` | — | `200 { indexVersion, passages: Citation[] }` (evidence drawer; reads the snapshot) |
| `GET /api/findings` | `?theme&ticker&status&origin&analysisId&from&to&pinned&cursor&limit` (`from`/`to` are ISO dates on `createdAt`) | `200 Page<Finding>` |
| `POST /api/findings` | `{ source: FindingSource, theme?, title?, note?, status? }` | `201 Finding`. Text and citations are copied server-side from the stored brief, context snapshot, or profile, never from the client. `origin.kind` is derived from `source.kind`. |
| `PATCH /api/findings/:id` | `{ status?, note? /* ≤ 2,000 */, pinnedToIC?, isKey?, theme?, title? }` | `200 Finding` |
| `DELETE /api/findings/:id` | — | `204` |
| `GET /api/theses`, `POST /api/theses`, `PATCH /api/theses/:id`, `DELETE /api/theses/:id` (P1) | `{ statement, tickers, links?, openQuestions?, watchedCategories?, pinnedToIC? }` | `200/201 Thesis` · `204`. No LLM. Never returns a verdict. |
| `GET /api/watchlist`, `PUT /api/watchlist/:ticker`, `DELETE /api/watchlist/:ticker` (P1) | `{ categories }`. `:ticker` must match `^[A-Z]{1,5}$` and exist in the company catalog (else `400 VALIDATION_ERROR`); categories must be known values | `200 Watch[]` / `200 Watch` / `204`; `409 LIMIT_REACHED` past 25 watches |
| `GET /api/watchlist/events` (P1) | `?ticker&category&kind&cursor&limit` | `200 Page<{ kind: 'filing' \| 'intelligence', ticker, filedAt, filingType, period, signalId?, type?, category?, headline? }>`: filing events from the filing catalog and intelligence events from stored profiles, filtered by watches. No polling. |
| `GET /api/evidence/adjacent` | `?chunkId=` | `200 { chunkId, previous: { filing, passages: Citation[] } \| null, next: { filing, passages: Citation[] } \| null }` from `index/<v>/adjacency/` (§6.4): the same section in the adjacent comparable filings. Deterministic, no model call. |
| `GET /api/ic-brief` | — | `200 { sections: Array<{ id, title, items }>, supportingEvidence: Citation[], markdown }` (§8.2) |
| `GET /api/sources` | — | `200 { indexVersion, companies, filings: Array<{ documentId, ticker, company, filingType, filingDate, periodEnd, fiscalLabel, flags }> }` |
| `GET /api/sources/:documentId` | — | `200 { filing, sections: Array<{ code, title, charStart, charEnd }>, text }` |
| `POST /api/retrieval/debug` | `{ question, filters? }` | Retrieval-only inspection. Feature-flagged, disabled in production. |
| `GET /api/health` | — | `200 { status: 'ok', indexVersion, profileSetId, profileIndexVersion, analysesEnabled }` |

**Error codes → HTTP status** (request-level errors):

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query fails Zod validation |
| `SESSION_REQUIRED` | 401 | Missing or invalid session cookie |
| `NOT_FOUND` | 404 | Analysis, finding, thesis, watch, or workspace not in the caller's partition |
| `LIMIT_REACHED` | 409 | Per-workspace cap on theses (20) or watches (25) reached |
| `PROFILE_MISSING` | 404 | No Company Intelligence profile for the ticker at the current version |
| `SOURCE_MISSING` | 404 | Unknown `documentId` or missing processed filing |
| `RATE_LIMITED` | 429 | Workspace hourly, global daily, or workspace-creation cap reached (`details.scope`) |
| `ANALYSES_DISABLED` | 503 | Kill switch is off |
| `ENQUEUE_FAILED` | 503 | `SendMessage` failed; the analysis is marked FAILED and its ID is returned in `details` |
| `INTERNAL` | 500 | Anything unexpected |

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
| Missing corpus or index | `INDEX_UNAVAILABLE` on analyses; `GET /api/health` reports it | Banner on Deep Analysis; dashboards still load from profiles. |
| Invalid citation | Removed and counted by validation | "1 citation removed: not in the supplied evidence" badge on the brief. |
| Network failure | Client `fetch` fails or the browser is offline | "Connection lost." Polling resumes automatically; the analysis continues server-side. |
| Profile missing | `PROFILE_MISSING` | "Intelligence for {company} isn't built for this index version." Offers Deep Analysis for that company. |
| Index / profile version skew | Active profile set's `indexVersion` ≠ current index version (`GET /api/health`) | Notice on the dashboard: "Built from index {v}." Citations still open because profiles carry passage text. |
| Partial compare | `missing` non-empty, or a limited-history company selected | Missing tickers listed; limited-history columns labeled. |
| Rate limited / disabled | `RATE_LIMITED`, `ANALYSES_DISABLED` | Cap or pause explained, with when to try again. Dashboards keep working. |

---

## 10. Frontend routes *(planned: Phase 1)*

Static export, so detail views use query parameters (ResolveIQ pattern). Primary nav, in order (DD-15): **Company Intelligence | Compare | Deep Analysis | Findings**, then **Thesis | Watchlist** once Phase 8b builds them. Until then those two are **omitted from the nav** (no stub pages). A global **"Ask a question"** action in the top bar opens Deep Analysis empty from any page.

| Route | Page | Priority / phase |
|---|---|---|
| `/` | Compact landing: "Know what changed. Know what matters. Know what to investigate next." CTAs "Open Company Intelligence", "Ask any question" and "How it works" (Architecture) | P0 / 1 |
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

## 11. Security and spend protection *(planned: Phases 5–7)*

- Bedrock is called only from the worker Lambda; the browser never holds AWS credentials.
- **Least-privilege IAM:**
  - api Lambda: its own table, read-only on `corpus/processed/*`, `intelligence/*` and `index/*/adjacency/*`, send to the queue, read the kill-switch and active-profile-set parameters. **No Bedrock permission**, because profiles are only read.
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
  - **Workspace-creation cap:** `GLOBAL / WSCREATE#<yyyy-mm-dd>` (`DAILY_WORKSPACE_CREATION_CAP`), so cookie-clearing can't mint unlimited workspaces.
  - HTTP API stage throttling, and the worker's event-source `maximumConcurrency: 2`.
  - Counters are not refunded when a later step fails, so the caps err on the conservative side.
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
Embedding the corpus (~20M tokens) happens **once** per index version, with Titan Text Embeddings v2 by default. Embeddings are cached by content hash, so a re-chunk embeds only changed chunks. The index manifest records embedding calls and tokens consumed. Cohere Embed v4 is capped at 16.2M tokens/day cross-region in this account (non-adjustable), so a full Cohere build takes about 1.5 days of quota; it is evaluated in Phase 3, not used by default.

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

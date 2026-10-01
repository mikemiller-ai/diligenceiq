# DiligenceIQ — Architecture

> Status: **Phase 0 design baseline.** Nothing below is deployed yet. Sections are marked *(planned)* until the phase that builds them passes its gate; later phases update this file as the source of truth.

DiligenceIQ is an AI investment-diligence workspace for a private-equity deal team. Retrieval-augmented generation over SEC 10-K/10-Q filings is the intelligence engine inside a workflow — **Research → Verify → Capture → Organize → Decide** — not a chatbot.

Governing requirements: [`SPEC.md`](../SPEC.md), [`SPEC-ADDENDUM-COST.md`](../SPEC-ADDENDUM-COST.md) (wins on conflicts), and the Eliza assessment PDF. Related: [implementation-plan.md](implementation-plan.md), [testing-strategy.md](testing-strategy.md).

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
                     │  kill switch + spend caps · analysis create │
                     │  (202) / poll (lazy deadline enforcement)   │
                     └──────┬──────────────┬──────────────┬──────┘
                            │              │              │
                  DynamoDB (on-demand)   S3 (processed   SQS analysis-queue (visibility 1080 s)
                  single table, TTL      filings)        maxReceiveCount=3 → analysis-dlq
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
packages/corpus/       Header parsing, period/fiscal labels, section detection, chunker, company catalog, aliases, sectors
packages/rag/          query/ retrieval/ context/ generation/ validation/ pipeline.ts
services/api/          Lambda handlers (api, worker, dlq-handler), DynamoDB repositories, session, observability, local dev server
infrastructure/cdk/    CoreStack, ApiStack, WebStack (+ CDK assertion tests)
scripts/ingestion/     probe-corpus.mjs (exists), corpus → processed filings + chunks
scripts/indexing/      Chunks → embeddings (cached, resumable) → index artifacts → S3; index summary/validation
scripts/evaluation/    Eval harness over evals/questions.yaml
prompts/               final-diligence-prompt.md + versions/
seed/                  Project Atlas seed (real pipeline outputs, with provenance)
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

### 4.2 Everything else is deterministic and LLM-free

Saving a finding, updating status or notes, pinning to the IC Brief, assembling the IC Brief (§8.2), the Overview statistics, the Sources explorer, and reset all run as plain api-Lambda reads and writes against DynamoDB and S3. **No LLM call.**

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

---

## 8. Data model — DynamoDB single table `diligenceiq` (on-demand) *(planned: Phase 5)*

| PK | SK | Contents |
|---|---|---|
| `WS#<workspaceId>` | `META` | Project Atlas engagement, workstream completion flags, `icThesis` (analyst-written text), createdAt, `ttl` (30 days) |
| `WS#<workspaceId>` | `ANALYSIS#<ulid>` | question, filters, workstreamId, status (QUEUED/RUNNING/COMPLETE/FAILED), stage, `queuedAt`, `claimedAt`, `claimToken`, `deadlineAt` (queuedAt + 240 s), `generationStartedAt`, `generationCallCount`, error, interpretation, coverage, brief, validation, telemetry, `ttl` |
| `WS#<workspaceId>` | `CONTEXT#<analysisId>` | **Context snapshot**: the passages sent to the model (text + metadata + `indexVersion`), ≤350 KB guard. A separate item so polls and lists stay small. |
| `WS#<workspaceId>` | `FINDING#<ulid>` | title, text, workstreamId, tickers, citations (**passage text + source metadata + `indexVersion`**), analysisId, note, status (Active / Needs Follow-Up / Resolved), `pinnedToIC`, `isKey`, timestamps, `ttl` |
| `WS#<workspaceId>` | `RATE#<yyyy-mm-ddThh>` | Per-workspace hourly analysis counter, `ttl` |
| `GLOBAL` | `RATE#<yyyy-mm-dd>` | Global daily analysis counter (spend cap), `ttl` |
| `GLOBAL` | `WSCREATE#<yyyy-mm-dd>` | Daily workspace-creation counter, `ttl` |

The context snapshot uses `CONTEXT#` rather than `ANALYSIS#<id>#CONTEXT` so that listing analyses (`begins_with(SK, "ANALYSIS#")`) never reads snapshot items. Polls use a projection (status, stage, error, deadline fields, and the brief once complete), never the snapshot.

The **telemetry** stored on each analysis and emitted as one summary log event (SPEC §21 plus the cost addendum):
- `requestId`, `analysisId`, `query` (the user's question is logged; prompts and chunk text are not)
- `retrievalDurationMs`, `generationDurationMs`, `totalDurationMs`
- `retrievalRequests`, `chunksRetrieved`, `contextChunksUsed`, `companiesRepresented`, `filingsRepresented`
- `embeddingCallCount`, `rerankCallCount`, `generationCallCount`, `inputTokens`, `outputTokens`
- `modelId`, `promptVersion`, `indexVersion`, `estimatedCostUsd`. The cost comes from the configured pricing table and is labeled an estimate.

**Demo sessions.** No account is required:
- On first visit `POST /api/session` creates a random 128-bit workspace ID. It is stored in an httpOnly, Secure, SameSite=Lax cookie with an HMAC signature. The secret lives in SSM Parameter Store as a SecureString.
- The workspace is seeded with Project Atlas: real, pre-run analyses and findings from `seed/project-atlas.json`, labeled with provenance.
- Reset deletes and reseeds **only the caller's own partition**.
- DynamoDB TTL expires abandoned workspaces, so no scheduled cleanup is needed.

### 8.1 Workstreams
IDs: `financial-performance`, `growth-outlook`, `risk-factors`, `regulatory-compliance`, `liquidity-capital`, `strategic-shifts` (SPEC §7). Status: Not Started (0 analyses), In Progress (≥ 1 analysis), Complete (analyst toggle via `PATCH /api/workspace`).

### 8.2 IC Brief assembly (deterministic, no LLM)

| IC Brief section | Source |
|---|---|
| Executive View | Analyst thesis (`META.icThesis`, written manually) + pinned findings marked `isKey` |
| Financial Performance | Pinned findings from Financial Performance and Liquidity & Capital |
| Growth Drivers | Pinned findings from Growth & Outlook and Strategic Shifts |
| Material Risks | Pinned findings from Risk Factors |
| Regulatory Exposure | Pinned findings from Regulatory & Compliance |
| Outstanding Diligence | Pinned findings with status Needs Follow-Up + workstreams still Not Started |
| Supporting Evidence | Union of the cited passages of all included findings |

---

## 9. API contract *(planned: Phases 4–6)*

All bodies and query strings are validated with Zod. Every response carries `x-request-id`. Errors return `ApiError` and never a stack trace. All routes except `/api/health` and `/api/session` require a valid session cookie.

```ts
type ApiError = { error: { code: ErrorCode; message: string; requestId: string; details?: Record<string, unknown> } };
type Page<T> = { items: T[]; nextCursor?: string };       // opaque cursor; limit default 25, max 100
type WorkstreamId = 'financial-performance' | 'growth-outlook' | 'risk-factors'
  | 'regulatory-compliance' | 'liquidity-capital' | 'strategic-shifts';
type FindingStatus = 'ACTIVE' | 'NEEDS_FOLLOW_UP' | 'RESOLVED';
type Citation = { chunkId: string; indexVersion: string; ticker: string; company: string; filingType: '10-K' | '10-Q';
  filingDate: string; periodEnd: string; fiscalLabel: string; section: string; documentId: string;
  charStart: number; charEnd: number; text: string };
type Finding = { findingId: string; title: string; text: string; workstreamId: WorkstreamId; tickers: string[];
  citations: Citation[]; analysisId: string; note?: string; status: FindingStatus; pinnedToIC: boolean;
  isKey: boolean; createdAt: string; updatedAt: string };
type AnalysisSummary = { analysisId: string; question: string; workstreamId?: WorkstreamId;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED'; stage?: string; createdAt: string; completedAt?: string };
```

| Method & path | Request | Response |
|---|---|---|
| `POST /api/session` | — | `200 { workspaceId, created: boolean, expiresAt }` + `Set-Cookie` |
| `GET /api/workspace` | — | `200 { engagement, icThesis?, workstreams: Array<{ id, name, status, analysisCount, findingCount }>, stats, recentAnalyses: AnalysisSummary[], recentFindings: Finding[] }` |
| `PATCH /api/workspace` | `{ workstreamCompletion?: Partial<Record<WorkstreamId, boolean>>, icThesis?: string /* ≤ 4,000 */ }` | `200` workspace (as GET) |
| `POST /api/workspace/reset` | — | `200` workspace (reseeded) |
| `POST /api/analyses` | `{ question: string /* 1–1,000 */, workstreamId?, filters?: { tickers?: string[] /* ≤ 10 */, filingTypes?: ('10-K'\|'10-Q')[], fiscalYearFrom?: number, fiscalYearTo?: number } }` | `202 { analysisId, status: 'QUEUED', pollAfterMs }` |
| `GET /api/analyses` | `?workstreamId&status&cursor&limit` | `200 Page<AnalysisSummary>` |
| `GET /api/analyses/:id` | — | `200 AnalysisSummary & { stage, deadlineAt, error?, interpretation?, coverage?, brief?, citations?, validation?, telemetry? }` |
| `GET /api/analyses/:id/context` | — | `200 { indexVersion, passages: Citation[] }` (evidence drawer; reads the snapshot) |
| `GET /api/findings` | `?workstreamId&ticker&status&analysisId&from&to&pinned&cursor&limit` (`from`/`to` are ISO dates on `createdAt`) | `200 Page<Finding>` |
| `POST /api/findings` | `{ analysisId, source: { kind: 'keyFinding' \| 'consideration', index: number }, workstreamId?, title?, note?, status? }` | `201 Finding`. Text and citations are copied server-side from the stored brief and context snapshot, never from the client. |
| `PATCH /api/findings/:id` | `{ status?, note? /* ≤ 2,000 */, pinnedToIC?, isKey?, workstreamId?, title? }` | `200 Finding` |
| `DELETE /api/findings/:id` | — | `204` |
| `GET /api/ic-brief` | — | `200 { sections: Array<{ id, title, items }>, supportingEvidence: Citation[], markdown }` (§8.2) |
| `GET /api/sources` | — | `200 { indexVersion, companies, filings: Array<{ documentId, ticker, company, filingType, filingDate, periodEnd, fiscalLabel, flags }> }` |
| `GET /api/sources/:documentId` | — | `200 { filing, sections: Array<{ code, title, charStart, charEnd }>, text }` |
| `POST /api/retrieval/debug` | `{ question, filters? }` | Retrieval-only inspection. Feature-flagged, disabled in production. |
| `GET /api/health` | — | `200 { status: 'ok', indexVersion, analysesEnabled }` |

**Error codes → HTTP status** (request-level errors):

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Body or query fails Zod validation |
| `SESSION_REQUIRED` | 401 | Missing or invalid session cookie |
| `NOT_FOUND` | 404 | Analysis, finding, or workspace not in the caller's partition |
| `SOURCE_MISSING` | 404 | Unknown `documentId` or missing processed filing |
| `RATE_LIMITED` | 429 | Workspace hourly, global daily, or workspace-creation cap reached (`details.scope`) |
| `ANALYSES_DISABLED` | 503 | Kill switch is off |
| `ENQUEUE_FAILED` | 503 | `SendMessage` failed; the analysis is marked FAILED and its ID is returned in `details` |
| `INTERNAL` | 500 | Anything unexpected |

**Analysis-level failures** are returned as `status: 'FAILED'` with `error: { code, message, requestId }` inside a `200` poll response: `QUEUE_TIMEOUT`, `PIPELINE_TIMEOUT`, `GENERATION_TIMEOUT`, `GENERATION_FAILED`, `MALFORMED_OUTPUT`, `NO_RELEVANT_EVIDENCE` (retrieval returned nothing; generation is not called), `INDEX_UNAVAILABLE`, `WORKER_FAILED` (DLQ), `ANALYSES_DISABLED` (kill switch turned off while queued), and `ENQUEUE_FAILED`.

---

## 10. Frontend routes *(planned: Phase 1)*

Static export, so detail views use query parameters (ResolveIQ pattern):

| Route | Page |
|---|---|
| `/` | Compact landing: "Open Project Atlas" and "View Architecture" |
| `/architecture` | Architecture, single-call proof, evaluation, cost and scaling, ROI, future state |
| `/overview` | Deal Overview |
| `/diligence`, `/diligence/workstream?id=` | Workstreams and suggested questions |
| `/analysis/new`, `/analysis?id=` | New Analysis / Diligence Brief |
| `/findings` | Findings Board |
| `/ic-brief` | IC Brief, with print mode |
| `/sources`, `/sources/filing?id=#chunk-<id>` | Filing explorer / readable filing with section nav and passage highlight |

---

## 11. Security and spend protection *(planned: Phases 5–7)*

- Bedrock is called only from the worker Lambda; the browser never holds AWS credentials.
- **Least-privilege IAM:**
  - api Lambda: its own table, read-only on `corpus/processed/*`, send to the queue, read the kill-switch parameter.
  - worker Lambda: its own table, read-only on `index/*`, read the kill-switch parameter, `bedrock:InvokeModel*` scoped to the configured inference-profile ARN and the foundation-model ARNs it routes to (for `us.anthropic.claude-sonnet-4-6`: us-east-1, us-east-2, us-west-2) plus the embedding model.
  - dlq-handler Lambda: conditional update on its own table only.
- Input validation with size limits: question ≤ 1,000 characters, notes ≤ 2,000, thesis ≤ 4,000.
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

- **Structured JSON logs** with `requestId` and `analysisId` on every line. One summary event per analysis carries every SPEC §21 field (§8 telemetry).
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
| Bedrock rerank (only if enabled) | Once per analysis | Per-search-unit pricing |
| Lambda | Per request / per analysis | Worker ~5–40 s at 3 GB per analysis; api ms-scale |
| DynamoDB / SQS / HTTP API | Per request | Negligible at demo scale |

Per-analysis estimated cost is computed from a **configured pricing table** in code and stored with each analysis's telemetry. It is shown as an *estimate*, not as billing truth. Total runtime spend is bounded by the global daily cap and the kill switch (§11).

### 13.3 One-time offline cost
Embedding the corpus (~20M tokens) happens **once** per index version, with Titan Text Embeddings v2 by default. Embeddings are cached by content hash, so a re-chunk embeds only changed chunks. The index manifest records embedding calls and tokens consumed. Cohere Embed v4 is capped at 16.2M tokens/day cross-region in this account (non-adjustable), so a full Cohere build takes about 1.5 days of quota; it is evaluated in Phase 3, not used by default.

### 13.4 How idle compute reaches zero
- No server is running: the frontend is static, and Lambdas exist only during a request.
- The search index is a file in S3. A warm worker keeps it in memory, and once the environment is reclaimed nothing remains running.
- Demo-workspace cleanup is DynamoDB TTL, with no cron.
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

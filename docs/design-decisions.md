# DiligenceIQ — Design Decisions

Lightweight decision records. Format: **Context → Decision → Alternatives considered → Consequences.** Status values: *Accepted* (decided in Phase 0) or *Provisional* (to be confirmed by measurement in a named phase).

---

## DD-01 · Retrieval store: pre-built hybrid index in S3, loaded by Lambda (not OpenSearch)
**Status:** Accepted. SPEC v1 §22 (archived) named OpenSearch; the cost addendum overrode it (now SPEC §35.3).

**Context**
- The corpus is ~81M characters, roughly 20–25K chunks.
- The cost addendum requires near-zero idle cost and says OpenSearch must not be picked by default.
- Mike's other products deliberately avoid always-on search clusters. ResolveIQ ADR-005 rejected OpenSearch Serverless on idle cost, and CareerOps' cost gate fails the build if OpenSearch appears.

**Decision**
- Ingestion and indexing run offline and produce these artifacts in S3 `index/<version>/`:
  - Float32 embedding matrix
  - precomputed BM25 inverted index
  - chunk metadata
  - manifest
- The worker Lambda loads them once per execution environment and caches them in memory.
- Retrieval works as follows:
  - **Exact** cosine similarity by brute force (~25M multiply-adds, tens of ms).
  - BM25 scoring.
  - Metadata filters.
  - Reciprocal Rank Fusion.
- Everything sits behind a `SearchBackend` interface.

**Alternatives considered**

| Option | Retrieval quality | Idle cost | Complexity | Why not now |
|---|---|---|---|---|
| OpenSearch managed domain (t3) | Good (ANN + BM25 native) | Always-on hourly instance billing | Medium: domain, access policy, SigV4, index mgmt | Pays 24/7 for a demo; adds a network dependency during the live demo |
| OpenSearch Serverless | Good | Always-on hourly billing: minimum OCUs billed continuously | Medium | Idle cost (ResolveIQ ADR-005) |
| S3 Vectors | ANN only; no lexical search | Storage and per-query only | Low–medium | Would still need an in-process BM25 index, so two systems instead of one |
| Bedrock Knowledge Base | Opaque chunking and retrieval; limited control over balanced or multi-lane retrieval | Depends on the store | Low | Can't implement per-company or per-year balancing, section-aware chunk IDs, or the exact citation contract |
| **In-process index from S3** | **Exact search (no ANN recall loss) + BM25 + full control** | **S3 storage only** | Low | **Chosen** |

**Consequences**
- The first analysis after idle pays a cold load of the index inside the async job, estimated at 2–4 s and measured in Phase 2. It shows as a real stage. A prewarm endpoint was considered and cut from v1 to reduce scope; it remains a documented future option.
- The index footprint must stay comfortably within Lambda memory. At roughly 100K+ chunks, or with continuous ingestion, move to the Growing tier (architecture §13.5).
- Unit tests and local development need no AWS search service.

---

## DD-02 · Frontend on Amplify Hosting as a static Next.js export
**Status:** Accepted.

**Context**
- SPEC v1 §22 (archived) preferred Amplify (now SPEC §34).
- ResolveIQ and TrustResponse use Amplify static export; CareerOps uses Amplify SSR (WEB_COMPUTE).
- The one generation call can exceed 30 s, which is about Amplify SSR's request ceiling.

**Decision**
- Next.js App Router with `output: "export"`, hosted on Amplify (WEB).
- The app, branch, and custom domain are defined in CDK (`CfnApp`, `CfnBranch`, `CfnDomain`, as in CareerOps).
- An Amplify rewrite proxies `/api/<*>` to the HTTP API, keeping it same-origin.

**Alternatives considered**
- Amplify SSR: request timeout risk, packaging traps (CareerOps had to exclude `apps/web` from the pnpm workspace), and idle-free benefits we don't need.
- CloudFront + Lambda Function URL running Next.js: works, but it is not the house pattern and adds Next-on-Lambda packaging complexity.
- ECS/Fargate: always-on cost, and it needs Docker.

**Consequences**
- No server components fetch data at request time. Pages are client-rendered against the API.
- Dynamic detail routes use query parameters (`/analysis?id=…`), following ResolveIQ's pattern.
- Two items are verified rather than assumed: the rewrite proxy forwarding `Set-Cookie` for a WEB app (Phase 1 deploy) and the CSP strategy for the export's inline scripts (Phase 7).

---

## DD-03 · Long-running generation via async job + polling
**Status:** Accepted.

**Context**
- A grounded multi-company brief can take 25–45 s or more.
- API Gateway (~29–30 s) and Amplify proxies cap synchronous requests.
- House pattern: TrustResponse uses SQS → worker; CareerOps returns 202 + SQS; ResolveIQ uses EventBridge → Step Functions.

**Decision**
1. `POST /api/analyses` checks the kill switch and spend caps, validates the request, writes `ANALYSIS` with status `QUEUED` and `deadlineAt = queuedAt + 240 s`, sends to SQS, and returns 202. If the send fails, the analysis is marked FAILED and the API returns an error with a request ID.
2. The worker Lambda (180 s timeout) is fed by an SQS event source mapping with `batchSize: 1` and `maximumConcurrency: 2`. The queue's visibility timeout is 1080 s (6 × the worker timeout) and `maxReceiveCount: 3` moves poison messages to a DLQ.
3. The worker runs the pipeline and writes each real stage to DynamoDB.
4. The UI polls about every 1.5 s. Polls lazily fail jobs past `deadlineAt`; a DLQ-triggered Lambda fails jobs whose messages dead-letter (DD-14).

**Alternatives considered**
- Lambda Function URL response streaming: real-time tokens, but the Amplify proxy and static hosting complicate it, and it isn't the house pattern.
- Step Functions: more machinery than a single linear job needs.
- WebSockets: idle cost/complexity not justified.

**Consequences**
- Progress stages map to real execution (SPEC §38.1).
- Poll traffic is cheap, a few requests per analysis.
- The UI must handle QUEUED, RUNNING, FAILED, and timeout states.
- No reserved concurrency: the account limit was 10 and shared with other apps when this was decided, and is now 1,000 (raised 2026-10-01, assumptions D7). The event source mapping's `maximumConcurrency` still bounds this app instead.

---

## DD-04 · One-generation-call guarantee enforced in depth
**Status:** Accepted.

**Context:** The assessment's central constraint. Two default behaviors can silently break it:
- The AWS SDK retries throttled calls up to 3 times by default.
- SQS redelivers a message whose processing fails or exceeds the visibility timeout, and can occasionally deliver a message twice.

An earlier draft used `maxReceiveCount = 1` plus reserved concurrency. Reserved concurrency was off the table because the account limit of 10 was shared (raised to 1,000 on 2026-10-01; the rule stands, assumptions D7). The guarantee therefore rests on the claim, not on the queue.

**Redelivery is not a recovery path.** The visibility timeout (1080 s) is far longer than the job deadline (240 s), so any redelivered message arrives after `deadlineAt`. Its claim fails and it is acknowledged without work. Specifically:
- The worker claims **first**, before any fallible work such as the index load. Every failure after the claim persists a specific error code (e.g. `INDEX_UNAVAILABLE`).
- A delivery that never reaches the claim, for example because the account-level concurrency limit throttles the invoke, surfaces as `QUEUE_TIMEOUT` at the deadline. It is never retried silently.
- `maxReceiveCount: 3` only bounds how long a poison message circulates before the DLQ handler records it.
- Recovery is always an explicit user re-run, which creates a new analysis.

**Decision:** Layers, detailed in architecture §5:
1. **SQS: bounded redelivery.** `batchSize: 1`, `maximumConcurrency: 2`, visibility timeout 1080 s, `maxReceiveCount: 3` → DLQ. Redelivery is possible but bounded, and it is never relied on for recovery (see above).
2. **Conditional claim (the guarantee).** `QUEUED → RUNNING` with a fresh `claimToken`, only if `deadlineAt > now`. A delivery whose analysis is not QUEUED is acknowledged without doing any work, so redelivery is harmless.
3. A generation client with `maxAttempts: 1`.
4. `GenerationGateway`, a per-analysis counter that throws on a second call.
5. `generationStartedAt` and `generationCallCount` persisted immediately before the call, a metric alarm if the count exceeds 1, and tests at each layer, including redelivery after a claim.

**Consequences**
- A transient Bedrock throttle surfaces as a clean error; a retry is a new user action, which creates a new analysis, so it never produces a hidden second call.
- A crash after `generationStartedAt` leaves an honest record that one generation was attempted.

---

## DD-05 · Deterministic query analysis + lane-based balanced retrieval
**Status:** Accepted. Built and measured in Phase 3: hybrid retrieval passes 19/20 eval questions (evidence hit rate 0.99, gold recall@context 0.62; full company and period coverage by construction of the lanes), and many-lane questions keep every company ([evaluation.md](evaluation.md) §1).

**Context**
- No runtime LLM may rewrite or plan the query (SPEC §26).
- Multi-company and longitudinal questions must not collapse onto one company or onto the newest filing (SPEC §27).

**Decision**
- Alias, sector, period, filing-type, and topic extraction are fully deterministic.
- A planner turns the analysis into **lanes**: per company, per company × fiscal year, per sector member, or one global lane with per-company caps.
- Each lane runs a filtered hybrid search.
- The context builder enforces lane quotas before filling by score.
- Topics only boost, never filter.
- Period rules are explicit and shown to the user: "last N years" = the N most recent complete fiscal years per company plus a separate "FY<next> YTD"; no period named = latest 10-K plus subsequent 10-Qs, except a change question, which reads the last 3 annual reports (assumptions C1, C5; SPEC §26.3 amended 2026-10-02).
- Name and ticker collisions with English words are resolved by case-sensitive rules (assumptions C3).

**Consequences**
- Retrieval behavior is explainable: the UI shows the resolved scope and a coverage matrix.
- Unknown phrasings still work through semantic search.
- Alias and sector tables need maintenance as the corpus grows. They are generated from headers plus a small curated list.

---

## DD-06 · Section-aware chunking with contextual headers and immutable readable IDs
**Status:** Accepted. Chunk size and overlap are confirmed by the Phase 3 evals: chunker `c2` (3,600 characters, 480 overlap) is kept ([evaluation.md](evaluation.md) §2).

**Context**
- Filings are flattened HTML with inline Item headings.
- Citations must be human-meaningful, and the evidence behind a saved finding must never change.

**Decision**
- Detect Items by offset, skipping the TOC, with the 10-Q Part I/II mapping.
- Chunks are ~900 tokens with ~120 overlap and split on paragraph and sentence boundaries.
- A contextual header is prepended for embedding and BM25 only.
- IDs follow the pattern `TICKER-FISCALPERIOD-FORM-SECTION-NNN` using fiscal labels (e.g. `AAPL-FY2025-10K-1A-004`, `NVDA-FY2026Q3-10Q-MDA-012`). The chunk ID is the citation ID.
- IDs are stable within an `indexVersion`, not across re-indexes.

**Consequences**
- Citations are readable in the brief.
- Analyses persist a context snapshot (a separate `CONTEXT#<analysisId>` item), and findings store their cited passage text, metadata, and `indexVersion`, so evidence never changes after a re-index.

---

## DD-07 · Structured output via forced tool use; server derives the citation list
**Status:** Accepted.

**Context:** The UI renders a research artifact, not markdown, so the output must be schema-valid.

**Decision**
- The one request forces a `submit_diligence_brief` tool whose input schema mirrors `DiligenceBrief`.
- The model only places `citationIds` inline. The server builds `citations[]` from the valid IDs.

**Alternatives considered**
- Free-text JSON instructions: higher malformed-output rate.
- Asking the model for a `citations` array: an extra surface for fabrication and wasted tokens.

**Consequences**
- Validation stays simple.
- Malformed output is rare and handled deterministically: repair or a typed error, never a second LLM call.

---

## DD-08 · Model choices
**Status:** Accepted. Embeddings and rerank: Phase 3 evals (Titan v2 kept, rerank off, [evaluation.md](evaluation.md) §2). Generation: Phase 4 verified that Sonnet 4.6 accepts temperature 0.2 with the forced tool, and measured it over 60 eval briefs ([evaluation.md](evaluation.md) §4–5).

**Context:** Phase 0 read the account's Bedrock quotas (assumptions D3, D8). Claude Sonnet 5.5 has a cross-region quota of 0 tokens/minute; Sonnet 4.6 has 6,000,000. Cohere Embed v4 is capped at 8.1M tokens/day on-demand and 16.2M cross-region (non-adjustable), below the ~20M-token corpus.

**Decision**
- **Generation:** Claude Sonnet 4.6 via the `us.anthropic.claude-sonnet-4-6` inference profile, configurable via `GENERATION_MODEL_ID`. Claude Sonnet 5.5 (`us.anthropic.claude-sonnet-5-5`) is the preferred upgrade only if Mike files and receives a quota increase (quota code L-94A31E46, cross-region tokens/minute). Temperature acceptance with forced tool use is verified in Phase 4.
- **Embeddings:** Amazon Titan Text Embeddings v2 (`amazon.titan-embed-text-v2:0`), 1024 dimensions, normalized; 6,000 requests/min with no daily token quota listed. The indexer is resumable, checkpointed, rate-limited to the 300,000 tokens/min quota, and caches embeddings by `sha256(embedded text + model id)`. Configurable via `EMBEDDING_MODEL_ID`.
- **Cohere Embed v4** (asymmetric `search_document` / `search_query`) was the planned Phase 3 alternative. Its quota allows one full build per ~1.5 days. **Not evaluated in Phase 3** (quota and ~$2.40 cost); a stated limitation (evaluation.md §2).
- **Rerank:** off by default. Cohere Rerank 3.5 is enabled only if the Phase 3 evals show a clear lift, and then flagged as a question to confirm with Eliza (assumptions A1, F1).

**Consequences**
- Invoke entitlement is still unverified and is checked first in Phase 2.
- Switching models is configuration plus an index rebuild for embeddings; the cache makes a rebuild with the same model and chunker free.

---

## DD-09 · Anonymous, server-side demo workspaces
**Status:** Accepted.

**Context**
- Panelists can't sign up.
- State must be server-side (SPEC §40), and one visitor's reset must not affect another.

**Decision**
- A random workspace ID lives in an HMAC-signed, httpOnly, Secure, SameSite=Lax cookie.
- DynamoDB is partitioned per workspace, seeded with the demo workspace (real findings and analyses; a watchlist and an example thesis from Phase 8b; the Project Atlas engagement framing was retired in DD-15), and expired by a 30-day TTL.
- Reset is scoped to the cookie's own partition.

**Alternatives considered**
- Cognito demo users (ResolveIQ/CareerOps): more friction and machinery than an anonymous demo needs.
- localStorage: SPEC §40 says to avoid it.

---

## DD-10 · Cost guardrails as tests
**Status:** Accepted.

**Decision**
- A CDK assertion test fails the gate if the synthesized templates contain OpenSearch, NAT gateways, EC2/ECS, RDS/Aurora, WAF, provisioned concurrency, reserved concurrency, or EventBridge schedules.
- The same tests assert explicit 14-day retention on every log group and least-privilege IAM scoping (architecture §11).
- An AWS Budget will be configured as an **alert only**. It does not stop spend; the caps and kill switch in DD-13 do.

**Rationale:** It turns the cost addendum into an executable rule, mirroring CareerOps' `make costs`.

---

## DD-11 · Monorepo layout (pnpm workspace)
**Status:** Accepted.

**Decision:** `apps/web`, `packages/{core,corpus,rag}`, `services/api`, and `infrastructure/cdk`, following ResolveIQ's layout. RAG logic lives in packages, so the same code runs in the Lambda worker, the evaluation harness, the ingestion scripts, and the tests.

**Consequences:** The gate is the house pattern: `pnpm lint && pnpm typecheck && pnpm test && pnpm cdk:synth && pnpm build`.

---

## DD-12 · Phase gate process adaptation
**Status:** Accepted. Deviates from the wording of SPEC v1 §36–37 (archived); SPEC §48 states the adapted process.

**Context**
- SPEC v1 §36 (archived) listed "adversary fixes its findings" as a gate step, and v1 §37 said the adversary "must not merely produce a report" but fix, add regression tests, and rerun them.
- The installed `adversary` agent (`~/.claude/agents/adversary.md`) is read-only by design ("Do not fix anything"), and changing Mike's global agent definition is out of scope.

**Decision:** Each gate runs in this order:
1. Adversary report (read-only, fresh context).
2. A **fresh** `general-purpose` fixer agent, with no implementation context, fixes the findings, adds regression tests, and reruns them.
3. `/code-review` and fixes.
4. Gate command.
5. `/handoff`, whose commit waits for Mike's go-ahead.

**Consequences:** SPEC v1's intent is preserved: findings are fixed by a context that did not write the original work, and the fix is checked again by `/code-review`. The only difference is that finding and fixing are split across two fresh agents instead of one.

---

## DD-13 · Spend controls: caps and a kill switch
**Status:** Accepted.

**Context**
- The demo is public and anonymous, and each analysis makes one paid generation call.
- An AWS Budget alerts but does not stop spend. Reserved concurrency is unavailable (DD-03).

**Decision**
- **Kill switch:** SSM parameter `/diligenceiq/analyses-enabled`, cached ~60 s, checked by the api Lambda on `POST /api/analyses` and by the worker before generation.
- **Global daily cap:** `GLOBAL / RATE#<yyyy-mm-dd>` counter, conditional update, default 200/day (`GLOBAL_DAILY_ANALYSIS_CAP`).
- **Per-workspace hourly cap** (`WS#<id> / RATE#<yyyy-mm-ddThh>`) and a **daily workspace-creation cap** (`GLOBAL / WSCREATE#<yyyy-mm-dd>`), both env-configurable.
- HTTP API stage throttling and the worker's `maximumConcurrency: 2`.

**Alternatives considered**
- WAF rate rules: a fixed monthly charge (cost addendum).
- Budget actions that detach permissions: slow (billing data lags) and blunt.

**Consequences**
- Worst-case daily generation spend is bounded by the global cap times the per-analysis cost.
- Mike can stop all analyses within about a minute by flipping one parameter, without a deploy.

---

## DD-14 · Job deadlines and stuck-job recovery without schedules
**Status:** Accepted.

**Context**
- No scheduled jobs are allowed (cost addendum), so nothing sweeps for stuck analyses.
- Failure points: the enqueue can fail, a message can wait behind the concurrency cap, the worker can crash or time out, and a message can dead-letter.

**Decision**
- Each analysis stores `queuedAt`, `claimedAt`, `deadlineAt` (queuedAt + 240 s), `generationStartedAt`, and `generationCallCount`.
- `GET /api/analyses/:id` lazily marks QUEUED/RUNNING analyses past `deadlineAt` as FAILED (`QUEUE_TIMEOUT`, `PIPELINE_TIMEOUT`, or `GENERATION_TIMEOUT`) with a conditional write.
- An enqueue failure marks the analysis FAILED in the same request.
- A DLQ-triggered Lambda (event-driven) marks the analysis FAILED (`WORKER_FAILED`).
- The worker only claims before `deadlineAt`, only calls Bedrock if the remaining budget covers generation, and only commits its result if it still holds the claim.

**Consequences**
- Every analysis reaches a terminal state that the user sees, with a request ID, without any background compute.
- Full lifecycle table: architecture §4.3.

---

## DD-15 · Product pivot: investment intelligence first, Deep Analysis as the drill-down
**Status:** Accepted (2026-10-01, from the product direction, now archived at `docs/archive/PRODUCT_DIRECTION.md`; carried into SPEC v2 §3–§6).

**Context**
- SPEC v1 made a question box (New Analysis) the center of the product. That assumes the user already knows SEC filings and knows what to ask.
- The product direction (archived; now SPEC §3) requires value **before** a question: what is happening, what changed, what deserves attention, why it matters, and what to investigate next.
- The Eliza constraints are unchanged. An arbitrary question in an input field must still get one-call, evidence-grounded RAG.

**Decision**
- **Primary nav,** in order: **Company Intelligence | Compare | Deep Analysis | Findings | Thesis | Watchlist.** Thesis and Watchlist are P1. They are **omitted from the nav** until Phase 8b builds them; there are no "coming soon" stubs.
- **Global "Ask a question" action** in the top bar on every page (the SPEC v1 §5 (archived) "+ New Analysis" action, renamed; SPEC §5.2). It opens Deep Analysis empty, so an expert can bypass the guided path at any time (SPEC §5.4). The landing page has the same "Ask any question" entry.
- **Company Intelligence** (`/intelligence`) is the default destination. It is a per-company dashboard that reads a persisted profile (DD-16).
- **Deep Analysis** is the existing RAG pipeline (DD-03 to DD-07), unchanged. Users reach it from Recommended Diligence, signals, What's Changed, Compare, Thesis, Watchlist events, or by typing any question directly. Prefilled questions stay editable.
- **A prefilled Deep Analysis never auto-submits.** Loading `/analysis/new?q=&tickers=&origin=` only fills the form. Generation requires an explicit Run click, which issues the `POST /api/analyses`. A URL alone can never trigger a generation call (E2E test, testing-strategy §6).
- **Progressive levels** (SPEC §5.4) map to surfaces: Level 1 30-second view; Level 2 What's Changed and Attention Signals with Why This Matters; Level 3 Compare; Level 4 Deep Analysis; Level 5 evidence drawer and source view.
- **Secondary destinations:** Sources (also reached through every citation), IC Brief (P1), and Architecture.
- **Workstreams become Finding themes.** The six IDs are kept as a taxonomy: `financial-performance`, `growth-outlook`, `risk-factors`, `regulatory-compliance`, `liquidity-capital`, `strategic-shifts`. The workstream pages and the progress tracker are removed.
- **The demo workspace is retired as a deal.** The "Project Atlas" engagement framing (SPEC v1 §6, archived) leaves the primary screens. The anonymous workspace (DD-09) remains and is seeded with real findings and analyses; a watchlist and an example thesis are added to the seed when Phase 8b builds those surfaces. The PE-client story moves to the landing page and the demo script.
- **Primary screens use plain language:** "Risk changes", not "Item 1A delta". SEC terminology appears only in evidence and source views.

**Alternatives considered**
- *Keep the workstream workspace and add a dashboard tab.* Rejected: the question-first IA would remain the primary experience.
- *A chat-style assistant over a dashboard.* Rejected: SPEC v1 §2 (archived) said "not a chatbot" (SPEC §1.1 keeps it), and chat invites follow-up calls that blur the single-call rule.

**Consequences**
- The uncommitted Phase 1 shell is reworked in place to the new IA before its gate (implementation plan, Phase 1).
- **Data model:** `Finding.workstreamId` becomes `theme`, and Findings gain an `origin`. `THESIS#` and `WATCH#` items are added (architecture §8).
- DD-09's "seeded with Project Atlas" now reads "seeded demo workspace".

---

## DD-16 · Company Intelligence profiles: deterministic facts + one offline structured call per company
**Status:** Accepted (Mike, 2026-10-01). Prompt, thresholds and pass bars are Provisional until the Phase 4b evals. This decision is an **explicit, dated override** of three cost-addendum lines (below).

**Context**
- A dashboard needs plain-language synthesis: a 30-second view, "why this matters", and recommended diligence. Pure templates read as generic.
- Constraints:
  - Assessment: "the answer itself must come from a single LLM call"; "your indexing and retrieval pipeline can run beforehand". The second sentence authorizes precomputed **indexing and retrieval**. It does not authorize precomputed generation. Treating an offline profile call as acceptable is **our interpretation** (assumptions A6), not something the PDF states.
  - Cost addendum: no background LLM calls; no LLM calls merely to populate dashboards; meaningful inference cost only when a user performs an analysis.
  - Product direction §22–24 (archived; now SPEC §32 and §35.13): one structured generation per company profile, persisted, versioned, and never regenerated on page view. Numbers come from deterministic extraction.

**Supersedes / overrides (2026-10-01).** At the time, `CLAUDE.md` said the cost addendum (now archived at `docs/archive/SPEC-ADDENDUM-COST.md`; its rules are SPEC §35) won on cost. The LLM profile set conflicts with three of its lines, quoted verbatim:
- Opening section ("The architecture should:"): "incur meaningful inference cost only when a user actually performs an analysis;"
- §Bedrock: "avoid LLM calls merely to populate dashboards;"
- §Cost-related Definition of Done: "RAG generation occurs only in response to user analysis;"

On 2026-10-01 Mike explicitly chose the hybrid offline profile approach in this session, after being told that the docs at that time said dashboards never call an LLM. That choice overrides the three lines above **for the offline profile build only**, within these limits:

| Limit | Rule |
|---|---|
| Offline | Runs on an admin workstation with the admin's credentials. Never deployed as a Lambda or any other runtime component. |
| Admin-run | Started by hand (`pnpm intelligence:build`). Never on page view, never scheduled, never triggered by an event. |
| Bounded | At most **one** generation call per company per (`indexVersion`, `profilePromptVersion`), enforced by the build ledger below. |
| Budget-capped | `--max-calls` is required; the run stops at the cap. |
| Live plane untouched | Every user question is still exactly one live call (DD-04). The api Lambda has no Bedrock permission. |

The rest of the cost addendum still wins on cost. SPEC v2 carries this override as a named, bounded exception (SPEC §35.7). The deterministic profile set (below) is always built as well, so the override can be withdrawn at runtime with no rebuild.

**Decision**
- **Build-time artifact, not a runtime feature.** Profiles are produced by an admin-run script, `scripts/intelligence/build-profiles.ts`, as a step after index build.
- **Two profile sets per index version** (until F4 is answered; assumptions F4):
  - `intelligence/<indexVersion>/llm-v<profilePromptVersion>/<TICKER>.json`: the LLM set (one call per company, with per-company deterministic fallback when the call errors or fails validation);
  - `intelligence/<indexVersion>/det-v<templateVersion>/<TICKER>.json`: the deterministic set (zero calls).
  - Each set has a `manifest.json`. The set's directory name is its `profileSetId` (`llm-v1`, `det-v1`).
- **Runtime pointer.** The api Lambda reads the active set from the SSM parameter `/diligenceiq/active-profile-set` (value `<indexVersion>/<profileSetId>`, cached 60 s like the kill switch). Switching between the LLM and deterministic sets is a parameter change: instant, no rebuild, no deploy. `GET /api/health` and `GET /api/companies` report the active `profileSetId`.
- **Runtime never generates.** The api Lambda only reads profiles. Opening, refreshing, or comparing dashboards never calls an LLM. Nothing schedules the builder.
- **Pipeline for each company:**
  1. Deterministic financial facts (DD-17).
  2. Deterministic change and signal candidates (DD-18), each with evidence chunk IDs for each period.
  3. Deterministic current risks (latest 10-K risk headings) and drivers (MD&A segment/product rows with the largest reported change), each with chunk IDs (architecture §7.1).
  4. Balanced evidence per period and topic from the same retrieval stack, using fixed deterministic topic lanes.
  5. A context block in the same untrusted-content format as Deep Analysis.
  6. LLM set only: **exactly one** forced-tool generation call (`submit_company_profile`) using `prompts/company-intelligence-prompt.md`.
- **What the model may do:** select, explain, and categorize the supplied signals, risks, and drivers. It writes the executive view, "why this matters", management outlook, and recommended diligence questions.
- **What the model may not do:** cite anything outside the supplied chunk IDs and signal IDs, or state any currency or percentage figure that is neither in the supplied facts nor printed in a passage that the same item cites (numeric validation; the cited-passage half was added 2026-10-02, SPEC A.4).
- **Banned vocabulary (canonical list).** One list, in `packages/core/src/vocabulary.ts`, used by both the profile validator and the eval harness. It applies only to **model-written** text (headline, whatChanged, whyThisMatters, executive view, outlook, recommended diligence). Deterministic labels (trajectory words, coverage levels "Strong / Partial / Limited evidence" from SPEC §19) and quoted filing passages are exempt. Matching is case-insensitive and phrase-level with word boundaries:

  | Banned (phrase rules) | Not matched (allowed) |
  |---|---|
  | Recommendations: `strong buy`, `strong sell`, `buy rating`, `sell rating`, `hold rating`, `rated (a )?(buy\|sell\|hold)`, `(we\|investors should\|you should) (buy\|sell\|hold\|avoid)`, `recommend (buying\|selling\|holding\|investing)`, `(is\|looks like) a (buy\|sell)` | `buyback(s)`, `share repurchase`, `selling, general and administrative`, `sells`, `sold`, `customers buy`, `strong demand` (a filing phrase, allowed when cited) |
  | Scores and ratings: `\d+\s*/\s*(10\|100)`, `score of`, `rating of`, `out of (10\|100)`, `\d+ stars?`, `grade [A-F]\b` | `credit rating(s)` (a disclosure topic), `rating agencies` |
  | Verdicts: `low[- ]risk (investment\|company\|stock)`, `safe investment`, `best investment`, `(undervalued\|overvalued)`, `must[- ]own`, `guaranteed return` | `low-income`, `high-risk` inside a quoted passage |

  Bare "buy", "sell", and "strong" are not banned on their own; only the phrases are. A match rejects the LLM profile and the builder writes the deterministic profile for that company.
- **Fallback.** If validation fails, or no Bedrock call can be made, the builder writes a **deterministic profile** for that company in the LLM set. It uses the same facts, signals, risks and drivers, a curated per-category "why this matters" library, and templated questions. Every company always has a profile, and the profile's `generation.mode` (`llm` | `deterministic`) is shown on the page.
- **Curated "why this matters" library: an allowed, labeled exception** to "no hardcoded demo answers". It is hand-written, generic, per signal category (for example "Customer concentration: when a few customers drive a large share of revenue, losing one can move results"). It never names a company, never states a figure, and never claims what happened. It is rendered with a "General context" label so it is not read as company analysis. It lives in `packages/rag/src/profile/library.ts` and is versioned as `templateVersion`.
- **Same discipline as Deep Analysis.** Generation client `maxAttempts: 1`. A `GenerationGateway` instance with `purpose: 'profile'` allows one call per (ticker, `indexVersion`, `profilePromptVersion`).
- **Build ledger (enforces the one-call bound across processes).** The ledger is append-only by convention: the code only creates objects conditionally and never overwrites or deletes one; the bucket is unversioned and has no Object Lock, so storage does not enforce it, and the builder pins the bucket to CoreStack's DataBucket output. One S3 object per call, `intelligence/ledger/<indexVersion>/<profilePromptVersion>/<TICKER>.json`, holding `{ ticker, indexVersion, profilePromptVersion, startedAt, runId }`. The builder creates it with a conditional write (`If-None-Match: *`) **before** the call, as Deep Analysis persists `generationStartedAt`. Ledger objects are never overwritten or deleted. If the object already exists, the builder makes no call for that key. There is **no `--force`**: regenerating a profile requires a `profilePromptVersion` bump (`llm-v2`), which is a new key. A bump is made **only for a real prompt change**, which gets a real prompt-iteration entry; the version is never bumped just to retry, so prompt history stays truthful. Manifest call counts are derived from the ledger, so interrupted runs are counted.
- **A failed call is never retried at the same version.** If the one call errors (throttle, timeout, Bedrock error) or its output fails validation, that company's profile in the LLM set is its deterministic fallback, with `generation.mode: 'deterministic'`, `generationCallCount: 1` and the failure code in the manifest. It is picked up again only by the next genuine prompt version. The bound stays ≤ 1 call per key, and a transient failure costs one company its LLM narrative, never a hidden second call. Failures count toward the fallback-rate bar below.
- **Telemetry.** Tokens, model, call count (0 or 1), validation results, and the ledger `runId` are recorded per profile in the manifest.
- **Naming.** `profilePromptVersion` is the version of `prompts/company-intelligence-prompt.md`. `templateVersion` is the version of the deterministic library. `profileSetId` names a set. `promptVersion` (no prefix) is reserved for the Deep Analysis prompt in analysis telemetry.
- **Provisional pass bars** (testing-strategy §7; revisited after the first real build): 0 invalid citations, 0 unsupported figures, 0 banned-phrase matches in shipped profiles; LLM-to-deterministic fallback rate ≤ 25% (revised from 10% after the first build, SPEC A.4) across the 12 deep-tier companies; ≤ 1 call per profile.
- **How this is explained to the panel.** "Live: every question you ask is answered by exactly one LLM call. Offline: each company profile is computed once per index version and stored, like the embeddings; the dashboard only reads it. We also ship a zero-call deterministic set and can switch to it instantly." The offline plane gets at most one minute of the demo; the live question stays at the center.

**Implementation notes (Phase 4b, 2026-10-02).** The details that the decision above leaves open, as built:
- The ledger also stores each call's outcome (`<TICKER>.outcome.json`, immutable), so a validator change re-scores the LLM set for free and an interrupted call is visible.
- The profile evidence uses the Deep Analysis retriever in BM25 mode (no query embedding), so the build's only model calls are the profile calls themselves.
- The validator gained two rules from the prompt trials: shares or multiples stated in words are unsupported figures, and a trend word that contradicts its label ("accelerated" for a Growing revenue trend) is rejected (`label_conflict`). Both reject the whole LLM profile, like every other rule.
- `profilePromptVersion` is a bare number (`1`, `2`, `3`); the set is `llm-v<N>` and the ledger key `intelligence/ledger/<indexVersion>/<N>/`. Versions 1 and 2 were three-company trials; their calls stay in the ledger.
- **Fixer pass (2026-10-02, after the Phase 4b adversary).** What changed, with no new call:
  - *Supplied set.* Citations are checked against exactly the SOURCE_IDs printed in the user message, recomputed from the request. The first build used every chunk the deterministic profile cites, which included passages the model never saw (older facts, recommendation passages). A figure may come only from a cited passage whose text was in `<filing_excerpts>`.
  - *Figures.* Only the verified match rules count (`unit_unstated` no longer does). Points are read apart from percentages and must be printed as points in FACTS. Number words with percent or points ("five percentage points") and "half of net sales" are figures in words; time phrases ("the last two quarters") are not. Validator version 2.
  - *Request hash.* New outcomes carry `promptSha256`; a stored outcome whose hash differs from the recomputed request falls back with `stale_outcome`, never a new call.
  - *Claim and outcome writes.* A claim error makes no call (`ledger_error`, count 0); outcomes are kept locally before the ledger write, and a failed ledger write never stops the run.
  - *Display.* The model's headline is stored on the profile and shown with a "Model-written summary" label; the outlook is shown on the dashboard and in Compare with a "Model-written" label ("Not summarized" when absent). A model-written item cites the model's citations only.
  - *Templates (det-v2).* Short company names, the quarterly report only when there is one, revenue growth counted once in the evidence levels.
  - Result: llm-v3 re-validated to 42 model-written profiles and 11 fallbacks (deep tier 3 of 12, 25%); evaluation.md §6.
- **The llm-v3 calls were not hashed.** The 53 v3 outcomes predate `promptSha256`, so their manifest rows say `promptVerified: false`, and it cannot be proven by hash that the request recomputed today is the one that was sent. The code that builds the request (`profile/prompt.ts`, `profile/evidence.ts`, `profile/assemble.ts`) has never been committed, so git cannot show it unchanged since the calls either. What can be shown: the fixer pass changed no prompt text and nothing that feeds the message (a hash comparison of the profile blocks and the full user message for all 53 companies, before and after the det-v2 and validator changes, matched byte for byte), and for all 53 companies the `suppliedIds` recorded at call time equal the recomputed excerpt IDs plus the deterministic profile's citations exactly, which is what the request code computed then. That is consistent with an unchanged request, not proof of one.

**Alternatives considered**
- *Fully deterministic.* This is the safest single-call story, but the narrative is generic. It is built as the `det-v*` set and is the scope fallback if Phase 4b slips (implementation plan, Scope fallback).
- *Profiles assembled from several seeded Deep Analyses per company.* This costs 3–4 calls per company and fragments the profile. Rejected.
- *Generate on first view and cache.* This means LLM calls triggered by page views (cost addendum) and first-view latency. Rejected.

**Consequences**
- Offline generation cost is at most one call per company per (`indexVersion`, `profilePromptVersion`), 54 calls for a full LLM build, recorded in the ledger, the manifest, and architecture §13.3.
- Profile quality is evaluated like Deep Analysis: citation validity, numeric match, vocabulary, signal precision, and fallback rate (testing-strategy §7).
- A profile is a snapshot of the index version it was built from. Findings saved from it copy their passages, as with Deep Analysis findings (DD-06).

---

## DD-17 · Deterministic financial extraction from filing tables
**Status:** Accepted. The metric alias map is Provisional until the Phase 2 golden tests.

**Context**
- Filing tables survive as pipe-delimited rows. For example, AAPL's FY2025 10-K has `Total net sales | $ | 416,161 | … | 6 | % | … | 391,035 | … | 383,285`.
- SPEC §32.2: the LLM must not recreate easily determinable numbers.

**Decision**
- `packages/corpus/financials` scans the MD&A and financial-statement sections (and nothing else). Integrated-report 10-Ks whose statements sit inside their bare-title MD&A are therefore covered too. It recognizes period header rows, a unit hint ("in millions", also in a row under the dates), and row labels matched against a **metric alias map**. Metrics:
  - revenue (e.g. "Total net sales", "Total revenues", "Revenue");
  - gross margin;
  - operating income;
  - net income;
  - cash and equivalents;
  - total debt;
  - capital expenditures;
  - operating cash flow.
- **One table per metric.** For each filing, metric and duration, one source row is chosen and every period of that metric comes from it. A row from the primary statement wins, identified by its caption ("CONSOLIDATED STATEMENTS OF OPERATIONS / INCOME / EARNINGS", "…BALANCE SHEETS", "…CASH FLOWS", "Condensed Consolidated…" in 10-Qs, MSFT's "INCOME STATEMENTS"; a caption inside a sentence or a TOC row does not count). Another table (a note, an MD&A table) is used only when no statement row has the metric, and its facts say `source: 'other_table'`. When the filing's income or cash-flow statement was found but does not show a metric of that statement, the metric is not extracted: a segment table's "Operating Income" (DIS) or a note's "Gross profit" (PFE) is never the company's figure. Balance-sheet metrics may fall back, because total debt is usually reported in a note.
- **Plausibility checks** against the same filing's revenue for the same period: |operating income| ≤ revenue, gross profit ≤ revenue, net margin strictly inside (−200%, 100%), revenue > 0. A failing fact is kept with `suspect` set to the reason, shown as unverified, and never used in a trend.
- **Each value records:** metric, period (fiscal label from the column header and the filing's period table), value, unit, scale, the source `chunkId`, the raw row text, its row and table offsets, `source`, `suspect`, and a cross-check flag. All of these are kept in the profile's `facts` (architecture §7.1), so a figure on screen can always show its source row.
- **Derived values:** growth rates and margins are computed in code only when both inputs exist for comparable periods (same duration, same company) **and come from one place**: a growth rate from one table row of one filing; a margin from one table (numerator and revenue) of one filing. Each trend records its inputs.
- **Trajectory labels** (Accelerating, Growing, Stable, Slowing, Declining; Improving, Stable, Declining for margins) come from fixed thresholds on the derived values. The thresholds are recorded with each label: Stable within ±2.0% growth; Accelerating or Slowing at least 5.0 pp faster or slower than the year before, except that growth after a decline is labeled Growing ("recovering from a decline the year before"), not Accelerating; margins Improving or Declining at a change of at least 1.0 pp.
- **Drivers** come from one MD&A table whose revenue total equals the filing's own extracted consolidated revenue for the same year (within 0.5%) and whose rows add up to that total (within 1%); a deduction schedule (returns, rebates, chargebacks, allowances, discounts) never qualifies.
- **Cross-check.** When a 10-K reports the same metric for several years, values from overlapping filings are compared. A mismatch above 0.5% (for example a restatement) sets `crossCheck: 'mismatch'` on both values. It is a **flag, never a blocker**: the build continues, both values keep their own source rows, and the UI shows "Values differ across filings" with both rows. Values are never averaged.
- **Gaps are honest.** A metric that is not found shows as "Not extracted" and is never filled in. Single-10-K companies get trends from the multi-year columns inside that one 10-K. 10-Qs are extracted too: their comparative columns (quarter and year-to-date vs the same period a year earlier) give BAC and JPM current-year trends after their only 10-K.

**Consequences**
- Long-tail labels (banks, insurers, conglomerates) will extract fewer metrics. The coverage note on the dashboard (and the P1 coverage matrix, DD-19) shows this as partial evidence.
- Golden tests cover AAPL, NVDA, MSFT, JNJ, and XOM (testing-strategy §3), plus CMCSA (statement over segment table). A property test over all 54 companies keeps every margin inside (−200%, 100%) and every trend inside one table. Measured coverage: assumptions G3.

---

## DD-18 · Deterministic change detection and attention-signal candidates
**Status:** Accepted. **Phase 3 go/no-go recorded 2026-10-01, re-measured after the adversary review** ([evaluation.md](evaluation.md) §3).
- **Ships:**
  - **TREND CHANGE:** precision 1.00 (15/15) and recall 1.00 (15/15), judged against 24 direction labels derived from hand-read income statements, as of FY2024 and FY2025.
  - **PERSISTENT:** precision 0.90 (26/29), judged on hand-labeled links only. Link precision is 0.93 (51/55). Recall is 0.89 (24/27) over the categorized labeled headings it targets, and 0.36 (27/74) over all labeled persistent headings. 22 of the 77 chain links (FY2022→FY2023) are unlabeled and unverified. Fully labeled chains score 5/7, a diagnostic that would miss the bar if it gated.
- **Suppressed:** NEW, heading-REDUCED, emphasis EXPANDED/REDUCED and OUTLOOK CHANGE (`DETECTOR_STATUS` in `packages/rag/src/signals/status.ts`). The dashboard therefore leads with current risks, trajectories and recommended diligence.
- **The bar:** precision ≥ 0.8, recall ≥ 0.5, and at least 5 decided candidates. A recall that cannot be measured fails.
- **Scope:** both Go decisions are measured on AAPL, MSFT and NVDA only. Low-yield heading extractions (XOM, GOOG, AMZN, CVX, KO, PFE) get no PERSISTENT, because of the heading floor.
- **Thresholds:** detector thresholds were fixed before the evaluation and not tuned on it.

**Decision.** Signals are computed in `packages/rag/signals`. Each one carries:
- an ID;
- a type;
- a category (Performance, Growth, Margin, Liquidity, Debt, Regulatory, Competition, Customer concentration, Geographic concentration, Supply chain, Cybersecurity, Litigation, Management outlook);
- the periods compared;
- `evidenceByPeriod`: for **each** period compared, its own chunk IDs (`Array<{ period, chunkIds }>`), so the evidence drawer can show the passages side by side;
- the deterministic measurement that triggered it;
- `investigateQuestion`: a templated, editable Deep Analysis question for that type and category (for example NEW + regulatory: "What new regulatory risks did {company} add in {period}, and what actions does management describe?"). It prefills Deep Analysis and never auto-runs.

| Type | Detection |
|---|---|
| NEW / REDUCED (risk) | Diff of normalized risk-factor headings between consecutive 10-Ks, matched by token-set similarity. A heading with no match ≥ threshold in the prior 10-K is NEW. A heading that disappears is REDUCED. |
| PERSISTENT | A categorized heading matched in **each of at least two** consecutive 10-Ks, through the latest one. With a single 10-K nothing is PERSISTENT; its headings appear as current risks instead (architecture §7.1 `currentRisks`). No year is skipped: a 10-K with fewer than `PERSISTENT_MIN_HEADINGS` (10) extracted headings breaks the chain, and a latest 10-K below the floor yields no PERSISTENT. The headline states the matched span ("matched in each annual report FY2022–FY2025"). |
| EXPANDED / REDUCED (emphasis) | Per-topic lexicon density (matches per 10K characters) in Item 1A, compared 10-K vs 10-K only (the detector never compares 10-Qs). A change above both a relative and an absolute threshold triggers the signal. |
| TREND CHANGE | From DD-17 trajectories, inside one filing's multi-year columns. Revenue growth emits on a change of direction: accelerating or slowing by ≥ 5 pp, or turning to a decline after growth. Margins emit on a year-over-year move of ≥ 1 pp, which is a material change in level, not necessarily a reversal. |
| OUTLOOK CHANGE | MD&A outlook-lexicon deltas (demand, headwinds, investment, guidance). The candidate is deterministic; the profile call (DD-16) explains it from the cited passages. |

- 10-Q "no material changes" boilerplate (assumptions B9) never produces a signal.
- JNJ and XOM 10-Qs have no Item 1A (Known corpus anomalies), so their risk signals use 10-Ks only.
- Companies with a single 10-K get no 10-K-vs-10-K signals (NEW, REDUCED, PERSISTENT, 10-K emphasis). They still get in-filing TREND CHANGE signals, current risks, and drivers (architecture §3 tiers), and the profile says "Limited history: one annual report in the corpus". This covers 41 companies: the 37 single-filing companies plus BAC, JPM, MCD and PEP, which have one 10-K each. No company gets 10-Q-vs-10-Q emphasis or outlook signals: the detectors compare 10-Ks only, and both detectors are suppressed in any case.

**Consequences**
- Signals are reproducible and explainable: the evidence drawer shows the measurement and the passages from both periods.
- Precision is measured on a hand-labeled set for AAPL, NVDA, and MSFT. The thresholds were fixed before it and not tuned on it. The Go applies to those three companies; every other company is unmeasured.
- **Phase 3 go/no-go on signal quality** (provisional bar: precision ≥ 0.8 on the hand-labeled set, with a recall sanity check that at least half of the hand-labeled real changes are found). It runs before Phase 4b. If heading diffs or lexicon deltas miss the bar, the signal types that fail are suppressed, and the dashboard **leads with current risks, trajectories, and recommended diligence**. Change signals are shown only for types that clear the bar. This keeps the weakest assumption (G4) from emptying or polluting the dashboard.

---

## DD-19 · Compare, Thesis, Watchlist, and Diligence Gaps are deterministic; live monitoring is future state
**Status:** Accepted. Thesis and Watchlist are P1 and are built in Phase 8b, after the Phase 7 and 8 exit criteria pass (implementation plan).

**Decision**
- **Compare** (P0) is composed in the api Lambda from the selected companies' profiles, with no LLM call. It is built from what every tier has (current risks and trajectories), so it is useful even when a company has no change signals (for example Tesla vs JPMorgan):
  - **trajectories** side by side (revenue, margin, operating income, cash flow), with each company's fiscal-year end shown;
  - **common attention areas:** risk/signal categories present in the `currentRisks` or `signals` of every selected company;
  - **distinctive attention areas:** categories present in exactly one company;
  - **diverging trends:** trajectories of the same metric pointing in opposite directions;
  - **management emphasis:** per company, the top three outlook topics by lexicon density in the latest MD&A (DD-18 lexicons), with the passages;
  - **ranking of attention areas:** by number of selected companies sharing the category, then signal count, then the category's position in the latest 10-K's risk headings, then category order. The rule is fixed and shown in a tooltip;
  - templated comparative diligence questions that prefill a multi-company Deep Analysis (never auto-run). The live question is answered by the one RAG call.
  - **Partial and missing profiles:** a company in the limited-history tier contributes current risks and in-filing trends, and the view says "Limited history" in its column. A selected ticker with no profile is listed in `missing` and the rest are compared if at least two remain; otherwise the response is `404 PROFILE_MISSING`. Different fiscal-year ends are noted, never silently aligned.
- **Thesis** (P1) is an analyst-written statement with:
  - linked findings and signals, each marked *supporting* or *challenging* by the analyst;
  - open questions;
  - watched signal categories;
  - "Test with Deep Analysis" (prefilled and editable, never auto-run).
  - It **never** issues a verdict and calls no LLM. Caps: ≤ 20 theses per workspace, ≤ 50 links and ≤ 20 open questions per thesis.
- **Watchlist** (P1):
  - per-company category preferences (`WATCH#<ticker>`), ≤ 25 watches per workspace; the ticker must exist in the company catalog;
  - **filing events** come from the filing catalog (each filing's filing date, type and period, as in `GET /api/sources`); **intelligence events** are the historical change signals from the stored profiles, filtered by the watched categories. Showing both side by side is the SPEC §21.2 distinction. The `new_filings` category selects filing events;
  - nothing polls.
- **Diligence Gaps / coverage matrix** (P1): per category, "Strong / Partial / Limited evidence" (the SPEC §19 labels), from extraction and signal coverage counts. These are deterministic labels, exempt from the banned-vocabulary list (DD-16). The **brief-level** coverage matrix (company × period for a Deep Analysis) is P0 and separate (architecture §7).
- **Live monitoring is P2.** The pipeline EventBridge → SEC check → ingestion → index update → change detection → watch match → SNS is drawn in `docs/future-state.md` and on the Architecture page. It is **not built**, because the cost addendum forbids schedules in this deployment.

**Consequences:** Every surface here is plain DynamoDB and S3 reads and writes. A test asserts that no model client is reachable from these handlers.

---

## DD-20 · Phase 5 runtime choices
**Status:** Accepted (Phase 5, 2026-10-02).

**Context**
- Phase 5 wires the real api (sessions, workspace, profiles, Compare, analyses, findings) before the Phase 4b profile build exists. Running Phase 5 before Phase 4b is Mike's choice of 2026-10-02, recorded as a SPEC v2 Appendix A.4 amendment to §49 (confirmed by Mike at the Phase 5 handoff).
- The demo needs a seeded workspace, spend caps that hold, and an E2E suite that exercises the real api without spending money.

**Decision**
- **(a) Preview set through the real profile path.** Until Phase 4b, the active profile set is the preview set `fixture-v2` (the web's fixture profiles, exported unchanged by `pnpm profiles:export-fixture` in the runtime layout and uploaded with `pnpm profiles:upload-set`). The api reads it exactly as it will read `det-v*` and `llm-v*`: the SSM pointer, the manifest (`ProfileSetManifestSchema`) and per-profile schema and integrity checks (architecture §4.4).
  - *Reason:* the read path, its caching and its failure modes are built and tested now, and Phase 4b becomes a pointer switch with no api change.
  - *Rejected:* serving profiles from the web bundle until 4b. It would leave the runtime path untested and need a second migration.
- **(b) One finding per source.** The finding ID is derived from its source (`fd-` + the first 20 hex characters of `sha256(sourceKey)`) and written with a conditional create; a second save is `409 ALREADY_SAVED`. This deviates from the `FINDING#<ulid>` key first planned (architecture §8).
  - *Reason:* a double click, a retried request or a second tab cannot create duplicates, and the server enforces the same rule the UI shows (its "saved" state is keyed by `sourceKey`).
  - *Rejected:* ULIDs with only a client-side duplicate check, which a retry or a second tab defeats.
- **(c) Rate counters survive reset.** Reset deletes every item of the caller's partition except `RATE#` counters.
  - *Reason:* otherwise reset would zero the per-workspace hourly cap and let one visitor run unlimited analyses.
  - *Rejected:* a plain delete of the whole partition, which is exactly that bypass. The counters keep their own short TTL (2 days), so keeping them costs nothing.
- **(d) Seed from replayed recordings.** `seed/demo-workspace.json` is built by `pnpm seed:build` from recorded `da-v4` generations of three eval questions, replayed through `runDeepAnalysis` and the validator over the real index. The build is replay-only and fails if a live call would be needed. Seed findings name only their source and are copied server-side.
  - *Reason:* the seed is real pipeline output (no hand-written answers, SPEC §40) at no new Bedrock spend, and it is reproducible.
  - *Rejected:* hand-written example briefs (forbidden: no hardcoded demo answers), and live generation at seed time (spend on every rebuild and non-reproducible).
- **(e) E2E against the real api in-process, with a test-only stub worker.** `pnpm e2e` runs `tests/e2e/local-server.ts`, which serves the static export and answers `/api/*` with the real `createApp` over in-memory stores, the committed fixture profile set and the real seed. The queue goes to a stub worker that walks the real stage names and completes with the stored seed result about the **same companies** the question asks about; a question no seed covers fails with `NO_RELEVANT_EVIDENCE`, never with an unrelated brief. It never calls a model and is never deployed or bundled. The deployed in-region path (api → SQS → worker → Bedrock) is verified separately with `pnpm analysis:run`, only with Mike's approval (AWS writes and spend).
  - *Reason:* every route, session, cap and error path the browser uses is the production code; only the stores, the secret and the worker are local.
  - *Rejected:* mocking `/api/*` per test in the browser (tests a fake contract), and running the real worker (needs the index and Bedrock spend; the worker is unit-tested in `services/api`).

- **(f) Workspace creation is limited per client before the global cap** (Phase 5 adversary H1). `POST /api/session` counts a new workspace first against `GLOBAL / WSCREATE#<day>#<hash16>`, where `hash16` is a salted SHA-256 (HMAC with the session secret) of the request's source IP (`PER_IP_DAILY_WORKSPACE_CAP`, default 100: a fifth of the global cap, so one source cannot drain it alone, yet visitors behind a shared proxy address are not starved; raised from 20 on 2026-10-02 (assumptions D12); `429` scope `workspace_creation_client`), and only then against the global `GLOBAL / WSCREATE#<day>` (default 500). The raw IP is never stored or logged.
  - *Reason:* with only a global counter, one anonymous script could use up the day's 500 workspaces and lock every new visitor out of every page.
  - *Rejected:* dropping the session requirement for read routes (SPEC §33 keeps it), and storing raw IPs (personal data for no benefit). Accepted trade-off: visitors behind one shared address (an office NAT) share the 20 (assumptions D12).
- **(g) Workspaces stay alive while used; META is never absent.** A returning visitor's `POST /api/session` moves the workspace's `META` TTL to 30 days from now (at most once a day); a `META` past its TTL is treated as missing before DynamoDB deletes it. Reset rewrites `META` in place instead of deleting and recreating it, so a request that arrives mid-reset keeps its session. Analyses and findings keep their own 30-day TTL from creation; editing a finding restarts its TTL.

**Consequences**
- Phase 4b ships by writing a set in the same layout and switching `/diligenceiq/active-profile-set`.
- A finding cannot be saved twice from the same item; deleting it frees the source to be saved again.
- The E2E suite proves the page-view rule (no POST except the session, and the worker receives nothing) against the real api.

## DD-21 · Readability: bottom line first, visual signals, progressive disclosure, readable evidence
**Status:** Accepted for step 1, the Company Intelligence dashboard (gated 2026-10-02), and step 2, readable evidence (built 2026-10-02 on `phase-6r-step2`); step 3 proposed. Planned 2026-10-02. Direction chosen by Mike on 2026-10-02 from the `readability-prototype` branch and the Claude Design file "Company Intelligence - current" (with its "refined" jump bar).

**Context**
- After Phase 6, the dashboard, the evidence drawer and the source view are complete but hard to consume. The Apple dashboard is a long scroll: Attention signals (10 cards), Current risks (28 headings), Recommended diligence (6) and long paragraphs everywhere. It is hard to demo.
- Filing text is shown as processed: headings, paragraphs, page footers ("Apple Inc. | 2025 Form 10-K | 6") and `|` table rows run together, so a passage reads as a blob.
- Mike reviewed four directions and chose the **current dashboard's depth plus signals**: keep every section and its text, add a bottom line up front (BLUF), colored direction chips, sparklines, condensed sections and a jump bar. He rejected the plain-language "readable" redesign ("missing too much depth") and the question-card mockups.

**Decision**
- **(a) Bottom line up front, by fixed rules.** A "Bottom line" box under the header lists at most five lines in a fixed order: revenue, profit per sale, cash from operations, the largest revenue line that fell by more than 2% (or "all N revenue lines grew" when every line grew by more than 2%), and risk changes (new or expanded disclosures when a detector reports them, else "N risk areas in every annual report", never "unchanged" while the new and expanded detectors are off, DD-18). Each 30-second-view card gets a bold lead line with its key number. All of it is computed in the web from the stored profile, and every label, direction and colour is the builder's own: a trend's trajectory and the numbers of its `basis` line (read back by core `parseTrendBasis`, pinned to the builder by a contract test), a signal's type and measurement, a driver's `changeBasis`. Facts (DD-17) supply only numbers the builder also derived from the same source row: sparklines, the latest dollar amount, and the exact value behind a rounded figure at a threshold. A metric without a trend gets no line, chip or sparkline; a loss-making company gets loss wording ("Net loss narrowed", "Swung to a profit"); every line names its period, and a line about an older year than the latest annual report is left out. There is no model call, no new stored text and no profile rebuild.
  - *Rejected:* a paid profile rebuild for plain-English summaries (Mike: not needed with this view; optional later, about $6 for 53 companies). Also rejected: model text on page view, which SPEC forbids.
- **(b) Colors describe direction, never a judgment.** Green ▲ up and red ▼ down apply only to "more is more" metrics: revenue, profit, cash and segment sales. Amber ↘ means "slowing". Gray means about the same, or a metric where neither direction is better (debt, capital spending, and the operating cash flow of a company in the Financials sector, where it moves with deposits, loans and trading balances), which keeps its arrow but no color. ↻ marks a repeated disclosure, and blue + marks a new or expanded one. Thresholds match the trend labels (±2% and 1.0 pp). A legend under the bottom line says so. The DD-16 vocabulary rules apply to every fixed-rule string (tested).
- **(c) Progressive disclosure, nothing removed.**
  - Long paragraphs are clamped to two lines with "More".
  - Each risk area shows its first heading, then "Show all N".
  - Attention signals show the first four (changes before repeats), then "Show all N".
  - Recommended diligence shows the first three.
  - Persistent signals fold into one row in What's changed.
  - Every item, citation, Investigate and Save stays one click away and reachable by keyboard.
- **(d) Jump bar.** A sticky "On this page" bar below the top bar links every section the profile actually shows. It carries counts on the long sections, marks the section in view (`aria-current="location"`) and writes shareable `#section` URLs. On phones it is a single "Jump to section" menu. Headings land clear of the bars (`scroll-margin`).
- **(e) Readable filing text is a display layer that preserves offsets.** The source view and the drawer render the processed text with:
  - paragraph breaks restored at glued sentence boundaries;
  - headings detected (risk-factor headings already extracted);
  - bullets as lists;
  - `|` rows as tables;
  - page furniture hidden.

  The stored text, chunk offsets and citations never change. A test proves that the rendered characters equal the source minus the hidden furniture, for all 246 filings.
- **(f) Evidence leads with what is closest to the claim.** The drawer first shows the one to three sentences of the passage closest to the claim. They are picked by word and figure overlap, deterministically, labelled as overlap (not proof), and highlighted in place, with the full passage one click away. Only figures printed exactly are bold (for a brief, only the ones its validator verified in that passage). The passage title is its section and subsection, not its chunk ID. Compare periods adds a sentence-level diff: new this period, removed, and unchanged (collapsed).
- **(g) Same treatment for the brief and Compare.** A bottom line and jump bar on the brief, and condensed sections and chips on Compare, with the same rules.

**Consequences**
- Web-only change: no api, CDK, profile-set or S3 change, no spend. The deploy is `pnpm deploy:web`.
- Driver change and share are read from the builder's deterministic `changeBasis` text. A contract test pins that format to the parser. A structured field would need a new profile-set version (a later option).
- The existing web tests that expect every heading and recommendation in the DOM are updated to expand first.

**Step 2 as built (e–f)** (fixes after the adversary review folded in, 2026-10-03)
- **Display layer** (`apps/web/src/lib/readable/`). `layoutBlocks` partitions a range into headings, paragraphs, lists and tables. Every offset is in exactly one run, and a run is either shown or hidden. Only two kinds are hidden: `furniture`, and `layout` (table pipes, empty cells, line breaks and whitespace at a block's edges). It reuses the corpus's own `paragraphSpans`, `sentenceSpans`, `headingPrefix` and `isTableRow`, and the risk headings from `riskHeadingSpans`. These are browser-safe subpath exports (`@diligenceiq/corpus/segments`, `/risks`). `extractRiskHeadings` now delegates to `riskHeadingSpans`, with identical output; the corpus tests are unchanged and pass.
- **Furniture** (`furniture.ts`) comes in two strengths.
  - Strong shapes are hidden anywhere, whatever follows them:
    - a footer with "Form 10-K/10-Q" and a page number, with pipes ("Apple Inc. | 2025 Form 10-K | 21", also before a lowercase word, "| 15iPad") or without ("MASTERCARD 2025 FORM 10-K 17", or with no registrant, "2025 FORM 10-K 1"; a registrant is upper-case words only, so "…the Internal 2025 FORM 10-K…" keeps "Internal");
    - a page-number line;
    - a page number glued to a back-link ("22Table of Contents", "6Table of Contentsreasons", "41Table of Contents$480 million"; JNJ's singular "Table of Content" too). After five or more digits ("202355Table of Contents") only the phrase is hidden, so no digit of the year is lost;
    - a back-link opening a line, and the page number ending the prose line before it ("…jobsite 3" / "Table of Contentsinformation…"; never a table row's last cell).
  - Weak shapes ("PART II" alone, "Item 7", "| BUSINESS | Table of Contents") are hidden only when the same line, digits masked, repeats at least 3 times in the filing. An item number beside a table-of-contents row ("Item 1 |" next to "Business | 1", within one line before or three after) is content and stays.
  - Table-of-contents rows ("Item 16. | Form 10-K Summary | 74") and prose stay visible. A hidden run must match `FURNITURE_TEXT` (a footer or back-link phrase, a page number, or a bare running header with nothing else) and be at most 140 characters.
  - A drawer passage has no whole filing to count repeats in, so only strong shapes are hidden there.
  - Over the corpus, 0.35% of characters are hidden as furniture; no filing above 5% (TGT, the most, 3.6%).
- **Tables** (`tableGrid`). Every value sits in the column of its raw `|` index; empty cells stay empty cells, never left-padded away (BA's "345 |  |  | 58" stays under 2025 and 2024). Flattened filings disagree about a lone "$" cell: in some it is a column and rows without one keep an empty cell (TSLA), in others rows without one have a cell fewer (AAPL). Each table takes the reading that puts its values in the fewest distinct columns; under the second, a value's column is its raw index less the lone "$" cells before it. A "$" joins the amount after it, and a "%", ")" or footnote letter ("(g)") the one before, without moving any column. Leading rows with no figure (years aside) are the header, rendered as `<thead>` with `<th scope="col">`; a header row with exactly as many labels as the body has value columns puts them over those columns in order. Columns empty in every row are dropped. A condensed drawer view keeps the header rows. A table box takes focus (and gets a role and name) only when it actually scrolls sideways, measured with a `ResizeObserver`, so a page has no tab stop per table that fits.
- **A citation is never invisible.** A few indexed chunks are only a page number or "17Table of Contents" (the corpus test bounds them below 1% of chunks). When such a chunk is the cited span, the source view shows that furniture. A cited span with any other text keeps its furniture hidden. The target id goes on the first shown character of the span, fixed by offset (not render order), in the first section that shows any of it, so it is on the page exactly once and survives a table re-rendering after it measures its overflow.
- **Proof:** `readable-corpus.test.ts` covers all 246 filings and every chunk. It checks that:
  - the runs partition each filing;
  - layout runs are only pipes and whitespace, and furniture runs match the furniture shapes and length bound;
  - the shown text is the source minus the hidden runs;
  - each chunk's highlight is exactly its own shown characters.

  It also runs oracles that do not reuse the layout's rules:
  - the shown text of every filing contains no page number glued to a back-link and no "Form 10-K | 21" or "FORM 10-K 7" footer (zero allowed);
  - every table value of every filing is the raw `|` split cell at its index, in the column its currency reading gives, in source order (over 15,000 tables).

  `evidence-readable.test.tsx` renders four real filings, one per footer style (AAPL, MSFT, GS, TGT), and compares every chunk's `<mark>` text in the DOM. It also renders sampled cited chunks of AAPL, GS, NKE, DE and BA through the source view's `FilingSections`: the id is on the first target piece, and the joined pieces equal the chunk's characters outside a hand-written per-filing furniture oracle. BA's statement of operations is checked in the DOM (345 under 2025, 58 under 2024).
- **Closest sentences** (`support.ts`).
  - Units are the sentences of paragraphs (the corpus splitter), list items, headings and table rows.
  - A unit scores 1 per content word shared with the statement and 3 per figure of the statement it prints exactly (below).
  - Words are lightly stemmed and passed through a fixed finance lexicon (sales↔revenue, grew↔increased, fell↔declined, income↔profit). Only unambiguous forms are mapped: "contract", "notes" and "gain" keep their own meaning. "net" and "cost" are not content words. Nothing is learned.
  - A unit qualifies only with a matched figure, or with at least 3 shared content words of which at least one is specific (not a lexicon stem or a generic finance word such as "margin", "due", "primarily"). Up to three qualifying units are kept, each at least 75% of the best score, in passage order.
  - The label says "Closest sentences to the statement"; the legend says it is word and figure overlap, not proof. When nothing qualifies, the drawer says so and shows the whole passage.
  - The statement is threaded from the chip that opened the drawer: a brief's inline chip uses its sentence (the corpus sentence splitter, so "U.S. Revenue…" stays whole), a signal its "what changed" (never its measurement), a metric value a readable "Metric, FY2025: $416.2B" (never its raw source row), other items their own text. A passage opened from a list has no statement and is shown whole.
- **Bold figures.** Display only, never counted as verification, and as strict as the numeric validator (`matchFigure`, architecture §6.9), never by rounding under one scale word:
  - a percentage matches the same percentage; a scaled amount the same amount and scale word, or the exactly equal amount in another ("$1.2 billion" = "1,200 million"), or in a passage that states its unit a cell equal to it in that unit or (coarser unit, at least 3 significant digits) rounding to it ("$416.2 billion" for 416,161 in millions); with no unit stated, a table cell with the identical digits (at least 3 significant); an unscaled amount the same value as a "$" amount or table cell;
  - so "$4 billion" never bolds "$3.5 billion" or "4.3 times", "$1 billion" never "$854 million", "16%" never 15.6% or 16.2%; a number after a product or model name ("Microsoft 365", "Windows 11") is not a figure.
  - A brief citation bolds only the figures the validator verified in that chunk (`FigureCheck.chunkId`), and nothing when it verified none there. A metric value bolds only its own printed cell, inside its source row. The legend says which.
- **Passage title:** the drawer title is the citation's `section` (section › subsection when the citation carries one), with the company in the eyebrow. Lists that mix periods keep `citationLabel` (period · section). The chunk ID stays only in the details list.
  - *Known limit:* profile citations carry no subsection today, so a profile passage is titled by its section alone. Adding subsections needs a profile and api change (a new profile-set version), out of scope for this web-only step.
- **Sentence diff** (`diff.ts`) compares this passage with the side's most similar passage only (the first: the adjacency contract orders a side most similar first), never with the other matched passages, using the same units normalized for case, quotes, dashes and whitespace.
  - The two passages are chunks cut at different places, so each side is compared only inside its shared stretch: between its first and last unit the other side has (exactly, or with only the numbers changed). Outside it nothing is called new or removed; the count of uncompared sentences is shown.
  - "New in FY2025 10-K, in the shared stretch" lists later units the earlier passage lacks. A new unit that differs from an earlier one only in its numbers is shown with "Was: …" and that earlier unit is not listed as removed. "Removed since …, in the shared stretch" lists earlier units the later passage lacks. With no unit in common, nothing is compared and the panel says so.
  - The Following tab reads the later filing against this passage; every other tab reads this passage against the earlier filing.
  - The diff leads the Compare periods tab panel, and unchanged units are collapsed.
- **Tokens:** `--key-highlight`, `--diff-added` and `--diff-removed` (`light-dark()`; design-tokens.md). Tables scroll sideways inside their own box, never the page.
- **Still web only.** The api bundle includes the corpus package, but the chunker and risk extraction behave identically (unit tests), so no api deploy is needed.

# DiligenceIQ — Design Decisions

Lightweight decision records. Format: **Context → Decision → Alternatives considered → Consequences.** Status values: *Accepted* (decided in Phase 0) or *Provisional* (to be confirmed by measurement in a named phase).

---

## DD-01 · Retrieval store: pre-built hybrid index in S3, loaded by Lambda (not OpenSearch)
**Status:** Accepted. SPEC §22 named OpenSearch; the cost addendum overrides it.

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
- SPEC §22 prefers Amplify.
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
- Progress stages map to real execution (SPEC §26).
- Poll traffic is cheap, a few requests per analysis.
- The UI must handle QUEUED, RUNNING, FAILED, and timeout states.
- No reserved concurrency: the account limit is 10 and shared with other apps (assumptions D7), so the event source mapping's `maximumConcurrency` bounds this app instead.

---

## DD-04 · One-generation-call guarantee enforced in depth
**Status:** Accepted.

**Context:** The assessment's central constraint. Two default behaviors can silently break it:
- The AWS SDK retries throttled calls up to 3 times by default.
- SQS redelivers a message whose processing fails or exceeds the visibility timeout, and can occasionally deliver a message twice.

An earlier draft used `maxReceiveCount = 1` plus reserved concurrency. Reserved concurrency is off the table because the account limit of 10 is shared. The guarantee therefore rests on the claim, not on the queue.

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
**Status:** Accepted. Thresholds are Provisional until the Phase 3 evals.

**Context**
- No runtime LLM may rewrite or plan the query (SPEC §18).
- Multi-company and longitudinal questions must not collapse onto one company or onto the newest filing (SPEC §17).

**Decision**
- Alias, sector, period, filing-type, and topic extraction are fully deterministic.
- A planner turns the analysis into **lanes**: per company, per company × fiscal year, per sector member, or one global lane with per-company caps.
- Each lane runs a filtered hybrid search.
- The context builder enforces lane quotas before filling by score.
- Topics only boost, never filter.
- Period rules are explicit and shown to the user: "last N years" = the N most recent complete fiscal years per company plus a separate "FY<next> YTD"; no period named = latest 10-K plus subsequent 10-Qs (assumptions C1, C5).
- Name and ticker collisions with English words are resolved by case-sensitive rules (assumptions C3).

**Consequences**
- Retrieval behavior is explainable: the UI shows the resolved scope and a coverage matrix.
- Unknown phrasings still work through semantic search.
- Alias and sector tables need maintenance as the corpus grows. They are generated from headers plus a small curated list.

---

## DD-06 · Section-aware chunking with contextual headers and immutable readable IDs
**Status:** Accepted. Chunk size and overlap are Provisional pending the Phase 3 evals.

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
**Status:** Provisional until Phase 2 (invoke entitlement) and the Phase 3/4 evals.

**Context:** Phase 0 read the account's Bedrock quotas (assumptions D3, D8). Claude Sonnet 5.5 has a cross-region quota of 0 tokens/minute; Sonnet 4.6 has 6,000,000. Cohere Embed v4 is capped at 8.1M tokens/day on-demand and 16.2M cross-region (non-adjustable), below the ~20M-token corpus.

**Decision**
- **Generation:** Claude Sonnet 4.6 via the `us.anthropic.claude-sonnet-4-6` inference profile, configurable via `GENERATION_MODEL_ID`. Claude Sonnet 5.5 (`us.anthropic.claude-sonnet-5-5`) is the preferred upgrade only if Mike files and receives a quota increase (quota code L-94A31E46, cross-region tokens/minute). Temperature acceptance with forced tool use is verified in Phase 4.
- **Embeddings:** Amazon Titan Text Embeddings v2 (`amazon.titan-embed-text-v2:0`), 1024 dimensions, normalized; 6,000 requests/min with no daily token quota listed. The indexer is resumable, checkpointed, rate-limited to the 300,000 tokens/min quota, and caches embeddings by `sha256(embedded text + model id)`. Configurable via `EMBEDDING_MODEL_ID`.
- **Cohere Embed v4** (asymmetric `search_document` / `search_query`) is evaluated in Phase 3 as an alternative. Its quota allows one full build per ~1.5 days.
- **Rerank:** off by default. Cohere Rerank 3.5 is enabled only if the Phase 3 evals show a clear lift, and then flagged as a question to confirm with Eliza (assumptions A1, F1).

**Consequences**
- Invoke entitlement is still unverified and is checked first in Phase 2.
- Switching models is configuration plus an index rebuild for embeddings; the cache makes a rebuild with the same model and chunker free.

---

## DD-09 · Anonymous, server-side demo workspaces
**Status:** Accepted.

**Context**
- Panelists can't sign up.
- State must be server-side (SPEC §29), and one visitor's reset must not affect another.

**Decision**
- A random workspace ID lives in an HMAC-signed, httpOnly, Secure, SameSite=Lax cookie.
- DynamoDB is partitioned per workspace, seeded with Project Atlas, and expired by a 30-day TTL.
- Reset is scoped to the cookie's own partition.

**Alternatives considered**
- Cognito demo users (ResolveIQ/CareerOps): more friction and machinery than an anonymous demo needs.
- localStorage: SPEC says to avoid it.

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
**Status:** Accepted. Deviates from the wording of SPEC §36–37.

**Context**
- SPEC §36 lists "adversary fixes its findings" as a gate step, and §37 says the adversary "must not merely produce a report" but fix, add regression tests, and rerun them.
- The installed `adversary` agent (`~/.claude/agents/adversary.md`) is read-only by design ("Do not fix anything"), and changing Mike's global agent definition is out of scope.

**Decision:** Each gate runs in this order:
1. Adversary report (read-only, fresh context).
2. A **fresh** `general-purpose` fixer agent, with no implementation context, fixes the findings, adds regression tests, and reruns them.
3. `/code-review` and fixes.
4. Gate command.
5. `/handoff`, whose commit waits for Mike's go-ahead.

**Consequences:** The SPEC's intent is preserved: findings are fixed by a context that did not write the original work, and the fix is checked again by `/code-review`. The only difference is that finding and fixing are split across two fresh agents instead of one.

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

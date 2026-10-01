# DiligenceIQ — Implementation Plan

> Status: **Phase 0.** Derived from the approved Phase 0 plan and updated with the Phase 0 gate decisions (Sonnet 4.6 default, Titan v2 embeddings, no prewarm, no reserved concurrency, spend caps, job deadlines). Design detail lives in [architecture.md](architecture.md); tests in [testing-strategy.md](testing-strategy.md).

## Goal
Answer an unknown business question over SEC 10-K/10-Q filings with RAG and **exactly one generative LLM request**, inside a credible private-equity diligence workflow (Research → Verify → Capture → Organize → Decide), deployed at `https://diligenceiq.mikemiller.ai` with near-zero idle cost.

## Key decisions (see design-decisions.md)
- Pre-built hybrid index in S3, loaded by the worker Lambda; no OpenSearch (DD-01).
- Static Next.js export on Amplify; same-origin `/api` rewrite (DD-02).
- Async job: 202 → SQS (`batchSize: 1`, `maximumConcurrency: 2`, visibility 1080 s, `maxReceiveCount: 3`) → worker; UI polls (DD-03).
- One generation call: conditional claim (the guarantee), `maxAttempts: 1`, `GenerationGateway`, persisted count (DD-04).
- Models: Claude Sonnet 4.6 for generation (Sonnet 5.5 only after a quota increase), Titan Text Embeddings v2 for embeddings, rerank off by default (DD-08).
- Spend controls: kill switch, global daily cap, per-workspace and workspace-creation caps; Budget is alert-only (DD-13).
- Job deadlines and event-driven stuck-job recovery, no schedules (DD-14).
- No prewarm in v1; cold index load happens inside the async job.

## Phases

Every phase ends with the gate in CLAUDE.md: tests → `adversary` report → fresh fixer agent → `/code-review` and fixes → `pnpm gate` → `/handoff` + `docs/handoffs/phase-XX.md`, committed after Mike's go-ahead (DD-12).

| # | Deliverables | Exit criteria (in addition to the gate) |
|---|---|---|
| 0 | `git init`; CLAUDE.md, STATE.md, README; architecture (incl. Cost and Scaling Strategy, API contract, data model), assumptions (incl. Known corpus anomalies), design-decisions, design-tokens, testing-strategy, this plan; `scripts/ingestion/probe-corpus.mjs`; `scripts/check-docs.mjs` | Every corpus number in the docs matches the probe output; `pnpm gate` passes |
| 1 | pnpm workspace scaffold; app shell + design system; all routes on fixtures, polished; CDK WebStack + CoreStack skeleton; CDK cost-guard assertion tests; shell live on `diligenceiq.mikemiller.ai` | Full gate (`lint`, `typecheck`, `test`, `cdk:synth`, `build`) green; **Amplify rewrite forwards `Set-Cookie` verified on the deployed shell** (assumptions D9) |
| 2 | Verify Bedrock invoke entitlement (Sonnet 4.6, Titan v2); ingestion (headers, period/fiscal labels, overrides, tolerant preamble strip, section detection, boilerplate flag) → chunking → cached, resumable Titan v2 embeddings → S3 index artifacts; index summary (documents, chunks, companies, years, types, detected sections) | Header/period tests over all 246 files; section tests on AAPL 10-K, NVDA 10-Q, JNJ 10-Q, XOM 10-Q, MS 10-K; chunker handles the 287,855-character line; cold index load time measured |
| 3 | Query analyzer (aliases, collisions, sectors, periods incl. "last N years" and current view), planner and lanes, hybrid BM25 + cosine + RRF, context builder, retrieval debug endpoint (flagged); retrieval evals on 15–20 questions incl. the 3 PDF examples verbatim | Multi-company queries don't collapse; decisions recorded on chunk size, Titan v2 vs. Cohere Embed v4, and rerank (default off) |
| 4 | Prompt v1; `GenerationGateway`; schema/citation/numeric validation; SQS worker with claim, deadlines, generation budget, DLQ handler; one-call tests at every layer; real prompt iterations logged in `docs/prompt-iterations.md` | Integration tests prove `generationCallCount === 1` on success, error, malformed output, duplicate delivery, and redelivery after claim; temperature + forced tool use verified on Sonnet 4.6; generation latency measured |
| 5 | Sessions, seed (real pipeline outputs) and reset; Overview; Workstreams; New Analysis with real stages; Brief; Save Finding; Findings Board; IC Brief (deterministic mapping); spend caps and kill switch | The SPEC §40 Phase 5 workflow runs end to end with no broken steps |
| 6 | Evidence drawer; coverage matrix; source explorer; section navigation; deep-link passage highlight; citation-integrity tests | Every citation in seeded and live briefs resolves to its passage |
| 7 | Eval harness + `docs/evaluation.md`; unsupported-query and injection tests; structured logging, request IDs, 14-day retention, metric filters; security headers and **CSP strategy for static-export inline scripts** (assumptions D10); IAM review; accessibility and performance review; cost telemetry | Full regression green; eval results recorded |
| 8 | Production hardening, alarms, Budget alert, Playwright smoke against the production URL | Production validation per SPEC §40 Phase 8 (DNS, HTTPS, Bedrock access, index connectivity, logs, error behavior, demo sessions) |
| 9 | Polish, `docs/demo-script.md`, `docs/future-state.md`; final panel-persona adversary → fixes → `/code-review` → full production regression | SPEC §41–42 definition of done |

## Verification approach
- **Unit and integration** (Vitest, no AWS): corpus parsing over all 246 files, section detection on real fixtures, chunker, query analysis, RRF, lane quotas, context budget, citation and numeric validation, gateway call guard, claim idempotency, deadlines, rate limits.
- **CDK assertions:** no OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned or reserved concurrency, or schedules; log retention set; IAM scoped.
- **Eval harness** (real index, on demand): company/period coverage, citation validity, numeric grounding, abstention, injection resistance.
- **Playwright:** full local workflow plus smoke tests against production.
- Details and the gate/on-demand split: [testing-strategy.md](testing-strategy.md).

## Risks and mitigations

| Risk | Mitigation | Owner / when |
|---|---|---|
| Bedrock invoke entitlement unverified | Check first in Phase 2; model IDs are env-configurable | Phase 2 |
| Sonnet 5.5 quota is 0 in this account | Ship on Sonnet 4.6; Mike may file a quota increase (L-94A31E46) | Mike, optional |
| Lambda account concurrency is 10 and shared | `maximumConcurrency: 2`, job deadlines; **recommended:** Mike requests a concurrency quota increase before the demo | Mike, before Phase 8 |
| Cohere Embed v4 daily token cap below corpus size | Titan v2 default; resumable, cached indexer; Cohere evaluated over two quota days if needed | Phase 2–3 |
| Cold start on the first analysis after idle | Measured in Phase 2 and shown as a real stage; prewarm is a documented future option | Phase 2 |
| Amplify rewrite may not forward `Set-Cookie` | Verified in the Phase 1 deploy; fallback is an `api.` subdomain with credentialed CORS | Phase 1 |
| CSP vs. static-export inline scripts | Decided in Phase 7 | Phase 7 |
| Public demo spend | Kill switch, global daily cap, workspace caps, Budget alert | Phase 5, Phase 8 |
| Commits and outward-facing actions | Commits wait for Mike at each `/handoff`; creating a GitHub repo is asked first, no later than Phase 8 | Every phase |

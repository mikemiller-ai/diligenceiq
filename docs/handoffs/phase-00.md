# Phase 0 Handoff: Discovery, Repository Inspection, and Architecture

_Date: 2026-10-01 (local)_

## Completed
- Inspected the repository (greenfield), the corpus (all 246 filings parsed), the AWS account (read-only), and Mike's sibling products (ResolveIQ, TrustResponse, CareerOps) to establish the house pattern. Amplify static export plus a CDK backend in us-east-1 and an async LLM worker became the baseline.
- Design baseline written:
  - `docs/architecture.md`: system, flows, single-call guarantee, RAG design, schema, data model, API contract, routes, security, observability, and **Cost and Scaling Strategy**.
  - `docs/assumptions.md`: including the **Known corpus anomalies** table.
  - `docs/design-decisions.md`: DD-01 … DD-14.
  - `docs/design-tokens.md`, `docs/testing-strategy.md`, `docs/implementation-plan.md`.
  - `CLAUDE.md`, `STATE.md`, `README.md`, and `SPEC-ADDENDUM-COST.md` (verbatim from Mike).
- `scripts/ingestion/probe-corpus.mjs` reproduces every corpus number in the docs. `scripts/check-docs.mjs` is the Phase 0 gate.

## Key architecture decisions
- **No OpenSearch.** A pre-built hybrid index (BM25 plus exact cosine) lives in S3 and is loaded and cached by the worker Lambda (DD-01, cost addendum).
- **Frontend:** Amplify Hosting static export, with a same-origin `/api/<*>` rewrite to an HTTP API (DD-02).
- **Async analysis job:** 202 → SQS (`batchSize 1`, `maximumConcurrency 2`, visibility 1080 s, `maxReceiveCount 3`) → worker → UI polls. Jobs have deadlines, so nothing stays stuck in QUEUED or RUNNING (DD-03, DD-14).
- **One-generation-call guarantee** rests on the conditional claim, the SDK's `maxAttempts: 1`, `GenerationGateway`, and persisted counters. Redelivery is never a recovery path (DD-04).
- **Models:** generation defaults to Sonnet 4.6 because Sonnet 5.5 has a quota of 0 here. Embeddings default to Titan v2, because Cohere v4's daily cap is below the corpus size. Rerank is off by default (DD-08).
- **Spend controls:** a global daily cap, a per-workspace cap, a workspace-creation cap, and an SSM kill switch (DD-13).

## Gate record
1. **Adversary:** 2 blockers (Lambda concurrency 10; Sonnet 5.5 quota 0), 5 high, 9 medium, and 8 low findings. **All were fixed** by a fresh fixer agent; its decisions are recorded in the docs above.
2. **`/code-review` (medium):** 2 findings, both fixed.
   - The `.gitignore` pattern `data/` was unanchored and ignored nested source folders. It is now `/data/` and `/.index/`.
   - DD-04's `maxReceiveCount` rationale was wrong, because the visibility timeout is longer than the deadline. The docs now state that redelivery is never a recovery path, and a throttle row was added to architecture §4.3.
3. **Gate:** `pnpm gate` → `check-docs: OK (11 files verified)`. `node scripts/ingestion/probe-corpus.mjs` runs cleanly.

## Files
- **New:** `.gitignore`, `package.json`, `CLAUDE.md`, `STATE.md`, `README.md`, `SPEC-ADDENDUM-COST.md`, `docs/{architecture,assumptions,design-decisions,design-tokens,testing-strategy,implementation-plan}.md`, `docs/handoffs/phase-00.md`, `scripts/check-docs.mjs`, `scripts/ingestion/probe-corpus.mjs`.
- **Pre-existing:** `SPEC.md`. The assessment PDF is gitignored.

## Deployment status
Nothing is deployed. No AWS resources were created; all AWS calls were read-only.

## Unresolved risks / pending with Mike
- **Lambda concurrency quota increase** (recommended before the demo): the limit is 10, shared with other apps.
- **Sonnet 5.5 quota increase** (optional, L-94A31E46).
- **Whether `SPEC.md` is committed** to a possibly public repo.
- **Bedrock invoke entitlement** is unverified; it is checked first in Phase 2.
- Amplify rewrite `Set-Cookie` forwarding for a WEB (static) app is unverified; it is checked in the Phase 1 deploy.

## Known limitations
- The design is docs only; nothing is executable yet except the probe and check-docs scripts.
- Caps other than the global daily cap of 200 are env-configurable and will be set in Phase 5.

## Next-phase objective (Phase 1)
Deliverables:
- pnpm workspace scaffold (`apps/web`, `packages/core`, `infrastructure/cdk`)
- Enterprise design system implementing `docs/design-tokens.md`
- App shell with left nav and "+ New Analysis"
- All routes rendered from fixtures and already polished
- CDK CoreStack and WebStack skeletons, with cost-guard assertion tests

Exit criteria:
- The shell is deployed live on `https://diligenceiq.mikemiller.ai`.
- The gate expands to lint + typecheck + test + cdk:synth + build.

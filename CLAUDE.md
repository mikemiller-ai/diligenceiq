# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is
**DiligenceIQ**: an AI Investment Diligence Workspace for a fictitious private-equity client, built for Mike's Eliza Forward Deployed Engineer final-round assessment. RAG over SEC 10-K/10-Q filings (`edgar_corpus/`) is the engine inside a diligence workflow (Research → Verify → Capture → Organize → Decide). Target: `https://diligenceiq.mikemiller.ai`.

**Requirements, in order of precedence:**
1. `SPEC-ADDENDUM-COST.md` wins on conflicts
2. `SPEC.md`
3. `UPDATED_FDE-AI-RAG-Assessment.pdf`

**Design baseline:** `docs/architecture.md`, `docs/assumptions.md`, `docs/design-decisions.md`, `docs/design-tokens.md`, `docs/testing-strategy.md`, `docs/implementation-plan.md`.

**Current status:** see `STATE.md`. Phase handoffs are in `docs/handoffs/`.

## Non-negotiables
- **Exactly one generative LLM request per analysis.** No query rewriting, planning, critique, repair, or summarizer LLM calls. Query embeddings are retrieval and are counted separately; rerank is off by default (assumptions A1).
  - The guarantee rests on the **conditional claim** (`QUEUED → RUNNING` with a `claimToken`, only before `deadlineAt`). A delivery whose analysis is not QUEUED is acknowledged without work.
  - SQS: event source mapping `batchSize: 1`, `maximumConcurrency: 2`; visibility timeout 1080 s; `maxReceiveCount: 3` → DLQ. **No reserved concurrency** (account limit is 10, shared).
  - Generation client `maxAttempts: 1`; `GenerationGateway` counter; `generationStartedAt` + `generationCallCount` persisted before the call. See docs/architecture.md §4.3 and §5.
- **No hardcoded demo answers.** Every answer flows through retrieval and generation.
- **Citations may only reference chunks supplied in the context.** They are validated server-side.
- **Scale to near zero when idle:**
  - No OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned concurrency, or scheduled jobs.
  - Explicit log retention.
  - Never log chunk text or full prompts unless `DEBUG_LOG_PROMPTS=true`.
- Saving findings, IC Brief assembly, and dashboards never call an LLM.
- **Spend controls:** kill switch (`/diligenceiq/analyses-enabled`), global daily cap, per-workspace and workspace-creation caps. The AWS Budget is alert-only.
- **Models (env-configurable):** generation `us.anthropic.claude-sonnet-4-6` (`GENERATION_MODEL_ID`; Sonnet 5.5 has 0 quota here); embeddings `amazon.titan-embed-text-v2:0` (`EMBEDDING_MODEL_ID`).

## Architecture (house pattern; see docs/architecture.md)
- **Region:** us-east-1, CDK TypeScript.
- **Frontend:** Amplify Hosting with a static Next.js export. `/api/<*>` is rewritten to the HTTP API.
- **Backend:** HTTP API → api Lambda. SQS → worker Lambda runs the RAG pipeline plus the one Bedrock generation call. DLQ → dlq-handler Lambda marks failed jobs. Stuck jobs are failed lazily on poll past `deadlineAt`; no schedules.
- **Data:** DynamoDB on-demand, single table. S3 holds the corpus, processed filings, and the pre-built hybrid index that the worker loads into memory.
- **No Docker on this machine.** Lambdas ship as esbuild zip bundles.

## Planned layout (built from Phase 1)
`apps/web`, `packages/{core,corpus,rag}`, `services/api`, `infrastructure/cdk`, `scripts/{ingestion,indexing,evaluation}`, `prompts/`, `seed/`, `evals/`, `tests/{e2e,fixtures}`, `docs/`. Tests: see `docs/testing-strategy.md`.

## Gate
Run before every handoff:

```bash
pnpm gate
```

- **Phase 0:** `pnpm gate` runs `scripts/check-docs.mjs`, which checks required docs and sections and rejects placeholder markers.
- **From Phase 1:** `pnpm gate` expands to `pnpm lint && pnpm typecheck && pnpm test && pnpm cdk:synth && pnpm build` (plus check:docs). Keep this section accurate when the gate changes.

## Phase process (SPEC §36–39, adapted in DD-12)
Implementation → tests → `adversary` agent report → **fresh** general-purpose fixer agent fixes the findings and adds regression tests → `/code-review` and fix findings → `pnpm gate` → `/handoff` (commit after Mike's go-ahead) plus `docs/handoffs/phase-XX.md`. Never skip a step.

## Conventions
- Package manager: pnpm 9. Node ≥ 22. TypeScript strict. Zod at every boundary.
- **Prompt changes:** every real change gets an entry in `docs/prompt-iterations.md`. Never fabricate history. `prompts/final-diligence-prompt.md` must match the runtime prompt (enforced by a test once it exists).
- **Corpus:** `edgar_corpus/` is gitignored (79 MB, public domain). Ingestion reads `CORPUS_PATH`. Corpus numbers in docs must match `node scripts/ingestion/probe-corpus.mjs`; anomalies are in `docs/assumptions.md` (Known corpus anomalies).
- `UPDATED_FDE-AI-RAG-Assessment.pdf` is gitignored (Eliza's document).
- **Dates:** use the local date for handoffs and STATE.md.

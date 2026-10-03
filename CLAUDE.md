# CLAUDE.md

Guidance for Claude Code in this repository.

## What this is
**DiligenceIQ** is an **investment-intelligence** product for a fictitious private-equity client, built for Mike's Eliza Forward Deployed Engineer final-round assessment. Target: `https://diligenceiq.mikemiller.ai`.
- Users pick a company and immediately see what is happening, what changed, what deserves attention, why it matters, and what to investigate next (Company Intelligence).
- **Deep Analysis** then answers any question with RAG over SEC 10-K/10-Q filings (`edgar_corpus/`).
- Journey: Understand → Notice → Investigate → Verify → Capture → Monitor → Decide.

**Requirements and precedence:**
1. `UPDATED_FDE-AI-RAG-Assessment.pdf` is the outer constraint. Nothing may violate it.
2. `SPEC.md` (v2, consolidated 2026-10-01) is the sole canonical implementation specification. Inside it, the stricter rule wins on assessment constraints, one-call generation, evidence grounding, retrieval quality, AWS, security, testing, and cost.
3. The design docs (below) elaborate SPEC v2 but cannot override it. Change a requirement in SPEC v2 first.
4. The superseded sources are archived verbatim for provenance only, not as requirement sources: `docs/archive/SPEC-v1.md`, `docs/archive/SPEC-ADDENDUM-COST.md`, `docs/archive/PRODUCT_DIRECTION.md`. SPEC v2 Appendix A lists every change from them; Appendix B maps their sections.

**Cost-addendum override (2026-10-01).** Mike explicitly chose the hybrid offline profile approach on 2026-10-01, after being told the docs then said dashboards never call an LLM. It overrides three archived cost-addendum lines ("incur meaningful inference cost only when a user actually performs an analysis", "avoid LLM calls merely to populate dashboards", "RAG generation occurs only in response to user analysis") **for the offline profile build only**. Limits: offline, admin-run, ≤ 1 call per company per (`indexVersion`, `profilePromptVersion`) enforced by the build ledger, budget-capped, never on page view, never scheduled, never deployed. A zero-call deterministic set is always built and an SSM pointer switches to it instantly. A6 is an interpretation; ask Eliza before Phase 4b (assumptions F4). It is the only cost exception: SPEC v2 §35.7 (named, bounded exception) and DD-16.

**Design baseline:** `docs/implementation-plan.md` (Revision 2), `docs/architecture.md`, `docs/assumptions.md`, `docs/design-decisions.md`, `docs/design-tokens.md`, `docs/testing-strategy.md`.

**Current status:** see `STATE.md`. Phase handoffs are in `docs/handoffs/`.

## Non-negotiables
- **Exactly one generative LLM request per analysis** (Deep Analysis). No query rewriting, planning, critique, repair, or summarizer LLM calls. Query embeddings are retrieval and are counted separately; rerank is off by default (assumptions A1).
  - The guarantee rests on the **conditional claim** (`QUEUED → RUNNING` with a `claimToken`, only before `deadlineAt`). A delivery whose analysis is not QUEUED is acknowledged without work.
  - SQS: event source mapping `batchSize: 1`, `maximumConcurrency: 2`; visibility timeout 1080 s; `maxReceiveCount: 3` → DLQ. **No reserved concurrency** (the account limit, raised from 10 to 1,000 on 2026-10-01, is shared; `maximumConcurrency` bounds this app).
  - Generation client `maxAttempts: 1`; `GenerationGateway` counter; `generationStartedAt` + `generationCallCount` persisted before the call. See docs/architecture.md §4.3 and §5.
- **No hardcoded demo answers.** Every answer flows through retrieval and generation.
  - Phase 1 fixture profiles carry no figures and no narrative presented as fact: labeled placeholders, or values copied verbatim from filing rows with `chunkId` and `rawRow` (test enforced).
  - **One allowed, labeled exception:** the curated per-category "why this matters" library used by deterministic profiles. It is generic, names no company, states no figure, and is shown as "General context" (DD-16).
- **A prefilled Deep Analysis never auto-submits.** `/analysis/new?q=&tickers=&origin=` only fills the form; generation requires an explicit Run (`POST /api/analyses`). An E2E test asserts that loading the URL (or any page) sends only reads and `POST /api/session`, never `POST /api/analyses`, and hands the worker nothing.
- **Citations may only reference chunks supplied in the context.** They are validated server-side.
- **Scale to near zero when idle:**
  - No OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned concurrency, or scheduled jobs.
  - Explicit log retention.
  - Never log chunk text or full prompts unless `DEBUG_LOG_PROMPTS=true`.
- **Opening or rendering any page never calls an LLM.**
  - Company Intelligence profiles are generated **offline** by the admin-run `scripts/intelligence/build-profiles.ts` (`pnpm intelligence:build`) under the override above: two sets, `llm-v<profilePromptVersion>` (≤ 1 call per company, validated, deterministic fallback) and `det-v<templateVersion>` (zero calls). They are persisted in S3 and only read at runtime; `/diligenceiq/active-profile-set` picks the set (DD-16).
  - The builder is never deployed, has no `--force` (a rebuild needs a version bump), and the api Lambda has no Bedrock permission.
  - Saving findings, Compare, Thesis, Watchlist, and IC Brief assembly are deterministic.
- **Numbers come from deterministic extraction** (DD-17), never from the model. Signals carry evidence for each period (DD-18). No ratings, scores, or recommendation language: one canonical phrase-level banned list in DD-16 (bare "buy", "sell", "strong" are not banned; "buyback", "selling, general and administrative" are allowed).
- **Spend controls:** kill switch (`/diligenceiq/analyses-enabled`), global daily cap, per-workspace and workspace-creation caps. The AWS Budget is alert-only.
- **Models (env-configurable):** generation `us.anthropic.claude-sonnet-4-6` (`GENERATION_MODEL_ID`; Sonnet 5.5 has 0 quota here); embeddings `amazon.titan-embed-text-v2:0` (`EMBEDDING_MODEL_ID`).

## Architecture (house pattern; see docs/architecture.md)
- **Region:** us-east-1, CDK TypeScript.
- **Frontend:** Amplify Hosting with a static Next.js export. `/api/<*>` is rewritten to the HTTP API.
- **Backend:** HTTP API → api Lambda. SQS → worker Lambda runs the RAG pipeline plus the one Bedrock generation call. DLQ → dlq-handler Lambda marks failed jobs. Stuck jobs are failed lazily on poll past `deadlineAt`; no schedules. Stacks: `CoreStack`, `ApiStack`, `WebStack`, `WorkerStack` (queue, DLQ, worker, dlq-handler; Phase 4).
- **Data:** DynamoDB on-demand, single table. S3 holds the corpus, processed filings, the pre-built hybrid index that the worker loads into memory (plus its adjacency file), and `intelligence/` profile sets with their manifests and build ledger, which the api Lambda reads.
- **No Docker on this machine.** Lambdas ship as esbuild zip bundles.

## Primary navigation (DD-15)
Company Intelligence | Compare | Deep Analysis | Findings, plus a global "Ask a question" action. Thesis and Watchlist (P1) join the nav in Phase 8b, after the Phase 7/8 exit criteria; Phase 1 omits them (no stubs). Architecture and business value (P0) and Sources (through evidence) are secondary; IC Brief is P1. Primary screens use plain language; SEC terms appear only in evidence and source views. P0/P1/P2 and the scope fallback: SPEC §6 and §49; detail in `docs/implementation-plan.md`.

## Planned layout (built from Phase 1)
`apps/web`, `packages/{core,corpus,rag}`, `services/api`, `infrastructure/cdk`, `scripts/{ingestion,indexing,intelligence,evaluation}`, `prompts/`, `seed/`, `evals/`, `tests/{e2e,fixtures}`, `docs/`. Tests: see `docs/testing-strategy.md`.

## Gate
Run before every handoff:

```bash
pnpm gate
```

- **Phase 0:** `pnpm gate` runs `scripts/check-docs.mjs`, which checks required docs and sections and rejects placeholder markers.
- **From Phase 1:** `pnpm gate` runs `pnpm check:docs && pnpm lint && pnpm typecheck && REQUIRE_CORPUS=1 pnpm test && pnpm cdk:synth && pnpm build && pnpm e2e`. `pnpm e2e` is Playwright (`tests/e2e/local`) against the static export plus the real api app in-process over in-memory stores (`tests/e2e/local-server.ts`; the queue goes to a test-only stub worker that never calls a model), including the prefill-never-auto-submits test and the novice and expert paths, plus a `built-profiles` project (a second local server over the committed built test set, `tests/e2e/built`); it uses the cached Chromium for `@playwright/test` 1.63.0. `typecheck` also covers `tests/e2e` and `scripts/` (the TypeScript CLIs). The test step runs as `REQUIRE_CORPUS=1 pnpm test`, so the corpus-backed exit-criteria tests fail loudly instead of skipping when `edgar_corpus/` (or `CORPUS_PATH`) is missing; plain `pnpm test` still skips them with a warning. Keep this section accurate when the gate changes.
- **Offline CLIs (Phase 2, admin-run, never in the gate):** `pnpm ingest` (no AWS), `pnpm extract` (no AWS), `pnpm fixtures:risks` (regenerates the web preview headings), `pnpm index:embed` (Bedrock spend: ask first; `--dry-run` is free), `pnpm index:build` (no AWS), `pnpm index:upload` (S3 write: dry run unless `--yes`; ask first), `pnpm index:measure-load` (read-only), `pnpm check:bedrock` (Bedrock entitlement check; tiny spend, ask first). Outputs go to `.index/` (gitignored).
- **Offline evals and retrieval tools (Phase 3, never in the gate):** `pnpm eval:retrieval` (20 questions × BM25 / cosine / hybrid; cached query embeddings only, `--embed` makes Titan calls for new questions: ask first), `pnpm eval:chunk-size` (BM25-only chunk-size experiment, no AWS), `pnpm eval:signals` (signal go/no-go against the hand labels, no AWS), `pnpm retrieval:debug` (local `POST /api/retrieval/debug` on 127.0.0.1; `--embed` spends: ask first). Results go to `evals/results/` (committed) and `docs/evaluation.md`.
- **Phase 5 tools (never in the gate):**
  - `pnpm seed:build` rebuilds `seed/demo-workspace.json` by replaying recorded da-v4 generations (free; fails rather than call live).
  - `pnpm profiles:export-fixture` writes the preview set to `tests/fixtures/profile-sets/` (no AWS).
  - `pnpm profiles:upload-set --bucket <b> --set <iv>/<set>` is an S3 write: dry run unless `--yes`; ask first. It never switches `/diligenceiq/active-profile-set`.
- **Phase 4b tools (never in the gate):**
  - `pnpm intelligence:build --max-calls 0` builds the deterministic set `det-v<templateVersion>` locally (free, no AWS). With `--llm --bucket <data bucket>` it builds the LLM set too: it reads the S3 build ledger, and is a dry run (calls and estimated cost) unless `--yes`. `--yes` makes Bedrock calls (about $0.13 each, one per company per `profilePromptVersion`, never repeated) and ledger writes: ask first. `--llm --max-calls 0` rebuilds the LLM set from stored outcomes only (free).
  - `pnpm eval:profiles` scores the built sets against `evals/profiles.yaml` (no AWS).
  - Upload with `pnpm profiles:upload-set --root .index/intelligence --set <iv>/<set>` (S3 write, ask first); switching `/diligenceiq/active-profile-set` is a separate `aws ssm put-parameter` (ask first).
- **Phase 6 tools (never in the gate):**
  - `pnpm evidence:check` checks citation integrity over the local index build (every chunk, adjacency reference, and seed, live-brief and profile-set citation resolves); writes `evals/results/evidence-<iv>.json` (no AWS).
  - `pnpm fixtures:test-profiles` copies the real AAPL, TSLA, JPM, MSFT, NVDA and PFE `llm-v3` profiles verbatim into the committed test set `tests/fixtures/built-profile-sets/<iv>/llm-v3/` (a separate root: never upload it), used by the web readability tests and the e2e `built-profiles` project (no AWS; Phase 6r).
  - `pnpm fixtures:evidence` regenerates the committed adjacency subset `tests/fixtures/evidence/<iv>/adjacency/` from `.index/build` (no AWS); the api tests and the e2e server process filings from the corpus themselves.
- **Phase 7 tools (never in the gate):**
  - `pnpm eval:retrieval --set robustness [--generate]` runs `evals/robustness.yaml` (replay is free; `--embed` and `--live` spend: ask first) and writes only `generation-<iv>-<pv>-robustness.*`.
  - `pnpm eval:web-perf` measures bytes and render timings of the built export against the local server (no AWS; run `pnpm build` first).
  - The web build's post-step `node src/build/csp.ts out` writes each page's CSP `<meta>` (runs inside `pnpm build`; never hand-edit `out/`).
- **Generation tools (Phase 4, never in the gate):**
  - `pnpm eval:retrieval --generate` replays recorded generations (free). `--live` makes Bedrock generation calls, about $0.11 each, about $2.25 per run: ask first.
  - `pnpm eval:generation:rescore` re-validates stored briefs (no AWS).
  - `pnpm prompts:render` (no AWS).
  - `pnpm analysis:run` runs one in-region analysis through the deployed worker. It writes to DynamoDB and SQS, spends about $0.13 on Bedrock, and needs the kill switch on: ask first.

## Phase process (SPEC §48, adapted in DD-12)
Implementation → tests → `adversary` agent report → **fresh** general-purpose fixer agent fixes the findings and adds regression tests → `/code-review` and fix findings → `pnpm gate` → `/handoff` (commit after Mike's go-ahead) plus `docs/handoffs/phase-XX.md`. Never skip a step.

The adversary also asks the SPEC §48.2 product questions:
- Is there value before a question?
- Is it understandable without SEC knowledge?
- Does the dashboard say what matters?
- Are signals evidence-backed?
- Does "Why This Matters" educate without overclaiming?
- Are recommendations useful?
- Does Compare add insight?
- Can Deep Analysis still answer an arbitrary question?
- Is anything generated unnecessarily?
- Is it an intelligence product rather than a RAG demo?

## Conventions
- Package manager: pnpm 9. Node ≥ 22.18 (the web build's CSP step runs a `.ts` file with native type stripping). TypeScript strict. Zod at every boundary.
- **Prompt changes:** every real change to either prompt (Deep Analysis, Company Intelligence profile) gets an entry in `docs/prompt-iterations.md`. Never fabricate history. `prompts/final-diligence-prompt.md` must match the runtime prompt (`packages/rag/src/generation/prompt.ts`; enforced by a test). Regenerate it with `pnpm prompts:render`, bump `DEEP_ANALYSIS_PROMPT_VERSION`, and keep the superseded file in `prompts/versions/`.
- **Corpus:** `edgar_corpus/` is gitignored (79 MB, public domain). Ingestion reads `CORPUS_PATH`. Corpus numbers in docs must match `node scripts/ingestion/probe-corpus.mjs`; anomalies are in `docs/assumptions.md` (Known corpus anomalies).
- `UPDATED_FDE-AI-RAG-Assessment.pdf` is gitignored (Eliza's document).
- **Dates:** use the local date for handoffs and STATE.md.

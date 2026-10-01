# DiligenceIQ — Testing Strategy

> Status: **Phase 0 plan.** No tests exist yet. Each phase adds the tests listed for it, and `pnpm gate` grows with them. This file is updated when the plan changes.

## 1. Frameworks

| Layer | Tool | Notes |
|---|---|---|
| Unit + integration (TypeScript) | **Vitest** | Runs in Node, no AWS. Bedrock and AWS SDK clients are injected and mocked. |
| React components | **React Testing Library** (on Vitest, jsdom) | Behavior and accessibility queries (`getByRole`), not snapshots. |
| End-to-end | **Playwright** | Local full workflow against `pnpm dev`; smoke suite against `https://diligenceiq.mikemiller.ai`. |
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

**Query analysis and retrieval (`packages/rag`)**
- Company detection including collisions (assumptions C3): "the target market", "Target's margins", "a T-shaped team", "AT&T and T-Mobile", "visa requirements", "Visa and MA", "meta-analysis", "MS and GS", curated aliases (Google, Facebook, J&J, Coke, Exxon, Lilly, JPMorgan/Chase).
- Sector mapping ("major pharmaceutical companies" → JNJ, PFE, MRK, LLY, ABBV; not TMO/UNH).
- Periods: explicit years, ranges, "since 2023"; **"last two years" for NVDA → FY2024 + FY2025 + FY2026 YTD (Q1–Q3)**; BAC → FY2024 complete + FY2025 YTD; default "current view" per company (JPM = FY2025 10-K only; MCD and PEP exclude their stray 2023 10-Qs).
- RRF fusion (k = 60) ordering and ties; metadata filters as hard filters; topic boosts never filter; boilerplate down-weighting.
- Planner lanes and **lane quotas**: every named company and period represented before score fill.
- Context builder: shingle-Jaccard dedupe, adjacent merge, **~24K-token budget never exceeded**, untrusted-content block format, snapshot ≤ 350 KB guard.
- Validation: citation validator (unknown IDs removed and flagged), uncited findings flagged, numeric grounding (currency/percent figures present in cited chunks or badged), deterministic JSON repair and `MALFORMED_OUTPUT`.
- `GenerationGateway`: the second call in one analysis throws; the Bedrock client is built with `maxAttempts: 1`.

**Service (`services/api`)**
- Worker claim idempotency: claim succeeds once; a second delivery for the same analysis is acknowledged with no pipeline work and no Bedrock call; claim refused after `deadlineAt`; result write rejected if the claim token no longer matches.
- Stale-job handling: poll marks QUEUED past deadline → `QUEUE_TIMEOUT`; RUNNING → `PIPELINE_TIMEOUT` or `GENERATION_TIMEOUT` (depending on `generationStartedAt`); conditional writes don't overwrite COMPLETE; DLQ handler → `WORKER_FAILED`; `SendMessage` failure → `ENQUEUE_FAILED` + 503.
- Rate limits and spend controls: workspace hourly cap, global daily cap (conditional counter at the boundary), workspace-creation cap, kill switch (api and worker paths, 60 s cache).
- Session: HMAC cookie sign/verify, tampered cookie rejected, reset touches only the caller's partition.
- API contract: Zod validation and the error-code → HTTP-status map; `POST /api/findings` copies text and citations server-side.
- IC Brief assembly mapping (architecture §8.2) and Markdown output, with no model client reachable from those handlers.

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
- **IAM scoping:** Bedrock actions only on the configured inference profile and its foundation-model ARNs plus the embedding model; S3 read-only on `corpus/processed/*` (api) and `index/*` (worker); no `*` resources on data-plane actions; only the worker can invoke Bedrock.

## 6. End-to-end (Playwright)

- **Local** (`tests/e2e/local`): open Project Atlas → run an analysis from a suggested question (mocked or real backend per config) → view brief and evidence drawer → save finding → Findings Board filters → pin to IC Brief → print view → reset workspace. Keyboard navigation and axe accessibility checks on each page.
- **Prod smoke** (`tests/e2e/smoke`): landing, overview, sources, one real analysis to COMPLETE with valid citations, security headers present. Runs against `https://diligenceiq.mikemiller.ai`.

## 7. Evaluation harness

`scripts/evaluation` runs `evals/questions.yaml` (15–20 questions, including the three assessment PDF examples verbatim, out-of-corpus questions, and injection probes) through the real pipeline and writes results to `evals/results/` and `docs/evaluation.md`. Deterministic metrics only:
- **Company coverage:** expected companies present in the context and the brief.
- **Period coverage:** expected fiscal periods present.
- **Citation validity:** share of citation IDs in the context set (target 100% after validation, with pre-validation rate reported).
- **Numeric grounding:** share of figures found in cited chunks.
- **Abstention:** out-of-corpus questions produce `insufficient_evidence` or explicit gaps.
- **Injection resistance:** planted instructions are not followed.
- Generation calls per question (must be 1) and token/latency telemetry.

A retrieval-only mode (no generation) supports the Phase 3 chunking, embedding (Titan v2 vs. Cohere Embed v4), and rerank decisions.

## 8. What runs where

| Suite | `pnpm gate` | On demand | Needs AWS |
|---|---|---|---|
| Unit, component, integration | Yes (`pnpm test`) | | No |
| Full-corpus tests | Yes when `CORPUS_PATH` is present, otherwise skipped with a message | | No |
| CDK assertion tests | Yes (`pnpm test` + `pnpm cdk:synth`) | | No |
| Playwright local | | Yes (`pnpm e2e`) | Optional |
| Playwright prod smoke | | Yes (`pnpm e2e:smoke`) | Yes (deployed app) |
| Eval harness | | Yes (`pnpm eval`) | Yes (Bedrock, real index) |
| Corpus probe | | Yes (`node scripts/ingestion/probe-corpus.mjs`) | No |

The Phase 0 gate is `scripts/check-docs.mjs` only; the full gate is defined in CLAUDE.md.

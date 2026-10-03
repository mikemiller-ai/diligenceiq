# Deliverables

Where each item the Eliza assessment asks for lives in this repository, and how to check it. Live app: https://diligenceiq.mikemiller.ai. Repository: https://github.com/mikemiller-ai/diligenceiq.

## The task

| The assessment asks for | Where it is | How to check it |
|---|---|---|
| A retrieval index over the provided corpus | Ingestion: `scripts/ingestion/`, `packages/corpus/`. Index build: `scripts/indexing/`, `packages/rag/src/index/` (hybrid BM25 + Titan v2 vectors, index `iv-9cf51c066743`: 25,404 chunks over 246 filings). | README "Ingestion and indexing"; [architecture.md](architecture.md) §6; the build summary in `.index/` is produced by `pnpm index:build`. |
| A prompt template that injects retrieved context into a single LLM call | `packages/rag/src/generation/prompt.ts`, rendered as [`prompts/final-diligence-prompt.md`](../prompts/final-diligence-prompt.md) (a test keeps the two identical). | `pnpm prompts:render`; [architecture.md](architecture.md) §6.8. |
| A natural-language question in, a well-structured grounded answer out | Deep Analysis: type any question; the answer is a structured brief (summary, key findings, comparison, considerations, gaps, follow-ups), every claim citing filing passages that are validated server-side. | The live app, or `examples/analysis-request.sh`. |
| The final answer in **one** API request | `GenerationGateway` allows one call per analysis; the worker claims a job before calling; the Bedrock client has `maxAttempts: 1`; `generationCallCount` is persisted and a CloudWatch alarm fires if it ever exceeds 1. No query rewriting, planning, critique or repair calls. | [architecture.md](architecture.md) §4.3 and §5; tests in `packages/rag/src/generation/generation.test.ts` and `services/api/src/analyses/worker.test.ts`; every recorded and production analysis shows `generationCallCount: 1`. |
| Documented assumptions and decisions | [assumptions.md](assumptions.md), [design-decisions.md](design-decisions.md) (DD-01 onward), [SPEC.md](../SPEC.md) Appendix A (every change, dated, with its reason). | |

## Deliverables

| # | Deliverable | Where it is |
|---|---|---|
| 1 | A README with setup and run instructions | [`README.md`](../README.md): prerequisites, AWS setup, environment variables, corpus placement, ingestion and indexing, the offline profile build, local run, deploy, evaluations, reset. |
| 2 | Indexing and retrieval code | `scripts/ingestion/`, `scripts/indexing/`, `packages/corpus/src/` (section detection, chunking), `packages/rag/src/index/` (index build and load), `packages/rag/src/retrieval/` and `packages/rag/src/query/` (query understanding, hybrid retrieval, lane balancing, context building). |
| 3 | A log of prompt iterations (what changed, why) | [`docs/prompt-iterations.md`](prompt-iterations.md): every Deep Analysis version (da-v1 to da-v5, with da-v5 tried and not shipped) and every Company Intelligence profile version, each with the problem, the change, the reason and the measured result. Earlier versions are in [`prompts/versions/`](../prompts/versions/). |
| 4 | The final prompt template | [`prompts/final-diligence-prompt.md`](../prompts/final-diligence-prompt.md) (Deep Analysis, the one live call) and [`prompts/company-intelligence-prompt.md`](../prompts/company-intelligence-prompt.md) (the offline profile build). |
| 5 | A front-end | `apps/web/` (Next.js static export on Amplify), live at https://diligenceiq.mikemiller.ai. |
| 6 | An example request ready to execute | [`examples/analysis-request.sh`](../examples/analysis-request.sh) and [`examples/README.md`](../examples/README.md), with a recorded production run in `examples/sample-output.txt` (prompt da-v4, 1 call, $0.1299, 53 of 53 citation references valid, two claims marked "Period not cited"). One run makes one paid generation call (about $0.10–0.14). |
| 7 | Notes on how quality was evaluated | [`docs/evaluation.md`](evaluation.md) (retrieval, generation, numeric grounding, period claims, robustness and injection, a manual review, profiles, signals, web performance) with the raw records in [`evals/results/`](../evals/results/) and the question sets in [`evals/`](../evals/). |

## The demo

| The assessment asks for | Where it is |
|---|---|
| A working demo, run live as a client meeting | [`docs/demo-script.md`](demo-script.md): the 20-step flow, timings, sample questions, fallbacks and likely panel questions. |
| The panel enters a business question into the input field | Deep Analysis (`/analysis/new`): any typed question; a prefilled question never runs without an explicit Run. |
| Information on how this creates value for the business | The Architecture and business-value page (`/architecture` in the app) and the business story in [`docs/demo-script.md`](demo-script.md). |
| Design decisions to walk through | [`docs/architecture.md`](architecture.md), [`docs/design-decisions.md`](design-decisions.md), including the cost and scaling strategy (§13: about $0.57 a month idle, about $0.10–0.14 per analysis). |
| Future state, if the client is sold | [`docs/future-state.md`](future-state.md) and the future-state section of the Architecture page. Nothing there is presented as built. |

## The three example questions from the assessment

All three are in the evaluation set verbatim (`evals/questions.yaml`: `pdf-1`, `pdf-2`, `pdf-3`) and are answered with one call each. Honest notes from [`docs/evaluation.md`](evaluation.md):
- **pdf-1** (Apple, Tesla, JPMorgan risk factors): answered with balanced evidence from all three companies. In the recorded da-v4 run the comparison table came back ragged (4 column headers over 9 rows, one row a value short), which the app flags with a notice rather than hiding.
- **pdf-2** (NVIDIA revenue and outlook over two years): answered with cited figures; numeric grounding flags any figure not found in its cited passage (in the recorded da-v4 run, 96 of 97 verified; the "~0%" growth cell is marked unverified).
- **pdf-3** (pharmaceutical regulatory risks and responses): answered, but retrieval misses some companies' mitigation passages (gold recall 7 of 18; the manual review records a major omission). It is the weakest of the three, and it is presented as such.

## Beyond the brief

What DiligenceIQ adds around the one-call RAG answer, so an investor gets value before asking anything: Company Intelligence for 53 companies (what is happening, what changed, what deserves attention, why it matters, what to investigate next), Compare, evidence with a readable source view, and saved Findings. Company Intelligence profiles are built offline under a named, bounded cost exception (SPEC §35.7) and are never generated on page view.

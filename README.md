# DiligenceIQ

**AI Investment Diligence Workspace.** Turn SEC filings into evidence-backed investment decisions.

> **Status:** Phase 0 (architecture baseline). The application is not built or deployed yet. This README grows as each phase lands. Setup, ingestion, local run, deployment, evaluation, and example-request instructions are added in the phases that implement them.

## What it is
A diligence workflow for a private-equity deal team. Teams research public companies, verify conclusions against source filings, capture findings, organize them by workstream, and prepare an Investment Committee brief. Retrieval-augmented generation over SEC 10-K/10-Q filings powers the research step. Each analysis is answered by **exactly one generative LLM request**, grounded in retrieved, citable filing excerpts.

## Design docs
- [Architecture](docs/architecture.md), including the Cost and Scaling Strategy
- [Assumptions](docs/assumptions.md)
- [Design decisions](docs/design-decisions.md)
- [Design tokens & UI principles](docs/design-tokens.md)
- [Testing strategy](docs/testing-strategy.md)
- [Implementation plan](docs/implementation-plan.md)

Corpus facts in these docs are reproducible with `node scripts/ingestion/probe-corpus.mjs` (reads `CORPUS_PATH`, default `./edgar_corpus`; Node ≥ 22).

## Requirements
- [SPEC.md](SPEC.md): product and engineering specification
- [SPEC-ADDENDUM-COST.md](SPEC-ADDENDUM-COST.md): cost-control requirements (wins on conflicts)

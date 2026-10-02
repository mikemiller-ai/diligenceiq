# DiligenceIQ

**Investment intelligence over SEC filings.** Know what changed. Know what matters. Know what to investigate next.

> **Status:** Phase 4 (the one-call Deep Analysis generation pipeline, deterministic validation, the async SQS worker plane and the generation evals) is complete in the repository. Results are in [docs/evaluation.md](docs/evaluation.md) §4–5, and the prompt history is in [docs/prompt-iterations.md](docs/prompt-iterations.md). The worker stack (`DiligenceIQ-Worker`) is deployed in us-east-1, but nothing sends it work yet. The live site <https://diligenceiq.mikemiller.ai> still serves the Phase 1 build: Company Intelligence on preview profiles for AAPL, MSFT and NVDA, with cited risk headings, labeled placeholders and no figures. The public API still answers `ANALYSES_DISABLED`, because sessions, caps and the enqueue route arrive in Phase 5. This README grows as each phase lands. The complete README and a ready-to-run example request in `examples/` are Phase 8 exit criteria (implementation plan).

## Develop
Node ≥ 22 and pnpm 9.

```bash
pnpm install
pnpm dev            # http://localhost:3000
pnpm gate           # check:docs, lint, typecheck, test, cdk:synth, build, e2e (Playwright)
```

Deploy (AWS us-east-1, CDK): `pnpm deploy:infra`, then `pnpm deploy:web` (uploads the static export to Amplify).

## What it is
An investment-intelligence product for a private-equity team. Pick a company and see how it is performing, what changed across its filings, what deserves attention, why it matters, and what to investigate next, before asking anything (Company Intelligence). Compare companies side by side. Then ask any question in **Deep Analysis**: retrieval-augmented generation over SEC 10-K/10-Q filings, answered by **exactly one generative LLM request** grounded in retrieved, citable filing excerpts. Save findings with their evidence.

Company Intelligence profiles are built **offline** by an admin-run script (one call per company per index and prompt version, plus a zero-call deterministic set) and only read at runtime. Opening a page never calls an LLM. This is an explicit, dated override of part of the cost addendum; see [DD-16](docs/design-decisions.md).

## Design docs
- [Architecture](docs/architecture.md), including the Cost and Scaling Strategy
- [Assumptions](docs/assumptions.md)
- [Design decisions](docs/design-decisions.md)
- [Design tokens & UI principles](docs/design-tokens.md)
- [Testing strategy](docs/testing-strategy.md)
- [Implementation plan](docs/implementation-plan.md)

Corpus facts in these docs are reproducible with `node scripts/ingestion/probe-corpus.mjs` (reads `CORPUS_PATH`, default `./edgar_corpus`; Node ≥ 22).

**Offline pipeline (Phase 2, admin-run; outputs in `.index/`, gitignored):**
- `pnpm ingest`: corpus (directory or zip at `CORPUS_PATH`) → processed filings, section offsets and chunks. No AWS.
- `pnpm extract`: deterministic financial facts, trends, drivers and risk headings per company. No AWS.
- `pnpm index:embed --dry-run`, then `pnpm index:embed`: Titan v2 embeddings, cached by content hash and resumable (Bedrock spend, about $0.44 for the full corpus).
- `pnpm index:build`: vectors, BM25, adjacency, `summary.json` and `manifest.json`, validated before the build is kept.
- `pnpm index:upload --bucket <name> [--yes]`: immutable S3 upload (a dry run without `--yes`).
- `pnpm index:measure-load`: cold-load timing.

**Evals and retrieval tools (Phase 3, admin-run; results in `evals/results/`, summarized in [docs/evaluation.md](docs/evaluation.md)):**
- `pnpm eval:retrieval`: the 20 questions in `evals/questions.yaml`, in BM25, cosine and hybrid modes, with no generation. It uses cached query embeddings; `--embed` embeds new questions (Titan v2, about $0.000001 each).
- `pnpm eval:chunk-size`: a BM25-only chunk-size experiment. No AWS.
- `pnpm eval:signals`: the signal go/no-go against the hand labels. No AWS.
- `pnpm retrieval:debug`: serves `POST /api/retrieval/debug` locally on 127.0.0.1. It is never deployed.

**Generation (Phase 4, admin-run):**
- `pnpm eval:retrieval --generate`: one generation call per eval question through the real pipeline, scored deterministically. It replays recorded responses for free; `--live` calls Bedrock for unrecorded requests (Sonnet 4.6, about $0.11 each); `--only <ids>` limits the run.
- `pnpm eval:generation:rescore`: re-validates the stored briefs after a validator change. No AWS.
- `pnpm prompts:render`: rewrites `prompts/final-diligence-prompt.md` from the runtime prompt. A test checks that they match.
- `pnpm analysis:run --question "…"`: one analysis through the deployed worker, in-region. AWS writes and about $0.13 of Bedrock spend; it needs the kill switch on.

## Requirements
- The Eliza assessment PDF is the outer constraint.
- [SPEC.md](SPEC.md) (v2) is the sole canonical implementation specification. Its only cost exception is the offline Company Intelligence profile build: a named, bounded exception (SPEC §35.7) recorded as the dated override in DD-16.
- The design docs above elaborate SPEC v2 and cannot override it.
- Superseded sources, kept verbatim for provenance in [docs/archive/](docs/archive/): [SPEC v1](docs/archive/SPEC-v1.md), [the cost addendum](docs/archive/SPEC-ADDENDUM-COST.md), and [the product direction](docs/archive/PRODUCT_DIRECTION.md). SPEC v2 Appendix A lists every change from them.

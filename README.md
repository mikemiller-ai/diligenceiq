# DiligenceIQ

**Investment intelligence over SEC filings.** Know what changed. Know what matters. Know what to investigate next.

> **Status:** Phase 6 (evidence: adjacent-period comparison for citations, the readable source view with the cited passage highlighted, the coverage matrix linked to evidence, citation-integrity checks) is built and gated, not yet deployed. Production at <https://diligenceiq.mikemiller.ai> (us-east-1) runs Phases 1–5 plus Phase 4b: Company Intelligence for all 53 companies in the review window from the model-written profile set `llm-v3` (with per-company deterministic fallback; the zero-call set `det-v2` is the instant fallback). New analyses are paused (the kill switch is off), so the site shows the seeded example briefs and refuses new runs with `ANALYSES_DISABLED`. See `STATE.md`. Evaluation results are in [docs/evaluation.md](docs/evaluation.md) §4–6 and the prompt history in [docs/prompt-iterations.md](docs/prompt-iterations.md). The complete README and a ready-to-run example request in `examples/` are Phase 8 exit criteria (implementation plan).

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

**Demo workspace and profile sets (Phase 5, admin-run):**
- `pnpm seed:build`: rebuilds `seed/demo-workspace.json` from real pipeline output by replaying recorded generations. Free; it fails rather than call Bedrock.
- `pnpm profiles:export-fixture`: writes the preview profiles as a profile set to `tests/fixtures/profile-sets/`. No AWS.
- `pnpm profiles:upload-set --bucket <name> --set <indexVersion>/<profileSetId>`: uploads a set to S3 (dry run unless `--yes`). Switching the active set is a separate SSM parameter change.

**Company Intelligence profiles (Phase 4b, admin-run):**
- `pnpm intelligence:build --max-calls 0`: builds the deterministic profile set locally (zero model calls, no AWS). With `--llm` it also builds the model-written set: it reads the S3 build ledger, is a dry run unless `--yes`, and never calls a company twice at one prompt version (about $0.10 per call). `--llm --max-calls 0` rebuilds it from stored outputs for free.
- `pnpm eval:profiles`: scores the built sets against `evals/profiles.yaml`. No AWS.
- Upload with `pnpm profiles:upload-set --root .index/intelligence --set <indexVersion>/<set>`.

**Evidence (Phase 6, admin-run):**
- `pnpm evidence:check`: citation integrity over the local index build. Every chunk, adjacency reference, seed and recorded live-brief citation, and built profile-set citation must resolve to its passage. No AWS; writes `evals/results/evidence-<iv>.json`.
- `pnpm fixtures:evidence`: regenerates the committed adjacency subset in `tests/fixtures/evidence/` from `.index/build`. No AWS.

**Generation (Phase 4, admin-run):**
- `pnpm eval:retrieval --generate`: one generation call per eval question through the real pipeline, scored deterministically. It replays recorded responses for free; `--live` calls Bedrock for unrecorded requests (Sonnet 4.6, about $0.11 each); `--only <ids>` limits the run.
- `pnpm eval:generation:rescore`: re-validates the stored briefs after a validator change. No AWS.
- `pnpm prompts:render`: rewrites `prompts/final-diligence-prompt.md` and `prompts/company-intelligence-prompt.md` from the runtime prompts. Tests check that they match.
- `pnpm analysis:run --question "…"`: one analysis through the deployed worker, in-region. AWS writes and about $0.13 of Bedrock spend; it needs the kill switch on.

## Requirements
- The Eliza assessment PDF is the outer constraint.
- [SPEC.md](SPEC.md) (v2) is the sole canonical implementation specification. Its only cost exception is the offline Company Intelligence profile build: a named, bounded exception (SPEC §35.7) recorded as the dated override in DD-16.
- The design docs above elaborate SPEC v2 and cannot override it.
- Superseded sources, kept verbatim for provenance in [docs/archive/](docs/archive/): [SPEC v1](docs/archive/SPEC-v1.md), [the cost addendum](docs/archive/SPEC-ADDENDUM-COST.md), and [the product direction](docs/archive/PRODUCT_DIRECTION.md). SPEC v2 Appendix A lists every change from them.

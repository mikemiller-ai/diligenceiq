# STATE

_Last updated: 2026-10-01 (local)_

## Branch
`main` (new repository; no remote yet)

## Current phase
**Phase 0 complete** (architecture baseline). The full gate passed: adversary → fixer → /code-review → fixes → gate. See `docs/handoffs/phase-00.md`.

## Gate
`pnpm gate` runs `scripts/check-docs.mjs`. Last run (2026-10-01): `check-docs: OK (11 files verified)`.

## Done
- Inspected the corpus (246 filings, 54 companies), the AWS account (us-east-1 CDK bootstrap, Route 53 zone, Bedrock model listings and service quotas, Lambda account concurrency), and Mike's sibling repos (ResolveIQ, TrustResponse, CareerOps) to establish the house pattern.
- Wrote the design baseline: docs/architecture.md, assumptions.md, design-decisions.md, design-tokens.md, testing-strategy.md, implementation-plan.md, SPEC-ADDENDUM-COST.md, CLAUDE.md.
- Added `scripts/ingestion/probe-corpus.mjs`; every corpus number in the docs is reproducible with it.
- Phase 0 adversary findings fixed (fresh fixer agent); /code-review findings fixed (`.gitignore` anchoring; DD-04 redelivery rationale).

## In flight
- Nothing. Waiting for Mike's go-ahead on the Phase 0 commit, then Phase 1.

## Next
Phase 1: pnpm workspace scaffold, app shell and design system, all routes on fixtures, CDK WebStack + CoreStack skeleton with cost-guard assertion tests, and the shell live on diligenceiq.mikemiller.ai (verify the Amplify rewrite forwards `Set-Cookie`).

## Decisions pending with Mike
- **Lambda concurrency quota increase (recommended before the demo).** The account limit is 10, shared with other apps. This is an account change Mike must approve and file.
- **Sonnet 5.5 quota increase (optional).** Quota L-94A31E46 (cross-region tokens/minute) is 0; the app ships on Sonnet 4.6 unless this is raised.
- SPEC.md: Mike approved committing it (2026-10-01). The assessment PDF stays gitignored.
- Optional: ask Eliza whether a non-generative rerank call counts as retrieval (only matters if the Phase 3 evals favor rerank).

## Known traps
- **Lambda account concurrency is 10 (shared).** No reserved concurrency; worker `maximumConcurrency: 2`.
- **Claude Sonnet 5.5 has 0 tokens/minute quota here.** Default generation model is `us.anthropic.claude-sonnet-4-6` (6,000,000 TPM cross-region; routes to us-east-1, us-east-2, us-west-2, so IAM needs all three foundation-model ARNs).
- **Cohere Embed v4 is capped at 16.2M tokens/day cross-region (non-adjustable),** below the ~20M-token corpus. Default embeddings are Titan v2 (300,000 TPM; a full build takes over an hour). The indexer must checkpoint and cache.
- Bedrock model **invoke** entitlement is unverified; only list and quota APIs were called. Verify at the start of Phase 2.
- There is no Docker, so use Lambda zip bundles only.
- 54 files lack `Report Period`. Period end order: header → URL slug (incl. `x10k` and `msft-10q_YYYYMMDD` forms) → cover page (`gecc10k2014.htm`) → filing date.
- The header `Quarter` is a calendar quarter, not a fiscal quarter. TGT and HD name the fiscal year by its start year; JNJ's 52/53-week years can end January 1–2.
- The exact cover heading string matches only 30/246 files; use the whitespace-tolerant, case-insensitive regex.
- JNJ and XOM 10-Qs have no Item 1A section (cross-references only); MS's 10-K uses a TOC form without "Item".
- `GE_10K_2015` is GE Capital's FY2014 10-K, not General Electric Company.
- Lines up to 287,855 characters; never chunk by line.

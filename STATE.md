# STATE

_Last updated: 2026-10-01 (local)_

## Branch
`main` (no remote yet). Last commit: `9a7a764` Phase 0. The Phase 0b docs commit waits for Mike's go-ahead.

## Current phase
**Phase 0b complete (product re-baseline), pending commit.**
- Mike supplied a revised product direction: investment intelligence first, with Company Intelligence as the primary screen and Deep Analysis (the RAG) as the drill-down.
- It was reconciled into a consolidated **SPEC.md (v2)**, now the sole canonical spec.
- SPEC v1, the cost addendum and the product direction are archived verbatim in `docs/archive/`.
- Gate record: adversary (2 blocker, 6 high, 12 medium, 12 low) → fresh fixer fixed all → `/code-review` (2 findings, both fixed) → `pnpm gate` green. See `docs/handoffs/phase-00b.md`.

## Gate
`pnpm gate` was run on 2026-10-01 in the working tree, which includes uncommitted Phase 1 code. It exited 0:
- `check-docs: OK (13 files verified)`
- Tests: 120 passed (packages/core 12, infrastructure/cdk 35, services/api 23, apps/web 50)
- `cdk:synth` and `build` succeeded

The committed `package.json` still has the Phase 0 gate (check-docs only). The full gate arrives with the Phase 1 commit.

## Key decisions this session (2026-10-01)
- **Company Intelligence engine (Mike's choice):**
  - Deterministic facts and signals, plus **one offline, admin-run LLM call per company per (indexVersion, profilePromptVersion)**, enforced by a build ledger. This is a dated, bounded exception to the cost rules (SPEC v2 §35.7, DD-16).
  - A zero-call deterministic profile set is always built, and the SSM pointer `/diligenceiq/active-profile-set` switches between the two sets.
  - **Ask Eliza before Phase 4b** whether the offline call is acceptable (assumptions F4).
- **The Phase 1 shell is reworked in place** to the new navigation before its gate. There is no separate Phase 1b.
- **Navigation:**
  - Company Intelligence | Compare | Deep Analysis | Findings, plus a global "Ask a question" action.
  - Thesis and Watchlist (P1) arrive in Phase 8b, after Phases 7 and 8.
  - The IC Brief and the filing explorer are P1.
- **Phases:** 0b, 1 (rework), 2, 3, 4, 4b (offline profiles), 5, 6, 7, 8, 8b (P1), 9. See `docs/implementation-plan.md` Revision 2.

## In flight
- **Phase 0b docs commit:** waiting on Mike.
- **Phase 1 code is uncommitted and on the OLD navigation** (Overview, Diligence, Findings, IC Brief, Sources). It is built and tests pass, but it is not deployed. The Set-Cookie check (D9) has not been done.
  - Paths: `apps/`, `packages/core`, `services/api`, `infrastructure/cdk`, `package.json`, pnpm files, `eslint.config.mjs`, `tsconfig.base.json`, `scripts/deploy-web.sh`, `scripts/fixtures/`, `.claude/launch.json`.
  - `docs/design-tokens.md` already describes its design system and is in the 0b commit.

## Next
**Phase 1 rework:**
1. New navigation and routes:
   - `/intelligence` (selector), `/intelligence?ticker=`
   - `/compare`
   - `/analysis/new` (prefill never auto-submits), `/analysis`
   - `/findings`
   - `/architecture` (P0 business-value page)
   - new landing page
2. Data model:
   - `CompanyIntelligenceProfileSchema` in `packages/core`
   - workstreams → themes
   - Finding `theme` + `origin`, plus the `AnalysisOrigin` and `FindingSource` unions
3. Fixture profiles carry no figures and no narrative presented as fact (test).
4. Then run the full Phase 1 gate, deploy to `diligenceiq.mikemiller.ai`, verify Set-Cookie through the Amplify rewrite, and commit.

## Decisions pending with Mike
- **Ask Eliza** about the offline profile generation (F4), before Phase 4b.
- **Lambda concurrency quota increase:** recommended before the demo (the account limit is 10, shared).
- **Sonnet 5.5 quota increase:** optional (L-94A31E46). The app ships on Sonnet 4.6 otherwise.
- **Rerank:** optionally ask Eliza whether a non-generative rerank counts as retrieval. This only matters if the Phase 3 evals favor rerank.

## Known traps
- **Profile build ledger:** a failed profile call is never retried at the same version. The company keeps its deterministic fallback until a genuine prompt-version bump. Never bump the version just to retry; that would fabricate prompt history.
- **SPEC section numbers changed in v2.** Docs cite v2 numbers. Historical references say "SPEC v1 §N (archived)". SPEC v2 Appendix B maps old to new.
- **`scripts/check-docs.mjs` locks in many Phase 0b phrases and the phase-row order (8 → 8b → 9).** Rewording those docs means updating the checks too.
- **Lambda account concurrency is 10 (shared).** No reserved concurrency; worker `maximumConcurrency: 2`.
- **Claude Sonnet 5.5 has 0 tokens/minute quota here.** The default is `us.anthropic.claude-sonnet-4-6`. IAM needs the us-east-1, us-east-2 and us-west-2 foundation-model ARNs.
- **Cohere Embed v4 is capped at 16.2M tokens/day,** below the ~20M-token corpus. Titan v2 is the default. The indexer must checkpoint and cache.
- **Bedrock invoke entitlement is unverified.** Verify at the start of Phase 2.
- **No Docker.** Lambda zip bundles only.
- **Corpus coverage tiers:**
  - Deep: 12 companies, 3–5 10-Ks each.
  - Partial: META, BAC, JPM, MCD, PEP.
  - Limited history: 37 companies with a single 10-K.
- **Period end order** (54 files lack `Report Period`): header → URL slug → cover page → filing date.
- **Header `Quarter` is a calendar quarter, not a fiscal quarter.** TGT and HD name the fiscal year by its start year.
- **JNJ and XOM 10-Qs have no Item 1A.** MS's 10-K TOC has no "Item".
- **`GE_10K_2015` is GE Capital's FY2014 10-K.**
- **Lines reach 287,855 characters.** Never chunk by line.

# STATE

_Last updated: 2026-10-01 (local)_

## Branch
`main` (no remote yet). Last code commit: `716181a` Phase 1 (application shell on the SPEC v2 IA).

## Current phase
**Phase 1 (rework to the SPEC v2 IA) is complete, deployed, and committed (`716181a`).** Handoff: `docs/handoffs/phase-01.md`.
- Live at https://diligenceiq.mikemiller.ai (Amplify job 1, app `d1jxmy4ao911ax`; the api Lambda was updated by `pnpm deploy:infra` on 2026-10-01).
- **D9 verified:** the Amplify `/api/<*>` rewrite forwards `Set-Cookie` and the returning `Cookie` header (curl with a cookie jar, and a real browser).
- Navigation: Company Intelligence | Compare | Deep Analysis | Findings, plus "Ask a question". Routes: `/`, `/intelligence`, `/compare`, `/analysis/new`, `/analysis`, `/findings`, `/architecture`, `/sources/filing`.
- Content is fixture-only: preview profiles for AAPL, MSFT and NVDA hold a **selection** of verbatim, cited latest-10-K risk headings plus labeled placeholders, and no figures. Compare shows placeholders for anything that needs the complete heading list.
- The workspace starts empty. The hand-written sample brief is test-only (`apps/web/src/test/`), and a test forbids app imports from there.
- The API answers `POST /api/analyses` with `ANALYSES_DISABLED`; there is no pipeline yet.

## Gate
`pnpm gate` was run on 2026-10-01 against the working tree (exit 0):
- `check-docs: OK (13 files verified)`;
- lint and typecheck (including `tests/e2e`) clean;
- unit tests: core 30, cdk 35, api 23, web 89 (177 in total; the corpus exact-slice test ran);
- `cdk:synth` and `build` succeeded;
- **e2e: 31 passed** (Playwright 1.63.0, including axe scans and the prefill-never-auto-submits network test).

Gate record for the phase:
- the adversary found 1 blocker, 3 high and the rest medium or low;
- a fresh fixer fixed all of them, with regression tests;
- `/code-review` at medium returned 0 findings;
- `pnpm gate` passed.

## In flight
- Nothing uncommitted.
- Next is **Phase 2**, ingestion and indexing. Verify Bedrock invoke entitlement first.

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
- **E2E:**
  - `pnpm e2e` serves `apps/web/out` with `python3 -m http.server` on port 4174, with **one worker**: parallel workers stall the Python server and pages hang on "Loading…".
  - It needs a prior `pnpm build`; the gate order handles that.
  - `@playwright/test` is pinned to 1.63.0 to match the cached Chromium 1243. Bumping it triggers a browser download.
- **Fixture profiles hold a selection of headings.** While any `profileSetId` is `fixture-*` (`isFixtureProfile`), nothing that depends on the complete heading list may be stated as a conclusion: common or distinctive areas, ranking, "major attention area", or a heading's rank. SPEC §8.6.
- **Fixture passages are regenerated, never hand-edited:**
  - Run `node scripts/fixtures/build-web-fixtures.mjs`; it needs `./edgar_corpus`.
  - App passages and test-only passages (`apps/web/src/test/generated/`) are separate files.
- **Corpus company names have no trailing period** ("Apple Inc", "Tesla Inc"). GE's display name is overridden to "General Electric Capital Corp (GE Capital)" (G2).
- **`cdk diff` is not side-effect free.** It publishes template and Lambda assets to the CDK bootstrap bucket.

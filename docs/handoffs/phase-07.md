# Phase 7 Handoff: Evaluation, Security and Observability

_2026-10-03 (local). Committed `2aeaec5` on `main`; deployed 2026-10-03._

## Why
Implementation plan row 7 and SPEC §49 row 7: the eval harness and `docs/evaluation.md` covering Deep Analysis and profiles; unsupported-query and injection tests; structured logging, request IDs, 14-day retention and metric filters; input validation; security headers and the CSP (assumptions D10); the IAM review; accessibility and performance review; cost telemetry; and the Architecture and business-value page with measured numbers only.

Mike's decisions this phase:
- CSP: per-page meta hashes.
- The Pfizer "(MILLIONS)" caption: read it.
- A small targeted robustness run, then a realistic plant re-run with 2 variants.
- The page uses the existing measured runs, plus a local web-perf measurement.
- The seed brief's errors: document them now and fix them in da-v5.
- Read-only AWS checks of the metric filters after the deploy.

## Completed
- **CSP (D10, decided).**
  - `apps/web/src/build/csp.ts` runs after `next build` (`apps/web` `build` script). It hashes each page's inline scripts and writes a `<meta http-equiv="Content-Security-Policy">` right after `<meta charSet>`. The policy is `script-src 'self'` plus that page's hashes, with `default-src 'self'`, `connect-src 'self'`, `object-src 'none'` and the rest of the list.
  - The Amplify header keeps `frame-ancestors 'none'`.
  - Residual allowance: `style-src 'unsafe-inline'`, because sonner inserts a runtime `<style>`.
  - Zod runs `jitless` (`packages/core/src/zod-config.ts`, core's first import), so its `new Function` probe raises no violation.
  - The api's JSON responses add `nosniff`.
- **Validator, the table-scoped caption rule (architecture §6.9).**
  - A bare currency caption counts only as the first cell of a table header row ("(MILLIONS) |  | Worldwide"), and only for that table (rule `caption_unit`).
  - Any other scale caption in the passage disqualifies it, and it never overrides a preceding unit.
  - The profile validator uses it too (`PROFILE_VALIDATOR_VERSION` 3; a re-score of det-v2 and llm-v3 changed nothing).
  - Re-scores: da-v1 0.892 → 0.944, da-v2 0.873 → 0.977, da-v3 0.931 → 0.987, **da-v4 0.911 → 0.989 (531/537)**. All 149 near matches are now `caption_unit`, and no figure lost its verification (checked figure by figure against HEAD). The seed is unchanged.
- **Observability (architecture §12).**
  - **api access line:** one `api_request` line per request, with the route template (never IDs or the query), status, duration and code.
  - **Raw JSON logging:** `log()` writes raw JSON to stdout. The adversary's reason (that Lambda's text prefix defeats JSON metric filters) was disproved by the production check; see Deployed.
  - **Request ID correlation:** `apiRequestId` travels in the queue message (optional, non-fatal, base64 characters allowed).
  - **Failed summaries:** every fail path writes an `analysis_summary` line with status `failed` and its code: worker, dlq-handler, poll expiry, enqueue failure.
- **Metrics and alarms.**
  - Metric filters: `GenerationDurationMs`, `AnalysisEstimatedCostUsd`, `CitationsRemovedByValidation`, `AnalysisFailed{Code}` (worker, dlq-handler and api log groups) and `Api5xx`.
  - Alarms: `GenerationCallsOverOne` and `DlqHandlerInvokedAlarm` (the DLQ drains too fast for a depth alarm). Their notification targets come in Phase 8.
- **IAM review.**
  - `infrastructure/cdk/lib/lambda-role.ts` gives each Lambda its own role, with `CreateLogStream`/`PutLogEvents` on its own log group only. It replaces the account-wide `AWSLambdaBasicExecutionRole`.
  - A new cost-guard rule, `iam-managed-policy`, enforces no managed policies.
  - The review is written up in architecture §11.
- **Input validation audit:** every P0 SPEC §39 limit is tested at its boundary (`services/api/src/app.test.ts`).
- **Evals.**
  - `evals/robustness.yaml` holds 6 questions, run with `pnpm eval:retrieval --set robustness`; `generation-rescore --set robustness` re-scores them.
  - `packages/rag/src/eval/plant.ts` is eval only. It plants an instruction in the real context, either obvious or realistic (a real-looking unused chunk ID, middle or last).
  - The manual groundedness review is in `evals/results/manual-review-iv-9cf51c066743-da-v4.md`.
  - `pnpm eval:web-perf` produces `evals/results/web-perf.*`.
  - `docs/evaluation.md` §7–§10 are new, and §10 maps every SPEC §41.2 metric to its record.
- **Architecture page.** `measured.ts` holds 12 measured cards, and `measured.test.ts` recomputes every value, and every digit in its text, from `evals/results/*` and evaluation.md §5. The stale statuses are corrected (everything through 6r is deployed), and the refined Compare is described.
- **Docs.** architecture §6.9, §11 and §12; assumptions D10; testing-strategy §5–§8; CLAUDE.md (Phase 7 tools, Node ≥ 22.18); README (status, Phase 7 tools); `engines` is `node >=22.18`.

## Verified
- **Robustness, live (approved; $0.6515 for 6 calls: $0.4176 for the first 4, then $0.2339 for the 2 realistic variants):** 5/6 pass, 1 call each, citation validity 1.00, numeric grounding 46/47.
  - In all 3 planted-document injections the model neither followed nor cited the plant.
  - The realistic "last" plant fails by the check's letter: the brief quoted the plant in order to reject it. The check was not changed after the run.
- **Manual review (a Claude agent, not a human; 8 briefs, 136 claims):** 62.5% Supported, 96.3% Supported or Partly. Completeness: 2 major omissions (pdf-3, multi-cloud). No ratings. The main session spot-checked the DMA misdating against `AAPL-FY2024-10K-1A-017`.
- **Web perf (local, 4× CPU):** LCP ≤ 776 ms on every page measured, CLS ≤ 0.022. First-load JS on the workspace pages is about 390 KB gzipped.
- **The Architecture page, seen in the browser pane** in dark and light at 1280 px and 390 px: no sideways scroll, CSP meta present.
- **CSP e2e (`tests/e2e/local/security.spec.ts`):**
  - zero violations on 9 pages and through client navigation;
  - the theme toggle works;
  - an injected script is blocked;
  - the theme applies by its hash with every bundle blocked.

## Gate record
1. **Implementation.**
2. **Adversary:** 4 high, 6 medium, 8 low.
   - **H1:** the first caption rule applied to every cell, so share counts and 1000× errors verified.
   - **H2:** the DLQ depth alarm could not fire.
   - **H3:** the JSON metric filters versus the Lambda text-log prefix.
   - **H4:** the seeded brief's errors.
   - **Medium:** fail paths without summary lines (M1); a too-obvious plant (M2); the page's latency was labeled da-v4 and showed a false idle claim (M3); the traceability test was partly hardcoded (M4); `apiRequestId` could invalidate a message (M5); deploy order (M6).
3. **Fresh fixer:** every finding fixed, each with a test.
   - H4 was decided by Mike: documented, with a da-v5 fix to come.
   - M2 was re-run with 2 realistic variants, with Mike's approval.
   - CLAUDE.md's Node line was left to the main session.
4. **`/code-review` medium:** 2 findings, both fixed:
   - the `apiRequestId` regex dropped base64 `+` and `/` (regression test added);
   - perf bytes omit lazily loaded chunks (now documented as first-load).
5. **`pnpm gate` exit 0:**
   - unit tests: core 79, cdk 46, corpus 102, rag 453, web 464, api 154 (1,298);
   - cdk:synth and build;
   - e2e 100 passed, 4 skipped.

## SPEC §48.2 (adversary)
- **Value before a question:** unchanged.
- **Plain language:** the Architecture cards are plain; their "Source:" lines name files on purpose.
- **Nothing generated unnecessarily:** 6 approved eval calls, and nothing on page view.
- **Intelligence product, not a RAG demo:** Phase 7 is mostly plumbing. Its user-visible effects are more verified badges (now table-scoped) and an honest Architecture page.

## Known limits
- **The seeded expert-question brief:**
  - it dates the Apple DMA fines and the Commission challenge to FY2025, though they are in FY2024;
  - it says AI and tariffs were absent from FY2023/FY2024, when those passages were simply not in its context.
- **multi-cloud:** no AWS financials, a retrieval miss.
- **The da-v5 prompt** would address the absence claims and quoting disregarded passages. It needs a live eval run (about $2.25) and a reseed.
- **The metric filters and alarms have never been seen matching in production.** The Phase 4 one-call alarm had the same exposure.
- **Heavy first-load JS** from Zod 4 and every core schema in the browser.
- No screen-reader walkthrough was done.

## Deployed
2026-10-03, run by Mike after his approval: `pnpm deploy:infra` (WorkerStack 16:19 UTC, ApiStack 16:21 UTC; CoreStack and WebStack had no change), then `pnpm deploy:web` (Amplify job 12).

**Production check (headless):**
- **CSP:** 28 page loads (7 P0 pages, light and dark, 1280 and 390 px), each with one CSP `<meta>`, zero violations and no sideways scroll.
- **Script control:** an injected inline script is blocked. The theme toggle works, and the stored Dark applies with every bundle blocked (the hash works).
- **Requests:** only reads plus `POST /api/session`.
- **Headers:** all present on pages and the api.
- **Metric filters** (read-only checks Mike approved): all 8 deployed patterns match their sample lines and reject counter-examples. They match equally a line with Lambda's Text `console.log` prefix, so H3's premise was wrong; the raw stdout lines stay, and the docs say why.
- **Real logs:** 126 `api_request` lines arrived as raw JSON, with route templates only.
- **Not checked:** the worker filters against a real line and an alarm firing. No analysis has run (the kill switch is off).

## Next
Phase 8 (implementation plan row 8). Optionally, with Mike's go-ahead, one analysis through production to see the worker's summary line reach its metric filters.

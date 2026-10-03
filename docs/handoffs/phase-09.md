# Phase 9 Handoff: Interview Polish

_2026-10-03 (local). Gated and deployed; commit pending Mike's go-ahead._

## Why
Implementation plan row 9 and SPEC §49 row 9: interview polish treated as a product launch. That means a full UX review, `docs/demo-script.md` (SPEC §44), `docs/future-state.md` (§45), a final README pass, and the final panel-persona adversary (§50) against the definition of done (§51).

Mike's decisions this phase (2026-10-03):
- **Landing:** hide the launch film until it exists.
- **Dashboard:** put risks last.
- **Profile detector wording:** fix it in the UI only.
- **da-v5:** run it, then revert the runtime to da-v4 after production and eval evidence.
- **Validator:** build the deterministic period-claim check.
- **Seed:** reseed from the da-v4 recordings with the marks visible.
- **Alerting:** add an alarm on failed analyses.
- **pdf-3:** frame the pharma gap honestly rather than tune retrieval.
- **Repo:** create the GitHub repo, public for the panel.

## Completed
- **Docs.**
  - `docs/demo-script.md`: the 20-step flow with timings, sample questions, honest framing of the three PDF examples, fallbacks, likely panel questions, and a timebox talking point.
  - `docs/future-state.md`: five stages, marked built / next / later, plus the live-monitoring design.
  - `docs/deliverables.md`: every deliverable in the assessment PDF mapped to its place in the repo, linked from the README top.
- **Cost.** Architecture §13 now has computed figures (`evals/results/idle-cost-2026-10-03.json`): about $0.57 a month idle (mostly SQS polling and three alarms) and about $0.10–0.14 an analysis. `PRICING` is corrected to the billed cross-region rate ($3.30 / $16.50 per million input / output tokens), which had been 10% low.
- **UX review fixes** (21 items, with tests). The biggest:
  - The landing has no film placeholder.
  - Dashboard order: 30-second view, What's changed, Attention signals (the first two unfolded), Recommended diligence, then Performance, Drivers and Current risks (SPEC A.4).
  - Detector wording sits behind "How this was measured".
  - The bottom line falls back to operating margin.
  - "Save finding" everywhere; plain citation chips; one paused notice with Run disabled and "Check again"; honest failed and no-evidence states.
  - Compare: a phone scroll hint and short company names.
  - Findings: a List/Board view switch.
  - Architecture: a `<main>` landmark, the Phase 8 statuses, and the monitoring pipeline marked not built.
  - Phones: a scrim behind the nav drawer.
- **Prompt.**
  - da-v5 was tried. On the 20-question live eval ($2.47, approved) it scored grounding 0.978 and abstention 1/2, and in production 1 of 2 runs ended `MALFORMED_OUTPUT`.
  - It was **reverted to da-v4** (byte-identical; recordings replay). Both are logged in `docs/prompt-iterations.md`.
- **Validator: the period-claim check** (`packages/rag/src/generation/period-claims.ts`).
  - It marks a novelty or absence claim ("first", "new in", "absent", "not present", "no longer"…) that names a fiscal period that none of the item's citations comes from, when the period is tied to the cue.
  - The UI shows a "Period not cited" badge.
  - It is not a pass/fail check. Flags per run: da-v4 9 claims in 3 of 20 briefs; da-v5 8 in 2.
  - What it cannot see (contradictions with a cited period, relative dates) is in evaluation.md §12.
- **Seed.**
  - Rebuilt from the da-v4 recordings under the new validator.
  - Each seeded finding is figure-verified, free of period claims, and checked against its passages.
  - The Apple brief shows its 7 marks.
  - No recorded da-v4 brief survived a strict claim-by-claim reading (`evals/results/seed-verification-2026-10-03.md`).
- **Reliability.**
  - A deterministic repair parses a stringified JSON field after escaping raw control characters.
  - A content-free `failureDetail` (kind, position, length) is stored on FAILED records and never returned to the browser.
  - `AnalysisFailedAlarm` (metric `AnalysisFailedFault`) emails on any failure except `NO_RELEVANT_EVIDENCE` and `ANALYSES_DISABLED`.
- **SPEC.** A.4 rows for the film and the dashboard order. The GE Capital wording corrected (the page offers its filing). §35.7 and §51.1 now say 53 companies.
- **Repo.** https://github.com/mikemiller-ai/diligenceiq: created private, then made public at Mike's request. It is to be made private again after the panel.

## Verified
- **After the deploy** (WorkerStack and ApiStack by Mike, Amplify job 14):
  - all three alarms are OK, with the topic as their action;
  - the new filter pattern matches MALFORMED_OUTPUT and GENERATION_TIMEOUT (even with Lambda's log prefix) and rejects NO_RELEVANT_EVIDENCE, ANALYSES_DISABLED and complete lines;
  - `pnpm e2e:prod` 19/19.
- **The re-recorded example under da-v4** (approved): analysis `0muswoje69MPT2ATVia`, COMPLETE in 54 s, 1 call, $0.1299, 53/53 citation references valid, 0 unverified figures. The live period check marked two claims "Period not cited".
- The assessment PDF's deliverables were re-read against the repo (`docs/deliverables.md`).

## Gate record
1. **Reviews and fixes.**
   - Three parallel reviews (docs, idle cost, UX), then the UX fixer and the da-v5 run.
2. **Final §50 panel adversary:** 1 blocker, 5 high, 6 medium, 4 low.
   - **B1:** no remote, and production ran uncommitted code.
   - **H1:** the MALFORMED_OUTPUT failure.
   - **H2:** false period claims.
   - **H3:** a stale demo script.
   - **H4:** seed errors.
   - **H5:** pdf-3 retrieval.
   - **Mediums:** STATE is stale, the failure was in no record, da-v5 was deployed without a decision, "What's changed" is thin, profile overclaiming, the process is incomplete.
3. **Fixes:**
   - **B1:** repo created and pushed.
   - **H1:** repair, diagnostic, alarm, and the revert to da-v4.
   - **H2:** the period check.
   - **H3:** the demo script refreshed.
   - **H4:** reseed.
   - **H5:** honest framing (Mike's choice).
   - **Mediums:** STATE and docs updated. "What's changed" and the profile wording are recorded as known limits.
4. **`/code-review` medium:** 3 confirmed, all fixed with tests.
   - Period-check false positives on year-over-year sentences; the re-score changed no flag.
   - A numbered chip beside another company's chip.
   - Run stuck disabled after the kill switch came back on.
5. **`pnpm gate` exit 0:**
   - unit tests: core 79, cdk 49, corpus 102, rag 476, web 526, api 175 (**1,407**);
   - cdk:synth and build;
   - e2e 112 passed, 4 skipped.

## SPEC §51 status
- **Met:**
  - one call per answer;
  - prefill never runs;
  - citations validated;
  - evidence inspectable;
  - Company Intelligence for the 53 companies in the window, no LLM on page view;
  - Compare, the Findings Board, and the brief panels and badges;
  - measured numbers on the Architecture page;
  - production, the live URL and production smoke;
  - the example request reaches COMPLETE;
  - required docs, prompt history, evaluation notes, tests;
  - cost items (§51.2).
- **Partial, with honest framing:**
  - retrieval depth for pharma (pdf-3);
  - the period and meaning accuracy of model-written claims (flagged where deterministic, otherwise documented);
  - "What's changed" depth.
- **P1** (Thesis, Watchlist, IC Brief, explorer): not built, not claimed.

## Claim checks (after the rehearsal, Mike's request)
- **Three deterministic checks** sit beside the period check: no model calls, an optional validation field each, a badge in place, reporting only.
  - **Arithmetic:** a stated change must match its from/to values. Badge: "Change doesn't add up: says up 145%, figures give +671%".
  - **Company attribution:** a positive claim naming a company must cite that company's filings. Absence, contrast and negative cells are exempt.
  - **Sweeping claims:** "all five", "every company", "both" and similar need citations from that many companies.
  - A throw in any check is contained: it never fails an analysis.
- **Bar:** a badge type is shown only if it raises zero pure false alarms on the 109 real briefs (106 recorded and 3 production rehearsals).
  - Arithmetic: 2 flags, both real.
  - Attribution: 4, all real (36 before the adversary fixes).
  - Sweeping: 25 (16 real, 9 wider than their evidence but likely true).
  - On the rehearsals they flag the NVIDIA +145% error and pharma's "all five" (citing 4); PDF example 1 is clean. Details: evaluation.md §13.
- **Process:** adversary (3 high, 4 medium, 4 low), then a fresh fixer, then `/code-review` medium (5 precision gaps, all fixed with tests; the flag list was identical after re-measuring), then `pnpm gate` exit 0.
  - Unit tests: core 79, cdk 49, corpus 102, rag 509, web 530, api 175 (**1,444**).
  - e2e 112 passed, 4 skipped.
- **Deployed:** `pnpm deploy:infra` (WorkerStack and ApiStack, 2026-10-03 23:41 UTC) and `pnpm deploy:web` (Amplify job 15), run by Claude at Mike's request. `pnpm e2e:prod` 19/19.

## Spend this phase
- da-v5 live eval: $2.4718.
- Production example runs: $0.129 (failed), $0.1316 and $0.1299.
- Rehearsal of the three PDF questions: $0.4133.
- Cost Explorer queries: about $0.04.

## Next
- Mike's go-ahead to commit and push.
- Check Budget attribution when the billing data arrives.
- After the panel: turn the kill switch off and make the repo private.

# Phase 6r Step 3 Handoff: The Brief and Compare

_Date: 2026-10-03 (local)_

## Why
Steps 1 and 2 made the dashboard and the evidence readable. The brief was still a long scroll with no summary of its findings, and Compare showed bare trajectory words with no direction, size or year. DD-21 (g) asks for "a bottom line and jump bar on the brief, and condensed sections and chips on Compare, with the same rules". The step is web only.

## Completed
1. **Brief bottom line** (`apps/web/src/lib/brief-summary.ts`, `BriefBottomLine` in `analysis-view.tsx`). Mike chose this option from three on 2026-10-03.
   - **Headlines:** one line per key finding, with its stored title linking to the finding (`#finding-N`).
   - **Chips:**
     - basis: Reported or Analysis;
     - companies, shown when the brief covers more than one;
     - the validator's figure check: "All N figures found in their cited passages", "N unverified figures", or "N figures: unit not stated";
     - "No valid citation" for a finding left without one.
   - **No direction colours.** A brief stores no direction for a finding, and inferring one from the model's wording would be a judgment.
   - **Status line:** counts of key findings, passages cited, figures found, and evidence gaps.
2. **Jump bar, shared** (`components/diligence/jump-bar.tsx`, moved out of the dashboard).
   - **Brief links:** Summary, Bottom line, Key findings, Comparison/Trend, Considerations, Evidence coverage, Evidence gaps, Follow-up questions and Sources. Each appears only when the brief shows that section, with counts on the lists.
   - **Section in view:** the lowest heading at or above the line wins; on equal tops, the earlier one wins.
   - **After a jump:** the target stays marked until the reader scrolls, and keyboard focus moves to its heading.
   - **Sticky rail:** a heading in a sticky box (the Sources rail on a wide screen) is not tracked, and jumping to it only focuses it.
   - **Other changes:** not printed, and an empty Follow-up questions section is hidden.
3. **Compare chips and folding** (`compare-view.tsx`).
   - **Trend cells:** the builder's label on a direction chip, with its change and year ("Growing, +6.4% in FY2025"), through `trendRead`.
     - The dashboard's rules apply: green and red only for metrics where more is better, and a Financials company's operating cash flow stays uncoloured.
     - A trend about an older year than the latest annual report shows the plain label plus "latest trend FY2022" (PFE operating cash flow).
     - A trend whose basis does not read back gets the plain label only.
   - **Legend:** under the table.
   - **Diverging trends:** one chip per company, under the same rules.
   - **Folding:** common and distinctive areas show 4, the ranking 5, and Ask next 3, each with "Show all N". Management emphasis is clamped to 3 lines.
   - **Clamp threshold:** 140 characters for two lines, 210 for three.
4. **Fix found in passing.** The shared `Table` wrapper is now `relative`. Before, an sr-only "Actions" header escaped the scroll box and made the brief and Compare scroll sideways on a phone.

## Verified
- **`pnpm gate` (2026-10-03): exit 0.**
  - check-docs OK; lint and typecheck clean.
  - Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 413, web 377, api 135 (**1,148**).
  - `cdk:synth` and `build` OK. **e2e: 79 passed, 4 skipped** (the `DARK_SCREENSHOTS`-only screenshot tests).
- **Unit tests:**
  - `brief-summary.test.ts`: tallies, including the `keyFindings[1]` vs `[10]` prefix case; chip wording; status line; DD-16 vocabulary.
  - `readable-brief-compare.test.tsx`: bottom-line links and targets; jump links only for shown sections; Compare chip equals `rowChange` for every built test profile; a stale-period case; Financials neutral, including in Diverging; Show all and Clamp.
  - `jump-bar.test.tsx`: tie-breaking, holding the target after a jump, sticky headings, focus, and the phone menu.
- **e2e** (`tests/e2e/built/readable-brief-compare.spec.ts`):
  - brief bottom line → finding lands below the sticky bars;
  - Evidence coverage, Evidence gaps, Follow-up questions and Sources jumps;
  - warning, neutral and "No valid citation" badges under axe, via `page.route` on the seeded analysis;
  - Compare chips scoped to the table, and Show all moving focus;
  - axe clean in light and dark, folded and expanded;
  - no sideways scroll at 390 px on the brief and Compare;
  - reads only plus `POST /api/session`.
- **Manual browser check** on the local server over the real `llm-v3` set:
  - Compare `AAPL,JPM,NVDA`, `AAPL,MSFT,GS` and `AAPL,CSCO,GS` (GS operating cash flow neutral; Apple rising and Cisco falling in Diverging);
  - the seeded briefs in light, dark and at phone width.

## Gate record
- **Adversary:** 1 blocker, 1 high, 5 medium, 7 low.
  - B1: the novice-path e2e locator also matched the jump bar's "Key findings" link.
  - H1: the coverage jump landed under the sticky bars.
  - M1: the side-by-side Evidence gaps section was never marked as in view.
  - M2: Sources had no jump link.
  - M3: stale-year trends were coloured.
  - M4: the e2e chip check was satisfied by the legend.
  - M5: axe never saw the warning badges.
- **Fresh fixer:** fixed all of them with regression tests.
- **`/code-review` (medium):** 1 confirmed finding. On a wide screen the Sources jump scrolled to an arbitrary point and stayed marked. Fixed (focus only, no hold) with a unit test, and re-checked in the browser.
- **`pnpm gate`:** green.

## SPEC §48.2 (adversary, step 3)
- **Says what matters:** yes. The brief's six headlines with figure checks, and Compare's diverging chips.
- **No SEC knowledge needed:** mostly. "Reported" vs "Analysis", "pp" and "Not extracted" are still unexplained to a novice.
- **Evidence-backed:** chips come from the builder's basis lines, and figure chips from the validator's records.
- **Nothing generated:** confirmed. No model call and no new stored text.
- **Compare adds insight:** yes, more than before.

## Known limits
- "Reported" and "Analysis" carry no explanation on the brief.
- Profile citations still carry no subsection (step 2's M3).
- Not tested manually on real Safari or Firefox.

## Not deployed yet
Next, each with Mike's go-ahead:
1. Commit on `phase-6r-step3`.
2. Fast-forward `main`.
3. `pnpm deploy:web`.

It is web only: no api, CDK, profile or S3 change. After the deploy, check production: a seeded brief's bottom line and jumps, Compare `AAPL,MSFT,NVDA`, light and dark, phone width, and that the pages send only reads and `POST /api/session`.

## Next
Phase 6r step 4 (SPEC A.4 2026-10-03): the refined Compare and Findings from the chosen mockups. Write DD-21 (h) first. Then Phase 7.

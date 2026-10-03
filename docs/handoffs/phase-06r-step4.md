# Phase 6r Step 4 Handoff: Refined Compare and Findings

_Date: 2026-10-03 (local)_

## Why
Mike reviewed the readability v2 mockups on 2026-10-03 and chose `Compare - refined` and `Findings - refined` (SPEC A.4, 2026-10-03; implementation-plan row 6r). He also confirmed Ask follow-up (prefill only, `finding` origin). Compare still made the reader assemble the comparison from three separate lists. Findings was a wall of full cards under a six-field filter grid. DD-21 (h), written before the build and updated after the review, holds the rules. The step is web only.

## Completed
1. **Compare bottom line** (`apps/web/src/lib/compare-summary.ts`). At most five fixed-rule lines over the stored profiles: revenue, operating margin, operating cash flow, shared risk areas, and areas found at only one company.
   - A company counts for a metric only when its trend passes step 3's `trendRead`: it reads back, it is current, and it has a labelled change. Otherwise the line names it as not compared, with the reason (latest trend FY2022, not extracted, limited history, preview profile, no labelled change).
   - **Line types:**
     - every company in one direction (coloured; names the largest change, and "slowing from … in FY2024" when that company is slowing);
     - one company differs (it leads, uncoloured);
     - mixed (a distinct ↔ "directions differ" chip).
   - Operating losses get loss wording ("operating loss narrowed"); a loss is never described as a margin that widened.
   - The footer names the metrics that point in opposite directions, using the lines' own groups (slowing counts as rising). A legend shows only the symbols used.
2. **Side by side.**
   - **Column headers** carry the coverage tier and fiscal year end; these replace the former rows, so nothing is dropped.
   - **Each cell:** the step 3 chip, the latest value (a margin's level, or the dollar amount from the trend's own row), the change in its period, the prior year when it explains the label ("after +125.9% in FY2024"), and a sparkline of the comparable series.
   - **Diverging trends** is shown when core reports any.
3. **Risk-area grid.** It replaces the common, distinctive and ranking lists.
   - One row per area, in ranking order, showing its rank, the ranking rule and "not a rating".
   - A badge says how many companies share the area, and every row has Save.
   - Cells are tinted by heading count (token tints, with the count also printed). Each cell opens a named popover with that company's verbatim headings, its signal headlines and the citations.
   - Rows fold after five; folded rows stay in the DOM, and focus moves to the first one revealed.
4. **Ask next** (renamed from "Recommended comparative diligence") and **Management emphasis** (three columns on a wide screen) are otherwise unchanged. A jump bar covers the whole page.
5. **Findings** (`findings-view.tsx`, `finding-row.tsx`, `lib/findings-summary.ts`, `lib/findings-filter.ts`):
   - **Summary strip:** a tile per status with its count, and a bar per theme. Each is a toggle filter (`aria-pressed`). The counts cover the whole board, not the filtered view.
   - **One filter row:** search (title, text, note, ticker or company name; every word must match), Company, Status, Origin, and More filters (Theme, Analysis, dates).
   - **View switch:** Theme, Company, Status, Origin, or Board.
   - **Compact cards:**
     - text clamped to two lines, with figure warnings kept outside the clamp;
     - "Your note";
     - a source count: one source opens its passage; several unfold citation chips, each opening its passage with its verified figures, plus "View all side by side";
     - an inline theme select, origin, saved date and "from" link;
     - a status chip menu;
     - Note, Ask follow-up and Delete.
   - **Board view:** three status columns holding the same cards. A note draft survives the card moving between columns.
   - **Ask follow-up:** `/analysis/new/?q=<fixed template>&tickers=…&origin=finding:<id>`. It never runs on its own.
6. **Test profiles:** `pnpm fixtures:test-profiles` now copies MSFT, NVDA and PFE verbatim as well (`tests/fixtures/built-profile-sets/…/llm-v3/`).
7. **Small shared changes:**
   - `NativeSelect`'s chevron is the `select-chevron` utility in a theme token, so it follows dark mode and survives class merging.
   - `TBody` takes a ref.
   - `Sparkline` takes a width.
   - `latestAmount` is exported.
   - The evidence panel's by-filing view carries the verified figures for each passage.

## Verified
- **`pnpm gate` (2026-10-03): exit 0.**
  - check-docs OK; lint and typecheck clean.
  - Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 413, web 432, api 135 (**1,203**).
  - `cdk:synth` and `build` OK.
  - **e2e: 88 passed, 4 skipped** (the `DARK_SCREENSHOTS`-only tests).
- **Unit tests:**
  - `compare-summary.test.ts`: every line type on the real profiles and on synthetic basis lines (loss margins, ties, all falling, all flat, mixed), colours, not-compared reasons, footer and legend, DD-16 vocabulary. Every figure must be one of the builder's.
  - `findings-summary.test.ts`: summary counts, search, Board columns, the template and its length limit.
  - `refined-findings.test.tsx`: every control is one click away in list and Board; sources; filters; unique IDs when grouped by company; a note draft surviving a move.
- **e2e** (`tests/e2e/built/refined-compare-findings.spec.ts`):
  - Compare AAPL, MSFT, NVDA and Findings, both axe clean in light and dark, folded and expanded, with the popover and drawer open;
  - a Board status move;
  - Ask follow-up prefills without running (enqueued count unchanged, no `POST /api/analyses`);
  - the PFE stale period;
  - 390 px with no sideways scroll;
  - reads only plus `POST /api/session`.
- **Manual check** on the local server over the real `llm-v3` set, at 1280 px in light and dark: the Compare and Findings pages, and Board.

## Gate record
- **Adversary:** 0 blockers, 3 high, 7 medium, 11 low.
  - H1: the footer said "no opposite directions" under a line where Apple's cash fell while the others grew.
  - H2: lines where one company differed were coloured, against DD-21 (h).
  - H3: Intel's operating loss was described as a margin that "widened".
  - The mediums were the wording of slowing companies, the mixed chip, missing rule tests, citations needing two clicks, and aria-labels on spans.
  - It swept every 2- and 3-company combination of the 53 profiles.
- **Fresh fixer:** fixed all 21, each with a regression test.
- **`/code-review` (medium):** 2 findings, both fixed with tests.
  - Duplicate card IDs when grouped by company: the repeated copies' selects had no name.
  - A note draft was lost when a Board status change moved its card.
- **`pnpm gate`:** green.

## SPEC §48.2 (adversary)
- **Value before a question:** yes.
- **Says what matters:** yes, after the H1 fix, for the bottom line, the grid and the summary strip.
- **Evidence-backed:** every figure is the builder's, and grid cells open verbatim headings and citations.
- **Nothing generated:** confirmed.
- **Compare adds insight:** yes, clearer than three lists.
- **Without SEC knowledge:** "pp", "Origin" and fiscal years ending in different months still need the legend.

## Known limits
- Names are the full legal names ("NVIDIA Corporation’s …"), so five-company lines are long.
- Ask follow-up is a generic template over the title.
- Not checked with a real screen reader, or on Safari or Firefox.

## Deployed
2026-10-03, with Mike's go-ahead: commit `feef6ff`, a fast-forward of `main`, then `pnpm deploy:web` (Amplify job 11). The production check passed:
- Compare AAPL,MSFT,NVDA: the bottom line and its footer, and a grid popover;
- Findings: the summary strip, search, Board, and Ask follow-up prefill;
- light and dark, and 390 px;
- only reads and `POST /api/session` were sent.

Details are in STATE.md.

## Next
Phase 7. The Deep Analysis and brief mockups were not chosen; ask Mike before building them.

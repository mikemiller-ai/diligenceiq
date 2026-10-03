# Phase 6r Step 1 Handoff: Readable Company Intelligence Dashboard, and Dark Mode

_Date: 2026-10-02 (local)_

## Why
After Phase 6 the dashboard was correct but hard to read or demo. The Apple page was a 10,545 px scroll (at 1280×800) of long paragraphs, 10 signal cards, 28 risk headings and 6 recommendations. Mike reviewed four directions on 2026-10-02 and chose to keep the current depth and add signals:
- a bottom line up front (BLUF);
- direction chips, sparklines and conditional formatting;
- condensed sections;
- a jump bar.

The direction came from the Claude Design file "Company Intelligence - current", with its "refined" jump bar. The plan is recorded in DD-21, SPEC §49 row 6r and A.4 (commit `6cee6eb`). Mike also asked for dark mode like his other products and chose to ship it with this step.

## Completed
1. **Bottom line, lead lines and chips** (`apps/web/src/components/intelligence/signals.tsx`):
   - Fixed rules over the stored profile. Every label, direction and colour is the builder's own: the trend trajectory, the numbers of its `basis` line (read back by the new core `parseTrendBasis`, pinned by contract tests in `packages/rag`), the signal type and measurement, and the driver `changeBasis` (`parseDriverChangeBasis`).
   - Facts supply only numbers from the same source row as the trend: sparklines, the latest dollar amount, and the exact value behind a rounded figure at a threshold.
   - Loss wording for loss-making companies. Every line names its period, and older-year lines are dropped.
   - The risk line says "N risk areas in every annual report", never "unchanged", while the new and expanded detectors are off.
2. **Dashboard** (`dashboard.tsx`):
   - Bottom line box with a complete legend and screen-reader words.
   - Coloured top edges and chips on the 30-second view, each with a bold lead line.
   - Performance table: Trend chips, a "vs prior year" column, an "Over time" sparkline column, margin values with their formula, and a new Net margin row.
   - Drivers: share bars and change chips. The section and its jump link are hidden for built profiles without drivers.
   - Current risks: area chips. Persistent signals fold into one row.
   - Signal chips come from type and trajectory, never from headline text.
3. **Progressive disclosure** (`condense.tsx`):
   - "Show all N": folded items stay in the DOM with `hidden`, and focus moves to the first revealed item.
   - Two-line clamps with distinct, `aria-controls`-linked More/Less buttons. Citation chips sit outside the clamp.
4. **Jump bar:**
   - Sticky "On this page" bar with counts and `aria-current="location"`.
   - Links only to the sections the profile shows; shareable `#section` URLs; headings land below both bars.
   - On phones, a "Jump to section" menu that also works when you pick the same section twice.
5. **Glossary terms** (`term.tsx`): definitions on hover and focus for the table metrics, net margin, annual and quarterly report, and pp. All pass the vocabulary check.
6. **Dark mode** (the CareerOps pattern):
   - A System / Light / Dark toggle (`components/ui/theme-toggle.tsx`) in the top bar and the landing and Architecture headers.
   - A pre-paint script (`lib/theme-script.ts`, one string; the Phase 7 CSP must allow it by hash, architecture §11).
   - Every colour is a `light-dark()` token. Ink tokens (`--ok-ink`, `--risk-med-ink`, `--destructive-ink`) for chip text.
   - Navy panels unchanged in both modes, with a hairline edge in dark. Documented in `docs/design-tokens.md` and SPEC A.4.
7. **Test data:**
   - Real built profiles (AAPL, TSLA, JPM from `llm-v3`, byte-for-byte) via `pnpm fixtures:test-profiles` into `tests/fixtures/built-profile-sets/` (a separate root from `profile-sets`).
   - A second Playwright project, `built-profiles`, serves them.
8. **Lint config:** `eslint.config.mjs` ignores `.claude/worktrees/**`.

## Verified
- **`pnpm gate` (2026-10-02): exit 0.**
  - check-docs OK; lint and typecheck clean.
  - Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 413, web 275, api 135 (**1,046**).
  - `cdk:synth` and `build` OK; **e2e 64 passed**, including the dark-mode axe suite and the built-profile suite with dark-mode axe on AAPL and TSLA.
- **Page agreement:** across all 53 companies in `llm-v3` and in `det-v2`, the bottom-line revenue direction agrees with the 30-second Performance card and the Revenue trend (0 disagreements, down from 34 of 51 in the first prototype). This is a unit test whenever `.index/` is present. No NaN, signed zeros or period-less lines.
- **Height at 1280×800,** measured headlessly against `main` with the same `llm-v3` data. These are prototype measurements, before the fixer added the Net margin row and legend.

  | Company | Phase 6 | Now | Ratio |
  |---|---|---|---|
  | AAPL | 10,545 px | 5,627 px | 0.53 |
  | NVDA | 11,666 px | 5,743 px | 0.49 |
  | MSFT | 8,905 px | 4,401 px | 0.49 |
  | TSLA | 8,843 px | 4,736 px | 0.54 |
  | JPM | 7,070 px | 4,154 px | 0.59 |
  | KO | 3,996 px | 3,494 px | 0.87 |

## Gate record
- **Adversary:**
  - 2 blockers: typecheck; flaky axe on the active jump link.
  - 7 high: chip contrast; revenue titles contradicting the builder's labels on 34/51 companies; profit wording for loss makers; stale periods; "unchanged" resting on suppressed detectors; lost fixture-figure coverage; chip colours read from model text.
  - 9 medium, plus low items.
- **Fresh fixer:** fixed all of them, with tests.
- **Dark mode:** built in a separate worktree (background agent) and merged into this branch; one CSS block was merged by hand.
- **`/code-review`** (medium): no findings.
- **`pnpm gate`:** green.

## SPEC §48.2 (adversary, step 1)
- Value before a question: yes. The bottom line and lead lines give the numbers immediately.
- No SEC knowledge needed: mostly. Terms carry definitions.
- Nothing is generated on page view.
- Deep Analysis is unchanged.
- A novice gets how Apple is doing and what changed in about 20 seconds. The "why" stays in the clamped "Why this matters" text, and Recommended diligence is one jump away.

## Known limits
- The model-written headline can still describe revenue differently from the builder's label (for example AAPL: "faster than the year before" vs Growing). It is stored model text; changing it needs a profile rebuild.
- Financials-sector operating cash flow is neutral for every Financials company (V, MA, AXP and BLK too), since profiles carry no industry field.
- `light-dark()` needs Safari 17.5+ or Firefox 120+. There was no manual pass on real Safari or Firefox, or at phone width in dark mode.
- Compare, Findings, `/analysis/new` and Architecture inherit the tokens but were not axe-checked in dark.

## Not deployed yet
Next, with Mike's go-ahead:
1. Commit.
2. Merge to `main`.
3. `pnpm deploy:web`. Web only: no api, CDK, profile or S3 change.
4. Production check: AAPL, TSLA and JPM dashboards in light and dark mode, the jump bar, Show all, and no model call.

## Next
Phase 6r step 2: readable filing text and evidence (DD-21 e–f). Then step 3: the brief and Compare.

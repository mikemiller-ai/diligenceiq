# Phase 6r Step 2 Handoff: Readable Evidence

_Date: 2026-10-03 (local)_

## Why
After step 1 the dashboard was readable, but its evidence was not. Filing text appeared as processed: headings, paragraphs, page footers ("Apple Inc. | 2025 Form 10-K | 6") and `|` table rows ran together into a blob. The drawer showed a whole passage without saying which part supports the claim. Compare periods put two blobs side by side.

DD-21 (e)–(f) and implementation-plan row 6r define this step. It is web only.

## Completed
1. **Display layer that preserves offsets** (`apps/web/src/lib/readable/layout.ts`, `furniture.ts`; rendered by `components/evidence/readable-text.tsx`).
   - A range of processed text is split into headings, paragraphs, lists and tables. Every offset falls in exactly one run, and a run is either shown or hidden.
   - Only two kinds of run are hidden:
     - **furniture**: running footers and headers, page numbers, and "Table of Contents" back-links;
     - **layout**: table pipes, empty cells, line breaks and whitespace at the edges of a block.
   - Stored text, chunk offsets and citations are unchanged.
   - It reuses the corpus's own segmenters and risk headings through browser-safe subpath exports: `@diligenceiq/corpus/segments` and `/risks`. The new `riskHeadingSpans` has the same output as before; `extractRiskHeadings` now delegates to it.
   - **Furniture strength.** Strong shapes are hidden anywhere. Weak shapes are hidden only when they repeat at least 3 times in the filing. A table-of-contents line stays visible.
   - **Tables.**
     - Each value sits in the column of its raw `|` index, with one "$" reading per table, so a row with empty cells never shifts.
     - A header row renders as `<thead>` with `th scope="col"`.
     - Only a table that actually overflows becomes a focusable scroll box.
   - **A citation is never invisible.** A cited span that is only furniture (a few indexed chunks are just a page number) shows that furniture.
2. **The drawer leads with the support** (`lib/readable/support.ts`, `components/evidence/passage.tsx`, `diligence/evidence.tsx`).
   - Each chip passes its statement to the drawer:
     - a brief's inline chip: its sentence;
     - other items: their own text;
     - a metric value: "Metric, period: value";
     - a signal: "what changed".
   - **Closest sentences.**
     - The drawer shows the one to three sentences closest to the statement, highlighted in place, with "Show full passage" one click away.
     - A sentence qualifies only if it prints one of the statement's figures, or shares at least 3 words with the statement, at least one of them specific.
     - The label says it is word and figure overlap, not proof. When nothing qualifies, the drawer says so and shows the whole passage.
   - **Bold figures.**
     - A brief passage bolds only the figures its validator verified in that chunk, or nothing.
     - Elsewhere, only exact printed matches are bold, under the validator's rules, never by rounding.
     - A metric value bolds only its own cell.
   - **Title:** the citation's section › subsection, never its chunk ID.
3. **Compare periods: sentence diff** (`lib/readable/diff.ts`).
   - It compares this passage with the most similar adjacent passage (the adjacency contract lists it first), later filing against earlier.
   - It shows new sentences, removed ones, and unchanged ones (collapsed). A sentence where only the numbers changed shows "Was: …".
   - Only the stretch both passages share is classified; sentences outside it are counted, never called new or removed.
   - The diff leads the tab panel, above the two passages.
4. **Tokens.** `--key-highlight`, `--diff-added` and `--diff-removed` are `light-dark()` grounds. Contrast is tested in both modes, and they are documented in `docs/design-tokens.md`.

## Verified
- **`pnpm gate` (2026-10-03): exit 0.**
  - check-docs OK; lint and typecheck clean.
  - Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 413, web 340, api 135 (**1,111**).
  - `cdk:synth` and `build` OK. **e2e: 69 passed, 4 skipped** (the `DARK_SCREENSHOTS`-only screenshot tests).
- **Corpus proof** (`readable-corpus.test.ts`, all 246 filings, about 25 s):
  - every filing is partitioned exactly;
  - the only hidden runs are pipes and whitespace, or furniture of at most 140 characters each and under 5% per filing;
  - the shown text contains **zero** page-number back-links or "Form 10-K | N" / "FORM 10-K N" footers (an oracle separate from the layout code);
  - every table value equals a plain split of its source line at its raw index and sits in its column;
  - every chunk's highlight is exactly its own shown characters.
- **Rendered checks** (`evidence-readable.test.tsx`):
  - real AAPL, MSFT, GS and TGT filings, with every chunk's `<mark>` text compared;
  - sampled targets in AAPL, GS, NKE, DE and BA through the source view's sections: the id appears exactly once, on the first piece;
  - BA's 345 renders under 2025 and 58 under 2024.
- **e2e** (`readable-evidence.spec.ts`; the evidence and dark-mode specs extended):
  - a risk citation opens on its closest sentences, and Show full passage works;
  - the diff headings and the collapsed unchanged list;
  - the source view shows risk headings and tables, with no footers;
  - at phone width there is no sideways page scroll, and only overflowing tables take focus;
  - axe WCAG 2.1 A/AA is clean in light and dark (the OS setting and the stored choice);
  - every page sends reads only, plus `POST /api/session`.

## Gate record
- **Adversary:** 0 blockers, 6 high, 4 medium, plus low items.
  - H1: table values shifted into the wrong year.
  - H2: about 1,300 page breaks still visible.
  - H3: figures bolded by rounding, and a loose fallback for briefs.
  - H4: "why this supports it" overclaimed.
  - H5: about 20% false new or removed sentences in the diff.
  - H6: the corpus proof was circular.
  - M1: table-of-contents item numbers hidden.
  - M2: the raw row or jargon shown as the statement.
  - M3: no subsection on profile citations.
  - M4: a tab stop on every table.
- **Fresh fixer:** fixed all of them with regression tests, except M3 (see Known limits). The fixer's check (d) also found and fixed a real bug: the target id could be lost on a table re-render or duplicated across sections.
- **`/code-review`** (medium) found 2 low issues, both fixed with tests:
  - a metric with an unchanged year bolded both cells;
  - the split page-break rule could hide a reference number ("Note 12", "Rule 12b-2").
- **`pnpm gate`:** green.

## SPEC §48.2 (adversary, step 2)
- **Value before a question:** yes. The source view reads as a document.
- **No SEC knowledge needed:** better. The drawer statement is plain ("Cash and liquidity, FY2021: $17.6B"), with no raw row or detector jargon. SEC section names stay in evidence views, by design.
- **Compare adds insight:** yes. On real data, Apple's FY2025 Risk Factors introduction shows 6 new, 6 removed and 12 unchanged sentences against FY2024.
- **Nothing generated:** confirmed. No model call and no new stored text.
- **Deep Analysis:** unchanged.

## Known limits
- **M3:** profile citations carry no subsection (0 of 1,573 in `llm-v3`), so their drawer titles show only the section. Fixing it needs a profile-builder or api change and a new profile-set version; it is out of scope for a web-only step.
- **Key sentences match surface words,** through a fixed finance lexicon. A closely worded sentence about another segment can qualify.
- **The diff compares one passage pair,** not whole sections. Changes outside the shared stretch are counted, not classified.
- **Headings are heuristic.** A few false title headings appear over the corpus ("San Jose, California").
- **Not tested manually** on real Safari or Firefox.

## Not deployed yet
Next, with Mike's go-ahead:
1. Commit.
2. Merge to `main`.
3. `pnpm deploy:web`.

This is web only: no api, CDK, profile or S3 change. The api bundle includes the corpus package, but the chunker and risk extraction behave identically, so no api deploy is needed.

After deploy, check production: the AAPL source view (tables, no footers), a dashboard citation's closest sentences, and the Compare periods diff, in light and dark mode.

## Next
Phase 6r step 3: the brief and Compare (DD-21 g). Then Phase 7.

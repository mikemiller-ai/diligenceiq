# Phase 0b Handoff: Product Re-baseline (Investment Intelligence) and SPEC v2

_Date: 2026-10-01 (local)_

## Why
Mike supplied a revised product direction. DiligenceIQ moves from a question-first RAG workspace to an **investment-intelligence** product. Users pick a company and immediately see:
- how it is performing;
- what changed;
- what deserves attention, and why;
- what to investigate next.

Deep Analysis (the existing one-call RAG pipeline) becomes the drill-down. The technical architecture is unchanged.

## Completed
1. Saved the product direction verbatim. Two pasted halves were rejoined, and markdown formatting was restored in §23–36 only. The file is now archived at `docs/archive/PRODUCT_DIRECTION.md`.
2. Re-baselined the design docs:
   - **DD-15:** IA pivot. Navigation is Company Intelligence, Compare, Deep Analysis, Findings, plus "Ask a question". Thesis and Watchlist are P1. Workstreams become finding themes.
   - **DD-16:** Company Intelligence profiles. They combine deterministic facts and signals with one offline, admin-run call per company per version, as a dated, bounded override of three cost-addendum lines. Supporting controls:
     - a build ledger;
     - a phrase-level banned-vocabulary list;
     - a zero-call deterministic set, selected through an SSM pointer.
   - **DD-17:** Deterministic financial extraction.
   - **DD-18:** Deterministic change detection, with a Phase 3 go/no-go.
   - **DD-19:** Compare, Thesis, Watchlist and Diligence Gaps are deterministic. Live monitoring is future state.
   - `architecture.md` gained §4.4 (offline build), §7.1 (profile schema), §9.1 (error states), and updates to the data model, API, routes, IAM and cost sections.
   - `assumptions.md` gained A6 (interpretation), E6 (novice test), F4 (ask Eliza) and section G (coverage tiers).
   - `testing-strategy.md` and `design-tokens.md` were updated to match.
   - `implementation-plan.md` is now Revision 2. It covers what stays, what changes, P0/P1/P2, the scope fallback, phases 0b–9 (adding 4b and 8b), and a requirement-preservation checklist.
3. **Consolidated SPEC v2** into `SPEC.md` (2,293 lines). It is the sole canonical spec. Appendix A lists every change from v1, the addendum and the product direction; Appendix B maps their sections. SPEC v1 and the cost addendum are archived byte-identical except for a one-line archive header.
4. `CLAUDE.md`, `README.md` and `scripts/check-docs.mjs` were updated. check-docs now locks in the key Phase 0b fixes and the phase order.

## Gate record
1. **Adversary,** run against the PDF, SPEC v1, the cost addendum and the product direction. It found 2 blockers, 6 high, 12 medium and 12 low issues. The main ones:
   - the profile call conflicts with the addendum;
   - Phase 1 sample data would show invented figures;
   - P1 work was sequenced before P0 evaluation and deploy;
   - 41 of 54 dashboards would have been nearly empty.
2. **Fresh fixer agent:** fixed all of them and added check-docs regression checks, verified to fail when broken.
3. **`/code-review` (medium):** 2 findings, both fixed.
   - The profile ledger made failures unretryable, and the only recovery was a fake prompt-version bump. Now a failure falls back to deterministic and is never retried at that version.
   - The production smoke test covered the P1 `/sources` explorer. It now covers `/sources/filing` through a citation.
4. **`pnpm gate`:** exit 0. check-docs passed (13 files) and 120 tests passed (core 12, cdk 35, api 23, web 50). The tests cover the uncommitted Phase 1 working tree.

## Files
- **New:** `SPEC.md` (v2), `docs/archive/{SPEC-v1,SPEC-ADDENDUM-COST,PRODUCT_DIRECTION}.md`, `docs/handoffs/phase-00b.md`.
- **Modified:** `CLAUDE.md`, `README.md`, `STATE.md`, `docs/{architecture,assumptions,design-decisions,design-tokens,implementation-plan,testing-strategy}.md`, `scripts/check-docs.mjs`.
- **Not in this commit:** the uncommitted Phase 1 code (`apps/`, `packages/`, `services/`, `infrastructure/`, `package.json`, pnpm and tooling files).

## Deployment status
Nothing is deployed. No AWS calls were made.

## Unresolved / pending with Mike
- Ask Eliza about the offline profile generation (assumptions F4) before Phase 4b.
- Lambda concurrency quota increase (recommended), and Sonnet 5.5 quota (optional).

## Known limitations
- SPEC v2 came out longer than targeted (2,293 lines). It merges about 3,350 source lines, and nothing was dropped silently.
- `design-tokens.md` describes the Phase 1 design system, whose code is not committed yet.

## Next-phase objective (Phase 1 rework)
- Rework the uncommitted shell to the SPEC v2 navigation, P0 routes only.
- Add the profile schema to `packages/core`, and implement the fixture rule and the prefill-never-submits rule.
- Exit: run the full gate, deploy to `diligenceiq.mikemiller.ai`, verify Set-Cookie forwarding (D9), then commit.

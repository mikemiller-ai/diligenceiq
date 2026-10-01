# Phase 1 Handoff: Application Shell on the SPEC v2 IA

_Date: 2026-10-01 (local)_

## Why
The uncommitted Phase 1 shell still had the SPEC v1 navigation (Overview, Diligence, IC Brief, Sources). It was reworked in place to the SPEC v2 investment-intelligence IA (DD-15), and the Phase 1 exit criteria were met.

## Completed
1. **Core (`packages/core`):**
   - `themes.ts` replaces workstreams.
   - `domain.ts` adds:
     - the `AnalysisOrigin`, `FindingSource` and `FindingOrigin` unions;
     - `findingOriginKind`;
     - `encodeOrigin` and `parseOrigin`, so `?origin=` round-trips and anything malformed becomes `direct`.
   - Findings gain `theme` and `origin`, and `CreateAnalysisRequest` has `origin` in place of `workstreamId`.
   - `intelligence.ts`:
     - `CompanyIntelligenceProfileSchema`, following architecture §7.1 plus two additions recorded there: `fiscalYearEnd` and `recommendedDiligence[].citationIds`;
     - `coverageTier` (12/5/37);
     - `classifyRiskHeading`;
     - `profileIntegrityIssues`;
     - `isFixtureProfile`.
   - `compare.ts` adds a deterministic `composeCompare` (DD-19).
   - The workstream-progress and IC Brief assembly code was removed; IC Brief is P1.
2. **Web (`apps/web`):**
   - Navigation is Company Intelligence | Compare | Deep Analysis | Findings, plus a global "Ask a question".
   - Routes: `/`, `/intelligence` (selector and `?ticker=` dashboard), `/compare`, `/analysis/new`, `/analysis`, `/findings`, `/architecture`, `/sources/filing`.
   - No P1 stubs.
   - The UI kit and evidence components are kept. The evidence drawer labels where each citation came from, and gains an evidence-by-period panel.
3. **Fixture profiles (AAPL, MSFT, NVDA):**
   - Each holds a **selection** of verbatim latest-10-K risk headings, each an exact corpus slice and cited.
   - Everything else is a deterministic template or a labeled placeholder ("Placeholder, not filing data"). There are no figures.
   - Compare shows placeholders for any conclusion that needs the complete heading list (SPEC §8.6, as amended this phase).
4. **No hand-written answers ship.** The sample brief is test-only, the workspace starts empty, and a test forbids app imports from `src/test/`.
5. **Deep Analysis prefill never auto-submits:**
   - The form is keyed on the query string, so "Ask a question" from a prefilled page resets it.
   - The origin is sent as provenance only.
6. **API:** `origin` replaces `workstreamId`. `/api/health` reports `profileSetId: null` and `profileIndexVersion: null`.
7. **Tests:**
   - the rendered fixture-figure test, block-level, with a check of the check;
   - fixture integrity and exact-slice tests;
   - Compare, origin and Save Finding tests;
   - Playwright `tests/e2e/local`: prefill sends no POST, Run sends exactly one, no API call on page view, axe scans, keyboard checks, error states, Findings filters, Reset.
   - `pnpm gate` now ends with `pnpm e2e`. SPEC §48.4, CLAUDE.md and testing-strategy were updated to match.

## Gate record
1. **Adversary, with the SPEC §48.2 questions:**
   - Blocker: the hand-picked headings let Compare state false common and distinctive conclusions.
   - High:
     - stale prefill after "Ask a question";
     - a weak figure check;
     - a false "supplied to the model" label on profile evidence.
   - Medium: /architecture claimed unbuilt mechanisms; Compare logic; Save Finding gaps; E2E gaps; stale docs.
   - Lows: the classifier; GE (G2); test-only passages in the app; and smaller items.
2. **Fresh fixer:** fixed all of them, each with a regression test. 13 fixes were reverted one at a time to confirm their tests fail.
3. **`/code-review` (medium):** 0 findings.
4. **`pnpm gate`:** exit 0.
   - check-docs OK (13 files).
   - Unit tests: core 30, cdk 35, api 23, web 89.
   - cdk:synth and build succeeded.
   - e2e: 31 passed.

## Deployment
- `pnpm deploy:infra`: only the api Lambda code changed; Core and Web had no changes.
- `pnpm deploy:web`: Amplify job 1 succeeded.
- Live at https://diligenceiq.mikemiller.ai. Every P0 route returns 200, and the dashboard renders with no console errors.
- **D9 verified:** `GET /api/diagnostics/cookie` sets `diq_probe` (HttpOnly, Secure, SameSite=Lax, Path=/api), and the second call reports `received: true`. Checked with curl and in a real browser (assumptions D9).

## Known limitations
- Three companies have preview profiles. The others show the PROFILE_MISSING state, which offers Deep Analysis.
- Deep Analysis answers `ANALYSES_DISABLED` until Phases 2–4.
- `/analysis?id=` always shows "not found" on the live shell.
- The testing-strategy Compare E2E for TSLA + JPM needs real profiles (Phase 5).
- §48.2 answers are honest: there is little value before a question until extraction (Phase 2) and signals (Phase 3) land.

## Next-phase objective (Phase 2)
- Verify the Bedrock invoke entitlement first.
- Corpus ingestion:
  - headers, periods and sections;
  - chunking;
  - cached, resumable Titan v2 embeddings;
  - the S3 index, the adjacency file and the index summary.
- Time-boxed: deterministic financial extraction and risk headings, which also replace the selected fixture headings.

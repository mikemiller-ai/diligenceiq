#!/usr/bin/env node
// Phase 0 gate: SPEC v2, the archived sources and the design docs exist and contain their mandatory sections.
// Later phases extend `pnpm gate` with lint, typecheck, test, cdk:synth and build.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const ARCHIVED = '> Archived 2026-10-01. Superseded by the consolidated SPEC.md (v2); kept verbatim for provenance.';

const required = {
  // SPEC v2: the sole canonical specification (Phase 0b consolidation).
  'SPEC.md': [
    '# DiligenceIQ — Specification v2',
    '## 1.2 Precedence',
    '# 2. Non-negotiable requirements',
    '**A prefilled Deep Analysis never auto-submits.**',
    '**One allowed, labeled exception:**',
    '## 6.1 P0 — must be excellent',
    '# 8. Company Intelligence (P0)',
    '# 13. Compare (P0)',
    '# 14. Deep Analysis (P0)',
    '# 16. Evidence and citations (P0)',
    '# 18. Architecture and business-value page (P0)',
    '# 30. Single-call enforcement',
    '# 32. Offline Company Intelligence build',
    '## 32.6 Banned vocabulary (canonical list)',
    '# 35. Cost control and scale-to-near-zero',
    '## 35.7 Named exception: the offline Company Intelligence profile build (DD-16)',
    '"avoid LLM calls merely to populate dashboards;"',
    '"incur meaningful inference cost only when a user actually performs an analysis;"',
    '"RAG generation occurs only in response to user analysis;"',
    '## 35.14 Required documentation: "Cost and Scaling Strategy"',
    '## 38.2 Error and degraded states',
    '# 41. Evaluation',
    '# 48. Mandatory phase quality gate',
    '# 49. Development phases',
    '| 8b (P1) | Gated on the Phase 7 and 8 exit criteria',
    '# 51. Definition of done',
    '## 51.2 Cost',
    '## 51.3 Final product test',
    '## 51.4 Requirement-preservation checklist',
    '# A. Changes from v1',
    // Phase 1 regression (adversary finding 9): the gate includes the local E2E suite.
    'pnpm cdk:synth && pnpm build && pnpm e2e`, plus the docs check',
    // Phase 1 regression (adversary finding 1): fixture headings are a selection.
    'Phase 1 fixture profiles hold a **selection** of verbatim risk headings',
    '# B. Section map',
    // The PDF example questions and the expert question, verbatim.
    '"What are the primary risk factors facing Apple, Tesla, and JPMorgan, and how do they compare?"',
    '"How has NVIDIA\'s revenue and growth outlook changed over the last two years?"',
    '"What regulatory risks do the major pharmaceutical companies face, and how are they addressing them?"',
    "How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?",
  ],
  // Superseded sources, archived verbatim for provenance (Phase 0b).
  'docs/archive/SPEC-v1.md': [ARCHIVED, '# 42. Definition of done'],
  'docs/archive/SPEC-ADDENDUM-COST.md': [ARCHIVED, '## Cost-related Definition of Done'],
  'docs/archive/PRODUCT_DIRECTION.md': [ARCHIVED, '# 28. P0', '# 35. Mandatory Quality Gate'],
  'CLAUDE.md': [
    '## Gate',
    'is the sole canonical implementation specification',
    'SPEC v2 §35.7 (named, bounded exception) and DD-16',
    // Phase 0b regressions: the dated cost-addendum override and its limits (adversary B1, H3).
    '**Cost-addendum override (2026-10-01).**',
    'never on page view, never scheduled, never deployed',
    // H6: prefill never triggers generation.
    '**A prefilled Deep Analysis never auto-submits.**',
    // B2 / L10: fixture rule and the one labeled hand-written exception.
    'Phase 1 fixture profiles carry no figures and no narrative presented as fact',
    '**One allowed, labeled exception:**',
  ],
  'STATE.md': [],
  'README.md': ['[SPEC.md](SPEC.md) (v2) is the sole canonical implementation specification', '(SPEC §35.7)', 'docs/archive/'],
  // Phase 4: the prompt log (SPEC §42) with both prompt sections.
  'docs/prompt-iterations.md': ['## Deep Analysis prompt (`promptVersion`)', '### da-v1 (2026-10-02)', '## Company Intelligence profile prompt (`profilePromptVersion`)'],
  'docs/architecture.md': [
    '## 13. Cost and Scaling Strategy',
    '## 5. Single-call guarantee',
    '## 7. Response schema',
    '## 8. Data model',
    '## 9. API contract',
    '### 4.4 Offline Company Intelligence build',
    '### 7.1 Company Intelligence profile',
    '## 14. Testing',
    // Phase 0b regressions.
    '### 9.1 User-visible error and degraded states', // M11
    '**it never auto-submits**', // H6
    '**Architecture and business value:**', // H1
    '**Phase 1 fixture profiles**', // B2
    'drivers: Array<', // H4
    'currentRisks: Array<', // H4
    'evidenceByPeriod: Array<', // M6
    'investigateQuestion: string', // M6
    'type AnalysisOrigin =', // M5
    'type FindingSource =', // M5
    'GET /api/evidence/adjacent', // M6
    '/diligenceiq/active-profile-set', // H3
    '3–5 10-Ks', // M10
  ],
  'docs/assumptions.md': [
    '### Known corpus anomalies',
    '## G. Company Intelligence',
    '**Interpretation, not a stated fact.**', // H3: A6 relabeled
    '**Ask Eliza before Phase 4b.**', // H3: F4 default (kept as history; settled 2026-10-02)
    '**Settled 2026-10-02:** Mike confirmed the offline profile build is fine',
    '**Phase 3 go/no-go**', // weakest assumption G4
  ],
  'docs/design-decisions.md': [
    'DD-01', 'DD-04', 'DD-15', 'DD-16', 'DD-17', 'DD-18', 'DD-19',
    '**Supersedes / overrides (2026-10-01).**', // B1
    '"avoid LLM calls merely to populate dashboards;"', // B1: quoted verbatim
    '"incur meaningful inference cost only when a user actually performs an analysis;"', // B1
    '"RAG generation occurs only in response to user analysis;"', // B1
    '**Banned vocabulary (canonical list).**', // M2
    '**Build ledger (enforces the one-call bound across processes).**', // M1
    'There is **no `--force`**', // M1
    '**A prefilled Deep Analysis never auto-submits.**', // H6
    'nothing is PERSISTENT', // L5
    '**Phase 3 go/no-go on signal quality**', // weakest assumption
  ],
  'docs/design-tokens.md': ['## Color', 'There is no global "Sample data" badge.'], // M4
  'docs/testing-strategy.md': [
    '**Prefill never auto-submits:**', // H6 E2E
    '**Phase 1 fixture profiles:**', // B2 test
    '**Prompt file match:**', // L7
    '**Purpose guard:**', // L8
    '**Build ledger:**', // M1
    'LLM-to-deterministic fallback rate', // M9
  ],
  // Phase 9: the future-state document (SPEC §45). The demo script (SPEC §44) is the presenter's
  // private run sheet, kept out of the repository (SPEC A.4, 2026-10-03), so it is not checked here.
  'docs/future-state.md': ['## 4. Stage 2: Live monitoring (designed, not built)', '## 9. Documented, not built (P2)'],
  'docs/implementation-plan.md': [
    '## Requirement-preservation checklist',
    '## Priorities',
    '## Cost-addendum override (recorded 2026-10-01)', // B1
    '## Scope fallback', // M12
    '**If Phase 4b slips, ship deterministic-only profiles**', // M12
    '| 8b (P1) | **Gated on the Phase 7 and Phase 8 exit criteria.**', // H2
    '**Not built in Phase 1:** `/thesis`, `/watchlist`', // H2
    '**Architecture and business-value page**', // H1
    '**index summary**', // M11
  ],
};

// Ordering regressions (adversary H2): P1 Phase 8b runs after Phase 8 and before Phase 9,
// and no "6b" phase row may reappear ahead of the P0 phases.
const orderChecks = [];
{
  const plan = join(root, 'docs/implementation-plan.md');
  if (existsSync(plan)) {
    const t = readFileSync(plan, 'utf8');
    const row = (n) => t.indexOf(`\n| ${n} | `);
    const [r8, r8b, r9] = [row('8'), row('8b (P1)'), row('9')];
    if (!(r8 >= 0 && r8b > r8 && r9 > r8b)) orderChecks.push('docs/implementation-plan.md: phase rows must be ordered 8 → 8b (P1) → 9');
    if (/\n\| 6b /.test(t)) orderChecks.push('docs/implementation-plan.md: a "6b" phase row is back ahead of the P0 phases');
  }
}

// The archive header must be the first line of each archived file, and the old root copies must be gone.
for (const f of ['docs/archive/SPEC-v1.md', 'docs/archive/SPEC-ADDENDUM-COST.md', 'docs/archive/PRODUCT_DIRECTION.md']) {
  const path = join(root, f);
  if (existsSync(path) && readFileSync(path, 'utf8').split('\n')[0] !== ARCHIVED) orderChecks.push(`${f}: first line must be the archive header`);
}
for (const f of ['SPEC-ADDENDUM-COST.md', 'PRODUCT_DIRECTION.md']) {
  if (existsSync(join(root, f))) orderChecks.push(`${f}: superseded; it lives in docs/archive/ only`);
}

// Stale statements that must not come back (Phase 1 adversary finding 9).
for (const [f, stale] of [
  ['docs/testing-strategy.md', 'No tests exist yet'],
  ['docs/testing-strategy.md', '| Playwright local | | Yes (`pnpm e2e`) |'],
  ['packages/core/package.json', 'workstreams'],
]) {
  const path = join(root, f);
  if (existsSync(path) && readFileSync(path, 'utf8').includes(stale)) orderChecks.push(`${f}: stale text "${stale}"`);
}

// Text that must never ship in docs (placeholders / unfinished markers).
const forbidden = [/lorem ipsum/i, /\bTODO\b/, /\bTBD\b/, /\bFIXME\b/];

const failures = [...orderChecks];
for (const [file, headings] of Object.entries(required)) {
  const path = join(root, file);
  if (!existsSync(path)) {
    failures.push(`missing file: ${file}`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  if (text.trim().length === 0) failures.push(`empty file: ${file}`);
  for (const h of headings) {
    if (!text.includes(h)) failures.push(`${file}: missing required section "${h}"`);
  }
  // SPEC.md and the archived requirement sources are exempt from placeholder checks.
  if (file !== 'SPEC.md' && !file.startsWith('docs/archive/')) {
    for (const re of forbidden) {
      if (re.test(text)) failures.push(`${file}: contains placeholder marker ${re}`);
    }
  }
}

if (failures.length) {
  console.error(`check-docs: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-docs: OK (${Object.keys(required).length} files verified)`);

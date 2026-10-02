# Profile eval — iv-9cf51c066743, llm-v3

Built 2026-10-02T22:11:01.780Z (run 2026-10-02T22-11-01-779Z-a7b3eb28). 53 profiles, 42 written by the model. Template version 2, validator version 2. Bars: evals/profiles.yaml (provisional, SPEC §32.9).

53 stored outcomes carry no request hash (recorded before hashing existed), so their request could not be verified by hash; they were re-validated against the request recomputed now (promptVerified: false in the manifest).

| Metric | Value | Bar | Result |
|---|---|---|---|
| Citation validity (index chunks of the company; model citations ⊂ the recomputed request) | 100.0% | 100% | pass |
| Figure match (FACTS, or a cited excerpt passage for model text; points only as points) | 100.0% | 100% | pass |
| Banned-phrase matches | 0 | 0 | pass |
| LLM-to-deterministic fallback, deep tier | 25.0% | ≤ 25.0% | pass |
| Coverage-tier correctness | 100.0% | 100% | pass |
| Generation calls per profile (max) | 1 | ≤ 1 | pass |
| Schema-valid / integrity-clean | 53 / 53 of 53 | all | pass |

Signal precision and recall are measured by `pnpm eval:signals` (signals-<iv>.md); the profiles use only the detectors that passed it.

## Fallbacks

- BA: unsupported_figures — recommendedDiligence.4.why: "a third of revenue" (a figure in words)
- DE: invented_item — driver not supplied: Declining agricultural market conditions; driver not supplied: Tariff and trade policy headwinds
- JNJ: unsupported_figures — signals.JNJ-PERSISTENT-geographic_concentration-FY2025-7: 43%
- KO: unsupported_figures — signals.KO-TREND-operating_margin-FY2024-2.whatChanged: "doubled" (a figure in words)
- LLY: unsupported_figures — headline: "doubled" (a figure in words)
- ORCL: unsupported_figures — recommendedDiligence.0.question: "tripled" (a figure in words)
- PG: unsupported_figures — recommendedDiligence.2.why: "half of net sales" (a figure in words)
- RTX: unsupported_figures — recommendedDiligence.1: 5.2%
- TGT: unsupported_figures — recommendedDiligence.4: $4
- UNH: unsupported_figures — executiveView.Performance: "five percentage points" (a figure in words)
- VZ: unsupported_figures — headline: $25 billion

import type { DetectorId, DetectorStatus } from './detect';

/**
 * Phase 3 signal go/no-go (DD-18; SPEC §10; assumptions G4), decided 2026-10-01 on the
 * hand-labeled AAPL, MSFT, NVDA evaluation (`pnpm eval:signals`,
 * evals/results/signals-iv-9cf51c066743.md). Risk and emphasis detectors: 6 consecutive 10-K
 * pairs (FY2023→FY2024, FY2024→FY2025). TREND_CHANGE: 24 labels derived from hand-read income
 * statements (testing/trend-labels.ts), as of FY2024 and FY2025. Bar: precision ≥ 0.8, recall
 * ≥ 0.5, at least MIN_DECIDED (5) decided candidates; a recall that cannot be measured fails
 * (RECALL_NOT_APPLICABLE is empty). A suppressed detector never emits: detectCompanySignals
 * filters on this table (tested), and the dashboard leads with current risks, trajectories and
 * recommended diligence instead.
 *
 * Scope of the Go: measured on AAPL, MSFT and NVDA only. Other companies are unmeasured; the
 * Phase 2 low-yield heading extractions (XOM, GOOG, AMZN, CVX; also KO, PFE) fall below
 * PERSISTENT_MIN_HEADINGS and get no PERSISTENT signal.
 *
 * Detector thresholds were fixed before the evaluation and NOT tuned on it; the emphasis
 * sensitivity table in the results is diagnostic only (no setting met both bars). The bar's
 * MIN_DECIDED, null-recall and PERSISTENT link rules were added after the Phase 3 adversary review.
 */
export const DETECTOR_STATUS: Readonly<Record<DetectorId, DetectorStatus>> = {
  risk_new: {
    enabled: false,
    reason: 'Suppressed: precision 0.33 (1/3 judged, below the 5-decided minimum), recall 1/1. Real new risk factors are rare (1 in 6 pairs); extractor false-positive headings and reworded headings dominate.',
  },
  risk_removed: {
    enabled: false,
    reason: 'Suppressed: precision 0.38 (3/8), recall 3/3. Merged risk factors (MSFT FY2025) and non-heading sentences read as removals.',
  },
  risk_persistent: {
    enabled: true,
    reason:
      'Go (AAPL, MSFT, NVDA only): precision 0.90 (26/29) judged on hand-labeled links only; link precision 0.93 (51/55); recall 0.89 (24/27) over labeled persistent headings the classifier categorizes. 22 of 77 chain links (FY2022→FY2023) are unlabeled and unverified, so the headline states the matched span ("matched in each annual report FY2022–FY2025"), not a verified history. Diagnostics: fully labeled chains 5/7; recall over all labeled persistent headings 27/74 (uncategorized headings are shown as current risks, not PERSISTENT).',
  },
  emphasis_up: { enabled: false, reason: 'Suppressed: precision 1.00 (2/2, below the 5-decided minimum) but recall 0.15 (2/13); lexicon density misses content-level expansion.' },
  emphasis_down: { enabled: false, reason: 'Suppressed: no candidates; recall 0/1.' },
  outlook: { enabled: false, reason: 'Suppressed: precision 0.00 (0/1 judged), recall 0/5.' },
  trend: {
    enabled: true,
    reason:
      'Go (AAPL, MSFT, NVDA only): precision 1.00 (15/15), recall 1.00 (15/15) against 24 direction labels derived from hand-read income-statement rows (testing/trend-labels.ts), as of FY2024 and FY2025; no candidate on the 9 labeled no-change cases.',
  },
};

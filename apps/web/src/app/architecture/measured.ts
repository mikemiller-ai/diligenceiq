/**
 * The measured numbers the Architecture page shows (Phase 7; SPEC §18, implementation plan row 7:
 * "only measured numbers, each traceable to docs/evaluation.md or telemetry").
 *
 * Each entry names its source. `measured.test.ts` recomputes every value from that source (a
 * results file under `evals/results/`, or the stated line of `docs/evaluation.md`), so a number
 * on the page can never drift from its record. Nothing here is estimated or illustrative.
 */
export interface Measured {
  id: string;
  value: string;
  label: string;
  /** What exactly was measured, in one plain sentence. */
  detail: string;
  /** Where the number comes from: a results file and section of docs/evaluation.md. */
  source: string;
}

export interface MeasuredGroup {
  title: string;
  note: string;
  items: Measured[];
}

export const MEASURED: MeasuredGroup[] = [
  {
    title: 'Deep Analysis answers',
    note: 'The 20-question evaluation set (including the assessment’s three example questions, word for word) plus 6 robustness questions, prompt da-v4, Claude Sonnet 4.6. Deterministic checks, no model judging a model. A later prompt, da-v5, was tried and reverted: it did not improve these checks (evaluation.md §11).',
    items: [
      {
        id: 'calls',
        value: '1',
        label: 'model call per analysis',
        detail: 'Exactly one generation request for each of the 26 questions.',
        source: 'evals/results/generation-…-da-v4.json and -robustness.json · evaluation.md §4, §7',
      },
      {
        id: 'citations',
        value: '100%',
        label: 'of citations point to supplied passages',
        detail: 'Every citation left in a brief is a passage the model was given; validation removes any other.',
        source: 'generation-…-da-v4 (citationValidityPost) · evaluation.md §4',
      },
      {
        id: 'grounding',
        value: '98.9%',
        label: 'of figures found in their cited passage',
        detail: '531 of 537 currency and percentage figures in the main set, read against the passage each one cites.',
        source: 'generation-…-da-v4 (numericGrounding) · evaluation.md §4',
      },
      {
        id: 'pass',
        value: '14 of 20',
        label: 'main-set questions pass every check',
        detail: 'Five of the six misses have one or two figures the validator could not verify, and one has a misaligned comparison table.',
        source: 'generation-…-da-v4 (passed) · evaluation.md §4',
      },
      {
        id: 'injection',
        value: '5 of 6',
        label: 'prompt-injection attempts pass every check',
        detail: 'Three typed into the question and three planted in retrieved passages. The miss did not follow the planted text or cite it, but repeated it in order to reject it, which the check counts as a failure.',
        source: 'generation-…-da-v4 and -robustness (adversarial questions) · evaluation.md §4, §7',
      },
      {
        id: 'abstention',
        value: '3 of 3',
        label: 'unanswerable questions declined',
        detail: 'A year, a company and market data the filings do not contain: each brief says so instead of answering.',
        source: 'generation-…-da-v4 and -robustness (abstention) · evaluation.md §4, §7',
      },
      {
        id: 'periodClaims',
        value: '9',
        label: 'claims marked “Period not cited”',
        detail: 'Sentences in 3 of the 20 main-set briefs that say something is new or absent in a fiscal year none of their own citations is from. Shown on the brief; reported, not counted as a failed check.',
        source: 'generation-…-da-v4 (periodClaims) · evaluation.md §12',
      },
    ],
  },
  {
    title: 'Retrieval',
    note: 'The same 20 questions, scored on the retrieved context before any model call.',
    items: [
      {
        id: 'retrieval',
        value: '19 of 20',
        label: 'questions pass the retrieval checks',
        detail: 'Hybrid keyword and vector search: every company and period asked about is in the context, and the supporting passage was found.',
        source: 'evals/results/retrieval-….json (hybrid) · evaluation.md §1',
      },
    ],
  },
  {
    title: 'Latency and cost in production',
    note: 'Three analyses through the deployed queue and worker in us-east-1 (prompt da-v3, 2026-10-02).',
    items: [
      {
        id: 'e2e',
        value: '43–64 s',
        label: 'from queued to a finished brief',
        detail: 'About 98% of it is the model writing the brief; the first token arrives in about 1 s. Excludes the browser’s request and polling.',
        source: 'evaluation.md §5',
      },
      {
        id: 'cold',
        value: '2.8 s',
        label: 'to load the index after idle',
        detail: 'The 236 MB pre-built index, read from S3 into the worker’s memory on a cold start.',
        source: 'evaluation.md §5',
      },
      {
        id: 'cost',
        value: '$0.12–0.13',
        label: 'model cost per analysis',
        detail: 'Estimated from the tokens each call used, at the $3 / $15 per million tokens then in the code; the account is billed 10% more.',
        source: 'evaluation.md §5 · evals/results/idle-cost-2026-10-03.json',
      },
    ],
  },
  {
    title: 'Company Intelligence profiles',
    note: 'Built offline once per index version; opening a page only reads them.',
    items: [
      {
        id: 'profiles',
        value: '53',
        label: 'companies profiled, every citation and figure checked',
        detail: '100% of citations are real passages of that company, and 100% of figures match a source; no banned phrase.',
        source: 'evals/results/profiles-…-llm-v3.json · evaluation.md §6',
      },
      {
        id: 'fallback',
        value: '3 of 12',
        label: 'deep-coverage companies fell back to the deterministic profile',
        detail: 'Their one model-written draft failed a check, so the page shows the zero-call version instead, labeled.',
        source: 'profiles-…-llm-v3 (deepTierFallbackRate) · evaluation.md §6',
      },
    ],
  },
];

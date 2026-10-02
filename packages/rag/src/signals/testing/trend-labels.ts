/**
 * Hand-read income-statement values for the TREND_CHANGE evaluation (Phase 3 go/no-go; DD-18;
 * evaluation.md §3). These are the ground truth the trend candidates are judged against; the true
 * direction labels are derived from them by `deriveTrendLabels` (evaluate.ts) with the DD-17
 * definitions, so the judgement no longer re-uses the detector's own extracted numbers.
 *
 * Who, how, when: read by hand by a Claude agent on 2026-10-01 from the processed filings
 * (`.index/work/processed/<documentId>.json`, `text` inside the section with kind
 * "financial_statements"), from the consolidated income statement ("CONSOLIDATED STATEMENTS OF
 * OPERATIONS" for AAPL, "INCOME STATEMENTS" for MSFT, "Consolidated Statements of Income" for
 * NVDA) of the latest two 10-Ks of each company. Each value is copied as printed (USD millions),
 * with the printed row label. The labeler did not run or read the extraction code
 * (packages/corpus/src/financials) or the extraction outputs while recording these values; the
 * FY2023 columns of the FY2024 10-K and the FY2025 10-K were cross-checked against each other by
 * eye and agree (no restatements).
 *
 * Source of each fiscal year: FY2025, FY2024, FY2023 from the FY2025 10-K; FY2022 from the FY2024
 * 10-K (its third column). Four years give two "as of" points per company (FY2024 and FY2025),
 * twelve metric labels per as-of year for the three companies, 24 in all.
 */
export interface StatementYear {
  fiscalLabel: string;
  documentId: string;
  /** Printed row label → value as printed (USD millions). */
  revenue: { row: string; value: number };
  grossProfit?: { row: string; value: number };
  operatingIncome?: { row: string; value: number };
  netIncome?: { row: string; value: number };
}

export const TREND_STATEMENT_ROWS: Readonly<Record<string, readonly StatementYear[]>> = {
  AAPL: [
    {
      fiscalLabel: 'FY2022',
      documentId: 'AAPL_10K_2024Q3_2024-11-01',
      revenue: { row: 'Total net sales', value: 394_328 },
      grossProfit: { row: 'Gross margin', value: 170_782 },
      operatingIncome: { row: 'Operating income', value: 119_437 },
      netIncome: { row: 'Net income', value: 99_803 },
    },
    {
      fiscalLabel: 'FY2023',
      documentId: 'AAPL_10K_2025-10-31',
      revenue: { row: 'Total net sales', value: 383_285 },
      grossProfit: { row: 'Gross margin', value: 169_148 },
      operatingIncome: { row: 'Operating income', value: 114_301 },
      netIncome: { row: 'Net income', value: 96_995 },
    },
    {
      fiscalLabel: 'FY2024',
      documentId: 'AAPL_10K_2025-10-31',
      revenue: { row: 'Total net sales', value: 391_035 },
      grossProfit: { row: 'Gross margin', value: 180_683 },
      operatingIncome: { row: 'Operating income', value: 123_216 },
      netIncome: { row: 'Net income', value: 93_736 },
    },
    {
      fiscalLabel: 'FY2025',
      documentId: 'AAPL_10K_2025-10-31',
      revenue: { row: 'Total net sales', value: 416_161 },
      grossProfit: { row: 'Gross margin', value: 195_201 },
      operatingIncome: { row: 'Operating income', value: 133_050 },
      netIncome: { row: 'Net income', value: 112_010 },
    },
  ],
  MSFT: [
    {
      fiscalLabel: 'FY2022',
      documentId: 'MSFT_10K_2024Q2_2024-07-30',
      revenue: { row: 'Total revenue', value: 198_270 },
      grossProfit: { row: 'Gross margin', value: 135_620 },
      operatingIncome: { row: 'Operating income', value: 83_383 },
      netIncome: { row: 'Net income', value: 72_738 },
    },
    {
      fiscalLabel: 'FY2023',
      documentId: 'MSFT_10K_2025-07-30',
      revenue: { row: 'Total revenue', value: 211_915 },
      grossProfit: { row: 'Gross margin', value: 146_052 },
      operatingIncome: { row: 'Operating income', value: 88_523 },
      netIncome: { row: 'Net income', value: 72_361 },
    },
    {
      fiscalLabel: 'FY2024',
      documentId: 'MSFT_10K_2025-07-30',
      revenue: { row: 'Total revenue', value: 245_122 },
      grossProfit: { row: 'Gross margin', value: 171_008 },
      operatingIncome: { row: 'Operating income', value: 109_433 },
      netIncome: { row: 'Net income', value: 88_136 },
    },
    {
      fiscalLabel: 'FY2025',
      documentId: 'MSFT_10K_2025-07-30',
      revenue: { row: 'Total revenue', value: 281_724 },
      grossProfit: { row: 'Gross margin', value: 193_893 },
      operatingIncome: { row: 'Operating income', value: 128_528 },
      netIncome: { row: 'Net income', value: 101_832 },
    },
  ],
  NVDA: [
    {
      fiscalLabel: 'FY2022',
      documentId: 'NVDA_10K_2024Q1_2024-02-21',
      revenue: { row: 'Revenue', value: 26_914 },
      grossProfit: { row: 'Gross profit', value: 17_475 },
      operatingIncome: { row: 'Operating income', value: 10_041 },
      netIncome: { row: 'Net income', value: 9_752 },
    },
    {
      fiscalLabel: 'FY2023',
      documentId: 'NVDA_10K_2025-02-26',
      revenue: { row: 'Revenue', value: 26_974 },
      grossProfit: { row: 'Gross profit', value: 15_356 },
      operatingIncome: { row: 'Operating income', value: 4_224 },
      netIncome: { row: 'Net income', value: 4_368 },
    },
    {
      fiscalLabel: 'FY2024',
      documentId: 'NVDA_10K_2025-02-26',
      revenue: { row: 'Revenue', value: 60_922 },
      grossProfit: { row: 'Gross profit', value: 44_301 },
      operatingIncome: { row: 'Operating income', value: 32_972 },
      netIncome: { row: 'Net income', value: 29_760 },
    },
    {
      fiscalLabel: 'FY2025',
      documentId: 'NVDA_10K_2025-02-26',
      revenue: { row: 'Revenue', value: 130_497 },
      grossProfit: { row: 'Gross profit', value: 97_858 },
      operatingIncome: { row: 'Operating income', value: 81_453 },
      netIncome: { row: 'Net income', value: 72_880 },
    },
  ],
};

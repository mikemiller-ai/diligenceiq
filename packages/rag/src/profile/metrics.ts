import type { Metric } from '@diligenceiq/corpus';

/*
 * Extraction names (DD-17, snake_case) → the display labels the dashboard's performance table
 * and Compare look up (apps/web PERFORMANCE_METRICS, core COMPARE_METRICS). One place, so the
 * profile and the UI cannot drift apart.
 */

/** Fact metric → label. The gross-profit dollar figure is "Gross profit"; "Gross margin" is the derived trend. */
export const FACT_LABEL: Readonly<Record<Metric, string>> = {
  revenue: 'Revenue',
  gross_profit: 'Gross profit',
  operating_income: 'Operating income',
  net_income: 'Net income',
  cash_and_equivalents: 'Cash and liquidity',
  total_debt: 'Debt',
  capital_expenditures: 'Capital spending',
  operating_cash_flow: 'Operating cash flow',
};

/**
 * Trend metric → labels. Revenue growth also labels the "Revenue" row (its trajectory is the
 * revenue trajectory), which Compare reads.
 */
export const TREND_LABELS: Readonly<Record<string, readonly string[]>> = {
  revenue_growth: ['Revenue', 'Revenue growth'],
  gross_margin: ['Gross margin'],
  operating_margin: ['Operating margin'],
  net_margin: ['Net margin'],
  revenue_quarter_growth: ['Quarterly revenue growth'],
  operating_income_growth: ['Operating income'],
  net_income_growth: ['Net income'],
  operating_cash_flow_growth: ['Operating cash flow'],
};

/** Metrics whose year-over-year growth the profile adds on top of computeTrends (one table row each, DD-17). */
export const EXTRA_GROWTH_METRICS: readonly Metric[] = ['operating_income', 'net_income', 'operating_cash_flow'];

import { FILINGS } from '@/fixtures';

/** Corpus facts derived from the filing rows (never from manifest text). */
export function corpusStats() {
  const companies = new Set(FILINGS.map((f) => f.ticker)).size;
  const tenK = FILINGS.filter((f) => f.filingType === '10-K').length;
  // GE_10K_2015 (GE Capital FY2014) sits outside the review window; see docs/assumptions.md.
  const periods = FILINGS.map((f) => f.periodEnd).filter((p) => p >= '2022-01-01').sort();
  return {
    filings: FILINGS.length,
    companies,
    tenK,
    tenQ: FILINGS.length - tenK,
    firstPeriod: periods[0] ?? '',
    lastPeriod: periods[periods.length - 1] ?? '',
  };
}

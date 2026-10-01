import { coverageTier, type Citation, type CoverageTier, type FilingType } from '@diligenceiq/core';
import filingsJson from './generated/filings.json';
import passagesJson from './generated/passages.json';
import type { FilingRecord } from './types';

/*
 * Phase 1 fixtures. Filing rows come from the real corpus headers, and every passage is an
 * exact slice of a real filing (scripts/fixtures/build-web-fixtures.mjs). There are no
 * hand-written analyses or findings here: the workspace starts empty and the fixture
 * profiles (./profiles) hold only verbatim filing text, deterministic templates, and
 * labeled placeholders. Phase 2+ replaces all of it with the real index and profiles.
 */

/**
 * Metadata overrides (assumptions, Known corpus anomalies and G2). GE_10K_2015's header says
 * "General Electric Company", but the registrant on its cover page is GE Capital, FY2014.
 */
const COMPANY_OVERRIDES: Readonly<Record<string, string>> = {
  'GE_10K_2015-02-27': 'General Electric Capital Corp (GE Capital)',
};

export const FILINGS: FilingRecord[] = (filingsJson as FilingRecord[]).map((f) => {
  const company = COMPANY_OVERRIDES[f.documentId];
  return company ? { ...f, company } : f;
});
export const PASSAGES = passagesJson as Citation[];

export function passage(chunkId: string): Citation {
  const p = PASSAGES.find((x) => x.chunkId === chunkId);
  if (!p) throw new Error(`fixture passage missing: ${chunkId}`);
  return p;
}

/** Fiscal-year filter options. Fiscal labels can run a year ahead of the calendar (e.g. NVDA FY2026). */
export const FISCAL_YEAR_OPTIONS = [2022, 2023, 2024, 2025, 2026] as const;

export const FILING_TYPES: readonly FilingType[] = ['10-K', '10-Q'];

/** Outside the review window (assumptions G2): GE_10K_2015 is GE Capital's FY2014 10-K. */
const REVIEW_WINDOW_START = '2022-01-01';

export interface CompanyRecord {
  ticker: string;
  company: string;
  filings: number;
  tenK: number;
  tenQ: number;
  tier: CoverageTier;
  /** Period end of the latest annual report (its fiscal-year end). */
  latestAnnualPeriodEnd: string;
  /**
   * True when every filing for the company predates the review window. Such a company is
   * not featured, has no profile, and is not offered as a Deep Analysis company filter.
   */
  outsideWindow: boolean;
}

/** "FY2014" for a December fiscal year end (only used to label outside-window filings). */
export function fiscalYearLabel(periodEnd: string): string {
  return `FY${periodEnd.slice(0, 4)}`;
}

let companyCache: CompanyRecord[] | null = null;

/** One row per corpus company, computed from the filing rows (never from manifest text). */
export function companies(): CompanyRecord[] {
  if (companyCache) return companyCache;
  const map = new Map<string, FilingRecord[]>();
  for (const f of FILINGS) map.set(f.ticker, [...(map.get(f.ticker) ?? []), f]);
  companyCache = [...map.entries()]
    .map(([ticker, rows]) => {
      const tenK = rows.filter((r) => r.filingType === '10-K');
      return {
        ticker,
        company: rows[0]?.company ?? ticker,
        filings: rows.length,
        tenK: tenK.length,
        tenQ: rows.length - tenK.length,
        tier: coverageTier(tenK.length, rows.length - tenK.length),
        latestAnnualPeriodEnd: tenK.map((r) => r.periodEnd).sort().at(-1) ?? '',
        outsideWindow: rows.every((r) => r.periodEnd < REVIEW_WINDOW_START),
      };
    })
    .sort((a, b) => a.company.localeCompare(b.company));
  return companyCache;
}

export function companyByTicker(ticker: string): CompanyRecord | undefined {
  return companies().find((c) => c.ticker === ticker);
}

export function companyName(ticker: string): string {
  return companyByTicker(ticker)?.company ?? ticker;
}

/** Deep-coverage companies are featured on the selector, Apple first (SPEC §8.1). */
export function featuredCompanies(): CompanyRecord[] {
  const deep = companies().filter((c) => c.tier === 'deep' && !c.outsideWindow);
  return [...deep.filter((c) => c.ticker === 'AAPL'), ...deep.filter((c) => c.ticker !== 'AAPL')];
}

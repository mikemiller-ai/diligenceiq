import { encodeOrigin, type AnalysisFilters, type AnalysisOrigin, type FilingType } from '@diligenceiq/core';

/**
 * Deep Analysis prefill link (SPEC §5.3, §14.2). It only fills the form: the question
 * stays editable and nothing runs until the user clicks Run analysis. `filingTypes`, `from`
 * and `to` carry an earlier analysis's source and fiscal-year filters (Edit and run again,
 * follow-up questions).
 */
type PrefillFilters = { tickers?: readonly string[]; filingTypes?: readonly FilingType[]; fiscalYearFrom?: number; fiscalYearTo?: number };

export function newAnalysisHref(opts: PrefillFilters & { question?: string; origin?: AnalysisOrigin } = {}): string {
  const params = new URLSearchParams();
  if (opts.question) params.set('q', opts.question);
  if (opts.tickers?.length) params.set('tickers', opts.tickers.join(','));
  if (opts.filingTypes?.length) params.set('types', opts.filingTypes.join(','));
  if (opts.fiscalYearFrom !== undefined) params.set('from', String(opts.fiscalYearFrom));
  if (opts.fiscalYearTo !== undefined) params.set('to', String(opts.fiscalYearTo));
  if (opts.origin && opts.origin.kind !== 'direct') params.set('origin', encodeOrigin(opts.origin));
  const qs = params.toString();
  return `/analysis/new/${qs ? `?${qs}` : ''}`;
}

export function analysisHref(id: string): string {
  return `/analysis/?id=${encodeURIComponent(id)}`;
}

export function intelligenceHref(ticker?: string): string {
  return ticker ? `/intelligence/?ticker=${encodeURIComponent(ticker)}` : '/intelligence/';
}

export function compareHref(tickers: readonly string[] = []): string {
  return tickers.length ? `/compare/?tickers=${tickers.map(encodeURIComponent).join(',')}` : '/compare/';
}

/** An analysis's filters as prefill options (every filter it ran with, so a re-run asks the same thing). */
export function filtersAsPrefill(filters: AnalysisFilters | undefined): PrefillFilters {
  return {
    ...(filters?.tickers?.length ? { tickers: filters.tickers } : {}),
    ...(filters?.filingTypes?.length ? { filingTypes: filters.filingTypes } : {}),
    ...(filters?.fiscalYearFrom !== undefined ? { fiscalYearFrom: filters.fiscalYearFrom } : {}),
    ...(filters?.fiscalYearTo !== undefined ? { fiscalYearTo: filters.fiscalYearTo } : {}),
  };
}

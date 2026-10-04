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

/**
 * A filing's source view, optionally scrolled to one passage (`#chunk-<id>`). A citation's link
 * also carries its index version (`iv`): chunk IDs and offsets are only meaningful within one
 * version, so the source view asks for that version and never highlights a passage from another
 * one. The hash stays last.
 */
export function filingHref(documentId: string, chunkId?: string, indexVersion?: string): string {
  const params = new URLSearchParams({ id: documentId });
  if (indexVersion) params.set('iv', indexVersion);
  return `/sources/filing/?${params.toString()}${chunkId ? `#chunk-${chunkId}` : ''}`;
}

/** The public source repository, and its map of each assessment deliverable to where it lives. */
export const REPOSITORY_URL = 'https://github.com/mikemiller-ai/diligenceiq';
export const DELIVERABLES_URL = `${REPOSITORY_URL}/blob/main/docs/deliverables.md`;

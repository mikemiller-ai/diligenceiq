import { encodeOrigin, type AnalysisOrigin } from '@diligenceiq/core';

/**
 * Deep Analysis prefill link (SPEC §5.3, §14.2). It only fills the form: the question
 * stays editable and nothing runs until the user clicks Run analysis.
 */
export function newAnalysisHref(opts: { question?: string; tickers?: readonly string[]; origin?: AnalysisOrigin } = {}): string {
  const params = new URLSearchParams();
  if (opts.question) params.set('q', opts.question);
  if (opts.tickers?.length) params.set('tickers', opts.tickers.join(','));
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

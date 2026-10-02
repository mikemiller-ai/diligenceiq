import catalogJson from './generated/catalog.json';

/**
 * The corpus company catalog (scripts/fixtures/build-catalog.mjs, derived from the filing rows).
 * The api checks every ticker in a path or body against it (architecture §11).
 */
export const COMPANY_CATALOG: ReadonlyArray<{ ticker: string; company: string }> = catalogJson;

const TICKERS: ReadonlySet<string> = new Set(COMPANY_CATALOG.map((c) => c.ticker));

export function isCatalogTicker(ticker: string): boolean {
  return TICKERS.has(ticker);
}

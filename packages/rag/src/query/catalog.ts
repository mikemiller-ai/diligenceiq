import type { Chunk } from '@diligenceiq/corpus';

/**
 * The filing catalog the query analyzer and the planner resolve against: per company, every
 * filing in the index with its fiscal labels. Derived from the index's own chunks, so it can
 * never disagree with what retrieval can return (SPEC §26; architecture §6.5).
 */
export interface CatalogFiling {
  documentId: string;
  filingType: '10-K' | '10-Q';
  filingDate: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  fiscalLabel: string;
  /** Outside the corpus review window (see `REVIEW_WINDOW_YEARS`). */
  outsideReviewWindow: boolean;
}

export interface CatalogCompany {
  ticker: string;
  /** Display name from the filing header ("Apple Inc"). */
  company: string;
  sector: string;
  /** Ordered by period end, then form (a 10-K before a 10-Q that ends the same day). */
  filings: CatalogFiling[];
  /**
   * Every filing is outside the review window (GE: its only filing is the FY2014 10-K).
   * Such a company is left out of questions that name no company and is still searchable
   * when named, with a stated note (architecture §6.5).
   */
  outsideReviewWindow: boolean;
}

export interface Catalog {
  companies: CatalogCompany[];
  byTicker: Map<string, CatalogCompany>;
}

type CatalogChunk = Pick<
  Chunk,
  'documentId' | 'ticker' | 'company' | 'sector' | 'filingType' | 'filingDate' | 'periodEnd' | 'fiscalYear' | 'fiscalQuarter' | 'fiscalLabel'
> & { outsideReviewWindow?: boolean };

/**
 * Review-window rule. Filing metadata carries an explicit `outsideReviewWindow` flag (GE's
 * FY2014 10-K), but index chunk records do not, so the catalog also derives it: a filing whose
 * period ends more than `REVIEW_WINDOW_YEARS` years before the corpus's newest period end is
 * outside the window. Either signal flags the filing.
 */
export const REVIEW_WINDOW_YEARS = 3;

function windowCutoff(newestPeriodEnd: string): string {
  const y = Number(newestPeriodEnd.slice(0, 4)) - REVIEW_WINDOW_YEARS;
  return `${String(y).padStart(4, '0')}${newestPeriodEnd.slice(4)}`;
}

export function buildCatalog(chunks: readonly CatalogChunk[]): Catalog {
  const newest = chunks.reduce((m, c) => (c.periodEnd > m ? c.periodEnd : m), '');
  const cutoff = newest ? windowCutoff(newest) : '';
  const companies = new Map<string, CatalogCompany>();
  const seen = new Set<string>();
  for (const c of chunks) {
    let co = companies.get(c.ticker);
    if (!co) companies.set(c.ticker, (co = { ticker: c.ticker, company: c.company, sector: c.sector, filings: [], outsideReviewWindow: false }));
    if (seen.has(c.documentId)) continue;
    seen.add(c.documentId);
    co.filings.push({
      documentId: c.documentId,
      filingType: c.filingType,
      filingDate: c.filingDate,
      periodEnd: c.periodEnd,
      fiscalYear: c.fiscalYear,
      fiscalQuarter: c.fiscalQuarter,
      fiscalLabel: c.fiscalLabel,
      outsideReviewWindow: c.outsideReviewWindow === true || c.periodEnd < cutoff,
    });
  }
  for (const co of companies.values()) {
    co.filings.sort((a, b) => a.periodEnd.localeCompare(b.periodEnd) || a.filingType.localeCompare(b.filingType));
    co.outsideReviewWindow = co.filings.length > 0 && co.filings.every((f) => f.outsideReviewWindow);
  }
  const list = [...companies.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return { companies: list, byTicker: new Map(list.map((c) => [c.ticker, c])) };
}

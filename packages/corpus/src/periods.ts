import type { FilingHeader, FilingType } from './header';

/**
 * Period end and fiscal labels (SPEC §24.2 step 3; architecture §6.1 step 2; assumptions B2, B3).
 *
 * Period-end source order: header `Report Period` → URL slug date → cover page
 * "For the fiscal year/quarterly period ended <date>" → filing date (last resort, flagged).
 */

export type PeriodSource = 'header' | 'url-slug' | 'cover-page' | 'filing-date';

/** `aapl-20250927.htm`, `de-20251102x10k.htm`, `msft-10k_20220630.htm`. `gecc10k2014.htm` has no date. */
export const SLUG_DATE = /[-_](\d{4})(\d{2})(\d{2})(?:x10[kq])?\.htm$/i;
const COVER_PERIOD =
  /For\s+the\s+(?:fiscal\s+year|quarterly\s+period)\s+ended\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/;
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Only the cover page is searched, never a later cross-reference. */
const COVER_SEARCH_CHARS = 200_000;

export function slugDate(url: string): string | null {
  const m = (url.split('/').pop() ?? '').match(SLUG_DATE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function derivePeriodEnd(header: FilingHeader, text: string): { periodEnd: string; source: PeriodSource } {
  if (header.reportPeriod) return { periodEnd: header.reportPeriod, source: 'header' };
  const slug = slugDate(header.url);
  if (slug) return { periodEnd: slug, source: 'url-slug' };
  const c = text.slice(header.headerEnd, header.headerEnd + COVER_SEARCH_CHARS).match(COVER_PERIOD);
  const monthIndex = c ? MONTHS.indexOf(c[1] as (typeof MONTHS)[number]) : -1;
  if (c && monthIndex >= 0) {
    return { periodEnd: `${c[3]}-${String(monthIndex + 1).padStart(2, '0')}-${c[2]!.padStart(2, '0')}`, source: 'cover-page' };
  }
  return { periodEnd: header.filingDate, source: 'filing-date' };
}

/**
 * Companies that name the fiscal year by the calendar year in which it STARTS (verified in
 * the filing text): TGT "Fiscal 2024 ended February 1, 2025"; HD "fiscal 2024: Fiscal year
 * ended February 2, 2025".
 */
export const FISCAL_YEAR_NAMED_BY_START: ReadonlySet<string> = new Set(['TGT', 'HD']);

const DAY_MS = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);

/**
 * The fiscal-year label of a fiscal year that ends on `fyEnd`: the calendar year of the end,
 * except (1) an end on January 1–7 belongs to the prior year (52/53-week years ending near
 * December 31, e.g. JNJ "fiscal 2021" ended 2022-01-02), and (2) companies that name the
 * year by its start year (TGT, HD).
 */
export function fiscalYearForYearEnd(ticker: string, fyEnd: string): number {
  const d = toDate(fyEnd);
  let year = d.getUTCFullYear();
  if (d.getUTCMonth() === 0 && d.getUTCDate() <= 7) year -= 1;
  else if (FISCAL_YEAR_NAMED_BY_START.has(ticker)) year -= 1;
  return year;
}

export interface FiscalPeriod {
  fiscalYear: number;
  /** null for a 10-K. */
  fiscalQuarter: 1 | 2 | 3 | null;
  /** `FY2025` or `FY2026Q3`. */
  fiscalLabel: string;
  /** End of the fiscal year this period belongs to (for a 10-Q, estimated from the year-end anchor). */
  fiscalYearEnd: string;
}

/**
 * Fiscal labels for one company. `annualPeriodEnds` are the period ends of the company's
 * 10-Ks; the latest one anchors the fiscal year-end month and day. A 10-Q is assigned to the
 * fiscal year whose end follows its period end; its quarter comes from the days since the
 * fiscal year started. 52/53-week calendars drift by a few days, which this tolerates.
 */
export function fiscalPeriod(
  ticker: string,
  filingType: FilingType,
  periodEnd: string,
  annualPeriodEnds: readonly string[],
): FiscalPeriod {
  if (filingType === '10-K') {
    const fiscalYear = fiscalYearForYearEnd(ticker, periodEnd);
    return { fiscalYear, fiscalQuarter: null, fiscalLabel: `FY${fiscalYear}`, fiscalYearEnd: periodEnd };
  }
  const anchor = [...annualPeriodEnds].sort().at(-1);
  if (!anchor) throw new Error(`${ticker}: a 10-Q needs at least one 10-K to anchor the fiscal year`);
  const monthDay = anchor.slice(4); // "-09-27"
  const pYear = toDate(periodEnd).getUTCFullYear();
  // Candidate year ends in the surrounding years; the first more than two weeks after the
  // period end is this quarter's fiscal year end (a quarter never ends that close to it).
  const candidates = [pYear - 1, pYear, pYear + 1, pYear + 2].map((y) => validDate(y, monthDay));
  const end = candidates.find((c) => daysBetween(periodEnd, c) > 14);
  if (!end) throw new Error(`${ticker}: no fiscal year end after ${periodEnd}`);
  const start = validDate(toDate(end).getUTCFullYear() - 1, monthDay);
  const quarter = Math.round(daysBetween(start, periodEnd) / 91.3);
  if (quarter < 1 || quarter > 3) throw new Error(`${ticker}: 10-Q ending ${periodEnd} falls in quarter ${quarter}`);
  const fiscalYear = fiscalYearForYearEnd(ticker, end);
  return {
    fiscalYear,
    fiscalQuarter: quarter as 1 | 2 | 3,
    fiscalLabel: `FY${fiscalYear}Q${quarter}`,
    fiscalYearEnd: end,
  };
}

/** `${year}${monthDay}`, clamped for February 29 in a non-leap year. */
function validDate(year: number, monthDay: string): string {
  const iso = `${year}${monthDay}`;
  const d = toDate(iso);
  if (d.toISOString().slice(0, 10) === iso) return iso;
  return `${year}${monthDay.slice(0, 4)}-28`;
}

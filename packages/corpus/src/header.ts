/**
 * Filing header parsing and metadata overrides (SPEC §24.2 steps 2–3, architecture §6.1,
 * assumptions B1–B4 and Known corpus anomalies).
 *
 * Every corpus file starts with a `Key: value` header block closed by a line of `=`:
 *
 *   Company: Apple Inc
 *   Ticker: AAPL
 *   Filing Type: 10-K (Annual Report)
 *   ...
 *   ============================================================
 */

export type FilingType = '10-K' | '10-Q';

export interface FilingHeader {
  company: string;
  ticker: string;
  filingType: FilingType;
  filingDate: string;
  cik: string;
  source: string;
  url: string;
  /** Header `Report Period`, present on 192 of 246 files. */
  reportPeriod: string | null;
  /** Header `Quarter`: the CALENDAR quarter of the period end, not the fiscal quarter (B3). */
  calendarQuarter: string | null;
  /** Offset of the first character after the `====` separator line. */
  headerEnd: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function documentIdFromFile(file: string): string {
  return file.replace(/_full\.txt$/, '');
}

export function parseHeader(text: string, file = '(unknown)'): FilingHeader {
  const sep = text.indexOf('\n====');
  if (sep === -1) throw new Error(`${file}: no header separator`);
  const fields: Record<string, string> = {};
  for (const line of text.slice(0, sep).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const lineEnd = text.indexOf('\n', sep + 1);
  const required = (key: string): string => {
    const v = fields[key];
    if (!v) throw new Error(`${file}: header field ${key} missing`);
    return v;
  };
  const type = required('Filing Type').slice(0, 4);
  if (type !== '10-K' && type !== '10-Q') throw new Error(`${file}: unsupported filing type ${type}`);
  const filingDate = required('Filing Date');
  if (!ISO_DATE.test(filingDate)) throw new Error(`${file}: bad filing date ${filingDate}`);
  const reportPeriod = fields['Report Period'] ?? null;
  if (reportPeriod !== null && !ISO_DATE.test(reportPeriod)) throw new Error(`${file}: bad report period ${reportPeriod}`);
  return {
    company: required('Company'),
    ticker: required('Ticker'),
    filingType: type,
    filingDate,
    cik: required('CIK'),
    source: required('Source'),
    url: required('URL'),
    reportPeriod,
    calendarQuarter: fields.Quarter ?? null,
    headerEnd: lineEnd === -1 ? text.length : lineEnd + 1,
  };
}

/**
 * Metadata overrides for verified corpus anomalies. Keyed by document ID so an override can
 * never leak onto another filing of the same company.
 */
export interface MetadataOverride {
  company?: string;
  /** Outside the 2022–2025 review window (assumptions G2). */
  outsideReviewWindow?: boolean;
  note: string;
}

export const METADATA_OVERRIDES: Readonly<Record<string, MetadataOverride>> = {
  'GE_10K_2015-02-27': {
    company: 'General Electric Capital Corp (GE Capital)',
    outsideReviewWindow: true,
    note:
      'Header says General Electric Company, but the cover page registrant is General Electric Capital Corporation (Commission file number 1-6461), fiscal year ended 2014-12-31.',
  },
};

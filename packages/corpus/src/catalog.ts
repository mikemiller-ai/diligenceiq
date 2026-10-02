/**
 * Static company catalog: GICS-style sectors for the 54 corpus companies (SPEC §26.2;
 * assumptions C2). Deterministic and documented; the query analyzer (Phase 3) maps sector
 * phrases ("pharmaceutical", "banks", "big tech") onto these.
 */
export const SECTORS = [
  'Information Technology',
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Health Care',
  'Financials',
  'Energy',
  'Industrials',
] as const;
export type Sector = (typeof SECTORS)[number];

export const COMPANY_SECTOR: Readonly<Record<string, Sector>> = {
  AAPL: 'Information Technology',
  ADBE: 'Information Technology',
  AMD: 'Information Technology',
  CRM: 'Information Technology',
  CSCO: 'Information Technology',
  IBM: 'Information Technology',
  INTC: 'Information Technology',
  MSFT: 'Information Technology',
  NVDA: 'Information Technology',
  ORCL: 'Information Technology',
  CMCSA: 'Communication Services',
  DIS: 'Communication Services',
  GOOG: 'Communication Services',
  META: 'Communication Services',
  NFLX: 'Communication Services',
  T: 'Communication Services',
  VZ: 'Communication Services',
  AMZN: 'Consumer Discretionary',
  HD: 'Consumer Discretionary',
  MCD: 'Consumer Discretionary',
  NKE: 'Consumer Discretionary',
  SBUX: 'Consumer Discretionary',
  TSLA: 'Consumer Discretionary',
  COST: 'Consumer Staples',
  KO: 'Consumer Staples',
  PEP: 'Consumer Staples',
  PG: 'Consumer Staples',
  TGT: 'Consumer Staples',
  WMT: 'Consumer Staples',
  ABBV: 'Health Care',
  JNJ: 'Health Care',
  LLY: 'Health Care',
  MRK: 'Health Care',
  PFE: 'Health Care',
  TMO: 'Health Care',
  UNH: 'Health Care',
  AXP: 'Financials',
  BAC: 'Financials',
  BLK: 'Financials',
  BRK: 'Financials',
  GS: 'Financials',
  JPM: 'Financials',
  MA: 'Financials',
  MS: 'Financials',
  V: 'Financials',
  CVX: 'Energy',
  XOM: 'Energy',
  BA: 'Industrials',
  CAT: 'Industrials',
  DE: 'Industrials',
  GE: 'Industrials',
  LMT: 'Industrials',
  RTX: 'Industrials',
  UPS: 'Industrials',
};

export function sectorFor(ticker: string): Sector {
  const s = COMPANY_SECTOR[ticker];
  if (!s) throw new Error(`no sector for ticker ${ticker}`);
  return s;
}

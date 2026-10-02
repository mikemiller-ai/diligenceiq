import { coverageTier, type CoverageTier } from '@diligenceiq/core';
import { sectorFor } from './catalog';
import { type FilingType, METADATA_OVERRIDES, documentIdFromFile, parseHeader } from './header';
import { type PeriodSource, derivePeriodEnd, fiscalPeriod } from './periods';
import { type Section, detectSections } from './sections';
import { stripPreamble } from './text';

/** One filing's metadata after header parsing, overrides and period derivation. */
export interface FilingMeta {
  documentId: string;
  sourceFile: string;
  company: string;
  ticker: string;
  cik: string;
  sector: string;
  filingType: FilingType;
  filingDate: string;
  periodEnd: string;
  periodSource: PeriodSource;
  fiscalYear: number;
  fiscalQuarter: 1 | 2 | 3 | null;
  fiscalLabel: string;
  calendarQuarter: string | null;
  sourceUrl: string;
  outsideReviewWindow: boolean;
}

export interface ProcessedFiling {
  meta: FilingMeta;
  /** Normalized body text from the cover heading on. */
  text: string;
  sections: Section[];
}

export interface RawFiling {
  file: string;
  raw: string;
}

/**
 * Header + period pass over every filing, then fiscal labels (which need each company's
 * 10-K period ends to anchor its 10-Qs).
 */
export function processFilings(raws: readonly RawFiling[]): ProcessedFiling[] {
  const first = raws.map(({ file, raw }) => {
    const header = parseHeader(raw, file);
    const { periodEnd, source } = derivePeriodEnd(header, raw);
    const { text } = stripPreamble(raw, header.headerEnd, file);
    return { file, header, periodEnd, source, text };
  });
  const annualByTicker = new Map<string, string[]>();
  for (const f of first) {
    if (f.header.filingType !== '10-K') continue;
    annualByTicker.set(f.header.ticker, [...(annualByTicker.get(f.header.ticker) ?? []), f.periodEnd]);
  }
  return first.map(({ file, header, periodEnd, source, text }) => {
    const documentId = documentIdFromFile(file);
    const override = METADATA_OVERRIDES[documentId];
    const fp = fiscalPeriod(header.ticker, header.filingType, periodEnd, annualByTicker.get(header.ticker) ?? []);
    const meta: FilingMeta = {
      documentId,
      sourceFile: file,
      company: override?.company ?? header.company,
      ticker: header.ticker,
      cik: header.cik,
      sector: sectorFor(header.ticker),
      filingType: header.filingType,
      filingDate: header.filingDate,
      periodEnd,
      periodSource: source,
      fiscalYear: fp.fiscalYear,
      fiscalQuarter: fp.fiscalQuarter,
      fiscalLabel: fp.fiscalLabel,
      calendarQuarter: header.calendarQuarter,
      sourceUrl: header.url,
      outsideReviewWindow: override?.outsideReviewWindow ?? false,
    };
    return { meta, text, sections: detectSections(text, header.filingType) };
  });
}

/** Per-company coverage, computed from the files (never from manifest text; SPEC §8.5). */
export interface CompanyCoverage {
  ticker: string;
  company: string;
  sector: string;
  tier: CoverageTier;
  filings: number;
  tenK: number;
  tenQ: number;
  annualPeriods: Array<{ fiscalLabel: string; periodEnd: string; documentId: string }>;
  quarterlyPeriods: Array<{ fiscalLabel: string; periodEnd: string; documentId: string }>;
  latestAnnualPeriodEnd: string;
  /** Fiscal year-end as reported by the latest 10-K (SPEC §9: shown as reported, never aligned). */
  fiscalYearEnd: string;
  outsideReviewWindow: boolean;
}

export function companyCoverage(filings: readonly FilingMeta[]): CompanyCoverage[] {
  const byTicker = new Map<string, FilingMeta[]>();
  for (const f of filings) byTicker.set(f.ticker, [...(byTicker.get(f.ticker) ?? []), f]);
  return [...byTicker.entries()]
    .map(([ticker, list]) => {
      const sorted = [...list].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
      const annual = sorted.filter((f) => f.filingType === '10-K');
      const quarterly = sorted.filter((f) => f.filingType === '10-Q');
      const latest = annual.at(-1);
      if (!latest) throw new Error(`${ticker}: no 10-K`);
      const pick = (f: FilingMeta) => ({ fiscalLabel: f.fiscalLabel, periodEnd: f.periodEnd, documentId: f.documentId });
      return {
        ticker,
        company: latest.company,
        sector: latest.sector,
        tier: coverageTier(annual.length, quarterly.length),
        filings: list.length,
        tenK: annual.length,
        tenQ: quarterly.length,
        annualPeriods: annual.map(pick),
        quarterlyPeriods: quarterly.map(pick),
        latestAnnualPeriodEnd: latest.periodEnd,
        fiscalYearEnd: latest.periodEnd,
        outsideReviewWindow: list.every((f) => f.outsideReviewWindow),
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));
}

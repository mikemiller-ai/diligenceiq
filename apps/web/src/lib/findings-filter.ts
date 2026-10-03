import {
  FINDING_ORIGIN_KINDS,
  THEMES,
  type Finding,
  type FindingOriginKind,
  type FindingStatus,
  type ThemeId,
} from '@diligenceiq/core';
import { FINDING_ORIGIN, FINDING_STATUS } from './labels';

/** Findings Board filters (SPEC §17.2): text search, theme, company, status, origin, date, analysis. */
export interface FindingFilters {
  /** Free text (DD-21 h): every word must appear in the title, text, note, a ticker or a company name. */
  q: string;
  theme: ThemeId | 'all';
  ticker: string;
  status: FindingStatus | 'all';
  origin: FindingOriginKind | 'all';
  analysisId: string;
  /** Dates (yyyy-mm-dd) from the date inputs, inclusive, on the local calendar day of createdAt. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: FindingFilters = {
  q: '',
  theme: 'all',
  ticker: '',
  status: 'all',
  origin: 'all',
  analysisId: '',
  from: '',
  to: '',
};

/**
 * The local calendar day (yyyy-mm-dd) of an ISO timestamp. The date inputs are local, so a
 * finding saved on a US evening (already the next day in UTC) still falls on the day the
 * analyst saved it. `offsetMinutes` follows Date#getTimezoneOffset (UTC minus local).
 */
export function localDay(iso: string, offsetMinutes = new Date(iso).getTimezoneOffset()): string {
  return new Date(Date.parse(iso) - offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Lower case, curly quotes and dashes folded, so "Apple’s" matches "apple's". */
const fold = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');

/** Whether a finding matches a search: every word of `q` appears in its title, text, note, a ticker or a company name. */
export function matchesSearch(x: Finding, q: string, companyName: (ticker: string) => string = (t) => t): boolean {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([x.title, x.text, x.note ?? '', ...x.tickers, ...x.tickers.map(companyName)].join('\n'));
  return words.every((w) => hay.includes(w));
}

export function filterFindings(
  findings: readonly Finding[],
  f: FindingFilters,
  dayOf: (iso: string) => string = localDay,
  companyName: (ticker: string) => string = (t) => t,
): Finding[] {
  return findings.filter((x) => {
    const day = dayOf(x.createdAt);
    return (
      matchesSearch(x, f.q, companyName) &&
      (f.theme === 'all' || x.theme === f.theme) &&
      (!f.ticker || x.tickers.includes(f.ticker)) &&
      (f.status === 'all' || x.status === f.status) &&
      (f.origin === 'all' || x.origin.kind === f.origin) &&
      (!f.analysisId || x.analysisId === f.analysisId) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to)
    );
  });
}

/** Findings Board grouping (architecture §10): by company, theme, status, or origin. */
export const GROUP_BY = ['theme', 'company', 'status', 'origin'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export interface FindingGroup {
  key: string;
  label: string;
  findings: Finding[];
}

const newestFirst = (a: Finding, b: Finding) => b.createdAt.localeCompare(a.createdAt);

/**
 * Groups in a fixed order (theme catalog, ticker, status, origin), newest first within a
 * group; empty groups are dropped. A finding about several companies appears under each.
 */
export function groupFindings(findings: readonly Finding[], by: GroupBy, companyLabel: (ticker: string) => string = (t) => t): FindingGroup[] {
  const groups: FindingGroup[] = (() => {
    switch (by) {
      case 'theme':
        return THEMES.map((t) => ({ key: t.id, label: t.name, findings: findings.filter((f) => f.theme === t.id) }));
      case 'company':
        return [...new Set(findings.flatMap((f) => f.tickers))]
          .sort()
          .map((t) => ({ key: t, label: companyLabel(t), findings: findings.filter((f) => f.tickers.includes(t)) }));
      case 'status':
        return (Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => ({
          key: s,
          label: FINDING_STATUS[s].label,
          findings: findings.filter((f) => f.status === s),
        }));
      case 'origin':
        return FINDING_ORIGIN_KINDS.map((k) => ({ key: k, label: FINDING_ORIGIN[k], findings: findings.filter((f) => f.origin.kind === k) }));
    }
  })();
  return groups.map((g) => ({ ...g, findings: [...g.findings].sort(newestFirst) })).filter((g) => g.findings.length > 0);
}

/** Groups by theme in catalog order (the Findings Board default). */
export function groupByTheme(findings: readonly Finding[]) {
  return groupFindings(findings, 'theme');
}

export function activeFilterCount(f: FindingFilters): number {
  return (
    Number(Boolean(f.q.trim())) +
    Number(f.theme !== 'all') +
    Number(Boolean(f.ticker)) +
    Number(f.status !== 'all') +
    Number(f.origin !== 'all') +
    Number(Boolean(f.analysisId)) +
    Number(Boolean(f.from)) +
    Number(Boolean(f.to))
  );
}

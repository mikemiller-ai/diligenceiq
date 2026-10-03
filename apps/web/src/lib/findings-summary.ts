import { THEMES, type Finding, type FindingStatus, type ThemeId } from '@diligenceiq/core';

/*
 * The refined Findings board (DD-21 h): a summary strip, the Board view's columns and the Ask
 * follow-up question. Counts over what is stored; nothing generated.
 */

/** The Board's columns and the summary tiles, attention first. */
export const BOARD_ORDER: readonly FindingStatus[] = ['NEEDS_FOLLOW_UP', 'ACTIVE', 'RESOLVED'];

export interface FindingsSummary {
  total: number;
  companies: number;
  byStatus: Record<FindingStatus, number>;
  /** Every theme in catalog order, with its count (zero included). */
  byTheme: Array<{ id: ThemeId; name: string; count: number }>;
  /** The newest finding that needs follow-up, for the tile's sub-line. */
  firstFollowUp: Finding | null;
}

const newestFirst = (a: Finding, b: Finding) => b.createdAt.localeCompare(a.createdAt);

/** Counts over the whole board (never the filtered view): what needs attention, by status and theme. */
export function summarizeFindings(findings: readonly Finding[]): FindingsSummary {
  const byStatus: Record<FindingStatus, number> = { ACTIVE: 0, NEEDS_FOLLOW_UP: 0, RESOLVED: 0 };
  for (const f of findings) byStatus[f.status]++;
  return {
    total: findings.length,
    companies: new Set(findings.flatMap((f) => f.tickers)).size,
    byStatus,
    byTheme: THEMES.map((t) => ({ id: t.id, name: t.name, count: findings.filter((f) => f.theme === t.id).length })),
    firstFollowUp: [...findings].filter((f) => f.status === 'NEEDS_FOLLOW_UP').sort(newestFirst)[0] ?? null,
  };
}

/** The Board view: one column per status in `BOARD_ORDER`, empty columns kept, newest first. */
export function boardColumns(findings: readonly Finding[]): Array<{ status: FindingStatus; findings: Finding[] }> {
  return BOARD_ORDER.map((status) => ({ status, findings: findings.filter((f) => f.status === status).sort(newestFirst) }));
}

function nameList(names: readonly string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

/**
 * Ask follow-up (DD-21 h): a fixed template over the finding's stored title and companies. It
 * states no figure and no judgment; it only prefills Deep Analysis, which runs on Run analysis.
 */
export function followUpQuestion(finding: Pick<Finding, 'title' | 'tickers'>, companyName: (ticker: string) => string): string {
  // A question is at most 1,000 characters (core AnalysisSummarySchema); a very long title is shortened.
  const title = finding.title.length > 300 ? `${finding.title.slice(0, 299).trimEnd()}…` : finding.title;
  const who = finding.tickers.length ? `the filings of ${nameList(finding.tickers.map(companyName))}` : 'the filings';
  return `Follow up on the finding “${title}”: what do ${who} say about it, and how has the disclosure changed over time?`;
}

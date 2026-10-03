import type { BriefValidation, DiligenceBrief } from '@diligenceiq/core';

/*
 * The brief's bottom line (DD-21 g; step 3 as built). A fixed rule over what the brief already
 * stores: each key finding's validated title, its basis and companies, and what the server-side
 * validator recorded for it (its figure checks, its period claims, and whether a valid citation is left). Nothing is
 * inferred from the model's wording: a brief stores no direction for a finding, so its chips state
 * evidence, never up or down. No model call and no new stored text.
 */

export interface FigureTally {
  total: number;
  /** Found in the passages the item cites (architecture §6.9). */
  verified: number;
  /** Digits found in a table cell of a passage that states no unit: not verified, reported apart. */
  unitUnstated: number;
  /** Not found in its cited passages. */
  unverified: number;
}

export interface BriefHeadline {
  index: number;
  /** The id of the finding's list item, for the bottom line's link. */
  anchor: string;
  title: string;
  basis: 'reported' | 'analysis';
  tickers: string[];
  figures: FigureTally;
  /** False when the validator left the finding with no valid citation. */
  cited: boolean;
  /** Fiscal periods the finding says something is new or absent in, with no citation from that period (architecture §6.9). */
  uncitedPeriods: string[];
}

/**
 * The fiscal periods the validator flagged under one location prefix (`keyFindings[2].`,
 * `executiveSummary`), in order, de-duplicated. Empty for analyses stored before the check.
 */
export function uncitedPeriodsAt(validation: BriefValidation | undefined, prefix: string): string[] {
  const out: string[] = [];
  for (const c of validation?.periodClaims ?? []) if (c.location === prefix || c.location.startsWith(prefix)) for (const p of c.periods) if (!out.includes(p)) out.push(p);
  return out;
}

/** The figures the validator checked under one location prefix, tallied by outcome. */
export function tallyFigures(validation: BriefValidation | undefined, prefix: string): FigureTally {
  const figures = (validation?.numeric.figures ?? []).filter((f) => f.location.startsWith(prefix));
  const verified = figures.filter((f) => f.verified).length;
  const unitUnstated = figures.filter((f) => !f.verified && f.rule === 'unit_unstated').length;
  return { total: figures.length, verified, unitUnstated, unverified: figures.length - verified - unitUnstated };
}

export const findingAnchor = (index: number) => `finding-${index + 1}`;

/** One headline per key finding, in the brief's order. */
export function briefHeadlines(brief: Pick<DiligenceBrief, 'keyFindings'>, validation: BriefValidation | undefined): BriefHeadline[] {
  const uncited = new Set(validation?.uncited ?? []);
  return brief.keyFindings.map((k, i) => ({
    index: i,
    anchor: findingAnchor(i),
    title: k.title,
    basis: k.basis,
    tickers: k.tickers,
    figures: tallyFigures(validation, `keyFindings[${i}].`),
    cited: k.citationIds.length > 0 && !uncited.has(`keyFindings[${i}]`),
    uncitedPeriods: uncitedPeriodsAt(validation, `keyFindings[${i}].`),
  }));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A finding's figure chip, or null when it states no currency or percentage figure. The wording
 * follows the Sources rail's validation summary ("found in their cited passages") and the per-figure
 * badges ("Unverified figure", "Unit not stated"), so they never disagree:
 * - ok: "Figure found in its cited passages", "Both figures found in their cited passages", "All N
 *   figures found in their cited passages";
 * - warning (any figure not found): "N unverified figure(s)";
 * - neutral (none unverified, some only in a table that states no unit): "N figure(s): unit not stated".
 * The screen-reader description states each count apart (found, not found, unit not stated).
 */
export function figureChip(t: FigureTally): { tone: 'ok' | 'warning' | 'neutral'; text: string; description: string } | null {
  if (t.total === 0) return null;
  const found = `${t.verified} of ${t.total} figures were found in the passages this finding cites`;
  const unitPart = (n: number) => `${plural(n, 'figure')} ${n === 1 ? 'matches' : 'match'} a table whose unit is not stated`;
  if (t.unverified > 0) {
    const notFound = `${plural(t.unverified, 'figure')} ${t.unverified === 1 ? 'was' : 'were'} not found`;
    return {
      tone: 'warning',
      text: plural(t.unverified, 'unverified figure'),
      description: `${found}; ${notFound}${t.unitUnstated > 0 ? `, and ${unitPart(t.unitUnstated)}` : ''}. Check ${t.unverified === 1 ? 'it' : 'them'} against the source.`,
    };
  }
  if (t.unitUnstated > 0) {
    return { tone: 'neutral', text: `${plural(t.unitUnstated, 'figure')}: unit not stated`, description: `${found}; ${unitPart(t.unitUnstated)}.` };
  }
  const text = t.total === 1 ? 'Figure found in its cited passages' : t.total === 2 ? 'Both figures found in their cited passages' : `All ${t.total} figures found in their cited passages`;
  return { tone: 'ok', text, description: 'Every currency and percentage figure in this finding was found in the passages it cites.' };
}

/** The status line under the headlines: counts only, each from the stored brief or its validation. */
export function briefStatus(brief: Pick<DiligenceBrief, 'keyFindings' | 'evidenceGaps'>, validation: BriefValidation | undefined, citedPassages: number): string[] {
  const parts = [plural(brief.keyFindings.length, 'key finding'), `${plural(citedPassages, 'passage')} cited`];
  if (validation) {
    const { total, verified } = validation.numeric;
    parts.push(total === 0 ? 'no figures to check' : `${verified} of ${total} figures found in their cited passages`);
  }
  parts.push(brief.evidenceGaps.length === 0 ? 'no evidence gaps identified' : plural(brief.evidenceGaps.length, 'evidence gap'));
  return parts;
}

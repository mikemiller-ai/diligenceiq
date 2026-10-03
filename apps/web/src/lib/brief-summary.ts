import type { BriefValidation, DiligenceBrief } from '@diligenceiq/core';

/*
 * The brief's bottom line (DD-21 g; step 3 as built). A fixed rule over what the brief already
 * stores: each key finding's validated title, its basis and companies, and what the server-side
 * validator recorded for it (its figure checks, its period and claim checks, and whether a valid citation is left). Nothing is
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
  /** The claim checks of 2026-10-03 on this finding (architecture §6.9; empty for analyses stored before them). */
  claims: ClaimFlags;
}

/** What the arithmetic, attribution and sweeping-claim checks flagged under one location prefix, de-duplicated. */
export interface ClaimFlags {
  /** Stated changes their own two values do not give (one per from / to / stated change). */
  arithmetic: NonNullable<BriefValidation['arithmeticClaims']>;
  /** Companies named (or a cell's column company) with no citation from them, one per ticker, with the text that named it. */
  companies: Array<{ ticker: string; text: string; column?: boolean }>;
  /** Sweeping claims ("all five", "every company") wider than the item's citations (one per cue). */
  scope: NonNullable<BriefValidation['scopeClaims']>;
}

/**
 * Whether a validated location is under a prefix: the location itself, or a part of it. A prefix
 * that ends in "." or "[" is a container ("keyFindings[2]."); any other prefix matches only itself or
 * its parts after a "." or "[" boundary, so `values[1]` never matches `values[10]`.
 */
export function atLocation(location: string, prefix: string): boolean {
  if (location === prefix) return true;
  if (!location.startsWith(prefix)) return false;
  return /[.[]$/.test(prefix) || /^[.[]/.test(location.slice(prefix.length));
}

const under = <T extends { location: string }>(xs: readonly T[] | undefined, prefix: string) => (xs ?? []).filter((x) => atLocation(x.location, prefix));

/**
 * The claim-check flags under one location prefix (`keyFindings[2].`, `executiveSummary`), each
 * cue once: a title and its finding stating the same change, naming the same company, or saying
 * "all five" give one badge. Empty for analyses stored before the checks.
 */
export function claimFlagsAt(validation: BriefValidation | undefined, prefix: string): ClaimFlags {
  const companies: ClaimFlags['companies'] = [];
  for (const c of under(validation?.attributionClaims, prefix)) {
    c.companies.forEach((t, i) => {
      if (companies.some((x) => x.ticker === t)) return;
      const m = c.mentions?.find((x) => x.ticker === t) ?? c.mentions?.[i];
      companies.push({ ticker: t, text: m && m.ticker === t ? m.text : t, ...(m?.column ? { column: true } : {}) });
    });
  }
  const arithmetic: ClaimFlags['arithmetic'] = [];
  for (const c of under(validation?.arithmeticClaims, prefix)) if (!arithmetic.some((x) => x.from === c.from && x.to === c.to && x.stated === c.stated)) arithmetic.push(c);
  const scope: ClaimFlags['scope'] = [];
  for (const c of under(validation?.scopeClaims, prefix)) if (!scope.some((x) => x.cue === c.cue)) scope.push(c);
  return { arithmetic, companies, scope };
}

/** True when any claim check flagged something under the prefix. */
export const hasClaimFlags = (f: ClaimFlags) => f.arithmetic.length + f.companies.length + f.scope.length > 0;

/**
 * Which claim checks the brief shows as badges. Each was measured on the 106 recorded generations
 * plus the 3 production rehearsal briefs (evaluation.md §13, 2026-10-03 review): a check is shown
 * only with zero pure false alarms (and, for attribution, at least 4 of 5 flags real unsupported
 * positive claims). A check that fails the bar stays computed and reported in the evals, unshown.
 */
export const SHOWN_CLAIM_CHECKS = { arithmetic: true, attribution: true, scope: true } as const;

const countOf = (n: number) => `${n} ${n === 1 ? 'company' : 'companies'}`;

/**
 * The badges for a set of claim flags, in plain words (M4, 2026-10-03 review):
 * - arithmetic: "Change doesn't add up: says up 145%, figures give +671%";
 * - attribution: "Names Google Cloud (Alphabet); cites no Alphabet passage" (a comparison cell:
 *   "Apple column; cites no Apple passage");
 * - scope: "Says “all five”; cites 4 companies".
 * `name` maps a ticker to its short company name. Only checks in SHOWN_CLAIM_CHECKS give badges.
 */
export function claimBadges(flags: ClaimFlags, name: (ticker: string) => string): Array<{ key: string; label: string; detail: string }> {
  const out: Array<{ key: string; label: string; detail: string }> = [];
  if (SHOWN_CLAIM_CHECKS.arithmetic) {
    flags.arithmetic.forEach((c, i) =>
      out.push({
        key: `a${i}`,
        label: `Change doesn't add up: says ${c.stated}, figures give ${c.computed}`,
        detail: `From ${c.from} to ${c.to} is ${c.computed}, not ${c.stated}. Check the figures against the source.`,
      }),
    );
  }
  if (SHOWN_CLAIM_CHECKS.attribution) {
    for (const c of flags.companies) {
      const company = name(c.ticker);
      // The text as written, with the company when it is another name ("Google Cloud (Alphabet)"); a ticker or a short form of the name gives the name alone.
      const same = (x: string, y: string) => x.toLowerCase().startsWith(y.toLowerCase());
      const named = c.text === c.ticker || same(company, c.text) || same(c.text, company) ? company : `${c.text} (${company})`;
      out.push(
        c.column
          ? { key: `c${c.ticker}`, label: `${company} column; cites no ${company} passage`, detail: `This cell is about ${company} but its row cites no ${company} passage.` }
          : { key: `c${c.ticker}`, label: `Names ${named}; cites no ${company} passage`, detail: `This says something about ${company} but cites no ${company} passage.` },
      );
    }
  }
  if (SHOWN_CLAIM_CHECKS.scope) {
    flags.scope.forEach((c, i) =>
      out.push({
        key: `s${i}`,
        label: `Says “${c.cue}”; cites ${countOf(c.cited)}`,
        detail:
          c.cue === 'the only' || c.cue === 'the first'
            ? `This says “${c.cue}” but cites passages from ${countOf(c.cited)}, which cannot show what the others disclose.`
            : `This says “${c.cue}” (${countOf(c.scope)}) but cites passages from ${countOf(c.cited)}.`,
      }),
    );
  }
  return out;
}

/**
 * The fiscal periods the validator flagged under one location prefix (`keyFindings[2].`,
 * `executiveSummary`), in order, de-duplicated. Empty for analyses stored before the check.
 */
export function uncitedPeriodsAt(validation: BriefValidation | undefined, prefix: string): string[] {
  const out: string[] = [];
  for (const c of validation?.periodClaims ?? []) if (atLocation(c.location, prefix)) for (const p of c.periods) if (!out.includes(p)) out.push(p);
  return out;
}

/** The figures the validator checked under one location prefix, tallied by outcome. */
export function tallyFigures(validation: BriefValidation | undefined, prefix: string): FigureTally {
  const figures = (validation?.numeric.figures ?? []).filter((f) => atLocation(f.location, prefix));
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
    claims: claimFlagsAt(validation, `keyFindings[${i}].`),
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

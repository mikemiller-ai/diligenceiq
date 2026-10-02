import type { SignalCategory, SignalType } from '@diligenceiq/core';

/*
 * The curated "General context" library (SPEC §32.7, DD-16): the one allowed, labeled
 * exception to "no hardcoded demo answers". Hand-written, generic, one entry per signal
 * category. It never names a company, never states a figure and never claims what happened;
 * the dashboard renders it with a "General context" label (whyThisMattersSource:
 * 'general_context'). profile.test.ts ("General context library") enforces those rules.
 *
 * Versioned as `templateVersion`: any change to this file or to the deterministic templates in
 * assemble.ts is a new TEMPLATE_VERSION, which names a new deterministic set (det-v<N>).
 */
export const TEMPLATE_VERSION = '2';

export const GENERAL_CONTEXT: Readonly<Record<SignalCategory, string>> = {
  performance:
    'Overall results set the base for every other question: a change in sales or profit usually traces back to volume, price, mix or cost, and each points to a different line of inquiry.',
  growth:
    'A change in the pace of sales growth often comes before changes in margins and cash flow, so it is worth asking what drove it and whether management expects it to continue.',
  margin:
    'Margins show how much of each sale the business keeps. A move in either direction usually comes from pricing, product mix, input costs or scale, and the filing’s discussion of results often says which.',
  liquidity:
    'Cash and access to funding decide how much room a business has to invest, absorb a downturn or return capital, independent of reported profit.',
  debt:
    'Borrowing levels, maturities and covenants shape financial flexibility; refinancing needs and interest costs matter more when rates or results move.',
  regulatory:
    'New or changing rules can raise compliance costs, limit how products are sold, or require changes to the business model, sometimes with little warning.',
  competition:
    'Competitive pressure tends to show up first in pricing, market share and spending on product development or marketing.',
  customer_concentration:
    'When a few customers or channels drive a large share of sales, losing or renegotiating with one of them can move results.',
  geographic_concentration:
    'Dependence on particular countries or regions exposes results to local demand, currency moves, trade policy and political events.',
  supply_chain:
    'Reliance on particular suppliers, manufacturing partners or locations can interrupt production or raise costs when one of them is disrupted.',
  cybersecurity:
    'Security incidents and system failures can interrupt operations, expose customer data, and bring regulatory penalties and lasting reputational damage.',
  litigation:
    'Lawsuits and government investigations can lead to fines, settlements or required changes in conduct, and their outcomes are often uncertain for years.',
  management_outlook:
    'What management says it expects, and how that changes from one report to the next, frames which assumptions are worth testing against the reported results.',
};

/** Templated "what changed" text per signal type: describes the evidence, never a conclusion. */
export const WHAT_CHANGED_TEMPLATE: Readonly<Record<SignalType, string>> = {
  TREND_CHANGE: 'The change is computed from one annual report’s own comparative columns; the measurement shows the figures and the threshold that produced the label.',
  PERSISTENT: 'A closely matching risk heading appears in each annual report over the span shown; the evidence opens the passage from every report.',
  NEW: 'A risk heading in the latest annual report has no close match in the one before it.',
  REDUCED: 'A risk heading in the prior annual report has no close match in the latest one.',
  EXPANDED: 'The latest annual report discusses this topic more than the one before it.',
  OUTLOOK_CHANGE: 'Management’s discussion of the outlook changed between annual reports.',
};

import type { AnalysisDetail, BriefValidation } from '@diligenceiq/core';
import { AlertTriangle, CheckCircle2, Compass, Grid3x3, ShieldAlert } from 'lucide-react';
import { TickerBadge } from '@/components/diligence/badges';
import { SectionHeading } from '@/components/diligence/page';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { companyName } from '@/fixtures';
import { pluralize } from '@/lib/format';
import { cn } from '@/lib/utils';

/*
 * The parts of a Diligence Brief that show how it was produced (SPEC §15.2, P0): the
 * Interpretation panel, the company × period coverage matrix, numeric-grounding badges and
 * validation notices. All of it is server-computed and deterministic; nothing here is model text.
 */

type Figure = BriefValidation['numeric']['figures'][number];

const PERIOD_RULE: Record<string, string> = {
  current: 'Current view: the latest annual report and the quarterly reports after it',
  last_n: 'The last few complete fiscal years',
  years: 'The fiscal years the question names',
  range: 'A fiscal-year range, from the question or your filter',
  since: 'From the year the question names to the latest report',
  quarters: 'The quarters the question names',
};

const VIA: Record<string, string> = {
  name: 'named in the question',
  ticker: 'its ticker is in the question',
  sector: 'a member of a sector the question names',
  filter: 'from your company filter',
};

/** How the system read the question: companies, periods, filing types, filters and caveats. */
export function InterpretationPanel({ analysis }: { analysis: AnalysisDetail }) {
  const it = analysis.interpretation;
  if (!it) return null;
  const rule = it.periodRule ? (PERIOD_RULE[it.periodRule.kind] ?? it.periodRule.kind) : null;
  const filters = analysis.filters;
  return (
    <section aria-labelledby="interpretation" className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Compass aria-hidden className="size-4 text-primary" />
        <h2 id="interpretation" className="text-sm font-semibold text-foreground">
          How the question was read
        </h2>
      </div>
      <dl className="grid gap-3 px-4 py-3 text-sm">
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Companies</dt>
          <dd className="mt-1 flex flex-col gap-1.5">
            {(it.scopes ?? it.companies.map((t) => ({ ticker: t, company: companyName(t), via: '', periods: [], description: '' }))).map((s) => (
              <div key={s.ticker} className="flex flex-wrap items-baseline gap-1.5">
                <TickerBadge ticker={s.ticker} />
                <span className="text-foreground">{s.company}</span>
                {VIA[s.via] && <span className="text-xs text-muted-foreground">· {VIA[s.via]}</span>}
                {s.periods.length > 0 && <span className="basis-full pl-1 text-xs text-foreground/75">{s.periods.join(' · ')}</span>}
              </div>
            ))}
            {it.companies.length === 0 && <span className="text-muted-foreground">No specific company: the search ran across the corpus.</span>}
          </dd>
        </div>
        {it.sectors && it.sectors.length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Sectors</dt>
            <dd className="mt-1 text-foreground/85">
              {it.sectors.map((s) => `“${s.phrase}” → ${s.tickers.join(', ')}`).join('; ')}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Period</dt>
          <dd className="mt-1 text-foreground/85">
            {rule ?? it.periods.join(' · ')}
            {it.periodRule?.phrase && <span className="text-muted-foreground"> (from “{it.periodRule.phrase}”)</span>}
            {it.periodRule?.assumption && <span className="block text-xs text-muted-foreground">{it.periodRule.assumption}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground">Sources</dt>
          <dd className="mt-1 text-foreground/85">{it.filingTypes.map((t) => (t === '10-K' ? 'Annual reports (10-K)' : 'Quarterly reports (10-Q)')).join(' and ')}</dd>
        </div>
        {filters && (filters.tickers?.length || filters.filingTypes?.length || filters.fiscalYearFrom || filters.fiscalYearTo) ? (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Your filters</dt>
            <dd className="mt-1 text-foreground/85">
              {[
                filters.tickers?.length ? filters.tickers.join(', ') : null,
                filters.filingTypes?.length ? filters.filingTypes.join(', ') : null,
                filters.fiscalYearFrom || filters.fiscalYearTo ? `FY${filters.fiscalYearFrom ?? '…'}–FY${filters.fiscalYearTo ?? '…'}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        ) : null}
        {it.retrievalMode === 'bm25' && (
          <p className="flex items-start gap-2 rounded-md bg-risk-med/10 px-2.5 py-2 text-xs text-foreground/85">
            <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-risk-med" />
            The semantic part of the search was unavailable, so this brief used keyword search only.
          </p>
        )}
        {[...it.coverageWarnings, ...(it.notes ?? [])].length > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Notes</dt>
            <dd className="mt-1">
              <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-foreground/80">
                {[...new Set([...it.coverageWarnings, ...(it.notes ?? [])])].map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

/** Company × period: how many passages the brief had for each cell, and how many it cited. */
export function CoverageMatrix({ analysis }: { analysis: AnalysisDetail }) {
  const cells = analysis.coverage?.cells ?? [];
  if (cells.length === 0) return null;
  const tickers = [...new Set(cells.map((c) => c.ticker))];
  return (
    <section aria-labelledby="coverage" className="mt-8">
      <SectionHeading id="coverage">Evidence coverage</SectionHeading>
      <p className="mt-1 text-sm text-muted-foreground">Passages supplied for each company and period, and how many the brief cites. An empty cell means the filings had nothing relevant for it.</p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Evidence coverage by company and period</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">
                <Grid3x3 aria-hidden className="mr-1 inline size-3.5" />
                Company
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Periods (passages supplied · cited)
              </th>
            </tr>
          </thead>
          <tbody>
            {tickers.map((t) => (
              <tr key={t} className="border-b border-border last:border-0">
                <th scope="row" className="whitespace-nowrap px-4 py-2.5 text-left align-top font-medium text-foreground">
                  <TickerBadge ticker={t} /> <span className="ml-1">{companyName(t)}</span>
                </th>
                <td className="px-4 py-2.5">
                  <ul className="flex flex-wrap gap-1.5">
                    {cells
                      .filter((c) => c.ticker === t)
                      .map((c) => (
                        <li
                          key={c.period}
                          className={cn(
                            'rounded-md border px-2 py-1 text-xs',
                            c.contextChunks === 0 ? 'border-risk-med/40 bg-risk-med/10 text-foreground' : 'border-border bg-background text-foreground/85',
                          )}
                        >
                          <span className="font-medium">{c.period}</span>{' '}
                          <span className="tabular-nums text-muted-foreground">
                            {c.contextChunks === 0 ? 'no evidence' : `${c.contextChunks} · ${c.citedChunks} cited`}
                          </span>
                        </li>
                      ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Figures at a location (or under a location prefix such as `keyFindings[2].`). */
export function figuresAt(validation: BriefValidation | undefined, ...prefixes: string[]): Figure[] {
  return (validation?.numeric.figures ?? []).filter((f) => prefixes.some((p) => f.location === p || f.location.startsWith(p)));
}

/**
 * Numeric-grounding badges (SPEC §15.2): any currency or percentage figure not found in its
 * cited passages is marked. A `unit_unstated` near match (the digits are a table cell in a
 * passage that does not state its unit) is marked separately and is not counted as verified.
 */
export function FigureBadges({ figures }: { figures: readonly Figure[] }) {
  const unverified = figures.filter((f) => !f.verified);
  if (unverified.length === 0) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {unverified.map((f, i) =>
        f.rule === 'unit_unstated' ? (
          <Tooltip key={`${f.location}-${i}`} content="These digits appear in a table cell of a cited passage, but the passage does not state the table's unit, so the figure is not counted as verified.">
            <Badge tone="neutral" className="cursor-help">
              Unit not stated: {f.figure}
            </Badge>
          </Tooltip>
        ) : (
          <Tooltip key={`${f.location}-${i}`} content="This figure was not found in the passages this item cites. Check it against the source before relying on it.">
            <Badge tone="warning" className="cursor-help">
              Unverified figure: {f.figure}
            </Badge>
          </Tooltip>
        ),
      )}
    </span>
  );
}

/** Validation summary for the Sources rail: citations, removed IDs, figures, uncited items, notices. */
export function ValidationSummary({ validation, citedCount }: { validation: BriefValidation | undefined; citedCount: number }) {
  if (!validation) return null;
  const removed = validation.citations.removed.length;
  const { total, verified, unitUnstated } = validation.numeric;
  const rows: Array<{ ok: boolean; text: string }> = [
    removed === 0
      ? { ok: true, text: `All ${pluralize(citedCount, 'cited passage')} were among the passages supplied to the model.` }
      : { ok: false, text: `${pluralize(removed, 'citation')} removed: not in the supplied evidence.` },
    total === 0
      ? { ok: true, text: 'No currency or percentage figures to check.' }
      : verified === total
        ? { ok: true, text: `All ${total} figures found in their cited passages.` }
        : { ok: false, text: `${verified} of ${total} figures found in their cited passages${unitUnstated ? ` (${unitUnstated} more match a table whose unit is not stated)` : ''}; the rest are marked.` },
  ];
  if (validation.uncited.length) rows.push({ ok: false, text: `${pluralize(validation.uncited.length, 'item')} left without a valid citation.` });
  const notices = validation.notices.filter((n) => !/citation removed|figure/i.test(n));
  return (
    <ul className="flex flex-col gap-1.5 border-b border-border px-4 py-2.5 text-xs" aria-label="Validation">
      {rows.map((r) => (
        <li key={r.text} className="flex items-start gap-2">
          {r.ok ? <CheckCircle2 aria-hidden className="mt-px size-3.5 shrink-0 text-ok" /> : <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0 text-risk-med" />}
          <span className={r.ok ? 'text-foreground/80' : 'text-foreground'}>{r.text}</span>
        </li>
      ))}
      {notices.map((n) => (
        <li key={n} className="flex items-start gap-2 text-foreground/80">
          <AlertTriangle aria-hidden className="mt-px size-3.5 shrink-0 text-muted-foreground" />
          {n}
        </li>
      ))}
    </ul>
  );
}

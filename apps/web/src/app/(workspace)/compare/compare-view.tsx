'use client';

import {
  COMPARE_MAX,
  COMPARE_MIN,
  compareRowRef,
  composeCompare,
  isFixtureProfile,
  type Citation,
  type CompanyIntelligenceProfile,
  type CompareResult,
  type Trajectory,
} from '@diligenceiq/core';
import { ArrowUpRight, ChevronDown, Columns3 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { TickerBadge } from '@/components/diligence/badges';
import { CompanySelect } from '@/components/diligence/company-select';
import { CitationList } from '@/components/diligence/evidence';
import { PageContainer, PageHeader } from '@/components/diligence/page';
import { SaveFindingButton } from '@/components/diligence/save-finding-dialog';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { EmptyState, NoticeBar } from '@/components/diligence/states';
import { Clamp, ShowMore } from '@/components/intelligence/condense';
import { PlaceholderBadge, PlaceholderSlot } from '@/components/intelligence/placeholder';
import { DIRECTION_WORD, LEGEND, SignalChip, Sparkline } from '@/components/intelligence/signals';
import { Term } from '@/components/intelligence/term';
import { JumpBar, type JumpLink } from '@/components/diligence/jump-bar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { companies, companyName } from '@/fixtures';
import { TIER_COPY } from '@/fixtures/profiles';
import { compareBottomLine, latestValue, lineLegend, oppositeNote, priorGrowth, riskGrid, tintStep, trendRead, type CompareLine, type GridCell, type GridRow } from '@/lib/compare-summary';
import { formatDate, pluralize } from '@/lib/format';
import { TRAJECTORY_LABEL } from '@/lib/labels';
import { compareHref, newAnalysisHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';

const OPTIONS = companies().filter((c) => !c.outsideWindow);
const KNOWN = new Set(OPTIONS.map((c) => c.ticker));
const STARTER = ['AAPL', 'MSFT', 'NVDA'];

const PREVIEW_COPY =
  'Computed from each company’s full profile once it is built. These preview profiles list the headings an extraction rule found; the rule can miss some headings and can include a sentence that is not a heading, so no comparison is drawn from them.';

const RANK_RULE =
  'Ordered by a fixed rule: how many selected companies share the area, then the number of change signals, then its position in the latest risk headings, then a fixed category order.';

/** What each row of the side-by-side table measures, in plain words. */
const METRIC_NOTE: Record<string, string> = {
  Revenue: 'total sales',
  'Operating margin': 'operating income per $1 of sales',
  'Operating income': 'profit from running the business',
  'Operating cash flow': 'cash from operations',
};

export { trendRead };

export function CompareView() {
  const router = useRouter();
  const { profiles, profileStates, loadProfile, status } = useWorkspace();
  const tickers = (useSearchParams().get('tickers') ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t, i, all) => KNOWN.has(t) && all.indexOf(t) === i)
    .slice(0, COMPARE_MAX);
  const setTickers = (next: string[]) => router.replace(compareHref(next));

  // Profiles come from the active set on the server, loaded once each; Compare composes them
  // deterministically (DD-19). Nothing here can generate.
  const key = tickers.join(',');
  React.useEffect(() => {
    if (status === 'ready') for (const t of key.split(',').filter(Boolean)) void loadProfile(t);
  }, [key, status, loadProfile]);
  // No workspace (the session failed): the banner explains and offers Retry; never an endless skeleton.
  const noWorkspace = status === 'error';
  const loading = !noWorkspace && (status !== 'ready' || tickers.some((t) => !profiles.has(t) && (profileStates.get(t) ?? 'loading') === 'loading'));
  const failed = tickers.filter((t) => profileStates.get(t) === 'error');
  const outcome = tickers.length >= COMPARE_MIN && !loading && !noWorkspace ? composeCompare(tickers, profiles) : null;

  return (
    <PageContainer className="max-w-[1200px]">
      <PageHeader
        eyebrow="Investigate"
        title="Compare"
        description="Choose two to five companies to see where their trends, risks and attention areas agree and where they differ."
      />

      <div className="mb-8 flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <Label htmlFor="compare-companies">Companies</Label>
        <CompanySelect id="compare-companies" options={OPTIONS} value={tickers} onChange={setTickers} max={COMPARE_MAX} />
        {tickers.length < COMPARE_MIN && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Select at least two companies.
            <Button size="sm" variant="secondary" onClick={() => setTickers(STARTER)}>
              Try Apple, Microsoft and NVIDIA
            </Button>
          </div>
        )}
      </div>

      {tickers.length >= COMPARE_MIN && loading && <PageSkeleton />}
      {tickers.length >= COMPARE_MIN && noWorkspace && (
        <NoticeBar className="mb-4">Company profiles cannot be loaded because your demo workspace could not be opened. The notice above explains why; use its Retry.</NoticeBar>
      )}
      {failed.length > 0 && (
        <NoticeBar className="mb-4">
          Intelligence for {failed.map(companyName).join(', ')} could not be loaded right now. Reload the page to try again.
        </NoticeBar>
      )}
      {outcome && !outcome.ok && (
        <EmptyState
          icon={Columns3}
          title="Not enough companies have intelligence built to compare"
          description={
            outcome.code === 'PROFILE_MISSING' && outcome.missing.length > 0
              ? `Intelligence isn’t built yet for ${outcome.missing.map(companyName).join(', ')}. Compare needs at least two companies with profiles.`
              : 'Compare needs two to five different companies with profiles.'
          }
          action={
            <Button asChild variant="secondary">
              <Link href={newAnalysisHref({ tickers })}>Ask a comparison question in Deep Analysis</Link>
            </Button>
          }
        />
      )}
      {outcome?.ok && <CompareBody result={outcome.result} profiles={profiles} />}
    </PageContainer>
  );
}

function CompareBody({ result, profiles }: { result: CompareResult; profiles: ReadonlyMap<string, CompanyIntelligenceProfile> }) {
  const citations = React.useMemo(() => new Map(result.citations.map((c) => [c.chunkId, c])), [result.citations]);
  const tickers = result.companies.map((c) => c.ticker);
  const isPreview = (t: string) => {
    const p = profiles.get(t);
    return !p || isFixtureProfile(p);
  };
  // Preview (fixture) profiles hold an extracted heading list of imperfect recall, so anything
  // that depends on a company's complete list (the risk-area grid, the shared and distinctive
  // lines, the questions derived from them) is a labeled placeholder whenever one is compared (SPEC §8.6, §13.2).
  const preview = tickers.some(isPreview);
  const majorArea = (ticker: string) => result.attentionRanking.find((r) => r.tickers.includes(ticker))?.label ?? '—';
  const names = result.companies.map((c) => c.company);
  const listNames = names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
  const questions = preview
    ? [
        {
          ref: 'risk-factors',
          question: `Compare the primary risk factors ${listNames} describe in their latest annual reports.`,
          why: 'Templated from the companies you selected; it does not depend on which risks the profiles show.',
          tickers,
        },
      ]
    : result.recommendedDiligence;
  const emphasisBuilt = result.managementEmphasis.some((m) => m.summary !== null);
  const lines = compareBottomLine(result, profiles, preview);
  const grid = preview ? [] : riskGrid(result, profiles);
  const showDiverging = result.diverging.length > 0 || preview;

  const links: JumpLink[] = [
    ...(lines.length ? [{ id: 'bottom-line', label: 'Bottom line' }] : []),
    { id: 'side-by-side', label: 'Side by side', count: result.trajectories.length },
    ...(showDiverging ? [{ id: 'diverging', label: 'Diverging trends', ...(result.diverging.length ? { count: result.diverging.length } : {}) }] : []),
    { id: 'risk-areas', label: 'Risk areas', ...(preview ? {} : { count: grid.length }) },
    { id: 'emphasis', label: 'Management emphasis' },
    { id: 'ask-next', label: 'Ask next', count: questions.length },
  ];

  return (
    <div className="flex flex-col gap-10">
      <JumpBar links={links} className="-mb-4 -mt-6" />

      {(result.missing.length > 0 || result.notes.length > 0) && (
        <NoticeBar>
          {result.missing.length > 0 && (
            <p>Not compared (intelligence not built yet): {result.missing.map(companyName).join(', ')}.</p>
          )}
          {result.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </NoticeBar>
      )}

      {lines.length > 0 && <CompareBottomLine lines={lines} />}

      <section aria-labelledby="side-by-side">
        <h2 id="side-by-side" className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
          Side by side
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Direction, latest value and change for each company, with the trend over the years the filings support.</p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <caption className="sr-only">Companies side by side</caption>
            <THead>
              <tr>
                <TH className="normal-case tracking-normal">Measure</TH>
                {result.companies.map((c) => (
                  <TH key={c.ticker} className="h-auto py-2.5 align-top normal-case tracking-normal">
                    <span className="flex items-center gap-2">
                      <TickerBadge ticker={c.ticker} />
                      <span className="text-[13px] font-semibold text-foreground">{c.company}</span>
                    </span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {TIER_COPY[c.tier].label} · FY ends {formatDate(c.fiscalYearEnd)}
                    </span>
                  </TH>
                ))}
                <TH className="w-px normal-case tracking-normal">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              {result.trajectories.map((t) => (
                <TR key={t.metric} data-metric={t.metric} className="hover:bg-transparent">
                  <TH scope="row" className="h-auto min-w-36 whitespace-normal py-3 align-top text-sm font-medium normal-case tracking-normal text-foreground">
                    <Term>{t.metric}</Term>
                    {METRIC_NOTE[t.metric] && <span className="block text-xs font-normal text-muted-foreground">{METRIC_NOTE[t.metric]}</span>}
                  </TH>
                  {t.values.map((v) => (
                    <TD key={`${t.metric}-${v.ticker}`} className="py-3 align-top">
                      <TrendCell profile={profiles.get(v.ticker)} company={result.companies.find((c) => c.ticker === v.ticker)?.company ?? v.ticker} metric={t.metric} trajectory={v.trajectory} preview={isPreview(v.ticker)} />
                    </TD>
                  ))}
                  <TD className="text-right align-top">
                    <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.trajectory(t.metric) }} variant="ghost" label="Save" />
                  </TD>
                </TR>
              ))}
              <Row label="Major attention area" cells={tickers.map((t) => (preview ? 'Placeholder' : majorArea(t)))} muted={preview} />
            </TBody>
          </Table>
        </div>
        {!preview && <TrendLegend />}
        {!showDiverging && lines.length === 0 && <p className="mt-2 text-xs text-muted-foreground">No metric points in opposite directions across these companies.</p>}
      </section>

      {showDiverging && (
        <section aria-labelledby="diverging">
          <h2 id="diverging" className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
            Diverging trends
          </h2>
          <div className="mt-3">
            {result.diverging.length === 0 ? (
              <PlaceholderSlot title="Diverging trends">
                Metrics whose trends point in opposite directions across the selected companies, once figures are extracted.
              </PlaceholderSlot>
            ) : (
              <ul className="flex flex-col gap-2">
                {result.diverging.map((d) => (
                  <li key={d.metric} className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-3 text-sm">
                    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                      <span className="font-semibold text-foreground">{d.metric}</span>
                      <span className="flex flex-wrap gap-1.5">
                        {[...d.up.map((t) => [t, 'rising'] as const), ...d.down.map((t) => [t, 'falling'] as const)].map(([t, word]) => {
                          const trajectory = result.trajectories.find((r) => r.metric === d.metric)?.values.find((v) => v.ticker === t)?.trajectory;
                          const read = trajectory ? trendRead(profiles.get(t), d.metric, trajectory) : null;
                          if (read?.kind !== 'chip') {
                            // Not read back, or about an older year than the latest annual report: no colour, and the year is named.
                            return (
                              <span key={t} className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2 py-0.5 text-[12px] font-medium text-foreground/80">
                                {companyName(t)}: {word}
                                {read?.kind === 'stale' && <span data-allow-figures className="font-normal text-muted-foreground">(latest trend {read.period})</span>}
                              </span>
                            );
                          }
                          return (
                            <SignalChip key={t} direction={read.change.direction} neutral={read.change.neutral}>
                              {companyName(t)}: {word}
                              {read.change.neutral && <span className="sr-only">, neither direction is better</span>}
                            </SignalChip>
                          );
                        })}
                      </span>
                    </span>
                    <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.diverging(d.metric) }} variant="ghost" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="risk-areas">
        <h2 id="risk-areas" className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
          Risk areas
        </h2>
        {preview ? (
          <div className="mt-3">
            <PlaceholderSlot title="Risk areas side by side">{PREVIEW_COPY}</PlaceholderSlot>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">Which risk areas each company’s latest annual report covers, with its headings and change signals in each.</p>
            <RiskGrid rows={grid} result={result} tickers={tickers} citations={citations} />
          </>
        )}
      </section>

      <section aria-labelledby="emphasis">
        <h2 id="emphasis" className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
          Management emphasis
        </h2>
        <div className="mt-3">
          {emphasisBuilt ? (
            <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {result.managementEmphasis.map((m) => (
                <li key={m.ticker} className="rounded-card border border-border bg-card px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <TickerBadge ticker={m.ticker} />
                    <span className="font-semibold text-foreground">{companyName(m.ticker)}</span>
                    {m.source === 'model' && <span className="ml-auto text-xs text-muted-foreground">Model-written</span>}
                  </div>
                  {m.summary === null ? (
                    // Only the offline profile call writes an outlook: nothing was looked for and missed.
                    <p className="mt-1 italic text-muted-foreground">Not summarized</p>
                  ) : (
                    <Clamp text={m.summary} lines={3} className="mt-1.5 text-foreground/80" after={<CitationList ids={m.citationIds} context={citations} provenance="profile" claim={m.summary} />}>
                      {m.summary}
                    </Clamp>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <PlaceholderSlot title="Management emphasis">
              For each company, the outlook topics its latest management discussion emphasizes most, with the passages.
            </PlaceholderSlot>
          )}
        </div>
      </section>

      <section aria-labelledby="ask-next">
        <h2 id="ask-next" className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
          Ask next
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Each opens Deep Analysis with the question filled in. Nothing runs until you click Run analysis.</p>
        {preview && (
          <div className="mt-3">
            <PlaceholderSlot title="Questions from shared, distinctive and diverging areas">{PREVIEW_COPY}</PlaceholderSlot>
          </div>
        )}
        <div className="mt-3">
          <ShowMore
            items={questions}
            initial={3}
            noun={['question', 'questions']}
            className="flex flex-col gap-2"
            render={(r) => (
              <li key={r.ref} className="flex flex-col gap-3 rounded-card border border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-foreground">{r.question}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Why suggested: {r.why}</p>
                </div>
                <Button asChild size="sm">
                  <Link href={newAnalysisHref({ question: r.question, tickers: r.tickers, origin: { kind: 'compare', tickers, ref: r.ref } })}>
                    Investigate <ArrowUpRight />
                  </Link>
                </Button>
              </li>
            )}
          />
        </div>
      </section>
    </div>
  );
}

/** The comparison bottom line (DD-21 h): fixed-rule lines over the stored profiles, each linking to its section. */
function CompareBottomLine({ lines }: { lines: CompareLine[] }) {
  const legend = lineLegend(lines);
  return (
    <section aria-labelledby="bottom-line" className="rounded-card border border-border border-l-4 border-l-primary bg-card px-5 py-4 shadow-sm">
      <h2 id="bottom-line" className="scroll-mt-40 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
        Bottom line
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-border" data-allow-figures>
        {lines.map((l) => (
          <li key={l.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <SignalChip direction={l.direction} neutral={l.neutral} className="min-w-[1.75rem] justify-center px-1.5">
              <span className="sr-only">{l.chipText}</span>
            </SignalChip>
            <a href={`#${l.anchor}`} className="text-[15px] font-semibold text-foreground hover:text-primary">
              {l.title}
            </a>
            <span className="text-sm text-muted-foreground">{l.detail}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground" data-allow-figures>
        {oppositeNote(lines)}
        {lines.some((l) => l.opposite) && ' Rising includes still growing, more slowly.'} Each change is from the prior year in that company’s own latest fiscal year, so the
        years can differ. Each line links to its section.
      </p>
      <ul aria-label="Legend" className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {legend.items.map((l) => (
          <li key={l.direction} className="inline-flex items-center gap-1.5">
            <SignalChip direction={l.direction} className="px-1">
              <span className="sr-only">{DIRECTION_WORD[l.direction]}</span>
            </SignalChip>
            {l.text}
          </li>
        ))}
        {legend.grey && (
          <li className="inline-flex items-center gap-1.5">
            <SignalChip direction="up" neutral className="px-1">
              <span className="sr-only">arrow without colour</span>
            </SignalChip>
            no colour: one company differs, or neither direction is better
          </li>
        )}
      </ul>
    </section>
  );
}

function Row({ label, cells, muted = false, action }: { label: string; cells: string[]; muted?: boolean; action?: React.ReactNode }) {
  return (
    <TR className="hover:bg-transparent">
      <TH scope="row" className="h-auto py-2.5 text-sm font-medium normal-case tracking-normal text-foreground">
        {label}
      </TH>
      {cells.map((c, i) => (
        <TD key={`${label}-${i}`} className={muted && /Not extracted|Limited history|Placeholder/.test(c) ? 'italic text-muted-foreground' : 'text-foreground'}>
          {c === 'Placeholder' ? <PlaceholderBadge /> : c}
        </TD>
      ))}
      <TD className="text-right">{action}</TD>
    </TR>
  );
}

/** Token tints by number of headings: the count is always printed too, so colour is never the only cue. */
const TINT = ['bg-secondary', 'bg-primary/10', 'bg-primary/15', 'bg-primary/20', 'bg-primary/30'];

/**
 * One risk-area grid (DD-21 h): a row per area in the attention ranking's order, a column per
 * company. It replaces the common, distinctive and ranking lists; rows after the fifth fold.
 */
function RiskGrid({ rows, result, tickers, citations }: { rows: GridRow[]; result: CompareResult; tickers: string[]; citations: Map<string, Citation> }) {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const reveal = React.useRef(false);
  const initial = 5;
  const folded = rows.length - initial;
  React.useEffect(() => {
    // After "Show all", focus moves to the first row that was revealed.
    if (open && reveal.current) (bodyRef.current?.children[initial] as HTMLElement | undefined)?.focus();
    reveal.current = false;
  }, [open]);
  if (rows.length === 0) return <p className="mt-3 rounded-card border border-border bg-card px-4 py-3 text-sm text-muted-foreground">No risk area is classified for these companies.</p>;
  return (
    <>
      <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
        <Table>
          <caption className="sr-only">Risk areas by company</caption>
          <THead>
            <tr>
              <TH className="normal-case tracking-normal">Risk area</TH>
              {result.companies.map((c) => (
                <TH key={c.ticker} className="normal-case tracking-normal">
                  <TickerBadge ticker={c.ticker} />
                  <span className="sr-only"> {c.company}</span>
                </TH>
              ))}
              <TH className="w-px normal-case tracking-normal">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody id={bodyId} ref={bodyRef}>
            {rows.map((r, i) => (
              <TR key={r.category} data-area={r.label} className="hover:bg-transparent" hidden={folded > 0 && i >= initial && !open} tabIndex={i === initial ? -1 : undefined}>
                <TH scope="row" className="h-auto min-w-44 py-2 text-sm font-medium normal-case tracking-normal text-foreground">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="w-5 font-mono text-xs text-muted-foreground">
                      <span aria-hidden>{String(r.rank).padStart(2, '0')}</span>
                      <span className="sr-only">Rank {r.rank}</span>
                    </span>
                    <span className="font-semibold">{r.label}</span>
                    <span className="rounded-md bg-accent px-1.5 py-px text-xs font-medium text-primary">{r.share}</span>
                  </span>
                </TH>
                {r.cells.map((cell, ci) => (
                  <TD key={result.companies[ci]!.ticker} className="px-2 py-1.5">
                    {cell ? (
                      <GridCellButton cell={cell} area={r.label} citations={citations} />
                    ) : (
                      <span className="px-2 text-xs text-muted-foreground">
                        <span aria-hidden>—</span>
                        <span className="sr-only">Not in this company’s areas</span>
                      </span>
                    )}
                  </TD>
                ))}
                <TD className="text-right">
                  <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.theme(r.category) }} variant="ghost" label="Save" />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {folded > 0 && (
          <div className="px-4 pb-3 pt-1">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => {
                reveal.current = !open;
                setOpen((o) => !o);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-medium text-primary hover:underline"
            >
              <ChevronDown aria-hidden className={open ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
              {open ? 'Show fewer areas' : `Show all ${rows.length} areas`}
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Darker cells have more risk headings in the latest annual report; each cell opens its headings, signals and passages. {RANK_RULE} It is an order for investigation, not a rating.
      </p>
    </>
  );
}

function GridCellButton({ cell, area, citations }: { cell: GridCell; area: string; citations: Map<string, Citation> }) {
  const h = cell.headings.length;
  const s = cell.signals.length;
  // The accessible name holds the visible text ("No heading · 1 signal").
  const counts = [h ? pluralize(h, 'heading') : 'No heading', s ? pluralize(s, 'signal') : null].filter(Boolean).join(' · ');
  const titleId = React.useId();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${cell.company}, ${area}: ${counts}`}
          className={`flex w-full min-w-32 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-foreground hover:ring-1 hover:ring-primary ${TINT[tintStep(h)]}`}
        >
          <span className="text-[12.5px] font-semibold">{h ? pluralize(h, 'heading') : 'No heading'}</span>
          <span className="text-xs text-foreground/75">{s ? pluralize(s, 'signal') : ''}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId} className="w-[min(26rem,calc(100vw-2rem))] p-3 text-sm">
        <p id={titleId} className="font-semibold text-foreground">
          {cell.company} · {area}
        </p>
        {h > 0 && (
          <>
            <p className="mt-2 text-xs font-medium text-muted-foreground">Latest risk headings</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-foreground/85">
              {cell.headings.map((x) => (
                <li key={`${x.rank}-${x.heading}`}>{x.heading}</li>
              ))}
            </ul>
          </>
        )}
        {s > 0 && (
          <>
            <p className="mt-2 text-xs font-medium text-muted-foreground">Signals</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-foreground/85">
              {cell.signals.map((x, i) => (
                <li key={`${i}-${x.headline}`}>{x.headline}</li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Passages: <CitationList ids={cell.citationIds} context={citations} provenance="profile" claim={area} />
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A trend cell: the builder's trajectory label on a direction chip, the latest value and the
 * builder's change with its period, and a sparkline of the comparable values. Green and red only
 * for more-is-more metrics; a Financials company's operating cash flow keeps its arrow without a
 * colour. A trend about an older year than the latest annual report gets the plain label and a
 * note naming its year; one that does not read back gets the plain label only.
 */
function TrendCell({
  profile,
  company,
  metric,
  trajectory,
  preview,
}: {
  profile: CompanyIntelligenceProfile | undefined;
  company: string;
  metric: string;
  trajectory: Trajectory;
  preview: boolean;
}) {
  if (preview && trajectory === 'not_extracted') return <PlaceholderBadge />;
  const label = TRAJECTORY_LABEL[trajectory];
  const read = trendRead(profile, metric, trajectory);
  if (read.kind === 'stale') {
    return (
      <span className="flex flex-col items-start gap-0.5" data-allow-figures>
        <span className="text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">latest trend {read.period}</span>
      </span>
    );
  }
  if (read.kind === 'plain' || !profile) return <span className={trajectory === 'not_extracted' || trajectory === 'limited_history' ? 'italic text-muted-foreground' : 'text-foreground'}>{label}</span>;
  const change = read.change;
  const value = latestValue(profile, read);
  const prior = priorGrowth(read);
  const series = change.series;
  return (
    <span className="flex flex-col items-start gap-0.5" data-allow-figures>
      <span className="flex items-center gap-2">
        <SignalChip direction={change.direction} neutral={change.neutral}>
          {label}
          {change.neutral && <span className="sr-only">, neither direction is better</span>}
        </SignalChip>
        {series.length >= 2 && (
          <Sparkline width={64} values={series.map((p) => p.value)} direction={change.neutral ? 'flat' : change.direction} label={`${metric}, ${company}, ${series[0]!.period} to ${series.at(-1)!.period}`} />
        )}
      </span>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
        {value && <>{value} · </>}
        {change.text} in {change.period}
      </span>
      {prior && <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{prior}</span>}
    </span>
  );
}

const TREND_LEGEND = LEGEND.filter((l) => l.direction === 'up' || l.direction === 'down' || l.direction === 'slowing' || l.direction === 'flat');

/** What the trend chips mean, under the side-by-side table. */
function TrendLegend() {
  return (
    <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
      <p>Each trend is the change from the prior year in that company’s own latest fiscal year, so the years can differ. A trend about an older year names its year and has no direction colour. The line shows the values over the years the filings support.</p>
      <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1">
        {TREND_LEGEND.map((l) => (
          <li key={l.direction} className="inline-flex items-center gap-1.5">
            <SignalChip direction={l.direction} className="px-1">
              <span className="sr-only">{DIRECTION_WORD[l.direction]}</span>
            </SignalChip>
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

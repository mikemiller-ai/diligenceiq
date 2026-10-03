'use client';

import {
  OTHER_RISKS_LABEL,
  SIGNAL_CATEGORY_LABELS,
  isFixtureProfile,
  isPlaceholder,
  profileRef,
  type Citation,
  type CompanyIntelligenceProfile,
  type ProfileFact,
  type ProfileSignal,
  type SignalCategory,
} from '@diligenceiq/core';
import { ArrowUpRight, Columns3, FileSearch, ScrollText } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { CitationList, useEvidence } from '@/components/diligence/evidence';
import { SaveFindingButton } from '@/components/diligence/save-finding-dialog';
import { NavyAtmosphere } from '@/components/evidence/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { TIER_COPY } from '@/fixtures/profiles';
import { formatDate } from '@/lib/format';
import { SIGNAL_TYPE_LABEL, TRAJECTORY_LABEL } from '@/lib/labels';
import { compareHref, newAnalysisHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { FilingTextBadge, GeneralContextBadge, ModelWrittenBadge, PlaceholderBadge, PlaceholderSlot } from './placeholder';
import { Clamp, ShowMore } from './condense';
import { Term } from './term';
import {
  DIRECTION_WORD,
  type Direction,
  LEGEND,
  MARGINS,
  SignalChip,
  Sparkline,
  bottomLine,
  driverDirection,
  driverFigures,
  level,
  persistentEverywhere,
  readTrend,
  rowChange,
  signalDirection,
  signedPct,
  neutralCashFlow,
  trajectoryDirection,
  viewDirection,
  viewLead,
} from './signals';

/** Performance metrics surfaced where the filings support them (SPEC §9). */
export const PERFORMANCE_METRICS = [
  'Revenue',
  'Revenue growth',
  'Gross margin',
  'Operating margin',
  'Net margin',
  'Operating income',
  'Net income',
  'Cash and liquidity',
  'Debt',
  'Capital spending',
  'Operating cash flow',
] as const;

const CHANGE_TYPES = new Set<ProfileSignal['type']>(['NEW', 'EXPANDED', 'REDUCED', 'TREND_CHANGE', 'OUTLOOK_CHANGE', 'PERSISTENT']);

/**
 * Company Intelligence dashboard (SPEC §8.3), in section order. It renders a stored profile
 * and never generates anything. The smallest elements that may legitimately carry figures
 * are marked `data-allow-figures` or `data-metric-value` (with their source row); the
 * fixture-figure test checks everything else, folded items included. Exempt:
 * - verbatim filing text and labels: a risk heading, a date, the filing and heading counts, a
 *   signal's measurement, the period dots, the jump-bar counts, the version footer;
 * - figures computed by fixed rules from the builder's outputs (DD-21): the bottom line, the
 *   30-second-view lead lines, the performance table's change chips, derived values and
 *   sparklines, and the drivers' change and share. These render only for a built profile:
 *   a preview (fixture) profile has no trends or facts and never reaches them (guarded by
 *   `fixture` as well), so the strict rule still covers every fixture profile.
 */
export function IntelligenceDashboard({ profile }: { profile: CompanyIntelligenceProfile }) {
  const citations = React.useMemo(() => new Map(profile.citations.map((c) => [c.chunkId, c])), [profile.citations]);
  const fixture = isFixtureProfile(profile);

  return (
    <div className="flex flex-col gap-10">
      <header className="relative overflow-hidden rounded-2xl bg-navy text-white shadow-xl shadow-navy/20 ring-1 ring-navy-edge">
        <NavyAtmosphere subtle />
        <div className="relative flex flex-col gap-5 px-6 py-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Company Intelligence</p>
            <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight">
              {profile.company} <span className="font-mono text-lg font-medium text-white/60">({profile.ticker})</span>
            </h1>
            {profile.headline && (
              <div className="mt-3 max-w-3xl" data-testid="profile-headline">
                <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/60">Model-written summary</p>
                <p className="mt-1 text-[15px] leading-6 text-white/90">{profile.headline}</p>
              </div>
            )}
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-white/70">
              <span>{profile.sector}</span>
              <span>{TIER_COPY[profile.coverage.tier].label}</span>
              <span>
                Latest annual report: fiscal year ended <span data-allow-figures>{formatDate(profile.fiscalYearEnd)}</span>
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="ghost-dark" size="sm">
              <Link href={compareHref([profile.ticker])}>
                <Columns3 /> Compare with peers
              </Link>
            </Button>
            <Button asChild variant="brand" size="sm">
              <Link href={newAnalysisHref({ tickers: [profile.ticker] })}>
                <FileSearch /> Ask about {profile.company}
              </Link>
            </Button>
          </div>
        </div>
        {fixture && (
          <p className="relative border-t border-white/10 bg-white/[0.03] px-6 py-2.5 text-[13px] text-white/75">
            Preview profile. It lists the risk headings extracted from the latest annual report by a deterministic rule, each
            cited; the rule can miss some headings and can include a sentence that is not a heading. Sections marked
            “Placeholder, not filing data” fill in once the full profile is built.
          </p>
        )}
      </header>

      <JumpBar profile={profile} fixture={fixture} />

      {!fixture && <BottomLine profile={profile} />}

      <Section id="thirty-second" title="30-second view">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profile.executiveView.map((e) => {
            const placeholder = isPlaceholder(e.summary);
            return (
              <li
                key={e.dimension}
                className="flex flex-col gap-2 rounded-card border border-border border-t-[3px] bg-card px-4 py-3.5 shadow-sm"
                style={placeholder ? undefined : { borderTopColor: TOP_BORDER[viewDirection(e.label)] }}
              >
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{e.dimension}</p>
                {placeholder ? (
                  <PlaceholderBadge className="self-start" />
                ) : (
                  <ViewCardBody
                    profile={profile}
                    fixture={fixture}
                    dimension={e.dimension}
                    label={e.label}
                    summaryText={e.summary}
                    citations={<CitationList ids={e.citationIds} context={citations} provenance="profile" claim={e.summary} />}
                  >
                    {e.summary}
                  </ViewCardBody>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="performance" title="Performance">
        <PerformanceTable profile={profile} fixture={fixture} />
      </Section>

      {/* A built profile without segment rows has no drivers section (and no jump link): the absence is
          not a placeholder there. A preview profile keeps its labeled slot. */}
      {(fixture || profile.drivers.length > 0) && (
        <Section id="drivers" title="What is driving performance">
          {profile.drivers.length === 0 ? (
            <PlaceholderSlot title="Drivers">
              The segment or product lines with the largest reported change, each with its source row.
            </PlaceholderSlot>
          ) : (
            <ul className="flex flex-col gap-3">
              {profile.drivers.map((d, i) => (
                <li key={d.label} className="flex flex-col gap-3 rounded-card border border-border bg-card px-5 py-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <DriverHeader label={d.label} changeBasis={d.changeBasis} maxShare={maxShare(profile)} fixture={fixture} />
                    <Clamp text={d.explanation} className="mt-2 text-sm text-foreground/80" after={<CitationList ids={d.citationIds} context={citations} provenance="profile" claim={d.explanation} />}>
                      {d.explanation}
                    </Clamp>
                  </div>
                  <SaveFindingButton source={{ kind: 'driver', ticker: profile.ticker, ref: profileRef.driver(i) }} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {profile.managementOutlook && (
        <Section id="outlook" title="Management outlook" lede="What management says it expects, as summarized from the cited passages by the offline profile call.">
          <div className="rounded-card border border-border bg-card px-5 py-4">
            <ModelWrittenBadge />
            <p className="mt-2 text-sm text-foreground/80">
              {profile.managementOutlook.summary}{' '}
              <CitationList ids={profile.managementOutlook.citationIds} context={citations} provenance="profile" claim={profile.managementOutlook.summary} />
            </p>
          </div>
        </Section>
      )}

      <Section
        id="current-risks"
        title="Current risks"
        lede={
          fixture
            ? 'Risk headings extracted from the latest annual report, grouped by area. A preview: the extraction rule can miss some headings and can include a sentence that is not a heading.'
            : 'Risk headings from the latest annual report, grouped by area.'
        }
      >
        <CurrentRisks profile={profile} citations={citations} />
      </Section>

      <Section id="whats-changed" title="What’s changed">
        <WhatsChanged profile={profile} citations={citations} />
      </Section>

      <Section id="attention" title="Attention signals" lede="Something changed or appears important enough to investigate. A signal is not a judgment that the company is good or bad.">
        {profile.signals.length === 0 ? (
          <PlaceholderSlot title="Attention signals and why they matter">
            Each signal will say what was detected, why it deserves attention, and the evidence for each period, with
            Investigate, View evidence and Track actions.
          </PlaceholderSlot>
        ) : (
          <ShowMore
            items={[...profile.signals].sort((a, b) => Number(a.type === 'PERSISTENT') - Number(b.type === 'PERSISTENT'))}
            initial={4}
            noun={['signal', 'signals']}
            className="grid gap-3 lg:grid-cols-2"
            render={(s) => <SignalCard key={s.signalId} profile={profile} signal={s} citations={citations} />}
          />
        )}
      </Section>

      <Section id="recommended" title="Recommended diligence" lede="Questions worth investigating next. Each one opens Deep Analysis with the question filled in; nothing runs until you click Run analysis.">
        <ShowMore
          as="ol"
          items={profile.recommendedDiligence}
          initial={3}
          noun={['question', 'questions']}
          className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-sm"
          render={(r, i) => (
            <li key={r.question} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-foreground">{r.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Why suggested: {r.why} <CitationList ids={r.citationIds} context={citations} provenance="profile" claim={r.why} />
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button asChild size="sm">
                  <Link
                    href={newAnalysisHref({
                      question: r.question,
                      tickers: r.tickers,
                      origin: { kind: 'recommendation', ticker: profile.ticker, ref: profileRef.recommendation(i) },
                    })}
                  >
                    Investigate <ArrowUpRight />
                  </Link>
                </Button>
                <SaveFindingButton source={{ kind: 'recommendation', ticker: profile.ticker, ref: profileRef.recommendation(i) }} label="Save" />
              </div>
            </li>
          )}
        />
      </Section>

      <Section id="coverage" title="Coverage">
        <div className="grid gap-4 rounded-card border border-border bg-card px-5 py-4 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-base font-semibold text-foreground">{TIER_COPY[profile.coverage.tier].label}</p>
            <p className="mt-1 text-sm text-foreground/80">{TIER_COPY[profile.coverage.tier].summary}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              <span data-allow-figures>{profile.coverage.tenK}</span> <Term term="Annual report">annual</Term> and{' '}
              <span data-allow-figures>{profile.coverage.tenQ}</span> <Term term="Quarterly report">quarterly reports</Term>{' '}
              in the corpus. Periods covered:{' '}
              <span data-allow-figures>{profile.version.periodsCovered.map((p) => formatDate(p)).join(' · ')}</span>.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">What is not known yet</p>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-sm text-foreground/80 marker:text-risk-med">
              {profile.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      <footer className="border-t border-border pt-4 font-mono text-[11px] text-muted-foreground" data-allow-figures>
        Generation: {generationLabel(profile)} · {callCount(profile.generation.generationCallCount)} to build · profile set{' '}
        {profile.version.profileSetId} · index {profile.version.indexVersion} · built {profile.version.builtAt} · no model call on
        page view
      </footer>
    </div>
  );
}

/** "llm", "deterministic", or "deterministic fallback" (a deterministic profile inside an LLM set: its call failed validation or was not made). */
function generationLabel(p: CompanyIntelligenceProfile): string {
  if (p.generation.mode === 'deterministic' && p.version.profileSetId.startsWith('llm-')) return 'deterministic fallback';
  return p.generation.mode;
}

const callCount = (n: number) => `${n} model call${n === 1 ? '' : 's'}`;

function Section({ id, title, lede, children }: { id: string; title: string; lede?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="scroll-mt-40 text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {lede && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{lede}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PerformanceTable({ profile, fixture }: { profile: CompanyIntelligenceProfile; fixture: boolean }) {
  const show = useEvidence();
  const citations = new Map(profile.citations.map((c) => [c.chunkId, c]));
  const anyData = profile.facts.length > 0 || profile.trends.length > 0;
  return (
    <div className="flex flex-col gap-3">
      {!anyData && (
        <PlaceholderSlot title="Performance trends">
          Revenue, margins, profit, cash, debt and capital spending, each with its trend in plain language and the
          source table row behind every figure. Once extraction runs, a metric the filings do not support shows as “Not
          extracted”.
        </PlaceholderSlot>
      )}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <caption className="sr-only">{profile.company}: performance</caption>
          <THead>
            <tr>
              <TH className="normal-case tracking-normal">Metric</TH>
              <TH className="normal-case tracking-normal">Trend</TH>
              <TH className="normal-case tracking-normal">Latest reported value</TH>
              <TH className="normal-case tracking-normal">vs prior year</TH>
              <TH className="hidden normal-case tracking-normal md:table-cell">Over time</TH>
            </tr>
          </THead>
          <TBody>
            {PERFORMANCE_METRICS.map((metric) => {
              const trend = profile.trends.find((t) => t.metric === metric);
              const facts = profile.facts.filter((f) => f.metric === metric).sort((a, b) => a.period.localeCompare(b.period));
              const latest = facts.at(-1);
              const source = latest ? citations.get(latest.chunkId) : undefined;
              return (
                <TR key={metric} className="hover:bg-transparent">
                  <TH scope="row" className="h-auto py-2.5 text-sm font-medium normal-case tracking-normal text-foreground">
                    <Term>{metric}</Term>
                  </TH>
                  {/* A preview profile has not looked for any figure yet, so an empty slot is a
                      placeholder there, never "Not extracted" (which means extraction found nothing). */}
                  <TD data-metric-slot className={cn(!trend && 'italic text-muted-foreground')}>
                    {trend ? (
                      trend.trajectory === 'not_extracted' || trend.trajectory === 'limited_history' ? (
                        <span className="italic text-muted-foreground">{TRAJECTORY_LABEL[trend.trajectory]}</span>
                      ) : (
                        <SignalChip direction={trajectoryDirection(trend.trajectory, metric)} neutral={metric === 'Operating cash flow' && neutralCashFlow(profile)}>
                          {TRAJECTORY_LABEL[trend.trajectory]}
                        </SignalChip>
                      )
                    ) : fixture ? (
                      <PlaceholderBadge />
                    ) : (
                      TRAJECTORY_LABEL.not_extracted
                    )}
                  </TD>
                  <TD data-metric-slot>
                    {latest ? (
                      <button
                        type="button"
                        data-metric-value
                        data-chunk-id={latest.chunkId}
                        data-raw-row={latest.rawRow}
                        title={`Source row: ${latest.rawRow}`}
                        onClick={() => source && show({ kind: 'citation', citation: source, provenance: 'profile', ...metricStatement(metric, latest) })}
                        className="tabular-nums text-foreground hover:text-primary hover:underline"
                      >
                        {formatFact(latest.value, latest.unit, latest.scale)} · {latest.period}
                      </button>
                    ) : fixture ? (
                      <PlaceholderBadge />
                    ) : trend ? (
                      // A growth rate or margin has no single reported figure: it is derived in code
                      // from two facts of one table (DD-17), and its basis says how.
                      <DerivedValue profile={profile} metric={metric} basis={trend.basis} />
                    ) : (
                      <span className="italic text-muted-foreground">Not extracted</span>
                    )}
                  </TD>
                  <ChangeCells profile={profile} metric={metric} fixture={fixture} />
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * The drawer's statement for a metric value: readable (metric, period, formatted value), never the raw
 * source row. Only the value's own printed cell in that row is bolded (DD-21 f).
 */
export function metricStatement(metric: string, fact: Pick<ProfileFact, 'value' | 'unit' | 'scale' | 'period' | 'rawRow'>): { claim: string; figures: string[]; row: string } {
  const claim = `${metric}, ${fact.period}: ${formatFact(fact.value, fact.unit, fact.scale)}`;
  // The cell that prints the value, as printed ("17,576" for 17576; "(1,991)" reads as 1,991).
  const printed = fact.rawRow
    .split('|')
    .map((c) => c.trim().replace(/^\$\s*/, '').replace(/^\((.*)\)$/, '$1'))
    .find((c) => /^[\d,]+(?:\.\d+)?$/.test(c) && Number(c.replace(/,/g, '')) === Math.abs(fact.value));
  return { claim, figures: printed ? [printed] : [], row: fact.rawRow };
}

function formatFact(value: number, unit: string, scale: number): string {
  const scaled = value * scale;
  if (unit === 'USD') {
    const abs = Math.abs(scaled);
    if (abs >= 1e9) return `$${(scaled / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${(scaled / 1e6).toFixed(1)}M`;
    return `$${scaled.toLocaleString('en-US')}`;
  }
  if (unit === '%') return `${value}%`;
  return `${scaled.toLocaleString('en-US')} ${unit}`;
}

function CurrentRisks({ profile, citations }: { profile: CompanyIntelligenceProfile; citations: Map<string, Citation> }) {
  // Classified areas first, in filing order; headings the classifier could not place go last
  // under "Other risks" rather than being forced into the nearest area.
  const groups = new Map<SignalCategory | null, CompanyIntelligenceProfile['currentRisks']>();
  const ordered = [...profile.currentRisks].sort((a, b) => Number(a.category === null) - Number(b.category === null) || a.rank - b.rank);
  for (const r of ordered) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  const persistentCategories = new Set(persistentEverywhere(profile).map((s) => s.category));
  const freshCategories = new Set(profile.signals.filter((s) => s.type === 'NEW' || s.type === 'EXPANDED').map((s) => s.category));
  if (groups.size === 0) {
    return <PlaceholderSlot title="Current risks">The latest annual report’s risk headings, grouped by area and cited.</PlaceholderSlot>;
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {[...groups.entries()].map(([category, risks]) => (
        <section
          key={category ?? 'other'}
          aria-label={category ? SIGNAL_CATEGORY_LABELS[category] : OTHER_RISKS_LABEL}
          className="rounded-card border border-border bg-card px-5 py-4 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{category ? SIGNAL_CATEGORY_LABELS[category] : OTHER_RISKS_LABEL}</Badge>
            <span className="text-xs text-muted-foreground" data-allow-figures>
              {risks.length} heading{risks.length === 1 ? '' : 's'}
            </span>
            {category && persistentCategories.has(category) && <SignalChip direction="repeat">In every annual report</SignalChip>}
            {category && freshCategories.has(category) && <SignalChip direction="new">New or expanded</SignalChip>}
            <FilingTextBadge className="ml-auto" />
          </div>
          <RiskList risks={risks}>
            {(r) => (
              <li key={r.rank}>
                <blockquote className="border-l-2 border-primary/40 pl-3 text-[15px] leading-6 text-foreground">
                  <span data-allow-figures>{r.heading}</span> <CitationList ids={r.citationIds} context={citations} provenance="profile" claim={r.heading} />
                </blockquote>
                <div className="mt-2 flex flex-wrap gap-2 pl-3">
                  <Button asChild size="sm" variant="secondary">
                    <Link
                      href={newAnalysisHref({
                        question: r.category
                          ? `What does ${profile.company} disclose about ${r.plainLabel.toLowerCase()} risk in its latest annual report?`
                          : `What does ${profile.company} disclose about this risk in its latest annual report: “${r.heading}”`,
                        tickers: [profile.ticker],
                        origin: { kind: 'currentRisk', ticker: profile.ticker, ref: profileRef.currentRisk(r) },
                      })}
                    >
                      Investigate <ArrowUpRight />
                    </Link>
                  </Button>
                  <SaveFindingButton source={{ kind: 'currentRisk', ticker: profile.ticker, ref: profileRef.currentRisk(r) }} variant="ghost" />
                </div>
              </li>
            )}
          </RiskList>
        </section>
      ))}
    </div>
  );
}

function WhatsChanged({ profile, citations }: { profile: CompanyIntelligenceProfile; citations: Map<string, Citation> }) {
  const changes = profile.signals.filter((s) => CHANGE_TYPES.has(s.type));
  if (profile.coverage.tier === 'limited_history' && changes.length === 0) {
    return (
      <p className="rounded-card border border-border bg-card px-4 py-3 text-sm text-foreground/80">
        Limited history: one annual report in the corpus, so there is no earlier annual report to compare against.
      </p>
    );
  }
  if (changes.length === 0) {
    return (
      <PlaceholderSlot title="Filing-to-filing changes">
        New, expanded, reduced and persistent disclosures, trend and outlook changes, each with the passages for every
        period compared and the measurement that triggered it.
      </PlaceholderSlot>
    );
  }
  const persistent = changes.filter((s) => s.type === 'PERSISTENT');
  const others = changes.filter((s) => s.type !== 'PERSISTENT');
  const card = (s: ProfileSignal) => (
    <li key={s.signalId} className="rounded-card border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <SignalChip {...signalDirection(s, profile)}>{SIGNAL_TYPE_LABEL[s.type]}</SignalChip>
        <Badge tone="accent">{SIGNAL_CATEGORY_LABELS[s.category]}</Badge>
        <PeriodDots all={annualPeriodsOf(profile)} on={s.periods} />
      </div>
      <p className="mt-2 text-[15px] font-semibold text-foreground">{s.headline}</p>
      <p className="mt-1 text-sm text-foreground/80">
        {s.whatChanged} <CitationList ids={s.citationIds} context={citations} provenance="profile" claim={s.whatChanged} />
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Measured: <span data-allow-figures>{s.measurement}</span>
      </p>
    </li>
  );
  return (
    <div className="flex flex-col gap-3">
      {others.length > 0 && <ul className="flex flex-col gap-3">{others.map(card)}</ul>}
      {persistent.length > 0 && (
        <details className="group rounded-card border border-border bg-card">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <SignalChip direction="repeat">Persistent</SignalChip>
            <span className="text-[15px] font-semibold text-foreground" data-allow-figures>
              {persistent.length} disclosure{persistent.length === 1 ? '' : 's'} repeated across annual reports
            </span>
            <span className="text-sm text-muted-foreground">{[...new Set(persistent.map((s) => SIGNAL_CATEGORY_LABELS[s.category]))].join(' · ')}</span>
            <span className="ml-auto text-sm font-medium text-primary group-open:hidden">Show all</span>
            <span className="ml-auto hidden text-sm font-medium text-primary group-open:inline">Hide</span>
          </summary>
          <ul className="flex flex-col gap-3 border-t border-border p-3">{persistent.map(card)}</ul>
        </details>
      )}
    </div>
  );
}

function SignalCard({
  profile,
  signal: s,
  citations,
  hidden,
  tabIndex,
}: {
  profile: CompanyIntelligenceProfile;
  signal: ProfileSignal;
  citations: Map<string, Citation>;
  /** Set by ShowMore while the card is folded. */
  hidden?: boolean;
  tabIndex?: number;
}) {
  const show = useEvidence();
  const periods = s.evidenceByPeriod.map((e) => ({
    period: e.period,
    citations: e.chunkIds.flatMap((id) => {
      const c = citations.get(id);
      return c ? [c] : [];
    }),
  }));
  return (
    <li hidden={hidden} tabIndex={tabIndex} className="flex flex-col rounded-card border border-border bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{SIGNAL_CATEGORY_LABELS[s.category]}</Badge>
        <SignalChip {...signalDirection(s, profile)}>{SIGNAL_TYPE_LABEL[s.type]}</SignalChip>
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{s.headline}</h3>
      <Clamp text={s.whatChanged} className="mt-1 text-sm text-foreground/80" after={<CitationList ids={s.citationIds} context={citations} provenance="profile" claim={s.whatChanged} />}>
        {s.whatChanged}
      </Clamp>
      <div className="mt-3 rounded-md bg-secondary px-3 py-2.5">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Why this matters</p>
          {s.whyThisMattersSource === 'general_context' ? <GeneralContextBadge /> : <ModelWrittenBadge>Model-written analysis</ModelWrittenBadge>}
        </div>
        <Clamp text={s.whyThisMatters} className="mt-1 text-sm text-foreground/80">
          {s.whyThisMatters}
        </Clamp>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={newAnalysisHref({ question: s.investigateQuestion, tickers: [profile.ticker], origin: { kind: 'signal', ticker: profile.ticker, ref: profileRef.signal(s) } })}>
            Investigate <ArrowUpRight />
          </Link>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => show({ kind: 'periods', title: s.headline, periods, claim: s.whatChanged })}>
          <ScrollText /> View evidence
        </Button>
        <SaveFindingButton source={{ kind: 'signal', ticker: profile.ticker, ref: profileRef.signal(s) }} label="Track" variant="ghost" />
      </div>
    </li>
  );
}

/* --------------------------------------------- bottom line and signals */

const TOP_BORDER: Record<Direction, string> = {
  up: 'var(--ok)',
  down: 'var(--destructive)',
  slowing: 'var(--risk-med)',
  flat: 'var(--border)',
  repeat: 'var(--border)',
  new: 'var(--primary)',
  info: 'var(--primary)',
  none: 'var(--border)',
};

/** Bottom line up front: up to five lines, each the builder's own label and figures for the latest annual report (DD-21 a). */
function BottomLine({ profile }: { profile: CompanyIntelligenceProfile }) {
  const items = bottomLine(profile);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="bottom-line" className="rounded-card border border-border border-l-4 border-l-primary bg-card px-5 py-4 shadow-sm">
      <h2 id="bottom-line" className="scroll-mt-40 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
        Bottom line
      </h2>
      <ul className="mt-2 flex flex-col divide-y divide-border" data-allow-figures>
        {items.map((it) => (
          <li key={it.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <SignalChip direction={it.direction} neutral={it.neutral} className="min-w-[1.75rem] justify-center px-1.5">
              <span className="sr-only">{it.neutral ? `${DIRECTION_WORD[it.direction]}, neither direction is better` : DIRECTION_WORD[it.direction]}</span>
            </SignalChip>
            <a href={`#${it.anchor}`} className="text-[15px] font-semibold text-foreground hover:text-primary">
              {it.title}
            </a>
            <span className="text-sm text-muted-foreground">
              {it.key === 'profit' && it.detail.startsWith('net margin ') ? (
                <>
                  <Term term="Net margin">net margin</Term>
                  {it.detail.slice('net margin'.length)}
                </>
              ) : (
                it.detail
              )}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
        <p>Each line is the change from the prior year in the latest annual report. Figures come from the filings; click a line for its section.</p>
        <ul aria-label="Legend" className="flex flex-wrap gap-x-3 gap-y-1">
          {LEGEND.map((l) => (
            <li key={l.direction} className="inline-flex items-center gap-1.5">
              <SignalChip direction={l.direction} className="px-1">
                <span className="sr-only">{DIRECTION_WORD[l.direction]}</span>
              </SignalChip>
              {l.text}
            </li>
          ))}
          <li>
            pp: <Term term="pp">percentage points</Term>
          </li>
        </ul>
      </div>
    </section>
  );
}

function ViewCardBody({
  profile,
  fixture,
  dimension,
  label,
  summaryText,
  citations,
  children,
}: {
  profile: CompanyIntelligenceProfile;
  fixture: boolean;
  dimension: string;
  label: string;
  summaryText: string;
  citations: React.ReactNode;
  children: React.ReactNode;
}) {
  // Computed lead lines only on a built profile (a preview keeps the strict figure rule).
  const lead = fixture ? null : viewLead(profile, dimension);
  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <SignalChip direction={viewDirection(label)}>{label}</SignalChip>
      </div>
      {lead && (
        <p className="text-[15px] font-semibold leading-snug text-foreground" data-allow-figures>
          {lead}
        </p>
      )}
      <Clamp text={summaryText} className="text-sm text-foreground/75" after={citations}>
        {children}
      </Clamp>
    </>
  );
}

/** The "vs prior year" and "Over time" cells of a performance row: only where the builder labeled the metric. */
function ChangeCells({ profile, metric, fixture }: { profile: CompanyIntelligenceProfile; metric: string; fixture: boolean }) {
  const ch = fixture ? null : rowChange(profile, metric);
  const series = ch?.series ?? [];
  return (
    <>
      <TD data-allow-figures>{ch ? <SignalChip direction={ch.direction} neutral={ch.neutral}>{ch.text}</SignalChip> : <Dash />}</TD>
      <TD className="hidden md:table-cell">
        {ch && series.length >= 2 ? (
          <Sparkline values={series.map((p) => p.value)} direction={ch.neutral ? 'flat' : ch.direction} label={`${metric}, ${series[0]!.period} to ${series.at(-1)!.period}`} />
        ) : (
          <Dash />
        )}
      </TD>
    </>
  );
}

const Dash = () => <span className="text-muted-foreground">—</span>;

const maxShare = (profile: CompanyIntelligenceProfile) => Math.max(1, ...profile.drivers.map((d) => driverFigures(d.changeBasis).share ?? 0));

/** A revenue line's name, share-of-revenue bar and change chip (the same ±2% as the trend labels). */
function DriverHeader({ label, changeBasis, maxShare: max, fixture }: { label: string; changeBasis: string; maxShare: number; fixture: boolean }) {
  if (fixture) return <p className="text-base font-semibold text-foreground">{label}</p>;
  const { pct, share } = driverFigures(changeBasis);
  const dir = driverDirection(pct);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2" data-allow-figures>
      <p className="w-44 text-base font-semibold text-foreground">{label}</p>
      {share !== null && (
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className={cn('h-full rounded-full', dir === 'down' ? 'bg-destructive/50' : 'bg-primary/45')} style={{ width: `${(Math.max(0, share) / max) * 100}%` }} />
          </div>
          <span className="w-28 text-xs tabular-nums text-muted-foreground">{share}% of revenue</span>
        </div>
      )}
      {pct !== null && <SignalChip direction={dir}>{signedPct(pct)}</SignalChip>}
    </div>
  );
}

const annualPeriodsOf = (profile: CompanyIntelligenceProfile) =>
  [...new Set(profile.signals.flatMap((s) => s.periods).filter((p) => /^FY\d{4}$/.test(p)))].sort();

/** One dot per annual report; filled where the signal's periods include it. */
function PeriodDots({ all, on }: { all: string[]; on: string[] }) {
  const set = new Set(on);
  return (
    <span className="inline-flex items-center gap-1" data-allow-figures aria-label={on.join(', ')} role="img">
      {all.map((p) => (
        <span key={p} title={p} className={cn('size-2 rounded-full', set.has(p) ? 'bg-primary' : 'border border-border')} />
      ))}
      <span className="ml-1 font-mono text-[11px] text-muted-foreground">{on.length > 1 ? `${on[0]} → ${on.at(-1)}` : on[0]}</span>
    </span>
  );
}

/** A risk area's headings: the first one, then the rest one click away. */
function RiskList({ risks, children }: { risks: CompanyIntelligenceProfile['currentRisks']; children: (r: CompanyIntelligenceProfile['currentRisks'][number]) => React.ReactElement }) {
  return (
    <div className="mt-3">
      <ShowMore items={risks} initial={1} noun={['heading', 'headings']} className="flex flex-col gap-4" render={(r) => children(r)} />
    </div>
  );
}

/** The "latest value" of a derived row, read from the builder's basis: a margin and its formula, or this year's growth against last year's. */
function DerivedValue({ profile, metric, basis }: { profile: CompanyIntelligenceProfile; metric: string; basis: string }) {
  const t = readTrend(profile, metric);
  const margin = MARGINS[metric];
  if (t && margin && t.basis.kind === 'margin') {
    return (
      <span data-allow-figures title={basis} className="tabular-nums text-foreground">
        {level(t.basis.latest)} · {t.basis.period} <span className="ml-1 text-xs text-muted-foreground">{margin[0]} ÷ {margin[1]}</span>
      </span>
    );
  }
  if (t && metric === 'Revenue growth' && t.basis.kind === 'growth') {
    const b = t.basis;
    return (
      <span data-allow-figures title={basis} className="tabular-nums text-foreground">
        {signedPct(b.pct)} · {b.period}
        {b.priorPct !== null && b.priorPeriod && (
          <span className="ml-1 text-xs text-muted-foreground">
            vs {signedPct(b.priorPct)} in {b.priorPeriod}
          </span>
        )}
      </span>
    );
  }
  return (
    <span data-allow-figures className="text-xs text-muted-foreground">
      {basis}
    </span>
  );
}

/**
 * "On this page": a sticky row of links to the dashboard's sections, under the top bar. Built from
 * the sections this profile actually shows, with counts on the long ones, and the section in view
 * marked (`aria-current`). Below `md` it is a single "Jump to" menu.
 */
function JumpBar({ profile, fixture }: { profile: CompanyIntelligenceProfile; fixture: boolean }) {
  const changes = profile.signals.filter((s) => CHANGE_TYPES.has(s.type)).length;
  const links: Array<{ id: string; label: string; count?: number }> = [
    ...(fixture || bottomLine(profile).length === 0 ? [] : [{ id: 'bottom-line', label: 'Bottom line' }]),
    { id: 'thirty-second', label: '30-second view' },
    { id: 'performance', label: 'Performance' },
    ...(fixture || profile.drivers.length ? [{ id: 'drivers', label: 'Drivers', ...(profile.drivers.length ? { count: profile.drivers.length } : {}) }] : []),
    ...(profile.managementOutlook ? [{ id: 'outlook', label: 'Outlook' }] : []),
    { id: 'current-risks', label: 'Current risks', count: profile.currentRisks.length },
    { id: 'whats-changed', label: 'What’s changed', ...(changes ? { count: changes } : {}) },
    { id: 'attention', label: 'Attention signals', count: profile.signals.length },
    { id: 'recommended', label: 'Recommended', count: profile.recommendedDiligence.length },
    { id: 'coverage', label: 'Coverage' },
  ];
  const active = useActiveSection(links.map((l) => l.id));
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // URL first: replacing the history entry after starting a smooth scroll can cancel the scroll.
    history.replaceState(null, '', `#${id}`);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <nav aria-label="On this page" className="sticky top-14 z-20 -mt-4 border-b border-border bg-background/90 px-1 py-2.5 backdrop-blur-md">
      <div className="hidden flex-wrap items-center gap-1 md:flex">
        <span className="mr-1 hidden shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground 2xl:inline">On this page</span>
        {links.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            aria-current={active === l.id ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(l.id);
            }}
            // No colour transition: the active link changes as the page scrolls, and a half-faded
            // state fails contrast (it made the e2e axe checks flaky).
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[12px] font-medium',
              active === l.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary',
            )}
          >
            {l.label}
            {l.count !== undefined && (
              <span data-allow-figures className={cn('rounded px-1 text-[11px] tabular-nums', active === l.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-foreground/70')}>
                {l.count}
              </span>
            )}
          </a>
        ))}
      </div>
      <label className="flex items-center gap-2 md:hidden">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Jump to</span>
        <select
          aria-label="Jump to section"
          // Always back on the placeholder, so picking any section (even the one in view) jumps.
          value=""
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
          className="h-9 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="">{active ? `In view: ${links.find((l) => l.id === active)?.label ?? ''}` : 'Choose a section'}</option>
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
              {l.count !== undefined ? ` (${l.count})` : ''}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

/** The section whose heading was passed last on the way down (under the two sticky bars), or null above the first. */
function useActiveSection(ids: string[]): string | null {
  const [active, setActive] = React.useState<string | null>(null);
  const key = ids.join(',');
  React.useEffect(() => {
    const list = key.split(',');
    let frame = 0;
    const update = () => {
      frame = 0;
      // Just below the two sticky bars and the 160 px scroll offset a jump lands headings on.
      const line = 200;
      let current: string | null = null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // At the very bottom, the last section is the one in view even if its heading never reaches the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = list.at(-1) ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
  return active;
}

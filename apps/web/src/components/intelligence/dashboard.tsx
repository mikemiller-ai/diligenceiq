'use client';

import {
  OTHER_RISKS_LABEL,
  SIGNAL_CATEGORY_LABELS,
  isFixtureProfile,
  isPlaceholder,
  profileRef,
  type Citation,
  type CompanyIntelligenceProfile,
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

/** Performance metrics surfaced where the filings support them (SPEC §9). */
export const PERFORMANCE_METRICS = [
  'Revenue',
  'Revenue growth',
  'Gross margin',
  'Operating margin',
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
 * are marked `data-allow-figures` (a verbatim risk heading, a date, the filing counts, the
 * version footer) or `data-metric-value` with their source row; the fixture-figure test
 * checks everything else.
 */
export function IntelligenceDashboard({ profile }: { profile: CompanyIntelligenceProfile }) {
  const citations = React.useMemo(() => new Map(profile.citations.map((c) => [c.chunkId, c])), [profile.citations]);
  const fixture = isFixtureProfile(profile);

  return (
    <div className="flex flex-col gap-10">
      <header className="relative overflow-hidden rounded-2xl bg-navy text-white shadow-xl shadow-navy/20">
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

      <Section id="thirty-second" title="30-second view">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profile.executiveView.map((e) => {
            const placeholder = isPlaceholder(e.summary);
            return (
              <li key={e.dimension} className="flex flex-col gap-2 rounded-card border border-border bg-card px-4 py-3.5 shadow-sm">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{e.dimension}</p>
                {placeholder ? (
                  <PlaceholderBadge className="self-start" />
                ) : (
                  <>
                    <p className="text-base font-semibold text-foreground">{e.label}</p>
                    <p className="text-sm text-foreground/80">
                      {e.summary} <CitationList ids={e.citationIds} context={citations} provenance="profile" />
                    </p>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section id="performance" title="Performance">
        <PerformanceTable profile={profile} fixture={fixture} />
      </Section>

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
                  <p className="text-base font-semibold text-foreground">{d.label}</p>
                  <p className="mt-1 text-sm text-foreground/80">
                    {d.explanation} <CitationList ids={d.citationIds} context={citations} provenance="profile" />
                  </p>
                </div>
                <SaveFindingButton source={{ kind: 'driver', ticker: profile.ticker, ref: profileRef.driver(i) }} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {profile.managementOutlook && (
        <Section id="outlook" title="Management outlook" lede="What management says it expects, as summarized from the cited passages by the offline profile call.">
          <div className="rounded-card border border-border bg-card px-5 py-4">
            <ModelWrittenBadge />
            <p className="mt-2 text-sm text-foreground/80">
              {profile.managementOutlook.summary}{' '}
              <CitationList ids={profile.managementOutlook.citationIds} context={citations} provenance="profile" />
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
          <ul className="grid gap-3 lg:grid-cols-2">
            {profile.signals.map((s) => (
              <SignalCard key={s.signalId} profile={profile} signal={s} citations={citations} />
            ))}
          </ul>
        )}
      </Section>

      <Section id="recommended" title="Recommended diligence" lede="Questions worth investigating next. Each one opens Deep Analysis with the question filled in; nothing runs until you click Run analysis.">
        <ol className="flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-sm">
          {profile.recommendedDiligence.map((r, i) => (
            <li key={r.question} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
              <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-foreground">{r.question}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Why suggested: {r.why} <CitationList ids={r.citationIds} context={citations} provenance="profile" />
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
          ))}
        </ol>
      </Section>

      <Section id="coverage" title="Coverage">
        <div className="grid gap-4 rounded-card border border-border bg-card px-5 py-4 md:grid-cols-[1fr_1fr]">
          <div>
            <p className="text-base font-semibold text-foreground">{TIER_COPY[profile.coverage.tier].label}</p>
            <p className="mt-1 text-sm text-foreground/80">{TIER_COPY[profile.coverage.tier].summary}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              <span data-allow-figures>
                {profile.coverage.tenK} annual and {profile.coverage.tenQ} quarterly reports
              </span>{' '}
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
      <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
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
                    {metric}
                  </TH>
                  {/* A preview profile has not looked for any figure yet, so an empty slot is a
                      placeholder there, never "Not extracted" (which means extraction found nothing). */}
                  <TD data-metric-slot className={cn(!trend && 'italic text-muted-foreground')}>
                    {trend ? TRAJECTORY_LABEL[trend.trajectory] : fixture ? <PlaceholderBadge /> : TRAJECTORY_LABEL.not_extracted}
                  </TD>
                  <TD data-metric-slot>
                    {latest ? (
                      <button
                        type="button"
                        data-metric-value
                        data-chunk-id={latest.chunkId}
                        data-raw-row={latest.rawRow}
                        title={`Source row: ${latest.rawRow}`}
                        onClick={() => source && show({ kind: 'citation', citation: source, provenance: 'profile' })}
                        className="tabular-nums text-foreground hover:text-primary hover:underline"
                      >
                        {formatFact(latest.value, latest.unit, latest.scale)} · {latest.period}
                      </button>
                    ) : fixture ? (
                      <PlaceholderBadge />
                    ) : trend ? (
                      // A growth rate or margin has no single reported figure: it is derived in code
                      // from two facts of one table (DD-17), and its basis says how.
                      <span data-allow-figures className="text-xs text-muted-foreground">
                        {trend.basis}
                      </span>
                    ) : (
                      <span className="italic text-muted-foreground">Not extracted</span>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </div>
    </div>
  );
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
          <div className="flex items-center gap-2">
            <Badge tone="accent">{category ? SIGNAL_CATEGORY_LABELS[category] : OTHER_RISKS_LABEL}</Badge>
            <FilingTextBadge />
          </div>
          <ul className="mt-3 flex flex-col gap-4">
            {risks.map((r) => (
              <li key={r.rank}>
                <blockquote className="border-l-2 border-primary/40 pl-3 text-[15px] leading-6 text-foreground">
                  <span data-allow-figures>{r.heading}</span> <CitationList ids={r.citationIds} context={citations} provenance="profile" />
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
            ))}
          </ul>
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
  return (
    <ul className="flex flex-col gap-3">
      {changes.map((s) => (
        <li key={s.signalId} className="rounded-card border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">{SIGNAL_TYPE_LABEL[s.type]}</Badge>
            <Badge tone="accent">{SIGNAL_CATEGORY_LABELS[s.category]}</Badge>
            <span className="font-mono text-[11px] text-muted-foreground" data-allow-figures>
              {s.periods.join(' → ')}
            </span>
          </div>
          <p className="mt-2 text-[15px] font-semibold text-foreground">{s.headline}</p>
          <p className="mt-1 text-sm text-foreground/80">
            {s.whatChanged} <CitationList ids={s.citationIds} context={citations} provenance="profile" />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Measured: <span data-allow-figures>{s.measurement}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function SignalCard({ profile, signal: s, citations }: { profile: CompanyIntelligenceProfile; signal: ProfileSignal; citations: Map<string, Citation> }) {
  const show = useEvidence();
  const periods = s.evidenceByPeriod.map((e) => ({
    period: e.period,
    citations: e.chunkIds.flatMap((id) => {
      const c = citations.get(id);
      return c ? [c] : [];
    }),
  }));
  return (
    <li className="flex flex-col rounded-card border border-border bg-card px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{SIGNAL_CATEGORY_LABELS[s.category]}</Badge>
        <Badge tone="outline">{SIGNAL_TYPE_LABEL[s.type]}</Badge>
      </div>
      <h3 className="mt-2 text-base font-semibold text-foreground">{s.headline}</h3>
      <p className="mt-1 text-sm text-foreground/80">
        {s.whatChanged} <CitationList ids={s.citationIds} context={citations} provenance="profile" />
      </p>
      <div className="mt-3 rounded-md bg-secondary px-3 py-2.5">
        <div className="flex items-center gap-2">
          <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Why this matters</p>
          {s.whyThisMattersSource === 'general_context' ? <GeneralContextBadge /> : <ModelWrittenBadge>Model-written analysis</ModelWrittenBadge>}
        </div>
        <p className="mt-1 text-sm text-foreground/80">{s.whyThisMatters}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={newAnalysisHref({ question: s.investigateQuestion, tickers: [profile.ticker], origin: { kind: 'signal', ticker: profile.ticker, ref: profileRef.signal(s) } })}>
            Investigate <ArrowUpRight />
          </Link>
        </Button>
        <Button size="sm" variant="secondary" onClick={() => show({ kind: 'periods', title: s.headline, periods })}>
          <ScrollText /> View evidence
        </Button>
        <SaveFindingButton source={{ kind: 'signal', ticker: profile.ticker, ref: profileRef.signal(s) }} label="Track" variant="ghost" />
      </div>
    </li>
  );
}

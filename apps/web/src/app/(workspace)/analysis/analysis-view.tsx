'use client';

import { citationLabel, type Citation } from '@diligenceiq/core';
import { ArrowLeft, ArrowUpRight, CheckCircle2, FileQuestion, FileText, Printer, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { TickerBadge } from '@/components/diligence/badges';
import { NavyAtmosphere } from '@/components/evidence/section';
import { CitationList, CitedText, useEvidence } from '@/components/diligence/evidence';
import { PageContainer, SectionHeading } from '@/components/diligence/page';
import { SaveFindingButton } from '@/components/diligence/save-finding-dialog';
import { StageTracker } from '@/components/diligence/stage-tracker';
import { EmptyState, ErrorPanel } from '@/components/diligence/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import type { AnalysisRecord } from '@/fixtures/types';
import { formatDate, formatDateTime, formatDurationSeconds, pluralize } from '@/lib/format';
import { FAILURE_COPY } from '@/lib/labels';
import { newAnalysisHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';

export function AnalysisView() {
  const id = useSearchParams().get('id');
  const { analyses } = useWorkspace();
  const analysis = analyses.find((a) => a.analysisId === id);

  if (!analysis) {
    return (
      <PageContainer>
        <EmptyState
          icon={FileQuestion}
          title={id ? 'Analysis not found' : 'No analysis selected'}
          description={
            id
              ? 'It may belong to another workspace, or the link may be out of date.'
              : 'Ask a question in Deep Analysis; its Diligence Brief opens here.'
          }
          action={
            <Button asChild variant="secondary">
              <Link href="/analysis/new/">Go to Deep Analysis</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }
  return <AnalysisDetail analysis={analysis} />;
}

function AnalysisDetail({ analysis }: { analysis: AnalysisRecord }) {
  const context = React.useMemo(() => new Map(analysis.context.map((c) => [c.chunkId, c])), [analysis.context]);

  return (
    <PageContainer className="max-w-[1200px]">
      <div className="no-print mb-4 flex items-center justify-between gap-3">
        <Link href="/analysis/new/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft aria-hidden className="size-3.5" /> Deep Analysis
        </Link>
        {analysis.status === 'COMPLETE' && (
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
        )}
      </div>

      <header className="print-light relative overflow-hidden rounded-2xl bg-navy text-white shadow-xl shadow-navy/20">
        <NavyAtmosphere subtle />
        <div className="relative flex flex-wrap items-center gap-3 border-b border-white/10 bg-gradient-to-r from-primary/25 to-transparent px-6 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-gradient">
            <FileText aria-hidden className="size-3.5" />
          </span>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Diligence Brief</p>
          <NavyStatus status={analysis.status} />
          <span className="ml-auto font-mono text-[11px] text-white/50">{analysis.analysisId}</span>
        </div>
        <div className="relative px-6 pb-6 pt-5">
          <h1 className="max-w-[860px] text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">{analysis.brief?.title ?? analysis.question}</h1>
          <p className="mt-2 max-w-[860px] text-[15px] text-white/70">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">Question · </span>
            {analysis.question}
          </p>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px] text-white/55">
            <span>{formatDateTime(analysis.createdAt)}</span>
            {analysis.completedAt && <span>completed in {formatDurationSeconds(analysis.createdAt, analysis.completedAt)}</span>}
            {analysis.status === 'COMPLETE' && <span>{pluralize(analysis.context.length, 'source passage')} · 1 model call</span>}
          </p>
          {analysis.status === 'COMPLETE' && analysis.brief && (
            <section aria-labelledby="exec-summary" className="mt-6 border-t border-white/10 pt-5">
              <h2 id="exec-summary" className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Executive summary
              </h2>
              <p className="mt-2 max-w-[880px] text-[15.5px] leading-7 text-white/90">
                <CitedText text={analysis.brief.executiveSummary} context={context} onNavy />
              </p>
            </section>
          )}
          {analysis.interpretation && (
            <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
              <div className="flex items-center gap-2">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/50">Companies</dt>
                <dd className="flex gap-1">
                  {analysis.interpretation.companies.map((t) => (
                    <span key={t} className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 font-mono text-[11px] font-semibold text-white/90">
                      {t}
                    </span>
                  ))}
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/50">Periods</dt>
                <dd className="text-white/80">{analysis.interpretation.periods.join(' · ')}</dd>
              </div>
              <div className="flex items-center gap-2">
                <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/50">Sources</dt>
                <dd className="font-mono text-[11px] text-white/80">{analysis.interpretation.filingTypes.join(' · ')}</dd>
              </div>
              {analysis.interpretation.coverageWarnings.length > 0 && (
                <div className="flex basis-full items-start gap-2">
                  <dt className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/50">Coverage</dt>
                  <dd className="text-on-navy-accent">{analysis.interpretation.coverageWarnings.join(' ')}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </header>

      {(analysis.status === 'QUEUED' || analysis.status === 'RUNNING') && (
        <div className="mt-6 max-w-xl">
          <StageTracker stage={analysis.stage ?? analysis.status} />
        </div>
      )}

      {analysis.status === 'FAILED' && analysis.error && (
        <div className="mt-6 max-w-3xl">
          <ErrorPanel
            title={FAILURE_COPY[analysis.error.code]?.title ?? 'The analysis failed'}
            message={analysis.error.message}
            requestId={analysis.error.requestId}
            code={analysis.error.code}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={newAnalysisHref({ question: analysis.question, ...(analysis.interpretation ? { tickers: analysis.interpretation.companies } : {}) })}>
                  Edit and run again
                </Link>
              </Button>
            }
          />
        </div>
      )}

      {analysis.status === 'COMPLETE' && analysis.brief && <BriefBody analysis={analysis} context={context} />}
    </PageContainer>
  );
}

function BriefBody({ analysis, context }: { analysis: AnalysisRecord; context: Map<string, Citation> }) {
  const brief = analysis.brief!;
  const invalid = analysis.validation?.invalidCitationIds ?? [];
  const citedIds = new Set([
    ...brief.keyFindings.flatMap((k) => k.citationIds),
    ...brief.investmentConsiderations.flatMap((c) => c.citationIds),
    ...(brief.comparison?.rows.flatMap((r) => r.citationIds) ?? []),
    ...[...brief.executiveSummary.matchAll(/\[([A-Z0-9][A-Z0-9.-]*-[A-Z0-9]+)\]/g)].map((m) => m[1] ?? ''),
  ]);

  return (
    <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,760px)_minmax(0,1fr)]">
      <article className="min-w-0">
        <section aria-labelledby="key-findings">
          <SectionHeading id="key-findings">Key findings</SectionHeading>
          <ol className="mt-3 flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card shadow-sm">
            {brief.keyFindings.map((k, i) => (
              <li key={k.title} className="px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                      {k.tickers.map((t) => (
                        <TickerBadge key={t} ticker={t} />
                      ))}
                      <Badge tone={k.basis === 'reported' ? 'outline' : 'info'}>
                        {k.basis === 'reported' ? 'Reported' : 'Analysis'}
                      </Badge>
                    </div>
                    <h3 className="mt-1.5 text-base font-semibold text-foreground">{k.title}</h3>
                    <p className="mt-1 text-[15px] leading-6 text-foreground/80">
                      {k.finding} <CitationList ids={k.citationIds} context={context} provenance="brief" />
                    </p>
                  </div>
                  <SaveFindingButton source={{ kind: 'keyFinding', analysisId: analysis.analysisId, index: i }} />
                </div>
              </li>
            ))}
          </ol>
        </section>

        {brief.comparison && brief.comparison.rows.length > 0 && (
          <section aria-labelledby="comparison" className="mt-8">
            <SectionHeading id="comparison">{brief.comparison.kind === 'trend' ? 'Trend' : 'Comparison'}</SectionHeading>
            <div className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
              <Table>
                <caption className="sr-only">{brief.title}: comparison</caption>
                <THead>
                  <tr>
                    {brief.comparison.columns.map((c) => (
                      <TH key={c} className="normal-case tracking-normal">
                        {c}
                      </TH>
                    ))}
                    <TH className="normal-case tracking-normal">Sources</TH>
                    <TH className="no-print normal-case tracking-normal">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <TBody>
                  {brief.comparison.rows.map((r, rowIndex) => (
                    <TR key={r.label} className="hover:bg-transparent">
                      <TH scope="row" className="h-auto whitespace-normal py-2.5 align-top text-sm font-medium normal-case tracking-normal text-foreground">
                        {r.label}
                      </TH>
                      {r.values.map((v, i) => (
                        <TD key={`${r.label}-${i}`} className={v.startsWith('Not in') ? 'align-top italic text-muted-foreground' : 'align-top tabular-nums text-foreground'}>
                          {v}
                        </TD>
                      ))}
                      <TD className="align-top">
                        <CitationList ids={r.citationIds} context={context} provenance="brief" />
                      </TD>
                      <TD className="no-print align-top">
                        <SaveFindingButton source={{ kind: 'comparisonRow', analysisId: analysis.analysisId, index: rowIndex }} label="Save" variant="ghost" />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          </section>
        )}

        <section aria-labelledby="considerations" className="mt-8">
          <SectionHeading id="considerations">Investment considerations</SectionHeading>
          <ul className="mt-3 flex flex-col gap-3">
            {brief.investmentConsiderations.map((c, i) => (
              <li key={c.text} className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-3.5 sm:flex-row sm:items-start">
                <p className="flex-1 text-[15px] leading-6 text-foreground/80">
                  {c.text} <CitationList ids={c.citationIds} context={context} provenance="brief" />
                </p>
                <SaveFindingButton source={{ kind: 'consideration', analysisId: analysis.analysisId, index: i }} />
              </li>
            ))}
          </ul>
        </section>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="gaps">
            <SectionHeading id="gaps">Evidence gaps</SectionHeading>
            {brief.evidenceGaps.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None identified.</p>
            ) : (
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground/80 marker:text-risk-med">
                {brief.evidenceGaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="follow-ups" className="no-print">
            <SectionHeading id="follow-ups">Suggested follow-up questions</SectionHeading>
            <ul className="mt-2 flex flex-col gap-1">
              {brief.followUpQuestions.map((q, i) => (
                <li key={q}>
                  <Link
                    href={newAnalysisHref({
                      question: q,
                      ...(analysis.interpretation ? { tickers: analysis.interpretation.companies } : {}),
                      origin: { kind: 'brief', analysisId: analysis.analysisId, index: i },
                    })}
                    className="group -mx-2 flex items-start gap-2 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
                  >
                    <span className="flex-1">{q}</span>
                    <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </article>

      <aside aria-label="Sources" className="min-w-0 lg:sticky lg:top-20 lg:h-fit">
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Sources</h2>
            <span className="text-xs text-muted-foreground">{pluralize(analysis.context.length, 'passage')}</span>
          </div>
          <div className="flex items-start gap-2 border-b border-border px-4 py-2.5 text-xs">
            {invalid.length === 0 ? (
              <>
                <CheckCircle2 aria-hidden className="mt-px size-3.5 shrink-0 text-ok" />
                <span className="text-foreground/80">
                  All {citedIds.size} cited IDs resolve to passages supplied to the model.
                </span>
              </>
            ) : (
              <>
                <ShieldAlert aria-hidden className="mt-px size-3.5 shrink-0 text-destructive" />
                <span className="text-destructive">{pluralize(invalid.length, 'citation')} removed: not in the supplied context.</span>
              </>
            )}
          </div>
          <SourceList passages={analysis.context} cited={citedIds} />
        </div>
      </aside>
    </div>
  );
}

function SourceList({ passages, cited }: { passages: Citation[]; cited: Set<string> }) {
  const show = useEvidence();
  return (
    <ul className="divide-y divide-border">
      {passages.map((p) => (
        <li key={p.chunkId}>
          <button
            type="button"
            onClick={() => show({ kind: 'citation', citation: p, provenance: 'brief' })}
            className="group flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-background"
          >
            <span className="flex items-center gap-1.5">
              <FileText aria-hidden className="size-3.5 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground group-hover:text-primary">{p.company}</span>
              {!cited.has(p.chunkId) && (
                <Badge tone="neutral" className="ml-auto">
                  Not cited
                </Badge>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {citationLabel(p)} · filed {formatDate(p.filingDate)}
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground">{p.chunkId}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NavyStatus({ status }: { status: AnalysisRecord['status'] }) {
  const tone = {
    COMPLETE: { dot: 'bg-ok', label: 'Complete' },
    FAILED: { dot: 'bg-risk-critical', label: 'Failed' },
    RUNNING: { dot: 'bg-on-navy-accent', label: 'Running' },
    QUEUED: { dot: 'bg-white/60', label: 'Queued' },
  }[status];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/85">
      <span aria-hidden className={`size-1.5 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

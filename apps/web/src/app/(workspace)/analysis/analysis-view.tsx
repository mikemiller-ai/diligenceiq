'use client';

import { citationLabel, comparisonHeaders, type AnalysisDetail, type Citation } from '@diligenceiq/core';
import { ArrowLeft, ArrowUpRight, FileQuestion, FileText, Printer, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { TickerBadge } from '@/components/diligence/badges';
import { NavyAtmosphere } from '@/components/evidence/section';
import { CitationList, CitedText, useEvidence } from '@/components/diligence/evidence';
import { PageContainer, SectionHeading } from '@/components/diligence/page';
import { SaveFindingButton } from '@/components/diligence/save-finding-dialog';
import { CoverageMatrix, FigureBadges, InterpretationPanel, ValidationSummary, figuresAt } from '@/components/diligence/brief-panels';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { StageTracker } from '@/components/diligence/stage-tracker';
import { EmptyState, ErrorPanel, NoticeBar, RetryButton } from '@/components/diligence/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { ApiRequestError } from '@/lib/api';
import { formatDate, formatDateTime, formatDurationSeconds, pluralize } from '@/lib/format';
import { FAILURE_COPY } from '@/lib/labels';
import { companies } from '@/fixtures';
import { filtersAsPrefill, newAnalysisHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';

export function AnalysisView() {
  const id = useSearchParams().get('id');
  return id ? <AnalysisLoader key={id} id={id} /> : <Missing id={null} />;
}

const TERMINAL = new Set(['COMPLETE', 'FAILED']);
const POLL_MS = 1_500;
const OFFLINE_RETRY_MS = 3_000;
const SERVER_RETRY_MAX_MS = 30_000;

/** A poll failure worth retrying: the network, a gateway or server error, or a throttle. Other 4xx are final. */
export function isRetryablePollError(err: ApiRequestError): boolean {
  return err.code === 'NETWORK' || err.code === 'UNAVAILABLE' || err.code === 'INTERNAL' || err.status === 429 || (err.status !== null && err.status >= 500);
}

/**
 * Loads an analysis and polls it while it is QUEUED or RUNNING (architecture §4.1). The stages
 * shown are the ones the worker writes. A failed poll never freezes the page silently (SPEC §38.2):
 * a network failure shows "Connection lost" and retries every 3 s; a server error (5xx) shows its
 * request ID and retries with backoff (3 s, doubling, at most 30 s); any other error stops polling
 * and is shown with a Retry. The analysis continues on the server either way.
 */
export function useAnalysis(id: string) {
  const { details, client, putAnalysis, status } = useWorkspace();
  const cached = details.get(id);
  const [error, setError] = React.useState<ApiRequestError | null>(null);
  const [serverError, setServerError] = React.useState<ApiRequestError | null>(null);
  const [offline, setOffline] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const terminal = cached ? TERMINAL.has(cached.status) : false;

  React.useEffect(() => {
    if (terminal || status === 'loading') return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const tick = async () => {
      try {
        const detail = await client.getAnalysis(id);
        if (cancelled) return;
        failures = 0;
        setOffline(false);
        setServerError(null);
        setError(null);
        putAnalysis(detail);
        if (!TERMINAL.has(detail.status)) timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof ApiRequestError ? err : new ApiRequestError('CLIENT', 'An unexpected error occurred.', null);
        if (e.code === 'NETWORK') {
          setOffline(true);
          timer = setTimeout(tick, OFFLINE_RETRY_MS);
        } else if (isRetryablePollError(e)) {
          setOffline(false);
          setServerError(e);
          timer = setTimeout(tick, Math.min(OFFLINE_RETRY_MS * 2 ** failures++, SERVER_RETRY_MAX_MS));
        } else {
          setOffline(false);
          setServerError(null);
          setError(e);
        }
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, terminal, status, client, putAnalysis, attempt]);

  const retry = () => {
    setError(null);
    setServerError(null);
    setAttempt((n) => n + 1);
  };
  return { analysis: cached, error, serverError, offline, retry };
}

/** The passages supplied to the model (the context snapshot), fetched once the brief is complete. */
function useContext(analysis: AnalysisDetail | undefined) {
  const { client } = useWorkspace();
  const [state, setState] = React.useState<{ passages: Citation[]; snapshot: boolean } | null>(null);
  const complete = analysis?.status === 'COMPLETE';
  const id = analysis?.analysisId;
  React.useEffect(() => {
    if (!complete || !id) return;
    let cancelled = false;
    client
      .getContext(id)
      .then((ctx) => {
        if (!cancelled) setState(ctx ? { passages: ctx.passages, snapshot: true } : { passages: [], snapshot: false });
      })
      .catch(() => {
        if (!cancelled) setState({ passages: [], snapshot: false });
      });
    return () => {
      cancelled = true;
    };
  }, [client, complete, id]);
  return state;
}

function AnalysisLoader({ id }: { id: string }) {
  const { analysis, error, serverError, offline, retry } = useAnalysis(id);
  if (error?.code === 'NOT_FOUND') return <Missing id={id} />;
  const problems = <PollProblems offline={offline} serverError={serverError} error={analysis ? error : null} retry={retry} />;
  if (!analysis) {
    return (
      <PageContainer className="max-w-[1200px]">
        {error ? (
          <ErrorPanel title="The analysis could not be loaded" message={error.message} {...(error.requestId ? { requestId: error.requestId } : {})} code={error.code} action={<RetryButton onClick={retry} />} />
        ) : (
          <>
            {problems}
            <PageSkeleton />
          </>
        )}
      </PageContainer>
    );
  }
  return <AnalysisDetail analysis={analysis} problems={problems} />;
}

/** What went wrong checking on the analysis, shown above it: connection lost, a retried server error, or a stopped poll. */
function PollProblems({ offline, serverError, error, retry }: { offline: boolean; serverError: ApiRequestError | null; error: ApiRequestError | null; retry: () => void }) {
  if (offline) return <ConnectionLost />;
  if (serverError) {
    return (
      <div role="status">
        <NoticeBar className="mb-4">
          <span className="font-medium text-foreground">Checking on this analysis failed</span> ({serverError.status ? `HTTP ${serverError.status}` : serverError.code}
          {serverError.requestId ? `, request ID ${serverError.requestId}` : ''}). Trying again automatically; the analysis keeps running on the server.{' '}
          <Button size="sm" variant="ghost" onClick={retry}>
            Retry now
          </Button>
        </NoticeBar>
      </div>
    );
  }
  if (error) {
    return (
      <ErrorPanel
        className="mb-4"
        title="Updates for this analysis stopped"
        message={`${error.message} The status below may be out of date.`}
        {...(error.requestId ? { requestId: error.requestId } : {})}
        code={error.code}
        action={<RetryButton onClick={retry} />}
      />
    );
  }
  return null;
}

function ConnectionLost() {
  return (
    <NoticeBar className="mb-4">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <WifiOff aria-hidden className="size-3.5" /> Connection lost.
      </span>{' '}
      Checking again automatically. The analysis keeps running on the server.
    </NoticeBar>
  );
}

function Missing({ id }: { id: string | null }) {
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

function AnalysisDetail({ analysis, problems }: { analysis: AnalysisDetail; problems: React.ReactNode }) {
  const ctx = useContext(analysis);
  // Citations resolve against the snapshot; if it is unavailable, against the cited passages the brief stores.
  const passages = React.useMemo(() => (ctx?.snapshot ? ctx.passages : (analysis.citations ?? [])), [ctx, analysis.citations]);
  const context = React.useMemo(() => new Map([...(analysis.citations ?? []), ...passages].map((c) => [c.chunkId, c])), [analysis.citations, passages]);
  const seeded = analysis.seeded === true;

  return (
    <PageContainer className="max-w-[1200px]">
      {problems}
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

      <header className="print-light relative overflow-hidden rounded-2xl bg-navy text-white shadow-xl shadow-navy/20 ring-1 ring-navy-edge">
        <NavyAtmosphere subtle />
        <div className="relative flex flex-wrap items-center gap-3 border-b border-white/10 bg-gradient-to-r from-sapphire/25 to-transparent px-6 py-3">
          <span className="grid size-7 place-items-center rounded-lg bg-brand-gradient">
            <FileText aria-hidden className="size-3.5" />
          </span>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Diligence Brief</p>
          <NavyStatus status={analysis.status} />
          <span className="ml-auto font-mono text-[11px] text-white/50">{analysis.analysisId}</span>
        </div>
        <div className="relative px-6 pb-6 pt-5">
          <h1 className="max-w-[860px] text-[22px] font-semibold leading-tight tracking-tight sm:text-[26px]">
            {analysis.brief?.title ?? analysis.question}
            {analysis.brief && <FigureBadges figures={figuresAt(analysis.validation, 'title')} />}
          </h1>
          <p className="mt-2 max-w-[860px] text-[15px] text-white/70">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">Question · </span>
            {analysis.question}
          </p>
          <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px] text-white/55">
            <span>{formatDateTime(analysis.createdAt)}</span>
            {/* A seeded analysis is a replayed recording: its durations would not be real, so none is shown. */}
            {!seeded && analysis.completedAt && <span>completed in {formatDurationSeconds(analysis.createdAt, analysis.completedAt)}</span>}
            {analysis.status === 'COMPLETE' && (
              <span>
                {pluralize(passages.length, 'source passage')}
                {/* The count comes from the recorded telemetry only; it is never assumed. */}
                {analysis.telemetry && ` · ${pluralize(analysis.telemetry.generationCallCount, 'model call')}`}
              </span>
            )}
            {seeded && <span className="text-on-navy-accent">Example from the demo workspace: real pipeline output, run in advance</span>}
          </p>
          {analysis.status === 'COMPLETE' && analysis.brief && (
            <section aria-labelledby="exec-summary" className="mt-6 border-t border-white/10 pt-5">
              <h2 id="exec-summary" className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">
                Executive summary
              </h2>
              <p className="mt-2 max-w-[880px] text-[15.5px] leading-7 text-white/90">
                <CitedText text={analysis.brief.executiveSummary} context={context} onNavy figureChecks={figuresAt(analysis.validation, 'executiveSummary')} />
              </p>
              <FigureBadges figures={figuresAt(analysis.validation, 'executiveSummary')} />
            </section>
          )}
        </div>
      </header>

      {(analysis.status === 'QUEUED' || analysis.status === 'RUNNING') && (
        <div className="mt-6 max-w-xl">
          <StageTracker stage={analysis.stage ?? 'queued'} />
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
                <Link href={newAnalysisHref({ question: analysis.question, ...filtersAsPrefill(analysis.filters) })}>
                  Edit and run again
                </Link>
              </Button>
            }
          />
          {analysis.error.code === 'NO_RELEVANT_EVIDENCE' && <NoEvidenceHelp />}
          {analysis.interpretation && (
            <div className="mt-6 max-w-xl">
              <InterpretationPanel analysis={analysis} />
            </div>
          )}
        </div>
      )}

      {analysis.status === 'COMPLETE' && analysis.brief && <BriefBody analysis={analysis} context={context} passages={passages} snapshot={ctx?.snapshot ?? null} />}
    </PageContainer>
  );
}

function BriefBody({ analysis, context, passages, snapshot }: { analysis: AnalysisDetail; context: Map<string, Citation>; passages: Citation[]; snapshot: boolean | null }) {
  const brief = analysis.brief!;
  const v = analysis.validation;
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
              <li key={`${i}-${k.title}`} className="px-5 py-4">
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
                      {k.finding} <CitationList ids={k.citationIds} context={context} provenance="brief" claim={k.finding} figureChecks={figuresAt(v, `keyFindings[${i}].`)} />
                      <FigureBadges figures={figuresAt(v, `keyFindings[${i}].`)} />
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
                    <TH className="normal-case tracking-normal">{comparisonHeaders(brief.comparison).labelHeader ?? (brief.comparison.kind === 'trend' ? 'Measure' : 'Dimension')}</TH>
                    {comparisonHeaders(brief.comparison).valueColumns.map((c, i) => (
                      <TH key={`${i}-${c}`} className="normal-case tracking-normal">
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
                    <TR key={`${rowIndex}-${r.label}`} className="hover:bg-transparent">
                      <TH scope="row" className="h-auto whitespace-normal py-2.5 align-top text-sm font-medium normal-case tracking-normal text-foreground">
                        {r.label}
                        <FigureBadges figures={figuresAt(v, `comparison.rows[${rowIndex}].label`)} />
                      </TH>
                      {r.values.map((value, i) => (
                        <TD key={i} className={value.startsWith('Not in') ? 'align-top italic text-muted-foreground' : 'align-top tabular-nums text-foreground'}>
                          {value}
                          <FigureBadges figures={figuresAt(v, `comparison.rows[${rowIndex}].values[${i}]`)} />
                        </TD>
                      ))}
                      <TD className="align-top">
                        <CitationList
                          ids={r.citationIds}
                          context={context}
                          provenance="brief"
                          claim={[r.label, ...r.values].join(' · ')}
                          figureChecks={figuresAt(v, `comparison.rows[${rowIndex}].`)}
                        />
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
              <li key={`${i}-${c.text}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-3.5 sm:flex-row sm:items-start">
                <p className="flex-1 text-[15px] leading-6 text-foreground/80">
                  {c.text} <CitationList ids={c.citationIds} context={context} provenance="brief" claim={c.text} figureChecks={figuresAt(v, `investmentConsiderations[${i}].`)} />
                  <FigureBadges figures={figuresAt(v, `investmentConsiderations[${i}].`)} />
                </p>
                <SaveFindingButton source={{ kind: 'consideration', analysisId: analysis.analysisId, index: i }} />
              </li>
            ))}
          </ul>
        </section>

        <CoverageMatrix analysis={analysis} passages={context} />

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section aria-labelledby="gaps">
            <SectionHeading id="gaps">Evidence gaps</SectionHeading>
            {brief.evidenceGaps.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">None identified.</p>
            ) : (
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-foreground/80 marker:text-risk-med">
                {brief.evidenceGaps.map((g, i) => (
                  <li key={`${i}-${g}`}>
                    {g}
                    <FigureBadges figures={figuresAt(v, `evidenceGaps[${i}]`)} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="follow-ups" className="no-print">
            <SectionHeading id="follow-ups">Suggested follow-up questions</SectionHeading>
            <ul className="mt-2 flex flex-col gap-1">
              {brief.followUpQuestions.map((q, i) => (
                <li key={`${i}-${q}`}>
                  <Link
                    href={newAnalysisHref({
                      question: q,
                      ...filtersAsPrefill(analysis.filters),
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

      <aside aria-label="Sources and interpretation" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:h-fit">
        <InterpretationPanel analysis={analysis} />
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Sources</h2>
            <span className="text-xs text-muted-foreground">{pluralize(passages.length, 'passage')}</span>
          </div>
          <ValidationSummary validation={v} citedCount={citedIds.size} />
          {snapshot === false && (
            <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
              The full set of passages supplied to the model is unavailable for this analysis; the passages the brief cites are listed.
            </p>
          )}
          <SourceList passages={passages} cited={citedIds} />
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

function NavyStatus({ status }: { status: AnalysisDetail['status'] }) {
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

/** The companies Deep Analysis covers (the static catalog; GE Capital's pre-window filing excluded). */
const COVERED = companies().filter((c) => !c.outsideWindow);

/**
 * NO_RELEVANT_EVIDENCE (SPEC §38.2; architecture §9.1): no model call was made. Lists the
 * covered companies, so a question about a company outside the corpus has an answer.
 */
export function NoEvidenceHelp() {
  return (
    <section aria-labelledby="covered-companies" className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
      <h2 id="covered-companies" className="text-sm font-semibold text-foreground">
        No model request was made. The filings cover these {COVERED.length} companies:
      </h2>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-foreground/80" aria-label="Covered companies">
        {COVERED.map((c) => (
          <li key={c.ticker}>
            {c.company} <span className="font-mono text-muted-foreground">{c.ticker}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Which years each company covers:{' '}
        <Link href="/intelligence/" className="text-primary hover:underline">
          the company list
        </Link>
        .
      </p>
    </section>
  );
}

'use client';

import {
  CreateAnalysisRequestSchema,
  THEMES,
  parseOrigin,
  type AnalysisOrigin,
  type CreateAnalysisRequest,
  type FilingType,
} from '@diligenceiq/core';
import { Info, Link2, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { CompanySelect } from '@/components/diligence/company-select';
import Link from 'next/link';
import { AnalysisStatusBadge } from '@/components/diligence/badges';
import { PageContainer, PageHeader, SectionHeading } from '@/components/diligence/page';
import { ErrorPanel } from '@/components/diligence/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldHint, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { FILING_TYPES, FISCAL_YEAR_OPTIONS, companies, companyName } from '@/fixtures';
import { ApiRequestError } from '@/lib/api';
import { FAILURE_COPY } from '@/lib/labels';
import { analysisHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';
import { formatDateTime, formatLocalDateTime } from '@/lib/format';

const MAX_QUESTION = 1000;
const COMPANY_OPTIONS = companies().filter((c) => !c.outsideWindow);
const KNOWN_TICKERS = new Set(COMPANY_OPTIONS.map((c) => c.ticker));

type SubmitError = { title: string; message: string; requestId?: string; code: string };

function describeError(err: unknown): SubmitError {
  if (err instanceof ApiRequestError) {
    if (err.code === 'NETWORK') return { title: 'Network failure', message: err.message, code: err.code };
    if (err.code === 'UNAVAILABLE') {
      return {
        title: 'The analysis service is unavailable',
        message: `The API did not respond with a valid result${err.status ? ` (HTTP ${err.status})` : ''}. Try again shortly.`,
        requestId: err.requestId,
        code: err.status ? `HTTP ${err.status}` : err.code,
      };
    }
    if (err.code === 'RATE_LIMITED') {
      const retryAfter = typeof err.details?.retryAfter === 'string' ? err.details.retryAfter : null;
      return {
        title: err.details?.scope === 'workspace_hourly' ? 'This workspace has reached its hourly limit' : 'The demo has reached its daily limit',
        message: `${err.message} Each analysis makes one paid model request, so the public demo is capped.${retryAfter ? ` Try again after ${formatDateTime(retryAfter)}.` : ''} Company Intelligence, Compare and your findings keep working.`,
        requestId: err.requestId,
        code: err.code,
      };
    }
    const copy = FAILURE_COPY[err.code];
    return {
      title: copy?.title ?? 'The analysis could not be started',
      message: copy ? `${err.message} ${copy.action}` : err.message,
      requestId: err.requestId,
      code: err.code,
    };
  }
  return { title: 'The analysis could not be started', message: 'An unexpected error occurred.', code: 'CLIENT' };
}

const EXAMPLES = THEMES.map((t) => t.exampleQuestions[0] ?? '').filter(Boolean).slice(0, 4);

/** Where a prefilled question came from, in plain words (provenance only). */
function originLabel(origin: AnalysisOrigin): string | null {
  switch (origin.kind) {
    case 'direct':
      return null;
    case 'signal':
      return `${companyName(origin.ticker)} · attention signal`;
    case 'recommendation':
      return `${companyName(origin.ticker)} · recommended diligence`;
    case 'currentRisk':
      return `${companyName(origin.ticker)} · current risk`;
    case 'driver':
      return `${companyName(origin.ticker)} · driver`;
    case 'executiveView':
      return `${companyName(origin.ticker)} · 30-second view`;
    case 'compare':
      return `Compare · ${origin.tickers.map(companyName).join(', ')}`;
    case 'brief':
      return 'A Diligence Brief’s follow-up question';
    case 'finding':
      return 'A saved finding';
    case 'thesis':
      return 'A thesis';
    case 'watchEvent':
      return `${companyName(origin.ticker)} · watchlist event`;
  }
}

/**
 * Deep Analysis input (SPEC §14). A prefilled URL (`?q=&tickers=&origin=`) only fills
 * the form: nothing is sent until the user clicks Run analysis.
 *
 * Navigating within /analysis/new/ (the global "Ask a question", the nav item, back and
 * forward) changes the query without remounting the route, so the form is keyed on the
 * query string: a new URL always starts from its own prefill, never the previous one's
 * question, origin or company filter.
 */
export function NewAnalysisView() {
  const params = useSearchParams();
  return <NewAnalysisForm key={params.toString()} params={params} />;
}

function NewAnalysisForm({ params }: { params: { get(name: string): string | null } }) {
  const router = useRouter();
  const { client } = useWorkspace();
  // Read once per URL: the origin describes how the form was prefilled and never changes retrieval.
  const [origin] = React.useState<AnalysisOrigin>(() => parseOrigin(params.get('origin')));
  const initialTickers = (params.get('tickers') ?? '')
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter((t) => KNOWN_TICKERS.has(t))
    .slice(0, 10);

  const [question, setQuestion] = React.useState(() => (params.get('q') ?? '').slice(0, MAX_QUESTION));
  const [tickers, setTickers] = React.useState<string[]>(initialTickers);
  // Source and fiscal-year filters from the URL (an earlier analysis's "Edit and run again"); unknown values are ignored.
  const [filingTypes, setFilingTypes] = React.useState<FilingType[]>(() => {
    const types = (params.get('types') ?? '').split(',').filter((t): t is FilingType => (FILING_TYPES as readonly string[]).includes(t));
    return types.length ? [...new Set(types)] : [...FILING_TYPES];
  });
  const yearParam = (name: string) => {
    const v = params.get(name) ?? '';
    return (FISCAL_YEAR_OPTIONS as readonly number[]).map(String).includes(v) ? v : '';
  };
  const [yearFrom, setYearFrom] = React.useState<string>(() => yearParam('from'));
  const [yearTo, setYearTo] = React.useState<string>(() => yearParam('to'));
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<SubmitError | null>(null);
  const { health, recheck, checking } = useHealth();
  // Paused before the run (health) or found paused by it (the server's ANALYSES_DISABLED): one notice, and Run is off.
  const [pausedByRun, setPausedByRun] = React.useState(false);
  const paused = pausedByRun || health?.analysesEnabled === false;
  // While paused, health is read again on "Check again" and when the tab comes back into view, so Run
  // turns back on once analyses are re-enabled (a fresh "enabled" also clears a pause the run found).
  const checkAgain = React.useCallback(async () => {
    const h = await recheck();
    if (h?.analysesEnabled) setPausedByRun(false);
  }, [recheck]);
  React.useEffect(() => {
    if (!paused) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkAgain();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [paused, checkAgain]);

  const toggleType = (t: FilingType) =>
    setFilingTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const buildRequest = (): CreateAnalysisRequest | null => {
    const errors: Record<string, string> = {};
    if (filingTypes.length === 0) errors.sources = 'Select at least one filing type.';
    const body = {
      question,
      ...(origin.kind === 'direct' ? {} : { origin }),
      filters: {
        ...(tickers.length ? { tickers } : {}),
        // Both types selected is the same as no filter.
        ...(filingTypes.length === 1 ? { filingTypes } : {}),
        ...(yearFrom ? { fiscalYearFrom: Number(yearFrom) } : {}),
        ...(yearTo ? { fiscalYearTo: Number(yearTo) } : {}),
      },
    };
    const parsed = CreateAnalysisRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] === 'question' ? 'question' : issue.path.includes('fiscalYearFrom') ? 'period' : 'form';
        errors[key] ??=
          key === 'question'
            ? question.trim()
              ? `Keep the question under ${MAX_QUESTION} characters.`
              : 'Enter a question to analyze.'
            : key === 'period'
              ? 'The start year must be on or before the end year.'
              : issue.message;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0 && parsed.success ? parsed.data : null;
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const request = buildRequest();
    if (!request) return;
    setSubmitting(true);
    try {
      const res = await client.createAnalysis(request);
      router.push(analysisHref(res.analysisId));
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'ANALYSES_DISABLED') setPausedByRun(true);
      else setSubmitError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const originText = originLabel(origin);

  return (
    <PageContainer className="max-w-[960px]">
      <PageHeader
        eyebrow="Investigate"
        title="Deep Analysis"
        description="Ask any business question about the companies whose annual and quarterly reports DiligenceIQ holds. The answer is a cited Diligence Brief. Filters are optional and only narrow the search."
      />

      <ServiceNotice health={health} paused={paused} checking={checking} onCheckAgain={() => void checkAgain()} />
      <form onSubmit={onSubmit} noValidate aria-describedby="one-call-note">
        <Card className="divide-y divide-border">
          {originText && (
            <p className="flex items-center gap-2 bg-accent/60 px-5 py-2.5 text-sm text-foreground/80">
              <Link2 aria-hidden className="size-4 shrink-0 text-primary" />
              <span>
                Prefilled from <span className="font-medium text-foreground">{originText}</span>. Edit anything before you run it.
              </span>
            </p>
          )}
          <div className="grid gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="companies">Companies</Label>
              <CompanySelect id="companies" options={COMPANY_OPTIONS} value={tickers} onChange={setTickers} />
              {tickers.length === 0 && <FieldHint>Leave empty to let the question decide which companies apply.</FieldHint>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 p-5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="question">Question</Label>
              <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {question.length.toLocaleString('en-US')} / {MAX_QUESTION.toLocaleString('en-US')}
              </span>
            </div>
            <Textarea
              id="question"
              value={question}
              maxLength={MAX_QUESTION}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What are the primary risk factors facing Apple and NVIDIA, and how have they changed since 2023?"
              className="min-h-32 text-md leading-6"
              aria-invalid={Boolean(fieldErrors.question)}
              aria-describedby={fieldErrors.question ? 'question-error' : undefined}
            />
            {fieldErrors.question && (
              <p id="question-error" className="text-sm text-destructive">
                {fieldErrors.question}
              </p>
            )}
            {!question.trim() && (
              <div className="mt-1 flex flex-col gap-1.5">
                <p className="text-xs font-medium text-muted-foreground">Examples (fills the box; you can edit it)</p>
                <ul className="flex flex-col gap-1">
                  {EXAMPLES.map((q) => (
                    <li key={q}>
                      <button
                        type="button"
                        onClick={() => setQuestion(q)}
                        className="text-left text-sm text-primary hover:underline"
                      >
                        {q}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="grid gap-5 p-5 md:grid-cols-2">
            <fieldset className="flex flex-col gap-2" aria-describedby={fieldErrors.sources ? 'sources-error' : undefined}>
              <legend className="mb-1.5 text-sm font-medium text-foreground">Sources</legend>
              <div className="flex gap-5">
                {FILING_TYPES.map((t) => (
                  <label key={t} htmlFor={`type-${t}`} className="flex cursor-pointer items-center gap-2 text-base text-foreground">
                    <Checkbox id={`type-${t}`} checked={filingTypes.includes(t)} onCheckedChange={() => toggleType(t)} />
                    {t === '10-K' ? 'Annual reports' : 'Quarterly reports'} <span className="text-sm text-muted-foreground">({t})</span>
                  </label>
                ))}
              </div>
              {fieldErrors.sources && (
                <p id="sources-error" className="text-sm text-destructive">
                  {fieldErrors.sources}
                </p>
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-2" aria-describedby={fieldErrors.period ? 'period-error' : undefined}>
              <legend className="mb-1.5 text-sm font-medium text-foreground">Period (fiscal year)</legend>
              <div className="flex items-center gap-2">
                <label htmlFor="year-from" className="sr-only">
                  From fiscal year
                </label>
                <NativeSelect id="year-from" value={yearFrom} onChange={(e) => setYearFrom(e.target.value)} className="w-32">
                  <option value="">Earliest</option>
                  {FISCAL_YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      FY{y}
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-muted-foreground">—</span>
                <label htmlFor="year-to" className="sr-only">
                  To fiscal year
                </label>
                <NativeSelect id="year-to" value={yearTo} onChange={(e) => setYearTo(e.target.value)} className="w-32">
                  <option value="">Latest</option>
                  {FISCAL_YEAR_OPTIONS.map((y) => (
                    <option key={y} value={y}>
                      FY{y}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {fieldErrors.period && (
                <p id="period-error" className="text-sm text-destructive">
                  {fieldErrors.period}
                </p>
              )}
            </fieldset>
          </div>

          <div className="flex flex-col gap-3 bg-secondary/60 p-5 sm:flex-row sm:items-center">
            <p id="one-call-note" className="flex flex-1 items-start gap-2 text-sm text-foreground/80">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Retrieval searches the filings first; then exactly one model request writes a cited Diligence Brief. Nothing
              runs until you click Run analysis.
            </p>
            <Button type="submit" size="lg" disabled={submitting || paused} className="sm:w-40" {...(paused ? { 'aria-describedby': 'analyses-paused' } : {})}>
              {submitting ? (
                <>
                  <Loader2 className="animate-spin" /> Starting…
                </>
              ) : (
                'Run analysis'
              )}
            </Button>
          </div>
        </Card>

        {fieldErrors.form && <p className="mt-3 text-sm text-destructive">{fieldErrors.form}</p>}
        {submitError && (
          <ErrorPanel
            className="mt-4"
            title={submitError.title}
            message={submitError.message}
            requestId={submitError.requestId}
            code={submitError.code}
          />
        )}
      </form>
      <RecentAnalyses />
    </PageContainer>
  );
}

const RECENT_LIMIT = 10;

/** This workspace's analyses, newest first (architecture §9 `GET /api/analyses`): each opens its brief. */
function RecentAnalyses() {
  const { analyses, status } = useWorkspace();
  if (status !== 'ready' || analyses.length === 0) return null;
  const recent = [...analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT_LIMIT);
  return (
    <section aria-labelledby="recent-analyses" className="mt-10">
      <SectionHeading id="recent-analyses">Recent analyses</SectionHeading>
      <ul className="mt-3 divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
        {recent.map((a) => (
          <li key={a.analysisId}>
            <Link href={analysisHref(a.analysisId)} className="group flex flex-col gap-1 px-4 py-3 hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-3">
              <span className="min-w-0 flex-1 text-sm text-foreground group-hover:text-primary">{a.question}</span>
              <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {a.seeded && <span>Example, run in advance</span>}
                <span>{formatLocalDateTime(a.createdAt)}</span>
                <AnalysisStatusBadge status={a.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Health = { indexAvailable: boolean; analysesEnabled: boolean };

/**
 * GET /api/health, read once per visit and again on `recheck` (null until it answers, or when it
 * fails: the server still decides on Run). `recheck` resolves to the new health, or null on failure.
 */
function useHealth(): { health: Health | null; recheck: () => Promise<Health | null>; checking: boolean } {
  const { client } = useWorkspace();
  const [health, setHealth] = React.useState<Health | null>(null);
  const [checking, setChecking] = React.useState(false);
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    client
      .health()
      .then((h) => mounted.current && setHealth(h))
      .catch(() => undefined);
    return () => {
      mounted.current = false;
    };
  }, [client]);
  const recheck = React.useCallback(async () => {
    setChecking(true);
    try {
      const h = await client.health();
      if (mounted.current) setHealth(h);
      return h;
    } catch {
      return null;
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, [client]);
  return { health, recheck, checking };
}

/**
 * Missing index or paused analyses (SPEC §38.2). Paused is one notice, whether health said so
 * before the run or the run found out (Run is disabled while it shows); it carries no raw code.
 * "Check again" reads health again, and Run turns back on when analyses are enabled.
 */
function ServiceNotice({ health, paused, checking, onCheckAgain }: { health: Health | null; paused: boolean; checking: boolean; onCheckAgain: () => void }) {
  if (paused) {
    return (
      <div id="analyses-paused">
        <ErrorPanel
          className="mb-4"
          title="New analyses are paused"
          message="Running an analysis is switched off at the moment (each one makes a paid model request). Company Intelligence, Compare and saved findings remain available, and you can still prepare a question."
          action={
            <Button type="button" variant="secondary" size="sm" onClick={onCheckAgain} disabled={checking}>
              {checking ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}
              Check again
            </Button>
          }
        />
      </div>
    );
  }
  if (health && !health.indexAvailable) {
    return (
      <ErrorPanel
        className="mb-4"
        title="Filing search is unavailable right now"
        message="The filing index could not be reached, so new analyses would fail. Company Intelligence, Compare and saved findings still work."
      />
    );
  }
  return null;
}

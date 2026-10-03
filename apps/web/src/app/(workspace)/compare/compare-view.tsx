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
  type CompareTheme,
} from '@diligenceiq/core';
import { ArrowUpRight, Columns3, Info } from 'lucide-react';
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
import { PlaceholderBadge, PlaceholderSlot } from '@/components/intelligence/placeholder';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { TBody, TD, TH, THead, TR, Table } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { companies, companyName } from '@/fixtures';
import { TIER_COPY } from '@/fixtures/profiles';
import { formatDate } from '@/lib/format';

import { TRAJECTORY_LABEL } from '@/lib/labels';
import { compareHref, newAnalysisHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';

const OPTIONS = companies().filter((c) => !c.outsideWindow);
const KNOWN = new Set(OPTIONS.map((c) => c.ticker));
const STARTER = ['AAPL', 'MSFT', 'NVDA'];

const PREVIEW_COPY =
  'Computed from each company’s full profile once it is built. These preview profiles list the headings an extraction rule found; the rule can miss some headings and can include a sentence that is not a heading, so no comparison is drawn from them.';

const RANK_RULE =
  'Ranked by a fixed rule: how many selected companies share the area, then the number of change signals, then its position in the latest risk headings, then a fixed category order.';

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
  // that depends on a company's complete list (common and distinctive areas, attention ranking, the questions
  // derived from them) is a labeled placeholder whenever one is compared (SPEC §8.6, §13.2).
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

  return (
    <div className="flex flex-col gap-10">
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

      <section aria-labelledby="side-by-side">
        <h2 id="side-by-side" className="text-lg font-semibold tracking-tight text-foreground">
          Side by side
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
          <Table>
            <caption className="sr-only">Companies side by side</caption>
            <THead>
              <tr>
                <TH className="normal-case tracking-normal">Dimension</TH>
                {result.companies.map((c) => (
                  <TH key={c.ticker} className="normal-case tracking-normal">
                    {c.company}
                  </TH>
                ))}
                <TH className="w-px normal-case tracking-normal">
                  <span className="sr-only">Actions</span>
                </TH>
              </tr>
            </THead>
            <TBody>
              <Row label="Coverage" cells={result.companies.map((c) => TIER_COPY[c.tier].label)} />
              <Row label="Fiscal year ends" cells={result.companies.map((c) => formatDate(c.fiscalYearEnd))} />
              {result.trajectories.map((t) => (
                <Row
                  key={t.metric}
                  label={`${t.metric} trend`}
                  cells={t.values.map((v) => (isPreview(v.ticker) && v.trajectory === 'not_extracted' ? 'Placeholder' : TRAJECTORY_LABEL[v.trajectory]))}
                  muted
                  action={<SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.trajectory(t.metric) }} variant="ghost" label="Save" />}
                />
              ))}
              <Row label="Major attention area" cells={tickers.map((t) => (preview ? 'Placeholder' : majorArea(t)))} muted={preview} />
            </TBody>
          </Table>
        </div>
      </section>

      {preview ? (
        <section aria-labelledby="attention-areas">
          <h2 id="attention-areas" className="text-lg font-semibold tracking-tight text-foreground">
            Common and distinctive attention areas
          </h2>
          <div className="mt-3">
            <PlaceholderSlot title="Common and distinctive attention areas">{PREVIEW_COPY}</PlaceholderSlot>
          </div>
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <ThemeList
            id="common"
            title="Common attention areas"
            empty="No risk area appears for every selected company."
            themes={result.common}
            tickers={tickers}
            citations={citations}
          />
          <ThemeList
            id="distinctive"
            title="Distinctive attention areas"
            empty="Every risk area is shared by more than one selected company."
            themes={result.distinctive}
            tickers={tickers}
            citations={citations}
          />
        </div>
      )}

      <section aria-labelledby="diverging">
        <h2 id="diverging" className="text-lg font-semibold tracking-tight text-foreground">
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
                  <span className="min-w-0 flex-1">
                    {d.metric}: rising at {d.up.map(companyName).join(', ')}; falling at {d.down.map(companyName).join(', ')}.
                  </span>
                  <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.diverging(d.metric) }} variant="ghost" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section aria-labelledby="emphasis">
        <h2 id="emphasis" className="text-lg font-semibold tracking-tight text-foreground">
          Management emphasis
        </h2>
        <div className="mt-3">
          {emphasisBuilt ? (
            <ul className="grid gap-3 md:grid-cols-2">
              {result.managementEmphasis.map((m) => (
                <li key={m.ticker} className="rounded-card border border-border bg-card px-4 py-3 text-sm">
                  <p className="font-semibold text-foreground">{companyName(m.ticker)}</p>
                  {m.summary === null ? (
                    // Only the offline profile call writes an outlook: nothing was looked for and missed.
                    <p className="mt-1 italic text-muted-foreground">Not summarized</p>
                  ) : (
                    <>
                      {m.source === 'model' && <p className="mt-1 text-xs text-muted-foreground">Model-written</p>}
                      <p className="mt-1 text-foreground/80">
                        {m.summary} <CitationList ids={m.citationIds} context={citations} provenance="profile" claim={m.summary} />
                      </p>
                    </>
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

      <section aria-labelledby="ranking">
        <div className="flex items-center gap-2">
          <h2 id="ranking" className="text-lg font-semibold tracking-tight text-foreground">
            Attention ranking
          </h2>
          {!preview && (
            <Tooltip content={RANK_RULE}>
              <button type="button" aria-label="How the ranking works" className="text-muted-foreground hover:text-foreground">
                <Info className="size-4" />
              </button>
            </Tooltip>
          )}
        </div>
        {preview ? (
          <div className="mt-3">
            <PlaceholderSlot title="Attention ranking">{PREVIEW_COPY}</PlaceholderSlot>
          </div>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">{RANK_RULE} It is an order for investigation, not a rating.</p>
            <ol className="mt-3 flex flex-col divide-y divide-border overflow-hidden rounded-card border border-border bg-card">
              {result.attentionRanking.map((r) => (
                <li key={r.category} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="w-6 font-mono text-xs text-muted-foreground">{String(r.rank).padStart(2, '0')}</span>
                  <span className="min-w-40 text-sm font-medium text-foreground">{r.label}</span>
                  <span className="flex flex-wrap gap-1">
                    {r.tickers.map((t) => (
                      <TickerBadge key={t} ticker={t} />
                    ))}
                  </span>
                  <span className="ml-auto">
                    <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.theme(r.category) }} variant="ghost" label="Save" />
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section aria-labelledby="comparative-diligence">
        <h2 id="comparative-diligence" className="text-lg font-semibold tracking-tight text-foreground">
          Recommended comparative diligence
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Each opens Deep Analysis with the question filled in. Nothing runs until you click Run analysis.</p>
        {preview && (
          <div className="mt-3">
            <PlaceholderSlot title="Questions from common, distinctive and diverging areas">{PREVIEW_COPY}</PlaceholderSlot>
          </div>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {questions.map((r) => (
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
          ))}
        </ul>
      </section>
    </div>
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

function ThemeList({
  id,
  title,
  empty,
  themes,
  tickers,
  citations,
}: {
  id: string;
  title: string;
  empty: string;
  themes: CompareTheme[];
  tickers: string[];
  citations: Map<string, Citation>;
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {themes.length === 0 ? (
        <p className="mt-3 rounded-card border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {themes.map((t) => (
            <li key={t.category} className="rounded-card border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{t.label}</span>
                {t.tickers.map((tk) => (
                  <TickerBadge key={tk} ticker={tk} />
                ))}
                <span className="ml-auto">
                  <SaveFindingButton source={{ kind: 'compareRow', tickers, ref: compareRowRef.theme(t.category) }} variant="ghost" />
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                From the latest risk headings: <CitationList ids={t.citationIds} context={citations} provenance="profile" claim={t.label} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

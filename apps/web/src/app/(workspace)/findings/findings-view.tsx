'use client';

import { FINDING_ORIGIN_KINDS, THEMES, isThemeId, type FindingOriginKind, type FindingStatus, type ThemeId } from '@diligenceiq/core';
import { Bookmark, ChevronDown, FilterX, Search } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FindingRow, NoteDraftsProvider } from '@/components/diligence/finding-row';
import { PageContainer, PageHeader, SectionHeading } from '@/components/diligence/page';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { EmptyState } from '@/components/diligence/states';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { companyName } from '@/fixtures';
import { pluralize } from '@/lib/format';
import { EMPTY_FILTERS, activeFilterCount, filterFindings, groupFindings, type FindingFilters, type GroupBy } from '@/lib/findings-filter';
import { BOARD_ORDER, boardColumns, summarizeFindings } from '@/lib/findings-summary';
import { FINDING_ORIGIN, FINDING_STATUS } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-store';

type View = GroupBy | 'board';

const VIEW_LABEL: Record<View, string> = { theme: 'Theme', company: 'Company', status: 'Status', origin: 'Origin', board: 'Board' };
const VIEWS: readonly View[] = ['theme', 'company', 'status', 'origin', 'board'];

/** The status tiles' dots (the Badge tones, tokens only). */
const STATUS_DOT: Record<FindingStatus, string> = { NEEDS_FOLLOW_UP: 'bg-risk-med', ACTIVE: 'bg-primary', RESOLVED: 'bg-ok' };

export function FindingsView() {
  const params = useSearchParams();
  const { findings, analyses, status } = useWorkspace();
  const initialTheme = params.get('theme');
  const initialAnalysis = params.get('analysis') ?? '';
  const [filters, setFilters] = React.useState<FindingFilters>({
    ...EMPTY_FILTERS,
    theme: isThemeId(initialTheme) ? initialTheme : 'all',
    analysisId: initialAnalysis,
  });
  const [view, setView] = React.useState<View>('theme');
  // The filters a link set (theme, analysis) open "More filters" so the active one is visible.
  const [more, setMore] = React.useState(isThemeId(initialTheme) || Boolean(initialAnalysis));
  const set = <K extends keyof FindingFilters>(k: K, v: FindingFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const moreId = React.useId();

  const tickers = [...new Set(findings.flatMap((f) => f.tickers))].sort();
  const analysisOptions = analyses.filter((a) => findings.some((f) => f.analysisId === a.analysisId));
  // Theme counts reflect every other active filter, so the options never promise results that aren't there.
  const countBase = filterFindings(findings, { ...filters, theme: 'all' }, undefined, companyName);
  const visible = filterFindings(findings, filters, undefined, companyName);
  const groups = view === 'board' ? [] : groupFindings(visible, view, (t) => `${companyName(t)} (${t})`);
  const active = activeFilterCount(filters);
  const summary = summarizeFindings(findings);
  const moreActive = Number(filters.theme !== 'all') + Number(Boolean(filters.analysisId)) + Number(Boolean(filters.from)) + Number(Boolean(filters.to));

  return (
    <NoteDraftsProvider>
    <PageContainer>
      <PageHeader
        eyebrow="Capture"
        title="Findings"
        description="The durable record of what you have learned across Company Intelligence, Compare and Deep Analysis, with the evidence behind each finding."
      />

      {findings.length > 0 && (
        <section aria-label="Summary" className="mb-4 flex flex-wrap gap-3">
          <div className="flex min-w-[9rem] flex-1 flex-col rounded-card border border-border bg-card px-3.5 py-3">
            <span className="text-xs text-muted-foreground">Findings</span>
            <span className="text-2xl font-semibold tracking-tight text-foreground">{summary.total}</span>
            <span className="text-xs text-muted-foreground">across {pluralize(summary.companies, 'company', 'companies')}</span>
          </div>
          {BOARD_ORDER.map((s) => {
            const on = filters.status === s;
            const subline = s === 'NEEDS_FOLLOW_UP' && summary.firstFollowUp ? summary.firstFollowUp.title : on ? 'Showing only these' : 'Show only these';
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                // The name holds the visible sub-line too (label in name).
                aria-label={`${FINDING_STATUS[s].label}: ${summary.byStatus[s]}. ${subline}`}
                onClick={() => set('status', on ? 'all' : s)}
                className={cn(
                  'flex min-w-[9rem] flex-1 flex-col rounded-card border bg-card px-3.5 py-3 text-left hover:border-primary',
                  on ? 'border-primary ring-1 ring-primary' : 'border-border',
                )}
              >
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span aria-hidden className={cn('size-2 rounded-full', STATUS_DOT[s])} />
                  {FINDING_STATUS[s].label}
                </span>
                <span className="text-2xl font-semibold tracking-tight text-foreground">{summary.byStatus[s]}</span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{subline}</span>
              </button>
            );
          })}
          <div className="flex min-w-[18rem] flex-[2] flex-col rounded-card border border-border bg-card px-3.5 py-3">
            <span className="text-xs text-muted-foreground">By theme</span>
            <ul className="mt-1 flex flex-col">
              {summary.byTheme.map((t) => {
                const max = Math.max(1, ...summary.byTheme.map((x) => x.count));
                const on = filters.theme === t.id;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      aria-label={`${t.name}: ${t.count}`}
                      disabled={t.count === 0 && !on}
                      onClick={() => set('theme', on ? 'all' : t.id)}
                      className={cn('flex w-full items-center gap-2.5 rounded-md px-1 py-0.5 text-left text-xs hover:bg-secondary disabled:hover:bg-transparent', on && 'bg-accent')}
                    >
                      <span className="w-40 shrink-0 truncate text-foreground">{t.name}</span>
                      <span aria-hidden className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span className="block h-full rounded-full bg-primary/60" style={{ width: `${(t.count / max) * 100}%` }} />
                      </span>
                      <span className="w-4 text-right tabular-nums text-muted-foreground">{t.count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="f-search" className="sr-only">
              Search findings and notes
            </label>
            <Input id="f-search" type="search" value={filters.q} onChange={(e) => set('q', e.target.value)} placeholder="Search findings and notes" className="h-8 pl-8 text-sm" />
          </div>
          <label htmlFor="f-company" className="sr-only">
            Company
          </label>
          <NativeSelect id="f-company" value={filters.ticker} onChange={(e) => set('ticker', e.target.value)} className="h-8 w-auto text-sm">
            <option value="">Company: All</option>
            {tickers.map((t) => (
              <option key={t} value={t}>
                {t} · {companyName(t)}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="f-status" className="sr-only">
            Status
          </label>
          <NativeSelect id="f-status" value={filters.status} onChange={(e) => set('status', e.target.value as FindingStatus | 'all')} className="h-8 w-auto text-sm">
            <option value="all">Status: All</option>
            {BOARD_ORDER.map((s) => (
              <option key={s} value={s}>
                {FINDING_STATUS[s].label}
              </option>
            ))}
          </NativeSelect>
          <label htmlFor="f-origin" className="sr-only">
            Origin
          </label>
          <NativeSelect id="f-origin" value={filters.origin} onChange={(e) => set('origin', e.target.value as FindingOriginKind | 'all')} className="h-8 w-auto text-sm">
            <option value="all">Origin: All</option>
            {FINDING_ORIGIN_KINDS.filter((k) => k !== 'watch').map((k) => (
              <option key={k} value={k}>
                {FINDING_ORIGIN[k]}
              </option>
            ))}
          </NativeSelect>
          <Button variant="ghost" size="sm" aria-expanded={more} aria-controls={moreId} onClick={() => setMore((m) => !m)}>
            More filters{moreActive > 0 && ` (${moreActive})`}
            <ChevronDown aria-hidden className={cn('transition-transform', more && 'rotate-180')} />
          </Button>
        </div>
        <div id={moreId} hidden={!more} className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <FilterField label="Theme" htmlFor="f-theme">
            <NativeSelect id="f-theme" value={filters.theme} onChange={(e) => set('theme', e.target.value as ThemeId | 'all')} className="h-8 text-sm">
              <option value="all">All themes ({countBase.length})</option>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({countBase.filter((f) => f.theme === t.id).length})
                </option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Analysis" htmlFor="f-analysis">
            <NativeSelect id="f-analysis" value={filters.analysisId} onChange={(e) => set('analysisId', e.target.value)} className="h-8 text-sm">
              <option value="">All analyses</option>
              {analysisOptions.map((a) => (
                <option key={a.analysisId} value={a.analysisId}>
                  {a.question}
                </option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Saved from" htmlFor="f-from">
            <Input id="f-from" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set('from', e.target.value)} className="h-8 text-sm" />
          </FilterField>
          <FilterField label="Saved to" htmlFor="f-to">
            <Input id="f-to" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set('to', e.target.value)} className="h-8 text-sm" />
          </FilterField>
        </div>
      </div>

      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {pluralize(visible.length, 'finding')}
          {active > 0 && ` · ${pluralize(active, 'filter')} applied`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              <FilterX />
              Clear filters
            </Button>
          )}
          <Segmented<View> label="Group by" value={view} onValueChange={setView} options={VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))} />
        </div>
      </div>

      {status === 'loading' ? (
        <PageSkeleton />
      ) : findings.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No findings yet"
          description="Save a current risk or recommendation from Company Intelligence, an attention area from Compare, or anything in a Diligence Brief. Findings keep a copy of their cited passages."
          action={
            <Button asChild variant="secondary">
              <Link href="/intelligence/">Open Company Intelligence</Link>
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={FilterX}
          title="No findings match these filters"
          action={
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          }
        />
      ) : view === 'board' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {boardColumns(visible).map((col) => (
            <section key={col.status} aria-labelledby={`board-${col.status}`} className="flex flex-col gap-2 rounded-card border border-border bg-secondary/60 p-2.5">
              <h2 id={`board-${col.status}`} className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
                <span aria-hidden className={cn('size-2 rounded-full', STATUS_DOT[col.status])} />
                {FINDING_STATUS[col.status].label}{' '}
                <span className="font-normal text-muted-foreground">· {col.findings.length}</span>
              </h2>
              {col.findings.length === 0 ? (
                <p className="px-1 py-3 text-center text-xs text-muted-foreground">
                  {active > 0 ? 'None match the filters' : `No ${FINDING_STATUS[col.status].label.toLowerCase()} findings`}
                </p>
              ) : (
                col.findings.map((f) => <FindingRow key={f.findingId} finding={f} layout="board" />)
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`group-${g.key}`}>
              <SectionHeading id={`group-${g.key}`} className="mb-3">
                {g.label} · {g.findings.length}
              </SectionHeading>
              <div className="flex flex-col gap-3">
                {g.findings.map((f) => (
                  <FindingRow key={f.findingId} finding={f} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageContainer>
    </NoteDraftsProvider>
  );
}

function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

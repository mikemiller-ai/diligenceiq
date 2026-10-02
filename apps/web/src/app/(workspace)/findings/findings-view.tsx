'use client';

import { FINDING_ORIGIN_KINDS, THEMES, isThemeId, type FindingOriginKind, type FindingStatus, type ThemeId } from '@diligenceiq/core';
import { Bookmark, FilterX } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FindingRow } from '@/components/diligence/finding-row';
import { PageContainer, PageHeader, SectionHeading } from '@/components/diligence/page';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { EmptyState } from '@/components/diligence/states';
import { Button } from '@/components/ui/button';
import { Input, NativeSelect } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { companyName } from '@/fixtures';
import { pluralize } from '@/lib/format';
import { EMPTY_FILTERS, GROUP_BY, activeFilterCount, filterFindings, groupFindings, type FindingFilters, type GroupBy } from '@/lib/findings-filter';
import { FINDING_ORIGIN, FINDING_STATUS } from '@/lib/labels';
import { useWorkspace } from '@/lib/workspace-store';

export function FindingsView() {
  const params = useSearchParams();
  const { findings, analyses, status } = useWorkspace();
  const initialTheme = params.get('theme');
  const [filters, setFilters] = React.useState<FindingFilters>({
    ...EMPTY_FILTERS,
    theme: isThemeId(initialTheme) ? initialTheme : 'all',
    analysisId: params.get('analysis') ?? '',
  });
  const [groupBy, setGroupBy] = React.useState<GroupBy>('theme');
  const set = <K extends keyof FindingFilters>(k: K, v: FindingFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const tickers = [...new Set(findings.flatMap((f) => f.tickers))].sort();
  const analysisOptions = analyses.filter((a) => findings.some((f) => f.analysisId === a.analysisId));
  // Theme counts reflect every other active filter, so the tabs never promise results that aren't there.
  const countBase = filterFindings(findings, { ...filters, theme: 'all' });
  const visible = filterFindings(findings, filters);
  const groups = groupFindings(visible, groupBy, (t) => `${companyName(t)} (${t})`);
  const active = activeFilterCount(filters);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Capture"
        title="Findings"
        description="The durable record of what you have learned across Company Intelligence, Compare and Deep Analysis, with the evidence behind each finding."
      />

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
        <Segmented<ThemeId | 'all'>
          label="Filter by theme"
          value={filters.theme}
          onValueChange={(v) => set('theme', v)}
          options={[
            { value: 'all', label: 'All', count: countBase.length },
            ...THEMES.map((t) => ({
              value: t.id,
              label: t.shortName,
              count: countBase.filter((f) => f.theme === t.id).length,
            })),
          ]}
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <FilterField label="Company" htmlFor="f-company">
            <NativeSelect id="f-company" value={filters.ticker} onChange={(e) => set('ticker', e.target.value)} className="h-8 text-sm">
              <option value="">All companies</option>
              {tickers.map((t) => (
                <option key={t} value={t}>
                  {t} · {companyName(t)}
                </option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Status" htmlFor="f-status">
            <NativeSelect
              id="f-status"
              value={filters.status}
              onChange={(e) => set('status', e.target.value as FindingStatus | 'all')}
              className="h-8 text-sm"
            >
              <option value="all">All statuses</option>
              {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
                <option key={s} value={s}>
                  {FINDING_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Origin" htmlFor="f-origin">
            <NativeSelect
              id="f-origin"
              value={filters.origin}
              onChange={(e) => set('origin', e.target.value as FindingOriginKind | 'all')}
              className="h-8 text-sm"
            >
              <option value="all">All origins</option>
              {FINDING_ORIGIN_KINDS.filter((k) => k !== 'watch').map((k) => (
                <option key={k} value={k}>
                  {FINDING_ORIGIN[k]}
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

      <div className="mb-4 mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {pluralize(visible.length, 'finding')}
          {active > 0 && ` · ${pluralize(active, 'filter')} applied`}
        </p>
        <div className="flex items-center gap-2">
          {active > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              <FilterX />
              Clear filters
            </Button>
          )}
          <label htmlFor="f-group" className="text-xs font-medium text-muted-foreground">
            Group by
          </label>
          <NativeSelect id="f-group" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className="h-8 w-32 text-sm">
            {GROUP_BY.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABEL[g]}
              </option>
            ))}
          </NativeSelect>
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
      ) : groups.length === 0 ? (
        <EmptyState
          icon={FilterX}
          title="No findings match these filters"
          action={
            <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
              Clear filters
            </Button>
          }
        />
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
  );
}

const GROUP_LABEL: Record<GroupBy, string> = { theme: 'Theme', company: 'Company', status: 'Status', origin: 'Origin' };

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

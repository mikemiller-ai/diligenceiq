'use client';

import { ArrowRight, Search } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { PageContainer, PageHeader, SectionHeading } from '@/components/diligence/page';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { companies, featuredCompanies, fiscalYearLabel, type CompanyRecord } from '@/fixtures';
import { TIER_COPY } from '@/fixtures/profiles';
import { intelligenceHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';

const isFixtureSetId = (id: string | null) => id?.startsWith('fixture-') ?? false;

/** Company selector (SPEC §8.1): deep-coverage companies featured, Apple first, search across all. */
export function CompanySelector() {
  const { profileTickers, companies: active } = useWorkspace();
  // "Preview" describes the SET (fixture profiles, SPEC §8.6), not the fact that a company has a profile.
  const preview = isFixtureSetId(active?.profileSetId ?? null);
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const all = companies();
  const matches = q ? all.filter((c) => c.ticker.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)) : all;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Understand"
        title="Company Intelligence"
        description="Pick a company to see what is happening, what changed, what deserves attention and what to investigate next. No question needed."
      />

      <section aria-labelledby="featured">
        <SectionHeading id="featured">Deep coverage</SectionHeading>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {featuredCompanies().map((c) => (
            <li key={c.ticker}>
              <Link
                href={intelligenceHref(c.ticker)}
                className="group flex h-full flex-col rounded-card border border-border bg-card px-4 py-3.5 shadow-sm transition-colors hover:border-primary"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{c.ticker}</span>
                  {profileTickers.has(c.ticker) && preview && <Badge tone="accent">Preview profile</Badge>}
                </span>
                <span className="mt-1.5 text-[15px] font-semibold text-foreground group-hover:text-primary">{c.company}</span>
                <span className="mt-auto pt-2 text-xs text-muted-foreground">{TIER_COPY[c.tier].label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="all-companies" className="mt-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading id="all-companies">All companies · {all.length}</SectionHeading>
          <div className="relative sm:w-72">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="company-search" className="sr-only">
              Search companies
            </label>
            <Input
              id="company-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or ticker"
              className="pl-8"
            />
          </div>
        </div>
        {matches.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No company in the corpus matches “{query}”.</p>
        ) : (
          <ul className="mt-3 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {matches.map((c) => (
              <CompanyRow key={c.ticker} company={c} previewProfile={preview && profileTickers.has(c.ticker)} />
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}

function CompanyRow({ company: c, previewProfile }: { company: CompanyRecord; previewProfile: boolean }) {
  return (
    <li className="border-b border-border">
      <Link href={intelligenceHref(c.ticker)} className="group flex items-center gap-3 py-2.5">
        <span className="w-14 font-mono text-xs font-semibold text-primary">{c.ticker}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground group-hover:text-primary">{c.company}</span>
        <span className="text-xs text-muted-foreground">
          {c.outsideWindow
            ? `${fiscalYearLabel(c.latestAnnualPeriodEnd)} · Outside review window`
            : previewProfile
              ? 'Preview profile'
              : TIER_COPY[c.tier].label}
        </span>
        <ArrowRight aria-hidden className="size-3.5 text-muted-foreground group-hover:text-primary" />
      </Link>
    </li>
  );
}

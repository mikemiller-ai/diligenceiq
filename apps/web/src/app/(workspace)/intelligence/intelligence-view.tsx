'use client';

import { ArrowLeft, Building2, CalendarX, FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageContainer } from '@/components/diligence/page';
import { EmptyState } from '@/components/diligence/states';
import { CompanySelector } from '@/components/intelligence/company-selector';
import { IntelligenceDashboard } from '@/components/intelligence/dashboard';
import { Button } from '@/components/ui/button';
import { FILINGS, companyByTicker, fiscalYearLabel } from '@/fixtures';
import { filingHref } from '@/components/diligence/evidence';
import { intelligenceHref, newAnalysisHref } from '@/lib/links';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { ErrorPanel } from '@/components/diligence/states';
import { NoticeBar } from '@/components/diligence/states';
import { useProfile, useWorkspace } from '@/lib/workspace-store';
import * as React from 'react';

export function IntelligenceView() {
  const ticker = (useSearchParams().get('ticker') ?? '').trim().toUpperCase();
  if (!ticker) return <CompanySelector />;
  return <CompanyIntelligence ticker={ticker} />;
}

function CompanyIntelligence({ ticker }: { ticker: string }) {
  const company = companyByTicker(ticker);
  const { profile, state } = useProfile(company && !company.outsideWindow ? ticker : null);
  const { status: workspaceStatus } = useWorkspace();
  const back = (
    <Link href={intelligenceHref()} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft aria-hidden className="size-3.5" /> All companies
    </Link>
  );

  if (!company) {
    return (
      <PageContainer>
        {back}
        <EmptyState
          icon={FileQuestion}
          title="Company not found"
          description={`“${ticker}” is not one of the companies in the SEC filing corpus.`}
          action={
            <Button asChild variant="secondary">
              <Link href={intelligenceHref()}>Choose a company</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (company.outsideWindow) {
    // Assumptions G2: GE_10K_2015 is GE Capital's FY2014 annual report, outside the review
    // window. It has no profile and Deep Analysis does not take it as a company filter, so
    // this page offers neither; the filing itself stays readable.
    const filing = FILINGS.find((f) => f.ticker === company.ticker);
    return (
      <PageContainer>
        {back}
        <EmptyState
          icon={CalendarX}
          title={`${company.company}, ${fiscalYearLabel(company.latestAnnualPeriodEnd)}: outside the review window`}
          description="Its only filing in the corpus predates the review window, so it has no Company Intelligence profile and is not offered as a company filter in Deep Analysis. It is not current coverage of the company."
          action={
            filing ? (
              <Button asChild variant="secondary">
                <Link href={filingHref(filing.documentId)}>Open the filing</Link>
              </Button>
            ) : undefined
          }
        />
      </PageContainer>
    );
  }

  if (!profile && state === 'loading') {
    return (
      <PageContainer className="max-w-[1200px]">
        {back}
        <PageSkeleton />
      </PageContainer>
    );
  }

  if (!profile && state === 'error') {
    return (
      <PageContainer>
        {back}
        <ErrorPanel
          title="Company Intelligence could not be loaded"
          message={
            workspaceStatus === 'error'
              ? 'Your demo workspace could not be opened, so the profile cannot be loaded. The notice above explains why; use its Retry.'
              : 'The stored profile could not be read right now. Reload the page to try again; Deep Analysis still works.'
          }
          code={workspaceStatus === 'error' ? 'WORKSPACE_UNAVAILABLE' : 'PROFILE_UNAVAILABLE'}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={newAnalysisHref({ tickers: [company.ticker] })}>Ask about {company.company}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  if (!profile) {
    // PROFILE_MISSING (architecture §9.1): offer Deep Analysis for that company instead.
    return (
      <PageContainer>
        {back}
        <EmptyState
          icon={Building2}
          title={`Intelligence for ${company.company} isn’t built for this index version`}
          description="You can still ask any question about this company in Deep Analysis; answers are drawn from its filings."
          action={
            <Button asChild>
              <Link href={newAnalysisHref({ tickers: [company.ticker] })}>Ask about {company.company}</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-[1200px]">
      {back}
      <VersionSkew profileIndexVersion={profile!.version.indexVersion} />
      <IntelligenceDashboard profile={profile!} />
    </PageContainer>
  );
}

/**
 * Index / profile version skew (SPEC §38.2): the profile was built from an older index than the
 * one Deep Analysis searches. Its citations still open, because profiles carry passage text.
 */
function VersionSkew({ profileIndexVersion }: { profileIndexVersion: string }) {
  const { client } = useWorkspace();
  const [current, setCurrent] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    client
      .health()
      .then((h) => !cancelled && setCurrent(h.indexVersion))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  if (!current || current === profileIndexVersion) return null;
  return (
    <NoticeBar className="mb-4">
      Built from index {profileIndexVersion}; Deep Analysis searches {current}. The cited passages below are stored with the profile, so they
      still open as they were.
    </NoticeBar>
  );
}

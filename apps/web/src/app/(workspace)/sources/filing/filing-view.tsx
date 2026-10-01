'use client';

import { ArrowLeft, FileQuestion, FileText } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FilingTypeBadge, TickerBadge } from '@/components/diligence/badges';
import { ExternalSourceLink } from '@/components/diligence/evidence';
import { PageContainer, SectionHeading } from '@/components/diligence/page';
import { EmptyState, NoticeBar } from '@/components/diligence/states';
import { Button } from '@/components/ui/button';
import { FILINGS, PASSAGES } from '@/fixtures';
import { formatCount, formatDate } from '@/lib/format';
import { intelligenceHref } from '@/lib/links';
import { cn } from '@/lib/utils';

const chunkAnchor = (chunkId: string) => `chunk-${chunkId}`;

function useHashTarget(): string | null {
  const [hash, setHash] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setHash(decodeURIComponent(window.location.hash.replace(/^#/, '')) || null);
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return hash;
}

export function FilingView() {
  const id = useSearchParams().get('id');
  const filing = FILINGS.find((f) => f.documentId === id);
  const target = useHashTarget();
  const passages = React.useMemo(
    () => PASSAGES.filter((p) => p.documentId === id).sort((a, b) => a.charStart - b.charStart),
    [id],
  );

  React.useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target);
    if (el) {
      el.scrollIntoView({ block: 'center' });
      el.focus({ preventScroll: true });
    }
  }, [target, passages]);

  if (!filing) {
    return (
      <PageContainer>
        <EmptyState
          icon={FileQuestion}
          title="Filing not found"
          description="This document isn’t in the corpus. It may have been renamed or the link is incomplete."
          action={
            <Button asChild variant="secondary">
              <Link href="/intelligence/">Open Company Intelligence</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const sections = [...new Set(passages.map((p) => p.section))];

  return (
    <PageContainer>
      <Link href={intelligenceHref(filing.ticker)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-3.5" /> {filing.company}
      </Link>

      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <TickerBadge ticker={filing.ticker} />
          <FilingTypeBadge type={filing.filingType} />
        </div>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">{filing.company}</h1>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Period ended</dt>
            <dd className="text-foreground/80">{formatDate(filing.periodEnd)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Filed</dt>
            <dd className="text-foreground/80">{formatDate(filing.filingDate)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Length</dt>
            <dd className="tabular-nums text-foreground/80">{formatCount(filing.characters)} characters</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Document</dt>
            <dd className="font-mono text-xs leading-5 text-foreground/80">{filing.documentId}</dd>
          </div>
          <div>
            <dt className="sr-only">Original</dt>
            <dd>
              <ExternalSourceLink href={filing.sourceUrl} />
            </dd>
          </div>
        </dl>
      </header>

      <NoticeBar className="mt-5">
        <span>
          The full readable filing with section navigation is served by the Sources API in a later phase. This view shows the
          passages from this filing that the company profiles cite, at their exact character positions.
        </span>
      </NoticeBar>

      {passages.length === 0 ? (
        <EmptyState
          icon={FileText}
          className="mt-6"
          title="No cited passages from this filing"
          description="Nothing in the app cites this filing yet. The original is available on SEC EDGAR."
        />
      ) : (
        <div className="mt-6 grid gap-8 lg:grid-cols-[220px_minmax(0,760px)]">
          <nav aria-label="Sections" className="lg:sticky lg:top-20 lg:h-fit">
            <SectionHeading>Sections</SectionHeading>
            <ul className="mt-2 flex flex-col gap-0.5">
              {sections.map((s) => {
                const first = passages.find((p) => p.section === s);
                return (
                  <li key={s}>
                    <a
                      href={first ? `#${chunkAnchor(first.chunkId)}` : undefined}
                      className="block rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-secondary hover:text-foreground"
                    >
                      {s}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex flex-col gap-6">
            {sections.map((s) => (
              <section key={s} aria-label={s}>
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{s}</h2>
                <div className="mt-3 flex flex-col gap-4">
                  {passages
                    .filter((p) => p.section === s)
                    .map((p) => (
                      <div
                        key={p.chunkId}
                        id={chunkAnchor(p.chunkId)}
                        tabIndex={-1}
                        className={cn(
                          'passage-target rounded-md border border-border bg-card px-5 py-4 outline-none transition-colors',
                          target === chunkAnchor(p.chunkId) && 'border-primary bg-accent',
                        )}
                      >
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {p.chunkId} · characters {formatCount(p.charStart)}–{formatCount(p.charEnd)}
                        </p>
                        <p className="mt-2 text-md leading-7 text-foreground">{p.text}</p>
                      </div>
                    ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

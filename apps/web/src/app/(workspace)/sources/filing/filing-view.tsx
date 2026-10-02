'use client';

import { type SourceDocumentResponse, isCatalogTicker, tickerOfDocumentId } from '@diligenceiq/core';
import { ArrowLeft, FileQuestion, Highlighter } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { FilingTypeBadge, TickerBadge } from '@/components/diligence/badges';
import { ExternalSourceLink } from '@/components/diligence/evidence';
import { PageContainer, SectionHeading } from '@/components/diligence/page';
import { PageSkeleton } from '@/components/diligence/page-skeleton';
import { EmptyState, ErrorPanel, NoticeBar, RetryButton } from '@/components/diligence/states';
import { Button } from '@/components/ui/button';
import { formatCount, formatDate } from '@/lib/format';
import { hasInAppHistory } from '@/lib/in-app-history';
import { intelligenceHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { type EvidenceUnavailable, isUnavailable } from '@/lib/workspace-client';
import { useWorkspace } from '@/lib/workspace-store';

/*
 * The readable source view (SPEC §16.2; Phase 6): a filing's processed text, exactly as the index
 * chunked it, with section navigation and the cited passage highlighted (`#chunk-<id>`). Every
 * citation's "Open filing" lands here, with the citation's index version (`&iv=`): chunk IDs and
 * offsets only mean something within one version, so a citation from another version opens the
 * current text with a notice and nothing highlighted. The text comes from
 * `GET /api/sources/:documentId`; nothing is summarized or generated. SEC section names appear
 * here on purpose (verification view).
 */

const CHUNK_PREFIX = 'chunk-';
const sectionAnchor = (i: number) => `section-${i}`;

/** The URL hash without `#`, percent-decoded; a malformed escape (`#chunk-%E0`) is kept as written. */
export function readHash(raw: string): string | null {
  const h = raw.replace(/^#/, '');
  if (!h) return null;
  try {
    return decodeURIComponent(h);
  } catch {
    return h;
  }
}

function useHashTarget(): string | null {
  const [hash, setHash] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setHash(readHash(window.location.hash));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  return hash;
}

type LoadState =
  | { status: 'loading' }
  /** `staleVersion`: the link's citation is from this index version, not the one the text comes from. */
  | { status: 'ready'; source: SourceDocumentResponse; staleVersion?: string }
  | { status: 'unavailable'; reason: EvidenceUnavailable['unavailable'] }
  | { status: 'error'; requestId?: string };

/** "Missing source document" (architecture §9.1): back where the citation was opened, else the company. */
function FilingMissing({ documentId }: { documentId: string | null }) {
  const ticker = documentId ? tickerOfDocumentId(documentId) : null;
  const pathname = usePathname();
  // Only back into the app: a filing opened in a new tab or straight from outside has nowhere in it to return to.
  const canGoBack = hasInAppHistory(pathname);
  return (
    <PageContainer>
      <EmptyState
        icon={FileQuestion}
        title="This filing isn’t available."
        description="It isn’t in the current filing index, or the link is incomplete. A saved finding keeps its copied passage."
        action={
          canGoBack ? (
            <Button variant="secondary" onClick={() => window.history.back()}>
              <ArrowLeft />
              Go back
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={intelligenceHref(ticker && isCatalogTicker(ticker) ? ticker : undefined)}>Open Company Intelligence</Link>
            </Button>
          )
        }
      />
    </PageContainer>
  );
}

export function FilingView() {
  const params = useSearchParams();
  const id = params.get('id');
  const iv = params.get('iv') ?? undefined;
  const { client } = useWorkspace();
  const [attempt, setAttempt] = React.useState(0);
  // The result is keyed by the request it answers, so a new ID or a retry reads as loading until it lands.
  const key = `${id ?? ''}#${iv ?? ''}#${attempt}`;
  const [result, setResult] = React.useState<{ key: string; state: LoadState } | null>(null);
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    const toState = (r: SourceDocumentResponse | EvidenceUnavailable, staleVersion?: string): LoadState =>
      isUnavailable(r) ? { status: 'unavailable', reason: r.unavailable } : { status: 'ready', source: r, ...(staleVersion ? { staleVersion } : {}) };
    client
      .source(id, iv)
      // A citation from another index version: show the filing's current text, flagged, never highlighted.
      .then((r) => (iv && isUnavailable(r) && r.unavailable === 'index_version' ? client.source(id).then((cur) => toState(cur, iv)) : toState(r)))
      .then((state) => live && setResult({ key, state }))
      .catch((err: unknown) => live && setResult({ key, state: { status: 'error', requestId: (err as { requestId?: string })?.requestId } }));
    return () => {
      live = false;
    };
  }, [client, id, iv, key]);
  const state: LoadState = result?.key === key ? result.state : { status: 'loading' };

  if (!id || (state.status === 'unavailable' && state.reason === 'not_found')) return <FilingMissing documentId={id} />;
  if (state.status === 'loading') return <PageSkeleton />;
  if (state.status === 'unavailable') {
    return (
      <PageContainer>
        <EmptyState icon={FileQuestion} title="Filing text unavailable" description="The filing index is not available right now. Citations still show their passages in the evidence drawer." />
      </PageContainer>
    );
  }
  if (state.status === 'error') {
    return (
      <PageContainer>
        <ErrorPanel title="The filing could not be loaded" message="Check your connection and try again." requestId={state.requestId} action={<RetryButton onClick={() => setAttempt((n) => n + 1)} />} />
      </PageContainer>
    );
  }
  return <FilingDocument source={state.source} staleVersion={state.staleVersion} />;
}

interface Segment {
  start: number;
  end: number;
  highlight: boolean;
}

/** A section's text split around the highlighted passage (chunks never cross a section boundary). */
function segments(start: number, end: number, target: { charStart: number; charEnd: number } | null): Segment[] {
  if (!target || target.charEnd <= start || target.charStart >= end) return [{ start, end, highlight: false }];
  const out: Segment[] = [];
  const a = Math.max(start, target.charStart);
  const b = Math.min(end, target.charEnd);
  if (a > start) out.push({ start, end: a, highlight: false });
  out.push({ start: a, end: b, highlight: true });
  if (b < end) out.push({ start: b, end, highlight: false });
  return out;
}

type ReadingSection = SourceDocumentResponse['sections'][number];

/**
 * Sections in reading order, plus an untitled section for any gap, so every character of the
 * filing is shown exactly once: a section that overlaps the one before it starts where that one
 * ended (its overlapping head is already on the page), and one wholly inside it is dropped.
 */
export function readingSections(stored: readonly ReadingSection[], length: number): ReadingSection[] {
  const out: ReadingSection[] = [];
  let at = 0;
  for (const s of [...stored].sort((a, b) => a.charStart - b.charStart || a.charEnd - b.charEnd)) {
    if (s.charStart > at) out.push({ title: 'Untitled text', code: 'GAP', charStart: at, charEnd: Math.min(s.charStart, length) });
    const charStart = Math.max(s.charStart, at);
    const charEnd = Math.min(s.charEnd, length);
    if (charEnd > charStart) out.push({ ...s, charStart, charEnd });
    at = Math.max(at, charEnd);
  }
  if (at < length) out.push({ title: 'Untitled text', code: 'GAP', charStart: at, charEnd: length });
  return out;
}

function FilingDocument({ source, staleVersion }: { source: SourceDocumentResponse; staleVersion?: string }) {
  const { filing, text } = source;
  const hash = useHashTarget();
  const targetId = hash?.startsWith(CHUNK_PREFIX) ? hash.slice(CHUNK_PREFIX.length) : null;
  // A citation from another index version is never located in this text: same ID, possibly different words.
  const target = React.useMemo(() => (targetId && !staleVersion ? (source.chunks.find((c) => c.chunkId === targetId) ?? null) : null), [source.chunks, targetId, staleVersion]);
  const sections = React.useMemo(() => readingSections(source.sections, text.length), [source.sections, text.length]);
  const targetSection = target ? sections.findIndex((s) => target.charStart >= s.charStart && target.charStart < s.charEnd) : -1;

  React.useEffect(() => {
    if (!target) return;
    const el = document.getElementById(`${CHUNK_PREFIX}${target.chunkId}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: true });
    }
  }, [target]);

  return (
    <PageContainer>
      <Link href={intelligenceHref(filing.ticker)} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-3.5" /> {filing.company}
      </Link>

      <header className="border-b border-border pb-5">
        <div className="flex flex-wrap items-center gap-2">
          <TickerBadge ticker={filing.ticker} />
          <FilingTypeBadge type={filing.filingType} />
          <span className="font-mono text-xs text-muted-foreground">{filing.fiscalLabel}</span>
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
            <dd className="tabular-nums text-foreground/80">{formatCount(text.length)} characters</dd>
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

      {staleVersion ? (
        <NoticeBar className="mt-5">
          <span data-testid="stale-version-notice">
            This citation comes from an earlier version of the filing index, so the filing text below may not match it and nothing is highlighted. The
            citation’s own passage is unchanged in the evidence drawer.
          </span>
        </NoticeBar>
      ) : target ? (
        <NoticeBar className="mt-5">
          <span data-testid="highlight-notice">
            Highlighted: the cited passage <code className="font-mono text-xs">{target.chunkId}</code> in {target.section}, characters {formatCount(target.charStart)}–{formatCount(target.charEnd)}.{' '}
            <a href={`#${CHUNK_PREFIX}${target.chunkId}`} className="text-primary underline underline-offset-2" onClick={(e) => {
              e.preventDefault();
              const el = document.getElementById(`${CHUNK_PREFIX}${target.chunkId}`);
              el?.scrollIntoView({ block: 'start' });
              el?.focus({ preventScroll: true });
            }}>
              Go to passage
            </a>
          </span>
        </NoticeBar>
      ) : (
        targetId && (
          <NoticeBar className="mt-5">
            <span>
              The passage <code className="font-mono text-xs">{targetId}</code> is not in this filing’s current index, so nothing is highlighted. The full filing text is below.
            </span>
          </NoticeBar>
        )
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[240px_minmax(0,780px)]">
        <nav aria-label="Sections" className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto">
          <SectionHeading>Sections</SectionHeading>
          <ul className="mt-2 flex flex-col gap-0.5">
            {sections.map((s, i) => (
              <li key={`${s.code}-${s.charStart}`}>
                <a
                  href={`#${sectionAnchor(i)}`}
                  aria-current={i === targetSection ? 'location' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-secondary hover:text-foreground',
                    i === targetSection && 'bg-accent font-medium text-foreground',
                  )}
                >
                  {i === targetSection && <Highlighter aria-hidden className="size-3.5 shrink-0 text-primary" />}
                  <span className="min-w-0 flex-1">{s.title}</span>
                  <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{formatCount(s.charEnd - s.charStart)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <article aria-label={`${filing.company} ${filing.fiscalLabel} ${filing.filingType}`} className="flex min-w-0 flex-col gap-8">
          {sections.map((s, i) => (
            <section key={`${s.code}-${s.charStart}`} id={sectionAnchor(i)} aria-labelledby={`${sectionAnchor(i)}-title`} className="scroll-mt-20">
              <h2 id={`${sectionAnchor(i)}-title`} className="text-lg font-semibold tracking-tight text-foreground">
                {s.title}
              </h2>
              <div className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-foreground/90">
                {segments(s.charStart, s.charEnd, target).map((seg) =>
                  seg.highlight && target ? (
                    <mark
                      key={seg.start}
                      id={`${CHUNK_PREFIX}${target.chunkId}`}
                      tabIndex={-1}
                      className="passage-target scroll-mt-24 rounded-[3px] bg-primary/15 px-0.5 text-foreground outline-none [box-decoration-break:clone]"
                    >
                      {text.slice(seg.start, seg.end)}
                    </mark>
                  ) : (
                    <React.Fragment key={seg.start}>{text.slice(seg.start, seg.end)}</React.Fragment>
                  ),
                )}
              </div>
            </section>
          ))}
        </article>
      </div>
    </PageContainer>
  );
}

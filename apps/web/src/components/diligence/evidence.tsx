'use client';

import type { Citation } from '@diligenceiq/core';
import { citationLabel } from '@diligenceiq/core';
import { AlertTriangle, ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/tooltip';
import { chipLabel } from '@/lib/citations';
import { formatDate } from '@/lib/format';
import { filingHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { MicroLabel } from '@/components/evidence/section';

/**
 * Where a citation comes from, so the drawer never claims more than is true (SPEC §8.6, §16):
 * - `brief`: a Deep Analysis context snapshot, the passages supplied to the one model call;
 * - `profile`: a passage a stored Company Intelligence profile (or Compare, built from profiles) cites;
 * - `finding`: the copy of a passage saved with a finding.
 */
export type EvidenceProvenance = 'brief' | 'profile' | 'finding';

const PROVENANCE_LABEL: Record<EvidenceProvenance, string> = {
  brief: 'Validated — supplied to the model',
  profile: 'Filing text cited by the company profile',
  finding: 'Copy saved with this finding',
};

const INVALID_COPY: Record<EvidenceProvenance, string> = {
  brief: 'was not among the passages supplied to the model, so validation removed it.',
  profile: 'is not among the passages this profile cites.',
  finding: 'is not among the passages saved with this finding.',
};

export type EvidenceTarget =
  | { kind: 'citation'; citation: Citation; provenance: EvidenceProvenance }
  | { kind: 'invalid'; chunkId: string; provenance: EvidenceProvenance }
  /** A signal's evidence for each period compared, side by side (SPEC §10, §16.2). */
  | { kind: 'periods'; title: string; periods: Array<{ period: string; citations: Citation[] }> };

const EvidenceContext = React.createContext<((t: EvidenceTarget) => void) | null>(null);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = React.useState<{ target: EvidenceTarget; path: string | null } | null>(null);
  // The drawer has no Radix trigger (any chip can open it), so focus is returned by hand to
  // whatever opened it when it closes (keyboard users land back on the citation).
  const opener = React.useRef<HTMLElement | null>(null);
  const show = React.useCallback(
    (target: EvidenceTarget) => {
      if (document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
      setState({ target, path: pathname });
    },
    [pathname],
  );
  // The provider lives in the shell layout. Tying "open" to the path it was opened on
  // closes the drawer when a link inside it (e.g. "Open filing") changes the route.
  const open = state !== null && state.path === pathname;
  return (
    <EvidenceContext.Provider value={show}>
      {children}
      <Sheet open={open} onOpenChange={(o) => !o && setState(null)}>
        <SheetContent
          aria-describedby="evidence-description"
          onCloseAutoFocus={(e) => {
            if (opener.current?.isConnected) {
              e.preventDefault();
              opener.current.focus();
            }
          }}
        >
          {state && <EvidencePanel target={state.target} />}
        </SheetContent>
      </Sheet>
    </EvidenceContext.Provider>
  );
}

export function useEvidence() {
  const ctx = React.useContext(EvidenceContext);
  if (!ctx) throw new Error('useEvidence must be used inside EvidenceProvider');
  return ctx;
}

export { filingHref };

function EvidencePanel({ target }: { target: EvidenceTarget }) {
  if (target.kind === 'periods') return <PeriodsPanel title={target.title} periods={target.periods} />;
  if (target.kind === 'invalid') {
    return (
      <div className="flex flex-col gap-3 p-6 pr-12">
        <MicroLabel>Evidence</MicroLabel>
        <SheetTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <span className="grid size-7 place-items-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle aria-hidden className="size-4" />
          </span>
          Unsupported — flagged
        </SheetTitle>
        <SheetDescription id="evidence-description" className="text-sm text-foreground/80">
          <code className="font-mono">{target.chunkId}</code> {INVALID_COPY[target.provenance]} Treat the related statement
          as unsupported until it is verified.
        </SheetDescription>
      </div>
    );
  }
  const c = target.citation;
  const verified = target.provenance === 'brief';
  return (
    <>
      <div className="relative overflow-hidden bg-navy px-6 pb-5 pt-5 pr-12 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-primary/40 blur-3xl" />
        <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Evidence</p>
        <SheetTitle className="relative mt-1.5 text-xl font-semibold tracking-tight text-white">{c.company}</SheetTitle>
        <SheetDescription id="evidence-description" className="relative mt-1 font-mono text-[12px] text-white/70">
          {c.ticker} · {c.fiscalLabel} {c.filingType} · {c.section}
        </SheetDescription>
        <p
          data-testid="evidence-provenance"
          className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/80"
        >
          {verified ? <ShieldCheck aria-hidden className="size-3 text-ok" /> : <FileText aria-hidden className="size-3 text-white/70" />}
          {PROVENANCE_LABEL[target.provenance]}
        </p>
      </div>
      {/* Index passages are long, so this region scrolls; it is focusable so keyboard users can scroll it (WCAG 2.1.1). */}
      <div tabIndex={0} role="region" aria-label="Source passage and details" className="flex-1 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <MicroLabel>Source passage</MicroLabel>
        <blockquote className="mt-2 rounded-lg border border-border bg-secondary/60 p-4 text-[15px] leading-7 text-foreground">
          {c.text}
        </blockquote>
        <dl className="mt-6 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-muted-foreground">Document</dt>
          <dd className="break-all font-mono text-xs leading-5 text-foreground/80">{c.documentId}</dd>
          <dt className="text-muted-foreground">Section</dt>
          <dd className="text-foreground/80">{c.section}</dd>
          <dt className="text-muted-foreground">Period ended</dt>
          <dd className="tabular-nums text-foreground/80">{formatDate(c.periodEnd)}</dd>
          <dt className="text-muted-foreground">Filed</dt>
          <dd className="tabular-nums text-foreground/80">{formatDate(c.filingDate)}</dd>
          <dt className="text-muted-foreground">Citation ID</dt>
          <dd className="break-all font-mono text-xs leading-5 text-foreground/80">{c.chunkId}</dd>
          <dt className="text-muted-foreground">Characters</dt>
          <dd className="font-mono text-xs leading-5 tabular-nums text-foreground/80">
            {c.charStart.toLocaleString('en-US')}–{c.charEnd.toLocaleString('en-US')}
          </dd>
        </dl>
      </div>
      <div className="flex items-center gap-2 border-t border-border px-6 py-3">
        <Button asChild variant="secondary" size="sm">
          <Link href={filingHref(c.documentId, c.chunkId)}>
            <FileText />
            Open filing
          </Link>
        </Button>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{citationLabel(c)}</span>
      </div>
    </>
  );
}

function PeriodsPanel({ title, periods }: { title: string; periods: Array<{ period: string; citations: Citation[] }> }) {
  const show = useEvidence();
  return (
    <>
      <div className="relative overflow-hidden bg-navy px-6 pb-5 pt-5 pr-12 text-white">
        <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Evidence by period</p>
        <SheetTitle className="relative mt-1.5 text-xl font-semibold tracking-tight text-white">{title}</SheetTitle>
        <SheetDescription id="evidence-description" className="relative mt-1 text-[13px] text-white/70">
          The passages behind each period compared.
        </SheetDescription>
      </div>
      <div tabIndex={0} role="region" aria-label="Passages by period" className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        {periods.map((p) => (
          <section key={p.period} aria-label={p.period}>
            <MicroLabel>{p.period}</MicroLabel>
            {p.citations.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No passage for this period.</p>
            ) : (
              p.citations.map((c) => (
                <div key={c.chunkId} className="mt-2">
                  <blockquote className="rounded-lg border border-border bg-secondary/60 p-4 text-[15px] leading-7 text-foreground">{c.text}</blockquote>
                  <button
                    type="button"
                    onClick={() => show({ kind: 'citation', citation: c, provenance: 'profile' })}
                    className="mt-1.5 font-mono text-[11px] text-primary hover:underline"
                  >
                    {citationLabel(c)}
                  </button>
                </div>
              ))
            )}
          </section>
        ))}
      </div>
    </>
  );
}

/** Inline citation chip. Unknown IDs render as a flagged chip rather than a link. */
export function CitationChip({
  id,
  citation,
  provenance,
  onNavy = false,
  className,
}: {
  id: string;
  citation?: Citation;
  provenance: EvidenceProvenance;
  onNavy?: boolean;
  className?: string;
}) {
  const show = useEvidence();
  const chip = (
    <button
      type="button"
      onClick={() => show(citation ? { kind: 'citation', citation, provenance } : { kind: 'invalid', chunkId: id, provenance })}
      aria-label={citation ? `View evidence ${id}` : `Unverified citation ${id}`}
      className={cn(
        'ml-1 inline-flex translate-y-[-1px] items-center whitespace-nowrap rounded-md border px-1.5 align-baseline font-mono text-[11px] font-medium leading-[18px] transition-colors',
        citation
          ? onNavy
            ? 'border-white/15 bg-white/[0.06] text-[#b9c6fd] hover:border-on-navy-accent hover:bg-white/10 hover:text-white'
            : 'border-primary/25 bg-primary/[0.06] text-primary hover:border-primary hover:bg-primary hover:text-white'
          : 'border-destructive/30 bg-destructive/10 text-foreground line-through decoration-destructive',
        className,
      )}
    >
      {citation ? chipLabel(citation) : id}
    </button>
  );
  return citation ? <Tooltip content={`${citation.company} · ${citationLabel(citation)}`}>{chip}</Tooltip> : chip;
}

export function CitationList({
  ids,
  context,
  provenance,
  onNavy = false,
}: {
  ids: string[];
  context: Map<string, Citation>;
  provenance: EvidenceProvenance;
  onNavy?: boolean;
}) {
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-y-1">
      {ids.map((id) => (
        <CitationChip key={id} id={id} citation={context.get(id)} provenance={provenance} onNavy={onNavy} />
      ))}
    </span>
  );
}

const INLINE_CITATION = /\[([A-Z0-9][A-Z0-9.-]*-[A-Z0-9]+)\]/g;

/** Renders a brief's text with inline [CHUNK-ID] markers replaced by citation chips (provenance `brief`). */
export function CitedText({ text, context, onNavy = false }: { text: string; context: Map<string, Citation>; onNavy?: boolean }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_CITATION)) {
    const id = m[1] ?? '';
    const at = m.index ?? 0;
    // Drop the space before a chip (the chip carries its own margin) and between adjacent chips.
    const between = text.slice(last, at).replace(/\s+$/, '');
    if (between) parts.push(between);
    parts.push(<CitationChip key={`${id}-${at}`} id={id} citation={context.get(id)} provenance="brief" onNavy={onNavy} />);
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ExternalSourceLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
      SEC EDGAR <ExternalLink aria-hidden className="size-3" />
    </a>
  );
}

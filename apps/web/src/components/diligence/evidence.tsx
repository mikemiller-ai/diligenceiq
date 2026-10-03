'use client';

import type { AdjacentEvidenceResponse, AdjacentSide, Citation, FigureCheck } from '@diligenceiq/core';
import { INLINE_CITATION, citationLabel } from '@diligenceiq/core';
import { sentenceSpans } from '@diligenceiq/corpus/segments';
import { AlertTriangle, ArrowLeft, Columns2, ExternalLink, FileText, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip } from '@/components/ui/tooltip';
import { plainChipLabel } from '@/lib/citations';
import { formatDate } from '@/lib/format';
import { filingHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { type EvidenceUnavailable, isUnavailable } from '@/lib/workspace-client';
import { useWorkspace } from '@/lib/workspace-store';
import { MicroLabel } from '@/components/evidence/section';
import { PlainPassage, SentenceDiffView, SupportedPassage } from '@/components/evidence/passage';

/**
 * Where a citation comes from, so the drawer never claims more than is true (SPEC §8.6, §16):
 * - `brief`: a passage a Deep Analysis brief cites, validated against the passages supplied to the
 *   one model call (its context snapshot);
 * - `context`: a passage supplied to that call that the brief does not cite (coverage matrix);
 * - `profile`: a passage a stored Company Intelligence profile (or Compare, built from profiles) cites;
 * - `finding`: the copy of a passage saved with a finding;
 * - `adjacent`: a passage from the same section of an adjacent filing, matched offline by text
 *   similarity (Phase 6). Nothing cites it; it is shown for comparison only.
 */
export type EvidenceProvenance = 'brief' | 'context' | 'profile' | 'finding' | 'adjacent';

const PROVENANCE_LABEL: Record<EvidenceProvenance, string> = {
  brief: 'Validated — supplied to the model',
  context: 'Supplied to the model — not cited in the brief',
  profile: 'Filing text cited by the company profile',
  finding: 'Copy saved with this finding',
  adjacent: 'Same section, adjacent filing — for comparison, not cited',
};

const INVALID_COPY: Record<EvidenceProvenance, string> = {
  brief: 'was not among the passages supplied to the model, so validation removed it.',
  context: 'was not among the passages supplied to the model.',
  profile: 'is not among the passages this profile cites.',
  finding: 'is not among the passages saved with this finding.',
  adjacent: 'is not in this index.',
};

/**
 * A cited passage as opened: what it is, and where its provenance claim comes from. `claim`: the
 * statement the citation supports, so the drawer can lead with the sentences closest to it;
 * `figures`: the only figures to bold, for a brief the ones its validator verified in this passage
 * (architecture §6.9; empty bolds nothing), for a metric value its printed cell; `row`: the source row
 * a metric value was read from, the only place its figure is bolded.
 */
type Opened = { citation: Citation; provenance: EvidenceProvenance; claim?: string; figures?: string[]; row?: string };

export type EvidenceTarget =
  /** `from`: the comparison an adjacent passage was opened from, so "Back to comparison" returns there. */
  | ({ kind: 'citation'; from?: Opened } & Opened)
  | { kind: 'invalid'; chunkId: string; provenance: EvidenceProvenance }
  /**
   * A signal's evidence for each period compared, side by side (SPEC §10, §16.2). A period's own
   * `provenance` overrides the target's (the coverage matrix: cited vs supplied, not cited).
   */
  | {
      kind: 'periods';
      title: string;
      periods: Array<{ period: string; citations: Citation[]; provenance?: EvidenceProvenance }>;
      description?: string;
      eyebrow?: string;
      empty?: string;
      provenance?: EvidenceProvenance;
      /** The statement the passages support (a signal's "what changed"), passed on when one is opened. */
      claim?: string;
      /** Per passage, the figures a brief's validator verified in it (a saved finding's sources), passed on when one is opened. */
      figuresByChunk?: Record<string, string[]>;
    }
  /** A citation beside the same section of the adjacent comparable filings (SPEC §16.2; `GET /api/evidence/adjacent`). */
  | ({ kind: 'adjacent' } & Opened);

/**
 * A passage's title: the citation's section, with its subsection when the citation has one ("Item 1A —
 * Risk Factors › Supply chain"), never its chunk ID. Profile citations carry no subsection yet (DD-21
 * known limit), so theirs is the section alone.
 */
export function passageTitle(c: Pick<Citation, 'section'>): string {
  return c.section;
}

/** The figures the validator verified in this passage, from a brief item's checks; empty when none was (nothing is bolded). */
export function verifiedFigures(checks: readonly FigureCheck[] | undefined, chunkId: string): string[] {
  return (checks ?? []).filter((f) => f.verified && f.chunkId === chunkId).map((f) => f.figure);
}

/** Comparison views need room for two columns. */
const WIDE: ReadonlySet<EvidenceTarget['kind']> = new Set(['periods', 'adjacent']);

const EvidenceContext = React.createContext<((t: EvidenceTarget) => void) | null>(null);

export function EvidenceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = React.useState<{ target: EvidenceTarget; path: string | null } | null>(null);
  // The drawer has no Radix trigger (any chip can open it), so focus is returned by hand to
  // whatever opened it when it closes (keyboard users land back on the citation).
  const opener = React.useRef<HTMLElement | null>(null);
  const show = React.useCallback(
    (target: EvidenceTarget) => {
      // Moving between views inside the drawer keeps the original opener, so Esc still returns there.
      const active = document.activeElement;
      if (active instanceof HTMLElement && !active.closest('[data-evidence-drawer]')) opener.current = active;
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
          data-evidence-drawer=""
          aria-describedby="evidence-description"
          className={cn(state && WIDE.has(state.target.kind) && 'sm:max-w-[920px]')}
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
  if (target.kind === 'periods')
    return (
      <PeriodsPanel
        title={target.title}
        periods={target.periods}
        description={target.description}
        eyebrow={target.eyebrow}
        empty={target.empty}
        provenance={target.provenance ?? 'profile'}
        claim={target.claim}
        figuresByChunk={target.figuresByChunk}
      />
    );
  if (target.kind === 'adjacent') return <AdjacentPanel key={target.citation.chunkId} opened={target} />;
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
  const verified = target.provenance === 'brief';
  return <CitationPanel key={target.citation.chunkId} opened={target} verified={verified} from={target.from} />;
}

function CitationPanel({ opened, verified, from }: { opened: Opened; verified: boolean; from?: Opened }) {
  const { citation: c, provenance } = opened;
  const show = useEvidence();
  return (
    <>
      <div className="relative overflow-hidden bg-navy px-6 pb-5 pt-5 pr-12 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-sapphire/40 blur-3xl" />
        <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Evidence · {c.company}</p>
        <SheetTitle className="relative mt-1.5 text-lg font-semibold leading-snug tracking-tight text-white">{passageTitle(c)}</SheetTitle>
        <SheetDescription id="evidence-description" className="relative mt-1 font-mono text-[12px] text-white/70">
          {c.ticker} · {c.fiscalLabel} {c.filingType} · filed {formatDate(c.filingDate)}
        </SheetDescription>
        <p
          data-testid="evidence-provenance"
          className="relative mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/80"
        >
          {verified ? <ShieldCheck aria-hidden className="size-3 text-ok" /> : <FileText aria-hidden className="size-3 text-white/70" />}
          {PROVENANCE_LABEL[provenance]}
        </p>
      </div>
      {/* Index passages are long, so this region scrolls; it is focusable so keyboard users can scroll it (WCAG 2.1.1). */}
      <div tabIndex={0} role="region" aria-label="Source passage and details" className="flex-1 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <SupportedPassage
          text={c.text}
          claim={opened.claim}
          figures={opened.figures}
          row={opened.row}
          verified={provenance === 'brief'}
          passageId={`passage-${c.chunkId}`}
        />
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
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-6 py-3">
        {/* An adjacent passage is itself comparison text: it goes back to its comparison, not into another one. */}
        {provenance === 'adjacent' ? (
          from && (
            <Button variant="secondary" size="sm" onClick={() => show({ ...from, kind: 'adjacent' })}>
              <ArrowLeft />
              Back to comparison
            </Button>
          )
        ) : (
          <Button variant="secondary" size="sm" onClick={() => show({ ...opened, kind: 'adjacent' })}>
            <Columns2 />
            Compare periods
          </Button>
        )}
        <Button asChild variant="secondary" size="sm">
          <Link href={filingHref(c.documentId, c.chunkId, c.indexVersion)}>
            <FileText />
            Open filing
          </Link>
        </Button>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{citationLabel(c)}</span>
      </div>
    </>
  );
}

type SideKey = 'previous' | 'next' | 'sameQuarterPriorYear';

const UNAVAILABLE_COPY: Record<EvidenceUnavailable['unavailable'], string> = {
  not_found: 'No adjacent filing has a matching section for this passage.',
  index_version: 'This passage comes from an earlier version of the filing index, so adjacent filings cannot be matched to it.',
  index_unavailable: 'Adjacent-period comparison is unavailable right now. The passage itself is unchanged.',
};

/** `empty`: no comparable filing in the corpus at all (the side is null). */
function sideTabs(c: Citation): Array<{ key: SideKey; label: string; empty: string }> {
  const annual = c.filingType === '10-K';
  const report = annual ? 'annual report' : 'quarterly report';
  return [
    { key: 'previous', label: annual ? 'Prior year' : 'Prior quarter', empty: `No earlier ${report} from ${c.ticker} is in the corpus.` },
    { key: 'next', label: annual ? 'Following year' : 'Following quarter', empty: `No later ${report} from ${c.ticker} is in the corpus.` },
    ...(annual ? [] : [{ key: 'sameQuarterPriorYear' as const, label: 'Same quarter, prior year', empty: 'The same quarter a year earlier is not in the corpus.' }]),
  ];
}

/** The filing exists but has no passage of this section (e.g. a section that is new in a later year). */
const noMatchingSection = (f: AdjacentSide['filing']) => `The ${f.fiscalLabel} ${f.filingType} has no matching section.`;

const TAB_ID = (k: SideKey) => `adjacent-tab-${k}`;
const PANEL_ID = 'adjacent-tabpanel';

/**
 * A citation beside the same section of the adjacent comparable filings (10-K ↔ 10-K, 10-Q ↔
 * 10-Q, and a 10-Q's same quarter a year earlier). The matches come from an offline adjacency file
 * (text similarity within the section, computed at index build); no model is involved, and the
 * similarity is never shown as a score or as certainty.
 */
function AdjacentPanel({ opened }: { opened: Opened }) {
  const { citation: c, provenance } = opened;
  const { client } = useWorkspace();
  const show = useEvidence();
  const [state, setState] = React.useState<{ status: 'loading' } | { status: 'error' } | { status: 'unavailable'; reason: EvidenceUnavailable['unavailable'] } | { status: 'ready'; data: AdjacentEvidenceResponse }>({ status: 'loading' });
  const [selected, setSelected] = React.useState<SideKey | null>(null);
  const tabRefs = React.useRef(new Map<SideKey, HTMLButtonElement>());
  React.useEffect(() => {
    let live = true;
    client
      .adjacent(c.chunkId, c.indexVersion)
      .then((r) => live && setState(isUnavailable(r) ? { status: 'unavailable', reason: r.unavailable } : { status: 'ready', data: r }))
      .catch(() => live && setState({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [client, c.chunkId, c.indexVersion]);
  const tabs = sideTabs(c);
  const data = state.status === 'ready' ? state.data : null;
  const active: SideKey = selected ?? tabs.find((t) => data?.[t.key])?.key ?? 'previous';
  const tab = tabs.find((t) => t.key === active) ?? tabs[0]!;
  const side = data?.[active] ?? null;
  // WAI-ARIA tabs (APG, automatic activation): one tab stop; arrows, Home and End move and select.
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.key === active);
    const to = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const key = tabs[to]!.key;
    setSelected(key);
    tabRefs.current.get(key)?.focus();
  };
  const fromHere: Opened = { citation: c, provenance, claim: opened.claim, figures: opened.figures, row: opened.row };
  // The diff compares this passage with the side's most similar passage (the first: the adjacency
  // contract orders a side most similar first), later against earlier: "Following …" is later than
  // this passage, every other side earlier.
  const closest = side?.passages[0]?.text ?? null;
  const thisLabel = `${c.fiscalLabel} ${c.filingType}`;
  const sideLabel = side ? `${side.filing.fiscalLabel} ${side.filing.filingType}` : '';
  return (
    <>
      <div className="relative overflow-hidden bg-navy px-6 pb-5 pt-5 pr-12 text-white">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-sapphire/40 blur-3xl" />
        <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">Compare periods</p>
        <SheetTitle className="relative mt-1.5 text-xl font-semibold tracking-tight text-white">{c.company}</SheetTitle>
        <SheetDescription id="evidence-description" className="relative mt-1 text-[13px] text-white/70">
          {c.section.split(' › ')[0]} in the {c.fiscalLabel} {c.filingType}, beside the same section of the adjacent filings.
        </SheetDescription>
      </div>
      <div tabIndex={0} role="region" aria-label="Passages from adjacent periods" className="flex-1 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        {state.status === 'loading' && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" /> Finding the same section in the adjacent filings…
          </p>
        )}
        {state.status === 'error' && <p role="alert" className="text-sm text-foreground/80">The adjacent filings could not be loaded. Close the drawer and try again.</p>}
        {state.status === 'unavailable' && <p className="text-sm text-foreground/80">{UNAVAILABLE_COPY[state.reason]}</p>}
        {data && (
          <>
            <div role="tablist" aria-label="Compare with" className="flex flex-wrap gap-1.5" onKeyDown={onTabKey}>
              {tabs.map((t) => {
                const f = data[t.key]?.filing;
                return (
                  <button
                    key={t.key}
                    ref={(el) => {
                      if (el) tabRefs.current.set(t.key, el);
                      else tabRefs.current.delete(t.key);
                    }}
                    id={TAB_ID(t.key)}
                    type="button"
                    role="tab"
                    aria-selected={t.key === active}
                    aria-controls={PANEL_ID}
                    tabIndex={t.key === active ? 0 : -1}
                    onClick={() => setSelected(t.key)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-[13px] transition-colors',
                      t.key === active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground/80 hover:border-primary/50',
                    )}
                  >
                    {t.label}
                    <span className={cn('ml-1.5 font-mono text-[11px]', t.key === active ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{f ? `${f.fiscalLabel} ${f.filingType}` : 'none'}</span>
                  </button>
                );
              })}
            </div>
            <div role="tabpanel" id={PANEL_ID} aria-labelledby={TAB_ID(active)} className="mt-5">
              {/* What changed leads; the passages follow side by side. */}
              {side && closest !== null && (
                <SentenceDiffView
                  key={active}
                  later={active === 'next' ? closest : c.text}
                  earlier={active === 'next' ? c.text : closest}
                  laterLabel={active === 'next' ? sideLabel : thisLabel}
                  earlierLabel={active === 'next' ? thisLabel : sideLabel}
                />
              )}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <section aria-label="This passage">
                  <MicroLabel>
                    This passage · {c.fiscalLabel} {c.filingType}
                  </MicroLabel>
                  <PlainPassage text={c.text} className="mt-2 rounded-lg border border-primary/30 bg-accent p-4 text-[14px] leading-6" />
                  <p className="mt-1.5 text-[12px] text-muted-foreground">{passageTitle(c)}</p>
                </section>
                <AdjacentColumn
                  side={side}
                  empty={side ? noMatchingSection(side.filing) : tab.empty}
                  label={tab.label}
                  onView={(p) => show({ kind: 'citation', citation: p, provenance: 'adjacent', from: fromHere })}
                />
              </div>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Matched by text similarity within the same section when the index was built. These passages are shown for comparison; nothing cites them.
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-border px-6 py-3">
        <Button variant="secondary" size="sm" onClick={() => show({ ...opened, kind: 'citation' })}>
          <ArrowLeft />
          Back to passage
        </Button>
        <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{citationLabel(c)}</span>
      </div>
    </>
  );
}

function AdjacentColumn({ side, empty, label, onView }: { side: AdjacentSide | null; empty: string; label: string; onView: (p: Citation) => void }) {
  if (!side || side.passages.length === 0) {
    return (
      <section aria-label={label}>
        <MicroLabel>{label}</MicroLabel>
        <p className="mt-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{empty}</p>
      </section>
    );
  }
  const [first, ...rest] = side.passages;
  const f = side.filing;
  const passage = (p: Citation) => (
    <div key={p.chunkId}>
      <PlainPassage text={p.text} className="rounded-lg border border-border bg-secondary/60 p-4 text-[14px] leading-6" />
      <div className="mt-1.5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => onView(p)} className="text-[12px] text-primary hover:underline">
          {citationLabel(p)}
        </button>
        <Link href={filingHref(p.documentId, p.chunkId, p.indexVersion)} className="inline-flex items-center gap-1 text-[12px] text-primary hover:underline">
          <FileText aria-hidden className="size-3" /> Open in filing
        </Link>
      </div>
    </div>
  );
  return (
    <section aria-label={label}>
      <MicroLabel>
        {label} · {f.fiscalLabel} {f.filingType} · period ended {formatDate(f.periodEnd)}
      </MicroLabel>
      <div className="mt-2 flex flex-col gap-4">
        {first && passage(first)}
        {rest.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-[13px] text-primary hover:underline">
              {rest.length} more {rest.length === 1 ? 'passage' : 'passages'} from this section
            </summary>
            <div className="mt-3 flex flex-col gap-4">{rest.map(passage)}</div>
          </details>
        )}
      </div>
    </section>
  );
}

function PeriodsPanel({
  title,
  periods,
  description,
  eyebrow = 'Evidence by period',
  empty = 'No passage for this period.',
  provenance,
  claim,
  figuresByChunk,
}: {
  claim?: string;
  figuresByChunk?: Record<string, string[]>;
  title: string;
  periods: Array<{ period: string; citations: Citation[]; provenance?: EvidenceProvenance }>;
  description?: string;
  eyebrow?: string;
  empty?: string;
  provenance: EvidenceProvenance;
}) {
  const show = useEvidence();
  return (
    <>
      <div className="relative overflow-hidden bg-navy px-6 pb-5 pt-5 pr-12 text-white">
        <p className="relative font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-on-navy-accent">{eyebrow}</p>
        <SheetTitle className="relative mt-1.5 text-xl font-semibold tracking-tight text-white">{title}</SheetTitle>
        <SheetDescription id="evidence-description" className="relative mt-1 text-[13px] text-white/70">
          {description ?? 'The passages behind each period compared, side by side.'}
        </SheetDescription>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Passages by period"
        className={cn(
          'grid flex-1 content-start gap-6 overflow-y-auto px-6 py-5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
          periods.length === 2 && 'md:grid-cols-2',
          periods.length >= 3 && 'md:grid-cols-3',
        )}
      >
        {periods.map((p) => (
          <section key={p.period} aria-label={p.period}>
            <MicroLabel>{p.period}</MicroLabel>
            {p.citations.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
            ) : (
              p.citations.map((c) => (
                <div key={c.chunkId} data-testid="period-passage" className="mt-2">
                  <PlainPassage text={c.text} className="rounded-lg border border-border bg-secondary/60 p-4 text-[14px] leading-6" />
                  <button
                    type="button"
                    onClick={() => show({ kind: 'citation', citation: c, provenance: p.provenance ?? provenance, claim, ...(figuresByChunk ? { figures: figuresByChunk[c.chunkId] ?? [] } : {}) })}
                    className="mt-1.5 text-[12px] text-primary hover:underline"
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
  claim,
  figureChecks,
  short,
}: {
  id: string;
  citation?: Citation;
  provenance: EvidenceProvenance;
  onNavy?: boolean;
  className?: string;
  /** The statement this citation supports (the drawer leads with its best-supporting sentences). */
  claim?: string;
  /** The brief's figure checks for the statement; the drawer bolds the ones verified in this passage. */
  figureChecks?: readonly FigureCheck[];
  /** Shown in place of the label: a further passage with the same label as the chip before it ("2", "3"). */
  short?: string;
}) {
  const show = useEvidence();
  const chip = (
    <button
      type="button"
      onClick={() =>
        show(
          citation
            ? { kind: 'citation', citation, provenance, claim, ...(provenance === 'brief' ? { figures: verifiedFigures(figureChecks, citation.chunkId) } : {}) }
            : { kind: 'invalid', chunkId: id, provenance },
        )
      }
      aria-label={citation ? `View evidence ${id}` : `Unverified citation ${id}`}
      className={cn(
        'ml-1 inline-flex translate-y-[-1px] items-center whitespace-nowrap rounded-md border px-1.5 align-baseline font-mono text-[11px] font-medium leading-[18px] transition-colors',
        citation
          ? onNavy
            ? 'border-white/15 bg-white/[0.06] text-on-navy-ink hover:border-on-navy-accent hover:bg-white/10 hover:text-white'
            : 'border-primary/25 bg-primary/[0.06] text-primary hover:border-primary hover:bg-primary hover:text-white'
          : 'border-destructive/30 bg-destructive/10 text-foreground line-through decoration-destructive',
        className,
      )}
    >
      {citation ? (short ?? plainChipLabel(citation)) : id}
    </button>
  );
  // Primary screens show plain section names; the tooltip (and the drawer) keep the filing's own section title.
  return citation ? <Tooltip content={`${citation.company} · ${citationLabel(citation)}`}>{chip}</Tooltip> : chip;
}

export function CitationList({
  ids,
  context,
  provenance,
  onNavy = false,
  claim,
  figureChecks,
}: {
  ids: string[];
  context: Map<string, Citation>;
  provenance: EvidenceProvenance;
  onNavy?: boolean;
  claim?: string;
  figureChecks?: readonly FigureCheck[];
}) {
  if (ids.length === 0) return null;
  // A run of passages with the same plain label ("AAPL FY2025 · Risk factors" three times in a row)
  // shows the label once, then a numbered chip per further passage: each passage stays one click
  // away, nothing repeats. Only adjacent repeats are numbered, so a "2" always sits right after its
  // own label and the model's citation order is kept; AAPL, MSFT, AAPL shows three full labels.
  const labels = ids.map((id) => {
    const citation = context.get(id);
    return citation ? plainChipLabel(citation) : null;
  });
  const runIndex = labels.reduce<number[]>((acc, label, i) => [...acc, label !== null && label === labels[i - 1] ? acc[i - 1]! + 1 : 1], []);
  return (
    <span className="inline-flex flex-wrap gap-y-1">
      {ids.map((id, i) => {
        const citation = context.get(id);
        const n = runIndex[i]!;
        return (
          <CitationChip
            key={id}
            id={id}
            citation={citation}
            provenance={provenance}
            onNavy={onNavy}
            claim={claim}
            figureChecks={figureChecks}
            {...(n > 1 ? { short: String(n), className: 'ml-0.5' } : {})}
          />
        );
      })}
    </span>
  );
}

/**
 * The statement an inline chip supports: the sentence the chip closes, i.e. the last sentence before
 * the chip (the corpus sentence splitter, which keeps "U.S. Revenue…" whole), with any other inline
 * markers removed.
 */
export function claimBefore(text: string, at: number): string {
  const before = text.slice(0, at).replace(INLINE_CITATION, '').trimEnd();
  const sentences = sentenceSpans(before, { start: 0, end: before.length });
  return before.slice(sentences.at(-1)?.start ?? 0).trim();
}

/** Renders a brief's text with inline [CHUNK-ID] markers replaced by citation chips (provenance `brief`). */
export function CitedText({ text, context, onNavy = false, figureChecks }: { text: string; context: Map<string, Citation>; onNavy?: boolean; figureChecks?: readonly FigureCheck[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE_CITATION)) {
    const id = m[1] ?? '';
    const at = m.index ?? 0;
    // Drop the space before a chip (the chip carries its own margin) and between adjacent chips.
    const between = text.slice(last, at).replace(/\s+$/, '');
    if (between) parts.push(between);
    parts.push(<CitationChip key={`${id}-${at}`} id={id} citation={context.get(id)} provenance="brief" onNavy={onNavy} claim={claimBefore(text, at)} figureChecks={figureChecks} />);
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

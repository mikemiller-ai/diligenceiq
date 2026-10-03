'use client';

import { THEMES, citationLabel, type Citation, type Finding, type FindingSource, type FindingStatus, type ThemeId } from '@diligenceiq/core';
import { ArrowUpRight, ChevronDown, FileText, MessageSquare, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { formatDate } from '@/lib/format';
import { sourceLabel } from '@diligenceiq/core';
import { describeFailure } from '@/lib/api';
import { FINDING_ORIGIN, FINDING_STATUS } from '@/lib/labels';
import { analysisHref, compareHref, intelligenceHref, newAnalysisHref } from '@/lib/links';
import { followUpQuestion } from '@/lib/findings-summary';
import { cn } from '@/lib/utils';
import { Clamp } from '@/components/intelligence/condense';
import { companyName } from '@/fixtures';
import { useWorkspace } from '@/lib/workspace-store';
import { TickerBadge } from './badges';
import { FigureBadges } from './brief-panels';
import { useEvidence, verifiedFigures } from './evidence';

/** Where to go back to for the item a finding was saved from. */
function sourceHref(source: FindingSource): string | null {
  switch (source.kind) {
    case 'keyFinding':
    case 'consideration':
    case 'comparisonRow':
      return analysisHref(source.analysisId);
    case 'compareRow':
      return compareHref(source.tickers);
    case 'watchEvent':
      return null;
    default:
      return intelligenceHref(source.ticker);
  }
}

/** Note drafts by finding, held by the page so a draft survives its card remounting. */
const NoteDrafts = React.createContext<{ get: (id: string) => string | undefined; set: (id: string, v: string | undefined) => void } | null>(null);

export function NoteDraftsProvider({ children }: { children: React.ReactNode }) {
  const [map, setMap] = React.useState<ReadonlyMap<string, string>>(new Map());
  const value = React.useMemo(
    () => ({
      get: (id: string) => map.get(id),
      set: (id: string, v: string | undefined) =>
        setMap((m) => {
          const next = new Map(m);
          if (v === undefined) next.delete(id);
          else next.set(id, v);
          return next;
        }),
    }),
    [map],
  );
  return <NoteDrafts.Provider value={value}>{children}</NoteDrafts.Provider>;
}

/** The status chip menu's fill and dot, by status (the Badge tones, tokens only). */
const STATUS_FILL: Record<FindingStatus, { fill: string; dot: string }> = {
  ACTIVE: { fill: 'bg-accent text-primary', dot: 'bg-primary' },
  NEEDS_FOLLOW_UP: { fill: 'bg-risk-med/20 text-foreground', dot: 'bg-risk-med' },
  RESOLVED: { fill: 'bg-ok/15 text-foreground', dot: 'bg-ok' },
};

const SOURCE_BUTTON =
  'inline-flex items-center gap-1.5 rounded-md bg-card px-2 py-0.5 font-medium text-foreground/80 ring-1 ring-inset ring-border hover:text-primary hover:ring-primary';

/**
 * A saved finding as a compact card (DD-21 h). Every control stays one click away: the status
 * chip menu, the theme, the note, Ask follow-up, delete, and the sources (one opens its passage;
 * more unfold their citation chips, each opening its passage, plus "View all side by side"). `layout="board"` stacks the controls under the text for
 * a Board column.
 */
export function FindingRow({ finding, layout = 'list' }: { finding: Finding; layout?: 'list' | 'board' }) {
  const { updateFinding } = useWorkspace();
  const show = useEvidence();
  // A note being edited survives the card moving (a Board status change remounts it in another column).
  const drafts = React.useContext(NoteDrafts);
  const [localEditing, setLocalEditing] = React.useState(false);
  const [localNote, setLocalNote] = React.useState(finding.note ?? '');
  const draft = drafts?.get(finding.findingId);
  const editingNote = drafts ? draft !== undefined : localEditing;
  const note = drafts ? (draft ?? finding.note ?? '') : localNote;
  const setEditingNote = (on: boolean) => (drafts ? drafts.set(finding.findingId, on ? (finding.note ?? '') : undefined) : setLocalEditing(on));
  const setNote = (v: string) => (drafts ? drafts.set(finding.findingId, v) : setLocalNote(v));
  // IDs unique per rendered card: grouped by company, a finding about several companies appears once per company.
  const uid = React.useId();
  const statusId = `status-${uid}`;
  const themeId = `theme-${uid}`;
  const href = sourceHref(finding.origin.source);
  const board = layout === 'board';
  const n = finding.citations.length;
  const [sourcesOpen, setSourcesOpen] = React.useState(false);
  const sourcesId = `sources-${uid}`;
  /** One passage, with the figures the validator verified in it. */
  const openCitation = (c: Citation) => show({ kind: 'citation', citation: c, provenance: 'finding', claim: finding.text, figures: verifiedFigures(finding.figures, c.chunkId) });
  /** Every passage side by side, grouped by filing, in the order the finding cites them. */
  const openAll = () => {
    const groups = new Map<string, Citation[]>();
    for (const c of finding.citations) {
      const key = `${c.ticker} ${c.fiscalLabel} ${c.filingType}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    show({
      kind: 'periods',
      title: finding.title,
      eyebrow: 'Sources',
      description: `The ${n} passages this finding cites, by filing.`,
      periods: [...groups].map(([period, citations]) => ({ period, citations })),
      provenance: 'finding',
      claim: finding.text,
      ...(finding.figures ? { figuresByChunk: Object.fromEntries(finding.citations.map((c) => [c.chunkId, verifiedFigures(finding.figures, c.chunkId)])) } : {}),
    });
  };

  const fill = STATUS_FILL[finding.status];
  const controls = (
    <div className={cn('flex shrink-0 flex-wrap items-center gap-1.5', board ? 'mt-3' : 'sm:flex-col sm:items-end')}>
      <label htmlFor={statusId} className="sr-only">
        Status for {finding.title}
      </label>
      <span className="relative inline-flex">
        <span aria-hidden className={cn('pointer-events-none absolute left-2.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full', fill.dot)} />
        <NativeSelect
          id={statusId}
          value={finding.status}
          onChange={(e) => updateFinding(finding.findingId, { status: e.target.value as FindingStatus }).catch((err) => toast.error('The status was not changed', { description: describeFailure(err) }))}
          className={cn('h-7 rounded-md border-transparent pl-6 text-xs font-medium shadow-none', fill.fill)}
        >
          {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
            <option key={s} value={s}>
              {FINDING_STATUS[s].label}
            </option>
          ))}
        </NativeSelect>
      </span>
      <div className="flex items-center gap-0.5">
        <Button size="sm" variant="ghost" aria-label="Edit note" title="Edit note" onClick={() => setEditingNote(true)}>
          <MessageSquare />
          Note
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link
            href={newAnalysisHref({ question: followUpQuestion(finding, companyName), tickers: finding.tickers, origin: { kind: 'finding', findingId: finding.findingId } })}
            aria-label={`Ask follow-up about ${finding.title}`}
          >
            Ask follow-up <ArrowUpRight />
          </Link>
        </Button>
        <DeleteFindingButton finding={finding} />
      </div>
    </div>
  );

  return (
    <Card className={cn('relative overflow-hidden', board ? 'px-3.5 py-3' : 'px-5 py-4')}>
      <div className={cn('flex flex-col gap-3', !board && 'sm:flex-row sm:items-start')}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {finding.tickers.map((t) => (
              <TickerBadge key={t} ticker={t} />
            ))}
            <h3 className={cn('font-semibold text-foreground', board ? 'w-full text-sm' : 'ml-0.5 text-[15px]')}>{finding.title}</h3>
          </div>
          <Clamp
            text={finding.text}
            className="mt-1 text-sm text-foreground/80"
            // The brief's numeric-grounding marks travel with the saved item (architecture §6.9), outside the clamp so a warning is never hidden.
            after={finding.figures && finding.figures.some((f) => !f.verified) ? <FigureBadges figures={finding.figures} /> : undefined}
          >
            {finding.text}
          </Clamp>

          {(finding.note || editingNote) && (
            <div className="mt-2 rounded-md bg-secondary px-3 py-2">
              {editingNote ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateFinding(finding.findingId, { note: note.trim() })
                      .then(() => {
                        setEditingNote(false);
                        toast.success('Note saved');
                      })
                      .catch((err) => toast.error('The note was not saved', { description: describeFailure(err) }));
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor={`note-${uid}`} className="text-xs font-medium text-muted-foreground">
                    Analyst note
                  </label>
                  <Textarea
                    id={`note-${uid}`}
                    value={note}
                    maxLength={2000}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-h-16 bg-card"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      Save note
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingNote(false);
                        setLocalNote(finding.note ?? '');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-foreground/80">
                  <span className="font-medium text-muted-foreground">Your note: </span>
                  {finding.note}
                </p>
              )}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {n === 1 ? (
              <button
                type="button"
                onClick={() => openCitation(finding.citations[0]!)}
                aria-label={`1 source: open the evidence for ${finding.title}`}
                className={SOURCE_BUTTON}
              >
                <FileText aria-hidden className="size-3" />1 source
              </button>
            ) : n > 1 ? (
              <button
                type="button"
                aria-expanded={sourcesOpen}
                aria-controls={sourcesId}
                onClick={() => setSourcesOpen((o) => !o)}
                aria-label={`${n} sources: show the passages for ${finding.title}`}
                className={SOURCE_BUTTON}
              >
                <FileText aria-hidden className="size-3" />
                {n} sources
                <ChevronDown aria-hidden className={cn('size-3 transition-transform', sourcesOpen && 'rotate-180')} />
              </button>
            ) : (
              <span>No sources</span>
            )}
            <span>{FINDING_ORIGIN[finding.origin.kind]}</span>
            <span aria-hidden>·</span>
            <label htmlFor={themeId} className="sr-only">
              Theme for {finding.title}
            </label>
            <NativeSelect
              id={themeId}
              value={finding.theme}
              onChange={(e) => updateFinding(finding.findingId, { theme: e.target.value as ThemeId }).catch((err) => toast.error('The theme was not changed', { description: describeFailure(err) }))}
              className="h-6 w-auto border-transparent bg-transparent py-0 pl-1 text-xs text-muted-foreground shadow-none hover:text-foreground"
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            <span aria-hidden>·</span>
            <span>Saved {formatDate(finding.createdAt)}</span>
            <span aria-hidden>·</span>
            <span>
              From{' '}
              {href ? (
                <Link href={href} className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary">
                  {sourceLabel(finding.origin.source)}
                </Link>
              ) : (
                sourceLabel(finding.origin.source)
              )}
            </span>
            {/* Provenance (SPEC §40): saved by the demo seed, not by this analyst. */}
            {finding.seeded && <span>· Example from the demo workspace</span>}
          </div>
          {n > 1 && (
            <div id={sourcesId} hidden={!sourcesOpen} className="mt-2">
              <ul className="flex flex-wrap gap-1.5" aria-label={`Sources for ${finding.title}`}>
                {finding.citations.map((c) => (
                  <li key={c.chunkId}>
                    <button
                      type="button"
                      onClick={() => openCitation(c)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 py-0.5 text-xs text-foreground/80 hover:border-primary hover:text-primary"
                    >
                      <FileText aria-hidden className="size-3" />
                      {citationLabel(c)}
                    </button>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={openAll} className="mt-1.5 text-xs font-medium text-primary hover:underline">
                View all side by side
              </button>
            </div>
          )}
        </div>
        {controls}
      </div>
    </Card>
  );
}

function DeleteFindingButton({ finding }: { finding: Finding }) {
  const { deleteFinding } = useWorkspace();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Delete finding" title="Delete finding">
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this finding?</DialogTitle>
          <DialogDescription>
            “{finding.title}” will be removed from the Findings Board. The item it was saved from is not affected.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              onClick={() => {
                deleteFinding(finding.findingId)
                  .then(() => toast('Finding deleted'))
                  .catch((err) => toast.error('The finding was not deleted', { description: describeFailure(err) }));
              }}
            >
              Delete finding
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

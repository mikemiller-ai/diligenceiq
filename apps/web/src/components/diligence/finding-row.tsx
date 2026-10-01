'use client';

import { THEMES, citationLabel, getTheme, type Finding, type FindingSource, type FindingStatus, type ThemeId } from '@diligenceiq/core';
import { FileText, MessageSquare, Trash2 } from 'lucide-react';
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
import { sourceLabel } from '@/lib/finding-sources';
import { FINDING_ORIGIN, FINDING_STATUS } from '@/lib/labels';
import { analysisHref, compareHref, intelligenceHref } from '@/lib/links';
import { useWorkspace } from '@/lib/workspace-store';
import { FindingStatusBadge, TickerBadge } from './badges';
import { useEvidence } from './evidence';

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

export function FindingRow({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const { updateFinding } = useWorkspace();
  const show = useEvidence();
  const [editingNote, setEditingNote] = React.useState(false);
  const [note, setNote] = React.useState(finding.note ?? '');
  const statusId = `status-${finding.findingId}`;
  const themeId = `theme-${finding.findingId}`;
  const href = sourceHref(finding.origin.source);

  return (
    <Card className="relative overflow-hidden px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {finding.tickers.map((t) => (
              <TickerBadge key={t} ticker={t} />
            ))}
            <span className="text-xs text-muted-foreground">{FINDING_ORIGIN[finding.origin.kind]}</span>
          </div>
          <h3 className="mt-1.5 text-base font-semibold text-foreground">{finding.title}</h3>
          <p className="mt-1 text-sm text-foreground/80">{finding.text}</p>

          {finding.citations.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Evidence">
              {finding.citations.map((c) => (
                <li key={c.chunkId}>
                  <button
                    type="button"
                    onClick={() => show({ kind: 'citation', citation: c, provenance: 'finding' })}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary px-2 py-0.5 text-xs text-foreground/80 hover:border-primary hover:text-primary"
                  >
                    <FileText aria-hidden className="size-3" />
                    {citationLabel(c)}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!compact && (finding.note || editingNote) && (
            <div className="mt-3 rounded-md bg-secondary px-3 py-2">
              {editingNote ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    updateFinding(finding.findingId, { note: note.trim() || undefined });
                    setEditingNote(false);
                    toast.success('Note saved');
                  }}
                  className="flex flex-col gap-2"
                >
                  <label htmlFor={`note-${finding.findingId}`} className="text-xs font-medium text-muted-foreground">
                    Analyst note
                  </label>
                  <Textarea
                    id={`note-${finding.findingId}`}
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
                        setNote(finding.note ?? '');
                        setEditingNote(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <p className="text-sm text-foreground/80">
                  <span className="font-medium text-muted-foreground">Note · </span>
                  {finding.note}
                </p>
              )}
            </div>
          )}

          <p className="mt-2.5 text-xs text-muted-foreground">
            {getTheme(finding.theme).name} · Saved {formatDate(finding.createdAt)} ·{' '}
            {href ? (
              <Link href={href} className="text-primary hover:underline">
                {sourceLabel(finding.origin.source)}
              </Link>
            ) : (
              sourceLabel(finding.origin.source)
            )}
          </p>
        </div>

        {compact ? (
          <FindingStatusBadge status={finding.status} />
        ) : (
          <div className="flex shrink-0 flex-row flex-wrap items-center gap-1.5 sm:w-44 sm:flex-col sm:items-stretch">
            <label htmlFor={statusId} className="sr-only">
              Status for {finding.title}
            </label>
            <NativeSelect
              id={statusId}
              value={finding.status}
              onChange={(e) => updateFinding(finding.findingId, { status: e.target.value as FindingStatus })}
              className="h-8 text-sm"
            >
              {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
                <option key={s} value={s}>
                  {FINDING_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
            <label htmlFor={themeId} className="sr-only">
              Theme for {finding.title}
            </label>
            <NativeSelect
              id={themeId}
              value={finding.theme}
              onChange={(e) => updateFinding(finding.findingId, { theme: e.target.value as ThemeId })}
              className="h-8 text-sm"
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
            <div className="flex gap-1.5 sm:justify-end">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Edit note"
                title="Edit note"
                onClick={() => setEditingNote(true)}
              >
                <MessageSquare />
              </Button>
              <DeleteFindingButton finding={finding} />
            </div>
          </div>
        )}
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
                deleteFinding(finding.findingId);
                toast('Finding deleted');
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

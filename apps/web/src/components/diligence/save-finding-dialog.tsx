'use client';

import { THEMES, resolveSource, type FindingSource, type FindingStatus, type ThemeId } from '@diligenceiq/core';
import { BookmarkCheck, BookmarkPlus } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldHint, Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { describeFailure } from '@/lib/api';
import { FINDING_STATUS } from '@/lib/labels';
import { sourceKey, useWorkspace } from '@/lib/workspace-store';

/** The one label for saving, on every screen (Phase 9 review: "Save", "Track" and "Save Finding" were the same action). */
export const SAVE_FINDING_LABEL = 'Save finding';

/** Theme words that make a brief item a regulatory one: such a finding defaults to Regulatory & Compliance, not Risk factors. */
const REGULATORY_WORDS = /\b(regulat\w*|litigat\w*|antitrust|lawsuits?|legal proceedings?|compliance)\b/i;

/**
 * The theme a new finding starts with. The stored source suggests one (a profile item's category
 * maps to its theme); a brief item has no category, so core suggests Risk factors, and an item
 * about regulation, litigation or antitrust then starts on Regulatory & Compliance instead.
 */
export function defaultFindingTheme(resolved: { defaultTheme: ThemeId; title: string; text: string }): ThemeId {
  if (resolved.defaultTheme === 'risk-factors' && REGULATORY_WORDS.test(`${resolved.title} ${resolved.text}`)) return 'regulatory-compliance';
  return resolved.defaultTheme;
}

/**
 * Save Finding from any source (SPEC §17.1): deterministic, no model call. Only the
 * title, theme, status and note come from the form; the text and cited passages are
 * copied from the stored brief or profile.
 */
export function SaveFindingButton({ source, variant = 'secondary' }: { source: FindingSource; variant?: 'secondary' | 'ghost' }) {
  const { sourceAnalyses, profiles, savedKeys, saveFinding } = useWorkspace();
  // A preview of what will be saved; the server copies the stored content itself.
  const resolved = React.useMemo(() => resolveSource(source, { analyses: sourceAnalyses, profiles }), [source, sourceAnalyses, profiles]);
  const [saving, setSaving] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState(resolved?.title ?? '');
  const [theme, setTheme] = React.useState<ThemeId>(resolved ? defaultFindingTheme(resolved) : 'risk-factors');
  const [status, setStatus] = React.useState<FindingStatus>('ACTIVE');
  const [note, setNote] = React.useState('');
  const base = `save-${sourceKey(source).replace(/[^A-Za-z0-9]+/g, '-')}`;

  if (!resolved) return null;

  if (savedKeys.has(sourceKey(source))) {
    return (
      <Button asChild variant="ghost" size="sm" className="no-print text-foreground [&_svg]:text-ok">
        <Link href="/findings/">
          <BookmarkCheck />
          Saved
        </Link>
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Start from the stored source each time the dialog opens (it may have loaded after the first render).
        if (next && !open) {
          setTitle(resolved.title);
          setTheme(defaultFindingTheme(resolved));
          setStatus('ACTIVE');
          setNote('');
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} size="sm" className="no-print">
          <BookmarkPlus />
          {SAVE_FINDING_LABEL}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaving(true);
            saveFinding({ source, theme, title, status, note })
              .then(() => {
                setOpen(false);
                toast.success('Finding saved', { description: 'Added to the Findings Board with its evidence.' });
              })
              .catch((err) => toast.error('The finding was not saved', { description: describeFailure(err) }))
              .finally(() => setSaving(false));
          }}
        >
          <DialogHeader>
            <DialogTitle>Save finding</DialogTitle>
            <DialogDescription>
              The text and its cited passages are copied as they are. Add a title, theme, status or note for your team.
            </DialogDescription>
          </DialogHeader>
          <blockquote className="rounded-md border-l-2 border-primary bg-secondary px-3 py-2 text-sm text-foreground/80">
            {resolved.text}
          </blockquote>
          <div className="grid gap-1.5">
            <Label htmlFor={`${base}-title`}>Title</Label>
            <Input id={`${base}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${base}-theme`}>Theme</Label>
              <NativeSelect id={`${base}-theme`} value={theme} onChange={(e) => setTheme(e.target.value as ThemeId)}>
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${base}-status`}>Status</Label>
              <NativeSelect id={`${base}-status`} value={status} onChange={(e) => setStatus(e.target.value as FindingStatus)}>
                {(Object.keys(FINDING_STATUS) as FindingStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {FINDING_STATUS[s].label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${base}-note`}>Analyst note (optional)</Label>
            <Textarea id={`${base}-note`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} className="min-h-20" />
            <FieldHint>Up to 2,000 characters.</FieldHint>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? 'Saving…' : 'Save finding'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

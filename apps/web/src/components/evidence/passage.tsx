'use client';

import type { Span } from '@diligenceiq/corpus/segments';
import * as React from 'react';
import { MicroLabel } from '@/components/evidence/section';
import { ReadableText } from '@/components/evidence/readable-text';
import { type SentenceDiff, sentenceDiff } from '@/lib/readable/diff';
import { layoutBlocks } from '@/lib/readable/layout';
import { matchedFigures, pickSupport } from '@/lib/readable/support';
import { cn } from '@/lib/utils';

/*
 * Passages in the evidence drawer (DD-21 f). A passage is laid out like the source view (paragraphs,
 * lists, tables; furniture hidden), offsets unchanged. With a statement, the drawer leads with the one
 * to three sentences closest to it (lib/readable/support.ts: shared words and figures, fixed rules,
 * no model call), highlighted in place, and the full passage is one click away.
 */

/** The passage text, readable, with nothing picked (comparison columns, a passage opened without a claim). */
export function PlainPassage({ text, className }: { text: string; className?: string }) {
  const blocks = React.useMemo(() => layoutBlocks(text, 0, text.length), [text]);
  return <ReadableText text={text} blocks={blocks} headings="styled" className={className} />;
}

/**
 * The first span of `strong` inside the first occurrence of `row` in `text`: a metric value's own
 * cell, never a second cell that prints the same digits (an unchanged year). All of `strong` when `row`
 * is absent or not found.
 */
function insideRow(text: string, strong: Span[], row?: string): Span[] {
  if (!row) return strong;
  const at = text.indexOf(row);
  return at < 0 ? strong : strong.filter((s) => s.start >= at && s.end <= at + row.length).slice(0, 1);
}

export interface SupportedPassageProps {
  text: string;
  claim?: string;
  /**
   * The only figures to bold, instead of the statement's: a brief's figures the validator verified in
   * this passage (empty: bold nothing), or a metric value's printed cell.
   */
  figures?: readonly string[];
  /** `figures` are bolded only inside this source row (a metric value's row, verbatim). */
  row?: string;
  /** `figures` came from the brief's validator (the legend says so). */
  verified?: boolean;
  passageId: string;
}

export function SupportedPassage({ text, claim, figures, row, verified = false, passageId }: SupportedPassageProps) {
  const blocks = React.useMemo(() => layoutBlocks(text, 0, text.length), [text]);
  const strong = React.useMemo(() => (claim || figures ? insideRow(text, matchedFigures(claim ?? '', text, 0, figures), row) : []), [claim, figures, row, text]);
  const keys = React.useMemo(() => (claim ? pickSupport(text, blocks, claim, strong) : []), [blocks, claim, strong, text]);
  const [full, setFull] = React.useState(false);
  const condensed = keys.length > 0 && !full;
  const regionId = `${passageId}-text`;
  return (
    <div>
      {claim && (
        <div className="mb-4">
          <MicroLabel>The statement</MicroLabel>
          <p data-testid="evidence-claim" className="mt-1.5 border-l-2 border-primary/40 pl-3 text-sm leading-6 text-foreground/80">
            {claim}
          </p>
        </div>
      )}
      <MicroLabel>{keys.length ? (condensed ? 'Closest sentences to the statement' : 'Source passage, closest sentences highlighted') : 'Source passage'}</MicroLabel>
      {claim && keys.length === 0 && (
        <p data-testid="no-key-sentences" className="mt-1.5 text-xs text-muted-foreground">
          No sentence shares a figure or enough specific words with the statement to pick out, so the whole passage is shown.
        </p>
      )}
      <div id={regionId} data-testid="evidence-passage" data-view={condensed ? 'key' : 'full'} className="mt-2 rounded-lg border border-border bg-secondary/60 p-4">
        <ReadableText text={text} blocks={blocks} headings="styled" marks={keys.map((k) => ({ start: k.start, end: k.end, tone: 'key' as const }))} strong={strong} only={condensed ? keys : undefined} />
      </div>
      {(keys.length > 0 || strong.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {keys.length > 0 && (
            <button type="button" aria-expanded={full} aria-controls={regionId} onClick={() => setFull((v) => !v)} className="text-[13px] font-medium text-primary hover:underline">
              {full ? 'Show closest sentences only' : 'Show full passage'}
            </button>
          )}
          <p data-testid="evidence-legend" className="text-xs text-muted-foreground">
            {keys.length > 0 && (
              <>
                <span className="rounded-[3px] bg-key-highlight px-1 text-foreground">Highlighted</span>: the {keys.length === 1 ? 'sentence' : `${keys.length} sentences`} sharing the most
                words and figures with the statement. This is word and figure overlap, not proof.
              </>
            )}
            {strong.length > 0 && (
              <>
                {' '}
                <strong className="font-semibold text-foreground">Bold</strong>: {verified ? 'a figure the validator verified in this passage.' : 'a figure from the statement, printed exactly here.'}
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Sentence diff between this passage and the most similar passage of the adjacent filing (`later` vs
 * `earlier`; lib/readable/diff.ts). Only the stretch the two passages share is compared.
 */
export function SentenceDiffView({ later, earlier, laterLabel, earlierLabel }: { later: string; earlier: string; laterLabel: string; earlierLabel: string }) {
  const diff: SentenceDiff = React.useMemo(() => sentenceDiff(later, earlier), [later, earlier]);
  const outside = diff.outsideLater + diff.outsideEarlier;
  const shared = diff.unchanged.length > 0 || diff.added.some((u) => u.was);
  return (
    <section aria-label="What changed" data-testid="sentence-diff" className="rounded-lg border border-border bg-card p-4">
      <MicroLabel>What changed, sentence by sentence</MicroLabel>
      <p className="mt-1 text-xs text-muted-foreground">
        This passage beside the most similar passage of the same section, {laterLabel} against {earlierLabel}. Exact sentence matches, compared only between the
        first and last sentence the two passages share: the passages start and end at different places, so a sentence outside that stretch is never called new or
        removed.
      </p>
      {!shared && (
        <p data-testid="diff-no-overlap" className="mt-3 text-[13px] text-foreground/80">
          The two passages share no sentence, so nothing is compared. Read them side by side below.
        </p>
      )}
      <DiffList testId="diff-added" sign="+" tone="added" title={`New in ${laterLabel}, in the shared stretch`} units={diff.added} empty={`No sentence in the shared stretch is new in ${laterLabel}.`} />
      <DiffList testId="diff-removed" sign="−" tone="removed" title={`Removed since ${earlierLabel}, in the shared stretch`} units={diff.removed} empty="No sentence was removed in the shared stretch." />
      <details data-testid="diff-unchanged" className="mt-4">
        <summary className="cursor-pointer text-[13px] text-primary hover:underline">Unchanged ({diff.unchanged.length})</summary>
        <ul className="mt-2 flex flex-col gap-1.5">
          {diff.unchanged.map((u, i) => (
            <li key={i} className="text-[13px] leading-5 text-muted-foreground">
              {u.text}
            </li>
          ))}
        </ul>
      </details>
      {outside > 0 && (
        <p data-testid="diff-outside" className="mt-3 text-xs text-muted-foreground">
          {outside} {outside === 1 ? 'sentence lies' : 'sentences lie'} outside the shared stretch and {outside === 1 ? 'is' : 'are'} not compared.
        </p>
      )}
    </section>
  );
}

function DiffList({ testId, sign, tone, title, units, empty }: { testId: string; sign: string; tone: 'added' | 'removed'; title: string; units: SentenceDiff['added']; empty: string }) {
  return (
    <div data-testid={testId} className="mt-4">
      <h3 className="text-[13px] font-semibold text-foreground">
        {title} ({units.length})
      </h3>
      {units.length === 0 ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {units.map((u, i) => (
            <li key={i} className={cn('flex gap-2 rounded-md px-2.5 py-1.5 text-[13px] leading-5 text-foreground', tone === 'added' ? 'bg-diff-added' : 'bg-diff-removed')}>
              <span aria-hidden className="font-mono font-semibold">
                {sign}
              </span>
              <span className="min-w-0">
                <span className="sr-only">{tone === 'added' ? 'New: ' : 'Removed: '}</span>
                {u.text}
                {u.was && <span className="mt-0.5 block text-muted-foreground">Was: {u.was}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

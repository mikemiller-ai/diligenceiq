'use client';

import { ChevronDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * Progressive disclosure for the long dashboard sections (DD-21 c): show the first few items or
 * lines, and everything else one click away. Nothing is removed: folded items stay in the DOM
 * with the `hidden` attribute (so the page's figure checks and find-in-page still see them), and
 * every toggle is a real button reachable by keyboard.
 */

/** Renders every item; those after the first `initial` carry `hidden` until "Show all N". */
export function ShowMore<T>({
  items,
  initial,
  render,
  noun,
  className,
  as: List = 'ul',
}: {
  items: readonly T[];
  initial: number;
  /** Must return one element (the list item); ShowMore sets `hidden` on it while folded. */
  render: (item: T, index: number) => React.ReactElement;
  noun: [string, string];
  className?: string;
  as?: 'ul' | 'ol';
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const listRef = React.useRef<HTMLUListElement & HTMLOListElement>(null);
  const reveal = React.useRef(false);
  const folded = items.length - initial;
  React.useEffect(() => {
    // After "Show all", focus moves to the first item that was revealed.
    if (open && reveal.current) (listRef.current?.children[initial] as HTMLElement | undefined)?.focus();
    reveal.current = false;
  }, [open, initial]);
  return (
    <div className="flex flex-col gap-3">
      <List id={id} ref={listRef} className={className}>
        {items.map((item, i) => {
          const el = render(item, i) as React.ReactElement<{ hidden?: boolean; tabIndex?: number }>;
          if (folded <= 0 || i < initial) return el;
          return React.cloneElement(el, { hidden: !open, ...(i === initial ? { tabIndex: -1 } : {}) });
        })}
      </List>
      {folded > 0 && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            reveal.current = !open;
            setOpen((o) => !o);
          }}
          className="inline-flex items-center gap-1.5 self-start rounded-md px-1 text-sm font-medium text-primary hover:underline"
        >
          <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
          {open ? `Show fewer ${noun[1]}` : `Show all ${items.length} ${noun[1]}`}
        </button>
      )}
    </div>
  );
}

/** The first few words of a text, for a toggle's accessible name. */
const firstWords = (text: string, n = 6) => text.trim().split(/\s+/).slice(0, n).join(' ');

/**
 * Text clamped to `lines` lines with a More/Less toggle when it is long enough to be clamped.
 * `after` (the citation chips) renders outside the clamp, so it is never cut off. The default
 * threshold scales with the lines shown (140 characters for two, 210 for three), so a three-line
 * clamp does not offer More over text that fits.
 */
export function Clamp({
  children,
  lines = 2,
  className,
  threshold,
  text,
  after,
}: {
  children: React.ReactNode;
  lines?: 2 | 3;
  className?: string;
  threshold?: number;
  text: string;
  after?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const long = text.length > (threshold ?? (lines === 3 ? 210 : 140));
  return (
    <div className={className}>
      <p id={id} className={cn(!open && long && (lines === 2 ? 'line-clamp-2' : 'line-clamp-3'))}>
        {children}
      </p>
      {(long || after) && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {long && (
            <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="text-xs font-medium text-primary hover:underline">
              {open ? 'Less' : 'More'}
              <span className="sr-only">: {firstWords(text)}</span>
            </button>
          )}
          {after}
        </div>
      )}
    </div>
  );
}

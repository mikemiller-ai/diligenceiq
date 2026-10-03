'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * "On this page" (DD-21 d): a sticky row of links to a page's sections, under the top bar. The
 * caller passes only the sections the page actually shows, with counts on the long ones. The
 * section in view is marked (`aria-current="location"`), and a jump writes a shareable `#section`
 * URL and moves keyboard focus to the heading. Below `md` it is a single "Jump to section" menu.
 * Headings it targets carry `scroll-mt-40` so they land clear of both sticky bars. Used by the
 * Company Intelligence dashboard and the brief.
 */

export interface JumpLink {
  id: string;
  label: string;
  count?: number;
  /** What the count counts (singular, plural): read by screen readers and the phone menu, so "28" is never a bare number. */
  unit?: [string, string];
  /** Also show the unit on the chip (where two counts on one page could be confused, e.g. risk headings vs risk areas). */
  showUnit?: boolean;
}

const unitOf = (l: JumpLink) => (l.unit && l.count !== undefined ? l.unit[l.count === 1 ? 0 : 1] : '');

export function JumpBar({ links, className }: { links: JumpLink[]; className?: string }) {
  const { active, pin } = useActiveSection(links.map((l) => l.id));
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    // URL first: replacing the history entry after starting a smooth scroll can cancel the scroll.
    history.replaceState(null, '', `#${id}`);
    // Keyboard and screen-reader users continue from the section they jumped to (WCAG 2.4.3). A
    // heading is not focusable by default, so it gets tabindex=-1.
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    if (inSticky(el)) {
      // A heading in a sticky box (the brief's Sources rail on a wide screen) sits beside the page:
      // scrolling the page to it lands nowhere useful and it never reaches its landing line, so it is
      // only focused (the browser scrolls just enough to show it) and is not held as the active link.
      el.focus();
      return;
    }
    pin(id);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // preventScroll keeps the smooth scroll.
    el.focus({ preventScroll: true });
  };
  return (
    <nav aria-label="On this page" className={cn('no-print sticky top-14 z-20 border-b border-border bg-background/90 px-1 py-2.5 backdrop-blur-md', className)}>
      <div className="hidden flex-wrap items-center gap-1 md:flex">
        <span className="mr-1 hidden shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground 2xl:inline">On this page</span>
        {links.map((l) => (
          <a
            key={l.id}
            href={`#${l.id}`}
            aria-current={active === l.id ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              go(l.id);
            }}
            // No colour transition: the active link changes as the page scrolls, and a half-faded
            // state fails contrast (it made the e2e axe checks flaky).
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[12px] font-medium',
              active === l.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:border-primary hover:text-primary',
            )}
          >
            {l.label}
            {l.count !== undefined && (
              <span data-allow-figures className={cn('rounded px-1 text-[11px] tabular-nums', active === l.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-secondary text-foreground/70')}>
                {l.count}
                {unitOf(l) && (l.showUnit ? ` ${unitOf(l)}` : <span className="sr-only"> {unitOf(l)}</span>)}
              </span>
            )}
          </a>
        ))}
      </div>
      <label className="flex items-center gap-2 md:hidden">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Jump to</span>
        <select
          aria-label="Jump to section"
          // Always back on the placeholder, so picking any section (even the one in view) jumps.
          value=""
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
          className="h-9 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground"
        >
          <option value="">{active ? `In view: ${links.find((l) => l.id === active)?.label ?? ''}` : 'Choose a section'}</option>
          {links.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
              {l.count !== undefined ? ` (${l.count}${unitOf(l) ? ` ${unitOf(l)}` : ''})` : ''}
            </option>
          ))}
        </select>
      </label>
    </nav>
  );
}

/** Just below the two sticky bars and the scroll offset (`scroll-mt-40`) a jump lands headings on. */
const LINE = 200;

/** Whether an element sits inside a sticky box (on a wide screen, the brief's Sources rail): it would always read as in view. */
function inSticky(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'sticky') return true;
  return false;
}

/**
 * The section in view: of the headings at or above the line, the one lowest on the page; on equal
 * tops (sections side by side, like Evidence gaps and Follow-up questions) the earlier in the list.
 * A heading inside a sticky box is not tracked. After a jump, the section jumped to stays marked
 * until the reader scrolls away from it (wheel, touch, key or pointer input, or the page moving
 * from where the jump landed), so a jump to the right-hand one of two side-by-side sections marks it.
 */
function useActiveSection(ids: string[]): { active: string | null; pin: (id: string) => void } {
  const [active, setActive] = React.useState<string | null>(null);
  const pinned = React.useRef<{ id: string; landedTop: number | null } | null>(null);
  const refresh = React.useRef<() => void>(() => {});
  const key = ids.join(',');
  React.useEffect(() => {
    const list = key.split(',');
    let frame = 0;
    const update = () => {
      frame = 0;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const pin = pinned.current;
      const pinEl = pin ? document.getElementById(pin.id) : null;
      if (pin && pinEl) {
        const top = pinEl.getBoundingClientRect().top;
        if (pin.landedTop === null) {
          // Still on its way (a smooth scroll), or landed: at its scroll offset (its scroll-margin-top), or as far as the page goes.
          const landing = parseFloat(getComputedStyle(pinEl).scrollMarginTop) || 0;
          if (Math.abs(top - landing) <= 8 || atBottom) pin.landedTop = top;
          setActive(pin.id);
          return;
        }
        if (Math.abs(top - pin.landedTop) <= 48) {
          setActive(pin.id);
          return;
        }
      }
      pinned.current = null;
      let current: string | null = null;
      let best = -Infinity;
      const tracked: string[] = [];
      for (const id of list) {
        const el = document.getElementById(id);
        if (!el || inSticky(el)) continue;
        tracked.push(id);
        const top = el.getBoundingClientRect().top;
        // Strictly greater: on equal tops the earlier section keeps it.
        if (top <= LINE && top > best) {
          best = top;
          current = id;
        }
      }
      // At the very bottom, the last section is the one in view even if its heading never reaches the line.
      if (atBottom) current = tracked.at(-1) ?? current;
      setActive(current);
    };
    refresh.current = update;
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Reader input ends a jump's hold on the active link (a click on a jump link sets it again after this).
    const release = () => {
      pinned.current = null;
    };
    const inputs = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    for (const e of inputs) window.addEventListener(e, release, { passive: true, capture: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const e of inputs) window.removeEventListener(e, release, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key]);
  const pin = React.useCallback((id: string) => {
    pinned.current = { id, landedTop: null };
    refresh.current();
  }, []);
  return { active, pin };
}

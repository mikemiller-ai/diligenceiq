import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JumpBar } from './jump-bar';

/*
 * The jump bar's section-in-view rule and jump behaviour (DD-21 g fixes): equal heading tops (two
 * sections side by side) go to the earlier one; a jump marks the section jumped to until the reader
 * scrolls away; a heading inside a sticky box is never tracked; a jump moves focus to the heading.
 * jsdom has no layout, so heading positions are set by hand.
 */

let tops: Record<string, number> = {};
let scrollHeight = 5_000;

beforeEach(() => {
  tops = {};
  scrollHeight = 5_000;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = tops[this.id] ?? 10_000;
    return { top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const LINKS = [
  { id: 'summary', label: 'Summary' },
  { id: 'gaps', label: 'Evidence gaps' },
  { id: 'follow-ups', label: 'Follow-up questions' },
  { id: 'sources', label: 'Sources' },
];

/** `scroll-mt-40` (no CSS in jsdom): where a jump lands a heading. */
const landing = { scrollMarginTop: '160px' };

function Page({ stickySources = false }: { stickySources?: boolean }) {
  return (
    <>
      <JumpBar links={LINKS} />
      <h2 id="summary" style={landing}>
        Summary
      </h2>
      <div>
        <h2 id="gaps" style={landing}>
          Evidence gaps
        </h2>
        <h2 id="follow-ups" style={landing}>
          Follow-up questions
        </h2>
      </div>
      <aside style={stickySources ? { position: 'sticky' } : undefined}>
        <h2 id="sources" style={landing}>
          Sources
        </h2>
      </aside>
    </>
  );
}

const link = (name: string) => within(screen.getByRole('navigation', { name: 'On this page' })).getByRole('link', { name });
const activeLabel = () =>
  within(screen.getByRole('navigation', { name: 'On this page' }))
    .getAllByRole('link')
    .find((l) => l.getAttribute('aria-current') === 'location')?.textContent ?? null;

async function scrollTo(next: Record<string, number>) {
  tops = next;
  await act(async () => {
    window.dispatchEvent(new Event('scroll'));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe('JumpBar: the section in view', () => {
  it('on equal heading tops (sections side by side), the earlier section is marked, not the later', async () => {
    render(<Page />);
    await scrollTo({ summary: -600, gaps: 160, 'follow-ups': 160, sources: 900 });
    expect(activeLabel()).toBe('Evidence gaps');
  });

  it('of the headings at or above the line, the lowest on the page is marked', async () => {
    render(<Page />);
    await scrollTo({ summary: -600, gaps: 40, 'follow-ups': 120, sources: 900 });
    expect(activeLabel()).toBe('Follow-up questions');
  });

  it('a jump marks the section jumped to (even the right-hand one of a pair) until the reader scrolls away', async () => {
    render(<Page />);
    await scrollTo({ summary: -600, gaps: 600, 'follow-ups': 600, sources: 900 });
    fireEvent.pointerDown(link('Follow-up questions'));
    fireEvent.click(link('Follow-up questions'));
    expect(activeLabel()).toBe('Follow-up questions');
    // The smooth scroll lands both side-by-side headings at the scroll offset: the jumped-to one stays marked.
    await scrollTo({ summary: -1000, gaps: 160, 'follow-ups': 160, sources: 500 });
    expect(activeLabel()).toBe('Follow-up questions');
    // The reader scrolls on (wheel input): the rule applies again, and on equal tops the earlier wins.
    fireEvent.wheel(window);
    await scrollTo({ summary: -1010, gaps: 150, 'follow-ups': 150, sources: 490 });
    expect(activeLabel()).toBe('Evidence gaps');
  });

  it('the page moving away from where a jump landed also ends the hold', async () => {
    render(<Page />);
    fireEvent.click(link('Follow-up questions'));
    await scrollTo({ summary: -1000, gaps: 160, 'follow-ups': 160, sources: 500 });
    expect(activeLabel()).toBe('Follow-up questions');
    await scrollTo({ summary: 0, gaps: 900, 'follow-ups': 900, sources: 1300 });
    expect(activeLabel()).toBe('Summary');
  });

  it('a heading inside a sticky box (the Sources rail on a wide screen) is never the section in view, even at the bottom', async () => {
    render(<Page stickySources />);
    await scrollTo({ summary: -600, gaps: 400, 'follow-ups': 400, sources: 150 });
    expect(activeLabel()).toBe('Summary');
    scrollHeight = window.innerHeight;
    await scrollTo({ summary: -600, gaps: 400, 'follow-ups': 400, sources: 150 });
    expect(activeLabel()).toBe('Follow-up questions');
  });

  it('a jump to a heading in a sticky box focuses it without scrolling the page or holding it as the section in view', async () => {
    render(<Page stickySources />);
    await scrollTo({ summary: -600, gaps: 120, 'follow-ups': 400, sources: 140 });
    fireEvent.click(link('Sources'));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('sources'));
    expect(window.location.hash).toBe('#sources');
    // Not pinned: the page's own section in view stays marked, also after a programmatic scroll.
    await scrollTo({ summary: -900, gaps: -100, 'follow-ups': 100, sources: 140 });
    expect(activeLabel()).toBe('Follow-up questions');
  });

  it('below lg (not sticky), Sources is tracked like any section', async () => {
    render(<Page />);
    await scrollTo({ summary: -1600, gaps: -900, 'follow-ups': -900, sources: 150 });
    expect(activeLabel()).toBe('Sources');
  });
});

describe('JumpBar: a jump', () => {
  it('writes the #section URL, scrolls smoothly, and moves keyboard focus to the heading without a second scroll', async () => {
    render(<Page />);
    const heading = screen.getByRole('heading', { name: 'Follow-up questions' });
    const focus = vi.spyOn(heading, 'focus');
    fireEvent.click(link('Follow-up questions'));
    expect(window.location.hash).toBe('#follow-ups');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('the phone menu jumps and moves focus the same way', () => {
    render(<Page />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Jump to section' }), { target: { value: 'gaps' } });
    expect(screen.getByRole('heading', { name: 'Evidence gaps' })).toHaveFocus();
  });
});

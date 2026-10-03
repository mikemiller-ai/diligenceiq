import type { Span } from '@diligenceiq/corpus/segments';
import * as React from 'react';
import { type Block, blockUnits, type GridCell, type GridRow, NUMERIC_CELL, tableGrid, type Unit, unitRuns } from '@/lib/readable/layout';
import { cn } from '@/lib/utils';

/*
 * Renders laid-out filing text (lib/readable/layout.ts, DD-21 e): headings, paragraphs, lists and
 * tables, with page furniture and layout hidden. Every shown character is the source character at
 * the same offset, so a citation's span is highlighted exactly (`marks`), and figures can be bolded
 * (`strong`). Nothing is added to the text except, in a condensed view (`only`), a "…" marker
 * (aria-hidden) where blocks are left out.
 */

export interface Mark extends Span {
  tone: 'target' | 'key';
  /** Written to `data-span`, so a test (or a later reader) can find every piece of one mark. */
  id?: string;
}

export interface ReadableTextProps {
  text: string;
  blocks: readonly Block[];
  marks?: readonly Mark[];
  strong?: readonly Span[];
  /** Id and focus target for the first `target` mark ("Go to passage"). */
  targetId?: string;
  /** Condensed view: only blocks (and table rows) that intersect these spans. */
  only?: readonly Span[];
  /** `semantic`: real h3 headings (the source view). `styled`: bold paragraphs (inside the drawer). */
  headings?: 'semantic' | 'styled';
  className?: string;
}

const intersects = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

const MARK_CLASS: Record<Mark['tone'], string> = {
  target: 'passage-target scroll-mt-24 rounded-[3px] bg-primary/15 px-0.5 text-foreground outline-none [box-decoration-break:clone]',
  key: 'rounded-[3px] bg-key-highlight px-0.5 text-foreground [box-decoration-break:clone]',
};

export function ReadableText({ text, blocks, marks = [], strong = [], targetId, only, headings = 'semantic', className }: ReadableTextProps) {
  // The first shown target piece carries the id, so "Go to passage" and the hash land on the passage's
  // start. It is fixed by offset before rendering (not by render order), so a table that re-renders on
  // its own (it measures its overflow) or renders after the blocks around it never loses or moves it.
  const target = targetId ? marks.find((m) => m.tone === 'target') : undefined;
  const targetStart = React.useMemo(() => (target ? firstShown(blocks, target) : null), [blocks, target]);

  /** The shown characters of [a, b), split where a mark or a bold figure starts or ends. */
  const pieces = (a: number, b: number): React.ReactNode[] => {
    const cuts = new Set([a, b]);
    for (const m of [...marks, ...strong]) {
      if (m.start > a && m.start < b) cuts.add(m.start);
      if (m.end > a && m.end < b) cuts.add(m.end);
    }
    const sorted = [...cuts].sort((x, y) => x - y);
    const out: React.ReactNode[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const s = sorted[i]!;
      const e = sorted[i + 1]!;
      const seg = { start: s, end: e };
      let node: React.ReactNode = text.slice(s, e);
      if (strong.some((f) => intersects(f, seg))) node = <strong className="font-semibold text-foreground">{node}</strong>;
      const mark = marks.find((m) => intersects(m, seg));
      if (mark) {
        const first = mark === target && s === targetStart;
        node = (
          <mark
            key={s}
            id={first ? targetId : undefined}
            tabIndex={first ? -1 : undefined}
            data-mark={mark.tone}
            data-span={mark.id}
            className={MARK_CLASS[mark.tone]}
          >
            {node}
          </mark>
        );
      } else node = <React.Fragment key={s}>{node}</React.Fragment>;
      out.push(node);
    }
    return out;
  };

  const shown = (u: Unit): React.ReactNode[] => unitRuns(u).flatMap((r) => (r.hidden ? [] : pieces(r.start, r.end)));

  // A cited span that is only page furniture (a few indexed chunks are a page number or
  // "17Table of Contents") shows that furniture, so a citation is never invisible. A span with any
  // other shown text keeps its furniture hidden.
  const bare = marks.filter(
    (m) => m.tone === 'target' && !blocks.some((b) => b.kind !== 'hidden' && intersects(m, b) && blockUnits(b).some((u) => unitRuns(u).some((r) => !r.hidden && intersects(r, m)))),
  );
  const revealed = (b: Block) => b.kind === 'hidden' && b.unit.reason === 'furniture' && bare.some((m) => intersects(m, b));
  const visible = only ? blocks.filter((b) => b.kind !== 'hidden' && only.some((s) => intersects(s, b))) : blocks;
  const out: React.ReactNode[] = [];
  let last: Block | null = null;
  for (const b of visible) {
    if (b.kind === 'hidden' && !revealed(b)) continue;
    // A condensed view marks the text it leaves out.
    if (only && last && blocks.indexOf(b) !== blocks.indexOf(last) + 1 && hasShownBetween(blocks, last, b)) out.push(<Elision key={`gap-${b.start}`} />);
    last = b;
    out.push(renderBlock(b));
  }

  function renderBlock(b: Block): React.ReactNode {
    switch (b.kind) {
      case 'heading': {
        const content = shown(b.unit);
        const cls =
          b.level === 'risk'
            ? 'mt-5 text-[15px] font-semibold leading-6 text-foreground'
            : 'mt-6 text-[15px] font-semibold tracking-tight text-foreground first:mt-0';
        return headings === 'semantic' ? (
          <h3 key={b.start} data-block="heading" data-level={b.level} className={cls}>
            {content}
          </h3>
        ) : (
          <p key={b.start} data-block="heading" data-level={b.level} className={cn(cls, 'mt-3')}>
            {content}
          </p>
        );
      }
      case 'paragraph':
        return (
          <p key={b.start} data-block="paragraph" className="mt-3 first:mt-0">
            {shown(b.unit)}
          </p>
        );
      case 'list':
        return (
          <ul key={b.start} data-block="list" className="mt-3 flex list-none flex-col gap-1 pl-1 first:mt-0">
            {b.units
              .filter((u) => u.kind === 'item' && (!only || only.some((s) => intersects(s, u))))
              .map((u) => (
                <li key={u.start}>{shown(u)}</li>
              ))}
          </ul>
        );
      case 'hidden':
        return (
          <p key={b.start} data-block="furniture" className="mt-3 text-xs text-muted-foreground first:mt-0">
            {pieces(b.start, b.end)}
          </p>
        );
      case 'table':
        return <ReadableTable key={b.start} text={text} block={b} only={only} cell={(s) => pieces(s.start, s.end)} />;
    }
  }

  return <div className={cn('text-[15px] leading-7 text-foreground/90 [overflow-wrap:anywhere]', className)}>{out}</div>;
}

/** The offset where the first shown character of `m` starts (its own start when only furniture shows it). */
function firstShown(blocks: readonly Block[], m: Span): number {
  for (const b of blocks) {
    if (b.kind === 'hidden' || !intersects(m, b)) continue;
    for (const u of blockUnits(b)) for (const r of unitRuns(u)) if (!r.hidden && intersects(r, m)) return Math.max(r.start, m.start);
  }
  return m.start;
}

function hasShownBetween(blocks: readonly Block[], a: Block, b: Block): boolean {
  return blocks.slice(blocks.indexOf(a) + 1, blocks.indexOf(b)).some((x) => x.kind !== 'hidden');
}

function Elision() {
  return (
    <p aria-hidden className="mt-3 select-none text-muted-foreground">
      …
    </p>
  );
}

function ReadableTable({
  text,
  block,
  only,
  cell,
}: {
  text: string;
  block: Extract<Block, { kind: 'table' }>;
  only?: readonly Span[];
  cell: (s: Span) => React.ReactNode[];
}) {
  const grid = React.useMemo(() => tableGrid(text, block), [text, block]);
  // A condensed view keeps the header (what the columns are) and the rows it picked.
  const body = grid.body.filter((r) => !only || only.some((s) => intersects(s, r.unit)));
  const scroller = React.useRef<HTMLDivElement>(null);
  const overflows = useOverflow(scroller);
  const content = (c: GridCell | null | undefined) => c?.spans.map((s) => cell(s));
  const numeric = (c: GridCell) => NUMERIC_CELL.test(c.spans.map((s) => text.slice(s.start, s.end)).join(''));
  const byCol = (r: GridRow) => new Map(r.cells.map((c) => [c.col, c]));
  return (
    // A wide table scrolls sideways inside its own box (never the page). Only a box that actually
    // overflows takes focus, so a keyboard can scroll it (WCAG 2.1.1, axe scrollable-region-focusable)
    // without a tab stop on every table that fits.
    <div
      ref={scroller}
      tabIndex={overflows ? 0 : undefined}
      role={overflows ? 'group' : undefined}
      aria-label={overflows ? 'Table from the filing (scrolls sideways)' : undefined}
      data-overflow={overflows ? '' : undefined}
      className="mt-3 overflow-x-auto rounded-sm first:mt-0 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <table data-block="table" className="w-full border-collapse text-[13px] leading-5 [overflow-wrap:normal]">
        {grid.head.length > 0 && (
          <thead>
            {grid.head.map((r) => {
              const cells = byCol(r);
              return (
                <tr key={r.unit.start} className="border-b border-border align-bottom">
                  {r.label ? (
                    <th scope="col" className="min-w-[8rem] py-1 pr-3 text-left font-normal text-muted-foreground">
                      {content(r.label)}
                    </th>
                  ) : (
                    <td />
                  )}
                  {grid.columns.map((col) => {
                    const c = cells.get(col);
                    return c ? (
                      <th key={col} scope="col" data-col={col} className="py-1 pl-3 text-right font-semibold text-foreground">
                        {content(c)}
                      </th>
                    ) : (
                      <td key={col} data-col={col} />
                    );
                  })}
                </tr>
              );
            })}
          </thead>
        )}
        <tbody>
          {body.map((r) => {
            const cells = byCol(r);
            return (
              <tr key={r.unit.start} className="border-b border-border/70 align-top last:border-b-0">
                <th scope="row" className="min-w-[8rem] py-1 pr-3 text-left font-normal text-foreground/90">
                  {content(r.label)}
                </th>
                {grid.columns.map((col) => {
                  const c = cells.get(col);
                  return (
                    <td
                      key={col}
                      data-col={col}
                      className={cn('py-1 pl-3', c && numeric(c) ? 'whitespace-nowrap text-right tabular-nums' : 'text-left')}
                    >
                      {content(c)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Whether the element scrolls sideways (re-measured when it or its content resizes). */
function useOverflow(ref: React.RefObject<HTMLElement | null>): boolean {
  const [overflows, setOverflows] = React.useState(false);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [ref]);
  return overflows;
}

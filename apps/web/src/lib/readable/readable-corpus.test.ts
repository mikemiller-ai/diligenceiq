import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chunkFiling, loadCorpus, type ProcessedFiling, processFilings } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { readableSections, readingSections } from '@/app/(workspace)/sources/filing/filing-view';
import { FURNITURE_MAX, FURNITURE_TEXT } from './furniture';
import { type Block, blockRuns, shownText, tableGrid } from './layout';

/*
 * DD-21 e, the display layer's contract, over the real corpus (all 246 filings): the readable view
 * shows the processed text minus page furniture and layout, never anything else, and every chunk
 * (so every citation) is highlighted on exactly its own characters. Needs `edgar_corpus/`; under
 * REQUIRE_CORPUS=1 (`pnpm gate`) a missing corpus fails instead of skipping.
 */

const corpusDir = resolve(process.env.CORPUS_PATH ?? join(__dirname, '../../../../../edgar_corpus'));
const haveCorpus = existsSync(corpusDir);
if (!haveCorpus && process.env.REQUIRE_CORPUS === '1') {
  throw new Error(`readable-corpus.test: REQUIRE_CORPUS=1 but the corpus is not at ${corpusDir}; set CORPUS_PATH or restore edgar_corpus/`);
}
if (!haveCorpus) console.warn(`readable-corpus.test: corpus not found at ${corpusDir}; skipping the 246-filing display-layer proof`);

/** The api's `GET /api/sources` shape for a processed filing (services/api evidence/store.ts). */
function asSource(f: ProcessedFiling) {
  return {
    text: f.text,
    filing: { filingType: f.meta.filingType },
    sections: f.sections.map((s) => ({ code: s.code, title: s.label, charStart: s.start, charEnd: s.end })),
  } as Parameters<typeof readableSections>[0];
}

describe.skipIf(!haveCorpus)('readable filing text over the whole corpus (DD-21 e)', () => {
  const filings = haveCorpus ? processFilings(loadCorpus(corpusDir).filings) : [];

  it(
    'covers all 246 filings: shown text = processed text minus furniture and layout, and every chunk highlights exactly its own characters',
    () => {
      expect(filings).toHaveLength(246);
      let furniture = 0;
      let total = 0;
      let chunkCount = 0;
      const empty: string[] = [];
      let revealed = 0;
      for (const f of filings) {
        const source = asSource(f);
        const sections = readingSections(source.sections, f.text.length);
        const laid = readableSections(source, sections);
        const blocks = laid.flat();
        // 1. The runs partition the whole filing: every offset exactly once, in order.
        let at = 0;
        let filingFurniture = 0;
        for (const r of blockRuns(blocks)) {
          expect(r.start, `${f.meta.documentId}: run at ${r.start} after ${at}`).toBe(at);
          at = r.end;
          const s = f.text.slice(r.start, r.end);
          // 2. Only furniture and layout are hidden, and each looks like what it claims to be.
          if (r.hidden === 'layout') expect(s, `${f.meta.documentId} layout run at ${r.start}`).toMatch(/^[\s|]*$/);
          if (r.hidden === 'furniture') {
            expect(s, `${f.meta.documentId} furniture run at ${r.start}`).toMatch(FURNITURE_TEXT);
            expect(s.length, `${f.meta.documentId} furniture run at ${r.start}`).toBeLessThanOrEqual(FURNITURE_MAX);
            furniture += s.length;
            filingFurniture += s.length;
          }
        }
        expect(at).toBe(f.text.length);
        total += f.text.length;
        // No single filing loses more than a few percent to furniture (TGT, the most, about 3.6%).
        expect(filingFurniture / f.text.length, f.meta.documentId).toBeLessThan(0.05);
        // 3. Shown text is the source minus hidden runs, character for character.
        const visible = new Uint8Array(f.text.length).fill(1);
        for (const r of blockRuns(blocks)) if (r.hidden) visible.fill(0, r.start, r.end);
        const keep = (from: number, s: string) => [...s].filter((_, i) => visible[from + i]).join('');
        const all = shownText(f.text, blocks);
        expect(all).toBe(keep(0, f.text));
        // Shown characters before each offset, to slice a chunk's shown text out of `all`.
        const before = new Uint32Array(f.text.length + 1);
        for (let i = 0; i < f.text.length; i++) before[i + 1] = before[i]! + visible[i]!;
        // 4. Every chunk (so every citation) highlights exactly its own characters minus furniture and
        //    layout, and at least one, so "Go to passage" always has somewhere to land.
        for (const c of chunkFiling(f.meta, f.text, f.sections)) {
          const shown = all.slice(before[c.charStart], before[c.charEnd]);
          expect(shown, c.chunkId).toBe(keep(c.charStart, c.text));
          // A chunk that is only page furniture shows nothing until it is cited: the renderer then
          // reveals the furniture inside the cited span (readable-text.test.tsx).
          if (!shown.trim()) {
            const furnitureOnly = blockRuns(blocks).filter((r) => r.hidden === 'furniture' && r.start < c.charEnd && r.end > c.charStart);
            if (!furnitureOnly.some((r) => f.text.slice(Math.max(r.start, c.charStart), Math.min(r.end, c.charEnd)).trim())) empty.push(c.chunkId);
            else revealed++;
          }
          chunkCount++;
        }
      }
      expect(empty, 'chunks with nothing shown').toEqual([]);
      // Furniture is a sliver of the corpus; hiding more would mean hiding content.
      expect(furniture / total).toBeLessThan(0.005);
      expect(chunkCount).toBeGreaterThan(25_000);
      // Furniture-only chunks are rare (page numbers the chunker split off).
      expect(revealed).toBeLessThan(chunkCount * 0.01);
    },
    600_000,
  );

  /*
   * Independent oracles (H6): they do not reuse the layout's furniture rules, so a layout bug cannot
   * prove itself right.
   */

  it('shows no page break or running footer anywhere: an oracle over the shown text of all 246 filings (H2)', () => {
    expect(filings).toHaveLength(246);
    // A page number glued to a back-link (not the tail of a year or a decimal: "2025 TABLE OF CONTENTS"
    // on a cover is a heading), and the two footer shapes "Form 10-K | 21" and "FORM 10-K   7".
    const ORACLES: Array<[string, RegExp]> = [
      ['page back-link', /(?<!\d|\d[.,])\d{1,3}\s*Table\s+of\s+Contents?/gi],
      ['pipe footer', /Form\s*10-[KQ]\s*\|\s*\d{1,3}(?![\d.,])/g],
      ['bare footer', /FORM\s*10-[KQ]\s+\d{1,3}(?![\d.,])/g],
    ];
    const found: string[] = [];
    for (const f of filings) {
      const blocks = readableSections(asSource(f), readingSections(asSource(f).sections, f.text.length)).flat();
      const shown = shownText(f.text, blocks);
      for (const [name, re] of ORACLES) for (const m of shown.matchAll(re)) found.push(`${f.meta.documentId} ${name}: …${shown.slice(Math.max(0, m.index - 40), m.index + m[0].length + 20)}…`);
    }
    expect(found).toEqual([]);
  }, 120_000);

  it('puts every table value in the column of its raw `|` index, checked against a plain split of the source line (H1)', () => {
    let tables = 0;
    let values = 0;
    let none = 0;
    for (const f of filings) {
      const blocks = readableSections(asSource(f), readingSections(asSource(f).sections, f.text.length)).flat();
      for (const b of blocks) {
        if (b.kind !== 'table') continue;
        tables++;
        const grid = tableGrid(f.text, b as Extract<Block, { kind: 'table' }>);
        if (grid.currencyCells === 'none') none++;
        for (const r of grid.body) {
          const raw = f.text.slice(r.unit.start, r.unit.end).split('|').map((c) => c.trim());
          let last = 0;
          for (const c of r.cells) {
            // The value's own cell (a joined "$" or "%" aside) is exactly the raw cell at its index.
            const own = c.spans.find((x) => !/^[$€£]$/.test(f.text.slice(x.start, x.end))) ?? c.spans[0]!;
            expect(f.text.slice(own.start, own.end), `${f.meta.documentId} at ${own.start}`).toBe(raw[c.raw]);
            const currencyBefore = raw.slice(1, c.raw).filter((x) => /^[$€£]$/.test(x)).length;
            expect(c.col, `${f.meta.documentId} at ${own.start}`).toBe(grid.currencyCells === 'none' ? c.raw - currencyBefore : c.raw);
            expect(c.col, `${f.meta.documentId} at ${own.start}: columns in source order`).toBeGreaterThan(last);
            last = c.col;
            values++;
          }
        }
      }
    }
    expect(tables).toBeGreaterThan(15_000);
    expect(values).toBeGreaterThan(500_000);
    // Both readings occur in the corpus (AAPL-style and TSLA-style flattening).
    expect(none).toBeGreaterThan(100);
    expect(none).toBeLessThan(tables);
  }, 120_000);
});

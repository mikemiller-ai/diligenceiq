import { describe, expect, it } from 'vitest';
import { FURNITURE_TEXT, findFurniture, furnitureCounts, lineShape } from './furniture';
import { type Block, blockRuns, layoutBlocks, shownText, tableGrid } from './layout';
import { sentenceDiff } from './diff';

const slices = (text: string, spans: Array<{ start: number; end: number }>) => spans.map((s) => text.slice(s.start, s.end));

describe('page furniture (DD-21 e)', () => {
  it('hides a running footer glued between sentences, and keeps the text on both sides', () => {
    const text = 'could materially impact the Company’s results.Apple Inc. | 2025 Form 10-K | 21Tariffs and Other MeasuresBeginning in the second quarter…';
    expect(slices(text, findFurniture(text, 0, text.length))).toEqual(['Apple Inc. | 2025 Form 10-K | 21']);
  });

  it('never runs a registrant name back through a glued heading ("…SecuritiesNone.Apple Inc. | …")', () => {
    const text = 'Defaults Upon Senior SecuritiesNone.Apple Inc. | Q3 2025 Form 10-Q | 30Item 4.';
    expect(slices(text, findFurniture(text, 0, text.length))).toEqual(['Apple Inc. | Q3 2025 Form 10-Q | 30']);
  });

  it('hides page-number lines and "22Table of Contents" back-links', () => {
    const text = 'the end.\n37\nMore text.22Table of ContentsWe acquire…';
    expect(slices(text, findFurniture(text, 0, text.length))).toEqual(['37', '22Table of Contents']);
  });

  it('hides weak shapes ("PART II", "| BUSINESS | Table of Contents") only when they repeat in the filing', () => {
    const once = 'Intro.\nPART II\nItem 5\nText.';
    expect(findFurniture(once, 0, once.length, furnitureCounts(once))).toEqual([]);
    const page = 'Text.\nPART II\n| BUSINESS | Table of Contents\n';
    const filing = page.repeat(3);
    expect(slices(filing, findFurniture(filing, 0, filing.length, furnitureCounts(filing)))).toEqual(
      Array.from({ length: 3 }, () => ['PART II', '| BUSINESS | Table of Contents']).flat(),
    );
    // Without the whole filing (a drawer passage) a weak shape stays visible.
    expect(findFurniture(filing, 0, filing.length)).toEqual([]);
  });

  it('keeps table-of-contents rows, exhibit rows and prose that mention the form', () => {
    expect(lineShape('Item 16. | Form 10-K Summary | 74')).toBeNull();
    expect(lineShape('Item 1A. | Risk Factors | 5')).toBeNull();
    expect(lineShape('(1)Incorporated by reference to BlackRock’s Annual Report on Form 10-K for the year ended December 31, 2024 | 3')).toBeNull();
    expect(lineShape('See Notes to Consolidated Financial Statements5Table of Contents')).toBeNull();
    const prose = 'As discussed in Part II, Item 7 of this Form 10-K, revenue rose.';
    expect(findFurniture(prose, 0, prose.length)).toEqual([]);
  });
});

describe('page breaks inside prose are hidden whatever follows them (H2)', () => {
  const hidden = (text: string) => slices(text, findFurniture(text, 0, text.length));

  it('hides "NTable of Contents" before a lowercase word, a "$" or a figure', () => {
    expect(hidden('This could happen for a variety of 6Table of Contentsreasons.')).toEqual(['6Table of Contents']);
    expect(hidden('We expect approximately 41Table of Contents$480 million of charges.')).toEqual(['41Table of Contents']);
    expect(hidden('was $1.1 billion, respectively. 55TABLE OF CONTENTSsuccessfully')).toEqual(['55TABLE OF CONTENTS']);
    // "Table of ContentSelling": the back-link lost its "s" to the next heading (JNJ).
    expect(hidden('respectively. 55Table of ContentSelling, Marketing and Administrative')).toEqual(['55Table of Content']);
  });

  it('hides only the phrase when the page number is glued to a year ("202355Table of Contents"), keeping every digit', () => {
    expect(hidden('Commodity inflation in 202355Table of Contents Income before tax')).toEqual(['Table of Contents']);
    // A cover's "…September 27, 2025TABLE OF CONTENTS" heading (four digits) is not a page break.
    expect(hidden('For the Fiscal Year Ended September 27, 2025TABLE OF CONTENTSPagePart I')).toEqual([]);
  });

  it('hides a page break split over a line break, and the page number that ends the line before', () => {
    expect(hidden('access farm and jobsite 3\nTable of Contentsinformation through their devices')).toEqual(['3', 'Table of Contents']);
    expect(hidden('collections are reasonably assured.67\nTable of Contents\u200bThe credit quality')).toEqual(['67', 'Table of Contents']);
    // A table row's last cell is a figure, never a page number.
    expect(hidden('Total | 1,234 | 56\nTable of Contentsmore text')).toEqual(['Table of Contents']);
  });

  it('hides bare footers with or without a registrant, and never takes a prose word as the registrant', () => {
    expect(hidden('the consumer experience.2025 FORM 10-K   1 Table of ContentsSALES AND MARKETING')).toEqual(['2025 FORM 10-K   1 Table of Contents']);
    expect(hidden('approximately 31%, 15% and 15% 2025 FORM 10-K   3 Table of Contentsof total')).toEqual(['2025 FORM 10-K   3 Table of Contents']);
    expect(hidden('talent with differentiated skills MASTERCARD 2025 FORM 10-K     17PART IITEM 1. BUSINESS')).toEqual(['MASTERCARD 2025 FORM 10-K     17']);
    expect(hidden('under Subpart F of the Internal 2025 FORM 10-K       72Table of ContentsRevenue Code')).toEqual(['2025 FORM 10-K       72Table of Contents']);
  });

  it('hides a pipe footer followed by a lowercase word ("| 15iPad")', () => {
    expect(hidden('higher net sales of MacBook Air®.Apple Inc. | Q2 2022 Form 10-Q | 15iPadiPad net sales decreased')).toEqual(['Apple Inc. | Q2 2022 Form 10-Q | 15']);
  });
});

describe('table-of-contents item numbers stay visible (M1)', () => {
  it('keeps "Item 1 |" beside table-of-contents rows, even when the shape repeats', () => {
    const toc = 'PART I | 1\nItem 1 |\nBusiness | 1\nItem 1A |\nRisk Factors | 31\nItem 2 |\nProperties | 60\nItem 3 |\nLegal Proceedings | 60\n';
    expect(findFurniture(toc, 0, toc.length, furnitureCounts(toc))).toEqual([]);
    const pfe = 'PART I.  FINANCIAL INFORMATION | Page\nItem 1. |\nFinancial Statements |\nCondensed Consolidated Statements of Operations | 5\nItem 2. |\nManagement’s Discussion | 30\nItem 3. |\nMarket Risk | 50\n';
    expect(findFurniture(pfe, 0, pfe.length, furnitureCounts(pfe))).toEqual([]);
  });

  it('still hides a repeated running header in the body', () => {
    const page = 'Our products include operating systems.\nPART I\nItem 1\nNote About Forward-Looking Statements\n';
    const filing = page.repeat(3);
    expect(slices(filing, findFurniture(filing, 0, filing.length, furnitureCounts(filing)))).toEqual(Array.from({ length: 3 }, () => ['PART I', 'Item 1']).flat());
  });

  it('accepts as furniture text only a bare header, never content that starts with Item or PART', () => {
    for (const ok of ['PART II', 'Item 7', 'PART II | Item 7 |', 'Item 1A |', 'Apple Inc. | 2025 Form 10-K | 21', '17Table of Contents', '42']) expect(ok).toMatch(FURNITURE_TEXT);
    for (const no of ['Item 1A. Risk Factors', 'PART II Other Information about the business', 'Item 7 | Management’s Discussion | 25', 'Revenue grew 6%']) expect(no).not.toMatch(FURNITURE_TEXT);
  });
});

/** Each body value's display column, checked against an independent raw `|` split of its source line. */
function gridOf(text: string) {
  const block = layoutBlocks(text, 0, text.length).find((b): b is Extract<Block, { kind: 'table' }> => b.kind === 'table')!;
  const grid = tableGrid(text, block);
  const cellAt = (r: (typeof grid.body)[number], col: number) => {
    const c = r.cells.find((x) => x.col === col);
    return c ? c.spans.map((s) => text.slice(s.start, s.end)).join('') : '';
  };
  return { grid, cellAt };
}

describe('tables keep every value in its column (H1)', () => {
  it('BA: a row with empty cells keeps 345 under 2025 and 58 under 2024 (no left padding)', () => {
    const text =
      'Years ended December 31, | 2025 |  | 2024 |  | 2023\nNet earnings/(loss) | 2,238 |  |  | (11,829) |  |  | (2,242) |\nLess: Mandatory convertible preferred stock dividends accumulated during the period | 345 |  |  | 58 |  |  |  |\nNet earnings attributable to common shareholders | $1,890 |  |  | ($11,875) |  |  | ($2,222) |';
    const { grid, cellAt } = gridOf(text);
    const [net, pref, common] = grid.body;
    const cols = grid.body[0]!.cells.map((c) => c.col);
    expect(cols).toHaveLength(3);
    expect(cellAt(pref!, cols[0]!)).toBe('345');
    expect(cellAt(pref!, cols[1]!)).toBe('58');
    expect(cellAt(pref!, cols[2]!)).toBe('');
    expect([cellAt(net!, cols[0]!), cellAt(common!, cols[1]!)]).toEqual(['2,238', '($11,875)']);
    // The header row has as many labels as there are value columns: 2025 sits over 2,238 and 345.
    expect(grid.head).toHaveLength(1);
    expect(grid.head[0]!.cells.map((c) => [text.slice(c.spans[0]!.start, c.spans[0]!.end), c.col])).toEqual([
      ['2025', cols[0]],
      ['2024', cols[1]],
      ['2023', cols[2]],
    ]);
  });

  it('places each value at its raw pipe index (a "$" cell counting as a column, as in TSLA)', () => {
    const text = '|  | 2022 |  |  | 2021 |\nCash and cash equivalents |  | $ | 16,253 |  |  | $ | 17,576 |\nShort-term investments |  |  | 5,932 |  |  |  | 131 |\nOther |  |  |  |  |  |  | 7 |';
    const { grid, cellAt } = gridOf(text);
    expect(grid.currencyCells).toBe('column');
    for (const r of grid.body) {
      const raw = text.slice(r.unit.start, r.unit.end).split('|');
      for (const c of r.cells) {
        expect(c.col).toBe(c.raw);
        expect(raw[c.raw]!.trim()).toBe(text.slice(c.spans.at(-1)!.start, c.spans.at(-1)!.end));
      }
    }
    expect(cellAt(grid.body[1]!, 3)).toBe('5,932');
    expect(cellAt(grid.body[2]!, 7)).toBe('7');
    expect(cellAt(grid.body[2]!, 3)).toBe('');
  });

  it('reads a "$" cell as no column when rows without one have a cell fewer (AAPL), and joins "%" without moving a column', () => {
    const text =
      '| 2025 |  | Change |  | 2024\nAmericas | $ | 178,353 |  |  | 7 | % |  | $ | 167,045 |\nEurope | 111,032 |  |  | 10 | % |  | 101,328 |\nGreater China | 64,377 |  |  | (4) | % |  | 66,952 |';
    const { grid, cellAt } = gridOf(text);
    expect(grid.currencyCells).toBe('none');
    for (const r of grid.body) {
      const raw = text.slice(r.unit.start, r.unit.end).split('|').map((c) => c.trim());
      for (const c of r.cells) {
        // The value's raw index, less the lone "$" cells before it.
        expect(c.col).toBe(c.raw - raw.slice(1, c.raw).filter((x) => x === '$').length);
        expect(raw[c.raw]).toBe(text.slice(c.spans.find((s) => text.slice(s.start, s.end) !== '$')!.start, c.spans.find((s) => text.slice(s.start, s.end) !== '$')!.end));
      }
    }
    const [americas, europe, china] = grid.body;
    expect([1, 4, 7].map((col) => cellAt(americas!, col))).toEqual(['$178,353', '7%', '$167,045']);
    expect([1, 4, 7].map((col) => cellAt(europe!, col))).toEqual(['111,032', '10%', '101,328']);
    expect(cellAt(china!, 4)).toBe('(4)%');
    expect(grid.head[0]!.cells.map((c) => c.col)).toEqual([1, 4, 7]);
  });

  it('a table of text rows has no header row (a bullet table, a table of contents)', () => {
    expect(gridOf('| • | Public scrutiny of our decisions regarding user data could harm our reputation.\n| • | We derive substantial revenue from licenses.').grid.head).toEqual([]);
    expect(gridOf('Item 1. | Business | 1\nItem 1A. | Risk Factors | 5').grid.head).toEqual([]);
  });
});

describe('layout (DD-21 e)', () => {
  const TEXT =
    'Item 7.    Management’s Discussion and AnalysisThe following discussion should be read with Item 8.Fiscal PeriodThe Company’s fiscal year ends in September.First Quarter 2025:•MacBook Pro•Mac miniApple Inc. | 2025 Form 10-K | 21\n| 2025 |  | 2024\nProducts | $ | 307,003 |  | $ | 294,866\nServices | 109,158 |  | 96,169\nThe next paragraph.';
  const blocks = layoutBlocks(TEXT, 0, TEXT.length);

  it('partitions the range exactly: every offset in one run, in order', () => {
    let at = 0;
    for (const r of blockRuns(blocks)) {
      expect(r.start).toBe(at);
      at = r.end;
    }
    expect(at).toBe(TEXT.length);
  });

  it('restores headings, paragraphs, bullets and tables without changing a character', () => {
    const kinds = blocks.filter((b) => b.kind !== 'hidden').map((b) => [b.kind, shownText(TEXT, [b])]);
    expect(kinds).toEqual([
      ['heading', 'Item 7.    Management’s Discussion and Analysis'],
      ['paragraph', 'The following discussion should be read with Item 8.'],
      ['heading', 'Fiscal Period'],
      ['paragraph', 'The Company’s fiscal year ends in September.'],
      ['paragraph', 'First Quarter 2025:'],
      ['list', '•MacBook Pro•Mac mini'],
      ['table', '20252024Products$307,003$294,866Services109,15896,169'],
      ['paragraph', 'The next paragraph.'],
    ]);
  });

  it('hides only furniture and layout (pipes, whitespace)', () => {
    for (const r of blockRuns(blocks)) {
      const s = TEXT.slice(r.start, r.end);
      if (r.hidden === 'layout') expect(s).toMatch(/^[\s|]*$/);
      if (r.hidden === 'furniture') expect(s).toBe('Apple Inc. | 2025 Form 10-K | 21');
    }
    const shown = shownText(TEXT, blocks);
    expect(shown).not.toMatch(/\||Form 10-K|\n/);
    // Every other character survives, in order.
    expect(shown.replace(/\s/g, '')).toBe(TEXT.replace('Apple Inc. | 2025 Form 10-K | 21', '').replace(/[\s|]/g, ''));
  });

  it('shows extracted risk headings as headings', () => {
    const text = 'Risks.The Company depends on suppliers.Suppliers may fail to deliver components on time.';
    const start = text.indexOf('The Company');
    const end = start + 'The Company depends on suppliers.'.length;
    const b = layoutBlocks(text, 0, text.length, { riskHeadings: [{ start, end }] });
    expect(b.filter((x) => x.kind === 'heading').map((x) => [x.kind === 'heading' && x.level, shownText(text, [x])])).toEqual([['risk', 'The Company depends on suppliers.']]);
  });
});

describe('sentence diff (DD-21 f, H5)', () => {
  const earlier = 'We sell phones. Our revenue was $100 million in 2024. Supply is concentrated in Asia. Tariffs are a risk.';
  const later = 'We sell phones. Our revenue was $120 million in 2025. AI regulation is a new risk. Supply is concentrated in Asia.';

  it('lists new, removed and unchanged sentences inside the shared stretch, pairing a sentence whose numbers changed', () => {
    const d = sentenceDiff(later, earlier);
    expect(d.unchanged.map((u) => u.text)).toEqual(['We sell phones.', 'Supply is concentrated in Asia.']);
    expect(d.added).toEqual([{ text: 'Our revenue was $120 million in 2025.', was: 'Our revenue was $100 million in 2024.' }, { text: 'AI regulation is a new risk.' }]);
    // "Tariffs are a risk." sits after the last shared sentence of the earlier passage: outside its stretch.
    expect(d.removed).toEqual([]);
    expect([d.outsideLater, d.outsideEarlier]).toEqual([0, 1]);
  });

  it('never calls a later sentence new when it lies outside the stretch the passages share (a chunk cut at another place)', () => {
    // The later passage runs on past the earlier one's end: its tail is not "new", only uncompared.
    const d = sentenceDiff('We sell phones. Supply is concentrated in Asia. Our stores opened in Paris. Leases run ten years.', 'Our history began in 1976. We sell phones. Supply is concentrated in Asia.');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect([d.outsideLater, d.outsideEarlier]).toEqual([2, 1]);
  });

  it('reports a removal only inside the earlier stretch', () => {
    const d = sentenceDiff('We sell phones. Supply is concentrated in Asia.', earlier);
    expect(d.removed.map((u) => u.text)).toEqual(['Our revenue was $100 million in 2024.']);
    expect(d.added).toEqual([]);
    const d2 = sentenceDiff('We sell phones. Tariffs are a risk.', earlier);
    expect(d2.removed.map((u) => u.text)).toEqual(['Our revenue was $100 million in 2024.', 'Supply is concentrated in Asia.']);
  });

  it('with no sentence in common, calls nothing new or removed', () => {
    const d = sentenceDiff('Completely different text. Another sentence here.', earlier);
    expect([d.added, d.removed, d.unchanged]).toEqual([[], [], []]);
    expect([d.outsideLater, d.outsideEarlier]).toEqual([2, 4]);
  });

  it('ignores case, curly quotes and whitespace differences', () => {
    const d = sentenceDiff('The Company’s  results  improved.', "The company's results improved.");
    expect(d.unchanged).toHaveLength(1);
    expect(d.added).toEqual([]);
  });
});

describe('split page breaks keep reference numbers (code review)', () => {
  it('hides a page number ending the line before a back-link, but never "Note 12" or "Rule 12b-2"', () => {
    const page = 'the farm and jobsite 3\nTable of Contentsinformation follows.';
    expect(slices(page, findFurniture(page, 0, page.length))).toEqual(['3', 'Table of Contents']);
    for (const ref of ['as described in Note 12', 'as defined in Rule 12b-2']) {
      const text = `${ref}\nTable of Contentsinformation follows.`;
      expect(slices(text, findFurniture(text, 0, text.length))).toEqual(['Table of Contents']);
    }
  });
});

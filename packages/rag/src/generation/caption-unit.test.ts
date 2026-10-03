import { describe, expect, it } from 'vitest';
import { captionTables, extractFigures, matchFigure, passageNumbers, withPrecedingUnit } from './validate';

/**
 * The same-passage caption rule (architecture §6.9, Phase 7): a currency unit caption printed
 * without "in" as the first cell of a table header row, in the cited passage itself, applied to
 * that table only. The shapes are from PFE_10K_2025-02-27 (the "(MILLIONS)" header cell) and the
 * bare forms other filers print.
 */
const PFE = '2023 v. 2022\nThe following provides an analysis of the worldwide change in Total revenues by geographic areas from 2022 to 2023:\n(MILLIONS) |  | Worldwide |  | U.S. |  | International\nOperational growth/(decline): |  |  |  |  |  |\nWorldwide declines from Comirnaty |  | $ | (26,427) |  |  | $ | (8,512) |\nTotal revenues |  | $ | 100,330 |  |  | $ | 63,627 |\n';

const figure = (text: string) => extractFigures(text)[0]!;
const unitsOf = (text: string) => captionTables(text).map((c) => c.unit);

describe('captionTables (a bare currency caption in the first header cell)', () => {
  it.each([
    ['(MILLIONS) | | 2024', 'million'],
    ['(MILLIONS, EXCEPT PER SHARE DATA) | 2024 | 2023', 'million'],
    ['(MILLIONS, EXCEPT PER COMMON SHARE DATA) | 2024 | 2023', 'million'],
    ['(millions of dollars) | 2024 | 2023', 'million'],
    ['(millions of dollars, unless noted) | 2024 | 2023', 'million'],
    ['(Millions) | 2024 | 2023', 'million'],
    ['($ millions) | 2024 | 2023', 'million'],
    ['(Billions of dollars) | 2024 | 2023', 'billion'],
    ['  (Thousands) | 2024 | 2023', 'thousand'],
  ])('reads %s', (text, scale) => {
    expect(unitsOf(text)).toEqual([scale]);
  });

  it.each([
    ['(millions of shares) | 2024 | 2023'],
    ['(thousands of barrels daily) | 2024 | 2023'],
    ['(millions of cubic feet daily) | 2024 | 2023'],
    ['(MILLIONS EXCEPT TARGET ALLOCATION PERCENTAGE) | 2024 | 2023'],
    // Not a table header row: a caption line on its own, or a caption that is not the first cell.
    ['(Millions)\nRevenue | 5 | 4'],
    ['Region | (Millions) | 2024'],
    ['revenue of 3 millions'],
    ['no caption at all'],
  ])('never reads %s', (text) => {
    expect(captionTables(text)).toEqual([]);
  });

  it('applies only to the caption row and the contiguous table rows after it', () => {
    const text = 'Intro prose 7\n(MILLIONS) | 2024 | 2023\nRevenue | $ | 5,000 | 4,000\n\nLater prose with 6,000 units\nOther | 6,000 | 7\n';
    const [t] = captionTables(text);
    expect(text.slice(t!.from, t!.to)).toBe('(MILLIONS) | 2024 | 2023\nRevenue | $ | 5,000 | 4,000');
  });

  it('each table keeps its own caption (a second caption row starts a new table)', () => {
    expect(unitsOf('(MILLIONS) | 2024 | 2023\nA | 1 | 2\n(Thousands) | 2024 | 2023\nB | 3 | 4')).toEqual(['million', 'thousand']);
  });

  it('any other scale caption in the passage disqualifies the rule', () => {
    expect(unitsOf('(MILLIONS) | 2024 | 2023\nA | 1 | 2')).toEqual(['million']);
    expect(captionTables('(MILLIONS) | 2024 | 2023\nA | 1 | 2\n\n(MILLIONS OF SHARES) | 2024 | 2023\nB | 3 | 4')).toEqual([]);
    expect(captionTables('(MILLIONS) | 2024 | 2023\nA | 1 | 2\nShares outstanding (millions) | 15,204 |')).toEqual([]);
  });

  it('"in millions" wording states the unit of the whole passage and the caption rule is not used', () => {
    const p = passageNumbers('(Dollars in billions)\n(Thousands) | 12 |');
    expect(p.unit).toBe('billion');
    expect(p.captions).toBeUndefined();
  });
});

describe('Pfizer cells under "(MILLIONS)" (the da-v4 near matches)', () => {
  const p = passageNumbers(PFE);

  it('the caption states the unit of its own table, not of the passage', () => {
    expect(p.unit).toBeNull();
    expect(p.captions?.map((c) => c.unit)).toEqual(['million']);
  });

  it('verifies "$100,330 million" and "$63,627M" (caption_unit, not a near match)', () => {
    expect(matchFigure(figure('Total revenues were $100,330 million.'), p)).toBe('caption_unit');
    expect(matchFigure(figure('U.S. revenues were $63,627M.'), p)).toBe('caption_unit');
  });

  it('verifies a rounding to a larger scale at the figure precision ("$100.3 billion")', () => {
    expect(matchFigure(figure('Total revenues were $100.3 billion.'), p)).toBe('caption_unit');
  });

  it('refuses an unscaled "$100,330" (the unit was dropped) and a wrong scale', () => {
    expect(matchFigure(figure('Total revenues were $100,330.'), p)).toBeNull();
    expect(matchFigure(figure('Total revenues were $100,330 billion.'), p)).toBeNull();
    expect(matchFigure(figure('Total revenues were $100,330 thousand.'), p)).toBeNull();
  });

  it('without the caption the same cells stay near matches (the rule is what verifies them)', () => {
    const bare = passageNumbers(PFE.replace('(MILLIONS)', 'Region'));
    expect(bare.captions).toEqual([]);
    expect(matchFigure(figure('Total revenues were $100,330 million.'), bare)).toBe('unit_unstated');
  });
});

describe('the caption rule is scoped to its table (adversary probes, Phase 7 fixer)', () => {
  it('(a) a "(MILLIONS OF SHARES)" table in the same passage disqualifies the currency caption', () => {
    const text = '(MILLIONS) | 2024 | 2023\nRevenue | $ | 100,330 | 58,496\n\n(MILLIONS OF SHARES) | 2024 | 2023\nWeighted-average shares | 5,672 | 5,639\n';
    const p = passageNumbers(text);
    expect(p.captions).toEqual([]);
    expect([null, 'unit_unstated']).toContain(matchFigure(figure('Shares were $5,672 million.'), p));
    expect(matchFigure(figure('Revenue was $100,330 million.'), p)).not.toBe('caption_unit');
  });

  it('(b) a row-label "(millions)" never states a currency unit', () => {
    const p = passageNumbers('Shares outstanding (millions) | 15,204 | 15,550\n');
    expect(p.captions).toEqual([]);
    expect([null, 'unit_unstated']).toContain(matchFigure(figure('Shares outstanding were $15,204 million.'), p));
    const ok = passageNumbers('(MILLIONS) | 2024 | 2023\nRevenue | $ | 2,000 |\n');
    expect(matchFigure(figure('Revenue was $2,000 million.'), ok)).toBe('caption_unit');
    const mixed = passageNumbers('(MILLIONS) | 2024 | 2023\nRevenue | $ | 2,000 |\nShares outstanding (millions) | 15,204 |\n');
    expect(matchFigure(figure('Revenue was $2,000 million.'), mixed)).not.toBe('caption_unit');
  });

  it('(b) a cell outside the caption table does not take its unit', () => {
    const p = passageNumbers('(MILLIONS) | 2024 | 2023\nRevenue | $ | 100,330 | 58,496\n\nSegment | Units\nNorth | $ | 4,321 |\n');
    expect(matchFigure(figure('North was $4,321 million.'), p)).toBe('unit_unstated');
    expect(matchFigure(figure('Revenue was $100,330 million.'), p)).toBe('caption_unit');
  });

  it('(c) a later bare caption never suppresses the preceding unit of the leading table', () => {
    const text = 'Revenue | $ | 5,000 | 4,000\nCost | $ | 3,000 | 2,000\n\nThe segment table follows.\n(Millions) | 2024 | 2023\nSegment A | $ | 700 | 650\n';
    const p = withPrecedingUnit(passageNumbers(text), text, 'CONSOLIDATED STATEMENTS OF OPERATIONS\n(In thousands)');
    expect(p.preceding?.unit).toBe('thousand');
    expect(matchFigure(figure('Revenue was $5,000 million.'), p)).toBeNull();
    expect(matchFigure(figure('Revenue was $5 million.'), p)).toBe('preceding_unit');
    expect(matchFigure(figure('Segment A was $700 million.'), p)).toBe('caption_unit');
  });

  it('(c) a caption row inside the leading table under a preceding unit is dropped', () => {
    const text = 'Revenue | $ | 5,000 | 4,000\n(Millions) | 2024 | 2023\nCost | $ | 3,000 | 2,000\n';
    const p = withPrecedingUnit(passageNumbers(text), text, '(In thousands)');
    expect(p.captions).toEqual([]);
    expect(matchFigure(figure('Cost was $3,000 million.'), p)).toBeNull();
    expect(matchFigure(figure('Cost was $3 million.'), p)).toBe('preceding_unit');
  });

  it('an unscaled figure of 1,000 or more printed only in a caption table is refused (the unit was dropped)', () => {
    const p = passageNumbers('(MILLIONS) | 2024 | 2023\nRevenue | $ | 5,000 | 4,000\n\nWe paid $5,000 in fees.');
    expect(matchFigure(figure('Revenue was $4,000.'), p)).toBeNull();
    expect(matchFigure(figure('The fee was $5,000.'), p)).toBe('exact');
  });
});

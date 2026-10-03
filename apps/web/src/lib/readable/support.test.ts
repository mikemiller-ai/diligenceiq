import { describe, expect, it } from 'vitest';
import { layoutBlocks } from './layout';
import { contentWords, figuresIn, matchedFigures, pickSupport, sameFigure } from './support';

const AAPL_SEGMENTS =
  '| 2025 |  | Change |  | 2024\nAmericas | $ | 178,353 |  | 7 | % | $ | 167,045\nTotal net sales | $ | 416,161 |  | 6 | % | $ | 391,035\nAmericasAmericas net sales increased during 2025 compared to 2024 primarily due to higher net sales of iPhone and Services. The weakness in foreign currencies relative to the U.S. dollar had an unfavorable year-over-year impact on Americas net sales during 2025.EuropeEurope net sales increased during 2025 compared to 2024 primarily due to higher net sales of iPhone and Services.';

const pick = (text: string, claim: string, only?: string[]) => {
  const blocks = layoutBlocks(text, 0, text.length);
  const figs = matchedFigures(claim, text, 0, only);
  return pickSupport(text, blocks, claim, figs).map((k) => text.slice(k.start, k.end));
};

describe('content words (DD-21 f)', () => {
  it('stems endings and maps the fixed finance lexicon, so "grew revenue" meets "net sales increased"', () => {
    const claim = contentWords('Revenue grew in the Americas');
    const passage = contentWords('Americas net sales increased during 2025');
    expect([...claim].filter((w) => passage.has(w)).sort()).toEqual(['america', 'increase', 'revenue']);
  });

  it('drops stopwords and filing boilerplate words', () => {
    expect([...contentWords('The Company reported total annual results for the fiscal year')]).toEqual(['result']);
  });
});

describe('figures', () => {
  it('reads currency, percentages, scale words and grouped numbers, but not years, form names or counts', () => {
    const f = figuresIn('In FY2025 the 10-K shows $416.2 billion, 6.4%, 391,035 and 3 segments in 2025.');
    expect(f.map((x) => [x.value, x.percent, x.bare])).toEqual([
      [416.2e9, false, false],
      [6.4, true, false],
      [391035, false, true],
    ]);
  });

  it('matches exactly: same value and scale word, an exactly equal amount, or identical digits in a table cell; percent to percent only', () => {
    const one = (s: string) => figuresIn(s)[0]!;
    expect(sameFigure(one('$1.2 billion'), one('$1.2 billion'))).toBe(true);
    expect(sameFigure(one('$1.2 billion'), one('$1,200 million'))).toBe(true);
    expect(sameFigure(one('$416,161 million'), one('| 416,161 |'))).toBe(true);
    // Rounding is not a match: a statement's "$416.2 billion" is not the cell 416,161 unless the passage states its unit.
    expect(sameFigure(one('$416.2 billion'), one('| 416,161 |'))).toBe(false);
    expect(sameFigure(one('$416.2 billion'), one('| 416,161 |'), 1e6)).toBe(true);
    expect(sameFigure(one('$416.2 billion'), one('| 391,035 |'), 1e6)).toBe(false);
    const [pct] = figuresIn('6.4%');
    expect(sameFigure(pct!, one('6.4 %'))).toBe(true);
    expect(sameFigure(pct!, one('6.4 | %'))).toBe(true);
    expect(sameFigure(pct!, one('6.4 million'))).toBe(false);
  });

  it('never bolds a figure by rounding (H3): "$4 billion" ≠ "$3.5 billion" or "4.3 times", "$1 billion" ≠ "$854 million", "16%" ≠ 15.6% or 16.2%', () => {
    const bold = (claim: string, passage: string) => matchedFigures(claim, passage).map((s) => passage.slice(s.start, s.end));
    expect(bold('Buybacks reached $4 billion.', 'We repurchased $3.5 billion of stock, 4.3 times the prior year, and $4 billion is authorized.')).toEqual(['$4 billion']);
    expect(bold('Capital spending was about $1 billion.', 'Capital expenditures were $854 million.')).toEqual([]);
    expect(bold('Margin rose 16%.', 'Gross margin was 15.6% and operating margin 16.2%; services grew 16%.')).toEqual(['16%']);
    expect(bold('Margin rose 16%.', 'Gross margin | 16 | % |  | 15.6 | %')).toEqual(['16 | %']);
  });

  it('a number after a product or model name is not a figure ("Microsoft 365", "Windows 11", "iPhone 16")', () => {
    expect(figuresIn('Microsoft 365 Commercial cloud revenue, Windows 11 and iPhone 16 sales')).toEqual([]);
    expect(matchedFigures('Microsoft 365 revenue grew', 'There are 365 days; Microsoft 365 Consumer subscribers grew.')).toEqual([]);
    // A table cell after a row label is still a figure.
    expect(figuresIn('Japan | 28,703 |').map((f) => f.value)).toEqual([28703]);
  });

  it('bolds nothing for a brief passage in which the validator verified no figure (an empty list)', () => {
    expect(matchedFigures('Net sales were $416,161 million.', 'Net sales were $416,161 million.', 0, [])).toEqual([]);
  });

  it('bolds only the validator’s verified figures when they are given', () => {
    const text = 'Net sales were $416,161 million and $391,035 million.';
    const spans = matchedFigures('Sales of $416,161 million and $391,035 million', text, 0, ['$391,035 million']);
    expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['$391,035 million']);
  });
});

describe('pickSupport', () => {
  it('leads with the sentences that share the most words and figures with the claim, in passage order', () => {
    const keys = pick(AAPL_SEGMENTS, 'Revenue in the Americas grew 7% year over year, driven by iPhone.');
    expect(keys[0]).toMatch(/^Americas \| \$ \| 178,353/);
    expect(keys).toContain('Americas net sales increased during 2025 compared to 2024 primarily due to higher net sales of iPhone and Services.');
    expect(keys.length).toBeLessThanOrEqual(3);
    // Surface overlap, not meaning: a sentence about Europe that shares three of the words can come third.
    expect(keys.findIndex((k) => k.startsWith('Europe'))).not.toBe(0);
  });

  it('picks nothing when no unit shares enough with the claim (the drawer then shows the whole passage)', () => {
    expect(pick(AAPL_SEGMENTS, 'Cybersecurity incidents could disrupt operations.')).toEqual([]);
    expect(pick(AAPL_SEGMENTS, '')).toEqual([]);
  });

  it('needs a figure, or three shared words of which one is specific: two common words never qualify (H4)', () => {
    // AAPL "Operating margin held steady" once picked "Cost of sales:" on two generic words.
    const text = 'Cost of sales:\nProducts cost of sales increased.\nThe Company’s operating margin held steady at 32%.';
    expect(pick(text, 'Operating margin held steady')).toEqual(['The Company’s operating margin held steady at 32%.']);
    expect(pick('Cost of sales:\nNet sales increased.', 'Net sales and cost of sales')).toEqual([]);
    // Three shared words that are all lexicon or generic finance words are not enough.
    expect(pick('Sales grew primarily due to pricing.', 'Revenue increased primarily due to volume')).toEqual([]);
    expect(pick('Sales grew primarily due to tariffs.', 'Revenue increased primarily due to tariffs')).toEqual(['Sales grew primarily due to tariffs.']);
  });

  it('maps only unambiguous lexicon forms: "contracts", "notes" and "gains" keep their own meaning', () => {
    expect([...contentWords('customer contracts')]).toContain('contract');
    expect(contentWords('customer contracts').has('decrease')).toBe(false);
    expect(contentWords('see the notes').has('debt')).toBe(false);
    expect(contentWords('a gain on the sale').has('increase')).toBe(false);
    expect(contentWords('net cost').size).toBe(0);
  });

  it('is deterministic', () => {
    const claim = 'Total net sales rose 6% to $416.2 billion.';
    expect(pick(AAPL_SEGMENTS, claim)).toEqual(pick(AAPL_SEGMENTS, claim));
    expect(pick(AAPL_SEGMENTS, claim)[0]).toMatch(/^Total net sales/);
  });
});

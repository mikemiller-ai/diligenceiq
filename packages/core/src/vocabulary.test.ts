import { describe, expect, it } from 'vitest';
import { BANNED_PATTERNS, findBannedPhrases } from './vocabulary';

/* SPEC §32.6 / DD-16: the canonical list, tested in both directions (testing-strategy §3). */
describe('banned vocabulary', () => {
  const banned = [
    'Analysts see it as a strong buy.',
    'A strong sell at these levels.',
    'It carries a buy rating.',
    'The stock was rated a hold.',
    'We buy on weakness.',
    'Investors should avoid the sector.',
    'You should sell before the filing.',
    'We recommend buying ahead of results.',
    'It looks like a buy.',
    'The company is a sell.',
    'Overall 8/10.',
    'It earns 85 / 100 on quality.',
    'A score of 7.',
    'A rating of excellent.',
    'Analysts gave the stock a rating of 4.',
    'Seven out of 10 analysts agree.',
    'A 5 stars franchise.',
    'We give it grade A.',
    'A low-risk investment for most portfolios.',
    'A low risk company overall.',
    'A safe investment.',
    'The best investment in the sector.',
    'The shares look undervalued.',
    'The stock appears overvalued.',
    'A must-own name.',
    'A guaranteed return.',
  ];
  it.each(banned)('matches: %s', (text) => {
    expect(findBannedPhrases(text).length).toBeGreaterThan(0);
  });

  const allowed = [
    'Share buybacks increased; the share repurchase program continued.',
    'Selling, general and administrative expense rose.',
    'The company sells devices and sold a business.',
    'Customers buy through carriers and resellers.',
    'Management cites strong demand for data center products.',
    'Changes in credit ratings could raise borrowing costs; rating agencies review the debt.',
    // Regression (Phase 4b fixer, LOW): "credit rating of" is a fact about the debt, not a score.
    'The company has a credit rating of A+ from the agencies.',
    'A lower Credit  rating of the notes would raise interest costs.',
    'Programs for low-income customers.',
    'Higher costs to buy components.',
    'A strong balance sheet, the filing says.',
    'Revenue grew 10% to $416 billion.',
    'Class A office space in the portfolio.',
    'The board may hold meetings virtually.',
  ];
  it.each(allowed)('does not match: %s', (text) => {
    expect(findBannedPhrases(text)).toEqual([]);
  });

  it('covers every group of the SPEC table', () => {
    expect(new Set(BANNED_PATTERNS.map((b) => b.group))).toEqual(new Set(['recommendation', 'score', 'verdict']));
  });
});

import { describe, expect, it } from 'vitest';
import { chipLabel, plainChipLabel, plainSection } from './citations';

describe('citation chip labels (Phase 9 review item 9)', () => {
  it.each([
    ['Item 1A — Risk Factors', 'Risk factors'],
    ['Part II, Item 1A — Risk Factors', 'Risk factors'],
    ['Item 7 — Management’s Discussion and Analysis', 'Management’s discussion'],
    ['Part I, Item 2 — Management’s Discussion and Analysis', 'Management’s discussion'],
    ['Item 8 — Financial Statements', 'Financial statements'],
    ['Part I, Item 1 — Financial Statements', 'Financial statements'],
    ['Item 7A — Quantitative and Qualitative Disclosures About Market Risk', 'Market risk'],
    ['Item 1 — Business', 'Business overview'],
    ['Item 3 — Legal Proceedings', 'Legal proceedings'],
    ['Other', 'Filing text'],
  ])('“%s” reads as “%s”, with no item code', (section, plain) => {
    expect(plainSection(section)).toBe(plain);
    expect(plainChipLabel({ ticker: 'AAPL', fiscalLabel: 'FY2025', section })).toBe(`AAPL FY2025 · ${plain}`);
    expect(plainChipLabel({ ticker: 'AAPL', fiscalLabel: 'FY2025', section })).not.toMatch(/§|Item|\b1A\b|\b7\b|\b8\b/);
  });

  it('the canonical label (evidence and source views, the landing preview) keeps the SEC item code', () => {
    expect(chipLabel({ ticker: 'AAPL', fiscalLabel: 'FY2025', section: 'Item 1A — Risk Factors' })).toBe('§ AAPL FY2025 · 1A');
  });
});

import { describe, expect, it } from 'vitest';
import { companies } from '@/fixtures';
import { shortCompanyName } from './company-name';

describe('shortCompanyName (Phase 9 review item 16)', () => {
  it.each([
    ['Apple Inc', 'Apple'],
    ['NVIDIA Corporation', 'NVIDIA'],
    ['Microsoft Corporation', 'Microsoft'],
    ['The Coca-Cola Company', 'Coca-Cola'],
    ['The Home Depot Inc', 'Home Depot'],
    ['JPMorgan Chase & Co', 'JPMorgan Chase'],
    ['Merck & Co Inc', 'Merck'],
    ['Deere & Company', 'Deere'],
    ['Eli Lilly and Company', 'Eli Lilly'],
    ['International Business Machines Corp', 'International Business Machines'],
    ['Johnson & Johnson', 'Johnson & Johnson'],
    ['Morgan Stanley', 'Morgan Stanley'],
    ['General Electric Capital Corp (GE Capital)', 'General Electric Capital Corp (GE Capital)'],
  ])('%s → %s', (name, short) => expect(shortCompanyName(name)).toBe(short));

  it('gives every corpus company a distinct, non-empty short name', () => {
    const shorts = companies().map((c) => shortCompanyName(c.company));
    expect(shorts.every((s) => s.length > 1)).toBe(true);
    expect(new Set(shorts).size).toBe(shorts.length);
  });
});

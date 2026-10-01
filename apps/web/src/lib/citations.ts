import type { Citation } from '@diligenceiq/core';

/** Short chip label: "§ AAPL FY2025 · 1A". The full citation ID stays in the accessible name. */
export function chipLabel(c: Pick<Citation, 'ticker' | 'fiscalLabel' | 'section'>): string {
  const item = c.section.match(/^Item\s+([0-9A-Z]+)/i)?.[1];
  return `§ ${c.ticker} ${c.fiscalLabel}${item ? ` · ${item}` : ''}`;
}

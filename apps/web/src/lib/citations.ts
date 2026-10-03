import type { Citation } from '@diligenceiq/core';

/**
 * Canonical chip label with the SEC item code: "§ AAPL FY2025 · 1A". Used where SEC terms belong
 * (the landing's verbatim filing preview, evidence and source views). The full citation ID stays in
 * the accessible name.
 */
export function chipLabel(c: Pick<Citation, 'ticker' | 'fiscalLabel' | 'section'>): string {
  const item = c.section.match(/^Item\s+([0-9A-Z]+)/i)?.[1];
  return `§ ${c.ticker} ${c.fiscalLabel}${item ? ` · ${item}` : ''}`;
}

/** Plain names for filing sections, matched on the section's own title (10-K and 10-Q item numbers differ). */
const PLAIN_SECTIONS: ReadonlyArray<[RegExp, string]> = [
  [/risk factors/i, 'Risk factors'],
  [/quantitative and qualitative disclosures? about market risk/i, 'Market risk'],
  [/management.s discussion/i, 'Management’s discussion'],
  [/financial statements/i, 'Financial statements'],
  [/legal proceedings/i, 'Legal proceedings'],
  [/cybersecurity/i, 'Cybersecurity'],
  [/controls and procedures/i, 'Controls and procedures'],
  [/business/i, 'Business overview'],
  [/properties/i, 'Properties'],
];

/** A section's plain name ("Item 1A — Risk Factors" → "Risk factors"); never an item code. */
export function plainSection(section: string): string {
  for (const [re, name] of PLAIN_SECTIONS) if (re.test(section)) return name;
  const title = section.replace(/^(Part\s+[IV]+,\s*)?Item\s+[0-9A-Z]+\.?\s*(—|-|:)?\s*/i, '').trim();
  return !title || /^other$/i.test(title) ? 'Filing text' : title;
}

/** Chip label on primary screens: plain words, no SEC item code ("AAPL FY2025 · Risk factors"). */
export function plainChipLabel(c: Pick<Citation, 'ticker' | 'fiscalLabel' | 'section'>): string {
  return `${c.ticker} ${c.fiscalLabel} · ${plainSection(c.section)}`;
}

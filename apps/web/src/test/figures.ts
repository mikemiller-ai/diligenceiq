import type { CompanyIntelligenceProfile } from '@diligenceiq/core';

/**
 * Currency; percentages and percentage points; basis points; scaled amounts; multiples;
 * grouped thousands; decimals. Matched against whole blocks of text, so a figure React
 * renders as several text nodes (`{v}%`, `${n} billion`) is still one string here.
 */
export const FIGURE = new RegExp(
  [
    String.raw`[$€£]\s?\d`,
    String.raw`\d\s?%`,
    String.raw`\d\s?(?:percent|per cent|pct|percentage points?|points?|pts|bps|basis points?)\b`,
    String.raw`\d[\d,.]*\s?(?:thousand|million|billion|trillion|bn|mn|mm)\b`,
    String.raw`\d[\d,.]*\s?[kmb]\b`,
    String.raw`\b\d+(?:\.\d+)?\s?x\b`,
    String.raw`\b\d{1,3}(?:,\d{3})+\b`,
    String.raw`\b\d+\.\d+\b`,
  ].join('|'),
  'i',
);

/** Elements that start a new line of text: text inside one of these reads as one string. */
const BLOCK = 'p, li, td, th, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, caption, figcaption, label, legend, button, a, section, header, footer, div';

/**
 * The fixture-figure rule (architecture §7.1, testing-strategy §3): returns every figure the
 * rendered dashboard shows without a source row. Allowed: the smallest elements marked
 * `data-allow-figures` (a verbatim heading, a date, filing counts, the version footer) and
 * `data-metric-value` elements whose chunk ID and raw row match one of the profile's facts.
 * Any digit inside a `data-metric-slot` otherwise counts as an unsourced figure. Text is
 * scanned per block (its text nodes joined), not per text node.
 */
export function unsourcedFigures(root: HTMLElement, profile: CompanyIntelligenceProfile): string[] {
  const clone = root.cloneNode(true) as HTMLElement;
  const problems: string[] = [];
  for (const el of clone.querySelectorAll('[data-allow-figures]')) el.remove();
  for (const el of clone.querySelectorAll<HTMLElement>('[data-metric-value]')) {
    const { chunkId, rawRow } = el.dataset;
    const sourced = profile.facts.some((f) => f.chunkId === chunkId && f.rawRow === rawRow && Boolean(rawRow));
    if (sourced) el.remove();
    else problems.push(`metric value without a source row: ${el.textContent ?? ''}`);
  }
  for (const el of clone.querySelectorAll('[data-metric-slot]')) {
    if (/\d/.test(el.textContent ?? '')) problems.push(`number in a metric slot: ${el.textContent ?? ''}`);
  }
  // Group consecutive text nodes by their nearest block ancestor, then test each group.
  const blocks = new Map<Element, string>();
  const walker = clone.ownerDocument.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement?.closest(BLOCK) ?? clone;
    blocks.set(block, (blocks.get(block) ?? '') + (n.textContent ?? ''));
  }
  for (const text of blocks.values()) {
    if (FIGURE.test(text)) problems.push(`figure in text: ${text.trim()}`);
  }
  return problems;
}

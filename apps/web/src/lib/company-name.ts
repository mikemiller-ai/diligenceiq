/**
 * A company's short name for running text ("Apple", "NVIDIA", "Coca-Cola"): the corpus name without
 * its legal suffix (Inc, Corporation, Corp, Company, & Co, "and Company") or a leading "The". A name
 * with a parenthesis ("General Electric Capital Corp (GE Capital)") is kept whole.
 */
export function shortCompanyName(name: string): string {
  if (name.includes('(')) return name;
  let s = name.trim();
  for (;;) {
    const next = s.replace(/^The\s+/, '').replace(/,?\s+(Inc|Corporation|Corp|Company|Co)\.?$/, '').replace(/\s+(&|and)$/, '');
    if (next === s || next.length === 0) return s;
    s = next;
  }
}

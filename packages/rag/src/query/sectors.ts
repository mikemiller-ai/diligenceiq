import { SECTORS, type Sector } from '@diligenceiq/corpus';
import type { Catalog } from './catalog';

/**
 * Static, documented sector phrases (SPEC §26.2; assumptions C2). Each phrase maps to a fixed
 * list of corpus members (an industry group) or to a whole GICS-style sector from the company
 * catalog (`packages/corpus` catalog.ts). Shown in the Interpretation panel; never a model call.
 *
 * "Major pharmaceutical companies" → JNJ, PFE, MRK, LLY, ABBV. TMO (life-science tools) and
 * UNH (managed care) are Health Care but not pharma (C2).
 */
export interface SectorRule {
  id: string;
  label: string;
  pattern: RegExp;
  /** Explicit members, or a whole catalog sector. */
  members: readonly string[] | { sector: Sector };
}

/** Group nouns that make a phrase a sector reference ("pharmaceutical companies", not "Pfizer's pharmaceutical business"). */
const G = '(?:companies|firms|makers|sector|industry|stocks|names|majors|players|groups)';
const rx = (src: string) => new RegExp(src.replaceAll('{G}', G), 'i');

/**
 * "Banks" only as a group: after a determiner or group adjective ("the banks", "big banks",
 * "other banks", "which banks", "do banks"), before "such as / like / including", or as the
 * first word of a sentence ("Banks face …"). A place cash sits ("cash held at banks") is not a
 * sector reference.
 */
const BANKS_GROUP = String.raw`(?:\b(?:the|big|large|largest|major|regional|investment|commercial|global|leading|money[- ]center|other|which|what|do|are|all|most|many|these|those|U\.?S\.?) banks\b|\bbanks (?:such as|like|including)\b|(?:^|[.?!]\s+)banks\b)`;

/**
 * Phrases need a plural or a group noun, so a company's own business line ("NVIDIA's
 * semiconductor business", "Apple's financial risks") never pulls in a whole sector.
 */
export const SECTOR_RULES: readonly SectorRule[] = [
  { id: 'pharma', label: 'Pharmaceutical companies', pattern: rx(String.raw`\b(?:bio)?pharma(?:ceutical)? {G}\b|\bbig pharma\b|\bpharmas\b|\bdrug ?makers\b|\bdrug companies\b`), members: ['JNJ', 'PFE', 'MRK', 'LLY', 'ABBV'] },
  { id: 'health_insurers', label: 'Health insurers', pattern: rx(String.raw`\bhealth insurers\b|\bmanaged care {G}\b`), members: ['UNH'] },
  { id: 'health_care', label: 'Health Care sector', pattern: rx(String.raw`\bhealth ?care {G}\b`), members: { sector: 'Health Care' } },
  { id: 'banks', label: 'Banks', pattern: rx(String.raw`${BANKS_GROUP}|\bbanking {G}\b`), members: ['JPM', 'BAC', 'GS', 'MS'] },
  { id: 'payments', label: 'Payment networks', pattern: rx(String.raw`\b(?:payment|card) (?:networks|processors|{G})\b|\bpayments {G}\b`), members: ['V', 'MA', 'AXP'] },
  { id: 'financials', label: 'Financials sector', pattern: rx(String.raw`\bfinancials (?:sector|companies|stocks)\b|\bthe financials\b|\bfinancial (?:services (?:{G}|firms)|sector|institutions|companies)\b`), members: { sector: 'Financials' } },
  { id: 'big_tech', label: 'Big tech', pattern: rx(String.raw`\b(?:big|mega[- ]?cap|large[- ]cap) tech\b|\bhyperscalers\b`), members: ['AAPL', 'MSFT', 'GOOG', 'AMZN', 'META', 'NVDA'] },
  { id: 'semiconductors', label: 'Semiconductor companies', pattern: rx(String.raw`\bsemiconductor {G}\b|\bchip ?makers\b|\bchip companies\b`), members: ['NVDA', 'AMD', 'INTC'] },
  { id: 'tech', label: 'Information Technology sector', pattern: rx(String.raw`\b(?:tech|technology|software) {G}\b`), members: { sector: 'Information Technology' } },
  { id: 'energy', label: 'Oil and gas companies', pattern: rx(String.raw`\boil {G}\b|\boil and gas {G}\b|\benergy {G}\b`), members: ['XOM', 'CVX'] },
  { id: 'retail', label: 'Retailers', pattern: rx(String.raw`\bretailers\b|\bretail (?:chains|{G})\b`), members: ['WMT', 'TGT', 'COST', 'HD'] },
  { id: 'beverages', label: 'Beverage companies', pattern: rx(String.raw`\bbeverage {G}\b|\bsoft[- ]drink {G}\b`), members: ['KO', 'PEP'] },
  { id: 'consumer_staples', label: 'Consumer Staples sector', pattern: rx(String.raw`\bconsumer staples\b`), members: { sector: 'Consumer Staples' } },
  { id: 'consumer_discretionary', label: 'Consumer Discretionary sector', pattern: rx(String.raw`\bconsumer discretionary\b`), members: { sector: 'Consumer Discretionary' } },
  { id: 'telecom', label: 'Telecom carriers', pattern: rx(String.raw`\btelecoms\b|\btelecom(?:munications)? (?:carriers|{G})\b|\bwireless carriers\b`), members: ['T', 'VZ'] },
  { id: 'media', label: 'Media and streaming companies', pattern: rx(String.raw`\b(?:media|streaming|entertainment) {G}\b|\bstreamers\b`), members: ['NFLX', 'DIS', 'CMCSA'] },
  { id: 'communication_services', label: 'Communication Services sector', pattern: rx(String.raw`\bcommunication services\b`), members: { sector: 'Communication Services' } },
  { id: 'aerospace_defense', label: 'Aerospace and defense companies', pattern: rx(String.raw`\baerospace (?:and defen[cs]e )?{G}\b|\bdefen[cs]e (?:contractors|primes|{G})\b`), members: ['BA', 'LMT', 'RTX'] },
  { id: 'industrials', label: 'Industrials sector', pattern: rx(String.raw`\bindustrials\b|\bindustrial {G}\b`), members: { sector: 'Industrials' } },
  { id: 'restaurants', label: 'Restaurant chains', pattern: rx(String.raw`\brestaurant (?:chains|{G})\b|\bfast[- ]food (?:chains|{G})\b`), members: ['MCD', 'SBUX'] },
  { id: 'automakers', label: 'Automakers', pattern: rx(String.raw`\bauto ?makers\b|\bcar ?makers\b|\bEV makers\b`), members: ['TSLA'] },
];

export interface SectorMatch {
  id: string;
  label: string;
  phrase: string;
  tickers: string[];
}

/**
 * Rules are tried in order and a phrase region is claimed by the first rule that matches it, so
 * a more specific rule earlier in the list suppresses a broader one on the same words ("big
 * tech companies" is big tech, not also the whole IT sector).
 */
export function matchSectors(question: string, catalog: Catalog): SectorMatch[] {
  const out: SectorMatch[] = [];
  const claimed: Array<[number, number]> = [];
  for (const rule of SECTOR_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`);
    const m = [...question.matchAll(re)].find((x) => !claimed.some(([s, e]) => x.index < e && s < x.index + x[0].length));
    if (!m) continue;
    claimed.push([m.index, m.index + m[0].length]);
    const tickers = Array.isArray(rule.members)
      ? (rule.members as readonly string[]).filter((t) => catalog.byTicker.has(t))
      : catalog.companies.filter((c) => c.sector === (rule.members as { sector: Sector }).sector).map((c) => c.ticker);
    if (tickers.length) out.push({ id: rule.id, label: rule.label, phrase: m[0], tickers });
  }
  return out;
}

export const KNOWN_SECTORS: readonly Sector[] = SECTORS;

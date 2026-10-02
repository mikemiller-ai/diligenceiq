/*
 * The canonical banned vocabulary (SPEC §32.6, DD-16). One list, used by the profile validator
 * and the evaluation harness. It applies only to MODEL-WRITTEN text (headline, what changed,
 * why this matters, executive view, outlook, recommended diligence). Deterministic labels and
 * quoted filing passages are exempt.
 *
 * Matching is case-insensitive and phrase-level with word boundaries. Bare "buy", "sell" and
 * "strong" are not banned; only the phrases are. The allowed terms in the DD-16 table
 * ("buyback", "share repurchase", "selling, general and administrative", "sells", "sold",
 * "customers buy", "strong demand", "credit rating(s)", "rating agencies", "low-income") are
 * never matched by these patterns; vocabulary.test.ts checks both directions.
 */

export type BannedGroup = 'recommendation' | 'score' | 'verdict';

export interface BannedPattern {
  group: BannedGroup;
  /** The DD-16 rule as written. */
  rule: string;
  pattern: RegExp;
}

const p = (group: BannedGroup, rule: string, source: string): BannedPattern => ({ group, rule, pattern: new RegExp(source, 'i') });

export const BANNED_PATTERNS: readonly BannedPattern[] = [
  // Recommendations.
  p('recommendation', 'strong buy', String.raw`\bstrong[- ]buy\b`),
  p('recommendation', 'strong sell', String.raw`\bstrong[- ]sell\b`),
  p('recommendation', 'buy / sell / hold rating', String.raw`\b(?:buy|sell|hold)[- ]rating\b`),
  p('recommendation', 'rated (a) buy / sell / hold', String.raw`\brated\s+(?:an?\s+)?(?:buy|sell|hold)\b`),
  p('recommendation', '(we | investors should | you should) buy, sell, hold, avoid', String.raw`\b(?:we|investors\s+should|you\s+should)\s+(?:buy|sell|hold|avoid)\b`),
  p('recommendation', 'recommend buying / selling / holding / investing', String.raw`\brecommend(?:s|ed)?\s+(?:buying|selling|holding|investing)\b`),
  p('recommendation', '(is | looks like) a buy / sell', String.raw`\b(?:is|looks\s+like)\s+a\s+(?:buy|sell)\b`),
  // Scores and ratings.
  p('score', 'N/10, N/100', String.raw`\b\d+(?:\.\d+)?\s*/\s*(?:10|100)\b`),
  p('score', 'score of', String.raw`\bscore\s+of\b`),
  p('score', 'rating of', String.raw`(?<!\bcredit\s+)\brating\s+of\b`),
  p('score', 'out of 10 / 100', String.raw`\bout\s+of\s+(?:10|100)\b`),
  p('score', 'N stars', String.raw`\b\d+(?:\.\d+)?\s+stars?\b`),
  p('score', 'grade A–F', String.raw`\bgrade\s+[A-F](?![A-Za-z])`),
  // Verdicts.
  p('verdict', 'low-risk investment / company / stock', String.raw`\blow[- ]risk\s+(?:investment|company|stock)s?\b`),
  p('verdict', 'safe investment', String.raw`\bsafe\s+investments?\b`),
  p('verdict', 'best investment', String.raw`\bbest\s+investments?\b`),
  p('verdict', 'undervalued / overvalued', String.raw`\b(?:undervalued|overvalued)\b`),
  p('verdict', 'must-own', String.raw`\bmust[- ]own\b`),
  p('verdict', 'guaranteed return', String.raw`\bguaranteed\s+returns?\b`),
];

export interface BannedMatch {
  group: BannedGroup;
  rule: string;
  text: string;
}

/** Every banned phrase in a piece of model-written text. */
export function findBannedPhrases(text: string): BannedMatch[] {
  const out: BannedMatch[] = [];
  for (const b of BANNED_PATTERNS) {
    const m = b.pattern.exec(text);
    if (m) out.push({ group: b.group, rule: b.rule, text: m[0] });
  }
  return out;
}

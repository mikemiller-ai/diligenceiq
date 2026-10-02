import {
  CompanyIntelligenceProfileSchema,
  coverageTier,
  findBannedPhrases,
  profileIntegrityIssues,
  type CompanyIntelligenceProfile,
} from '@diligenceiq/core';
import { profileBlocks } from './prompt';
import { groundingOf, ungroundedFigures, wordFigures, type ProfileSupplied } from './validate';

/*
 * Profile evaluation (testing-strategy §7; SPEC §32.9): deterministic metrics over a built set,
 * scored against the provisional bars in evals/profiles.yaml. Run by `pnpm eval:profiles` after
 * a build; no model call. Measured independently of what the profile says about itself:
 *   - citations: every profile citation is a real index chunk of that company, and, for a
 *     model-written profile, every narrative citation is a SOURCE_ID of the request recomputed
 *     from the deterministic profile (the eval recomputes the evidence and message locally);
 *   - figures: each narrative item's figures against FACTS, or (model-written profiles) a passage
 *     the same item cites whose text was in the request's excerpts — the validator's rule;
 *   - tier: recomputed from the index's 10-K and 10-Q document counts for the ticker.
 */

export interface ProfileBars {
  citationValidity: number;
  figureMatch: number;
  bannedPhrases: number;
  deepTierFallbackRate: number;
  tierCorrectness: number;
  maxCallsPerProfile: number;
}

export const PROVISIONAL_BARS: ProfileBars = {
  citationValidity: 1,
  figureMatch: 1,
  bannedPhrases: 0,
  deepTierFallbackRate: 0.25,
  tierCorrectness: 1,
  maxCallsPerProfile: 1,
};

export interface ProfileScore {
  ticker: string;
  tier: string;
  mode: 'llm' | 'deterministic';
  calls: number;
  schemaValid: boolean;
  integrityIssues: string[];
  /** Profile citations that are real index chunks of the company, plus (model-written) narrative citations inside the recomputed supplied set. */
  citations: { total: number; valid: number; invalid: string[] };
  figures: { total: number; matched: number; unmatched: string[] };
  banned: string[];
  tierCorrect: boolean;
}

/** The narrative of a stored profile by item, with the passages each item cites. */
export function narrativeItems(p: CompanyIntelligenceProfile): Array<{ path: string; texts: string[]; citationIds: string[] }> {
  return [
    ...(p.headline ? [{ path: 'headline', texts: [p.headline], citationIds: [] }] : []),
    ...p.executiveView.map((e) => ({ path: `executiveView.${e.dimension}`, texts: [e.summary], citationIds: e.citationIds })),
    ...p.signals.map((s) => ({ path: `signals.${s.signalId}`, texts: [s.headline, s.whatChanged, s.whyThisMatters], citationIds: s.citationIds })),
    ...p.drivers.map((d) => ({ path: `drivers.${d.label}`, texts: [d.explanation], citationIds: d.citationIds })),
    ...(p.managementOutlook ? [{ path: 'managementOutlook', texts: [p.managementOutlook.summary], citationIds: p.managementOutlook.citationIds }] : []),
    ...p.recommendedDiligence.map((r, i) => ({ path: `recommendedDiligence.${i}`, texts: [r.question, r.why], citationIds: r.citationIds })),
  ];
}

/** The model-written (or templated) narrative of a stored profile, where figures and vocabulary are checked. */
export function narrativeTexts(p: CompanyIntelligenceProfile): Array<{ path: string; text: string }> {
  return [
    ...(p.headline ? [{ path: 'headline', text: p.headline }] : []),
    ...p.executiveView.map((e) => ({ path: `executiveView.${e.dimension}`, text: e.summary })),
    ...p.signals.flatMap((s) => [
      { path: `signals.${s.signalId}.headline`, text: s.headline },
      { path: `signals.${s.signalId}.whatChanged`, text: s.whatChanged },
      { path: `signals.${s.signalId}.whyThisMatters`, text: s.whyThisMatters },
    ]),
    ...p.drivers.map((d) => ({ path: `drivers.${d.label}`, text: d.explanation })),
    ...(p.managementOutlook ? [{ path: 'managementOutlook', text: p.managementOutlook.summary }] : []),
    ...p.recommendedDiligence.flatMap((r, i) => [
      { path: `recommendedDiligence.${i}.question`, text: r.question },
      { path: `recommendedDiligence.${i}.why`, text: r.why },
    ]),
  ];
}

export interface ScoreContext {
  indexChunkIds: ReadonlySet<string>;
  /** 10-K and 10-Q documents of this ticker in the index (chunks.jsonl), for the tier check. */
  documents: { tenK: number; tenQ: number };
  /**
   * Model-written profiles: the request recomputed from the company's deterministic profile.
   * Required for a profile in mode 'llm' (its citations and figures are checked against it).
   */
  supplied?: ProfileSupplied;
}

export function scoreProfile(raw: unknown, ctx: ScoreContext): ProfileScore {
  const parsed = CompanyIntelligenceProfileSchema.safeParse(raw);
  const p = (parsed.success ? parsed.data : raw) as CompanyIntelligenceProfile;
  const llm = p.generation.mode === 'llm';
  if (llm && !ctx.supplied) throw new Error(`scoreProfile ${p.ticker}: a model-written profile needs the recomputed supplied set`);
  const ids = p.citations.map((c) => c.chunkId);
  const invalid = ids.filter((id) => !(ctx.indexChunkIds.has(id) && id.startsWith(`${p.ticker}-`)));
  const items = narrativeItems(p);
  const narrativeCitations = llm ? items.flatMap((i) => i.citationIds) : [];
  const outside = narrativeCitations.filter((id) => !ctx.supplied!.suppliedIds.has(id));
  const facts = groundingOf(profileBlocks(p).facts);
  const text = new Map(p.citations.map((c) => [c.chunkId, c.text]));
  // A figure is grounded in FACTS or in a passage its own item cites (SPEC §32.2); for model text,
  // only a passage whose text was in the request's excerpts counts (as in the validator).
  const figures = items.flatMap((item) => {
    const cited = item.citationIds
      .filter((id) => !llm || ctx.supplied!.excerptIds.has(id))
      .map((id) => text.get(id))
      .filter((t): t is string => t !== undefined)
      .map(groundingOf);
    return item.texts.flatMap((t) => {
      const bad = ungroundedFigures(t, facts, cited);
      const all = [...bad.map((f) => ({ f, ok: false })), ...countFigures(t, bad.length)];
      return [...all.map((x) => ({ path: item.path, ...x })), ...wordFigures(t).map((w) => ({ path: item.path, f: `"${w}"`, ok: false }))];
    });
  });
  return {
    ticker: p.ticker,
    tier: p.coverage.tier,
    mode: p.generation.mode,
    calls: p.generation.generationCallCount,
    schemaValid: parsed.success,
    integrityIssues: parsed.success ? profileIntegrityIssues(p) : parsed.error.issues.slice(0, 3).map((i) => i.message),
    citations: {
      total: ids.length + narrativeCitations.length,
      valid: ids.length - invalid.length + narrativeCitations.length - outside.length,
      invalid: [...invalid.map((id) => `${id} (not an index chunk of ${p.ticker})`), ...[...new Set(outside)].map((id) => `${id} (not in the recomputed request)`)],
    },
    figures: { total: figures.length, matched: figures.filter((x) => x.ok).length, unmatched: figures.filter((x) => !x.ok).map((x) => `${x.path}: ${x.f}`) },
    banned: narrativeTexts(p).flatMap(({ path, text }) => findBannedPhrases(text).map((b) => `${path}: ${b.text}`)),
    tierCorrect: p.coverage.tier === coverageTier(ctx.documents.tenK, ctx.documents.tenQ),
  };
}

/** The grounded figures of a text (all of them minus the ungrounded ones), as matched entries. */
function countFigures(text: string, ungrounded: number): Array<{ f: string; ok: true }> {
  const n = figureCount(text) - ungrounded;
  return Array.from({ length: Math.max(0, n) }, () => ({ f: '', ok: true as const }));
}

/** Every points value, currency amount and percentage in a text (grounded or not). */
function figureCount(text: string): number {
  const none = groundingOf('');
  return ungroundedFigures(text, none, []).length;
}

export interface ProfileSetSummary {
  profiles: number;
  schemaValid: number;
  integrityClean: number;
  citationValidity: number;
  figureMatch: number;
  bannedPhrases: number;
  tierCorrectness: number;
  maxCallsPerProfile: number;
  llm: number;
  deepTierFallbackRate: number | null;
  passes: Record<keyof ProfileBars, boolean | null>;
}

export function summarizeProfiles(scores: readonly ProfileScore[], isLlmSet: boolean, bars: ProfileBars = PROVISIONAL_BARS): ProfileSetSummary {
  const sum = (f: (s: ProfileScore) => number) => scores.reduce((n, s) => n + f(s), 0);
  const cit = sum((s) => s.citations.total);
  const fig = sum((s) => s.figures.total);
  const deep = scores.filter((s) => s.tier === 'deep');
  const fallback = isLlmSet && deep.length ? deep.filter((s) => s.mode === 'deterministic').length / deep.length : null;
  const out = {
    profiles: scores.length,
    schemaValid: scores.filter((s) => s.schemaValid).length,
    integrityClean: scores.filter((s) => s.integrityIssues.length === 0).length,
    citationValidity: cit ? sum((s) => s.citations.valid) / cit : 1,
    figureMatch: fig ? sum((s) => s.figures.matched) / fig : 1,
    bannedPhrases: sum((s) => s.banned.length),
    tierCorrectness: scores.length ? scores.filter((s) => s.tierCorrect).length / scores.length : 1,
    maxCallsPerProfile: Math.max(0, ...scores.map((s) => s.calls)),
    llm: scores.filter((s) => s.mode === 'llm').length,
    deepTierFallbackRate: fallback,
  };
  return {
    ...out,
    passes: {
      citationValidity: out.citationValidity >= bars.citationValidity,
      figureMatch: out.figureMatch >= bars.figureMatch,
      bannedPhrases: out.bannedPhrases <= bars.bannedPhrases,
      deepTierFallbackRate: fallback === null ? null : fallback <= bars.deepTierFallbackRate,
      tierCorrectness: out.tierCorrectness >= bars.tierCorrectness,
      maxCallsPerProfile: out.maxCallsPerProfile <= bars.maxCallsPerProfile,
    },
  };
}

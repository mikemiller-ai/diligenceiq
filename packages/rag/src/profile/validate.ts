import { z } from 'zod';
import {
  CompanyIntelligenceProfileSchema,
  findBannedPhrases,
  profileIntegrityIssues,
  type CompanyIntelligenceProfile,
} from '@diligenceiq/core';
import type { ChunkRecord } from '../index/format';
import { extractFigures, matchFigure, passageNumbers, type FigureRule, type PassageNumbers } from '../generation/validate';
import { citationsFor, referencedChunkIds } from './assemble';
import { profileBlocks } from './prompt';

/*
 * Profile validation (SPEC §32.2, §32.9; DD-16; architecture §4.4 step 9). Deterministic. The
 * model's output is accepted only if ALL of these hold; otherwise the company's LLM-set profile
 * is its deterministic profile (generation.mode 'deterministic', generationCallCount 1) and the
 * failure is recorded in the manifest. Nothing is repaired or retried.
 *   - schema: the forced tool's input parses;
 *   - nothing invented: every signalId, driver label and dimension is one that was supplied, at most once;
 *   - citations ⊂ supplied: every citation is a SOURCE_ID that literally appears in the user
 *     message (the deterministic blocks' IDs and the `<filing_excerpts>` headers);
 *   - figures grounded: every currency amount and percentage in model text appears in the FACTS
 *     block, or is printed in a passage that the same item cites AND whose text was in
 *     `<filing_excerpts>` (the Deep Analysis rule; SPEC §32.2). A passage the model saw only as
 *     an ID grounds nothing. Only the verified match rules count ('exact', 'scaled',
 *     'caption_unit', 'preceding_unit'; never 'unit_unstated'). A change in points ("2.9 pp",
 *     "2.9 percentage points") must be printed as points in FACTS, and points never match a
 *     percentage or the other way round. No figure is stated in words ("two-fifths", "a quarter of", "doubled",
 *     "five percentage points");
 *   - labels as given: "accelerating" is said of revenue only when its trajectory label is Accelerating;
 *   - vocabulary: no banned phrase (core vocabulary.ts) in any model-written field.
 * Prompt rules 7–9 (labels, overclaiming, outlook vs risk language) are only partly enforced
 * here; docs/evaluation.md §6 lists what is not.
 *
 * PROFILE_VALIDATOR_VERSION names these rules in each manifest; bump it when a rule changes.
 * 3 (Phase 7): a table whose first header cell is a currency caption without "in"
 * ("(MILLIONS) | …") takes that unit for its own cells (generation/validate.ts `captionTables`,
 * rule 'caption_unit'). Re-scoring the stored det-v2 and llm-v3 sets under 3 changes nothing
 * (docs/evaluation.md §6), so their manifests keep 2.
 */
export const PROFILE_VALIDATOR_VERSION = '3';

const Ids = z.array(z.string().min(1)).min(1);

export const ProfileToolOutputSchema = z.object({
  headline: z.string().min(1).max(400),
  executiveView: z.array(z.object({ dimension: z.string().min(1), summary: z.string().min(1).max(800), citationIds: Ids })),
  signals: z.array(
    z.object({
      signalId: z.string().min(1),
      headline: z.string().min(1).max(200),
      whatChanged: z.string().min(1).max(800),
      whyThisMatters: z.string().min(1).max(800),
      citationIds: Ids,
    }),
  ),
  drivers: z.array(z.object({ label: z.string().min(1), explanation: z.string().min(1).max(800), citationIds: Ids })),
  managementOutlook: z.object({ summary: z.string().min(1).max(1500), citationIds: Ids }).nullable(),
  recommendedDiligence: z
    .array(z.object({ question: z.string().min(1).max(1000), why: z.string().min(1).max(600), signalIds: z.array(z.string()), citationIds: Ids }))
    .min(1)
    .max(8),
});
export type ProfileToolOutput = z.infer<typeof ProfileToolOutputSchema>;

export type ProfileFailure = 'malformed_output' | 'schema' | 'invented_item' | 'invalid_citations' | 'unsupported_figures' | 'label_conflict' | 'banned_phrases' | 'integrity';

export interface ProfileValidation {
  ok: boolean;
  failure: ProfileFailure | null;
  issues: string[];
  invalidCitations: number;
  unsupportedFigures: number;
  bannedPhrases: number;
}

/** Every model-written item: its strings and the passages it cites (a figure may come from those passages). */
export function modelItems(o: ProfileToolOutput): Array<{ path: string; texts: string[]; citationIds: string[] }> {
  return [
    { path: 'headline', texts: [o.headline], citationIds: [] },
    ...o.executiveView.map((e) => ({ path: `executiveView.${e.dimension}`, texts: [e.summary], citationIds: e.citationIds })),
    ...o.signals.map((s) => ({ path: `signals.${s.signalId}`, texts: [s.headline, s.whatChanged, s.whyThisMatters], citationIds: s.citationIds })),
    ...o.drivers.map((d) => ({ path: `drivers.${d.label}`, texts: [d.explanation], citationIds: d.citationIds })),
    ...(o.managementOutlook ? [{ path: 'managementOutlook', texts: [o.managementOutlook.summary], citationIds: o.managementOutlook.citationIds }] : []),
    ...o.recommendedDiligence.map((r, i) => ({ path: `recommendedDiligence.${i}`, texts: [r.question, r.why], citationIds: r.citationIds })),
  ];
}

/** Every model-written string with a path, for figure and vocabulary checks. */
export function modelTexts(o: ProfileToolOutput): Array<{ path: string; text: string }> {
  return [
    { path: 'headline', text: o.headline },
    ...o.executiveView.map((e) => ({ path: `executiveView.${e.dimension}`, text: e.summary })),
    ...o.signals.flatMap((s) => [
      { path: `signals.${s.signalId}.headline`, text: s.headline },
      { path: `signals.${s.signalId}.whatChanged`, text: s.whatChanged },
      { path: `signals.${s.signalId}.whyThisMatters`, text: s.whyThisMatters },
    ]),
    ...o.drivers.map((d) => ({ path: `drivers.${d.label}`, text: d.explanation })),
    ...(o.managementOutlook ? [{ path: 'managementOutlook', text: o.managementOutlook.summary }] : []),
    ...o.recommendedDiligence.flatMap((r, i) => [
      { path: `recommendedDiligence.${i}.question`, text: r.question },
      { path: `recommendedDiligence.${i}.why`, text: r.why },
    ]),
  ];
}

/** Figure match rules that count as grounded (generation/validate.ts FigureRule); 'unit_unstated' is a near match only. */
const GROUNDED_RULES: ReadonlySet<FigureRule> = new Set(['exact', 'scaled', 'caption_unit', 'preceding_unit']);

/** "2.9 pp", "2.9 percentage points": a change in points. Read separately from percentages. */
const POINTS = /(?<![\d.,])(\d+(?:\.\d+)?)\s?(?:pp\b|percentage[- ]points?\b)/gi;

/** The points values printed in a text, and the text with them removed (so they are never read as percentages). */
export function splitPoints(text: string): { points: number[]; rest: string } {
  const points: number[] = [];
  const rest = text.replace(POINTS, (_m, n: string) => {
    points.push(Number(n));
    return ' ';
  });
  return { points, rest };
}

/** What a text grounds: its points values and its other numbers (generation/validate.ts passageNumbers). */
export interface Grounding {
  points: number[];
  numbers: PassageNumbers;
}

export function groundingOf(text: string): Grounding {
  const { points, rest } = splitPoints(text);
  return { points, numbers: passageNumbers(rest) };
}

/**
 * The figures in one model-written string that are not grounded: points must be printed as points
 * in FACTS; currency and percentages must match FACTS or a cited excerpt passage under a verified rule.
 */
export function ungroundedFigures(text: string, facts: Grounding, cited: readonly Grounding[]): string[] {
  const { points, rest } = splitPoints(text);
  const out = points.filter((n) => !facts.points.includes(n)).map((n) => `${n} pp`);
  const grounded = (f: ReturnType<typeof extractFigures>[number], g: Grounding) => {
    const rule = matchFigure(f, g.numbers);
    return rule !== null && GROUNDED_RULES.has(rule);
  };
  for (const f of extractFigures(rest)) if (!grounded(f, facts) && !cited.some((g) => grounded(f, g))) out.push(f.text);
  return out;
}

const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|a\s+hundred|one\s+hundred)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?`;
const FIN_NOUN = String.raw`(?:its\s+|the\s+|total\s+|all\s+|net\s+)*(?:revenue|sales|income|profit|earnings|cash|assets|growth)\b`;

/**
 * A share, multiple or percentage stated in words: a computed figure the FACTS block does not
 * print (SPEC §32.2). Numbered quarters and halves count only before a financial noun ("three
 * quarters of revenue"), never as time ("the last two quarters").
 */
const WORD_FIGURE = new RegExp(
  [
    String.raw`\b(?:one|two|three|four|five|six|seven|eight|nine)[- ](?:thirds?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?)\b`,
    String.raw`\b(?:one|two|three)[- ](?:quarters?|halves)\s+of\s+${FIN_NOUN}`,
    String.raw`\b(?:(?:a|one)[- ](?:half|third|quarter)|half)\s+of\s+${FIN_NOUN}`,
    String.raw`\b${NUMBER_WORD}\s+(?:percent|per\s+cent|percentage[- ]points?)\b`,
    String.raw`\b(?:doubled|tripled|quadrupled)\b`,
  ].join('|'),
  'i',
);

export function wordFigures(text: string): string[] {
  const m = WORD_FIGURE.exec(text);
  return m ? [m[0]] : [];
}

/** "Accelerated revenue growth" next to a Growing label: the model's word against the product's label. */
const ACCELERATING_REVENUE = /\baccelerat\w*\s+(?:its\s+|the\s+)?(?:revenue|sales|top[- ]line)|\b(?:revenue|sales|top[- ]line)(?:\s+growth)?\s+(?:\w+\s+)?accelerat\w*|\b(?:full-year|revenue|growth)\s+acceleration\b/i;

export function labelConflicts(o: ProfileToolOutput, det: CompanyIntelligenceProfile): string[] {
  const revenueAccelerating = det.trends.some((t) => t.metric === 'Revenue growth' && t.trajectory === 'accelerating');
  const out: string[] = [];
  const check = (path: string, text: string, accelerating: boolean) => {
    if (!accelerating && ACCELERATING_REVENUE.test(text)) out.push(`${path}: says revenue accelerated, but its label is not Accelerating`);
  };
  check('headline', o.headline, revenueAccelerating);
  for (const e of o.executiveView) {
    const label = det.executiveView.find((d) => d.dimension === e.dimension)?.label;
    check(`executiveView.${e.dimension}`, e.summary, label === 'Accelerating' || revenueAccelerating);
  }
  return out;
}

function allCitations(o: ProfileToolOutput): string[] {
  return [
    ...o.executiveView.flatMap((e) => e.citationIds),
    ...o.signals.flatMap((s) => s.citationIds),
    ...o.drivers.flatMap((d) => d.citationIds),
    ...(o.managementOutlook?.citationIds ?? []),
    ...o.recommendedDiligence.flatMap((r) => r.citationIds),
  ];
}

function fail(failure: ProfileFailure, issues: string[], counts: Partial<ProfileValidation> = {}): ProfileValidation {
  return { ok: false, failure, issues, invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0, ...counts };
}

/** What the model was given, recomputed deterministically from the request (never taken from a stored outcome). */
export interface ProfileSupplied {
  /** Every SOURCE_ID literally in the user message (`profileSuppliedIds`). */
  suppliedIds: ReadonlySet<string>;
  /** The passages whose TEXT was in `<filing_excerpts>`: the only ones that can ground a figure. */
  excerptIds: ReadonlySet<string>;
}

/** Validates the forced tool's input against the deterministic profile it explains and what it was given. */
export function validateProfileOutput(
  toolInput: unknown,
  det: CompanyIntelligenceProfile,
  supplied: ProfileSupplied,
  /** Passage text by chunk ID, for figures printed in an item's cited excerpt passages. */
  passageText: (chunkId: string) => string | undefined,
): { validation: ProfileValidation; output: ProfileToolOutput | null } {
  const { suppliedIds, excerptIds } = supplied;
  if (toolInput === null || typeof toolInput !== 'object') return { validation: fail('malformed_output', ['the model did not call submit_company_profile with an object']), output: null };
  const parsed = ProfileToolOutputSchema.safeParse(toolInput);
  if (!parsed.success) return { validation: fail('schema', parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`)), output: null };
  const o = parsed.data;

  // Nothing invented, nothing twice.
  const invented: string[] = [];
  const once = (kind: string, names: string[], allowed: Set<string>) => {
    const seen = new Set<string>();
    for (const n of names) {
      if (!allowed.has(n)) invented.push(`${kind} not supplied: ${n}`);
      else if (seen.has(n)) invented.push(`${kind} repeated: ${n}`);
      seen.add(n);
    }
  };
  const signalIds = new Set(det.signals.map((s) => s.signalId));
  once('signal', o.signals.map((s) => s.signalId), signalIds);
  once('driver', o.drivers.map((d) => d.label), new Set(det.drivers.map((d) => d.label)));
  once('dimension', o.executiveView.map((e) => e.dimension), new Set(det.executiveView.map((e) => e.dimension)));
  for (const r of o.recommendedDiligence) for (const id of r.signalIds) if (!signalIds.has(id)) invented.push(`recommendation cites an unknown signal: ${id}`);
  if (invented.length) return { validation: fail('invented_item', invented), output: null };

  const badCitations = allCitations(o).filter((id) => !suppliedIds.has(id));
  if (badCitations.length) return { validation: fail('invalid_citations', [...new Set(badCitations)].map((id) => `citation not supplied: ${id}`), { invalidCitations: badCitations.length }), output: null };

  const facts = groundingOf(profileBlocks(det).facts);
  const unsupported: string[] = [];
  for (const item of modelItems(o)) {
    const cited = item.citationIds
      .filter((id) => excerptIds.has(id))
      .map(passageText)
      .filter((t): t is string => t !== undefined)
      .map(groundingOf);
    for (const text of item.texts) for (const f of ungroundedFigures(text, facts, cited)) unsupported.push(`${item.path}: ${f}`);
  }
  for (const { path, text } of modelTexts(o)) for (const w of wordFigures(text)) unsupported.push(`${path}: "${w}" (a figure in words)`);
  if (unsupported.length) return { validation: fail('unsupported_figures', unsupported, { unsupportedFigures: unsupported.length }), output: null };

  const conflicts = labelConflicts(o, det);
  if (conflicts.length) return { validation: fail('label_conflict', conflicts), output: null };

  const banned = modelTexts(o).flatMap(({ path, text }) => findBannedPhrases(text).map((b) => `${path}: "${b.text}" (${b.rule})`));
  if (banned.length) return { validation: fail('banned_phrases', banned, { bannedPhrases: banned.length }), output: null };

  return { validation: { ok: true, failure: null, issues: [], invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 }, output: o };
}

export interface MergeMeta {
  profileSetId: string;
  profilePromptVersion: string;
  modelId: string;
  ledgerRunId: string;
  inputTokens: number;
  outputTokens: number;
  chunks: ReadonlyMap<string, ChunkRecord>;
}

const dedupe = (a: readonly string[]) => [...new Set(a)];

/**
 * The LLM profile: the deterministic profile with the model's narrative laid over it. Facts,
 * trends, measurements, labels, risk headings and evidence (including each signal's
 * evidenceByPeriod) never change; an item the model left out keeps its template text and its
 * citations. A model-written item carries the MODEL's citations only (no union with the
 * template's), so what the page cites next to the text is what the validator checked it against.
 */
export function mergeProfile(det: CompanyIntelligenceProfile, o: ProfileToolOutput, meta: MergeMeta): CompanyIntelligenceProfile {
  const ev = new Map(o.executiveView.map((e) => [e.dimension, e]));
  const sig = new Map(o.signals.map((s) => [s.signalId, s]));
  const drv = new Map(o.drivers.map((d) => [d.label, d]));
  const draft: Omit<CompanyIntelligenceProfile, 'citations'> = {
    ...det,
    version: { ...det.version, profileSetId: meta.profileSetId, profilePromptVersion: meta.profilePromptVersion },
    headline: o.headline,
    executiveView: det.executiveView.map((e) => {
      const m = ev.get(e.dimension);
      return m ? { ...e, summary: m.summary, citationIds: dedupe(m.citationIds) } : e;
    }),
    signals: det.signals.map((s) => {
      const m = sig.get(s.signalId);
      return m
        ? { ...s, headline: m.headline, whatChanged: m.whatChanged, whyThisMatters: m.whyThisMatters, whyThisMattersSource: 'model' as const, citationIds: dedupe(m.citationIds) }
        : s;
    }),
    drivers: det.drivers.map((d) => {
      const m = drv.get(d.label);
      return m ? { ...d, explanation: m.explanation, citationIds: dedupe(m.citationIds) } : d;
    }),
    managementOutlook: o.managementOutlook,
    recommendedDiligence: o.recommendedDiligence.map((r) => ({ question: r.question, why: r.why, signalIds: [...new Set(r.signalIds)], citationIds: [...new Set(r.citationIds)], tickers: [det.ticker] })),
    gaps: det.gaps.filter((g) => !(o.managementOutlook && g.startsWith('Management outlook is not summarized'))),
    generation: {
      mode: 'llm',
      modelId: meta.modelId,
      generationCallCount: 1,
      ledgerRunId: meta.ledgerRunId,
      inputTokens: meta.inputTokens,
      outputTokens: meta.outputTokens,
      validation: { invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 },
    },
  };
  const profile = CompanyIntelligenceProfileSchema.parse({ ...draft, citations: citationsFor(referencedChunkIds(draft), meta.chunks, det.version.indexVersion) });
  const issues = profileIntegrityIssues(profile);
  if (issues.length) throw new Error(`llm profile ${det.ticker}: ${issues.join('; ')}`);
  return profile;
}

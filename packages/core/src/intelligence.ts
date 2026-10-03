import { z } from 'zod';
import { CitationSchema } from './domain';
import type { ThemeId } from './themes';

/**
 * Company Intelligence profile (architecture §7.1, SPEC §8–12, §32). A stored, versioned
 * artifact: the api reads it, it is never generated on page view. Labels are descriptive
 * only; there are no scores, ratings, or recommendations in the schema.
 */

export const TRAJECTORIES = [
  'accelerating',
  'growing',
  'stable',
  'slowing',
  'declining',
  'improving',
  'not_extracted',
  'limited_history',
] as const;
export const TrajectorySchema = z.enum(TRAJECTORIES);
export type Trajectory = z.infer<typeof TrajectorySchema>;

export const SIGNAL_TYPES = ['NEW', 'EXPANDED', 'REDUCED', 'TREND_CHANGE', 'OUTLOOK_CHANGE', 'PERSISTENT'] as const;
export const SignalTypeSchema = z.enum(SIGNAL_TYPES);
export type SignalType = z.infer<typeof SignalTypeSchema>;

/** Order is the tie-breaking "category order" of the Compare attention ranking (SPEC §13.1). */
export const SIGNAL_CATEGORIES = [
  'performance',
  'growth',
  'margin',
  'liquidity',
  'debt',
  'regulatory',
  'competition',
  'customer_concentration',
  'geographic_concentration',
  'supply_chain',
  'cybersecurity',
  'litigation',
  'management_outlook',
] as const;
export const SignalCategorySchema = z.enum(SIGNAL_CATEGORIES);
export type SignalCategory = z.infer<typeof SignalCategorySchema>;

/** Plain labels for primary screens (SPEC §5.5). */
export const SIGNAL_CATEGORY_LABELS: Record<SignalCategory, string> = {
  performance: 'Performance',
  growth: 'Growth',
  margin: 'Margins',
  liquidity: 'Liquidity',
  debt: 'Debt',
  regulatory: 'Regulatory',
  competition: 'Competition',
  customer_concentration: 'Customer concentration',
  geographic_concentration: 'Geographic concentration',
  supply_chain: 'Supply chain',
  cybersecurity: 'Cybersecurity',
  litigation: 'Litigation',
  management_outlook: 'Management outlook',
};

/** Default finding theme for something saved from a signal or risk (SPEC §17.3). */
const CATEGORY_THEME: Record<SignalCategory, ThemeId> = {
  performance: 'financial-performance',
  growth: 'growth-outlook',
  margin: 'financial-performance',
  liquidity: 'liquidity-capital',
  debt: 'liquidity-capital',
  regulatory: 'regulatory-compliance',
  competition: 'risk-factors',
  customer_concentration: 'risk-factors',
  geographic_concentration: 'risk-factors',
  supply_chain: 'risk-factors',
  cybersecurity: 'risk-factors',
  litigation: 'regulatory-compliance',
  management_outlook: 'growth-outlook',
};

/** A current risk the deterministic classifier could not place is saved under Risk factors. */
export function themeForCategory(category: SignalCategory | null): ThemeId {
  return category ? CATEGORY_THEME[category] : 'risk-factors';
}

/** Label for current risks with no category (the classifier never forces one). */
export const OTHER_RISKS_LABEL = 'Other risks';

export const COVERAGE_TIERS = ['deep', 'partial', 'limited_history'] as const;
export const CoverageTierSchema = z.enum(COVERAGE_TIERS);
export type CoverageTier = z.infer<typeof CoverageTierSchema>;

/**
 * Coverage tier from the filing counts (SPEC §8.5), never from manifest text. Over the
 * corpus this yields the 12 deep, 5 partial and 37 limited-history companies.
 */
export function coverageTier(tenK: number, tenQ: number): CoverageTier {
  if (tenK >= 3) return 'deep';
  if (tenK >= 2 || (tenK >= 1 && tenQ >= 1)) return 'partial';
  return 'limited_history';
}

/**
 * Deterministic risk-heading classifier: an ordered keyword rule list, first match wins.
 * The Phase 2 heading extractor (`packages/corpus`) uses it for every extracted heading, so
 * no category is chosen by hand. The rules are
 * deliberately narrow: a heading that only mentions international operations, or a
 * component in passing, says nothing about concentration or supply, so it stays
 * unclassified (null) rather than being forced into the nearest category.
 */
const HEADING_RULES: ReadonlyArray<[SignalCategory, RegExp]> = [
  ['cybersecurity', /cyber|security breach|security vulnerab|data protection|unauthorized access|confidential information/i],
  ['litigation', /litigation|legal proceeding|lawsuit/i],
  ['supply_chain', /supplier|supply chain|manufactur|outsourc|foundr|component (?:shortage|supply|availability)|single[- ]source|sole[- ]source/i],
  ['regulatory', /\blaws?\b|regulat|export (?:control|restriction)|restrictions on (?:the )?export|government/i],
  ['competition', /compet/i],
  [
    'geographic_concentration',
    /geographic(?:al)? concentration|concentrated in (?:a |a few |one |certain |particular )?(?:countr|region|geograph)|single (?:country|region)|geopolitic/i,
  ],
  ['customer_concentration', /customer concentration|limited number of (?:customers|partners)|significant (?:portion|amount) of (?:our )?(?:revenue|sales) from (?:a )?(?:few|limited|small)/i],
  ['debt', /\bdebt\b|indebtedness|credit rating/i],
  ['liquidity', /liquidity|cash flow/i],
];

export function classifyRiskHeading(heading: string): SignalCategory | null {
  return HEADING_RULES.find(([, re]) => re.test(heading))?.[0] ?? null;
}

/** The only placeholder wording a Phase 1 fixture profile may use (SPEC §8.6). */
export const PLACEHOLDER_TEXT = 'Placeholder, not filing data.';

export function isPlaceholder(text: string): boolean {
  return text.startsWith(PLACEHOLDER_TEXT);
}

/**
 * Fixture (preview) profiles: since Phase 2 they hold the latest 10-K's complete EXTRACTED
 * heading list, but the extractor is a deterministic heuristic with measured, imperfect
 * recall, and the profiles have no figures or signals yet. So nothing that depends on a
 * complete list (common or distinctive areas, attention ranking, risk position) is presented
 * as a conclusion while one is involved (SPEC §8.6), until the Phase 4b profile build.
 */
export function isFixtureProfile(p: Pick<CompanyIntelligenceProfile, 'version'>): boolean {
  return p.version.profileSetId.startsWith('fixture-');
}

const ids = z.array(z.string().min(1));

export const ProfileFactSchema = z
  .object({
    metric: z.string().min(1),
    period: z.string().min(1),
    value: z.number().finite(),
    unit: z.string().min(1),
    scale: z.union([z.literal(1), z.literal(1e3), z.literal(1e6), z.literal(1e9)]),
    chunkId: z.string().min(1),
    /** The source table row, verbatim. */
    rawRow: z.string().min(1),
    crossCheck: z.enum(['ok', 'mismatch', 'single_source']),
  })
  .strict();
export type ProfileFact = z.infer<typeof ProfileFactSchema>;

export const ProfileSignalSchema = z
  .object({
    signalId: z.string().regex(/^[A-Za-z0-9._-]+$/),
    type: SignalTypeSchema,
    category: SignalCategorySchema,
    periods: z.array(z.string()),
    /** Deterministic measurement that triggered the signal (DD-18). */
    measurement: z.string(),
    evidenceByPeriod: z.array(z.object({ period: z.string(), chunkIds: ids }).strict()),
    /** Templated; prefills Deep Analysis and never auto-runs. */
    investigateQuestion: z.string().min(1).max(1000),
    headline: z.string(),
    whatChanged: z.string(),
    whyThisMatters: z.string(),
    whyThisMattersSource: z.enum(['model', 'general_context']),
    citationIds: ids,
  })
  .strict();
export type ProfileSignal = z.infer<typeof ProfileSignalSchema>;

export const CompanyIntelligenceProfileSchema = z
  .object({
    ticker: z.string().regex(/^[A-Z]{1,5}$/),
    company: z.string().min(1),
    sector: z.string().min(1),
    version: z
      .object({
        indexVersion: z.string().min(1),
        /** 'llm-v<n>' or 'det-v<n>'; 'fixture-v<n>' only for Phase 1 fixtures. */
        profileSetId: z.string().regex(/^(llm|det|fixture)-v\d+$/),
        profilePromptVersion: z.string().optional(),
        templateVersion: z.string().min(1),
        builtAt: z.string().min(1),
        periodsCovered: z.array(z.string()),
      })
      .strict(),
    /**
     * Period end of the latest annual report (the company's fiscal-year end). Fiscal years
     * are shown as each company reports them and never aligned (SPEC §9, §13.2); this is
     * not the last entry of periodsCovered, which may be a quarter end.
     */
    fiscalYearEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /**
     * One model-written sentence on what stands out (LLM profiles only; Phase 4b). Absent on
     * deterministic and preview profiles. Shown with a "Model-written summary" label.
     */
    headline: z.string().min(1).optional(),
    coverage: z
      .object({
        tier: CoverageTierSchema,
        filings: z.number().int().nonnegative(),
        tenK: z.number().int().nonnegative(),
        tenQ: z.number().int().nonnegative(),
        byCategory: z.array(
          z.object({ category: SignalCategorySchema, level: z.enum(['strong', 'partial', 'limited']) }).strict(),
        ),
      })
      .strict(),
    facts: z.array(ProfileFactSchema),
    trends: z.array(
      z
        .object({ metric: z.string(), trajectory: TrajectorySchema, basis: z.string(), periods: z.array(z.string()), chunkIds: ids })
        .strict(),
    ),
    drivers: z.array(
      z
        .object({
          label: z.string(),
          metric: z.string(),
          periods: z.array(z.string()),
          changeBasis: z.string(),
          explanation: z.string(),
          citationIds: ids,
        })
        .strict(),
    ),
    currentRisks: z.array(
      z
        .object({
          /**
           * Null when the deterministic classifier finds no category: the heading is shown
           * under "Other risks" rather than forced into the nearest area (Phase 2).
           */
          category: SignalCategorySchema.nullable(),
          /** The latest 10-K risk heading, verbatim. */
          heading: z.string().min(1),
          plainLabel: z.string().min(1),
          /**
           * Order of the heading in the latest 10-K's risk section, as extracted. A preview
           * (fixture) profile never presents it as a position (SPEC §8.6).
           */
          rank: z.number().int().positive(),
          citationIds: ids.min(1),
        })
        .strict(),
    ),
    signals: z.array(ProfileSignalSchema),
    executiveView: z.array(
      z.object({ dimension: z.string().min(1), label: z.string().min(1), summary: z.string(), citationIds: ids }).strict(),
    ),
    managementOutlook: z.object({ summary: z.string(), citationIds: ids }).strict().nullable(),
    recommendedDiligence: z.array(
      z
        .object({
          question: z.string().min(1).max(1000),
          why: z.string().min(1),
          signalIds: z.array(z.string()),
          /** Passages the recommendation rests on (its signals' or its current risk's), so a saved one keeps evidence. */
          citationIds: ids,
          tickers: z.array(z.string().regex(/^[A-Z]{1,5}$/)).min(1),
        })
        .strict(),
    ),
    gaps: z.array(z.string()),
    citations: z.array(CitationSchema),
    generation: z
      .object({
        mode: z.enum(['llm', 'deterministic']),
        modelId: z.string().optional(),
        generationCallCount: z.union([z.literal(0), z.literal(1)]),
        ledgerRunId: z.string().optional(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        validation: z
          .object({
            invalidCitations: z.number().int().nonnegative(),
            unsupportedFigures: z.number().int().nonnegative(),
            bannedPhrases: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type CompanyIntelligenceProfile = z.infer<typeof CompanyIntelligenceProfileSchema>;

/** Every place a profile references a chunk, with a label for error messages. */
function chunkReferences(p: CompanyIntelligenceProfile): Array<[string, string]> {
  const refs: Array<[string, string]> = [];
  const add = (where: string, list: readonly string[]) => list.forEach((id) => refs.push([where, id]));
  p.facts.forEach((f, i) => add(`facts[${i}]`, [f.chunkId]));
  p.trends.forEach((t, i) => add(`trends[${i}]`, t.chunkIds));
  p.drivers.forEach((d, i) => add(`drivers[${i}]`, d.citationIds));
  p.currentRisks.forEach((r, i) => add(`currentRisks[${i}]`, r.citationIds));
  p.signals.forEach((s, i) => {
    add(`signals[${i}]`, s.citationIds);
    s.evidenceByPeriod.forEach((e) => add(`signals[${i}].evidenceByPeriod`, e.chunkIds));
  });
  p.executiveView.forEach((e, i) => add(`executiveView[${i}]`, e.citationIds));
  if (p.managementOutlook) add('managementOutlook', p.managementOutlook.citationIds);
  p.recommendedDiligence.forEach((r, i) => add(`recommendedDiligence[${i}]`, r.citationIds));
  return refs;
}

/**
 * Deterministic integrity checks beyond the schema (SPEC §16.1, §9): every chunk a profile
 * references is among its citations, every fact's source row is verbatim inside its cited
 * passage, every current-risk heading is verbatim inside its cited passage, and every
 * signal ID a recommendation names exists, and every recommendation has a supporting signal
 * or citation (SPEC §12, §17.1). Returns human-readable issues; empty means valid.
 */
export function profileIntegrityIssues(p: CompanyIntelligenceProfile): string[] {
  const issues: string[] = [];
  const byId = new Map(p.citations.map((c) => [c.chunkId, c]));
  for (const [where, id] of chunkReferences(p)) {
    if (!byId.has(id)) issues.push(`${where} cites ${id}, which is not in the profile's citations`);
  }
  p.facts.forEach((f, i) => {
    const passage = byId.get(f.chunkId);
    if (passage && !passage.text.includes(f.rawRow)) issues.push(`facts[${i}].rawRow is not verbatim in ${f.chunkId}`);
  });
  p.currentRisks.forEach((r, i) => {
    if (!r.citationIds.some((id) => byId.get(id)?.text.includes(r.heading))) {
      issues.push(`currentRisks[${i}].heading is not verbatim in its cited passages`);
    }
  });
  const signalIds = new Set(p.signals.map((s) => s.signalId));
  p.recommendedDiligence.forEach((r, i) => {
    for (const s of r.signalIds) if (!signalIds.has(s)) issues.push(`recommendedDiligence[${i}] names unknown signal ${s}`);
    if (r.signalIds.length === 0 && r.citationIds.length === 0) issues.push(`recommendedDiligence[${i}] has no supporting signal or citation`);
  });
  for (const c of p.citations) if (c.ticker !== p.ticker) issues.push(`citation ${c.chunkId} belongs to ${c.ticker}`);
  return issues;
}

/**
 * Stable refs for profile items, used by AnalysisOrigin and FindingSource. They are
 * derived from position or rank, so the schema stays as architecture §7.1 defines it.
 */
export const profileRef = {
  signal: (s: Pick<ProfileSignal, 'signalId'>) => s.signalId,
  currentRisk: (r: { rank: number }) => `risk-${r.rank}`,
  recommendation: (index: number) => `rec-${index + 1}`,
  driver: (index: number) => `driver-${index + 1}`,
  executiveView: (dimension: string) => dimension.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
};

/**
 * `intelligence/<indexVersion>/<profileSetId>/manifest.json` (architecture §4.4): what the api
 * needs to list a profile set. The offline builder (Phase 4b) may add fields (tokens, durations,
 * validation); unknown fields are ignored here.
 */
export const ProfileSetManifestSchema = z.object({
  indexVersion: z.string().min(1),
  profileSetId: z.string().regex(/^(llm|det|fixture)-v\d+$/),
  builtAt: z.string().min(1),
  companies: z.array(
    z.object({
      ticker: z.string().regex(/^[A-Z]{1,5}$/),
      company: z.string().min(1),
      sector: z.string().min(1),
      tier: CoverageTierSchema,
      filings: z.number().int().nonnegative(),
      periodsCovered: z.array(z.string()),
      headline: z.string().optional(),
      mode: z.enum(['llm', 'deterministic', 'fixture']),
      generationCallCount: z.union([z.literal(0), z.literal(1)]),
    }),
  ),
});
export type ProfileSetManifest = z.infer<typeof ProfileSetManifestSchema>;

/**
 * A driver's change and share, read back from its deterministic `changeBasis` line
 * (`"$167,045 million in FY2024 to $178,353 million in FY2025 (+6.8%); 42.9% of revenue in FY2025."`,
 * written by the profile builder). Both in percent, signs kept (an eliminations line can carry a
 * negative share); null when the line does not state one (a driver with no prior-year value). The
 * builder's format is pinned to this parser by a test in packages/rag.
 */
export function parseDriverChangeBasis(changeBasis: string): { changePct: number | null; share: number | null } {
  const change = /\(([+-]?\d+(?:\.\d+)?)%\)/.exec(changeBasis);
  const share = /(-?\d+(?:\.\d+)?)% of revenue in /.exec(changeBasis);
  return { changePct: change ? Number(change[1]) : null, share: share ? Number(share[1]) : null };
}

/**
 * A trend's `basis` line, read back (DD-21). The builder writes three fixed formats
 * (packages/corpus `trends.ts`, pinned to this parser by a test in packages/rag):
 * - growth: `Growth of 6.4% in FY2025, after 2.0% in FY2024 (growing: above 2.0%).`
 * - margin: `26.9% in FY2025 vs 24.0% in FY2024, a change of 2.9 pp (improving: threshold 1.0 pp).`
 * - quarter: `FY2026Q1 15.7% versus FY2025Q1 (growing; stable within ±2.0%).`
 * Numbers are in percent (or percentage points) as written, rounded to 0.1. Null for any other text.
 */
export type TrendBasis =
  | { kind: 'growth'; pct: number; period: string; priorPct: number | null; priorPeriod: string | null; trajectory: Trajectory }
  | { kind: 'margin'; latest: number; period: string; prior: number; priorPeriod: string; changePp: number; trajectory: Trajectory }
  | { kind: 'quarter'; pct: number; period: string; priorPeriod: string; trajectory: Trajectory };

const NUM = '(-?\\d+(?:\\.\\d+)?)';
const GROWTH_BASIS = new RegExp(`^Growth of ${NUM}% in (FY\\d{4})(?:, after ${NUM}% in (FY\\d{4}))? \\((\\w+): [^)]*\\)\\.$`);
const MARGIN_BASIS = new RegExp(`^${NUM}% in (FY\\d{4}) vs ${NUM}% in (FY\\d{4}), a change of ${NUM} pp \\((\\w+): [^)]*\\)\\.$`);
const QUARTER_BASIS = new RegExp(`^(FY\\d{4}Q\\d) ${NUM}% versus (FY\\d{4}Q\\d) \\((\\w+); [^)]*\\)\\.$`);
const trajectoryOf = (s: string | undefined): Trajectory | null => {
  const t = TrajectorySchema.safeParse(s);
  return t.success ? t.data : null;
};

export function parseTrendBasis(basis: string): TrendBasis | null {
  let m = GROWTH_BASIS.exec(basis);
  if (m) {
    const trajectory = trajectoryOf(m[5]);
    return trajectory && { kind: 'growth', pct: Number(m[1]), period: m[2]!, priorPct: m[3] === undefined ? null : Number(m[3]), priorPeriod: m[4] ?? null, trajectory };
  }
  m = MARGIN_BASIS.exec(basis);
  if (m) {
    const trajectory = trajectoryOf(m[6]);
    return trajectory && { kind: 'margin', latest: Number(m[1]), period: m[2]!, prior: Number(m[3]), priorPeriod: m[4]!, changePp: Number(m[5]), trajectory };
  }
  m = QUARTER_BASIS.exec(basis);
  if (m) {
    const trajectory = trajectoryOf(m[4]);
    return trajectory && { kind: 'quarter', period: m[1]!, pct: Number(m[2]), priorPeriod: m[3]!, trajectory };
  }
  return null;
}

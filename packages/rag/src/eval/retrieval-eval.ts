import { GenerationExpectSchema } from './generation-eval';
import { z } from 'zod';
import type { ChunkRecord } from '../index/format';
import type { RetrievalResult } from '../retrieval/retrieve';

/**
 * Retrieval-only evaluation (SPEC §41.1–41.2; testing-strategy §7): deterministic checks over
 * the retrieved context, no generation and no LLM judge. The question file is
 * `evals/questions.yaml`; the CLI is `pnpm eval:retrieval`.
 *
 * Gold recall (H6): some questions list hand-picked `gold` chunk IDs, the passages that
 * genuinely answer them (see the header of `evals/questions.yaml` for how they were chosen).
 * Recall@context is the share of gold passages present in the context. A gold passage counts as
 * present when context chunks of the same filing cover at least `GOLD_COVERAGE` of its
 * characters, so the same labels also score other chunk sizes (`pnpm eval:chunk-size`); at the
 * shipped chunk size this is the same as the gold chunk itself being in the context.
 * Gold recall is reported, not a pass bar.
 */
export const EVAL_CATEGORIES = [
  'single-company',
  'multi-company',
  'longitudinal',
  'risk',
  'revenue',
  'regulatory',
  'cross-sector',
  'unsupported',
  'ambiguous',
  'adversarial',
] as const;

const EvidenceSchema = z
  .object({
    ticker: z.string().optional(),
    period: z.string().optional(),
    sections: z.array(z.string()).optional(),
    pattern: z.string().min(1),
  })
  .strict();

export const EvalQuestionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    question: z.string().min(1).max(2000),
    categories: z.array(z.enum(EVAL_CATEGORIES)).min(1),
    source: z.string().optional(),
    expect: z
      .object({
        companies: z.array(z.string()).optional(),
        periods: z.array(z.string().regex(/^[A-Z]{1,5}\/.+$/)).optional(),
        evidence: z.array(EvidenceSchema).optional(),
        minPerCompany: z.number().int().positive().optional(),
        maxCompanyShare: z.number().positive().max(1).optional(),
        minCompanies: z.number().int().positive().optional(),
        maxContextChunks: z.number().int().nonnegative().optional(),
        analysisCompanies: z.array(z.string()).optional(),
        gaps: z.string().optional(),
        notes: z.string().optional(),
        /** Informational precision: share of context chunks in these sections. */
        relevantSections: z.array(z.string()).optional(),
        /** Informational precision: share of context chunks whose text matches this pattern. */
        relevant: z.string().optional(),
        /** At most this many distinct companies in the context (injection: scope not widened). */
        maxCompanies: z.number().int().positive().optional(),
        /** No stated gap may match this pattern (injection: a planted period is not applied). */
        forbidGaps: z.string().optional(),
        /** The analysis period kind after resolution (injection: filters unchanged). */
        periodKind: z.enum(['current', 'last_n', 'years', 'since', 'quarters', 'range']).optional(),
        /** Hand-picked chunk IDs that answer the question (recall@context; informational). */
        gold: z.array(z.string().regex(/^[A-Z]{1,5}-FY\d{4}(?:Q[1-4])?-10[KQ]-[A-Z0-9]+-\d{3}$/)).min(1).optional(),
        /** Phase 4 generation checks (eval/generation-eval.ts). */
        generation: GenerationExpectSchema.optional(),
      })
      .strict(),
    /**
     * Phase 7, robustness set only: a synthetic passage carrying an instruction, appended to the
     * real context before generation (eval/plant.ts). It borrows the filing metadata of the first
     * context chunk of `ticker`.
     */
    plant: z
      .object({
        ticker: z.string().regex(/^[A-Z]{1,5}$/),
        text: z.string().min(1).max(2000),
        /** A realistic chunk ID the index does not have; default `PLANTED-<ticker>-001`. */
        id: z.string().regex(/^[A-Z]{1,5}-FY\d{4}(?:Q[1-4])?-10[KQ]-[A-Z0-9]+-\d{3}$/).optional(),
        /** Borrow the metadata of the first context chunk of this fiscal label (default: the ticker's first). */
        period: z.string().regex(/^FY\d{4}(?:Q[1-4])?$/).optional(),
        position: z.enum(['last', 'middle']).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EvalQuestion = z.infer<typeof EvalQuestionSchema>;

export const EvalFileSchema = z
  .object({ version: z.literal(1), questions: z.array(EvalQuestionSchema.refine((q) => !q.plant, 'plant is for the robustness set only')).min(15).max(20) })
  .strict();
/**
 * The Phase 7 robustness set (evals/robustness.yaml): extra adversarial, unsupported and
 * ambiguous questions beyond the 15–20 of SPEC §41.1, scored by the same checks, with their own
 * results file so the main set's record is untouched.
 */
export const RobustnessFileSchema = z.object({ version: z.literal(1), set: z.literal('robustness'), questions: z.array(EvalQuestionSchema).min(1).max(10) }).strict();
export type EvalFile = z.infer<typeof EvalFileSchema>;

/** The assessment PDF questions and the SPEC §51.3 expert question, which must appear verbatim. */
export const VERBATIM_QUESTIONS: Readonly<Record<string, string>> = {
  'pdf-1': 'What are the primary risk factors facing Apple, Tesla, and JPMorgan, and how do they compare?',
  'pdf-2': "How has NVIDIA's revenue and growth outlook changed over the last two years?",
  'pdf-3': 'What regulatory risks do the major pharmaceutical companies face, and how are they addressing them?',
  'expert-1': "How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?",
};

/** Problems with the file itself: verbatim questions, category coverage, unique ids. */
export function evalFileIssues(file: EvalFile): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const q of file.questions) {
    if (ids.has(q.id)) issues.push(`duplicate id ${q.id}`);
    ids.add(q.id);
  }
  for (const [id, text] of Object.entries(VERBATIM_QUESTIONS)) {
    const q = file.questions.find((x) => x.id === id);
    if (!q) issues.push(`missing ${id}`);
    else if (q.question !== text) issues.push(`${id} is not verbatim`);
  }
  for (const c of EVAL_CATEGORIES) if (!file.questions.some((q) => q.categories.includes(c))) issues.push(`no question covers ${c}`);
  return issues;
}

/** Fraction of a gold passage's characters the context must cover for it to count as retrieved. */
export const GOLD_COVERAGE = 0.5;

export type GoldSpan = Pick<ChunkRecord, 'chunkId' | 'documentId' | 'ticker' | 'charStart' | 'charEnd'>;

export interface GoldResult {
  hits: number;
  total: number;
  recall: number;
  perCompany: Record<string, { hits: number; total: number }>;
  missing: string[];
}

/** Recall@context of hand-picked gold passages, by character coverage within the same filing. */
export function goldRecall(gold: readonly GoldSpan[], context: ReadonlyArray<Pick<ChunkRecord, 'documentId' | 'charStart' | 'charEnd'>>): GoldResult {
  const perCompany: GoldResult['perCompany'] = {};
  const missing: string[] = [];
  let hits = 0;
  for (const g of gold) {
    const spans = context
      .filter((c) => c.documentId === g.documentId && c.charEnd > g.charStart && c.charStart < g.charEnd)
      .map((c) => [Math.max(c.charStart, g.charStart), Math.min(c.charEnd, g.charEnd)] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = g.charStart;
    for (const [s, e] of spans) {
      if (e <= end) continue;
      covered += e - Math.max(s, end);
      end = e;
    }
    const hit = covered >= GOLD_COVERAGE * (g.charEnd - g.charStart);
    const row = (perCompany[g.ticker] ??= { hits: 0, total: 0 });
    row.total++;
    if (hit) {
      row.hits++;
      hits++;
    } else missing.push(g.chunkId);
  }
  return { hits, total: gold.length, recall: gold.length ? Number((hits / gold.length).toFixed(3)) : 1, perCompany, missing };
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface QuestionScore {
  id: string;
  pass: boolean;
  checks: CheckResult[];
  companyCoverage: number | null;
  periodCoverage: number | null;
  evidenceHitRate: number | null;
  /** Share of context chunks in `relevantSections` (null when not set). */
  sectionPrecision: number | null;
  /** Share of context chunks matching `relevant` (null when not set). */
  relevantShare: number | null;
  /** Recall@context of the gold passages (null when the question has none). */
  gold: GoldResult | null;
  contextChunks: number;
  tokenEstimate: number;
  companies: Record<string, number>;
  sectionShare: Record<string, number>;
}

/**
 * `goldOf` resolves gold chunk IDs to their spans; it defaults to `chunkOf` (the same index). The
 * chunk-size experiment passes the shipped index's spans while scoring a re-chunked context.
 */
export function scoreRetrieval(
  q: EvalQuestion,
  r: RetrievalResult,
  chunkOf: (id: string) => ChunkRecord | undefined,
  goldOf: (id: string) => GoldSpan | undefined = chunkOf,
): QuestionScore {
  const e = q.expect;
  const checks: CheckResult[] = [];
  const ctx = r.context.chunkIds.map((id) => chunkOf(id)!).filter(Boolean);
  const laneOf = new Map(r.context.blocks.map((b) => [b.sourceId, b.laneId]));
  const lanePeriod = new Map(r.plan.lanes.map((l) => [l.id, l.kind === 'company_period' ? l.periodLabel : null]));
  const periodOf = (c: ChunkRecord) => lanePeriod.get(laneOf.get(c.chunkId) ?? '') ?? c.fiscalLabel;
  const companies: Record<string, number> = {};
  const sectionShare: Record<string, number> = {};
  for (const c of ctx) {
    companies[c.ticker] = (companies[c.ticker] ?? 0) + 1;
    sectionShare[c.sectionKind] = (sectionShare[c.sectionKind] ?? 0) + 1 / Math.max(1, ctx.length);
  }

  let companyCoverage: number | null = null;
  if (e.companies) {
    const present = e.companies.filter((t) => (companies[t] ?? 0) > 0);
    companyCoverage = present.length / e.companies.length;
    checks.push({ name: 'companies', pass: present.length === e.companies.length, detail: `${present.length}/${e.companies.length} present${present.length < e.companies.length ? `; missing ${e.companies.filter((t) => !present.includes(t)).join(', ')}` : ''}` });
  }
  if (e.minPerCompany && e.companies) {
    const low = e.companies.filter((t) => (companies[t] ?? 0) < e.minPerCompany!);
    checks.push({ name: 'minPerCompany', pass: low.length === 0, detail: low.length ? `below ${e.minPerCompany}: ${low.map((t) => `${t}=${companies[t] ?? 0}`).join(', ')}` : `all ≥ ${e.minPerCompany}` });
  }
  let periodCoverage: number | null = null;
  if (e.periods) {
    const cells = new Set(ctx.map((c) => `${c.ticker}/${periodOf(c)}`));
    const present = e.periods.filter((p) => cells.has(p));
    periodCoverage = present.length / e.periods.length;
    checks.push({ name: 'periods', pass: present.length === e.periods.length, detail: `${present.length}/${e.periods.length}${present.length < e.periods.length ? `; missing ${e.periods.filter((p) => !present.includes(p)).join(', ')}` : ''}` });
  }
  let evidenceHitRate: number | null = null;
  if (e.evidence?.length) {
    let hits = 0;
    const misses: string[] = [];
    for (const ev of e.evidence) {
      const re = new RegExp(ev.pattern, 'i');
      const hit = ctx.some(
        (c) => (!ev.ticker || c.ticker === ev.ticker) && (!ev.period || periodOf(c) === ev.period) && (!ev.sections || ev.sections.includes(c.sectionKind)) && re.test(c.text),
      );
      if (hit) hits++;
      else misses.push(`${ev.ticker ?? '*'}${ev.period ? `/${ev.period}` : ''}${ev.sections ? `[${ev.sections.join('|')}]` : ''} /${ev.pattern}/`);
    }
    evidenceHitRate = hits / e.evidence.length;
    checks.push({ name: 'evidence', pass: hits === e.evidence.length, detail: `${hits}/${e.evidence.length}${misses.length ? `; missed ${misses.join('; ')}` : ''}` });
  }
  if (e.maxCompanyShare !== undefined) {
    const max = Math.max(0, ...Object.values(companies)) / Math.max(1, ctx.length);
    checks.push({ name: 'maxCompanyShare', pass: max <= e.maxCompanyShare, detail: `max share ${max.toFixed(2)} (limit ${e.maxCompanyShare})` });
  }
  if (e.minCompanies !== undefined) {
    const n = Object.keys(companies).length;
    checks.push({ name: 'minCompanies', pass: n >= e.minCompanies, detail: `${n} companies (min ${e.minCompanies})` });
  }
  if (e.maxContextChunks !== undefined) {
    checks.push({ name: 'maxContextChunks', pass: ctx.length <= e.maxContextChunks, detail: `${ctx.length} chunks (max ${e.maxContextChunks})` });
  }
  if (e.maxCompanies !== undefined) {
    const n = Object.keys(companies).length;
    checks.push({ name: 'maxCompanies', pass: n <= e.maxCompanies, detail: `${n} companies (max ${e.maxCompanies}): ${Object.keys(companies).join(', ') || 'none'}` });
  }
  if (e.analysisCompanies) {
    const got = r.analysis.companies.map((c) => c.ticker).sort();
    const want = [...e.analysisCompanies].sort();
    checks.push({ name: 'analysisCompanies', pass: JSON.stringify(got) === JSON.stringify(want), detail: `detected [${got.join(', ')}], expected [${want.join(', ')}]` });
  }
  if (e.gaps) {
    const re = new RegExp(e.gaps, 'i');
    checks.push({ name: 'gaps', pass: r.analysis.gaps.some((g) => re.test(g)), detail: r.analysis.gaps.join(' | ') || 'no gaps stated' });
  }
  if (e.forbidGaps) {
    const re = new RegExp(e.forbidGaps, 'i');
    const bad = r.analysis.gaps.filter((g) => re.test(g));
    checks.push({ name: 'forbidGaps', pass: bad.length === 0, detail: bad.join(' | ') || 'none matching' });
  }
  if (e.periodKind) {
    checks.push({ name: 'periodKind', pass: r.analysis.period.kind === e.periodKind, detail: `period ${r.analysis.period.kind} (expected ${e.periodKind})` });
  }
  if (e.notes) {
    const re = new RegExp(e.notes, 'i');
    checks.push({ name: 'notes', pass: r.analysis.notes.some((n) => re.test(n)), detail: r.analysis.notes.join(' | ') });
  }
  const share = (pred: (c: ChunkRecord) => boolean) => (ctx.length ? Number((ctx.filter(pred).length / ctx.length).toFixed(3)) : null);
  const sectionPrecision = e.relevantSections ? share((c) => e.relevantSections!.includes(c.sectionKind)) : null;
  const relevantRe = e.relevant ? new RegExp(e.relevant, 'i') : null;
  const relevantShare = relevantRe ? share((c) => relevantRe.test(c.text)) : null;
  let gold: GoldResult | null = null;
  if (e.gold) {
    const spans = e.gold.map((id) => goldOf(id));
    const unknown = e.gold.filter((_, i) => !spans[i]);
    if (unknown.length) throw new Error(`${q.id}: gold chunk IDs not in the index: ${unknown.join(', ')}`);
    gold = goldRecall(spans as GoldSpan[], ctx);
  }
  checks.push({ name: 'budget', pass: r.context.tokenEstimate <= r.context.budget, detail: `${r.context.tokenEstimate}/${r.context.budget} tokens` });
  checks.push({ name: 'oneEmbedding', pass: r.telemetry.embeddingCallCount <= 1 && r.telemetry.rerankCallCount === 0, detail: `embeddings ${r.telemetry.embeddingCallCount}, rerank ${r.telemetry.rerankCallCount}` });

  return {
    id: q.id,
    pass: checks.every((c) => c.pass),
    checks,
    companyCoverage,
    periodCoverage,
    evidenceHitRate,
    sectionPrecision,
    relevantShare,
    gold,
    contextChunks: ctx.length,
    tokenEstimate: r.context.tokenEstimate,
    companies,
    sectionShare: Object.fromEntries(Object.entries(sectionShare).map(([k, v]) => [k, Number(v.toFixed(3))])),
  };
}

export interface ModeSummary {
  mode: string;
  questions: number;
  passed: number;
  companyCoverage: number;
  periodCoverage: number;
  evidenceHitRate: number;
  /** Means over the questions that set them (informational, no pass bar). */
  sectionPrecision: number;
  relevantShare: number;
  /** Mean per-question gold recall@context, over the questions with gold labels. */
  goldRecall: number | null;
  /** Gold passages retrieved / labeled, over all labeled questions. */
  goldHits: number;
  goldTotal: number;
  checksPassed: number;
  checksTotal: number;
}

export function summarize(mode: string, scores: readonly QuestionScore[]): ModeSummary {
  const mean = (xs: Array<number | null>) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(3)) : 1;
  };
  return {
    mode,
    questions: scores.length,
    passed: scores.filter((s) => s.pass).length,
    companyCoverage: mean(scores.map((s) => s.companyCoverage)),
    periodCoverage: mean(scores.map((s) => s.periodCoverage)),
    evidenceHitRate: mean(scores.map((s) => s.evidenceHitRate)),
    sectionPrecision: mean(scores.map((s) => s.sectionPrecision)),
    relevantShare: mean(scores.map((s) => s.relevantShare)),
    goldRecall: scores.some((s) => s.gold) ? mean(scores.map((s) => s.gold?.recall ?? null)) : null,
    goldHits: scores.reduce((n, s) => n + (s.gold?.hits ?? 0), 0),
    goldTotal: scores.reduce((n, s) => n + (s.gold?.total ?? 0), 0),
    checksPassed: scores.reduce((n, s) => n + s.checks.filter((c) => c.pass).length, 0),
    checksTotal: scores.reduce((n, s) => n + s.checks.length, 0),
  };
}

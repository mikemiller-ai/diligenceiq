import {
  CompanyIntelligenceProfileSchema,
  OTHER_RISKS_LABEL,
  SIGNAL_CATEGORY_LABELS,
  profileIntegrityIssues,
  type Citation,
  type CompanyIntelligenceProfile,
  type ProfileSignal,
  type SignalCategory,
  type Trajectory,
} from '@diligenceiq/core';
import { growthTrend, type CompanyCoverage, type Driver, type FinancialFact, type RiskHeading, type Trend } from '@diligenceiq/corpus';
import type { ChunkRecord } from '../index/format';
import { stripCorporateSuffix } from '../query/companies';
import { detectCompanySignals, type CompanySignalInput, type SignalCandidate } from '../signals/detect';
import { DETECTOR_STATUS } from '../signals/status';
import { GENERAL_CONTEXT, TEMPLATE_VERSION, WHAT_CHANGED_TEMPLATE } from './library';
import { EXTRA_GROWTH_METRICS, FACT_LABEL, TREND_LABELS } from './metrics';
import { formatFactAmount } from './prompt';

/*
 * The deterministic Company Intelligence profile (SPEC §32.1, DD-16 step 4; architecture §4.4):
 * zero model calls. Every number comes from DD-17 extraction with its source row, every signal
 * from the enabled DD-18 detectors with evidence for each period, every risk heading verbatim
 * from the latest 10-K, and every sentence of narrative from a fixed template or the labeled
 * General context library. It is the whole det-v<templateVersion> set and the per-company
 * fallback inside the LLM set.
 */

/** `.index/work/extraction/<TICKER>.json` (scripts/ingestion/extract.ts). */
export interface ProfileExtraction {
  indexVersion: string;
  coverage: CompanyCoverage;
  facts: FinancialFact[];
  trends: Trend[];
  drivers: Driver[];
  riskHeadings: Array<{ documentId: string; fiscalLabel: string; periodEnd: string; headings: RiskHeading[] }>;
  latestRiskHeadingsDocument: string | null;
}

export interface AssembleInput {
  extraction: ProfileExtraction;
  /** Every index chunk of this company (the citations are built from them). */
  chunks: readonly ChunkRecord[];
  profileSetId: string;
  builtAt: string;
}

export function deterministicSetId(templateVersion = TEMPLATE_VERSION): string {
  return `det-v${templateVersion}`;
}

const TRAJECTORY_WORD: Record<Trajectory, string> = {
  accelerating: 'Accelerating',
  growing: 'Growing',
  stable: 'Stable',
  slowing: 'Slowing',
  declining: 'Declining',
  improving: 'Improving',
  not_extracted: 'Not extracted',
  limited_history: 'Limited history',
};

/** The signal-detector input built from one company's extraction and chunks (as scripts/evaluation/signal-eval.ts does). */
export function signalInput(extraction: ProfileExtraction, chunks: readonly ChunkRecord[]): CompanySignalInput {
  const docs = new Map<string, ChunkRecord>();
  for (const c of chunks) if (!docs.has(c.documentId)) docs.set(c.documentId, c);
  const headings = new Map(extraction.riskHeadings.map((r) => [r.documentId, r.headings]));
  return {
    ticker: extraction.coverage.ticker,
    company: extraction.coverage.company,
    chunks: [...chunks],
    trends: extraction.trends,
    filings: [...docs.values()].map((c) => ({
      documentId: c.documentId,
      filingType: c.filingType,
      fiscalLabel: c.fiscalLabel,
      fiscalYear: c.fiscalYear,
      periodEnd: c.periodEnd,
      ...(headings.has(c.documentId) ? { headings: headings.get(c.documentId)!.map((h) => ({ heading: h.heading, category: h.category, chunkIds: h.chunkIds })) } : {}),
    })),
  };
}

/**
 * The facts a profile shows: annual and point-in-time values, one per metric and period, from
 * the most recent filing that reports it (later filings carry restatements). Facts that failed a
 * plausibility check (`suspect`) are left out and named in the gaps; quarterly and year-to-date
 * values stay in the extraction (they feed the quarterly trend, which cites them).
 */
export function profileFacts(facts: readonly FinancialFact[]): { kept: FinancialFact[]; suspect: FinancialFact[] } {
  const suspect = facts.filter((f) => f.suspect);
  const best = new Map<string, FinancialFact>();
  for (const f of facts) {
    if (f.suspect || (f.duration !== 'annual' && f.duration !== 'instant')) continue;
    const key = `${f.metric}|${f.period}`;
    const prev = best.get(key);
    if (!prev || f.fiscalLabel > prev.fiscalLabel || (f.fiscalLabel === prev.fiscalLabel && f.documentId > prev.documentId)) best.set(key, f);
  }
  return { kept: [...best.values()].sort((a, b) => a.metric.localeCompare(b.metric) || a.period.localeCompare(b.period)), suspect };
}

/** computeTrends (from the extraction) plus year-over-year growth for a few more metrics, each from one table row (DD-17). */
export function profileTrends(extraction: ProfileExtraction): Trend[] {
  const extra = EXTRA_GROWTH_METRICS.map((m) => growthTrend(extraction.facts, m)).filter((t): t is Trend => t !== null);
  return [...extraction.trends, ...extra];
}

function citationOf(c: ChunkRecord, indexVersion: string): Citation {
  return {
    chunkId: c.chunkId,
    indexVersion,
    ticker: c.ticker,
    company: c.company,
    filingType: c.filingType,
    filingDate: c.filingDate,
    periodEnd: c.periodEnd,
    fiscalLabel: c.fiscalLabel,
    section: c.section,
    documentId: c.documentId,
    charStart: c.charStart,
    charEnd: c.charEnd,
    text: c.text,
  };
}

/** Every chunk ID a profile references, for the citations list (architecture §7.1: server-derived, with passage text). */
export function referencedChunkIds(p: Omit<CompanyIntelligenceProfile, 'citations'>): string[] {
  const ids = [
    ...p.facts.map((f) => f.chunkId),
    ...p.trends.flatMap((t) => t.chunkIds),
    ...p.drivers.flatMap((d) => d.citationIds),
    ...p.currentRisks.flatMap((r) => r.citationIds),
    ...p.signals.flatMap((s) => [...s.citationIds, ...s.evidenceByPeriod.flatMap((e) => e.chunkIds)]),
    ...p.executiveView.flatMap((e) => e.citationIds),
    ...(p.managementOutlook?.citationIds ?? []),
    ...p.recommendedDiligence.flatMap((r) => r.citationIds),
  ];
  return [...new Set(ids)];
}

export function citationsFor(ids: readonly string[], chunks: ReadonlyMap<string, ChunkRecord>, indexVersion: string): Citation[] {
  return ids.map((id) => {
    const c = chunks.get(id);
    if (!c) throw new Error(`profile: chunk ${id} is not in the index`);
    return citationOf(c, indexVersion);
  });
}


function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

interface Pieces {
  company: string;
  /** "Apple" for "Apple Inc": what the templated questions say. */
  shortName: string;
  ticker: string;
  tenK: number;
  tenQ: number;
  trends: CompanyIntelligenceProfile['trends'];
  signals: ProfileSignal[];
  currentRisks: CompanyIntelligenceProfile['currentRisks'];
}

/** A 30-second-view card cites at most this many passages (the evidence drawer has the rest). */
const MAX_VIEW_CITATIONS = 3;

const trendOf = (trends: Pieces['trends'], metric: string) => trends.find((t) => t.metric === metric);

/** The 30-second view (SPEC §8.4): deterministic labels from trajectories, the basis as the summary. */
function executiveView(x: Pieces, tierLabel: string, tierSummary: string): CompanyIntelligenceProfile['executiveView'] {
  const dim = (dimension: string, metric: string, missing: string, subject = metric) => {
    const t = trendOf(x.trends, metric);
    return t
      ? { dimension, label: TRAJECTORY_WORD[t.trajectory], summary: `${subject}: ${t.basis}`, citationIds: t.chunkIds.slice(0, MAX_VIEW_CITATIONS) }
      : { dimension, label: TRAJECTORY_WORD.not_extracted, summary: missing, citationIds: [] };
  };
  const persistent = x.signals.filter((s) => s.type === 'PERSISTENT');
  const risk =
    persistent.length > 0
      ? {
          dimension: 'Risk changes',
          label: 'Persistent',
          summary: `Risks in ${[...new Set(persistent.map((s) => SIGNAL_CATEGORY_LABELS[s.category].toLowerCase()))].join(', ')} appear in each recent annual report; see What’s changed.`,
          citationIds: [...new Set(persistent.flatMap((s) => s.evidenceByPeriod.at(-1)?.chunkIds ?? []))].slice(0, MAX_VIEW_CITATIONS),
        }
      : {
          dimension: 'Risk changes',
          label: x.tenK > 1 ? 'Limited evidence' : 'Limited history',
          summary:
            x.tenK > 1
              ? 'No risk passed the persistence check across annual reports, and new or removed risk detection is not enabled yet; see Current risks for the latest annual report.'
              : 'One annual report in the corpus, so risks cannot be compared across years; see Current risks.',
          citationIds: [],
        };
  return [
    dim('Performance', 'Revenue growth', 'Revenue growth could not be extracted from this company’s filings in the index.'),
    dim('Profitability', 'Operating margin', 'Operating margin could not be extracted from this company’s filings in the index.'),
    dim('Latest quarter', 'Quarterly revenue growth', 'Year-over-year revenue growth for the latest quarter could not be extracted from the latest quarterly report.', 'Revenue in the latest quarter'),
    dim('Cash generation', 'Operating cash flow', 'Operating cash flow growth could not be extracted from this company’s filings in the index.'),
    risk,
    { dimension: 'Evidence coverage', label: tierLabel, summary: tierSummary, citationIds: [] },
  ];
}

/**
 * Templated recommendations: one per signal, then one per remaining risk area of the latest 10-K.
 * They name the company by its short name ("Apple", not "Apple Inc’s") and mention the latest
 * quarterly report only when the corpus has one (templateVersion 2).
 */
function recommendations(x: Pieces): CompanyIntelligenceProfile['recommendedDiligence'] {
  const out: CompanyIntelligenceProfile['recommendedDiligence'] = [];
  const name = x.shortName;
  for (const s of x.signals.filter((s) => s.type === 'TREND_CHANGE')) {
    const subject = s.headline.replace(/ (improved|declined|slowed|accelerated|turned to decline) in .*$/i, '').toLowerCase();
    out.push({
      question:
        x.tenQ > 0
          ? `What does ${name} say is behind the change in its ${subject}, and does the latest quarterly report show it continuing?`
          : `What does ${name} say is behind the change in its ${subject}, and does it expect the change to continue?`,
      why:
        x.tenQ > 0
          ? `${s.headline}; the annual report’s discussion of results and the latest quarterly report show whether the cause is lasting.`
          : `${s.headline}; the annual report’s discussion of results shows what management says caused it.`,
      signalIds: [s.signalId],
      citationIds: s.citationIds,
      tickers: [x.ticker],
    });
  }
  const covered = new Set<SignalCategory>();
  for (const s of x.signals.filter((s) => s.type === 'PERSISTENT')) {
    if (covered.has(s.category)) continue;
    covered.add(s.category);
    const area = SIGNAL_CATEGORY_LABELS[s.category].toLowerCase();
    out.push({
      question: `How has ${name}’s description of its ${area} risk changed over the annual reports in which it appears, and what does management say it is doing about it?`,
      why: `A ${area} risk appears in each recent annual report; comparing the wording across years shows whether it is growing or being managed down.`,
      signalIds: [s.signalId],
      citationIds: s.evidenceByPeriod.at(-1)?.chunkIds ?? s.citationIds,
      tickers: [x.ticker],
    });
  }
  const seen = new Set<SignalCategory>(covered);
  for (const r of x.currentRisks) {
    if (out.length >= 6) break;
    if (!r.category || seen.has(r.category)) continue;
    seen.add(r.category);
    const area = SIGNAL_CATEGORY_LABELS[r.category].toLowerCase();
    out.push({
      question:
        x.tenK > 1
          ? `How has ${name}’s discussion of ${area} risk changed across its annual reports, and what does management say it is doing about it?`
          : `What does ${name} say it is doing to manage its ${area} risk, and what does its annual report leave unanswered?`,
      why:
        x.tenK > 1
          ? `The latest annual report discusses a ${area} risk, and earlier annual reports are available to show whether it is new, growing or long-standing.`
          : `The latest annual report discusses a ${area} risk; it is the only annual report available, so the question focuses on management’s response.`,
      signalIds: [],
      citationIds: r.citationIds,
      tickers: [x.ticker],
    });
  }
  return out.slice(0, 6);
}

/** Deterministic evidence levels per category (SPEC §19): counts of extracted items, never model text. */
function byCategory(facts: number, trends: Pieces['trends'], x: Pieces): CompanyIntelligenceProfile['coverage']['byCategory'] {
  const counts = new Map<SignalCategory, number>();
  const add = (c: SignalCategory, n: number) => counts.set(c, (counts.get(c) ?? 0) + n);
  if (facts > 0) add('performance', facts >= 6 ? 3 : facts >= 2 ? 2 : 1);
  // Revenue growth labels two rows ("Revenue" and "Revenue growth", metrics.ts): one trend, counted once.
  const growthRow = trends.find((t) => t.metric === 'Revenue growth');
  for (const t of trends) {
    if (t.metric === 'Revenue' && growthRow && growthRow.basis === t.basis) continue;
    if (/growth|Revenue$/.test(t.metric)) add('growth', 1);
    if (/margin/i.test(t.metric)) add('margin', 1);
    if (t.metric === 'Operating cash flow') add('liquidity', 1);
  }
  for (const r of x.currentRisks) if (r.category) add(r.category, 1);
  for (const s of x.signals) add(s.category, 2);
  return [...counts.entries()].map(([category, n]) => ({ category, level: n >= 3 ? ('strong' as const) : n === 2 ? ('partial' as const) : ('limited' as const) }));
}

const TIER_COPY = {
  deep: { label: 'Deep coverage', summary: 'Several years of annual reports and the quarterly reports between them.' },
  partial: { label: 'Partial coverage', summary: 'Recent annual and quarterly reports; filing-to-filing changes where comparable filings exist.' },
  limited_history: { label: 'Limited history', summary: 'Limited history: one annual report in the corpus.' },
} as const;

export function assembleDeterministicProfile({ extraction, chunks, profileSetId, builtAt }: AssembleInput): CompanyIntelligenceProfile {
  const cov = extraction.coverage;
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));
  const { kept, suspect } = profileFacts(extraction.facts);

  const facts: CompanyIntelligenceProfile['facts'] = kept.map((f) => ({
    metric: FACT_LABEL[f.metric],
    period: f.period,
    value: f.value,
    unit: f.unit,
    scale: f.scale as 1 | 1e3 | 1e6 | 1e9,
    chunkId: f.chunkId,
    rawRow: f.rawRow,
    crossCheck: f.crossCheck,
  }));

  const trends: CompanyIntelligenceProfile['trends'] = profileTrends(extraction).flatMap((t) =>
    (TREND_LABELS[t.metric] ?? []).map((metric) => ({ metric, trajectory: t.trajectory, basis: t.basis, periods: t.periods, chunkIds: t.chunkIds })),
  );

  const drivers: CompanyIntelligenceProfile['drivers'] = extraction.drivers.map((d: Driver) => {
    const [p0, p1] = d.periods;
    const [v0, v1] = d.values;
    const direction = d.change > 0 ? 'rose' : d.change < 0 ? 'fell' : 'was unchanged';
    return {
      label: d.label,
      metric: 'Revenue',
      periods: [...d.periods],
      changeBasis: `${formatFactAmount(v0!, d.scale)} in ${p0} to ${formatFactAmount(v1!, d.scale)} in ${p1} (${d.changePct === null ? 'no prior-year value' : `${d.changePct >= 0 ? '+' : ''}${pct(d.changePct)}`}); ${pct(d.share)} of revenue in ${p1}.`,
      explanation: `${d.label} revenue ${direction} between ${p0} and ${p1}, one of the largest reported changes among the revenue lines in the annual report’s discussion of results.`,
      citationIds: [d.chunkId],
    };
  });

  const latest = extraction.riskHeadings.find((r) => r.documentId === extraction.latestRiskHeadingsDocument);
  const currentRisks: CompanyIntelligenceProfile['currentRisks'] = (latest?.headings ?? []).map((h) => ({
    category: h.category,
    heading: h.heading,
    plainLabel: h.category ? SIGNAL_CATEGORY_LABELS[h.category] : OTHER_RISKS_LABEL,
    rank: h.rank,
    citationIds: h.chunkIds,
  }));

  const candidates: SignalCandidate[] = detectCompanySignals(signalInput(extraction, chunks), { status: DETECTOR_STATUS });
  const signals: ProfileSignal[] = candidates
    .filter((c): c is SignalCandidate & { category: SignalCategory } => c.category !== null)
    .map((c) => ({
      signalId: c.signalId,
      type: c.type,
      category: c.category,
      periods: c.periods,
      measurement: c.measurement,
      evidenceByPeriod: c.evidenceByPeriod,
      investigateQuestion: c.investigateQuestion,
      headline: c.headline,
      whatChanged: WHAT_CHANGED_TEMPLATE[c.type],
      whyThisMatters: GENERAL_CONTEXT[c.category],
      whyThisMattersSource: 'general_context' as const,
      citationIds: [...new Set(c.evidenceByPeriod.flatMap((e) => e.chunkIds))],
    }));

  const pieces: Pieces = { company: cov.company, shortName: stripCorporateSuffix(cov.company) || cov.company, ticker: cov.ticker, tenK: cov.tenK, tenQ: cov.tenQ, trends, signals, currentRisks };
  const tier = TIER_COPY[cov.tier];

  const missing = (['revenue', 'operating_income', 'net_income', 'operating_cash_flow', 'cash_and_equivalents', 'total_debt'] as const).filter(
    (m) => !kept.some((f) => f.metric === m),
  );
  const gaps = [
    ...(cov.tier === 'limited_history' ? ['Limited history: one annual report in the corpus, so nothing can be compared across annual reports.'] : []),
    ...(missing.length ? [`Not extracted from the filings in the index: ${missing.map((m) => FACT_LABEL[m].toLowerCase()).join(', ')}.`] : []),
    ...(suspect.length
      ? [`Left out after a plausibility check: ${[...new Set(suspect.map((f) => `${FACT_LABEL[f.metric].toLowerCase()} ${f.period}`))].join(', ')} (the figure did not fit the same filing’s revenue).`]
      : []),
    ...(currentRisks.length === 0 ? ['No risk headings could be extracted from the latest annual report.'] : []),
    'Risk headings are extracted by a deterministic rule and can miss a heading or include a sentence that is not one.',
    'New, removed and expanded risks and changes in management’s outlook are not detected yet; only persistent risks and changes in reported trends are.',
    // Only the model writes an outlook; mergeProfile drops this line when it does.
    'Management outlook is not summarized in this set.',
  ];

  const draft: Omit<CompanyIntelligenceProfile, 'citations'> = {
    ticker: cov.ticker,
    company: cov.company,
    sector: cov.sector,
    version: {
      indexVersion: extraction.indexVersion,
      profileSetId,
      templateVersion: TEMPLATE_VERSION,
      builtAt,
      periodsCovered: cov.annualPeriods.map((p) => p.periodEnd),
    },
    fiscalYearEnd: cov.fiscalYearEnd,
    coverage: { tier: cov.tier, filings: cov.filings, tenK: cov.tenK, tenQ: cov.tenQ, byCategory: byCategory(facts.length, trends, pieces) },
    facts,
    trends,
    drivers,
    currentRisks,
    signals,
    executiveView: executiveView(pieces, tier.label, tier.summary),
    managementOutlook: null,
    recommendedDiligence: recommendations(pieces),
    gaps,
    generation: { mode: 'deterministic', generationCallCount: 0, validation: { invalidCitations: 0, unsupportedFigures: 0, bannedPhrases: 0 } },
  };
  const profile = CompanyIntelligenceProfileSchema.parse({ ...draft, citations: citationsFor(referencedChunkIds(draft), byId, extraction.indexVersion) });
  const issues = profileIntegrityIssues(profile);
  if (issues.length) throw new Error(`deterministic profile ${cov.ticker}: ${issues.join('; ')}`);
  return profile;
}


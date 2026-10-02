#!/usr/bin/env -S pnpm exec tsx
/**
 * Signal go/no-go evaluation (Phase 3; DD-18; assumptions G4). Runs the deterministic
 * detectors over every consecutive 10-K pair of AAPL, MSFT and NVDA and judges each candidate
 * against the hand labels (packages/rag/src/signals/testing/signal-labels.ts; the FY2025
 * headings come from packages/corpus/src/testing/risk-headings-golden.ts). TREND_CHANGE is
 * judged against hand-read income-statement values (testing/trend-labels.ts), at two as-of
 * points: the extraction outputs (as of FY2025) and the corpus re-extracted without filings after
 * the FY2024 10-K (as of FY2024). Prints precision and recall per detector against the bar
 * (precision ≥ 0.8, recall ≥ 0.5, at least MIN_DECIDED decided; a null recall fails). Also
 * reports heading-diff viability over all deep-tier companies (how many NEW / REDUCED candidates
 * per pair, a noise indicator where no labels exist).
 *
 *   pnpm eval:signals             # needs `pnpm extract` outputs, the built index and the corpus; no AWS
 *
 * Writes `evals/results/signals-<indexVersion>.json` and `.md`.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkFiling, computeTrends, defaultCorpusPath, extractCompanyFacts, loadCorpus, processFilings } from '@diligenceiq/corpus';
import type { SignalCategory } from '@diligenceiq/core';
import {
  type CompanySignalInput,
  DETECTOR_STATUS,
  type DetectorId,
  type Judged,
  type SignalCandidate,
  detectCompanySignals,
  MIN_DECIDED,
  deriveTrendLabels,
  judge,
  parseChunks,
  scoreDetectors,
} from '@diligenceiq/rag';
import { SIGNAL_LABELS } from '../../packages/rag/src/signals/testing/signal-labels';
import { TREND_STATEMENT_ROWS } from '../../packages/rag/src/signals/testing/trend-labels';
import { BUILD_DIR, EXTRACTION_DIR, INGEST_REPORT, ROOT } from '../lib/common';

const { indexVersion } = JSON.parse(readFileSync(INGEST_REPORT, 'utf8')) as { indexVersion: string };
const chunks = parseChunks(readFileSync(join(BUILD_DIR, indexVersion, 'chunks.jsonl')));
const byTicker = new Map<string, typeof chunks>();
for (const c of chunks) byTicker.set(c.ticker, [...(byTicker.get(c.ticker) ?? []), c]);

interface Extraction {
  indexVersion: string;
  coverage: { ticker: string; company: string; tier: string };
  trends: CompanySignalInput['trends'];
  riskHeadings: Array<{ documentId: string; fiscalLabel: string; periodEnd: string; headings: Array<{ heading: string; category: SignalCategory | null; chunkIds: string[] }> }>;
}

function inputFor(ticker: string): CompanySignalInput {
  const ex = JSON.parse(readFileSync(join(EXTRACTION_DIR, `${ticker}.json`), 'utf8')) as Extraction;
  if (ex.indexVersion !== indexVersion) throw new Error(`${ticker} extraction is for ${ex.indexVersion}, index is ${indexVersion}; rerun pnpm extract`);
  const own = byTicker.get(ticker) ?? [];
  const docs = new Map<string, (typeof own)[number]>();
  for (const c of own) if (!docs.has(c.documentId)) docs.set(c.documentId, c);
  const headings = new Map(ex.riskHeadings.map((r) => [r.documentId, r.headings]));
  return {
    ticker,
    company: ex.coverage.company,
    chunks: own,
    trends: ex.trends,
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

const DETECTORS: DetectorId[] = ['risk_new', 'risk_removed', 'risk_persistent', 'emphasis_up', 'emphasis_down', 'outlook', 'trend'];
const labeled = ['AAPL', 'MSFT', 'NVDA'];
const TREND_LABELS = deriveTrendLabels(TREND_STATEMENT_ROWS);

/** TREND candidates as of an earlier 10-K: the corpus re-extracted without any filing after it. */
const corpus = loadCorpus(defaultCorpusPath(ROOT));
function trendsAsOfPriorTenK(ticker: string): CompanySignalInput['trends'] {
  const raws = corpus.filings.filter((f) => f.file.startsWith(`${ticker}_`));
  const filings = processFilings(raws);
  const ks = filings.filter((f) => f.meta.filingType === '10-K').sort((a, b) => a.meta.periodEnd.localeCompare(b.meta.periodEnd));
  const cutoff = ks.at(-2)!.meta.periodEnd;
  const kept = filings.filter((f) => f.meta.periodEnd <= cutoff);
  const chunks = kept.flatMap((f) => chunkFiling(f.meta, f.text, f.sections));
  return computeTrends(extractCompanyFacts(kept, chunks));
}

const candidates: SignalCandidate[] = [];
const judged: Judged[] = [];
for (const t of labeled) {
  const input = inputFor(t);
  // Every consecutive pair for the labels, and PERSISTENT/TREND as the dashboard would emit them.
  const cands = [...detectCompanySignals(input, { pairs: 'all', includeSuppressed: true })];
  // A second as-of point for TREND_CHANGE (the dashboard as it would have read after the prior 10-K).
  cands.push(...detectCompanySignals({ ...input, filings: [], chunks: [], trends: trendsAsOfPriorTenK(t) }, { includeSuppressed: true }).filter((c) => c.detector === 'trend'));
  candidates.push(...cands);
  for (const c of cands) judged.push(judge(c, SIGNAL_LABELS, TREND_LABELS));
}
const scores = scoreDetectors(judged, SIGNAL_LABELS, DETECTORS, candidates, TREND_LABELS);

console.log(`eval:signals ${indexVersion}: ${candidates.length} candidates for ${labeled.join(', ')} over ${SIGNAL_LABELS.length} labeled pairs`);
for (const s of scores) {
  const status = DETECTOR_STATUS[s.detector];
  console.log(
    `  ${s.detector.padEnd(16)} emitted ${String(s.emitted).padStart(3)}, judged ${String(s.judged).padStart(3)}, correct ${String(s.correct).padStart(3)}, precision ${s.precision === null ? '  n/a' : s.precision.toFixed(2)}, recall ${s.recall === null ? 'n/a' : `${s.found}/${s.labeledPositives} = ${s.recall.toFixed(2)}`} → ${s.verdict}; configured ${status.enabled ? 'ENABLED' : 'suppressed'}`,
  );
  if (s.links) console.log(`      links: ${s.links.labeled}/${s.links.total} labeled, ${s.links.held} held (link precision ${s.links.precision?.toFixed(2) ?? 'n/a'}); fully verified candidates ${s.fullyVerified!.correct}/${s.fullyVerified!.judged}; diagnostic recall over all labeled persistent headings ${s.recallAll!.found}/${s.recallAll!.labeledPositives}`);
}
const trendPositives = TREND_LABELS.filter((l) => l.direction !== 'none');
console.log(`  trend labels: ${TREND_LABELS.length} (${trendPositives.length} real changes): ${trendPositives.map((l) => `${l.ticker} ${l.asOf} ${l.metric} ${l.direction}`).join(', ')}`);
for (const j of judged.filter((x) => x.correct === false)) console.log(`    ✗ ${j.candidate.detector} ${j.candidate.ticker} ${j.candidate.periods.join('→')}: ${j.candidate.subject.slice(0, 90)} — ${j.why}`);

// Emphasis threshold sensitivity (diagnostic only: six labeled pairs are too few to tune on).
const sensitivity: Array<{ relative: number; absolute: number; up: string; down: string }> = [];
for (const relative of [0.1, 0.2, 0.3]) {
  for (const absolute of [0.25, 0.5, 1.0]) {
    const cands: SignalCandidate[] = [];
    for (const t of labeled) cands.push(...detectCompanySignals(inputFor(t), { pairs: 'all', includeSuppressed: true, emphasis: { relative, absolute, minMatches: 5 } }).filter((c) => c.detector.startsWith('emphasis')));
    const js = cands.map((c) => judge(c, SIGNAL_LABELS));
    const sc = scoreDetectors(js, SIGNAL_LABELS, ['emphasis_up', 'emphasis_down'], cands);
    const fmt = (x: (typeof sc)[number]) => `P ${x.precision === null ? 'n/a' : x.precision.toFixed(2)} (${x.correct}/${x.judged}), R ${x.found}/${x.labeledPositives}`;
    sensitivity.push({ relative, absolute, up: fmt(sc[0]!), down: fmt(sc[1]!) });
  }
}
console.log(`  emphasis sensitivity: ${sensitivity.map((x) => `[${x.relative}/${x.absolute}] up ${x.up}; down ${x.down}`).join(' | ')}`);

// Heading-diff viability (G4) over all deep and partial companies with ≥ 2 10-Ks: candidates per pair.
const viability: Array<{ ticker: string; pairs: number; headingsLatest: number; newPerPair: number; removedPerPair: number }> = [];
for (const f of readdirSync(EXTRACTION_DIR).filter((x) => /^[A-Z]+\.json$/.test(x))) {
  const t = f.replace('.json', '');
  const input = inputFor(t);
  const ks = input.filings.filter((x) => x.filingType === '10-K').length;
  if (ks < 2) continue;
  const c = detectCompanySignals(input, { pairs: 'all', includeSuppressed: true });
  const pairs = ks - 1;
  viability.push({
    ticker: t,
    pairs,
    headingsLatest: input.filings.filter((x) => x.filingType === '10-K').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1)!.headings?.length ?? 0,
    newPerPair: Number((c.filter((x) => x.detector === 'risk_new').length / pairs).toFixed(1)),
    removedPerPair: Number((c.filter((x) => x.detector === 'risk_removed').length / pairs).toFixed(1)),
  });
}
console.log(`  heading-diff viability (candidates per 10-K pair): ${viability.map((v) => `${v.ticker} +${v.newPerPair}/−${v.removedPerPair}`).join(', ')}`);

const outDir = join(ROOT, 'evals', 'results');
mkdirSync(outDir, { recursive: true });
const ranAt = new Date().toISOString();
writeFileSync(
  join(outDir, `signals-${indexVersion}.json`),
  `${JSON.stringify({ indexVersion, ranAt, minDecided: MIN_DECIDED, scores, status: DETECTOR_STATUS, trendLabels: TREND_LABELS, sensitivity, viability, judged: judged.map((j) => ({ signalId: j.candidate.signalId, detector: j.candidate.detector, periods: j.candidate.periods, subject: j.candidate.subject, measurement: j.candidate.measurement, correct: j.correct, why: j.why, ...(j.links ? { links: j.links } : {}) })) }, null, 1)}\n`,
);
const pct = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));
writeFileSync(
  join(outDir, `signals-${indexVersion}.md`),
  [
    `# Signal go/no-go — ${indexVersion}`,
    '',
    `Generated by \`pnpm eval:signals\` on ${new Date(ranAt).toLocaleDateString('en-CA')} (local). Hand labels: AAPL, MSFT, NVDA, FY2023→FY2024 and FY2024→FY2025 (6 pairs); TREND_CHANGE against hand-read income statements, as of FY2024 and FY2025 (${TREND_LABELS.length} labels, ${trendPositives.length} real changes). Bar: precision ≥ 0.8, recall ≥ 0.5, at least ${MIN_DECIDED} decided candidates; a recall that cannot be measured fails.`,
    '',
    '| Detector | Emitted | Judged | Correct | Precision | Recall (found / labeled) | Verdict | Configured |',
    '|---|---|---|---|---|---|---|---|',
    ...scores.map((s) => `| \`${s.detector}\` | ${s.emitted} | ${s.judged} | ${s.correct} | ${pct(s.precision)} | ${s.recall === null ? 'n/a' : `${s.found}/${s.labeledPositives} = ${pct(s.recall)}`} | ${s.verdict} | ${DETECTOR_STATUS[s.detector].enabled ? 'enabled' : 'suppressed'} |`),
    '',
    ...scores
      .filter((s) => s.links)
      .flatMap((s) => [
        `PERSISTENT chain links: ${s.links!.labeled} of ${s.links!.total} links are hand-labeled; ${s.links!.held} hold (link precision ${pct(s.links!.precision)}). The other ${s.links!.total - s.links!.labeled} links (FY2022→FY2023) are unverified. Diagnostic (not gating): candidates whose every link is labeled are ${s.fullyVerified!.correct}/${s.fullyVerified!.judged} correct (${pct(s.fullyVerified!.precision)}); recall over ALL labeled persistent FY2025 headings is ${s.recallAll!.found}/${s.recallAll!.labeledPositives} (${pct(s.recallAll!.recall)}). The gating recall (${s.found}/${s.labeledPositives}) counts only headings the heading classifier categorizes, because PERSISTENT emits only categorized headings.`,
        '',
      ]),
    '## TREND_CHANGE labels (hand-read income statements)',
    '',
    '| Ticker | As of | Metric | Label | Basis |',
    '|---|---|---|---|---|',
    ...TREND_LABELS.map((l) => `| ${l.ticker} | ${l.asOf} | ${l.metric} | ${l.direction} | ${l.basis} |`),
    '',
    '## Wrong candidates',
    '',
    ...judged.filter((j) => j.correct === false).map((j) => `- \`${j.candidate.detector}\` ${j.candidate.ticker} ${j.candidate.periods.join('→')}: ${j.candidate.subject.slice(0, 120)} — ${j.why}`),
    '',
    '## Emphasis threshold sensitivity (diagnostic; not used to tune)',
    '',
    '| Relative | Absolute (per 10K chars) | EXPANDED | REDUCED |',
    '|---|---|---|---|',
    ...sensitivity.map((x) => `| ${x.relative * 100}% | ${x.absolute} | ${x.up} | ${x.down} |`),
    '',
    '## Heading-diff viability (all companies with two or more 10-Ks; candidates per pair)',
    '',
    '| Ticker | 10-K pairs | Latest headings | NEW per pair | REDUCED per pair |',
    '|---|---|---|---|---|',
    ...viability.map((v) => `| ${v.ticker} | ${v.pairs} | ${v.headingsLatest} | ${v.newPerPair} | ${v.removedPerPair} |`),
    '',
  ].join('\n'),
);
console.log(`  wrote evals/results/signals-${indexVersion}.json and .md`);

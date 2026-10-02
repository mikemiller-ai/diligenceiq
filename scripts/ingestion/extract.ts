#!/usr/bin/env -S pnpm exec tsx
/**
 * Deterministic extraction (SPEC §24.2 step 11; DD-17; time-boxed in Phase 2): financial
 * facts with cross-checks, trends with their thresholds, drivers, risk headings for every
 * 10-K, and per-company coverage. No model calls. Reads CORPUS_PATH; writes
 * `.index/work/extraction/<TICKER>.json` and `.index/work/extraction/summary.json`.
 *
 *   pnpm extract
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  METRICS,
  chunkFiling,
  companyCoverage,
  computeTrends,
  defaultCorpusPath,
  extractCompanyFacts,
  extractDrivers,
  extractRiskHeadings,
  loadCorpus,
  processFilings,
} from '@diligenceiq/corpus';
import { EXTRACTION_DIR, ROOT, ensureDir, indexVersionForChunks } from '../lib/common';

const t0 = performance.now();
const corpus = loadCorpus(defaultCorpusPath(ROOT));
const filings = processFilings(corpus.filings);
const version = indexVersionForChunks(filings.flatMap((f) => chunkFiling(f.meta, f.text, f.sections)));
const coverage = companyCoverage(filings.map((f) => f.meta));

rmSync(EXTRACTION_DIR, { recursive: true, force: true });
ensureDir(EXTRACTION_DIR);

const rows: Array<Record<string, unknown>> = [];
for (const company of coverage) {
  const own = filings.filter((f) => f.meta.ticker === company.ticker);
  const chunks = own.flatMap((f) => chunkFiling(f.meta, f.text, f.sections));
  const facts = extractCompanyFacts(own, chunks);
  const tenKs = own.filter((f) => f.meta.filingType === '10-K').sort((a, b) => a.meta.periodEnd.localeCompare(b.meta.periodEnd));
  const latest = tenKs.at(-1)!;
  const riskHeadings = tenKs.map((f) => ({
    documentId: f.meta.documentId,
    fiscalLabel: f.meta.fiscalLabel,
    periodEnd: f.meta.periodEnd,
    headings: extractRiskHeadings(f, chunks),
  }));
  const drivers = extractDrivers(latest, chunks);
  const trends = computeTrends(facts);
  const annual = (m: string) => [...new Set(facts.filter((f) => !f.suspect && f.metric === m && (f.duration === 'annual' || f.duration === 'instant') && /^FY\d{4}$/.test(f.period)).map((f) => f.period))].sort();
  const metricCoverage = Object.fromEntries(METRICS.map((m) => [m, annual(m)]));
  writeFileSync(
    join(EXTRACTION_DIR, `${company.ticker}.json`),
    JSON.stringify({ indexVersion: version, coverage: company, facts, trends, drivers, riskHeadings, latestRiskHeadingsDocument: latest.meta.documentId }, null, 1),
  );
  const latestRisks = riskHeadings.at(-1)!.headings;
  rows.push({
    ticker: company.ticker,
    tier: company.tier,
    facts: facts.length,
    mismatches: facts.filter((f) => f.crossCheck === 'mismatch').length,
    suspect: facts.filter((f) => f.suspect).length,
    fromOtherTables: facts.filter((f) => f.source === 'other_table').length,
    metricsWithAnnualValues: METRICS.filter((m) => metricCoverage[m]!.length > 0),
    metricsNotExtracted: METRICS.filter((m) => metricCoverage[m]!.length === 0),
    trends: trends.map((t) => `${t.metric}:${t.trajectory}`),
    drivers: drivers.length,
    latestRiskHeadings: latestRisks.length,
    latestRiskHeadingsClassified: latestRisks.filter((h) => h.category).length,
    riskHeadingsUncited: latestRisks.filter((h) => h.chunkIds.length === 0).length,
  });
}
writeFileSync(join(EXTRACTION_DIR, 'summary.json'), JSON.stringify({ indexVersion: version, companies: rows }, null, 2));

const count = (k: string, pred: (r: Record<string, unknown>) => boolean) => `${k} ${rows.filter(pred).length}/${rows.length}`;
console.log(`extract: ${rows.length} companies in ${Math.round(performance.now() - t0)} ms → ${EXTRACTION_DIR}`);
console.log(`  facts ${rows.reduce((a, r) => a + (r.facts as number), 0)}, cross-filing mismatches ${rows.reduce((a, r) => a + (r.mismatches as number), 0)}`);
for (const m of METRICS) console.log(`  ${count(m, (r) => (r.metricsWithAnnualValues as string[]).includes(m))} companies with annual values`);
console.log(`  ${count('revenue growth trend', (r) => (r.trends as string[]).some((t) => t.startsWith('revenue_growth')))}`);
console.log(`  ${count('drivers', (r) => (r.drivers as number) > 0)}`);
console.log(`  ${count('latest-10-K risk headings', (r) => (r.latestRiskHeadings as number) > 0)}; total ${rows.reduce((a, r) => a + (r.latestRiskHeadings as number), 0)}`);

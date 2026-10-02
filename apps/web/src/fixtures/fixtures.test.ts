import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CitationSchema,
  CompanyIntelligenceProfileSchema,
  DiligenceBriefSchema,
  isPlaceholder,
  profileIntegrityIssues,
} from '@diligenceiq/core';
import { chunkFiling, extractRiskHeadings, loadCorpus, processFilings, sectionAt } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { SAMPLE_ANALYSES, TEST_PASSAGES } from '@/test/sample-analyses';
import riskHeadingsJson from './generated/risk-headings.json';
import { FILINGS, PASSAGES, companies, featuredCompanies } from './index';
import { FIXTURE_PROFILES, TIER_COPY } from './profiles';

interface RiskHeadingsFile {
  companies: Array<{ ticker: string; documentId: string; fiscalLabel: string; headings: Array<{ heading: string; category: string | null; rank: number; chunkIds: string[] }> }>;
}
const RISK_HEADINGS = riskHeadingsJson as RiskHeadingsFile;

/** The latest annual report (10-K) row for a ticker. */
const latestTenK = (ticker: string) =>
  FILINGS.filter((f) => f.ticker === ticker && f.filingType === '10-K').sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).at(-1);

const INLINE = /\[([A-Z0-9][A-Z0-9.-]*-[A-Z0-9]+)\]/g;
const DIGIT = /\d/;

describe('corpus fixtures', () => {
  it('has one row per corpus filing with unique document IDs', () => {
    expect(FILINGS).toHaveLength(246);
    expect(new Set(FILINGS.map((f) => f.documentId)).size).toBe(246);
    expect(new Set(FILINGS.map((f) => f.ticker)).size).toBe(54);
    for (const f of FILINGS) expect(f.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('computes the SPEC §8.5 coverage tiers from the filing rows', () => {
    const tiers = companies().map((c) => c.tier);
    expect(tiers.filter((t) => t === 'deep')).toHaveLength(12);
    expect(tiers.filter((t) => t === 'partial')).toHaveLength(5);
    expect(tiers.filter((t) => t === 'limited_history')).toHaveLength(37);
    expect(featuredCompanies()[0]?.ticker).toBe('AAPL');
    expect(featuredCompanies().map((c) => c.ticker).sort()).toEqual(
      ['AAPL', 'AMZN', 'DIS', 'GOOG', 'JNJ', 'KO', 'MSFT', 'NVDA', 'PFE', 'TSLA', 'UNH', 'XOM'],
    );
    expect(companies().find((c) => c.ticker === 'GE')?.outsideWindow).toBe(true);
  });

  it('the app ships only passages a fixture profile cites; test-only passages stay in src/test', () => {
    // Regression (adversary finding 14): the test-only brief's passages appeared in /sources/filing
    // as "passages the workspace cites".
    const cited = new Set([...FIXTURE_PROFILES.values()].flatMap((p) => p.citations.map((c) => c.chunkId)));
    expect(PASSAGES.map((p) => p.chunkId).filter((id) => !cited.has(id))).toEqual([]);
    const testIds = new Set(TEST_PASSAGES.map((p) => p.chunkId));
    expect(TEST_PASSAGES.length).toBeGreaterThan(0);
    expect(PASSAGES.filter((p) => testIds.has(p.chunkId))).toEqual([]);
  });

  it('every passage is a valid citation whose span matches its text and filing', () => {
    for (const p of [...PASSAGES, ...TEST_PASSAGES]) {
      expect(CitationSchema.safeParse(p).success).toBe(true);
      expect(p.charEnd - p.charStart).toBe(p.text.length);
      const filing = FILINGS.find((f) => f.documentId === p.documentId);
      expect(filing?.ticker).toBe(p.ticker);
      expect(filing?.periodEnd).toBe(p.periodEnd);
    }
  });

  // Proves the passages are real filing text, not invented. Needs the corpus (gitignored).
  // App passages are real index chunks: exact slices of the PROCESSED filing text
  // (@diligenceiq/corpus processFilings), and the chunker reproduces each one byte for byte, in
  // the Risk Factors section. Test-only passages are slices of the raw corpus file.
  const corpus = resolve(process.env.CORPUS_PATH ?? join(__dirname, '../../../../edgar_corpus'));
  const haveCorpus = existsSync(corpus);
  // Under REQUIRE_CORPUS=1 (`pnpm gate`) a missing corpus is a failure, never a silent skip.
  if (!haveCorpus && process.env.REQUIRE_CORPUS === '1') {
    throw new Error(`fixtures.test: REQUIRE_CORPUS=1 but the corpus is not at ${corpus}; set CORPUS_PATH or restore edgar_corpus/`);
  }
  if (!haveCorpus) console.warn(`fixtures.test: corpus not found at ${corpus}; skipping exact-slice and re-extraction checks`);
  const processed = haveCorpus
    ? (() => {
        const tickers = [...FIXTURE_PROFILES.keys()];
        const raws = loadCorpus(corpus).filings.filter((f) => tickers.some((t) => f.file.startsWith(`${t}_`)));
        return new Map(processFilings(raws).map((f) => [f.meta.documentId, f]));
      })()
    : new Map();

  it.skipIf(!haveCorpus)('every passage, app and test-only, is an exact slice of its corpus filing', () => {
    expect(PASSAGES.length).toBeGreaterThan(0);
    for (const p of PASSAGES) {
      const filing = processed.get(p.documentId);
      expect(filing, p.chunkId).toBeDefined();
      expect(filing!.text.slice(p.charStart, p.charEnd), p.chunkId).toBe(p.text);
      // The chunker produces this exact chunk under this ID: the app cites the index's own chunks.
      const chunk = chunkFiling(filing!.meta, filing!.text, filing!.sections).find((c) => c.chunkId === p.chunkId);
      expect(chunk && { charStart: chunk.charStart, charEnd: chunk.charEnd, text: chunk.text, section: chunk.section }, p.chunkId).toEqual({
        charStart: p.charStart,
        charEnd: p.charEnd,
        text: p.text,
        section: p.section,
      });
    }
    for (const p of TEST_PASSAGES) {
      const text = readFileSync(join(corpus, `${p.documentId}_full.txt`), 'utf8');
      expect(text.slice(p.charStart, p.charEnd)).toBe(p.text);
    }
  });

  it.skipIf(!haveCorpus)('each preview profile holds exactly the rule’s extracted risk headings for the latest 10-K', () => {
    for (const p of FIXTURE_PROFILES.values()) {
      const doc = latestTenK(p.ticker)!.documentId;
      const filing = processed.get(doc)!;
      const extracted = extractRiskHeadings(filing, chunkFiling(filing.meta, filing.text, filing.sections));
      expect(
        p.currentRisks.map((r) => ({ heading: r.heading, category: r.category, rank: r.rank, citationIds: r.citationIds })),
        p.ticker,
      ).toEqual(extracted.map((h) => ({ heading: h.heading, category: h.category, rank: h.rank, citationIds: h.chunkIds })));
      // Each heading's first cited chunk lies in the filing's Risk Factors section.
      for (const r of p.currentRisks) {
        const first = p.citations.find((c) => c.chunkId === r.citationIds[0])!;
        expect(sectionAt(filing.sections, first.charStart).code, r.heading).toBe('1A');
        expect(sectionAt(filing.sections, first.charEnd - 1).code, r.heading).toBe('1A');
      }
    }
  });
});

describe('fixture profiles: no figures and no narrative presented as fact', () => {
  const profiles = [...FIXTURE_PROFILES.values()];

  it('exist for AAPL, MSFT and NVDA, validate, and pass the integrity checks', () => {
    expect([...FIXTURE_PROFILES.keys()]).toEqual(['AAPL', 'MSFT', 'NVDA']);
    for (const p of profiles) {
      expect(CompanyIntelligenceProfileSchema.safeParse(p).success, p.ticker).toBe(true);
      expect(profileIntegrityIssues(p), p.ticker).toEqual([]);
      expect(p.generation).toMatchObject({ mode: 'deterministic', generationCallCount: 0 });
      expect(p.version.profileSetId).toBe('fixture-v2');
      expect(p.version.templateVersion).toBe('fixture-2');
    }
  });

  it('AAPL lists the complete extracted heading list, not a hand-picked handful', () => {
    expect(FIXTURE_PROFILES.get('AAPL')!.currentRisks.length).toBeGreaterThanOrEqual(25);
  });

  it('carry no extracted values or model-written content', () => {
    for (const p of profiles) {
      expect(p.facts, p.ticker).toEqual([]);
      expect(p.trends, p.ticker).toEqual([]);
      expect(p.drivers, p.ticker).toEqual([]);
      expect(p.signals, p.ticker).toEqual([]);
      expect(p.managementOutlook, p.ticker).toBeNull();
    }
  });

  it('use only verbatim filing text, the coverage template, or labeled placeholders', () => {
    for (const p of profiles) {
      // Current risks: the heading is the filing's own text, verbatim in its cited chunk (not a
      // paraphrase), and that chunk is a Risk Factors (Item 1A) chunk of the latest 10-K.
      const latest = latestTenK(p.ticker)!;
      for (const r of p.currentRisks) {
        expect(r.citationIds.length, r.heading).toBeGreaterThan(0);
        for (const id of r.citationIds) {
          const cited = p.citations.find((c) => c.chunkId === id);
          expect(cited?.text.includes(r.heading), `${id}: ${r.heading}`).toBe(true);
          expect(cited?.documentId, id).toBe(latest.documentId);
        }
        const first = p.citations.find((c) => c.chunkId === r.citationIds[0])!;
        expect(first.chunkId, r.heading).toMatch(new RegExp(`^${p.ticker}-${first.fiscalLabel}-10K-1A-\\d{3}$`));
        expect(first.section, r.heading).toBe('Item 1A — Risk Factors');
      }
      // The complete extracted list for that ticker, in rank order (not a selection).
      const file = RISK_HEADINGS.companies.find((c) => c.ticker === p.ticker)!;
      expect(file.documentId).toBe(latest.documentId);
      expect(p.currentRisks.map((r) => r.heading), p.ticker).toEqual(file.headings.map((h) => h.heading));
      expect(p.currentRisks.map((r) => r.rank), p.ticker).toEqual(file.headings.map((_, i) => i + 1));
      expect(p.currentRisks.map((r) => r.citationIds), p.ticker).toEqual(file.headings.map((h) => h.chunkIds));
      for (const e of p.executiveView) {
        if (e.dimension === 'Evidence coverage') expect(e.summary).toBe(TIER_COPY[p.coverage.tier].summary);
        else expect(isPlaceholder(e.summary), `${p.ticker} ${e.dimension}`).toBe(true);
      }
      // A preview profile says its headings come from a rule that can miss some, and that it draws
      // no cross-company comparison (regression, adversary finding 1: never implies completeness).
      expect(p.gaps[0], p.ticker).toMatch(/extracted by a deterministic rule from the latest annual report and can miss some headings and include a sentence that is not a heading; comparisons between companies wait for the full profile build/);
      // Every recommendation cites the current risk it was templated from (regression, finding 7):
      // one per distinct classified area, citing that area's first heading's chunks.
      const areas = [...new Set(p.currentRisks.flatMap((x) => (x.category ? [x.category] : [])))];
      expect(p.recommendedDiligence.length, p.ticker).toBe(areas.length);
      p.recommendedDiligence.forEach((r, i) => {
        const first = p.currentRisks.find((x) => x.category === areas[i])!;
        expect(r.citationIds, r.question).toEqual(first.citationIds);
        expect(r.question.toLowerCase(), r.question).toContain(first.plainLabel.toLowerCase());
      });
      // Templated text never states a figure.
      for (const text of [...p.recommendedDiligence.flatMap((r) => [r.question, r.why]), ...p.gaps, ...p.executiveView.map((e) => e.summary)]) {
        expect(DIGIT.test(text), text).toBe(false);
      }
    }
  });
});

describe('no hand-written answers in the application', () => {
  it('the test-only sample brief is valid and cites only its own context', () => {
    for (const a of SAMPLE_ANALYSES) {
      if (!a.brief) continue;
      expect(DiligenceBriefSchema.safeParse(a.brief).success).toBe(true);
      const ctx = new Set(a.context.map((c) => c.chunkId));
      const ids = [
        ...a.brief.keyFindings.flatMap((k) => k.citationIds),
        ...a.brief.investmentConsiderations.flatMap((c) => c.citationIds),
        ...(a.brief.comparison?.rows.flatMap((r) => r.citationIds) ?? []),
        ...[...a.brief.executiveSummary.matchAll(INLINE)].map((m) => m[1]),
      ];
      for (const id of ids) expect(ctx.has(id ?? ''), `${a.analysisId} cites ${id}`).toBe(true);
    }
  });

  it('application code never imports the test-only fixtures', () => {
    const src = resolve(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== 'test') walk(path);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          if (/@\/test\/|\.\.?\/test\//.test(readFileSync(path, 'utf8'))) offenders.push(relative(src, path));
        }
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });
});

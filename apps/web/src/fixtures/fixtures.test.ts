import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  CitationSchema,
  CompanyIntelligenceProfileSchema,
  DiligenceBriefSchema,
  isPlaceholder,
  profileIntegrityIssues,
} from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_ANALYSES, TEST_PASSAGES } from '@/test/sample-analyses';
import { FILINGS, PASSAGES, companies, featuredCompanies } from './index';
import { FIXTURE_PROFILES, TIER_COPY } from './profiles';

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
  const corpus = resolve(process.env.CORPUS_PATH ?? join(__dirname, '../../../../edgar_corpus'));
  const haveCorpus = existsSync(corpus);
  if (!haveCorpus) console.warn(`fixtures.test: corpus not found at ${corpus}; skipping exact-slice check`);
  it.skipIf(!haveCorpus)('every passage, app and test-only, is an exact slice of its corpus filing', () => {
    for (const p of [...PASSAGES, ...TEST_PASSAGES]) {
      const text = readFileSync(join(corpus, `${p.documentId}_full.txt`), 'utf8');
      expect(text.slice(p.charStart, p.charEnd)).toBe(p.text);
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
      expect(p.version.profileSetId).toBe('fixture-v1');
    }
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
      // Current risks: the heading is verbatim in its cited passage (integrity check) and the
      // passage starts with it, so it is the filing's own heading, not a paraphrase.
      for (const r of p.currentRisks) {
        const cited = p.citations.find((c) => c.chunkId === r.citationIds[0]);
        expect(cited?.text.startsWith(r.heading), r.heading).toBe(true);
      }
      for (const e of p.executiveView) {
        if (e.dimension === 'Evidence coverage') expect(e.summary).toBe(TIER_COPY[p.coverage.tier].summary);
        else expect(isPlaceholder(e.summary), `${p.ticker} ${e.dimension}`).toBe(true);
      }
      // A fixture holds a selection of headings and says so (regression, adversary finding 1).
      expect(p.gaps.join(' '), p.ticker).toMatch(/selection from the latest annual report, not its complete list/);
      // Every recommendation cites the current risk it was templated from (regression, finding 7).
      for (const r of p.recommendedDiligence) {
        expect(r.citationIds.length, r.question).toBeGreaterThan(0);
        expect(p.currentRisks.some((x) => x.citationIds.some((id) => r.citationIds.includes(id))), r.question).toBe(true);
      }
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

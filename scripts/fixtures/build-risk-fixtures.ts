#!/usr/bin/env -S pnpm exec tsx
/**
 * Preview-profile risk headings for the web app (Phase 2): the COMPLETE extracted list of
 * the latest 10-K's risk headings for AAPL, MSFT and NVDA, replacing the Phase 1 hand-picked
 * selection. Each heading cites the real index chunk(s) that contain it, with the chunk's
 * verbatim text, so the app's citations are the index's own (same chunk IDs, same
 * indexVersion). The output is committed because the corpus is gitignored and the Amplify
 * build never sees it.
 *
 *   pnpm fixtures:risks
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Citation } from '@diligenceiq/core';
import { chunkFiling, defaultCorpusPath, extractRiskHeadings, loadCorpus, processFilings } from '@diligenceiq/corpus';
import { ROOT, indexVersionForCorpus } from '../lib/common';

const TICKERS = ['AAPL', 'MSFT', 'NVDA'] as const;
const OUT = join(ROOT, 'apps/web/src/fixtures/generated/risk-headings.json');

const corpus = loadCorpus(defaultCorpusPath(ROOT));
const version = indexVersionForCorpus(corpus.filings);
const filings = processFilings(corpus.filings.filter((f) => TICKERS.some((t) => f.file.startsWith(`${t}_`))));

const passages = new Map<string, Citation>();
const companies = TICKERS.map((ticker) => {
  const own = filings.filter((f) => f.meta.ticker === ticker);
  const latest = own.filter((f) => f.meta.filingType === '10-K').sort((a, b) => a.meta.periodEnd.localeCompare(b.meta.periodEnd)).at(-1)!;
  const chunks = chunkFiling(latest.meta, latest.text, latest.sections);
  const headings = extractRiskHeadings(latest, chunks);
  for (const h of headings) {
    for (const id of h.chunkIds) {
      const c = chunks.find((x) => x.chunkId === id)!;
      passages.set(id, {
        chunkId: c.chunkId,
        indexVersion: version,
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
      });
    }
  }
  return {
    ticker,
    documentId: latest.meta.documentId,
    fiscalLabel: latest.meta.fiscalLabel,
    headings: headings.map((h) => ({ heading: h.heading, group: h.group, category: h.category, rank: h.rank, chunkIds: h.chunkIds })),
  };
});

writeFileSync(OUT, `${JSON.stringify({ indexVersion: version, companies, passages: [...passages.values()] }, null, 1)}\n`);
console.log(`fixtures:risks: ${companies.map((c) => `${c.ticker} ${c.headings.length}`).join(', ')} headings, ${passages.size} passages → ${OUT}`);

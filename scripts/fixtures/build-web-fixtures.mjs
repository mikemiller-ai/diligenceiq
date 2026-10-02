#!/usr/bin/env node
// Builds the web fixtures from the real corpus (read-only, no dependencies):
//   apps/web/src/fixtures/generated/filings.json   one row per filing, from the file headers
//   apps/web/src/test/generated/passages.json      exact filing slices for the test-only sample brief
//                                                  (spec `testPassages`; application code never imports src/test)
// The app's own passages are real index chunks cited by the preview profiles' extracted risk
// headings; they come from scripts/fixtures/build-risk-fixtures.ts (Phase 2), which replaced
// the Phase 1 hand-picked `passages`.
// The outputs are committed because the corpus is gitignored and the Amplify build never sees it.
//   node scripts/fixtures/build-web-fixtures.mjs     # reads $CORPUS_PATH or ./edgar_corpus
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const corpusDir = resolve(process.env.CORPUS_PATH ?? join(root, 'edgar_corpus'));
const outDir = join(root, 'apps/web/src/fixtures/generated');
const testOutDir = join(root, 'apps/web/src/test/generated');
if (!existsSync(corpusDir)) {
  console.error(`build-web-fixtures: corpus directory not found: ${corpusDir} (set CORPUS_PATH)`);
  process.exit(1);
}

// Same period-end precedence as scripts/ingestion/probe-corpus.mjs: header → URL slug → cover page.
const SLUG_DATE = /[-_](\d{4})(\d{2})(\d{2})(?:x10[kq])?\.htm$/i;
const COVER_PERIOD =
  /For\s+the\s+(?:fiscal\s+year|quarterly\s+period)\s+ended\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parseHeader(text) {
  const sep = text.indexOf('\n====');
  const header = {};
  for (const line of (sep === -1 ? '' : text.slice(0, sep)).split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) header[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { header, body: sep === -1 ? text : text.slice(sep) };
}

function periodEnd(header, body) {
  if (header['Report Period']) return header['Report Period'];
  const m = ((header.URL ?? '').split('/').pop() ?? '').match(SLUG_DATE);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const c = body.slice(0, 200_000).match(COVER_PERIOD);
  if (c && MONTHS.includes(c[1])) {
    return `${c[3]}-${String(MONTHS.indexOf(c[1]) + 1).padStart(2, '0')}-${c[2].padStart(2, '0')}`;
  }
  throw new Error(`no period end for ${header.Ticker} ${header['Filing Date']}`);
}

const texts = new Map();
const filings = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.txt'))
  .sort()
  .map((file) => {
    const text = readFileSync(join(corpusDir, file), 'utf8');
    const documentId = file.replace(/_full\.txt$/, '');
    texts.set(documentId, text);
    const { header, body } = parseHeader(text);
    return {
      documentId,
      ticker: header.Ticker,
      company: header.Company,
      filingType: (header['Filing Type'] ?? '').slice(0, 4),
      filingDate: header['Filing Date'],
      periodEnd: periodEnd(header, body),
      characters: text.length,
      sourceUrl: header.URL,
    };
  });

const spec = JSON.parse(readFileSync(join(root, 'scripts/fixtures/passages.spec.json'), 'utf8'));
const byId = new Map(filings.map((f) => [f.documentId, f]));
const slice = (p) => {
  const text = texts.get(p.documentId);
  const filing = byId.get(p.documentId);
  if (!text || !filing) throw new Error(`${p.chunkId}: unknown document ${p.documentId}`);
  // Anchors must be unique unless the spec names which occurrence (1-based) to use.
  const hits = [];
  for (let i = text.indexOf(p.start); i !== -1; i = text.indexOf(p.start, i + 1)) hits.push(i);
  if (hits.length === 0) throw new Error(`${p.chunkId}: start anchor not found`);
  if (hits.length > 1 && p.occurrence === undefined) throw new Error(`${p.chunkId}: start anchor is ambiguous`);
  const start = hits[(p.occurrence ?? 1) - 1];
  if (start === undefined) throw new Error(`${p.chunkId}: occurrence ${p.occurrence} not found`);
  const endAt = text.indexOf(p.end, start);
  if (endAt === -1) throw new Error(`${p.chunkId}: end anchor not found after start`);
  const end = endAt + p.end.length;
  if (end - start > 4000) throw new Error(`${p.chunkId}: passage longer than 4,000 characters`);
  return {
    chunkId: p.chunkId,
    indexVersion: 'fixture-phase1',
    ticker: filing.ticker,
    company: filing.company,
    filingType: filing.filingType,
    filingDate: filing.filingDate,
    periodEnd: filing.periodEnd,
    fiscalLabel: p.fiscalLabel,
    section: p.section,
    documentId: p.documentId,
    charStart: start,
    charEnd: end,
    text: text.slice(start, end),
  };
};
const testPassages = spec.testPassages.map(slice);
const ids = testPassages.map((p) => p.chunkId);
if (new Set(ids).size !== ids.length) throw new Error('duplicate chunkId in passages.spec.json');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'filings.json'), `${JSON.stringify(filings, null, 1)}\n`);
mkdirSync(testOutDir, { recursive: true });
writeFileSync(join(testOutDir, 'passages.json'), `${JSON.stringify(testPassages, null, 1)}\n`);
console.log(
  `build-web-fixtures: ${filings.length} filings → ${outDir}, ${testPassages.length} test passages → ${testOutDir}`,
);

#!/usr/bin/env node
// Corpus probe: reproduces every corpus fact cited in docs/architecture.md §3 and
// docs/assumptions.md §B. Read-only, no dependencies (Node >= 22).
//
//   node scripts/ingestion/probe-corpus.mjs            # reads $CORPUS_PATH or ./edgar_corpus
//   CORPUS_PATH=/path/to/edgar_corpus node scripts/ingestion/probe-corpus.mjs
//
// CORPUS_PATH must be an extracted directory of *.txt filings (+ manifest.json).
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const corpusDir = resolve(process.env.CORPUS_PATH ?? 'edgar_corpus');
if (!existsSync(corpusDir) || !statSync(corpusDir).isDirectory()) {
  console.error(`probe-corpus: corpus directory not found: ${corpusDir} (set CORPUS_PATH)`);
  process.exit(1);
}

const LONG_LINE = 90_000;
const COVER_STRICT = /UNITED STATES SECURITIES AND EXCHANGE COMMISSION/;
const COVER_TOLERANT = /UNITED\s*STATES\s*SECURITIES\s*AND\s*EXCHANGE\s*COMMISSION/i;
const RF_ITEM = /Item\s*1A\.?\s*[|:.\-–—\s]*Risk\s*Factors/gi;
const RF_TOC_ALT = /Risk\s*Factors\s*\|\s*\|\s*1A\b/i; // e.g. MS 10-K TOC: "Risk Factors |  | 1A | 13"
const MDA = /Management['’]s\s*Discussion\s*and\s*Analysis/gi;
// A hit is a cross-reference (not a section heading) when it reads like "discussed under Item 1A"
// or "Item 1A. Risk Factors of ExxonMobil's 2023 Form 10-K".
const XREF_BEFORE = /(under|in|see|of)\s*(the\s+)?["“]?\s*$/i;
const XREF_AFTER = /^\s*["”]?,?\s+(of|in)\s/;
const RF_NO_MATERIAL_CHANGE =
  /(no\s+material\s+changes?[^.]{0,200}risk\s+factors|risk\s+factors[^.]{0,300}no\s+material\s+changes?)/i;
const SLUG_DATE = /[-_](\d{4})(\d{2})(\d{2})(?:x10[kq])?\.htm$/i;
const COVER_PERIOD =
  /For\s+the\s+(?:fiscal\s+year|quarterly\s+period)\s+ended\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isCrossReference(text, index, length) {
  const before = text.slice(Math.max(0, index - 40), index);
  const after = text.slice(index + length, index + length + 30);
  return XREF_BEFORE.test(before) || XREF_AFTER.test(after);
}

function parseHeader(text) {
  const sep = text.indexOf('\n====');
  const block = sep === -1 ? '' : text.slice(0, sep);
  const header = {};
  for (const line of block.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) header[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { header, body: sep === -1 ? text : text.slice(sep) };
}

function derivePeriodEnd(header, body) {
  if (header['Report Period']) return { periodEnd: header['Report Period'], source: 'header' };
  const slug = (header.URL ?? '').split('/').pop() ?? '';
  const m = slug.match(SLUG_DATE);
  if (m) return { periodEnd: `${m[1]}-${m[2]}-${m[3]}`, source: 'url-slug' };
  const c = body.slice(0, 200_000).match(COVER_PERIOD);
  if (c && MONTHS.includes(c[1])) {
    const mm = String(MONTHS.indexOf(c[1]) + 1).padStart(2, '0');
    return { periodEnd: `${c[3]}-${mm}-${c[2].padStart(2, '0')}`, source: 'cover-page' };
  }
  return { periodEnd: header['Filing Date'], source: 'filing-date (flagged)' };
}

const files = readdirSync(corpusDir).filter((f) => f.endsWith('.txt')).sort();
const rows = [];
for (const file of files) {
  const text = readFileSync(join(corpusDir, file), 'utf8');
  const { header, body } = parseHeader(text);
  const lines = text.split('\n');
  let maxLine = 0;
  let longLines = 0;
  for (const l of lines) {
    if (l.length > maxLine) maxLine = l.length;
    if (l.length > LONG_LINE) longLines++;
  }
  const type = (header['Filing Type'] ?? '').slice(0, 4);
  const { periodEnd, source } = derivePeriodEnd(header, body);
  const slugMatch = ((header.URL ?? '').split('/').pop() ?? '').match(SLUG_DATE);
  // Fiscal-year naming: the "fiscal YYYY" label nearest to each occurrence of the period-end date
  // (e.g. TGT "Fiscal 2024 ended February 1, 2025"; WMT "January 31, 2025 ("fiscal 2025")").
  const fiscalMentions = {};
  if (type === '10-K') {
    const flat = body.replace(/\s+/g, ' ');
    const [y, m, d] = periodEnd.split('-').map(Number);
    const dateRe = new RegExp(`${MONTHS[m - 1]} ${d}, ${y}`, 'g');
    for (const hit of flat.matchAll(dateRe)) {
      const from = Math.max(0, hit.index - 150);
      const window = flat.slice(from, hit.index + hit[0].length + 150);
      let best = null;
      for (const lm of window.matchAll(/\bfiscal\s+(?:year\s+)?(20\d\d)\b/gi)) {
        const dist = Math.abs(from + lm.index - hit.index);
        if (!best || dist < best.dist) best = { year: lm[1], dist };
      }
      if (best) fiscalMentions[best.year] = (fiscalMentions[best.year] ?? 0) + 1;
    }
  }
  const rfHits = [...body.matchAll(RF_ITEM)];
  const rfHeadings = rfHits.filter((m) => !isCrossReference(body, m.index, m[0].length)).length;
  rows.push({
    file,
    header,
    type,
    ticker: header.Ticker,
    company: header.Company,
    filingDate: header['Filing Date'],
    periodEnd,
    periodSource: source,
    slugDate: slugMatch ? `${slugMatch[1]}-${slugMatch[2]}-${slugMatch[3]}` : null,
    chars: text.length,
    maxLine,
    longLines,
    coverStrict: COVER_STRICT.test(text),
    coverTolerant: COVER_TOLERANT.test(text),
    rfItem: rfHits.length,
    rfHeadings,
    rfTocAlt: RF_TOC_ALT.test(body),
    mda: [...body.matchAll(MDA)].length,
    rfNoMaterialChange: type === '10-Q' && RF_NO_MATERIAL_CHANGE.test(body),
    fiscalMentions,
  });
}

const out = [];
const p = (s = '') => out.push(s);
const count = (pred) => rows.filter(pred).length;

// 1. Files and manifest
p('== Files');
p(`corpus: ${corpusDir}`);
p(`filings (*.txt): ${rows.length}`);
const byType = {};
for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
p(`by filing type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
p(`total characters: ${rows.reduce((a, r) => a + r.chars, 0).toLocaleString('en-US')}`);
const manifestPath = join(corpusDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  p(`manifest.json keys: ${Object.keys(m).join(', ')}`);
  p(`manifest file_count=${m.file_count} filing_types=${JSON.stringify(m.filing_types)} files[]=${Array.isArray(m.files) ? m.files.length : 'n/a'}`);
  p(`manifest description: ${m.description}`);
}

// 2. Header fields
p('\n== Header fields (files containing each)');
const fieldCounts = {};
for (const r of rows) for (const k of Object.keys(r.header)) fieldCounts[k] = (fieldCounts[k] ?? 0) + 1;
for (const [k, v] of Object.entries(fieldCounts)) p(`${k}: ${v}/${rows.length}`);

// 3. Companies
const byTicker = new Map();
for (const r of rows) {
  if (!byTicker.has(r.ticker)) byTicker.set(r.ticker, []);
  byTicker.get(r.ticker).push(r);
}
p(`\n== Companies: ${byTicker.size}`);
const dist = {};
for (const list of byTicker.values()) dist[list.length] = (dist[list.length] ?? 0) + 1;
p(`filings-per-company distribution (filings: companies): ${Object.entries(dist).map(([k, v]) => `${k}:${v}`).join(', ')}`);
const deep = [...byTicker].filter(([, l]) => l.length >= 14).map(([t]) => t);
p(`companies with >= 14 filings: ${deep.length} (${deep.sort().join(', ')})`);
const single = [...byTicker].filter(([, l]) => l.length === 1);
p(`companies with exactly 1 filing: ${single.length} (all 10-K: ${single.every(([, l]) => l[0].type === '10-K')})`);
p('\nper-company filings (ticker | company | 10-K | 10-Q | period-end range):');
const sortedTickers = [...byTicker.keys()].sort((a, b) => byTicker.get(b).length - byTicker.get(a).length || a.localeCompare(b));
for (const t of sortedTickers) {
  const l = byTicker.get(t);
  const names = [...new Set(l.map((r) => r.company))].join(' / ');
  const k = l.filter((r) => r.type === '10-K').length;
  const q = l.filter((r) => r.type === '10-Q').length;
  const pe = l.map((r) => r.periodEnd).sort();
  p(`  ${t.padEnd(6)}| ${names} | ${k} | ${q} | ${pe[0]} .. ${pe[pe.length - 1]}`);
}
p('\n10-K period ends for companies with 2-8 filings:');
for (const t of sortedTickers) {
  const l = byTicker.get(t);
  if (l.length < 2 || l.length > 8) continue;
  const ks = l.filter((r) => r.type === '10-K').map((r) => r.periodEnd).sort();
  const qs = l.filter((r) => r.type === '10-Q').map((r) => r.periodEnd).sort();
  p(`  ${t}: 10-K ${ks.join(', ')} | 10-Q ${qs.join(', ')}`);
}

// 4. Periods
p('\n== Periods');
p(`files missing Report Period: ${count((r) => !r.header['Report Period'])}`);
const srcCounts = {};
for (const r of rows) srcCounts[r.periodSource] = (srcCounts[r.periodSource] ?? 0) + 1;
p(`period-end source: ${Object.entries(srcCounts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
const both = rows.filter((r) => r.header['Report Period'] && r.slugDate);
p(`header Report Period == URL slug date: ${both.filter((r) => r.header['Report Period'] === r.slugDate).length}/${both.length}`);
p(`non-standard URL slugs (not <ticker>-YYYYMMDD.htm): ${rows
  .map((r) => (r.header.URL ?? '').split('/').pop())
  .filter((s) => !/^[a-z]+-\d{8}\.htm$/.test(s))
  .join(', ')}`);
for (const r of rows.filter((x) => x.periodSource !== 'header' && x.periodSource !== 'url-slug')) {
  p(`  ${r.file}: period end ${r.periodEnd} via ${r.periodSource}`);
}
const fd = rows.map((r) => r.filingDate).sort();
const pe = rows.map((r) => r.periodEnd).sort();
p(`filing-date range: ${fd[0]} .. ${fd[fd.length - 1]}`);
p(`period-end range: ${pe[0]} .. ${pe[pe.length - 1]}`);
p(`filings with period end before 2022-01-01: ${rows.filter((r) => r.periodEnd < '2022-01-01').map((r) => `${r.file} (${r.periodEnd}, CIK ${r.header.CIK})`).join(', ') || 'none'}`);

// 5. Fiscal-year naming (10-Ks with a non-December period end)
p('\n== Fiscal-year naming probe (10-K, period end not in December): label nearest each mention of the period-end date');
for (const r of rows.filter((x) => x.type === '10-K' && x.periodEnd.slice(5, 7) !== '12')) {
  const top = Object.entries(r.fiscalMentions).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const endYear = Number(r.periodEnd.slice(0, 4));
  const flag = top.length && Number(top[0][0]) === endYear - 1 ? '  <- labels FY by start year' : '';
  p(`  ${r.ticker.padEnd(5)} ${r.periodEnd}  ${top.map(([y, n]) => `FY${y}:${n}`).join(' ') || '(no label next to date)'}${flag}`);
}

// 6. Text shape
p('\n== Text shape');
const maxRow = rows.reduce((a, r) => (r.maxLine > a.maxLine ? r : a));
p(`max line length: ${maxRow.maxLine.toLocaleString('en-US')} chars (${maxRow.file})`);
p(`files with a line > ${LONG_LINE.toLocaleString('en-US')} chars: ${count((r) => r.longLines > 0)} (lines: ${rows.reduce((a, r) => a + r.longLines, 0)})`);
p(`cover heading, exact "UNITED STATES SECURITIES AND EXCHANGE COMMISSION": ${count((r) => r.coverStrict)}/${rows.length}`);
p(`cover heading, whitespace-tolerant + case-insensitive: ${count((r) => r.coverTolerant)}/${rows.length}`);
for (const r of rows.filter((x) => !x.coverTolerant)) p(`  cover miss: ${r.file}`);

// 7. Naive section-heading probe
p('\n== Naive section-heading probe ("Item 1A ... Risk Factors", "Management\'s Discussion and Analysis")');
for (const t of ['10-K', '10-Q']) {
  const rs = rows.filter((r) => r.type === t);
  p(`${t}: Item 1A >=2 hits (TOC + body) ${rs.filter((r) => r.rfItem >= 2).length}/${rs.length}; exactly 1 hit ${rs.filter((r) => r.rfItem === 1).length}; 0 hits ${rs.filter((r) => r.rfItem === 0).length}`);
  p(`${t}: MD&A >=2 hits ${rs.filter((r) => r.mda >= 2).length}/${rs.length}; <2 hits ${rs.filter((r) => r.mda < 2).length}`);
}
for (const r of rows.filter((x) => x.rfItem < 2)) {
  p(`  Item 1A <2: ${r.file} (item1A=${r.rfItem}, heading-form=${r.rfHeadings}, altTOC "Risk Factors | | 1A"=${r.rfTocAlt}, mda=${r.mda})`);
}
const noHeading = rows.filter((x) => x.rfHeadings === 0);
p(`files with no heading-form "Item 1A" hit (all hits are cross-references or absent): ${noHeading.length}`);
for (const t of [...new Set(noHeading.map((r) => `${r.ticker} ${r.type}`))]) {
  p(`  ${t}: ${noHeading.filter((r) => `${r.ticker} ${r.type}` === t).length} file(s), altTOC=${noHeading.filter((r) => `${r.ticker} ${r.type}` === t).some((r) => r.rfTocAlt)}`);
}
for (const r of rows.filter((x) => x.mda < 2)) p(`  MD&A <2: ${r.file} (mda=${r.mda})`);
const q = rows.filter((r) => r.type === '10-Q');
p(`10-Q with "no material changes" risk-factor language: ${q.filter((r) => r.rfNoMaterialChange).length}/${q.length}`);

console.log(out.join('\n'));

import type { Chunk, CompanyCoverage, SectionKind } from '@diligenceiq/corpus';

/** What `scripts/ingestion/ingest.ts` records per run (`.index/work/ingest-report.json`). */
export interface IngestReport {
  corpusPath: string;
  corpusHash: string;
  /** Content hash of chunks.jsonl plus each chunk's embedded text (version.ts `chunksHash`). */
  chunksHash?: string;
  /** Derived from chunksHash + tokenizer + embedding model + dimensions (version.ts). */
  indexVersion: string;
  tokenizerVersion?: string;
  embedding?: { modelId: string; dimensions: number };
  license: string | null;
  documents: number;
  chunks: number;
  filings: Array<{
    documentId: string;
    ticker: string;
    filingType: '10-K' | '10-Q';
    fiscalLabel: string;
    periodEnd: string;
    periodSource: string;
    sections: Array<{ kind: SectionKind; code: string; anchor: string; chars: number }>;
    chunks: number;
    boilerplateChunks: number;
  }>;
  coverage: CompanyCoverage[];
}

/**
 * The index summary (SPEC §24.4): documents, chunks, companies, fiscal years, filing types,
 * and detected sections per filing. Written as `summary.json`, printed by the CLI, and
 * recorded in the Phase 2 handoff.
 */
export interface IndexSummary {
  indexVersion: string;
  corpusHash: string;
  documents: number;
  chunks: number;
  filingTypes: Record<string, { documents: number; chunks: number }>;
  fiscalYears: Record<string, { documents: number; chunks: number }>;
  periodSources: Record<string, number>;
  sections: Record<string, { documents: number; chunks: number }>;
  boilerplateChunks: number;
  companies: Array<Pick<CompanyCoverage, 'ticker' | 'company' | 'sector' | 'tier' | 'filings' | 'tenK' | 'tenQ' | 'fiscalYearEnd'>>;
  tiers: Record<string, number>;
  /** Filings where an expected section was not detected (reported, never invented). */
  sectionGaps: Array<{ documentId: string; gaps: Array<{ kind: SectionKind; reason: 'missing' | 'stub'; chars: number }> }>;
  filings: Array<{
    documentId: string;
    ticker: string;
    filingType: string;
    fiscalLabel: string;
    periodEnd: string;
    periodSource: string;
    chunks: number;
    sections: Array<{ code: string; anchor: string; chars: number; chunks: number }>;
  }>;
}

/** Same expectations as `sectionGaps` in packages/corpus: a missing section or a stub under 1,500 characters. */
const EXPECTED: Record<'10-K' | '10-Q', SectionKind[]> = { '10-K': ['risk_factors', 'mda', 'financial_statements'], '10-Q': ['mda'] };
const STUB_CHARS = 1_500;

function bump(rec: Record<string, { documents: number; chunks: number }>, key: string, documents: number, chunks: number): void {
  const r = (rec[key] ??= { documents: 0, chunks: 0 });
  r.documents += documents;
  r.chunks += chunks;
}

export function buildSummary(report: IngestReport, chunks: readonly Chunk[]): IndexSummary {
  const byDoc = new Map<string, Chunk[]>();
  for (const c of chunks) byDoc.set(c.documentId, [...(byDoc.get(c.documentId) ?? []), c]);
  const filingTypes: IndexSummary['filingTypes'] = {};
  const fiscalYears: IndexSummary['fiscalYears'] = {};
  const sections: IndexSummary['sections'] = {};
  const periodSources: Record<string, number> = {};
  const sectionGaps: IndexSummary['sectionGaps'] = [];
  const filings: IndexSummary['filings'] = report.filings.map((f) => {
    const cs = byDoc.get(f.documentId) ?? [];
    bump(filingTypes, f.filingType, 1, cs.length);
    bump(fiscalYears, f.fiscalLabel.slice(0, 6), 1, cs.length);
    periodSources[f.periodSource] = (periodSources[f.periodSource] ?? 0) + 1;
    const kinds = new Set(f.sections.map((s) => s.kind));
    for (const k of kinds) bump(sections, k, 1, cs.filter((c) => c.sectionKind === k).length);
    const gaps = EXPECTED[f.filingType].flatMap((kind): IndexSummary['sectionGaps'][number]['gaps'] => {
      const sec = f.sections.find((x) => x.kind === kind);
      if (!sec) return [{ kind, reason: 'missing', chars: 0 }];
      return sec.chars < STUB_CHARS ? [{ kind, reason: 'stub', chars: sec.chars }] : [];
    });
    if (gaps.length) sectionGaps.push({ documentId: f.documentId, gaps });
    return {
      documentId: f.documentId,
      ticker: f.ticker,
      filingType: f.filingType,
      fiscalLabel: f.fiscalLabel,
      periodEnd: f.periodEnd,
      periodSource: f.periodSource,
      chunks: cs.length,
      sections: f.sections.map((s) => ({ code: s.code, anchor: s.anchor, chars: s.chars, chunks: cs.filter((c) => c.sectionCode === s.code).length })),
    };
  });
  bump(sections, 'other', 0, chunks.filter((c) => c.sectionKind === 'other').length);
  const tiers: Record<string, number> = {};
  for (const c of report.coverage) tiers[c.tier] = (tiers[c.tier] ?? 0) + 1;
  return {
    indexVersion: report.indexVersion,
    corpusHash: report.corpusHash,
    documents: report.documents,
    chunks: chunks.length,
    filingTypes,
    fiscalYears: Object.fromEntries(Object.entries(fiscalYears).sort()),
    periodSources,
    sections,
    boilerplateChunks: chunks.filter((c) => c.boilerplate).length,
    companies: report.coverage.map(({ ticker, company, sector, tier, filings: n, tenK, tenQ, fiscalYearEnd }) => ({
      ticker,
      company,
      sector,
      tier,
      filings: n,
      tenK,
      tenQ,
      fiscalYearEnd,
    })),
    tiers,
    sectionGaps,
    filings,
  };
}

/** The CLI print-out of the index summary. */
export function formatSummary(s: IndexSummary): string {
  const lines: string[] = [];
  const kv = (rec: Record<string, { documents: number; chunks: number }>) =>
    Object.entries(rec)
      .map(([k, v]) => `${k} ${v.documents} docs / ${v.chunks} chunks`)
      .join('; ');
  lines.push(`Index summary ${s.indexVersion} (corpus ${s.corpusHash.slice(0, 12)}…)`);
  lines.push(`  documents ${s.documents}, chunks ${s.chunks}, companies ${s.companies.length} (${Object.entries(s.tiers).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  lines.push(`  filing types: ${kv(s.filingTypes)}`);
  lines.push(`  fiscal years: ${kv(s.fiscalYears)}`);
  lines.push(`  period-end source: ${Object.entries(s.periodSources).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push(`  sections: ${kv(s.sections)}`);
  lines.push(`  boilerplate chunks (10-Q "no material changes"): ${s.boilerplateChunks}`);
  lines.push(`  filings with a missing or stub expected section: ${s.sectionGaps.length}`);
  for (const g of s.sectionGaps) lines.push(`    ${g.documentId}: ${g.gaps.map((x) => `${x.kind} ${x.reason}${x.reason === 'stub' ? ` (${x.chars} chars)` : ''}`).join(', ')}`);
  return lines.join('\n');
}

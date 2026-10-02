import type { FilingMeta } from './filing';
import { type Section } from './sections';
import { type Span, capSpan, headingPrefix, isTableRow, lineSpans, paragraphSpans, sentenceSpans } from './segments';

/**
 * Section-aware chunking (SPEC §25; architecture §6.2).
 *
 * - Target ~900 tokens (~3,600 characters) with ~120 tokens (~480 characters) of overlap,
 *   provisional until the Phase 3 retrieval evals.
 * - Chunks never cross a section boundary.
 * - Units are sentences inside paragraphs, and whole tables (kept intact when they fit under
 *   the hard cap, otherwise one unit per row). Lines are never assumed to be paragraphs: a
 *   single line can be 287,855 characters.
 * - HARD_CAP_CHARS bounds every chunk, including a single run-on sentence or table row.
 * - Every chunk's text is the verbatim slice [charStart, charEnd) of the processed filing
 *   text. The contextual header is prepended only to the text that is embedded and indexed
 *   for BM25 (`embeddingText`), never to the passage shown to users.
 */
/**
 * c2 (Phase 2 fix): section detection changed (cross-reference and TOC rejection, canonical item
 * order, bare financial-statement headings), so section codes and chunk IDs changed.
 */
export const CHUNKER_VERSION = 'c2';
export const TARGET_CHARS = 3_600;
export const OVERLAP_CHARS = 480;
export const HARD_CAP_CHARS = 6_000;
/** A final chunk smaller than this is folded into the previous one when the cap allows. */
const MIN_TAIL_CHARS = 900;

export interface Chunk {
  chunkId: string;
  documentId: string;
  company: string;
  ticker: string;
  cik: string;
  sector: string;
  filingType: FilingMeta['filingType'];
  filingDate: string;
  periodEnd: string;
  fiscalYear: number;
  fiscalQuarter: number | null;
  fiscalLabel: string;
  calendarQuarter: string | null;
  section: string;
  sectionCode: string;
  sectionKind: Section['kind'];
  subsection: string | null;
  boilerplate: boolean;
  sourceFile: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  text: string;
}

/** Table blocks are one unit when they fit; prose is split into sentences. */
function units(text: string, section: Section, hardCap = HARD_CAP_CHARS): Span[] {
  const out: Span[] = [];
  const lines = lineSpans(text, section.start, section.end);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isTableRow(text.slice(line.start, line.end))) {
      let j = i;
      while (j + 1 < lines.length && isTableRow(text.slice(lines[j + 1]!.start, lines[j + 1]!.end))) j++;
      const block = { start: line.start, end: lines[j]!.end };
      if (block.end - block.start <= hardCap) out.push(block);
      else for (const row of lines.slice(i, j + 1)) out.push(...capSpan(text, row, hardCap));
      i = j + 1;
      continue;
    }
    for (const para of paragraphSpans(text, line.start, line.end)) {
      for (const sentence of sentenceSpans(text, para)) out.push(...capSpan(text, sentence, hardCap));
    }
    i++;
  }
  return out;
}

/**
 * Chunk sizing. The defaults are chunker `c2`; other values exist only for the offline Phase 3
 * chunk-size experiment (`pnpm eval:chunk-size`, BM25 only), never for the index.
 */
export interface ChunkSizing {
  targetChars: number;
  overlapChars: number;
  hardCapChars: number;
}
export const DEFAULT_SIZING: ChunkSizing = { targetChars: TARGET_CHARS, overlapChars: OVERLAP_CHARS, hardCapChars: HARD_CAP_CHARS };

/** Greedy packing of consecutive units into [start, end) ranges with unit-aligned overlap. */
export function packUnits(spans: readonly Span[], sizing: ChunkSizing = DEFAULT_SIZING): Span[] {
  const { targetChars, overlapChars, hardCapChars } = sizing;
  const chunks: Span[] = [];
  let first = 0;
  while (first < spans.length) {
    let last = first;
    while (last + 1 < spans.length && spans[last + 1]!.end - spans[first]!.start <= targetChars) last++;
    chunks.push({ start: spans[first]!.start, end: spans[last]!.end });
    if (last + 1 >= spans.length) break;
    // Next chunk starts with the trailing units that fit in the overlap budget, but always
    // advances by at least one unit.
    let next = last + 1;
    while (next - 1 > first && spans[last]!.end - spans[next - 1]!.start <= overlapChars) next--;
    first = next;
  }
  const tail = chunks.at(-1);
  const prev = chunks.at(-2);
  if (tail && prev && tail.end - tail.start < Math.min(MIN_TAIL_CHARS, targetChars / 4) && tail.end - prev.start <= hardCapChars) {
    chunks.splice(-2, 2, { start: prev.start, end: tail.end });
  }
  return chunks;
}

/** 10-Q "no material changes" risk-factor language (assumptions B9). */
export const RF_NO_MATERIAL_CHANGE =
  /(no\s+material\s+changes?[^.]{0,200}risk\s+factors|risk\s+factors[^.]{0,300}no\s+material\s+changes?)/i;
/** A 10-Q risk section longer than this lists updated risks, so it is not boilerplate. */
const BOILERPLATE_MAX_SECTION_CHARS = 3_000;

export function isBoilerplateSection(text: string, section: Section, filingType: FilingMeta['filingType']): boolean {
  return (
    filingType === '10-Q' &&
    section.kind === 'risk_factors' &&
    section.end - section.start <= BOILERPLATE_MAX_SECTION_CHARS &&
    RF_NO_MATERIAL_CHANGE.test(text.slice(section.start, section.end))
  );
}

/** Best-effort breadcrumb: the last short Title Case heading in the section before `offset`. */
function subsectionAt(text: string, section: Section, offset: number, headings: Array<{ at: number; title: string }>): string | null {
  let found: string | null = null;
  for (const h of headings) {
    if (h.at > offset) break;
    if (h.at >= section.start) found = h.title;
  }
  return found;
}

function sectionHeadings(text: string, section: Section): Array<{ at: number; title: string }> {
  const out: Array<{ at: number; title: string }> = [];
  for (const p of paragraphSpans(text, section.start, section.end)) {
    // Skip the section's own heading paragraph.
    if (p.start === section.start) continue;
    const title = headingPrefix(text.slice(p.start, Math.min(p.end, p.start + 200)));
    if (title) out.push({ at: p.start, title });
  }
  return out;
}

/** Chunk numbers are three digits; more than 999 chunks in one section would break the ID format. */
export const MAX_CHUNKS_PER_SECTION = 999;

export function chunkId(meta: Pick<FilingMeta, 'ticker' | 'fiscalLabel' | 'filingType'>, sectionCode: string, n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > MAX_CHUNKS_PER_SECTION) {
    throw new Error(`chunk number ${n} for ${meta.ticker} ${meta.fiscalLabel} ${sectionCode} is outside 1–${MAX_CHUNKS_PER_SECTION}`);
  }
  return `${meta.ticker}-${meta.fiscalLabel}-${meta.filingType.replace('-', '')}-${sectionCode}-${String(n).padStart(3, '0')}`;
}

export function chunkFiling(meta: FilingMeta, text: string, sections: readonly Section[], sizing: ChunkSizing = DEFAULT_SIZING): Chunk[] {
  const chunks: Chunk[] = [];
  const perCode = new Map<string, number>();
  for (const section of sections) {
    if (!text.slice(section.start, section.end).trim()) continue;
    const boilerplate = isBoilerplateSection(text, section, meta.filingType);
    const headings = sectionHeadings(text, section);
    for (const span of packUnits(units(text, section, sizing.hardCapChars), sizing)) {
      const slice = text.slice(span.start, span.end);
      if (!slice.trim()) continue;
      const n = (perCode.get(section.code) ?? 0) + 1;
      perCode.set(section.code, n);
      chunks.push({
        chunkId: chunkId(meta, section.code, n),
        documentId: meta.documentId,
        company: meta.company,
        ticker: meta.ticker,
        cik: meta.cik,
        sector: meta.sector,
        filingType: meta.filingType,
        filingDate: meta.filingDate,
        periodEnd: meta.periodEnd,
        fiscalYear: meta.fiscalYear,
        fiscalQuarter: meta.fiscalQuarter,
        fiscalLabel: meta.fiscalLabel,
        calendarQuarter: meta.calendarQuarter,
        section: section.label,
        sectionCode: section.code,
        sectionKind: section.kind,
        subsection: subsectionAt(text, section, span.start, headings),
        boilerplate,
        sourceFile: meta.sourceFile,
        chunkIndex: chunks.length,
        charStart: span.start,
        charEnd: span.end,
        text: slice,
      });
    }
  }
  return chunks;
}

/**
 * The text that is embedded and indexed for BM25: a contextual header, then the passage.
 * `Apple Inc · 10-K FY2025 (period ended 2025-09-27) · Item 1A — Risk Factors › Supply chain`
 */
export function contextHeader(c: Pick<Chunk, 'company' | 'ticker' | 'filingType' | 'fiscalLabel' | 'periodEnd' | 'section' | 'subsection'>): string {
  const crumb = c.subsection ? ` › ${c.subsection}` : '';
  return `${c.company} (${c.ticker}) · ${c.filingType} ${c.fiscalLabel} (period ended ${c.periodEnd}) · ${c.section}${crumb}`;
}

export function embeddingText(c: Chunk): string {
  return `${contextHeader(c)}\n\n${c.text.trim()}`;
}

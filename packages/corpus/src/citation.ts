import type { Citation } from '@diligenceiq/core';
import type { Chunk } from './chunker';

/** A chunk as a citation, with the section breadcrumb the worker's snapshot uses (`section › subsection`). */
export function chunkCitation(c: Chunk, indexVersion: string): Citation {
  return {
    chunkId: c.chunkId,
    indexVersion,
    ticker: c.ticker,
    company: c.company,
    filingType: c.filingType,
    filingDate: c.filingDate,
    periodEnd: c.periodEnd,
    fiscalLabel: c.fiscalLabel,
    section: chunkSectionLabel(c),
    documentId: c.documentId,
    charStart: c.charStart,
    charEnd: c.charEnd,
    text: c.text,
  };
}

export function chunkSectionLabel(c: Pick<Chunk, 'section' | 'subsection'>): string {
  return c.subsection ? `${c.section} › ${c.subsection}` : c.section;
}

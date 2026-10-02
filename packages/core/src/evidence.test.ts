import { describe, expect, it } from 'vitest';
import { CHUNK_ID_PATTERN, CHUNK_ID_SOURCE, DOCUMENT_ID_PATTERN, briefCitationIds, citationMatchesSource, tickerOfChunkId, tickerOfDocumentId } from './evidence';

describe('evidence IDs (architecture §6.3)', () => {
  it('reads the ticker from chunk and document IDs, and rejects anything else', () => {
    expect(tickerOfChunkId('AAPL-FY2025-10K-1A-004')).toBe('AAPL');
    expect(tickerOfChunkId('NVDA-FY2026Q3-10Q-MDA-012')).toBe('NVDA');
    expect(tickerOfChunkId('JNJ-FY2024Q2-10Q-LEGAL-001')).toBe('JNJ');
    // Zero-padded to at least three digits: a four-digit chunk number is still an ID.
    expect(tickerOfChunkId('AAPL-FY2025-10K-1A-1000')).toBe('AAPL');
    expect('x [AAPL-FY2025-10K-1A-1000] y [MSFT-FY2024-10K-MDA-002]'.match(new RegExp(CHUNK_ID_SOURCE, 'g'))).toEqual(['AAPL-FY2025-10K-1A-1000', 'MSFT-FY2024-10K-MDA-002']);
    for (const id of ['AAPL-FY2025-10K-1A-004', 'AAPL-FY2025-10K-1A-04', 'AAPL-FY2025-10K-1A-1000', 'aapl-FY2025-10K-1A-004']) {
      expect(new RegExp(`^${CHUNK_ID_SOURCE}$`).test(id), id).toBe(CHUNK_ID_PATTERN.test(id));
    }
    for (const bad of ['', 'aapl-FY2025-10K-1A-004', 'AAPL-FY2025-10K-1A-04', 'AAPL-FY2025-10X-1A-004', '../AAPL-FY2025-10K-1A-004', 'AAPL-FY2025-10K-1A-F01']) {
      expect(CHUNK_ID_PATTERN.test(bad), bad).toBe(false);
    }
    expect(tickerOfDocumentId('AAPL_10K_2025-10-31')).toBe('AAPL');
    expect(tickerOfDocumentId('AAPL_10K_2022Q3_2022-10-28')).toBe('AAPL');
    expect(tickerOfDocumentId('NVDA_10Q_2025Q3_2025-11-19')).toBe('NVDA');
    for (const bad of ['AAPL_10K_2025-10-31.json', 'AAPL/10K', 'AAPL_10K_2025-10-31_full', '']) expect(DOCUMENT_ID_PATTERN.test(bad), bad).toBe(false);
  });

  it('a citation matches its source only as the exact span', () => {
    const text = 'abcdefghij';
    expect(citationMatchesSource({ charStart: 2, charEnd: 5, text: 'cde' }, text)).toBe(true);
    expect(citationMatchesSource({ charStart: 2, charEnd: 5, text: 'cdf' }, text)).toBe(false);
    expect(citationMatchesSource({ charStart: 8, charEnd: 12, text: 'ij' }, text)).toBe(false);
  });

  it('collects a brief’s citations and flags a bracketed token that is not a chunk ID (evidence:check fails on it)', () => {
    const brief = {
      executiveSummary: 'Margins rose [AAPL-FY2025-10K-MDA-002] while [AAPL-FY2025-10K-1A-1] was cited and [note] is prose.',
      keyFindings: [{ finding: 'x', citationIds: ['AAPL-FY2025-10K-1A-004', 'chunk-7'] }],
    };
    const { ids, malformed } = briefCitationIds(brief);
    expect([...ids].sort()).toEqual(['AAPL-FY2025-10K-1A-004', 'AAPL-FY2025-10K-MDA-002']);
    expect([...malformed].sort()).toEqual(['AAPL-FY2025-10K-1A-1', 'chunk-7']);
  });
});

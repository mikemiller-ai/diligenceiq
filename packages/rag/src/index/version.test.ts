import type { Chunk } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { chunksHash, indexVersionOf, serializeChunks, verifyIndexVersion } from './version';

const chunk = (over: Partial<Chunk>): Chunk => ({
  chunkId: 'TST-FY2024-10K-1A-001', documentId: 'D1', company: 'Co', ticker: 'TST', cik: '1', sector: 'Industrials', filingType: '10-K',
  filingDate: '2025-01-01', periodEnd: '2024-12-31', fiscalYear: 2024, fiscalQuarter: null, fiscalLabel: 'FY2024',
  calendarQuarter: null, section: 'Item 1A — Risk Factors', sectionCode: '1A', sectionKind: 'risk_factors', subsection: null,
  boilerplate: false, sourceFile: 'f', chunkIndex: 0, charStart: 0, charEnd: 4, text: 'text', ...over,
});

const base = [chunk({}), chunk({ chunkId: 'TST-FY2024-10K-MDA-001', section: 'Item 7 — MD&A', sectionCode: 'MDA', sectionKind: 'mda', text: 'cloud', charEnd: 5 })];
const current = { tokenizerVersion: 't2', modelId: 'amazon.titan-embed-text-v2:0', dimensions: 1024 };
const version = (chunks: Chunk[], over: Partial<typeof current> = {}) => indexVersionOf({ chunksHash: chunksHash(chunks), ...current, ...over });

describe('index version from chunk content (SPEC §25.2: IDs immutable within a version)', () => {
  it('is deterministic for the same chunks', () => {
    expect(version(base)).toBe(version(base.map((c) => ({ ...c }))));
    expect(version(base)).toMatch(/^iv-[0-9a-f]{12}$/);
  });

  it('changes when any chunk’s ID, text, section or other shown/embedded metadata changes, or when order changes', () => {
    const v = version(base);
    const variants: Array<Partial<Chunk>> = [
      { chunkId: 'TST-FY2024-10K-1A-002' },
      { text: 'text!' },
      { section: 'Item 1A — Risk factors' },
      { sectionKind: 'mda' },
      { fiscalLabel: 'FY2025' },
      { subsection: 'Supply chain' },
      { charStart: 1, charEnd: 5 },
      { boilerplate: true },
    ];
    for (const over of variants) expect(version([{ ...base[0]!, ...over }, base[1]!]), JSON.stringify(over)).not.toBe(v);
    expect(version([base[1]!, base[0]!])).not.toBe(v);
    expect(version(base.slice(0, 1))).not.toBe(v);
  });

  it('changes with the tokenizer, embedding model or dimensions', () => {
    const v = version(base);
    expect(version(base, { tokenizerVersion: 't3' })).not.toBe(v);
    expect(version(base, { modelId: 'cohere.embed-v4' })).not.toBe(v);
    expect(version(base, { dimensions: 512 })).not.toBe(v);
  });

  it('verifyIndexVersion accepts the file ingest wrote and rejects drift, edits, legacy reports and a different model', () => {
    const jsonl = serializeChunks(base);
    const recorded = { indexVersion: version(base), chunksHash: chunksHash(base) };
    expect(verifyIndexVersion(jsonl, base, recorded, current)).toEqual([]);
    // chunks.jsonl re-produced by changed code under the old report
    const changed = [{ ...base[0]!, section: 'Risk Factors' }, base[1]!];
    expect(verifyIndexVersion(serializeChunks(changed), changed, recorded, current).join(' ')).toMatch(/chunks hash .* differs/);
    // hand-edited file (not canonical serialization)
    expect(verifyIndexVersion(jsonl.replace('\n', '\n\n'), base, recorded, current).join(' ')).toMatch(/canonical/);
    // report written before content-hashed versions
    expect(verifyIndexVersion(jsonl, base, { indexVersion: recorded.indexVersion }, current).join(' ')).toMatch(/no chunksHash/);
    // EMBEDDING_MODEL_ID changed since ingest (M7)
    expect(verifyIndexVersion(jsonl, base, recorded, { ...current, modelId: 'other' }).join(' ')).toMatch(/model other.*differs/);
  });
});

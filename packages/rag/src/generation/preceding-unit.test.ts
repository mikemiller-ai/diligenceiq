import type { Chunk } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { precedingFilingText } from '../retrieval/preceding-text';
import { briefCiting, fixtureChunk, fixtureRetriever } from './testing';
import { extractFigures, leadingTable, matchFigure, passageNumbers, precedingUnit, repairBrief, validateBrief, withPrecedingUnit } from './validate';

/**
 * The preceding-unit rule (architecture §6.9): a table's "(In millions)" caption that ends the
 * previous chunk of the same filing section supplies the unit for the table the cited chunk opens
 * with. The shapes are from META-FY2025-10K-FS-012 and the two tiny chunks before it.
 */
const CAPTION = 'See Accompanying Notes to Consolidated Financial Statements.91Table of ContentsMETA PLATFORMS, INC.CONSOLIDATED STATEMENTS OF CASH FLOWS(In millions)\n';
const TABLE = '| Year Ended December 31,\n| 2025 |  | 2024 |  | 2023\nNet income | $ | 60,458 |  |  | $ | 62,360 |  |  | $ | 39,098 |\nPurchases of property and equipment |  | (69,691) |  |  | (37,256) |  |  | (27,045) |\n';
const PROSE = 'Capital expenditures were driven by servers and data centers.\nOther amounts | 1,234 |  | 987 |\n';

/** A filing as consecutive chunks: each part is a chunk, abutting the previous one. */
function filing(parts: Array<{ text: string; section?: string; documentId?: string }>, start = 378_000): Chunk[] {
  let at = start;
  return parts.map((p, i) => {
    const c = fixtureChunk({ ticker: 'META', text: p.text, chunkIndex: 100 + i, charStart: at, charEnd: at + p.text.length, section: p.section ?? 'Item 8 — Financial Statements', documentId: p.documentId ?? 'META_10K_2025' });
    at += p.text.length;
    return c;
  });
}
const prevOf = (chunks: Chunk[]) => (c: Chunk) => chunks[chunks.indexOf(c) - 1];

function validate(cited: Chunk, chunks: Chunk[], finding: string) {
  const r = repairBrief({ ...briefCiting([]), keyFindings: [{ title: 'a', finding, basis: 'reported', tickers: ['META'], citationIds: [cited.chunkId] }] });
  if (!r.ok) throw new Error('repair failed');
  const byId = new Map(chunks.map((c) => [c.chunkId, c]));
  return validateBrief(r.brief, [], new Map([[cited.chunkId, cited.text]]), (id) => precedingFilingText(byId.get(id)!, prevOf(chunks))).validation.numeric;
}

describe('preceding-unit rule (unit caption in the previous chunk of the same filing section)', () => {
  it('verifies a figure via an adjacent-chunk "(In millions)" caption, exactly equal amounts only', () => {
    const chunks = filing([{ text: CAPTION }, { text: TABLE }]);
    const n = validate(chunks[1]!, chunks, 'Net income was $60,458 million; capex was $69.691 billion.');
    expect(n).toMatchObject({ total: 2, verified: 2, unitUnstated: 0 });
    expect(n.figures.map((f) => f.rule)).toEqual(['preceding_unit', 'preceding_unit']);
    // Without the lookup the same figures are only near matches (the pre-change behavior).
    const r = repairBrief({ ...briefCiting([]), keyFindings: [{ title: 'a', finding: 'Net income was $60,458 million.', basis: 'reported', tickers: ['META'], citationIds: [chunks[1]!.chunkId] }] });
    if (!r.ok) throw new Error('repair failed');
    expect(validateBrief(r.brief, [], new Map([[chunks[1]!.chunkId, TABLE]])).validation.numeric).toMatchObject({ verified: 0, unitUnstated: 1 });
  });

  it('works through Retriever.precedingText, across two tiny chunks, and leaves citations unchanged', () => {
    const chunks = filing([{ text: 'See Accompanying Notes.\n' }, { text: CAPTION }, { text: TABLE }]);
    const retriever = fixtureRetriever(chunks);
    expect(retriever.precedingText(chunks[2]!.chunkId)).toBe(`See Accompanying Notes.\n${CAPTION}`);
    expect(retriever.precedingText(chunks[0]!.chunkId)).toBeNull();
  });

  it('not verified when the caption is in a different document', () => {
    const chunks = filing([{ text: CAPTION, documentId: 'META_10K_2024' }, { text: TABLE }]);
    expect(validate(chunks[1]!, chunks, 'Net income was $60,458 million.')).toMatchObject({ verified: 0, unitUnstated: 1, figures: [{ rule: 'unit_unstated' }] });
  });

  it('not verified when the caption is in a different section', () => {
    const chunks = filing([{ text: CAPTION, section: 'Item 7 — MD&A' }, { text: TABLE }]);
    expect(validate(chunks[1]!, chunks, 'Net income was $60,458 million.')).toMatchObject({ verified: 0, unitUnstated: 1 });
  });

  it('not verified when the caption is more than two chunks back', () => {
    const chunks = filing([{ text: CAPTION }, { text: 'Table of Contents\n' }, { text: 'META PLATFORMS, INC.\n' }, { text: TABLE }]);
    expect(precedingFilingText(chunks[3]!, prevOf(chunks))).toBe('Table of Contents\nMETA PLATFORMS, INC.\n');
    expect(validate(chunks[3]!, chunks, 'Net income was $60,458 million.')).toMatchObject({ verified: 0, unitUnstated: 1 });
  });

  it('not verified when the chunks are not contiguous in the filing (a gap) or not consecutive', () => {
    const [a, b] = filing([{ text: CAPTION }, { text: TABLE }]);
    const gap = { ...b!, charStart: b!.charStart + 5, charEnd: b!.charEnd + 5 };
    expect(precedingFilingText(gap, () => a)).toBeNull();
    expect(precedingFilingText({ ...b!, chunkIndex: b!.chunkIndex + 1 }, () => a)).toBeNull();
  });

  it('not verified when the scaled amount is not exactly equal (no rounding under this rule)', () => {
    const chunks = filing([{ text: CAPTION }, { text: TABLE }]);
    // 60,458 in millions is $60.458 billion; "$60.5 billion" is a rounding, "$60,459 million" is wrong.
    expect(validate(chunks[1]!, chunks, 'Net income was $60.5 billion.')).toMatchObject({ verified: 0, unitUnstated: 0, figures: [{ rule: null }] });
    expect(validate(chunks[1]!, chunks, 'Net income was $60,459 million.')).toMatchObject({ verified: 0 });
    // Same digits, wrong scale: a millions table does not support "$60,458 billion" (not even as a near match).
    expect(validate(chunks[1]!, chunks, 'Net income was $60,458 billion.')).toMatchObject({ verified: 0, unitUnstated: 0 });
  });

  it('not verified when anything intervenes between the caption and the table', () => {
    // A heading after the caption, a caption that is a table row, prose before the table.
    for (const [before, cited] of [
      [`${CAPTION}Supplemental cash flow data\n`, TABLE],
      ['(In millions) | 2025 | 2024\n', TABLE],
      [CAPTION, `Net income was strong.\n${TABLE}`],
    ] as const) {
      const chunks = filing([{ text: before }, { text: cited }]);
      expect(validate(chunks[1]!, chunks, 'Net income was $60,458 million.').verified).toBe(0);
    }
    // "(in millions of shares)" is not a currency unit caption.
    expect(precedingUnit('Weighted-average shares (in millions of shares)')).toBeNull();
    expect(precedingUnit('(In millions, except per share amounts)')).toBe('million');
    expect(precedingUnit('(Dollars in billions)')).toBe('billion');
  });

  it('the caption covers only the leading table: a later table in the passage stays a near match', () => {
    const text = `${TABLE}${PROSE}`;
    expect(leadingTable(text)!.table).toBe(TABLE.slice(0, -1));
    const p = withPrecedingUnit(passageNumbers(text), text, CAPTION);
    const [later, inTable] = extractFigures('$1,234 million; $62,360 million');
    expect(matchFigure(later!, p)).toBe('unit_unstated');
    expect(matchFigure(inTable!, p)).toBe('preceding_unit');
  });

  it('an unscaled figure of 1,000 or more found only in the captioned table is refused (the unit was dropped)', () => {
    const p = withPrecedingUnit(passageNumbers(TABLE), TABLE, CAPTION);
    const [dropped] = extractFigures('$60,458');
    expect(matchFigure(dropped!, passageNumbers(TABLE))).toBe('exact');
    expect(matchFigure(dropped!, p)).toBeNull();
  });

  it('a passage that states its own unit ignores the preceding caption', () => {
    const own = `(In thousands)\n${TABLE}`;
    const p = withPrecedingUnit(passageNumbers(own), own, CAPTION);
    expect(p.preceding).toBeUndefined();
    expect(p.unit).toBe('thousand');
  });
});

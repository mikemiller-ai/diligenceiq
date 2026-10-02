/**
 * Preamble stripping and whitespace normalization (SPEC §24.2 step 4; architecture §6.1
 * steps 3–4; assumptions B6–B7).
 *
 * The body starts at the first match of the whitespace-tolerant, case-insensitive cover
 * heading. The exact string matches only 30/246 files ("STATESSECURITIES", newlines,
 * non-breaking spaces, LLY's mixed case); this pattern matches all 246.
 */
export const COVER_HEADING = /UNITED\s*STATES\s*SECURITIES\s*AND\s*EXCHANGE\s*COMMISSION/i;

/**
 * Normalization keeps every line break and table pipe, so pipe-delimited rows survive:
 * - non-breaking, figure, thin and other Unicode spaces become a plain space;
 * - zero-width characters and the BOM are removed;
 * - CRLF and CR become LF.
 * Runs of spaces are kept: collapsing them would change verbatim passages.
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '');
}

export interface ProcessedText {
  /** Normalized filing body from the cover heading on. Chunk offsets index into this. */
  text: string;
  /** Offset of the cover heading in the raw file. */
  bodyStartInRaw: number;
}

export function stripPreamble(raw: string, headerEnd: number, file = '(unknown)'): ProcessedText {
  const after = raw.slice(headerEnd);
  const m = COVER_HEADING.exec(after);
  if (!m) throw new Error(`${file}: cover heading not found`);
  return { text: normalizeWhitespace(after.slice(m.index)), bodyStartInRaw: headerEnd + m.index };
}

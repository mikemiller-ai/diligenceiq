import type { SectionKind } from '@diligenceiq/corpus';
import { tokenize } from '../index/tokenize';

/** The chunk fields signal detection reads. */
export interface SignalChunk {
  chunkId: string;
  documentId: string;
  sectionKind: SectionKind;
  boilerplate: boolean;
  charStart: number;
  charEnd: number;
  text: string;
}

/**
 * A section's text rebuilt from its chunks without the overlap: chunks are verbatim slices of
 * the processed filing text, so each one contributes only what lies past the previous end.
 */
export function sectionText(chunks: readonly SignalChunk[], documentId: string, kind: SectionKind): string {
  const own = chunks.filter((c) => c.documentId === documentId && c.sectionKind === kind && !c.boilerplate).sort((a, b) => a.charStart - b.charStart);
  let end = -1;
  let out = '';
  for (const c of own) {
    if (c.charEnd <= end) continue;
    const from = Math.max(0, end - c.charStart);
    out += (out && c.charStart > end ? '\n' : '') + c.text.slice(from);
    end = c.charEnd;
  }
  return out;
}

/** Words that carry no topic in a risk heading ("The Company's business … could be adversely affected"). */
const HEADING_STOP = new Set(
  (
    'company companys business result operation financial condition adversely adverse affect affected affecting impact impacted ' +
    'material materially significant significantly harm harmed could negatively negative reputation stock price ' +
    'apple microsoft nvidia inc corporation'
  ).split(' '),
);

/** Topic tokens of a heading or sentence (BM25 tokenizer, minus heading boilerplate words). */
export function topicTokens(text: string): Set<string> {
  return new Set(tokenize(text).filter((t) => !HEADING_STOP.has(t) && !/^\d+$/.test(t)));
}

/** Dice coefficient of two token sets. */
export function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

/** Sentences of a section, for the "is it still in the body?" check. Crude split; headings are glued to bodies. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])(?=\s*[A-Z“"])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30);
}

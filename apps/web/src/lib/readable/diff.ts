import { layoutBlocks } from './layout';
import { supportUnits } from './support';

/*
 * Sentence-level diff between a passage and the most similar passage of the same section in an
 * adjacent filing (DD-21 f; "Compare periods"). Deterministic: both sides are cut into the same units
 * as the key-sentence picker (sentences, list items, headings, table rows), and units are compared
 * after normalizing case, quotes, dashes and whitespace.
 * - unchanged: in both;
 * - changed: a later unit that differs from an earlier one only in its numbers is listed as new with
 *   the earlier wording (`was`), and that earlier unit is not listed again as removed;
 * - the two passages are chunks cut at different places, so each side is compared only between its
 *   first and last unit the other side shares (exactly or with changed numbers): the shared stretch.
 *   Outside it a unit may sit in a part of the other filing the other passage does not cover, so it
 *   is never called new or removed; it is only counted (`outsideLater`, `outsideEarlier`);
 * - new: a later unit inside the later stretch that the earlier passage lacks;
 * - removed: an earlier unit inside the earlier stretch that the later passage lacks.
 * With no unit in common there is no stretch, and nothing is called new or removed.
 */

export interface DiffUnit {
  text: string;
  /** For a new unit: the earlier wording when only the numbers changed. */
  was?: string;
}

export interface SentenceDiff {
  added: DiffUnit[];
  removed: DiffUnit[];
  unchanged: DiffUnit[];
  /** Units outside the shared stretch, not compared: later side, earlier side. */
  outsideLater: number;
  outsideEarlier: number;
}

export function normalizeUnit(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim();
}

const maskNumbers = (s: string) => s.replace(/\d[\d,.]*/g, '#');

/** A passage's units, in order. */
export function passageUnits(text: string): string[] {
  const blocks = layoutBlocks(text, 0, text.length);
  return supportUnits(text, blocks)
    .map((u) => text.slice(u.start, u.end).trim())
    .filter((t) => /[A-Za-z0-9]/.test(t));
}

/** The first and last index of `flags` that is true, or null. */
function stretch(flags: readonly boolean[]): [number, number] | null {
  const first = flags.indexOf(true);
  return first < 0 ? null : [first, flags.lastIndexOf(true)];
}

/** `later` and `earlier`: one passage each (the drawer passes this passage and the most similar adjacent one). */
export function sentenceDiff(later: string, earlier: string): SentenceDiff {
  const a = passageUnits(later);
  const b = passageUnits(earlier);
  const na = a.map(normalizeUnit);
  const nb = b.map(normalizeUnit);
  const inB = new Set(nb);
  const inA = new Set(na);
  // Pair a later unit with an earlier one (first unused) that differs only in its numbers.
  const earlierByMask = new Map<string, number[]>();
  nb.forEach((t, j) => {
    if (inA.has(t) || !/\d/.test(t)) return;
    const k = maskNumbers(t);
    earlierByMask.set(k, [...(earlierByMask.get(k) ?? []), j]);
  });
  const pairOf = new Map<number, number>();
  const pairedB = new Set<number>();
  na.forEach((t, i) => {
    if (inB.has(t) || !/\d/.test(t)) return;
    const j = earlierByMask.get(maskNumbers(t))?.find((x) => !pairedB.has(x));
    if (j === undefined) return;
    pairOf.set(i, j);
    pairedB.add(j);
  });
  const sa = stretch(na.map((t, i) => inB.has(t) || pairOf.has(i)));
  const sb = stretch(nb.map((t, j) => inA.has(t) || pairedB.has(j)));
  const inside = (s: [number, number] | null, i: number) => s !== null && i >= s[0] && i <= s[1];
  const added: DiffUnit[] = [];
  a.forEach((text, i) => {
    if (!inside(sa, i) || inB.has(na[i]!)) return;
    const j = pairOf.get(i);
    added.push(j === undefined ? { text } : { text, was: b[j]! });
  });
  const removed = b.filter((_, j) => inside(sb, j) && !inA.has(nb[j]!) && !pairedB.has(j)).map((text) => ({ text }));
  return {
    added: dedupe(added),
    removed: dedupe(removed),
    unchanged: dedupe(a.filter((_, i) => inB.has(na[i]!)).map((text) => ({ text }))),
    outsideLater: a.filter((_, i) => !inside(sa, i)).length,
    outsideEarlier: b.filter((_, j) => !inside(sb, j)).length,
  };
}

function dedupe(units: DiffUnit[]): DiffUnit[] {
  const seen = new Set<string>();
  return units.filter((u) => {
    const k = normalizeUnit(u.text);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

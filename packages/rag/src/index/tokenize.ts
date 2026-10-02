/**
 * BM25 tokenizer, shared by the offline indexer and the runtime query path so both see the
 * same terms. Deterministic, no model: lowercase, split on anything that is not a letter or
 * digit (keeping in-word dots and apostrophes such as "u.s." and "company's" together),
 * drop stopwords, and fold a plural "s".
 *
 * t2: decimals stay one token with their point ("1.2" is not "12"); dotted abbreviations still
 * fold ("u.s." → "us"); negations "no", "not" and "nor" are kept, because "no material
 * changes" must not match "material changes".
 */
const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its ' +
    'may might more most of on or other our ours shall should so some such than that the their them then there ' +
    'these they this those through to under until upon us was we were what when where which while who whom why will ' +
    'with would you your about above after again against all also am any because before being below between both ' +
    'during each few further here itself just me myself now once only own same she very'
  ).split(' '),
);

export const TOKENIZER_VERSION = 't2';

const DECIMAL = /^\d+(?:\.\d+)+$/;

function fold(token: string): string {
  if (DECIMAL.test(token)) return token;
  const t = token.replace(/['’]s$/, '').replace(/['’.]/g, '');
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us') && !t.endsWith('is')) return t.slice(0, -1);
  return t;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase().normalize('NFKD');
  for (const m of lower.matchAll(/[a-z0-9]+(?:['’.][a-z0-9]+)*/g)) {
    const raw = m[0];
    if (STOPWORDS.has(raw)) continue;
    const t = fold(raw);
    if (t.length < 2 && !/^\d$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

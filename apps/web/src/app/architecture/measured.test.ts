import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MEASURED } from './measured';

/*
 * Traceability (implementation plan row 7): every number on the Architecture page is recomputed
 * here from its record. A re-run eval or an edited doc that changes a number fails this test
 * until the page is updated to match.
 */

const ROOT = join(__dirname, '../../../../..');
const IV = 'iv-9cf51c066743';
const json = (f: string) => JSON.parse(readFileSync(join(ROOT, 'evals/results', f), 'utf8'));
const evaluationMd = readFileSync(join(ROOT, 'docs/evaluation.md'), 'utf8');

type GenSummary = {
  periodClaims: { claims: number; briefs: number };
  questions: number;
  passed: number;
  callsPerQuestion: number[];
  citationValidityPost: number;
  numericGrounding: number;
  figuresVerified: number;
  figuresTotal: number;
  injection: { passed: number; total: number };
  abstention: { passed: number; total: number };
};
/** Both sets run under the runtime prompt, da-v4; da-v5 was tried and reverted (evaluation.md §11). */
const MAIN_PROMPT = 'da-v4';
const ROBUST_PROMPT = 'da-v4';
type GenFile = { promptVersion: string; summary: GenSummary; records: GenRecord[] };
const mainFile = json(`generation-${IV}-${MAIN_PROMPT}.json`) as GenFile;
const robustFile = json(`generation-${IV}-${ROBUST_PROMPT}-robustness.json`) as GenFile;
expect(mainFile.promptVersion).toBe(MAIN_PROMPT);
expect(robustFile.promptVersion).toBe(ROBUST_PROMPT);
/** Billed vs coded Sonnet 4.6 rates (Cost Explorer, 2026-10-01..03). */
const idleCost = json('idle-cost-2026-10-03.json') as {
  prices: { bedrock_sonnet_4_6_billed_effective: { inputUsdPerMillion: number; outputUsdPerMillion: number }; bedrock_sonnet_4_6_code_table: { inputUsdPerMillion: number; outputUsdPerMillion: number } };
};
const main = mainFile.summary;
const robust = robustFile.summary;
const hybrid = (json(`retrieval-${IV}.json`).summaries as Array<{ mode: string; questions: number; passed: number }>).find((s) => s.mode === 'hybrid')!;
const profileFile = json(`profiles-${IV}-llm-v3.json`) as { summary: ProfileSummary; scores: Array<{ ticker: string; tier: string; mode: string }> };
const profiles = profileFile.summary;

type GenRecord = { id: string; score: { pass: boolean; answerType: string | null; periodClaims?: number; figures: { total: number; verified: number }; checks: Array<{ name: string; pass: boolean }> } };
type ProfileSummary = { profiles: number; citationValidity: number; figureMatch: number; bannedPhrases: number; deepTierFallbackRate: number };

/** The questions in a set with a category (the question files are the record of what each question tests). */
const categorized = (file: string, category: string): string[] => {
  const ids: string[] = [];
  let id: string | null = null;
  for (const line of readFileSync(join(ROOT, 'evals', file), 'utf8').split('\n')) {
    const m = /^\s*- id:\s*(\S+)/.exec(line);
    if (m) id = m[1]!;
    const c = /^\s*categories:\s*\[([^\]]*)\]/.exec(line);
    if (c && id && c[1]!.split(',').map((x) => x.trim()).includes(category)) ids.push(id);
  }
  return ids;
};

/** A section of evaluation.md, from its "## N." heading to the next one. */
const section = (n: number): string => {
  const at = evaluationMd.indexOf(`\n## ${n}. `);
  expect(at).toBeGreaterThan(-1);
  const next = evaluationMd.indexOf('\n## ', at + 1);
  return evaluationMd.slice(at, next < 0 ? undefined : next);
};

/** evaluation.md §5: the deployed runs' table, one record per run row, keyed by column header. */
const deployedRuns = (): Array<Record<string, string>> => {
  const rows = section(5).split('\n').filter((l) => l.startsWith('|'));
  const cells = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(rows[0]!);
  const runs = rows.slice(2).map((r) => Object.fromEntries(cells(r).map((c, i) => [header[i]!, c])));
  expect(runs.length).toBe(3);
  return runs;
};
/** The leading number of a cell: "63.8 s" → 63.8, "2,751 ms (download …)" → 2751, "$0.123" → 0.123. */
const lead = (cell: string): number => Number(/^\$?([\d,]+(?:\.\d+)?)/.exec(cell)![1]!.replace(/,/g, ''));
const column = (name: string): number[] => deployedRuns().map((r) => lead(r[name] ?? ''));

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const of = (a: number, b: number) => `${a} of ${b}`;

/** The adversarial questions of both sets, each resisted only if its brief passed every check. */
const adversarial = (): { passed: number; total: number } => {
  const recs = [...mainFile.records.filter((r) => categorized('questions.yaml', 'adversarial').includes(r.id)), ...robustFile.records.filter((r) => categorized('robustness.yaml', 'adversarial').includes(r.id))];
  return { passed: recs.filter((r) => r.score.pass).length, total: recs.length };
};

/** The expected value of each metric, computed from its source. */
const EXPECTED: Record<string, () => string> = {
  calls: () => {
    const calls = new Set([...main.callsPerQuestion, ...robust.callsPerQuestion]);
    expect(main.callsPerQuestion.length + robust.callsPerQuestion.length).toBe(26);
    return [...calls].join(',');
  },
  citations: () => {
    expect(robust.citationValidityPost).toBe(main.citationValidityPost);
    return pct(main.citationValidityPost).replace('.0%', '%');
  },
  grounding: () => pct(main.numericGrounding),
  pass: () => {
    // The detail's claim: five misses fail only on one or two figures, one only on comparison alignment.
    const misses = mainFile.records.filter((r) => !r.score.pass);
    const failed = misses.map((r) => r.score.checks.filter((c) => !c.pass).map((c) => c.name).join(','));
    expect(failed.filter((m) => m === 'figures grounded').length).toBe(5);
    expect(failed.filter((m) => m === 'comparison aligned').length).toBe(1);
    expect(misses.filter((r) => r.score.checks.some((c) => c.name === 'figures grounded' && !c.pass)).every((r) => [1, 2].includes(r.score.figures.total - r.score.figures.verified))).toBe(true);
    expect(misses.length).toBe(6);
    return of(main.passed, main.questions);
  },
  injection: () => {
    const a = adversarial();
    return of(a.passed, a.total);
  },
  abstention: () => {
    // The detail's claim: every abstention brief declines (insufficient_evidence).
    const recs = [...mainFile.records.filter((r) => categorized('questions.yaml', 'unsupported').includes(r.id)), ...robustFile.records.filter((r) => categorized('robustness.yaml', 'unsupported').includes(r.id))];
    expect(recs.length).toBe(main.abstention.total + robust.abstention.total);
    expect(recs.every((r) => r.score.answerType === 'insufficient_evidence')).toBe(true);
    return of(main.abstention.passed + robust.abstention.passed, main.abstention.total + robust.abstention.total);
  },
  periodClaims: () => {
    expect(mainFile.records.reduce((n, r) => n + (r.score.periodClaims ?? 0), 0)).toBe(main.periodClaims.claims);
    expect(section(12)).toContain(`${main.periodClaims.claims} claims in ${main.periodClaims.briefs} briefs`);
    return String(main.periodClaims.claims);
  },
  retrieval: () => of(hybrid.passed, hybrid.questions),
  e2e: () => {
    // Enqueue → COMPLETE (the admin CLI's clock; no browser request or polling), whole seconds.
    const s = column('Enqueue → COMPLETE');
    return `${Math.round(Math.min(...s))}–${Math.round(Math.max(...s))} s`;
  },
  cold: () => {
    // The one cold run's index load, in seconds to one decimal.
    const ms = column('Index load (S3 → memory)').filter((x) => x > 0);
    expect(ms.length).toBe(1);
    return `${(Math.round(ms[0]! / 100) / 10).toFixed(1)} s`;
  },
  cost: () => {
    const c = column('Est. cost');
    const cents = (x: number) => (Math.round(x * 100) / 100).toFixed(2);
    return `$${cents(Math.min(...c))}–${cents(Math.max(...c))}`;
  },
  profiles: () => {
    expect([profiles.citationValidity, profiles.figureMatch, profiles.bannedPhrases]).toEqual([1, 1, 0]);
    return String(profiles.profiles);
  },
  fallback: () => {
    const deep = profileFile.scores.filter((s) => s.tier === 'deep');
    const fell = deep.filter((s) => s.mode !== 'llm');
    expect(fell.length / deep.length).toBe(profiles.deepTierFallbackRate);
    expect(evaluationMd).toContain(`${fell.length}/${deep.length} (${Math.round(profiles.deepTierFallbackRate * 100)}%)`);
    return of(fell.length, deep.length);
  },
};

/** The numbers each detail or note states, recomputed from the same sources (in the order printed). */
const NUMBERS_IN_TEXT: Record<string, () => string[]> = {
  calls: () => [String(main.callsPerQuestion.length + robust.callsPerQuestion.length)],
  grounding: () => [String(main.figuresVerified), String(main.figuresTotal)],
  e2e: () => {
    const s5 = section(5);
    expect(s5).toContain('about 98% of the time');
    expect(s5).toContain('The first token arrives in about 1 s');
    return ['98', '1'];
  },
  cold: () => {
    expect(section(5)).toContain('for the 236 MB index in-region');
    return ['236'];
  },
  profiles: () => [String(profiles.citationValidity * 100), String(profiles.figureMatch * 100)],
  Retrieval: () => [String(hybrid.questions)],
  'Deep Analysis answers': () => {
    // "A later prompt, da-v5, was tried and reverted … (evaluation.md §11)": its results file and its section.
    const tried = json(`generation-${IV}-da-v5.json`) as GenFile;
    const sectionOf = Number(/^## (\d+)\. Prompt da-v5\b/m.exec(evaluationMd)![1]);
    expect(section(sectionOf)).toContain('reverted to da-v4');
    return [String(main.questions), String(robust.questions), mainFile.promptVersion.replace('da-v', ''), tried.promptVersion.replace('da-v', ''), String(sectionOf)];
  },
  periodClaims: () => [String(main.periodClaims.briefs), String(main.questions)],
  cost: () => {
    // "$3 / $15 … then in the code; billed 10% more": the coded rates and the billed premium, from the Cost Explorer record.
    const { bedrock_sonnet_4_6_billed_effective: billed, bedrock_sonnet_4_6_code_table: coded } = idleCost.prices;
    const premium = (b: number, c: number) => Math.round((b / c - 1) * 100);
    expect(premium(billed.outputUsdPerMillion, coded.outputUsdPerMillion)).toBe(premium(billed.inputUsdPerMillion, coded.inputUsdPerMillion));
    expect(section(5)).toContain('$3 / $15 per 1M tokens');
    return [String(coded.inputUsdPerMillion), String(coded.outputUsdPerMillion), String(premium(billed.inputUsdPerMillion, coded.inputUsdPerMillion))];
  },
  'Latency and cost in production': () => {
    // §5's header line: "Run 2026-10-02 with prompt da-v3".
    const m = /Run (\d{4})-(\d{2})-(\d{2}) with prompt da-v(\d+)/.exec(section(5))!;
    return [m[4]!, m[1]!, m[2]!, m[3]!];
  },
};
/** The numbers printed in a text ("da-v4" reads as 4; the model name, region and "S3" are names, not numbers). */
const numbersIn = (text: string): string[] => [...text.replace(/Sonnet \d+(?:\.\d+)?|us-east-\d|\bS3\b/g, '').matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, ''));

describe('Architecture page: measured numbers trace to their records', () => {
  const items = MEASURED.flatMap((g) => g.items);

  it('every metric has a recomputation, and none is left unchecked', () => {
    expect(items.map((i) => i.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const item of MEASURED.flatMap((g) => g.items)) {
    it(`${item.id}: "${item.value}" matches ${item.source}`, () => {
      expect(item.value).toBe(EXPECTED[item.id]!());
    });
  }

  for (const [id, text] of [...items.map((i) => [i.id, i.detail] as const), ...MEASURED.map((g) => [g.title, g.note] as const)]) {
    if (!numbersIn(text).length) continue;
    it(`${id}: every number in its text is recomputed`, () => {
      expect(NUMBERS_IN_TEXT[id], `no recomputation for the numbers in "${text}"`).toBeDefined();
      expect(numbersIn(text)).toEqual(NUMBERS_IN_TEXT[id]!());
    });
  }

  it('every source names its record', () => {
    for (const i of items) expect(i.source).toMatch(/evaluation\.md §\d/);
  });
});

#!/usr/bin/env -S pnpm exec tsx
/**
 * Retrieval-only evaluation (SPEC §41.1–41.2; testing-strategy §7). Runs every question in
 * `evals/questions.yaml` through query analysis, the planner, hybrid search and the context
 * builder, with no generation, and scores the context with deterministic checks
 * (packages/rag eval/retrieval-eval.ts). Each question runs in three modes, BM25 only, cosine
 * only and hybrid (RRF), which is the evidence for the embedding and fusion decisions.
 *
 *   pnpm eval:retrieval                 # cached query embeddings only (no AWS)
 *   pnpm eval:retrieval --embed         # embeds questions missing from the cache (Titan v2,
 *                                       # ~$0.000001 each; ask first)
 *   pnpm eval:retrieval --mode hybrid   # one mode
 *   pnpm eval:retrieval --verbose       # print each question's context chunk IDs
 *
 * Writes `evals/results/retrieval-<indexVersion>.json` and `.md`. Exit 1 if the question
 * file is invalid or a gold chunk ID is not in the index. A failing check is reported, not
 * fatal: the results are the record.
 *
 * Without `--embed`, a question with no cached query embedding is reported as "not embedded"
 * for the cosine and hybrid modes (it still runs in BM25) and is left out of those modes'
 * summaries; the run lists such questions so they can be embedded after a go-ahead.
 *
 * Gold recall@context (H6): questions with hand-picked `gold` chunk IDs report the share of
 * them in the context, overall and per company (packages/rag eval/retrieval-eval.ts).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  EvalFileSchema,
  type ModeSummary,
  type QuestionScore,
  type RetrievalMode,
  type RetrievalResult,
  evalFileIssues,
  scoreRetrieval,
  summarize,
} from '@diligenceiq/rag';
import { ROOT, arg, fail } from '../lib/common';
import { TITAN_PRICE_PER_1K, createQueryEmbedder } from '../lib/query-embed';
import { openIndex } from '../lib/retrieval';

const file = EvalFileSchema.parse(parse(readFileSync(join(ROOT, 'evals', 'questions.yaml'), 'utf8')));
const issues = evalFileIssues(file);
if (issues.length) fail(`evals/questions.yaml: ${issues.join('; ')}`);

const modeArg = arg('mode');
const modes: RetrievalMode[] = modeArg && modeArg !== 'true' ? [modeArg as RetrievalMode] : ['bm25', 'cosine', 'hybrid'];
const verbose = arg('verbose') === 'true';
const embedder = createQueryEmbedder({ live: arg('embed') === 'true' });

const { index, retriever, source } = await openIndex();
const indexVersion = index.manifest.indexVersion;
console.log(`eval:retrieval ${file.questions.length} questions × ${modes.join(', ')} over ${indexVersion} (${source})`);

const unknownGold = file.questions.flatMap((q) => (q.expect.gold ?? []).filter((id) => !retriever.chunk(id)).map((id) => `${q.id}: ${id}`));
if (unknownGold.length) fail(`gold chunk IDs not in ${indexVersion}: ${unknownGold.join('; ')}`);

/** Query vectors resolved once per question; null = no cached embedding and --embed is off. */
const vectors = new Map<string, Float32Array | null>();
async function vectorFor(text: string): Promise<Float32Array | null> {
  if (!vectors.has(text)) {
    try {
      vectors.set(text, await embedder.embed(text));
    } catch (e) {
      if (!/no cached query embedding/.test((e as Error).message)) throw e;
      vectors.set(text, null);
    }
  }
  return vectors.get(text)!;
}

interface Row {
  mode: RetrievalMode;
  score: QuestionScore;
  telemetry: RetrievalResult['telemetry'];
  plan: { strategy: string; lanes: string[] };
  chunkIds: string[];
  coverage: RetrievalResult['context']['coverage'];
  gaps: string[];
  notes: string[];
  detected: string[];
}
const rows: Row[] = [];
const notEmbedded: Array<{ mode: RetrievalMode; id: string }> = [];
const summaries: ModeSummary[] = [];
try {
  for (const mode of modes) {
    const scores: QuestionScore[] = [];
    for (const q of file.questions) {
      let embed: ((text: string) => Promise<Float32Array>) | null = null;
      if (mode !== 'bm25') {
        const v = await vectorFor(q.question);
        if (!v) {
          notEmbedded.push({ mode, id: q.id });
          console.log(`  [${mode}] NOT EMBEDDED ${q.id}: no cached query embedding (run with --embed after a go-ahead)`);
          continue;
        }
        embed = async () => v;
      }
      const r = await retriever.retrieve(q.question, {}, embed, { mode });
      const s = scoreRetrieval(q, r, (id) => retriever.chunk(id));
      scores.push(s);
      rows.push({
        mode,
        score: s,
        telemetry: r.telemetry,
        plan: { strategy: r.plan.strategy, lanes: r.plan.lanes.map((l) => `${l.id}(${l.quota})`) },
        chunkIds: r.context.chunkIds,
        coverage: r.context.coverage,
        gaps: r.analysis.gaps,
        notes: r.analysis.notes,
        detected: r.analysis.companies.map((c) => c.ticker),
      });
      const failed = s.checks.filter((c) => !c.pass);
      const gold = s.gold ? `, gold ${s.gold.hits}/${s.gold.total}` : '';
      console.log(`  [${mode}] ${s.pass ? 'PASS' : 'FAIL'} ${q.id}: ${s.contextChunks} chunks, ${s.tokenEstimate} tokens${gold}${failed.length ? ` — ${failed.map((c) => `${c.name}: ${c.detail}`).join(' | ')}` : ''}`);
      if (verbose) console.log(`      ${r.context.chunkIds.join(' ')}`);
    }
    const sum = summarize(mode, scores);
    summaries.push(sum);
    console.log(
      `  [${mode}] ${sum.passed}/${sum.questions} questions pass${scores.length < file.questions.length ? ` (${file.questions.length - scores.length} not embedded)` : ''}; company coverage ${sum.companyCoverage}, period coverage ${sum.periodCoverage}, evidence hit rate ${sum.evidenceHitRate}, gold recall@context ${sum.goldRecall} (${sum.goldHits}/${sum.goldTotal}), section precision ${sum.sectionPrecision}, on-topic share ${sum.relevantShare}; checks ${sum.checksPassed}/${sum.checksTotal}`,
    );
  }
} finally {
  embedder.close();
}
if (notEmbedded.length) {
  const ids = [...new Set(notEmbedded.map((n) => n.id))];
  console.log(`  NOT EMBEDDED (cosine/hybrid skipped; needs --embed, ~$0.000001 each): ${ids.join(', ')}`);
}
console.log(`  query embeddings: ${embedder.stats.cacheHits} cached, ${embedder.stats.liveCalls} live (${embedder.stats.inputTokens} tokens, ~$${((embedder.stats.inputTokens / 1000) * TITAN_PRICE_PER_1K).toFixed(6)})`);

const latency = (mode: RetrievalMode) => {
  const xs = rows.filter((r) => r.mode === mode).map((r) => r.telemetry.retrievalDurationMs - r.telemetry.embeddingDurationMs).sort((a, b) => a - b);
  return { p50: xs[Math.floor(xs.length / 2)] ?? 0, max: xs.at(-1) ?? 0 };
};

const outDir = join(ROOT, 'evals', 'results');
mkdirSync(outDir, { recursive: true });
const result = { indexVersion, ranAt: new Date().toISOString(), source, modes, summaries, notEmbedded, latencyMs: Object.fromEntries(modes.map((m) => [m, latency(m)])), rows };
writeFileSync(join(outDir, `retrieval-${indexVersion}.json`), `${JSON.stringify(result, null, 1)}\n`);

const md: string[] = [
  `# Retrieval eval — ${indexVersion}`,
  '',
  `Generated by \`pnpm eval:retrieval\` on ${new Date(result.ranAt).toLocaleDateString('en-CA')} (local). Retrieval only (no generation). ${file.questions.length} questions from \`evals/questions.yaml\`.`,
  '',
  '| Mode | Questions passing | Company coverage | Period coverage | Evidence hit rate | Gold recall@context (mean; hits/labeled) | Section precision | On-topic share | Checks | Search latency p50 / max (ms, excl. embedding) |',
  '|---|---|---|---|---|---|---|---|---|---|',
  ...summaries.map(
    (s) =>
      `| ${s.mode} | ${s.passed}/${s.questions} | ${s.companyCoverage} | ${s.periodCoverage} | ${s.evidenceHitRate} | ${s.goldRecall ?? 'n/a'} (${s.goldHits}/${s.goldTotal}) | ${s.sectionPrecision} | ${s.relevantShare} | ${s.checksPassed}/${s.checksTotal} | ${latency(s.mode as RetrievalMode).p50} / ${latency(s.mode as RetrievalMode).max} |`,
  ),
  '',
  'Section precision and on-topic share are informational (no pass bar): the mean share of context chunks in the question\'s `relevantSections`, or matching its `relevant` pattern. Gold recall@context is informational too: the share of hand-picked answering passages (`gold` in `evals/questions.yaml`) present in the context.',
  ...(notEmbedded.length ? ['', `Not embedded (cosine/hybrid not run; needs \`--embed\`): ${[...new Set(notEmbedded.map((n) => n.id))].join(', ')}.`] : []),
  '',
  '## Per question',
  '',
  `| Question | ${modes.join(' | ')} |`,
  `|---|${modes.map(() => '---').join('|')}|`,
  ...file.questions.map((q) => {
    const cells = modes.map((m) => {
      const row = rows.find((r) => r.mode === m && r.score.id === q.id);
      if (!row) return 'not embedded';
      const failed = row.score.checks.filter((c) => !c.pass).map((c) => c.name);
      const gold = row.score.gold ? `; gold ${row.score.gold.hits}/${row.score.gold.total}` : '';
      return `${row.score.pass ? 'pass' : `fail (${failed.join(', ')})`}${gold}`;
    });
    return `| \`${q.id}\` | ${cells.join(' | ')} |`;
  }),
  '',
  '## Gold recall@context per company',
  '',
  `| Question | Company | ${modes.join(' | ')} |`,
  `|---|---|${modes.map(() => '---').join('|')}|`,
  ...file.questions
    .filter((q) => q.expect.gold)
    .flatMap((q) => {
      const tickers = [...new Set(q.expect.gold!.map((id) => retriever.chunk(id)!.ticker))];
      return tickers.map((t) => {
        const cells = modes.map((m) => {
          const g = rows.find((r) => r.mode === m && r.score.id === q.id)?.score.gold?.perCompany[t];
          return g ? `${g.hits}/${g.total}` : 'not embedded';
        });
        return `| \`${q.id}\` | ${t} | ${cells.join(' | ')} |`;
      });
    }),
  '',
];
writeFileSync(join(outDir, `retrieval-${indexVersion}.md`), md.join('\n'));
console.log(`  wrote evals/results/retrieval-${indexVersion}.json and .md`);

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CompanyIntelligenceProfileSchema,
  ProfileSetManifestSchema,
  SIGNAL_CATEGORIES,
  findBannedPhrases,
  profileIntegrityIssues,
  type CompanyIntelligenceProfile,
} from '@diligenceiq/core';
import { companyCoverage, computeTrends, extractCompanyFacts, extractDrivers, extractRiskHeadings } from '@diligenceiq/corpus';
import { describe, expect, it } from 'vitest';
import { HAVE_CORPUS, company, realCorpus } from '../../../corpus/src/testing/corpus';
import type { GenerationClient, GenerationRequest, GenerationResponse } from '../generation/gateway';
import { assembleDeterministicProfile, deterministicSetId, type ProfileExtraction } from './assemble';
import { buildProfileSets, type BuildOptions } from './build';
import { scoreProfile } from './evaluate';
import { selectProfileEvidence } from './evidence';
import { MemoryLedger, type LedgerOutcome, type LocalOutcomeStore } from './ledger';
import { GENERAL_CONTEXT, TEMPLATE_VERSION, WHAT_CHANGED_TEMPLATE } from './library';
import { FACT_LABEL } from './metrics';
import {
  PROFILE_PROMPT_VERSION,
  PROFILE_TOOL_NAME,
  buildProfileUserMessage,
  llmSetId,
  profileBlockSourceIds,
  profileBlocks,
  profileRequestSha256,
  profileSuppliedIds,
  renderCompanyIntelligencePromptFile,
} from './prompt';
import { SYN_FS, SYN_HEADING, SYN_IV, SYN_MDA, SYN_OLD_FS, SYN_RISK, synChunks, synCompany, synExtraction, synWithOlderFact } from './testing';
import { PROFILE_VALIDATOR_VERSION, mergeProfile, validateProfileOutput, wordFigures, type ProfileSupplied, type ProfileToolOutput } from './validate';

const det = () => assembleDeterministicProfile({ extraction: synExtraction(), chunks: synChunks(), profileSetId: deterministicSetId(), builtAt: '2026-10-02' });

/** A valid model output for the synthetic company. */
function goodOutput(p: CompanyIntelligenceProfile): ProfileToolOutput {
  return {
    headline: 'Synthetic Co grew revenue while relying on a few customers.',
    executiveView: p.executiveView.map((e) => ({ dimension: e.dimension, summary: `${e.dimension} reads ${e.label.toLowerCase()} in the latest annual report.`, citationIds: [SYN_FS] })),
    signals: p.signals.map((s) => ({ signalId: s.signalId, headline: 'Operating margin widened', whatChanged: 'Operating margin rose to 25.0% from 20.0%.', whyThisMatters: 'A wider margin gives room to invest in the new capacity management describes.', citationIds: [SYN_FS, SYN_MDA] })),
    drivers: [],
    managementOutlook: { summary: 'Management expects steady demand and plans new capacity.', citationIds: [SYN_MDA] },
    recommendedDiligence: [{ question: 'How concentrated are Synthetic Co’s sales, and what protects them?', why: 'The annual report names customer concentration as a risk.', signalIds: [], citationIds: [SYN_RISK] }],
  };
}

const ALL = [SYN_FS, SYN_RISK, SYN_MDA];
const supplied: ProfileSupplied = { suppliedIds: new Set(ALL), excerptIds: new Set(ALL) };
const passage = (id: string) => synChunks().find((c) => c.chunkId === id)?.text;

describe('General context library (SPEC §32.7)', () => {
  it('has one entry per signal category and never names a company or states a figure', () => {
    expect(Object.keys(GENERAL_CONTEXT).sort()).toEqual([...SIGNAL_CATEGORIES].sort());
    const names = HAVE_CORPUS ? [...new Set(realCorpus().filings.map((f) => f.meta.company.split(/[ ,.]/)[0]!))].filter((n) => n.length > 3) : ['Apple', 'Microsoft', 'NVIDIA'];
    for (const text of [...Object.values(GENERAL_CONTEXT), ...Object.values(WHAT_CHANGED_TEMPLATE)]) {
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/\$|%/);
      for (const n of names) expect(text.toLowerCase(), n).not.toContain(` ${n.toLowerCase()} `);
      expect(findBannedPhrases(text)).toEqual([]);
    }
  });

  it('versions the deterministic set by templateVersion', () => {
    expect(deterministicSetId()).toBe(`det-v${TEMPLATE_VERSION}`);
    expect(det().version.templateVersion).toBe(TEMPLATE_VERSION);
  });
});

describe('deterministic profile (zero calls)', () => {
  it('is schema-valid, integrity-checked and labeled deterministic with no call', () => {
    const p = det();
    expect(CompanyIntelligenceProfileSchema.parse(p)).toBeTruthy();
    expect(profileIntegrityIssues(p)).toEqual([]);
    expect(p.generation).toMatchObject({ mode: 'deterministic', generationCallCount: 0 });
  });

  it('shows figures only from extraction, with the source row, under the dashboard labels', () => {
    const p = det();
    expect(p.facts.map((f) => f.metric)).toContain('Revenue');
    expect(p.facts.every((f) => Object.values(FACT_LABEL).includes(f.metric))).toBe(true);
    for (const f of p.facts) expect(p.citations.find((c) => c.chunkId === f.chunkId)!.text).toContain(f.rawRow);
    // Revenue growth labels both the "Revenue" and "Revenue growth" rows; Compare reads "Operating income".
    expect(p.trends.map((t) => t.metric)).toEqual(expect.arrayContaining(['Revenue', 'Revenue growth', 'Operating income', 'Operating margin']));
  });

  it('leaves suspect facts out and names them in the gaps', () => {
    const ex = synExtraction();
    ex.facts[0] = { ...ex.facts[0]!, suspect: 'net margin outside (−200%, 100%)' };
    const p = assembleDeterministicProfile({ extraction: ex, chunks: synChunks(), profileSetId: 'det-v1', builtAt: 'x' });
    expect(p.facts.some((f) => f.metric === 'Revenue' && f.period === 'FY2024')).toBe(false);
    expect(p.gaps.join(' ')).toMatch(/plausibility check: revenue FY2024/);
  });

  it('det-v2 templates: the short company name, the quarterly report only when there is one, revenue growth counted once (M8)', () => {
    const p = det();
    const text = p.recommendedDiligence.map((r) => `${r.question} ${r.why}`).join(' ');
    expect(text).toContain('What does Synthetic say');
    expect(text).not.toContain('Synthetic Co');
    // The synthetic company has no quarterly report (tenQ 0).
    expect(p.coverage.tenQ).toBe(0);
    expect(text).not.toMatch(/quarterly report/);
    const withQ = synExtraction();
    withQ.coverage = { ...withQ.coverage, tenQ: 2 };
    const q = assembleDeterministicProfile({ extraction: withQ, chunks: synChunks(), profileSetId: deterministicSetId(), builtAt: 'x' });
    const trendRecs = q.recommendedDiligence.filter((r) => q.signals.some((s) => s.type === 'TREND_CHANGE' && r.signalIds.includes(s.signalId)));
    expect(trendRecs.length).toBeGreaterThan(0);
    expect(trendRecs.every((r) => /latest quarterly report/.test(r.question))).toBe(true);
    // One revenue-growth trend labels two rows; growth evidence counts it once (+ nothing else here).
    expect(p.trends.filter((t) => t.metric === 'Revenue' || t.metric === 'Revenue growth')).toHaveLength(2);
    expect(p.coverage.byCategory.find((c) => c.category === 'growth')?.level).toBe('limited');
    // The management-outlook gap stays (a deterministic profile never has an outlook).
    expect(p.managementOutlook).toBeNull();
    expect(p.gaps).toContain('Management outlook is not summarized in this set.');
  });

  it('what the model saw does not depend on anything det-v2 changed (recommendations, evidence levels, gaps, template version)', () => {
    const p = det();
    const altered: CompanyIntelligenceProfile = {
      ...p,
      version: { ...p.version, templateVersion: '1', profileSetId: 'det-v1' },
      recommendedDiligence: [{ question: 'x', why: 'y', signalIds: [], citationIds: [SYN_RISK], tickers: ['SYN'] }],
      coverage: { ...p.coverage, byCategory: [] },
      gaps: [],
    };
    expect(profileBlocks(altered)).toEqual(profileBlocks(p));
  });

  it('explains signals with the labeled General context library, never as company analysis', () => {
    const p = det();
    expect(p.signals.length).toBeGreaterThan(0);
    for (const s of p.signals) {
      expect(s.whyThisMattersSource).toBe('general_context');
      expect(s.whyThisMatters).toBe(GENERAL_CONTEXT[s.category]);
    }
    expect(p.currentRisks[0]!.heading).toBe(SYN_HEADING);
  });
});

describe('profile validator (DD-16)', () => {
  it('accepts a grounded output', () => {
    const p = det();
    expect(validateProfileOutput(goodOutput(p), p, supplied, passage).validation).toMatchObject({ ok: true, failure: null });
  });

  it('rejects a citation that was not supplied', () => {
    const p = det();
    const o = goodOutput(p);
    o.signals[0]!.citationIds = ['OTHER-FY2024-10K-1A-009'];
    expect(validateProfileOutput(o, p, supplied, passage).validation).toMatchObject({ ok: false, failure: 'invalid_citations', invalidCitations: 1 });
  });

  it('accepts a figure only from a cited passage whose TEXT was in the excerpts, never one supplied only as an ID (H1)', () => {
    const p = det();
    const chunks = synChunks();
    chunks[2] = { ...chunks[2]!, text: `${chunks[2]!.text} It expects capital spending of $40 million.` };
    const text = (id: string) => chunks.find((c) => c.chunkId === id)?.text;
    const o = goodOutput(p);
    o.managementOutlook = { summary: 'Management cites $40 million of new capacity.', citationIds: [SYN_MDA] };
    expect(validateProfileOutput(o, p, supplied, text).validation.ok).toBe(true);
    const idOnly: ProfileSupplied = { suppliedIds: new Set(ALL), excerptIds: new Set([SYN_FS, SYN_RISK]) };
    expect(validateProfileOutput(o, p, idOnly, text).validation.failure).toBe('unsupported_figures');
  });

  it('rejects a figure that is not in FACTS (an exact restatement of a fact at another scale passes)', () => {
    const p = det();
    for (const bad of ['Revenue reached $1.3 billion.', 'Margin rose 7.5%.', 'Revenue was $1,250 million.']) {
      const o = goodOutput(p);
      o.headline = bad;
      expect(validateProfileOutput(o, p, supplied, passage).validation.failure, bad).toBe('unsupported_figures');
    }
    const ok = goodOutput(p);
    for (const good of ['Revenue reached $1,200 million in FY2024.', 'Revenue was $1.2 billion.', 'Growth of 20.0% in FY2024.']) {
      ok.headline = good;
      expect(validateProfileOutput(ok, p, supplied, passage).validation.ok, good).toBe(true);
    }
  });

  it('accepts a figure printed in a passage the same item cites, and only there (SPEC §32.2)', () => {
    const p = det();
    const withFigure = (cites: string[]) => {
      const o = goodOutput(p);
      o.managementOutlook = { summary: 'Two customers account for most of sales; management cites $40 million of new capacity.', citationIds: cites };
      return o;
    };
    // "$40 million" is in no passage: rejected even though the outlook cites one.
    expect(validateProfileOutput(withFigure([SYN_MDA]), p, supplied, passage).validation.failure).toBe('unsupported_figures');
    const chunks = synChunks();
    chunks[2] = { ...chunks[2]!, text: `${chunks[2]!.text} It expects capital spending of $40 million.` };
    const text = (id: string) => chunks.find((c) => c.chunkId === id)?.text;
    expect(validateProfileOutput(withFigure([SYN_MDA]), p, supplied, text).validation.ok).toBe(true);
    // The same figure, cited only by ANOTHER item, does not count.
    expect(validateProfileOutput(withFigure([SYN_RISK]), p, supplied, text).validation.failure).toBe('unsupported_figures');
  });

  it('reads points only as points: "N pp" / "N percentage points" must be printed as points in FACTS, never matched to a percentage (M6)', () => {
    const p = det();
    // FACTS prints "a change of 5.0 pp" (operating margin) and "20.0%" (revenue growth).
    for (const [text, ok] of [
      ['Operating margin rose 5.0 pp.', true],
      ['Operating margin rose 5.0 percentage points.', true],
      ['Operating margin rose 7.5 pp.', false],
      ['Operating margin rose 5.0%.', false],
      ['Revenue grew 20.0 percentage points.', false],
      ['Revenue grew 20.0%.', true],
    ] as const) {
      const o = goodOutput(p);
      o.headline = text;
      expect(validateProfileOutput(o, p, supplied, passage).validation.ok, text).toBe(ok);
    }
  });

  it('does not count a near match (unit_unstated) as grounded (M6)', () => {
    const p = det();
    const chunks = synChunks();
    // A bare table cell in a passage that states no unit: "$1,234 million" would only be a unit_unstated match.
    chunks[2] = { ...chunks[2]!, text: 'Segment | 1,234 | 1,100 |' };
    const text = (id: string) => chunks.find((c) => c.chunkId === id)?.text;
    const o = goodOutput(p);
    o.managementOutlook = { summary: 'Management describes $1,234 million of segment sales.', citationIds: [SYN_MDA] };
    expect(validateProfileOutput(o, p, supplied, text).validation.failure).toBe('unsupported_figures');
  });

  it('rejects a share or multiple stated in words, and "accelerated" against a Growing label', () => {
    const p = det();
    for (const [text, failure] of [
      ['Americas is roughly two-fifths of revenue.', 'unsupported_figures'],
      ['More than a quarter of total revenue.', 'unsupported_figures'],
      ['Sales nearly doubled.', 'unsupported_figures'],
      ['Synthetic Co accelerated revenue growth in FY2024.', 'label_conflict'],
      ['Revenue growth accelerated in FY2024.', 'label_conflict'],
      ['Half of the year passed; a third-party supplier; accelerating investment in capacity.', null],
      ['Margins held over the last two quarters and the first three quarters of the year.', null],
      ['Three quarters of revenue came from one segment.', 'unsupported_figures'],
      ['Operating margin rose five percentage points.', 'unsupported_figures'],
      ['Sales rose ten percent.', 'unsupported_figures'],
    ] as const) {
      const o = goodOutput(p);
      o.headline = text;
      expect(validateProfileOutput(o, p, supplied, passage).validation.failure, text).toBe(failure);
    }
  });

  it('rejects banned vocabulary in any model-written field', () => {
    const p = det();
    const o = goodOutput(p);
    o.recommendedDiligence[0]!.why = 'The shares look undervalued.';
    expect(validateProfileOutput(o, p, supplied, passage).validation).toMatchObject({ ok: false, failure: 'banned_phrases', bannedPhrases: 1 });
  });

  it('rejects an invented signal, driver or dimension', () => {
    const p = det();
    const o = goodOutput(p);
    o.signals.push({ ...o.signals[0]!, signalId: 'SYN-NEW-made-up' });
    expect(validateProfileOutput(o, p, supplied, passage).validation.failure).toBe('invented_item');
    const o2 = goodOutput(p);
    o2.executiveView.push({ dimension: 'Valuation', summary: 'x', citationIds: [SYN_FS] });
    expect(validateProfileOutput(o2, p, supplied, passage).validation.failure).toBe('invented_item');
  });

  it('rejects a missing or malformed tool call', () => {
    const p = det();
    expect(validateProfileOutput(null, p, supplied, passage).validation.failure).toBe('malformed_output');
    expect(validateProfileOutput({ headline: 'x' }, p, supplied, passage).validation.failure).toBe('schema');
  });

  it('figures in words: number words with percent or points count; time phrases do not (LOW)', () => {
    expect(wordFigures('over the last two quarters')).toEqual([]);
    expect(wordFigures('in the second half of the year')).toEqual([]);
    expect(wordFigures('a quarter of total revenue')).toEqual(['a quarter of total revenue']);
    expect(wordFigures('twenty-five percent of sales')).toEqual(['twenty-five percent']);
  });

  it('merges the narrative without touching facts, trends, measurements or evidence', () => {
    const p = det();
    const merged = mergeProfile(p, goodOutput(p), {
      profileSetId: llmSetId(),
      profilePromptVersion: PROFILE_PROMPT_VERSION,
      modelId: 'm',
      ledgerRunId: 'run',
      inputTokens: 1,
      outputTokens: 2,
      chunks: new Map(synChunks().map((c) => [c.chunkId, c])),
    });
    expect(merged.facts).toEqual(p.facts);
    expect(merged.trends).toEqual(p.trends);
    expect(merged.currentRisks).toEqual(p.currentRisks);
    expect(merged.signals.map((s) => [s.measurement, s.evidenceByPeriod, s.whyThisMattersSource])).toEqual(p.signals.map((s) => [s.measurement, s.evidenceByPeriod, 'model']));
    expect(merged.executiveView.map((e) => e.label)).toEqual(p.executiveView.map((e) => e.label));
    expect(merged.generation).toMatchObject({ mode: 'llm', generationCallCount: 1, ledgerRunId: 'run' });
    expect(merged.version).toMatchObject({ profileSetId: llmSetId(), profilePromptVersion: PROFILE_PROMPT_VERSION });
    expect(merged.citations.map((c) => c.chunkId)).toContain(SYN_MDA);
    // H4: the model's headline is kept; deterministic profiles have none.
    expect(merged.headline).toBe(goodOutput(p).headline);
    expect(p.headline).toBeUndefined();
  });

  it('a model-written item carries the model citations only; signal evidence stays deterministic (M5)', () => {
    const p = det();
    const o = goodOutput(p);
    o.signals = o.signals.map((s) => ({ ...s, citationIds: [SYN_MDA] }));
    o.executiveView = o.executiveView.map((e) => ({ ...e, citationIds: [SYN_RISK] }));
    const merged = mergeProfile(p, o, { profileSetId: llmSetId(), profilePromptVersion: PROFILE_PROMPT_VERSION, modelId: 'm', ledgerRunId: 'r', inputTokens: 1, outputTokens: 1, chunks: new Map(synChunks().map((c) => [c.chunkId, c])) });
    expect(merged.signals.every((s) => s.citationIds.length === 1 && s.citationIds[0] === SYN_MDA)).toBe(true);
    expect(merged.signals.map((s) => s.evidenceByPeriod)).toEqual(p.signals.map((s) => s.evidenceByPeriod));
    expect(merged.executiveView.every((e) => e.citationIds.join() === SYN_RISK)).toBe(true);
    expect(profileIntegrityIssues(merged)).toEqual([]);
  });
});

/** A fake model: counts requests; returns `output` or throws `error`. */
function fakeClient(make: (req: GenerationRequest) => unknown, error?: Error): GenerationClient & { requests: GenerationRequest[] } {
  const requests: GenerationRequest[] = [];
  return {
    modelId: 'fake-model',
    requests,
    async generate(req): Promise<GenerationResponse> {
      requests.push(req);
      if (error) throw error;
      return { modelId: 'fake-model', toolInput: make(req), text: '', stopReason: 'tool_use', inputTokens: 100, outputTokens: 50, durationMs: 5, firstTokenMs: null };
    },
  };
}

const fakeRetriever = { retrieve: async () => ({ context: { chunkIds: [SYN_MDA] } }) } as unknown as BuildOptions['retriever'];

function buildOpts(overrides: Partial<BuildOptions>): BuildOptions & { written: Map<string, unknown> } {
  const written = new Map<string, unknown>();
  const chunks = synChunks();
  return {
    indexVersion: SYN_IV,
    builtAt: '2026-10-02',
    runId: 'run-1',
    companies: [{ extraction: synExtraction(), chunks }],
    chunk: (id) => chunks.find((c) => c.chunkId === id),
    retriever: fakeRetriever,
    llm: true,
    maxCalls: 5,
    ledgerBucket: 'test-bucket',
    write: async (set, name, body) => void written.set(`${set}/${name}`, body),
    written,
    ...overrides,
  };
}

describe('offline build and ledger (SPEC §32.4)', () => {
  it('builds the deterministic set with zero calls and a manifest the api reads', async () => {
    const o = buildOpts({ llm: false, maxCalls: 0 });
    const r = await buildProfileSets(o);
    expect(r.callsMade).toBe(0);
    const m = ProfileSetManifestSchema.parse(o.written.get(`${deterministicSetId()}/manifest.json`));
    expect(m).toMatchObject({ indexVersion: SYN_IV, profileSetId: deterministicSetId() });
    expect(m.companies[0]).toMatchObject({ ticker: 'SYN', mode: 'deterministic', generationCallCount: 0 });
  });

  it('makes one call per company, writes the ledger entry before it, and builds an llm profile', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    let entryBeforeCall = false;
    const client = fakeClient((req) => {
      entryBeforeCall = ledger.entries.has('SYN');
      expect(req.tool.name).toBe(PROFILE_TOOL_NAME);
      return goodOutput(det());
    });
    const o = buildOpts({ ledger, client });
    const r = await buildProfileSets(o);
    expect(client.requests).toHaveLength(1);
    expect(entryBeforeCall).toBe(true);
    expect(r.callsMade).toBe(1);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'llm', generationCallCount: 1, headline: expect.any(String), promptVerified: true });
    const written = o.written.get(`${llmSetId()}/SYN.json`) as CompanyIntelligenceProfile;
    expect(written.generation.mode).toBe('llm');
    expect(written.headline).toBe(goodOutput(det()).headline);
    // The outcome records the hash of the exact request; the request carries a timeout.
    expect(ledger.outcomes.get('SYN')!.promptSha256).toBe(profileRequestSha256(client.requests[0]!.user));
    expect(client.requests[0]!.signal).toBeInstanceOf(AbortSignal);
    // M3/M4: the manifests name the validator, the templates and the ledger bucket.
    expect(r.llm).toMatchObject({ validatorVersion: PROFILE_VALIDATOR_VERSION, templateVersion: TEMPLATE_VERSION, ledgerBucket: 'test-bucket' });
    expect(r.det).toMatchObject({ validatorVersion: PROFILE_VALIDATOR_VERSION, templateVersion: TEMPLATE_VERSION });
  });

  it('cites against exactly the SOURCE_IDs in the message: a chunk the profile cites but the message never printed is invalid (H1)', async () => {
    const { extraction, chunks } = synWithOlderFact();
    const p = assembleDeterministicProfile({ extraction, chunks, profileSetId: deterministicSetId(), builtAt: 'x' });
    expect(p.citations.map((c) => c.chunkId)).toContain(SYN_OLD_FS);
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const client = fakeClient((req) => {
      expect(req.user).not.toContain(SYN_OLD_FS);
      return { ...goodOutput(p), recommendedDiligence: [{ question: 'Q?', why: 'W.', signalIds: [], citationIds: [SYN_OLD_FS] }] };
    });
    const r = await buildProfileSets(buildOpts({ ledger, client, companies: [{ extraction, chunks }], chunk: (id) => chunks.find((c) => c.chunkId === id) }));
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', failure: 'invalid_citations' });
  });

  it('the supplied set is exactly the SOURCE_IDs printed in the user message', async () => {
    for (const { extraction, chunks } of [{ extraction: synExtraction(), chunks: synChunks() }, synWithOlderFact()]) {
      const p = assembleDeterministicProfile({ extraction, chunks, profileSetId: deterministicSetId(), builtAt: 'x' });
      const ev = await selectProfileEvidence(p, (id) => chunks.find((c) => c.chunkId === id), fakeRetriever);
      const msg = buildProfileUserMessage(p, ev.text);
      const printed = new Set<string>();
      for (const m of msg.matchAll(/\[SOURCE_ID: ([^\]]+)\]|^SOURCE_ID: (\S+)$/gm)) for (const id of (m[1] ?? m[2])!.split(', ')) printed.add(id);
      for (const m of msg.matchAll(/^ {2}EVIDENCE: (.+)$/gm)) for (const part of m[1]!.split(' | ')) for (const id of part.replace(/^[^:]+: /, '').split(', ')) printed.add(id);
      expect([...profileSuppliedIds(p, ev.chunkIds)].sort()).toEqual([...printed].sort());
      for (const id of profileBlockSourceIds(p)) expect(Object.values(profileBlocks(p)).join('\n')).toContain(id);
    }
  });

  it('never calls twice for a key, even from a fresh process: the stored outcome is re-validated instead', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    await buildProfileSets(buildOpts({ ledger, client: fakeClient(() => goodOutput(det())) }));
    const second = fakeClient(() => goodOutput(det()));
    const o = buildOpts({ ledger, client: second, runId: 'run-2' });
    const r = await buildProfileSets(o);
    expect(second.requests).toHaveLength(0);
    expect(r.callsMade).toBe(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'llm', generationCallCount: 1, reusedOutcome: true, ledgerRunId: 'run-1', promptVerified: true });
  });

  it('re-validates a stored outcome against the RECOMPUTED request: a changed request is stale_outcome, never a new call (H1)', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    await ledger.claim({ ticker: 'SYN', indexVersion: SYN_IV, profilePromptVersion: PROFILE_PROMPT_VERSION, startedAt: 't', runId: 'old' });
    const stored: LedgerOutcome = { ticker: 'SYN', runId: 'old', finishedAt: 't', modelId: 'm', toolInput: goodOutput(det()), stopReason: 'tool_use', inputTokens: 1, outputTokens: 1, durationMs: 1, error: null, suppliedIds: ALL, promptSha256: 'f'.repeat(64) };
    await ledger.recordOutcome(stored);
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger, client }));
    expect(client.requests).toHaveLength(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 1, failure: 'stale_outcome', promptVerified: false });
  });

  it('a stored outcome without a request hash (llm-v3) is re-validated and marked promptVerified: false', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    await ledger.claim({ ticker: 'SYN', indexVersion: SYN_IV, profilePromptVersion: PROFILE_PROMPT_VERSION, startedAt: 't', runId: 'v3' });
    // Even if the stored suppliedIds claim more, citations are checked against the recomputed message.
    await ledger.recordOutcome({ ticker: 'SYN', runId: 'v3', finishedAt: 't', modelId: 'm', toolInput: goodOutput(det()), stopReason: 'tool_use', inputTokens: 1, outputTokens: 1, durationMs: 1, error: null, suppliedIds: [...ALL, 'SYN-X'] });
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger, client }));
    expect(client.requests).toHaveLength(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'llm', promptVerified: false, reusedOutcome: true });
  });

  it('a claim that errors (not a conflict) makes no call, records nothing and counts nothing (M1)', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const broken = Object.assign(Object.create(ledger) as MemoryLedger, {
      claim: async () => {
        throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' });
      },
    });
    const client = fakeClient(() => goodOutput(det()));
    const o = buildOpts({ ledger: broken, client });
    const r = await buildProfileSets(o);
    expect(client.requests).toHaveLength(0);
    expect(ledger.outcomes.size).toBe(0);
    expect(r.callsMade).toBe(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 0, failure: 'ledger_error' });
    expect((o.written.get(`${llmSetId()}/SYN.json`) as CompanyIntelligenceProfile).generation.generationCallCount).toBe(0);
  });

  it('keeps a local copy before the ledger write; a failed ledger write never stops the run, and the copy is reused later (M2)', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const failing = Object.assign(Object.create(ledger) as MemoryLedger, {
      recordOutcome: async () => {
        throw new Error('SlowDown');
      },
    });
    const local = new Map<string, LedgerOutcome>();
    const localOutcomes: LocalOutcomeStore = { read: async (t) => local.get(t) ?? null, write: async (out) => void local.set(out.ticker, out) };
    const logs: string[] = [];
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger: failing, client, localOutcomes, log: (m) => logs.push(m) }));
    expect(client.requests).toHaveLength(1);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'llm', generationCallCount: 1 });
    expect(local.get('SYN')!.promptSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(logs.join('\n')).toMatch(/recording the outcome in the ledger FAILED/);
    expect(ledger.outcomes.size).toBe(0);
    // Next run: the entry exists, the ledger has no outcome, the local copy is used (no call, not "interrupted").
    const again = fakeClient(() => goodOutput(det()));
    const r2 = await buildProfileSets(buildOpts({ ledger, client: again, localOutcomes, runId: 'run-2' }));
    expect(again.requests).toHaveLength(0);
    expect(r2.llm!.companies[0]).toMatchObject({ mode: 'llm', reusedOutcome: true, promptVerified: true });
  });

  it('counts an interrupted call (entry, no outcome) and falls back without calling', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    await ledger.claim({ ticker: 'SYN', indexVersion: SYN_IV, profilePromptVersion: PROFILE_PROMPT_VERSION, startedAt: 't', runId: 'crashed' });
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger, client }));
    expect(client.requests).toHaveLength(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 1, failure: 'interrupted', ledgerRunId: 'crashed' });
  });

  it('falls back with count 1 when the call errors, and never retries at the same version', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const failing = fakeClient(() => null, Object.assign(new Error('ThrottlingException'), { name: 'ThrottlingException' }));
    const r = await buildProfileSets(buildOpts({ ledger, client: failing }));
    expect(failing.requests).toHaveLength(1);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 1, failure: 'generation_error' });
    const again = fakeClient(() => goodOutput(det()));
    const r2 = await buildProfileSets(buildOpts({ ledger, client: again }));
    expect(again.requests).toHaveLength(0);
    expect(r2.llm!.companies[0]!.failure).toBe('generation_error');
  });

  it('falls back with count 1 when the output fails validation', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const bad = fakeClient(() => ({ ...goodOutput(det()), headline: 'A strong buy.' }));
    const o = buildOpts({ ledger, client: bad });
    const r = await buildProfileSets(o);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 1, failure: 'banned_phrases' });
    const fb = o.written.get(`${llmSetId()}/SYN.json`) as CompanyIntelligenceProfile;
    expect(fb.version.profileSetId).toBe(llmSetId());
    expect(fb.signals.every((s) => s.whyThisMattersSource === 'general_context')).toBe(true);
  });

  it('the cap stops partway: two companies, maxCalls 1 → exactly one call; the second gets max_calls_reached', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const a = synCompany('SYA');
    const b = synCompany('SYB');
    const all = [...a.chunks, ...b.chunks];
    const client = fakeClient((req) => {
      const t = /\((SY[AB])\)/.exec(req.user)![1]!;
      const company = t === 'SYA' ? a : b;
      const p = assembleDeterministicProfile({ ...company, profileSetId: deterministicSetId(), builtAt: 'x' });
      const rename = <T,>(x: T): T => JSON.parse(JSON.stringify(x).replaceAll('SYN', t)) as T;
      return rename(goodOutput(p));
    });
    const retriever = { retrieve: async (_q: string, f: { tickers: string[] }) => ({ context: { chunkIds: [`${f.tickers[0]}-FY2024-10K-MDA-001`] } }) } as unknown as BuildOptions['retriever'];
    const r = await buildProfileSets(buildOpts({ ledger, client, maxCalls: 1, companies: [a, b], chunk: (id) => all.find((c) => c.chunkId === id), retriever }));
    expect(client.requests).toHaveLength(1);
    expect(r.callsMade).toBe(1);
    expect(r.llm!.companies.map((c) => [c.ticker, c.mode, c.failure ?? null, c.generationCallCount])).toEqual([
      ['SYA', 'llm', null, 1],
      ['SYB', 'deterministic', 'max_calls_reached', 0],
    ]);
  });

  it('stops calling at --max-calls; the rest get their deterministic profile with no call', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger, client, maxCalls: 0 }));
    expect(client.requests).toHaveLength(0);
    expect(ledger.entries.size).toBe(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', generationCallCount: 0, failure: 'max_calls_reached' });
  });

  it('a prompt version bump is a new ledger key; a ledger for another version is refused', async () => {
    const old = new MemoryLedger(SYN_IV, '0');
    await expect(buildProfileSets(buildOpts({ ledger: old, client: fakeClient(() => goodOutput(det())) }))).rejects.toThrow(/ledger is for/);
    expect(llmSetId('2')).toBe('llm-v2');
  });

  it('requires maxCalls, and the LLM set requires a ledger and a client', async () => {
    await expect(buildProfileSets(buildOpts({ maxCalls: Number.NaN }))).rejects.toThrow(/maxCalls is required/);
    await expect(buildProfileSets(buildOpts({}))).rejects.toThrow(/ledger and a model client/);
  });

  it('a concurrent claim by another process means no call from this one', async () => {
    const ledger = new MemoryLedger(SYN_IV, PROFILE_PROMPT_VERSION);
    // spent() is read at the start; another process claims before this one's beforeCall.
    const racing = Object.assign(Object.create(ledger) as MemoryLedger, {
      spent: async () => new Set<string>(),
      claim: async () => 'exists' as const,
    });
    const client = fakeClient(() => goodOutput(det()));
    const r = await buildProfileSets(buildOpts({ ledger: racing, client }));
    expect(client.requests).toHaveLength(0);
    expect(r.callsMade).toBe(0);
    expect(r.llm!.companies[0]).toMatchObject({ mode: 'deterministic', failure: 'ledger_race' });
  });
});

describe('profile eval (testing-strategy §7)', () => {
  const merged = (o: ProfileToolOutput) =>
    mergeProfile(det(), o, { profileSetId: llmSetId(), profilePromptVersion: PROFILE_PROMPT_VERSION, modelId: 'm', ledgerRunId: 'r', inputTokens: 1, outputTokens: 1, chunks: new Map(synChunks().map((c) => [c.chunkId, c])) });
  const ids = new Set(synChunks().map((c) => c.chunkId));
  const docs = { tenK: 1, tenQ: 0 };

  it('checks model-written citations against the recomputed request, and the tier against the index documents (M5)', () => {
    const p = merged(goodOutput(det()));
    expect(scoreProfile(p, { indexChunkIds: ids, documents: docs, supplied }).citations.invalid).toEqual([]);
    const narrow: ProfileSupplied = { suppliedIds: new Set([SYN_FS, SYN_RISK]), excerptIds: new Set([SYN_FS, SYN_RISK]) };
    expect(scoreProfile(p, { indexChunkIds: ids, documents: docs, supplied: narrow }).citations.invalid.join(' ')).toMatch(/SYN-FY2024-10K-MDA-001 \(not in the recomputed request\)/);
    expect(scoreProfile(p, { indexChunkIds: ids, documents: docs, supplied }).tierCorrect).toBe(true);
    // The profile says limited_history; the index has 3 annual and 6 quarterly reports: deep.
    expect(scoreProfile(p, { indexChunkIds: ids, documents: { tenK: 3, tenQ: 6 }, supplied }).tierCorrect).toBe(false);
    expect(() => scoreProfile(p, { indexChunkIds: ids, documents: docs })).toThrow(/recomputed supplied set/);
  });

  it('scores the headline like the validator: no citations, so its figures must be in FACTS; banned phrases count (H4)', () => {
    const o = goodOutput(det());
    o.headline = 'Revenue reached $1,200 million.';
    expect(scoreProfile(merged(o), { indexChunkIds: ids, documents: docs, supplied }).figures.unmatched).toEqual([]);
    const bad = merged(o);
    bad.headline = 'Revenue reached $9,999 million; a strong buy.';
    const s = scoreProfile(bad, { indexChunkIds: ids, documents: docs, supplied });
    expect(s.figures.unmatched.join(' ')).toMatch(/headline: \$9,999 million/);
    expect(s.banned.join(' ')).toMatch(/headline: strong buy/);
  });
});

describe('isolation from the runtime', () => {
  it('the package main entry (what the worker bundles) exports nothing of the offline build', async () => {
    const main = await import('../index');
    for (const name of ['PROFILE_TOOL_NAME', 'PROFILE_SYSTEM_PROMPT', 'buildProfileSets', 'MemoryLedger', 'assembleDeterministicProfile']) expect(Object.keys(main), name).not.toContain(name);
  });
});

describe('profile prompt', () => {
  it('prompts/company-intelligence-prompt.md matches the runtime prompt (pnpm prompts:render)', () => {
    expect(readFileSync(join(__dirname, '../../../../prompts/company-intelligence-prompt.md'), 'utf8')).toBe(renderCompanyIntelligencePromptFile());
  });

  it('puts FACTS, SIGNALS, RISKS, DRIVERS and DIMENSIONS before the untrusted excerpts', () => {
    const msg = buildProfileUserMessage(det(), '<filing_excerpts>\nx\n</filing_excerpts>');
    const order = ['FACTS', 'SIGNALS', 'RISKS', 'DRIVERS', 'DIMENSIONS', '<filing_excerpts>'].map((k) => msg.indexOf(k));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(msg).toContain('$1,200 million');
    expect(msg).not.toContain('{{');
  });
});

/** The extraction exactly as scripts/ingestion/extract.ts writes it. */
function extractionOf(ticker: string): ProfileExtraction {
  const own = company(ticker);
  const facts = extractCompanyFacts(own.filings, own.chunks);
  const tenKs = own.filings.filter((f) => f.meta.filingType === '10-K').sort((a, b) => a.meta.periodEnd.localeCompare(b.meta.periodEnd));
  const latest = tenKs.at(-1)!;
  return {
    indexVersion: 'iv-corpus',
    coverage: companyCoverage(own.filings.map((f) => f.meta))[0]!,
    facts,
    trends: computeTrends(facts),
    drivers: extractDrivers(latest, own.chunks),
    riskHeadings: tenKs.map((f) => ({ documentId: f.meta.documentId, fiscalLabel: f.meta.fiscalLabel, periodEnd: f.meta.periodEnd, headings: extractRiskHeadings(f, own.chunks) })),
    latestRiskHeadingsDocument: latest.meta.documentId,
  };
}

describe.skipIf(!HAVE_CORPUS)('deterministic profiles on the real corpus (every tier)', () => {
  it.each([
    ['AAPL', 'deep'],
    ['META', 'partial'],
    ['ADBE', 'limited_history'],
  ])('%s (%s) is schema-valid with sourced figures, verbatim risks and General context only', (ticker, tier) => {
    const p = assembleDeterministicProfile({ extraction: extractionOf(ticker), chunks: company(ticker).chunks, profileSetId: 'det-v1', builtAt: 'x' });
    expect(p.coverage.tier).toBe(tier);
    expect(profileIntegrityIssues(p)).toEqual([]);
    expect(p.facts.length).toBeGreaterThan(0);
    expect(p.currentRisks.length).toBeGreaterThan(0);
    expect(p.signals.every((s) => s.whyThisMattersSource === 'general_context' && (s.type === 'PERSISTENT' || s.type === 'TREND_CHANGE'))).toBe(true);
    if (tier === 'limited_history') {
      expect(p.signals.some((s) => s.type === 'PERSISTENT')).toBe(false);
      expect(p.gaps.join(' ')).toMatch(/Limited history/);
    }
    const narrative = [...p.executiveView.map((e) => e.summary), ...p.recommendedDiligence.flatMap((r) => [r.question, r.why]), ...p.drivers.map((d) => d.explanation)].join(' ');
    expect(findBannedPhrases(narrative)).toEqual([]);
  });
});

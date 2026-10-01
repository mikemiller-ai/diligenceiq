# DiligenceIQ — Implementation Plan

> Status: **Revision 2 (2026-10-01), adversary fixes applied.** Revision 1 was derived from the approved Phase 0 plan. Revision 2 re-baselines the product on the product direction (investment intelligence first; archived at [`archive/PRODUCT_DIRECTION.md`](archive/PRODUCT_DIRECTION.md) and consolidated into [SPEC v2](../SPEC.md)) and keeps the technical architecture. Design detail lives in [architecture.md](architecture.md); tests in [testing-strategy.md](testing-strategy.md); the decisions behind the change are DD-15 to DD-19 in [design-decisions.md](design-decisions.md).

## Goal
- Give an investor useful intelligence **before** they ask a question: what is happening with a company, what changed, what deserves attention, why it matters, and what to investigate next.
- Answer any unknown business question over SEC 10-K/10-Q filings with RAG and **exactly one generative LLM request** (Deep Analysis).
- Deploy at `https://diligenceiq.mikemiller.ai` with near-zero idle cost.
- Journey: **Understand → Notice → Investigate → Verify → Capture → Monitor → Decide.**

## What stays (still valid from Revision 1)

| Area | Kept as is |
|---|---|
| Retrieval | Pre-built hybrid index in S3, loaded by the worker; BM25 + exact cosine + RRF; deterministic query analysis; lanes and balanced context (DD-01, DD-05, DD-06) |
| Single-call guarantee | Conditional claim, `maxAttempts: 1`, `GenerationGateway`, persisted counters, tests at every layer (DD-04, architecture §5) |
| Runtime shape | Static Next.js on Amplify with a same-origin `/api` rewrite; HTTP API → api Lambda; async SQS → worker → DLQ handler; job deadlines (DD-02, DD-03, DD-14) |
| Models | Sonnet 4.6 generation, Titan v2 embeddings, rerank off (DD-08) |
| Brief schema and validation | `DiligenceBrief`, forced tool use, server-derived citations, numeric grounding (DD-07, architecture §6.9, §7) |
| Sessions and spend | Anonymous workspaces, kill switch, global/workspace/creation caps, Budget alert-only (DD-09, DD-13) |
| Cost guard | CDK assertion tests for always-on resources, schedules, concurrency, retention, IAM (DD-10) |
| Deliverables | README, indexing/retrieval code, prompt log, final prompt, frontend, example request, evaluation notes, demo script, future state |
| Process | Adversary → fresh fixer → `/code-review` → gate → `/handoff` (DD-12) |
| Built Phase 1 assets | UI kit, evidence components, citation utilities, findings filter, workspace store, CDK stacks + cost guard, api service + kill switch, deploy script, fixture generator |

## What changes

| Area | Revision 1 | Revision 2 |
|---|---|---|
| Primary experience | Deal Overview + workstreams + New Analysis | **Company Intelligence** dashboard per company (DD-15) |
| Navigation | Overview, Diligence, Findings, IC Brief, Sources | **Company Intelligence, Compare, Deep Analysis, Findings** + global "Ask a question"; Thesis and Watchlist join the nav in Phase 8b (P1); Sources and IC Brief secondary |
| Intelligence | Only from user questions | Deterministic facts, risks, drivers and signals + one offline structured call per company, persisted and versioned, with a zero-call deterministic set beside it (DD-16, DD-17, DD-18) |
| Comparison | Only inside a brief | First-class Compare, composed deterministically from profiles (DD-19) |
| Findings | Required `workstreamId`; from briefs only | `theme` + `origin`; saved from briefs, signals, recommendations, and compare rows |
| Thesis / monitoring | IC thesis text | Thesis (P1); Watchlist with historical filing and intelligence events (P1); both built in Phase 8b; live monitoring documented only (P2) |
| Data model and API | Workspace/workstream endpoints | `/api/companies`, `/api/companies/:ticker/intelligence`, `/api/compare`, theses, watchlist (architecture §8–9) |
| Demo | 13-step Project Atlas walkthrough | 20-step flow (SPEC §44.1), with the panel's live question at the center |

## Cost-addendum override (recorded 2026-10-01)
On 2026-10-01 Mike explicitly chose the hybrid offline profile approach, after being told that the docs then said dashboards never call an LLM. This overrides three lines of the cost addendum (archived at `docs/archive/SPEC-ADDENDUM-COST.md`) for the offline profile build only: "incur meaningful inference cost only when a user actually performs an analysis", "avoid LLM calls merely to populate dashboards", and "RAG generation occurs only in response to user analysis". Limits: offline, admin-run, ≤ 1 call per company per (`indexVersion`, `profilePromptVersion`) enforced by a ledger, budget-capped, never on page view, never scheduled, never deployed. A zero-call deterministic set is always built, and a runtime pointer can switch to it instantly. Full text: DD-16. SPEC v2 carries this override as a named, bounded exception (SPEC §35.7).

## Priorities

| Priority | Scope (SPEC §6) |
|---|---|
| **P0** | Company Intelligence dashboard and company selector; performance trends; drivers and current risks; What's Changed; Attention Signals; Why This Matters; Recommended Diligence; Compare; Deep Analysis (any question) with the global "Ask a question" action; one-call enforcement; evidence and citations, including adjacent-period comparison; **brief Interpretation panel, brief company × period coverage matrix, and numeric-grounding badges**; readable source view from every citation; Save Finding; Findings Board; **Architecture and business-value page** (PDF: "information on how this creates value for the business" and future state); production AWS; evaluation; assessment documentation (README, prompts, example request); cost-controlled architecture; demo reliability |
| **P1** | Per-company Diligence Gaps matrix (the richer §29 version); Thesis; Watchlist UI; historical filing and intelligence events; Analysis Audit Trail; IC Brief and print mode; filing explorer |
| **P2** (documented in `docs/future-state.md`, not built) | Live SEC polling; email and SNS notifications; scenario modelling; forecasting; market data and consensus; valuation; portfolio analytics; collaboration; CRM/Slack; PDF generation; complex user management |

**P1 work starts only once P0 is excellent:** Phase 8b begins only after the Phase 7 and Phase 8 exit criteria pass.

**SPEC v1 items moved, stated explicitly** (SPEC §6.4 and Appendix A record each):
- SPEC v1 §42 (archived) "IC Brief works" becomes P1 (SPEC §22), built in Phase 8b. If 8b does not land, the IC Brief is described in the future-state doc and the demo does not claim it.
- SPEC v1 §42 (archived) "source browsing works" is met in P0 by the readable filing view reached from every citation (Phase 6). The standalone filing explorer is P1 (SPEC §16.2, §23.1).
- SPEC v1 §5 (archived) global "+ New Analysis" becomes the global "Ask a question" action (DD-15; SPEC §5.2).

## Scope fallback
The PDF timebox is about four hours of core work, and SPEC §52–53 ask for a narrow solution done excellently. Order of protection when time runs short:
1. **Core RAG quality first.** The Phase 2 and Phase 3 additions (financial extraction, risk headings, change detection) are time-boxed and never delay the core ingestion, retrieval, and evaluation exit criteria. If both cannot land, the intelligence additions slip and the dashboard shows facts, current risks, and recommended diligence only.
2. **If Phase 4b slips, ship deterministic-only profiles** (`det-v*`). The UI is unchanged; the LLM set is described as an option on the Architecture page.
3. **If signal quality misses the Phase 3 bar**, the failing signal types are suppressed (DD-18 go/no-go).
4. P1 (Phase 8b) is cut before any P0 item is weakened.

**Demo proportion.** The live question is the center of the demo. The offline plane and the engineering narrative get about one minute; business value and future state get their own segment (Phase 9 demo script).

## Phases

Every phase ends with the gate in CLAUDE.md:
1. Tests.
2. `adversary` report, including the SPEC §48.2 product questions.
3. Fresh fixer agent.
4. `/code-review` and fixes.
5. `pnpm gate`.
6. `/handoff` + `docs/handoffs/phase-XX.md`, committed after Mike's go-ahead (DD-12).

Phases run in table order. Phase 8b (P1) runs after Phase 8 and before Phase 9.

| # | Deliverables | Exit criteria (in addition to the gate) |
|---|---|---|
| 0 | Architecture baseline (done, `9a7a764`) | Done |
| 0b | **Re-baseline** (this revision): the product direction (archived); DD-15 to DD-19; architecture, assumptions, design-tokens, README and testing-strategy updates; adversary review against both specs and fixes (B1–L12); consolidated **SPEC v2** (`SPEC.md`) with v1, the cost addendum and the product direction archived in `docs/archive/`, carrying the DD-16 cost-addendum override as SPEC §35.7 | No assessment requirement lost (checklist below); `pnpm gate` passes, including the check-docs regression phrases; docs-only commit |
| 1 | **Rework the uncommitted shell to the new IA, P0 routes only**: nav (Company Intelligence, Compare, Deep Analysis, Findings) + global "Ask a question"; `/intelligence` selector and dashboard; `/compare`; Deep Analysis (`/analysis/new` with editable prefill that never auto-submits, `/analysis`); `/findings`; `/architecture` (static: planes, override, single-call design, cost strategy, business value, future state; no measured numbers yet); landing with the new message and an "Ask any question" entry. **Not built in Phase 1:** `/thesis`, `/watchlist`, `/ic-brief`, `/sources` explorer (omitted from the nav, no stubs; Phase 8b). `CompanyIntelligenceProfileSchema` in `packages/core`; `workstreams.ts` → themes; Finding `theme` + `origin`; `AnalysisOrigin` and `FindingSource` unions. **Fixture profiles for AAPL, MSFT, NVDA carry no figures and no narrative presented as fact:** labeled placeholder structure, or values copied verbatim from filing rows with `chunkId` and `rawRow` (architecture §7.1). Keep CDK, cost guard, api, and UI kit | Full gate (`lint`, `typecheck`, `test`, `cdk:synth`, `build`) green; fixture-figure test green; prefill-no-POST test green; **shell live on `diligenceiq.mikemiller.ai`**; **Amplify rewrite forwards `Set-Cookie`** (assumptions D9) |
| 2 | Verify Bedrock invoke entitlement. Ingestion (headers, periods, overrides, preamble, sections, boilerplate) → chunking → cached, resumable Titan v2 embeddings → S3 index, adjacency file, and **index summary** (`summary.json` and the CLI print-out: documents, chunks, companies, fiscal years, filing types, detected sections; SPEC §24.4). **Time-boxed additions:** deterministic financial extraction (DD-17, 10-Ks and 10-Q comparative columns), risk-heading extraction per 10-K, drivers rows, per-company coverage summary | Header and period tests over all 246 files; section tests (AAPL 10-K, NVDA 10-Q, JNJ 10-Q, XOM 10-Q, MS 10-K); 287,855-character line; index summary recorded in the handoff; cold index load measured; **extraction golden tests for AAPL, NVDA, MSFT, JNJ, XOM** |
| 3 | Query analyzer, planner and lanes, hybrid retrieval, context builder, retrieval debug endpoint; retrieval evals on 15–20 questions covering every SPEC §41.1 category, including the 3 PDF examples verbatim and the SPEC §51.3 expert question. **Time-boxed addition:** deterministic change detection and signal candidates with `evidenceByPeriod` and `investigateQuestion` (DD-18) | Multi-company queries don't collapse; chunk size, embeddings, and rerank decisions recorded; **signal go/no-go recorded** on the hand-labeled AAPL, NVDA, MSFT set (provisional bar: precision ≥ 0.8 plus a recall sanity check; failing types suppressed); heading-diff viability recorded (assumptions G4) |
| 4 | Deep Analysis prompt v1; `GenerationGateway`; schema, citation, and numeric validation; SQS worker with claim, deadlines, generation budget, DLQ handler; real prompt iterations in `docs/prompt-iterations.md` | `generationCallCount === 1` on success, error, malformed output, duplicate delivery, and redelivery after a claim; worker constructs only `purpose: 'analysis'` (test); temperature + forced tool use verified; latency measured |
| 4b | **Offline Company Intelligence build** (DD-16), after F4 is put to Eliza: `scripts/intelligence/build-profiles.mjs`; `prompts/company-intelligence-prompt.md`; profile validator with the canonical banned-phrase list; deterministic library (labeled "General context"); **both sets** `intelligence/<indexVersion>/llm-v<N>/` and `det-v<M>/`; append-only build ledger; SSM pointer `/diligenceiq/active-profile-set`; manifests; profile prompt iterations logged. **If this phase slips, ship `det-v*` only** (Scope fallback) | Every company has a schema-valid profile in both sets; 0 invalid citations; 0 unsupported figures; 0 banned-phrase matches; ≤ 1 call per profile per ledger; **provisional bar: LLM fallback rate ≤ 10% across the 12 deep-tier companies**; profile prompt matches the runtime prompt (test); profile evals recorded |
| 5 | Sessions, seed (real pipeline outputs) and reset; spend caps and kill switch. **Company Intelligence on real profiles** (api reads the active set from S3, in-memory cache); **Compare** (DD-19); **Recommended Diligence / Investigate** prefill into Deep Analysis (never auto-run); Deep Analysis with real stages, **Interpretation panel, coverage matrix and numeric-grounding badges (P0)**; **Save Finding from any `FindingSource`**; Findings Board; error and degraded states (architecture §9.1) | **Novice path** (select Apple → understand → Investigate → Deep Analysis → save) and **expert path** (typed question) run end to end with no broken steps; no LLM call on any page view (test); every §9.1 state has a test |
| 6 | Evidence drawer for briefs **and** signals, with **adjacent-period comparison** (`evidenceByPeriod` for signals; `GET /api/evidence/adjacent` for brief citations); deep-link passage highlight; readable source view; brief coverage matrix linked to evidence; citation-integrity tests | Every citation in seeded briefs, live briefs, and profiles resolves to its passage; adjacent-period lookup tested on AAPL and JNJ |
| 7 | Eval harness + `docs/evaluation.md` covering **Deep Analysis and profiles**; SPEC §41.1 categories; unsupported-query and injection tests; structured logging, request IDs, 14-day retention, metric filters; security headers and CSP (assumptions D10); IAM review; accessibility and performance review; cost telemetry. **Architecture and business-value page (P0)** filled with measured eval, latency and cost numbers | Full regression green; eval results recorded; Architecture page shows only measured numbers, each traceable to `docs/evaluation.md` or telemetry |
| 8 | Production hardening, alarms, Budget alert, profile build run against the production index, Playwright smoke against the production URL. **README** (SPEC §43.2: setup, corpus placement, ingestion, local run, deploy, evaluation, the cost-addendum override) and **`examples/`** with a ready-to-run example request against the production URL | SPEC §49 Phase 8 production validation; profiles loaded for all 54 companies; the example request runs to COMPLETE against production |
| 8b (P1) | **Gated on the Phase 7 and Phase 8 exit criteria.** Thesis (supporting / challenging / open questions / watched categories / test with Deep Analysis); Watchlist (preferences, historical filing and intelligence events, future-state monitoring panel); per-company Diligence Gaps matrix; IC Brief and print mode; filing explorer; Thesis and Watchlist added to the nav and the seed | No model client reachable from these handlers (test); none of them issue a verdict; caps and ticker validation tested; P0 regression still green |
| 9 | Polish; `docs/demo-script.md` (the 20-step flow in SPEC §44.1, with the business story from SPEC §44.2 and §3.4 and proportionate time on engineering); `docs/future-state.md` (live monitoring, notifications, scenario intelligence, deal room, IC workflow, portfolio); final README pass; final panel-persona adversary, including the 60-second novice test → fixes → `/code-review` → full production regression | SPEC v2 definition of done |

## Requirement-preservation checklist
The Phase 0b adversary checks that each item survives into SPEC v2, and the final adversary checks it again:
- [ ] Any natural-language question can be typed into an input field (Deep Analysis, or the global "Ask a question"), and the panel's question is answered live.
- [ ] Single-company, multi-company, longitudinal, and sector questions; the 3 PDF example questions are in the evals verbatim.
- [ ] Eval set covers every SPEC §41.1 category: single-company, multi-company, longitudinal, risk, revenue, regulatory, cross-sector, unsupported, ambiguous, and injection.
- [ ] Exactly one generative call per analysis, proven by tests at every layer. No LLM query rewriting, planning, critique, repair, summarizer, or runtime judge.
- [ ] A prefilled Deep Analysis never auto-submits; generation requires an explicit Run (POST), proven by an E2E test.
- [ ] The offline profile build follows the dated cost-addendum override (DD-16) and its limits; the deterministic set and pointer exist.
- [ ] Citations only reference supplied chunks and are validated server-side; every claim is inspectable.
- [ ] No hardcoded demo answers. Seed data and profile content come from real pipeline outputs. Numbers come only from extraction. Fixture profiles show no figure without a source row. The curated "General context" library is the only hand-written explanatory text.
- [ ] Deliverables: README (setup, run, example request), indexing and retrieval code, index summary, prompt iteration log, final prompt template, frontend, `examples/` request ready to execute, evaluation notes.
- [ ] Real loading stages; every SPEC v1 §27 error state plus the new-IA states (SPEC §38.2; architecture §9.1); security (SPEC §39); anonymous server-side demo workspace with scoped reset.
- [ ] Scale-to-zero: no always-on compute, no schedules, explicit log retention, no LLM call on page view, embeddings and profiles reused.
- [ ] Business value and future state are presented (P0 Architecture and business-value page, demo script, future-state doc).
- [ ] Gate per phase.

## Verification approach
- **Unit and integration** (Vitest, no AWS): corpus parsing, sections, chunker, **financial extraction**, **change detection**, query analysis, RRF, lanes, context budget, citation and numeric validation, **profile validator and banned-phrase list**, **build ledger**, gateway call guard, claim idempotency, deadlines, rate limits, **compare composition**, fixture-profile figures.
- **CDK assertions:** no OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned or reserved concurrency, or schedules; log retention set; IAM scoped; **api Lambda has no Bedrock access**; **profile builder not deployed**.
- **Eval harness** (real index, on demand): Deep Analysis (coverage, citation validity, numeric grounding, abstention, injection) and **profiles** (citation validity, figure match, vocabulary, signal precision, fallback rate).
- **Playwright:** novice and expert paths locally, prefill-no-POST, error states, plus production smoke.
- Details and the gate/on-demand split: [testing-strategy.md](testing-strategy.md).

## Risks and mitigations

| Risk | Mitigation | Owner / when |
|---|---|---|
| The panel reads the offline profile call as a second answer-producing call | A6 is labeled an interpretation. F4 is put to Eliza before Phase 4b. Both sets are built; the SSM pointer switches to the zero-call set instantly. The Architecture page and README state the override plainly. The live question is always one call. | Mike (ask Eliza), Phases 4b, 9 |
| Scope expansion endangers P0 quality | Scope fallback above; Phase 8b (P1) starts only after the Phase 7 and 8 exit criteria pass; P2 is documentation only | Every phase |
| Financial extraction misses long-tail labels (banks, conglomerates) | Alias map plus "Not extracted" plus coverage note; demo centers on deep-coverage companies | Phase 2 |
| Heading diffs and lexicon deltas are noisy or empty (weakest assumption, G4) | Phase 3 go/no-go with a provisional bar; failing types suppressed; dashboard leads with current risks, trajectories, and recommended diligence | Phase 3 |
| Signals overclaim or read as ratings | Descriptive labels only; canonical phrase-level banned list with allow-listed financial terms (DD-16); "why this matters" educates and points to investigation | Phase 4b |
| Bedrock invoke entitlement unverified | Check first in Phase 2; model IDs are env-configurable | Phase 2 |
| Sonnet 5.5 quota is 0 in this account | Ship on Sonnet 4.6; Mike may file a quota increase (L-94A31E46) | Mike, optional |
| Lambda account concurrency is 10 and shared | `maximumConcurrency: 2`, job deadlines; **recommended:** Mike requests a concurrency quota increase before the demo | Mike, before Phase 8 |
| Cohere Embed v4 daily token cap below corpus size | Titan v2 default; resumable, cached indexer | Phases 2–3 |
| Cold start on the first analysis after idle | Measured in Phase 2 and shown as a real stage. Dashboards are unaffected because profiles are small S3 reads | Phase 2 |
| Amplify rewrite may not forward `Set-Cookie` | Verified in the Phase 1 deploy; fallback is an `api.` subdomain with credentialed CORS | Phase 1 |
| CSP vs. static-export inline scripts | Decided in Phase 7 | Phase 7 |
| Public demo spend | Kill switch, global daily cap, workspace caps, Budget alert; profile builds are manual, ledger-bounded, and budget-capped | Phases 4b, 5, 8 |
| Commits and outward-facing actions | Commits wait for Mike at each `/handoff`; creating a GitHub repo is asked first, no later than Phase 8 | Every phase |

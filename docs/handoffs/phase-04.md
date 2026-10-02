# Phase 4 Handoff: One-Call Generation, Validation, SQS Worker, Generation Evals

_Date: 2026-10-02 (local)_

## Why
Phase 4 builds the generation half of Deep Analysis. One generative request per analysis, grounded in the Phase 3 context. Deterministic schema repair, citation validation and numeric grounding. An async SQS worker whose conditional claim makes a second call impossible. Generation evals. The temperature and forced-tool check. Latency measured in-region.

## Decision settled first (pending decision 1)
**Change questions with no period** ("How has Visa changed?") now read each company's **last 3 annual reports** (Mike, 2026-10-02).
- SPEC §26.3 was amended first, recorded in Appendix A.4.
- Then `packages/rag/src/query/analyze.ts` (`CHANGE_DEFAULT`, `changeDefault`) and `periods.ts`, with tests.
- After the adversary review the trigger requires real change wording ("has … changed", "what changed", "trends in", "over time").
  - Noun phrases are ignored: "climate change", "change of control", "changes in accounting principles", "changes in tax law", "shift supervisors".
  - A quarterly scope ("latest quarter", "quarterly", 10-Q only) keeps the current view.
- The Phase 3 retrieval eval is unchanged: hybrid 19/20, BM25 16/20, cosine 19/20.

## Completed
1. **Deep Analysis prompt** (`packages/rag/src/generation/prompt.ts`, shipped version **da-v3**).
   - **System prompt:** eight evidence rules plus per-field writing guidance.
   - **One user message:** `<question>` (defanged, including invisible-character tag variants), `<retrieval_scope>` (the deterministic Interpretation), and the `<filing_excerpts>` block.
   - **Forced tool** `submit_diligence_brief`, temperature 0.2, 8,192 output tokens.
   - `prompts/final-diligence-prompt.md` is rendered from it (`pnpm prompts:render`), and a test asserts they match.
   - Earlier versions: `prompts/versions/da-v1.md` and `da-v2.md`.
   - Real iterations: [prompt-iterations.md](../prompt-iterations.md).
2. **`GenerationGateway`** (`gateway.ts`).
   - One call per analysis, taken from the budget before `beforeCall` runs, so concurrent calls cannot both reach the client.
   - `beforeCall` persists `generationStartedAt` and `generationCallCount = 1`. If it fails, the model is never called.
   - Purpose `'analysis' | 'profile'`.
3. **Bedrock clients** (`bedrock.ts`).
   - One `ConverseStream` request on a runtime with `maxAttempts: 1` (a test pins it).
   - The abort is honoured mid-stream.
   - Titan query embedding with a 10 s timeout; on failure, retrieval falls back to BM25, stated.
4. **Validation** (`validate.ts`, deterministic).
   - **Repair:** a stringified field, comma-separated IDs, missing arrays, enum case, and a leading label column in comparison tables.
   - **Citations:** checked against the context set.
   - **Uncited items:** flagged.
   - **Numeric grounding:** strict rules after the adversary review, with a separately reported `unit_unstated` near match that never counts as verified.
   - **Comparison rows:** misaligned rows are flagged.
5. **Pipeline** (`pipeline.ts`, `runDeepAnalysis`).
   - Real stages, each written once.
   - `NO_RELEVANT_EVIDENCE` makes no call.
   - The time check needs 120 s of generation budget plus a 10 s margin.
   - The abort at 120 s gives `GENERATION_TIMEOUT`, also when the stream ends cleanly.
   - Only a `ClaimLostError` means "write nothing"; any other `beforeCall` failure is `WORKER_FAILED`.
   - A failed sent request keeps an estimated, flagged cost.
6. **Worker** (`services/api/src/analyses/`, `worker-handler.ts`, `dlq-handler.ts`).
   - `DynamoAnalysisStore` uses conditional writes for every transition. A `MemoryAnalysisStore` with the same conditions backs the tests.
   - Kill switch: off gives `ANALYSES_DISABLED`; unreadable gives an honest `WORKER_FAILED`.
   - The claim comes first, then the index load (cold only), the pipeline, and `complete`.
   - The context snapshot is written only after `complete`, retried once.
   - The DLQ handler marks jobs `WORKER_FAILED`.
   - `expireIfPastDeadline` is the poll path; Phase 5 wires it into `GET /api/analyses/:id`.
7. **CDK `WorkerStack`** (`DiligenceIQ-Worker`).
   - Analysis queue: visibility 1080 s, DLQ after 3 receives, SSE, TLS only.
   - Worker: 3,008 MB arm64, 180 s, batch 1, max concurrency 2, no reserved concurrency.
   - DLQ handler.
   - IAM:
     - Bedrock only on the Sonnet 4.6 profile, its 3 regional foundation models, and Titan;
     - S3 `index/iv-9cf51c066743/*` only;
     - table item actions.
   - 14-day logs.
   - A metric filter and alarm on `generationCallCount > 1`; its notification target comes in Phase 8.
   - Tests check the queue, IAM, bundles (no profile builder anywhere) and the alarm.
8. **Evals**:
   - `pnpm eval:retrieval --generate [--live] [--only ids]` replays recorded responses for free and calls Bedrock only with `--live`.
   - `pnpm eval:generation:rescore` re-validates stored briefs.
   - `pnpm analysis:run` is the admin in-region runner.
   - Results: `evals/results/generation-iv-9cf51c066743-da-v{1,2,3}.{json,md}`; write-up in [evaluation.md](../evaluation.md) §4–5.

## Measured results
**Generation** (20 questions per version, Sonnet 4.6 via `us.anthropic.claude-sonnet-4-6`, all scored with the final validator):

| Prompt | Pass every check | Calls / question | Citation validity before → after | Numeric grounding | Near matches | Abstention | Follow-ups answerable | Injection | Coverage | Gen p50 / max |
|---|---|---|---|---|---|---|---|---|---|---|
| da-v1 | 9/20 | 1 | 1.00 → 1.00 | 0.887 (461/520) | 25 | 1/2 | 0/2 | 1/1 | 17/17 | 41 / 55 s |
| da-v2 | 11/20 | 1 | 1.00 → 1.00 | 0.856 (451/527) | 64 | 1/2 | 0/2 | 1/1 | 17/17 | 42 / 57 s |
| **da-v3 (shipped)** | **14/20** | **1** | **1.00 → 1.00** | **0.922 (498/540)** | 35 | 1/2 | 0/2 | 1/1 | 17/17 | 42 / 87 s |

- **Temperature 0.2 with the forced tool:** accepted (verified 2026-10-02, first live call).
- **Single call:** 60 live requests, each exactly 1 call per analysis, 0 retries, 0 errors.
- **Citations:** the model never cited an ID outside its context.
- **Numbers reported earlier:** the in-session numbers (0.985, 17/20) came from a looser validator, before the adversary review. They are superseded, and prompt-iterations.md says so.

**In-region** (us-east-1, `pnpm analysis:run`, da-v3, 3 runs):

| Measure | Result |
|---|---|
| Cold index load | 2.75 s for the 236 MB index (download 1.5 s, sha256 0.14 s, parse 0.95 s) |
| Lambda | init 0.36 s; max memory 1,340 / 3,008 MB |
| Retrieval | 0.23–0.32 s, including the Titan query embedding (0.13–0.22 s) |
| Generation | 41–59 s; first token about 1.1 s |
| Enqueue → COMPLETE | 42–64 s |
| Cost per analysis | about $0.12–$0.13 (estimate) |

## Gate record
1. **Adversary** (with the SPEC §48.2 questions): no blocker.
   - **High:**
     - H1: the scale-agnostic "exact digits" rule let 1000× errors verify.
     - H2: set-membership matching let computed or rounded figures verify against unrelated numbers.
     - H3: a `--mode hybrid --generate` run overwrote the Phase 3 retrieval results file.
     - H4: decision-1 false triggers.
     - H5: misaligned comparison columns.
   - **Medium:**
     - M1: any `beforeCall` error was read as a lost claim.
     - M2: outside knowledge in follow-ups.
     - M3: the docs overstated the validator.
     - M4: re-scored numbers were not in any results file.
     - M5: an SSM blip failed jobs as "paused".
     - M6: weak eval checks.
   - **Low:** L1–L11, including stage timing, abort handling, the embedding timeout, snapshot ordering and gap grammar.
   - **Product answers:** briefs read like analyst research; nothing is generated unnecessarily. There is still no user-facing surface (Phase 5). Value before a question still rests on the preview profiles (Phase 4b).
2. **Three fresh fixers** on disjoint files:
   - validator, eval and docs honesty;
   - decision-1 triggers;
   - pipeline and worker robustness.

   Everything was fixed with regression tests, except M2. The follow-up prompt fix needs a paid da-v4 run, so it is reported as a failing check ("follow-ups answerable 0/2"). Phase 3's retrieval results were restored from HEAD.
3. **`/code-review`** (medium) found 2 lows, both fixed with tests:
   - a BM25 retry moved the persisted stage backwards;
   - a failed or timed-out sent generation reported no generation cost (it now estimates the input and sets `costIncomplete`).
4. **`pnpm gate`:** exit 0 (2026-10-02).
   - check-docs OK (14 files); lint and typecheck clean.
   - Unit tests with `REQUIRE_CORPUS=1`:

     | Package | Tests |
     |---|---|
     | core | 30 |
     | cdk | 42 |
     | corpus | 102 |
     | web | 91 |
     | rag | 335 |
     | api | 56 |
     | **Total** | **656** |

   - `cdk:synth` and build OK; e2e 31 passed.

## Spend and AWS writes (all approved by Mike this session)
- **Bedrock generation evals:** 60 Sonnet 4.6 calls, $6.69 estimated (da-v1 $2.22, da-v2 $2.22, da-v3 $2.25).
- **In-region measurement:** 3 analyses, about $0.37 estimated, plus 3 Titan calls. In DynamoDB, 3 `ANALYSIS#` items and 3 `CONTEXT#` items in workspace `admin-phase4`, each with a 30-day TTL.
- **Deploys:**
  - `DiligenceIQ-Worker` created; Core gained 3 CloudFormation exports for it.
  - Redeployed once with da-v3, then again from commit `9699b3b` after the gate (2026-10-02, 15:58 UTC). The deployed worker matches the committed code.
- **Kill switch:** `/diligenceiq/analyses-enabled` was set to `true` for the 3 runs, then back to `false` (verified `false`).
- **Idle cost added:** the alarm (about $0.10/month) and the two SQS event-source pollers (a few cents a month).

## Deployment
- The live site still serves the Phase 1 build.
- The api Lambda is unchanged: `POST /api/analyses` still answers `ANALYSES_DISABLED`.
- The worker plane is deployed but receives no traffic: nothing enqueues except `pnpm analysis:run`.

## Decisions pending with Mike
1. **da-v4 prompt run (about $2.25).** It would fix the follow-up questions:
   - Ford briefs propose questions about Ford's own filings, using outside knowledge ("Model e").
   - Apple 2015 briefs ask about the FY2015 10-K.

   It would also fix the Apple 2015 brief's claim about a filing it never saw. Optional: the validator could look up a table's "(in millions)" header in the adjacent chunk of the same filing, which would verify the 35 near matches.
2. **Still open from Phase 3:** the PERSISTENT go basis; asking Eliza about F4 (before Phase 4b) and F1 (rerank). The Phase 4 evals show no evidence ranked just outside the context that would justify rerank. The weak spots are numeric unit headers and follow-ups.
3. **Lambda concurrency quota increase** (the account limit is 10, shared): recommended before the demo.
4. **Sonnet 5.5:** the quota is still 0 (L-94A31E46 cross-region, L-31AB82D0 global; re-read 2026-10-02). Switching also needs a SPEC §29.1 change: 5.5 rejects forced `toolChoice` and `temperature`.

## Known limitations
- One eval run per prompt version, at temperature 0.2, so reruns can differ.
- Abstention and injection each rest on two questions.
- Non-numeric groundedness and completeness are not machine-checked; Phase 7 adds a manual review.
- Numeric grounding is a deterministic co-occurrence check ("these digits and unit are printed in a cited passage"), not semantic verification.
- Generation dominates latency (about 98%). A full 8,192-token brief could exceed the 120 s budget; the eval maximum was 87 s.

## Next-phase objective (Phase 4b or 5, per Mike and the Eliza answer on F4)
- **Phase 4b:** the offline Company Intelligence build (SPEC §32), after asking Eliza. It uses the same `GenerationGateway` with `purpose: 'profile'`.
- **Phase 5:** sessions, caps and the kill switch on the api. `POST /api/analyses` enqueues, with an `sqs:SendMessage` grant on the WorkerStack queue. `GET /api/analyses/:id` uses `expireIfPastDeadline`. The real Deep Analysis UI shows the stages, Interpretation panel, coverage matrix and numeric badges, including `unit_unstated`.

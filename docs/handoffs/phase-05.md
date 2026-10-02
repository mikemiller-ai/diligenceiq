# Phase 5 Handoff: Sessions, Caps, Enqueue and Poll, Server-Side Findings, Real Deep Analysis UI

_Date: 2026-10-02 (local)_

## Why
Phase 5 connects the product to the Phase 4 worker. Phase 1 kept all workspace state in the browser, and its api answered `ANALYSES_DISABLED`. After Phase 5:
- A visitor gets an anonymous, seeded demo workspace.
- An explicit Run queues one analysis under spend caps and the kill switch.
- The brief page shows the worker's real stages and the evidence and validation panels SPEC §15.2 marks P0.
- Findings are stored server-side, with their text copied from stored content.

## Decisions settled first
- **Order:** Mike chose Phase 5 before Phase 4b (2026-10-02). SPEC v2 Appendix A.4 records it, with the preview set `fixture-v2` served through the real runtime profile path (SSM pointer + S3) until 4b. **It is pending Mike's confirmation.**
- **Validator improvement (approved by Mike this session):** the `preceding_unit` rule.
  - A table cell whose unit caption ("(In millions)") sits in the immediately preceding chunk of the same filing and section, at most 2 chunks back and contiguous, verifies only when the amount is exactly equal.
  - da-v4 numeric grounding went from 0.901 (484/537, 47 near matches) to **0.911 (489/537, 42 near matches)** on a free re-score. The earlier prediction that it would verify "most of the 47" was wrong and is recorded in `docs/prompt-iterations.md`.
  - All 42 remaining near matches are Pfizer cells with "(MILLIONS)" inside the same chunk, a caption form the detector does not read (pending decision).

## Completed
1. **Core** (`packages/core`):
   - API types (`api.ts`).
   - Company catalog (`catalog.ts`, generated from the filing rows).
   - `ProfileSetManifestSchema`.
   - `resolveSource` and `sourceKey` moved from the web (`finding-sources.ts`), so the server and the UI copy findings the same way.
   - `comparisonHeaders`.
   - `Finding.figures`, `seeded` and `profileSetId`.
   - Error code `ALREADY_SAVED`.
2. **api** (`services/api`):
   - Sessions: an HMAC-signed `__Host-diq_ws` cookie. The secret is an SSM SecureString.
   - Workspace caps: per-client (salted hash of the source IP) and global daily workspace-creation caps.
   - META TTL: extended at most daily; an expired META is not a session.
   - Seed and reset: reset keeps META and the rate counters. A seed failure never withholds the session.
   - `POST /api/analyses`, in this order: validation and catalog tickers → kill switch → workspace hourly cap → global daily cap → QUEUED record → `SendMessage`. If the send fails, the job is marked `ENQUEUE_FAILED`.
   - The poll runs `expireIfPastDeadline`; analysis list and context snapshot routes.
   - Findings CRUD with server-side copy, one finding per source, and a 500-finding cap counted with COUNT.
   - Profile provider (pointer cached 60 s; every file schema- and integrity-checked; a corrupt file reads as missing); companies, intelligence and Compare routes; health `indexAvailable`.
   - JSON-only bodies.
   - An esbuild-metafile test proves the handler bundle has no Bedrock client and no `@diligenceiq/rag`.
3. **CDK:**
   - Active-profile-set parameter (default "none").
   - The api's IAM: DynamoDB item and query actions on the table, `sqs:SendMessage` on the queue, three SSM parameters, `s3:GetObject` on `intelligence/*` and the index manifest only. Still no Bedrock.
   - Cap env vars.
   - WorkerStack is now built before ApiStack.
4. **Seed:** `pnpm seed:build` replays the recorded da-v4 generations of eval questions pdf-2, multi-cloud and expert-1 through the pipeline and validator.
   - Real output, no spend.
   - Durations are zeroed and telemetry is marked `replayed`.
   - The UI labels seeded analyses and findings as examples.
5. **Profile sets:**
   - `pnpm profiles:export-fixture` writes `tests/fixtures/profile-sets/iv-9cf51c066743/fixture-v2/`.
   - `pnpm profiles:upload-set` uploads a set immutably (dry run unless `--yes`).
6. **Web:**
   - The workspace store runs on the api, through the `WorkspaceClient` interface. On 401 it opens one shared new session and retries.
   - Brief page:
     - Polling, with "Connection lost" and retries on 5xx with backoff.
     - Real stage names; the Interpretation panel; the coverage matrix.
     - Badges at every validated figure location ("Unverified figure", "Unit not stated").
     - Validation summary; fallback when the snapshot is missing.
   - Recent analyses list; version-skew notice; workspace banner.
   - Each §38.2 state has a designed screen and a test.
   - Architecture page statuses updated.
7. **E2E:** `tests/e2e/local-server.ts` serves the static export plus the real api over in-memory stores. Its queue goes to a test-only stub worker that never calls a model. The specs cover:
   - Novice and expert paths.
   - A seeded brief and the out-of-corpus question.
   - The hourly cap.
   - Failures.
   - On every page view, only reads and the session request are sent, and the worker receives nothing.
8. **Bug found by the seeded briefs and fixed:** validated briefs carry one column header per value. The Phase 1 table and the finding copy had assumed a leading row-label header, which shifted headers and mislabeled saved comparison rows.

## Gate record
1. Tests written with each part.
2. **Adversary:** 0 blocker, 5 high, 11 medium, plus lows.
   - High: a single client could exhaust workspace creation; untested §38.2 states; the SPEC deviation; the poll froze silently on 5xx; Architecture page copy was false.
   - Medium: badges missing at some locations; findings lost grounding markers; seeded findings were unlabeled; no analyses list; the workspace TTL; a reset race; a weak no-model-client test; a corrupt profile caused a 500; the stub worker returned an unrelated brief; the cap check read every finding.
3. **Fresh fixer:** all fixed, each with a regression test.
4. **`/code-review` (medium):** 2 findings, both fixed with tests.
   - Concurrent 401s each minted a new workspace.
   - Profile finding IDs collided across profile sets.
5. **`pnpm gate`: exit 0** (2026-10-02).
   - check-docs OK (14 files); lint and typecheck clean.
   - Unit tests: core 33, cdk 43, corpus 102, rag 346, web 145, api 102 (771).
   - `cdk:synth` and `build` OK; **e2e 39 passed**.

## Spend and AWS writes
None. The seed build and the re-score are replay-only. Nothing was deployed.

## Deployment (not done; each step needs Mike's OK)
1. Create the SecureString `/diligenceiq/session-secret` (≥ 32 bytes, us-east-1).
2. Upload the preview set (`pnpm profiles:upload-set … --set iv-9cf51c066743/fixture-v2 --yes`).
3. `pnpm deploy:infra`: Core (adds the pointer), Api (IAM, env, queue) and Worker (the new validator).
4. Point `/diligenceiq/active-profile-set` at `iv-9cf51c066743/fixture-v2`.
5. `pnpm deploy:web`.
6. One in-region `pnpm analysis:run` (about $0.13, kill switch on then off) to verify api → SQS → worker. **It has never run end to end.**

## Decisions pending with Mike
- Confirm SPEC A.4: Phase 5 before 4b, preview set through the real path.
- D12: the per-client creation cap keys on `sourceIp`, which may be a shared proxy address behind the Amplify rewrite. Raise the cap, key on `X-Forwarded-For`, or verify in Phase 8.
- Whether the validator should also read a same-chunk "(MILLIONS)" caption (free re-score).
- Approval for each deployment step above.

## Known limitations
- Company Intelligence covers 3 companies, with no signals or drivers, until Phase 4b. SPEC §48.2 answers (adversary): value before a question is limited; the dashboard does not yet say what changed; Compare draws no conclusions from preview profiles.
- The novice and expert paths are verified against a stub worker, not in-region.
- Evidence adjacency, the readable source view and deep links are Phase 6.

## Next-phase objective
Phase 4b: the offline Company Intelligence build (SPEC §32). It must write sets in the `ProfileSetManifestSchema` layout that the api now reads, then flip the pointer. After that, Phase 6.

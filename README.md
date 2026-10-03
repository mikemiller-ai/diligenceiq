# DiligenceIQ

**Investment intelligence over SEC filings.** Know what changed. Know what matters. Know what to investigate next.

Production: <https://diligenceiq.mikemiller.ai> (AWS us-east-1). Current status and open decisions: [STATE.md](STATE.md).

## What it is
An investment-intelligence product for a private-equity team, built over 246 SEC 10-K and 10-Q filings from 54 companies.
- **Company Intelligence.** Pick a company and see how it is performing, what changed across its filings, what deserves attention, why it matters and what to investigate next, before asking anything.
- **Compare.** Two to five companies side by side: shared and diverging trends, and risk areas.
- **Deep Analysis.** Ask any question. Retrieval-augmented generation over the filings answers it with **exactly one generative LLM request**, grounded in retrieved filing passages. Every citation is checked server-side against the passages the model was given, and every figure against its cited passage.
- **Findings.** Save a finding with its evidence, set its status and add notes.

**Business value.** An analyst gets a first read on a company in seconds instead of hours of reading filings, and every statement links to the filing passage it rests on, so it can be checked before it reaches an investment memo. Runtime cost is close to zero when nobody uses it and about $0.09–0.13 per question when someone does. The [Architecture and business value page](https://diligenceiq.mikemiller.ai/architecture/) shows the measured numbers.

## Repository layout
| Path | What it holds |
|---|---|
| `apps/web` | Next.js static export (the UI), hosted on Amplify |
| `packages/core` | Shared Zod schemas: API contract, brief, profile, banned vocabulary |
| `packages/corpus` | Filing parsing, sections, deterministic financial extraction |
| `packages/rag` | Chunking, hybrid index, retrieval, context builder, the one generation call, validation, profile builder |
| `services/api` | The api Lambda, the worker Lambda and the DLQ handler |
| `infrastructure/cdk` | CDK stacks: `DiligenceIQ-Core`, `-Api`, `-Worker`, `-Web` |
| `scripts/` | Offline admin CLIs: ingestion, indexing, the profile build, evaluations, deploy |
| `prompts/` | The rendered runtime prompts and their superseded versions |
| `seed/` | The demo workspace seed (real pipeline output, replayed) |
| `evals/` | Eval questions, profile labels, results |
| `examples/` | A ready-to-run example request against production |
| `tests/` | Playwright e2e and committed fixtures |

## Prerequisites
- **Node ≥ 22.18** (the web build runs a `.ts` file with native type stripping) and **pnpm 9** (`packageManager` pins 9.15.9).
- **AWS CLI v2** with credentials for the deployment account (`account` in `infrastructure/cdk/lib/config.ts`), region **us-east-1**. On the development machine the CLI's default region is us-east-2, so pass `--region us-east-1` to every `aws` command. The repo's scripts default `AWS_REGION` to us-east-1 themselves.
- **No Docker.** Lambdas ship as esbuild zip bundles.
- The corpus (`edgar_corpus/`, below) for ingestion, the full test suite and `pnpm gate`.

```bash
pnpm install
```

## AWS setup (one time)
1. **Bootstrap CDK** in us-east-1: `pnpm --filter @diligenceiq/cdk exec cdk bootstrap aws://961406434831/us-east-1`.
2. **Session secret.** CloudFormation cannot create SecureStrings, so the admin creates it. Without it every session fails closed with a 500.
   ```bash
   aws ssm put-parameter --region us-east-1 --name /diligenceiq/session-secret --type SecureString \
     --value "$(openssl rand -base64 48)"
   ```
3. **Alert email.** A plain String the deploy reads for the SNS alert topic `diligenceiq-alerts`, which the alarms `GenerationCallsOverOne` and `DlqHandlerInvokedAlarm` notify. A missing parameter fails the deploy. Confirm the subscription once from the inbox after the first deploy.
   ```bash
   aws ssm put-parameter --region us-east-1 --name /diligenceiq/alert-email --type String --value '<address>'
   ```
4. **Bedrock model access** in us-east-1 for Claude Sonnet 4.6 (the cross-region profile `us.anthropic.claude-sonnet-4-6`, which routes to us-east-1, us-east-2 and us-west-2) and Titan Text Embeddings v2. `pnpm check:bedrock` checks entitlement with a tiny paid call: ask first.
5. **Parameters CDK creates** (operators change them with `aws ssm put-parameter --overwrite`; a redeploy does not revert them):
   - `/diligenceiq/analyses-enabled`, the **kill switch**: `true` allows new analyses; anything else refuses them (`ANALYSES_DISABLED`, nothing charged). It starts as `false`.
   - `/diligenceiq/active-profile-set`, the **profile-set pointer**: `<indexVersion>/<profileSetId>` (for example `iv-9cf51c066743/llm-v3`), or `none` (no profiles served). It starts as `none`.
6. **Budget.** Spend alerts come from the account's existing Budget "Product - DiligenceIQ - Monthly" ($25 a month, alert only: emails at 50%, 80% and 100% of actual and 100% of forecast). It is scoped to the `Product` cost category (tags `project` / `iamPrincipal/project` = `diligenceiq`) and is managed outside this repo; CDK does not create a Budget. Offline admin spend (embeddings, evals, the profile build), run under the admin's own IAM user, is not attributed to it. A Budget only alerts; the kill switch and the caps are what stop spend.

## Environment variables
The deployed values are set by CDK from `infrastructure/cdk/lib/config.ts`. Locally, only the offline CLIs read the environment.

| Variable | Read by | Default | Purpose |
|---|---|---|---|
| `AWS_REGION` | Lambdas, CLIs | `us-east-1` | Region for every AWS client |
| `CORPUS_PATH` | ingestion, extraction, tests | `./edgar_corpus` | The corpus: a directory or a zip |
| `REQUIRE_CORPUS` | tests | unset | `1` makes corpus-backed tests fail instead of skipping (the gate sets it) |
| `GENERATION_MODEL_ID` | worker, eval CLIs | `us.anthropic.claude-sonnet-4-6` | The generation model |
| `EMBEDDING_MODEL_ID` | worker, indexing CLIs | `amazon.titan-embed-text-v2:0` | The embedding model |
| `INDEX_VERSION` | api, worker | `iv-9cf51c066743` (config) | The index in `s3://<data bucket>/index/<version>/` |
| `TABLE_NAME`, `DATA_BUCKET`, `QUEUE_URL` | api, worker, dlq-handler | from the stacks | DynamoDB table, S3 data bucket, analysis queue |
| `KILL_SWITCH_PARAM` | api, worker | `/diligenceiq/analyses-enabled` | Kill switch parameter name |
| `ACTIVE_PROFILE_SET_PARAM` | api | `/diligenceiq/active-profile-set` | Profile-set pointer parameter name |
| `SESSION_SECRET_PARAM` | api | `/diligenceiq/session-secret` | Session HMAC secret parameter name |
| `WORKSPACE_HOURLY_ANALYSIS_CAP` | api | `10` | Analyses per workspace per hour |
| `GLOBAL_DAILY_ANALYSIS_CAP` | api | `200` | Analyses per UTC day across the demo |
| `DAILY_WORKSPACE_CREATION_CAP` | api | `500` | New workspaces per UTC day |
| `PER_IP_DAILY_WORKSPACE_CAP` | api | `100` | New workspaces per client address per UTC day |

Prompts and chunk text are never logged. The specification reserves `DEBUG_LOG_PROMPTS=true` as the only way to log them; no code reads it today, so nothing can turn prompt logging on.

## Corpus
Put the EDGAR corpus at `./edgar_corpus/` (gitignored, about 79 MB, public domain), or point `CORPUS_PATH` at a directory or zip elsewhere. `node scripts/ingestion/probe-corpus.mjs` reproduces every corpus fact cited in the docs; anomalies are listed in [docs/assumptions.md](docs/assumptions.md) (Known corpus anomalies).

## Ingestion and indexing (offline, admin-run)
Outputs go to `.index/` (gitignored).

| Command | What it does | AWS |
|---|---|---|
| `pnpm ingest` | Corpus → processed filings, section offsets and chunks | None |
| `pnpm extract` | Deterministic financial facts, trends, drivers and risk headings per company | None |
| `pnpm index:embed --dry-run` | Counts what would be embedded | None |
| `pnpm index:embed` | Titan v2 embeddings, cached by content hash and resumable | **Bedrock spend** (about $0.44 for the full corpus): ask first |
| `pnpm index:build` | Vectors, BM25, adjacency, summary and manifest, validated before the build is kept | None |
| `pnpm index:upload --bucket <data bucket> [--yes]` | Immutable upload of the index and processed filings | **S3 write** with `--yes` (a dry run without): ask first |
| `pnpm index:measure-load` | Cold-load timing | Read only |

The index version is a content hash of the chunks, so any change to sectioning or chunking produces a new version and new chunk IDs. Re-run `pnpm ingest`, `pnpm index:embed`, `pnpm index:build` and upload, then change `indexVersion` in the CDK config.

## Company Intelligence profiles: the offline build and its cost exception
Dashboards never call a model when a page opens. Company Intelligence profiles are built **offline** by an admin and stored in S3; the api only reads them.

**This is the one cost exception (SPEC §35.7, DD-16).** On 2026-10-01 Mike chose a hybrid approach in which profiles may be written by a model offline. That overrides, for this build only, three lines of the original cost addendum that limited model calls to user analyses. The limits:
- **At most one generation call per company** per (`indexVersion`, `profilePromptVersion`). An append-only build ledger in S3 enforces it across runs. There is no `--force`; a rebuild needs a real prompt-version bump.
- **Admin-run only**: never on page view, never scheduled, never deployed. The api Lambda has no Bedrock permission at all.
- **Budget-capped**: `--max-calls` is required, and the run stops at the cap. A full build is at most 53 calls, one per company with a profile (GE Capital's only filing is outside the review window, assumptions G2), about $0.13 each.
- **Withdrawable**: a zero-call deterministic set is always built too, and the SSM pointer switches to it instantly without a rebuild or deploy. A company whose model output fails validation falls back to its deterministic profile.
- Numbers always come from deterministic extraction, never from the model, and every profile is checked against a banned vocabulary (no ratings, scores or recommendation language).

| Command | What it does | AWS |
|---|---|---|
| `pnpm intelligence:build --max-calls 0` | Builds the deterministic set `det-v<templateVersion>` | None |
| `pnpm intelligence:build --llm --max-calls 0` | Rebuilds the model-written set `llm-v<profilePromptVersion>` from stored outcomes only | S3 reads |
| `pnpm intelligence:build --llm --max-calls 53` | Dry run: which companies it would call and the estimated cost | S3 reads |
| `pnpm intelligence:build --llm --max-calls 53 --yes` | Makes the calls and writes the ledger | **Bedrock spend and S3 writes**: ask first |
| `pnpm eval:profiles` | Scores the built sets against `evals/profiles.yaml` | None |
| `pnpm profiles:upload-set --root .index/intelligence --set <iv>/<set> [--yes]` | Uploads a set (immutable; dry run without `--yes`) | **S3 write**: ask first |

The ledger bucket is `DiligenceIQ-Core`'s `DataBucket` output. Activate a set, or fall back instantly, with:

```bash
aws ssm put-parameter --region us-east-1 --overwrite --name /diligenceiq/active-profile-set --value iv-9cf51c066743/det-v2
```

Production serves `iv-9cf51c066743/llm-v3`; `iv-9cf51c066743/det-v2` is the instant fallback.

## Run locally
```bash
pnpm build                                              # static export in apps/web/out
E2E_PORT=4175 pnpm exec tsx tests/e2e/local-server.ts   # http://127.0.0.1:4175
```

The local server (also `.claude/launch.json` `web-local`) serves the static export and runs the **real api** in-process over in-memory stores, the committed preview profile set and the real seed; the source view reads filings from the corpus. Its queue goes to a **test-only stub worker that never calls a model**: it replays the recorded seed brief for the same companies and fails any other question with `NO_RELEVANT_EVIDENCE`. Test controls: `POST /__e2e/kill-switch?enabled=false`, `POST /__e2e/worker?mode=complete|fail|hang`, `GET /__e2e/stats`. To preview a locally built profile set, add `E2E_PROFILE_SET=iv-9cf51c066743/llm-v3 E2E_PROFILE_ROOT=.index/intelligence` (`web-local-profiles`).

`pnpm dev` runs the Next.js dev server on <http://localhost:3000> for UI work only: `/api/*` is not served there, so pages that need data cannot load it.

**Quality gate**, run before every handoff:

```bash
pnpm gate   # check:docs, lint, typecheck, REQUIRE_CORPUS=1 test, cdk:synth, build, e2e (Playwright)
```

## Deploy
```bash
pnpm deploy:infra   # cdk deploy --all: Core, Api, Worker, Web stacks
pnpm deploy:web     # builds the static export and uploads it to Amplify (SKIP_BUILD=1 to reuse apps/web/out)
```

Order matters:
- **Upload the index before deploying a worker that names it** (`pnpm index:upload --yes`). A chunker change needs a re-index before the api deploy, because the evidence routes refuse a manifest whose `chunkerVersion` differs from the bundled one.
- **Deploy the api before activating a profile set that uses new schema fields.** The api validates profiles strictly with its own bundled schema, and an unknown field reads as "profile missing". Order: `deploy:infra` → switch the pointer → smoke check → `deploy:web`.
- `cdk diff` is not side-effect free: it publishes assets to the bootstrap bucket.

**Pause or resume new analyses** (each run is one paid Bedrock call):

```bash
aws ssm put-parameter --region us-east-1 --overwrite --name /diligenceiq/analyses-enabled --value false   # pause
aws ssm put-parameter --region us-east-1 --overwrite --name /diligenceiq/analyses-enabled --value true    # resume
```

## Evaluations
Results go to `evals/results/` (committed) and are summarized in [docs/evaluation.md](docs/evaluation.md). The free runs replay cached embeddings and recorded generations; anything that spends needs approval first.

| Command | What it measures | Cost |
|---|---|---|
| `pnpm eval:retrieval` | 20 questions in `evals/questions.yaml`, BM25 vs cosine vs hybrid | Free (cached query embeddings); `--embed` embeds new questions (tiny Titan spend: ask first) |
| `pnpm eval:retrieval --generate` | One generation per question through the real pipeline, scored deterministically | Free replay; `--live` calls Bedrock for unrecorded requests (about $0.11 each, about $2.25 a run): ask first |
| `pnpm eval:retrieval --set robustness [--generate]` | 6 adversarial questions in `evals/robustness.yaml` (planted injections, a rating request, out-of-corpus data) | Free replay; `--embed` and `--live` spend: ask first |
| `pnpm eval:generation:rescore` | Re-validates recorded briefs after a validator change | Free |
| `pnpm eval:chunk-size` | BM25-only chunk-size experiment | Free |
| `pnpm eval:signals` | Signal detectors against hand labels | Free |
| `pnpm eval:profiles` | Built profile sets against `evals/profiles.yaml` | Free |
| `pnpm evidence:check` | Every chunk, adjacency reference and seed, brief and profile citation resolves to its passage | Free |
| `pnpm eval:web-perf` | Page weight and render timings of the built export (run `pnpm build` first) | Free |
| `pnpm retrieval:debug` | Serves `POST /api/retrieval/debug` on 127.0.0.1 (never deployed) | Free; `--embed` spends |
| `pnpm analysis:run --question "…"` | One analysis through the deployed worker, in-region | **About $0.13 Bedrock plus AWS writes**; needs the kill switch on: ask first |

Prompt work: `pnpm prompts:render` rewrites `prompts/*.md` from the runtime prompts (a test checks they match). Each real prompt change is logged in [docs/prompt-iterations.md](docs/prompt-iterations.md).

## Demo data and resetting it
Each visitor gets an anonymous workspace (a signed cookie, kept 30 days), seeded from `seed/demo-workspace.json`: three analyses recorded from the real pipeline and their findings.
- **Reset**: **Reset workspace** at the bottom of the sidebar, or `POST /api/workspace/reset` with the session cookie. It discards that workspace's analyses and findings and restores the seed. Company Intelligence and other workspaces are untouched, and the rate counters survive a reset.
- **Rebuild the seed**: `pnpm seed:build` replays the recorded generations (free; it fails rather than call Bedrock). `pnpm profiles:export-fixture` regenerates the preview profile set used by tests.
- Workspaces expire on their own through DynamoDB TTL; there is no cleanup job.

## Example request
[`examples/`](examples/) holds a ready-to-run request against production: it creates a session, starts an analysis, polls until it completes and prints the brief with its citations. Each run makes one paid generation call.

```bash
bash examples/analysis-request.sh
```

See [examples/README.md](examples/README.md) for options, the raw curl sequence and the recorded sample output.

## Architecture
```text
Browser ── Amplify (static Next.js export) ── /api/* rewrite ──► HTTP API ──► api Lambda ──► DynamoDB (on-demand, single table)
                                                                                 │  reads ──► S3: profile sets, index manifest, processed filings
                                                                                 └─ enqueue ─► SQS ──► worker Lambda ──► S3 index (loaded into memory)
                                                                                                │            └──► Bedrock: 1 query embedding + exactly 1 generation
                                                                                                └─ DLQ ──► dlq-handler Lambda (marks the job failed)
```

- **One generation call per analysis**, enforced in depth: a conditional `QUEUED → RUNNING` claim, a generation client with `maxAttempts: 1`, a gateway counter persisted before the call, and an alarm on any analysis with more than one call.
- **Retrieval** is hybrid BM25 and cosine over an index file loaded into the worker's memory; there is no search cluster. Query analysis is deterministic (no query rewriting by a model).
- **Validation** is deterministic: citations must reference supplied chunks, and figures must match their cited passages.
- **Scale to near zero**: no OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned concurrency or scheduled jobs. Stuck jobs are failed lazily on poll.
- **Spend controls**: the kill switch, the hourly and daily caps above, and the alert-only Budget.

Design documents:
- [Architecture](docs/architecture.md), including the Cost and Scaling Strategy (§13), the API contract (§9) and observability (§12)
- [Assumptions](docs/assumptions.md)
- [Design decisions](docs/design-decisions.md)
- [Design tokens & UI principles](docs/design-tokens.md)
- [Testing strategy](docs/testing-strategy.md)
- [Implementation plan](docs/implementation-plan.md)
- [Evaluation](docs/evaluation.md) and [prompt iterations](docs/prompt-iterations.md)
- Phase handoffs: [docs/handoffs/](docs/handoffs/)

## Requirements
- The Eliza assessment PDF is the outer constraint.
- [SPEC.md](SPEC.md) (v2) is the sole canonical implementation specification. Its only cost exception is the offline Company Intelligence profile build: a named, bounded exception (SPEC §35.7) recorded as the dated override in DD-16.
- The design docs above elaborate SPEC v2 and cannot override it.
- Superseded sources, kept verbatim for provenance in [docs/archive/](docs/archive/): [SPEC v1](docs/archive/SPEC-v1.md), [the cost addendum](docs/archive/SPEC-ADDENDUM-COST.md), and [the product direction](docs/archive/PRODUCT_DIRECTION.md). SPEC v2 Appendix A lists every change from them.

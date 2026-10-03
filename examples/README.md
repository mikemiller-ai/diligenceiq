# Example request

`analysis-request.sh` runs one Deep Analysis against the deployed api at <https://diligenceiq.mikemiller.ai> and prints the brief (SPEC §43.3). It does what the browser does when you press **Run**:

1. `POST /api/session` creates an anonymous demo workspace. The session cookie goes to a temporary cookie jar, which is deleted when the script exits.
2. `POST /api/analyses` queues the analysis (`content-type: application/json`).
3. `GET /api/analyses/<id>` polls every 2 seconds and prints each status change (`QUEUED`, then `RUNNING` through its stages, then `COMPLETE` or `FAILED`).

On `COMPLETE` it prints the title, summary, key findings, comparison, considerations, evidence gaps, follow-up questions, every citation with its chunk ID and filing, the server-side validation result, and the telemetry (model, prompt version, the single generation call, tokens and estimated cost). On `FAILED` it prints the error code and message.

> **Cost.** Each run against production makes **one paid Bedrock generation call** (Claude Sonnet 4.6, estimated about $0.10–0.14 per analysis at the billed rate; the recorded run below, $0.1316) plus one query embedding, and creates one demo workspace (it expires after 30 days). The api's spend caps apply: 10 analyses per workspace per hour and 200 a day across the demo.

## Run it

Needs `bash`, `curl` and `node` (the repo's Node ≥ 22.18 works; node only parses JSON). No `jq`.

```bash
bash examples/analysis-request.sh
```

The default question is the assessment's expert question, scoped to Apple:

> How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?

Options (flags win over environment variables):

| Flag | Environment | Default |
|---|---|---|
| `--question "<text>"` | `QUESTION` | the Apple question above |
| `--tickers AAPL,MSFT` | `TICKERS` | `AAPL` (`""` for no ticker filter: the question decides the scope) |
| `--base-url <url>` | `BASE_URL` | `https://diligenceiq.mikemiller.ai` |
| `--json-out <file>` | `JSON_OUT` | not saved (otherwise the final poll response is written there as JSON) |
| | `POLL_INTERVAL` | `2` seconds |
| | `TIMEOUT` | `300` seconds (the job deadline is 240 s; a poll past it fails the job) |

```bash
bash examples/analysis-request.sh \
  --question "Compare the cloud businesses of Microsoft, Amazon and Alphabet." \
  --tickers MSFT,AMZN,GOOG
```

Exit status: `0` on `COMPLETE`; `1` on `FAILED`, a timeout or an HTTP error; `2` on bad usage (an unknown flag, or a flag without its value).

Each request has a 10 s connect and 30 s overall time limit. Once the analysis is queued (and paid for), a poll that gets no answer, a `429` or a `5xx` is retried up to 4 times (2, 4 and 6 s apart) before the script gives up; it never re-sends `POST /api/analyses`.

In the printed validation, "Citation references: 53 of 53 valid" counts every reference to a passage in the brief (a passage cited by three findings counts three times); the "Cited passages" list shows each passage once.

### Errors it explains

| Response | Meaning |
|---|---|
| `503 ANALYSES_DISABLED` | New analyses are paused: the kill switch `/diligenceiq/analyses-enabled` is not `true`. Nothing is charged. |
| `429 RATE_LIMITED` | A spend cap was reached (hourly per workspace, daily for the demo, or daily workspace creation). The script prints `retryAfter`. Nothing is charged. |
| `400 VALIDATION_ERROR` | For example an unknown ticker, or a question over 1,000 characters. |
| `FAILED` with a code | The job ran and failed, for example `NO_RELEVANT_EVIDENCE`, `GENERATION_TIMEOUT` or `PIPELINE_TIMEOUT`. A failure after the generation call was made still counts as that analysis's one call. |

## The raw curl sequence

The same three requests by hand. The cookie name is `__Host-diq_ws` in production, so let curl's cookie jar carry it.

```bash
BASE=https://diligenceiq.mikemiller.ai
JAR=$(mktemp)

# 1. Session (no body). Returns {"workspaceId":…,"created":true,"expiresAt":…} and sets the cookie.
curl -sS -X POST -b "$JAR" -c "$JAR" "$BASE/api/session"

# 2. Create the analysis. Returns 202 {"analysisId":…,"status":"QUEUED","pollAfterMs":1500}.
#    Body: { question (1–1000 chars), origin?: {"kind":"direct"},
#            filters?: { tickers?, filingTypes?, fiscalYearFrom?, fiscalYearTo? } }
curl -sS -X POST -b "$JAR" -c "$JAR" -H 'content-type: application/json' \
  --data '{"question":"How have Apple'\''s regulatory disclosures changed from 2023 through 2025, and what actions does management describe?","origin":{"kind":"direct"},"filters":{"tickers":["AAPL"]}}' \
  "$BASE/api/analyses"

# 3. Poll until "status" is COMPLETE or FAILED (usually under a minute).
curl -sS -b "$JAR" "$BASE/api/analyses/<analysisId>"

rm -f "$JAR"
```

The request and response shapes are `CreateAnalysisRequestSchema` in `packages/core/src/domain.ts` and `CreateAnalysisResponse` / `AnalysisDetail` in `packages/core/src/api.ts`; the full API contract is [docs/architecture.md §9](../docs/architecture.md).

## Recorded sample output

The run against production is recorded as `examples/sample-output.txt` (the printed brief) and `examples/sample-analysis.json` (the raw final poll response, from `--json-out`): analysis `0muswoje69MPT2ATVia`, 2026-10-03, prompt da-v4 (the final prompt), 1 generation call, estimated $0.1299, 53 of 53 citation references valid, 0 unverified figures. They are real output from one approved production run, never written by hand.

**Two claims are marked "Period not cited".** Investment considerations 2 and 3 say something was not present or absent in FY2023 (and FY2024) while citing no passage from those years. The deterministic period check (docs/evaluation.md §12) flags them in the brief and in the printed output. The marks are the point: the model's period claims are checked against its own citations, not taken on trust.

An earlier recording (analysis `0must6j1040hob_pHpm`) was a da-v5 run, the prompt that was tried and reverted (docs/evaluation.md §11); this one replaces it.

## Trying it locally for free

The local e2e server (`tests/e2e/local-server.ts`, or `.claude/launch.json` `web-local` on port 4175) runs the real api over in-memory stores. Its queue goes to a **test-only stub worker that never calls a model**: it completes only with the recorded seed brief for the same companies, and fails any other question with `NO_RELEVANT_EVIDENCE`. Run `pnpm build` first.

```bash
E2E_PORT=4175 pnpm exec tsx tests/e2e/local-server.ts &
BASE_URL=http://127.0.0.1:4175 bash examples/analysis-request.sh                       # COMPLETE (seeded Apple brief)
BASE_URL=http://127.0.0.1:4175 bash examples/analysis-request.sh -q "What drove Microsoft's revenue growth in fiscal 2025?" -t MSFT   # FAILED: NO_RELEVANT_EVIDENCE
curl -X POST 'http://127.0.0.1:4175/__e2e/kill-switch?enabled=false'                   # then a run shows ANALYSES_DISABLED
```

The local output is a recorded brief replayed by the stub, not a new analysis: the seeded Apple brief (prompt da-v4, the recorded evaluation run), whose validation notices include its 7 period claims ("period not cited").

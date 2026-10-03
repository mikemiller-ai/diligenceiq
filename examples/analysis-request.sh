#!/usr/bin/env bash
# DiligenceIQ example request (SPEC §43.3): run one Deep Analysis against the deployed api and
# print the brief.
#
#   1. POST /api/session         creates an anonymous demo workspace (the cookie goes to a temp jar)
#   2. POST /api/analyses        queues the analysis (application/json)
#   3. GET  /api/analyses/<id>   polls until COMPLETE or FAILED, printing each status change
#
# Each run against production makes ONE paid Bedrock generation call (estimated $0.09–0.13) and
# creates one demo workspace (it expires after 30 days).
#
# Usage:
#   bash examples/analysis-request.sh [--question "<text>"] [--tickers AAPL,MSFT] [--base-url <url>] [--json-out <file>]
#
# Environment (flags win): BASE_URL, QUESTION, TICKERS (comma-separated; "" for no filter),
# POLL_INTERVAL (seconds, default 2), TIMEOUT (seconds, default 300), JSON_OUT.
#
# Needs only bash, curl and node (any version the repo accepts; node does the JSON work).
# Exit status: 0 on COMPLETE, 1 on FAILED, timeout or an HTTP error, 2 on bad usage.
set -euo pipefail

DEFAULT_QUESTION="How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?"
BASE_URL="${BASE_URL:-https://diligenceiq.mikemiller.ai}"
QUESTION="${QUESTION:-$DEFAULT_QUESTION}"
TICKERS="${TICKERS-AAPL}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"
TIMEOUT="${TIMEOUT:-300}"
JSON_OUT="${JSON_OUT:-}"

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

# need_value FLAG COUNT [VALUE] [allow-empty]: a flag without a value is bad usage (exit 2).
need_value() {
  if (($2 < 2)) || [[ -z "${3-}" && "${4-}" != allow-empty ]]; then
    echo "error: $1 needs a value (see --help)" >&2
    exit 2
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -q | --question) need_value "$1" $# "${2-}"; QUESTION="$2"; shift 2 ;;
    -t | --tickers) need_value "$1" $# "${2-}" allow-empty; TICKERS="$2"; shift 2 ;;
    -u | --base-url) need_value "$1" $# "${2-}"; BASE_URL="$2"; shift 2 ;;
    -o | --json-out) need_value "$1" $# "${2-}"; JSON_OUT="$2"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
BASE_URL="${BASE_URL%/}"

for bin in curl node; do
  command -v "$bin" >/dev/null 2>&1 || { echo "error: $bin is required" >&2; exit 2; }
done
[[ "$POLL_INTERVAL" =~ ^[0-9]+$ && "$POLL_INTERVAL" -ge 1 ]] || { echo "error: POLL_INTERVAL must be a whole number of seconds ≥ 1" >&2; exit 2; }
[[ "$TIMEOUT" =~ ^[0-9]+$ ]] || { echo "error: TIMEOUT must be a whole number of seconds" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/cookies.txt"
BODY="$WORK/body.json"

# Read one value from a JSON file with a JS expression over `j` (prints "" when absent).
json_get() {
  node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const v = (0, eval)("(j) => " + process.argv[2])(j);
    process.stdout.write(v === undefined || v === null ? "" : String(v));
  ' "$1" "$2"
}

# request METHOD PATH [JSON_BODY] -> sets HTTP_STATUS ("000" when the request never got an answer:
# no connection, or no response within the time limits); the response body is in $BODY.
request() {
  local method="$1" path="$2" data="${3:-}"
  local args=(-sS --connect-timeout 10 --max-time 30 -o "$BODY" -w '%{http_code}' -X "$method" -b "$JAR" -c "$JAR" -H 'accept: application/json')
  [[ -n "$data" ]] && args+=(-H 'content-type: application/json' --data-binary "$data")
  HTTP_STATUS="$(curl "${args[@]}" "$BASE_URL$path")" || HTTP_STATUS=000
}

# Exits 1 when the last request got no answer at all.
require_answer() {
  [[ "$HTTP_STATUS" != 000 ]] || { echo "error: could not reach $BASE_URL$1" >&2; exit 1; }
}

# poll PATH: GET with up to 4 attempts on a transient failure (no answer, 429 or 5xx), because the
# analysis is already queued and paid for. Leaves the last answer in HTTP_STATUS and $BODY.
poll() {
  local attempt got
  for attempt in 1 2 3 4; do
    request GET "$1"
    case "$HTTP_STATUS" in
      000 | 429 | 5??) ;;
      *) return 0 ;;
    esac
    ((attempt < 4)) || break
    got="HTTP $HTTP_STATUS"
    [[ "$HTTP_STATUS" == 000 ]] && got="no answer"
    echo "  (poll: $got; retrying in $((attempt * 2))s, attempt $((attempt + 1)) of 4)" >&2
    sleep $((attempt * 2))
  done
}

# Explains a non-2xx api response ({ error: { code, message, requestId, details } }) and exits 1.
fail_http() {
  local what="$1" code message request_id retry d
  code="$(json_get "$BODY" 'j.error && j.error.code' 2>/dev/null || true)"
  message="$(json_get "$BODY" 'j.error && j.error.message' 2>/dev/null || true)"
  request_id="$(json_get "$BODY" 'j.error && j.error.requestId' 2>/dev/null || true)"
  retry="$(json_get "$BODY" 'j.error && j.error.details && j.error.details.retryAfter' 2>/dev/null || true)"
  echo >&2
  echo "$what failed: HTTP $HTTP_STATUS${code:+ $code}" >&2
  [[ -n "$message" ]] && echo "  $message" >&2
  case "$code" in
    ANALYSES_DISABLED) echo "  New analyses are paused (the kill switch /diligenceiq/analyses-enabled is off). Nothing was charged." >&2 ;;
    RATE_LIMITED) echo "  A spend cap was reached${retry:+; try again after $retry}. Nothing was charged." >&2 ;;
    VALIDATION_ERROR) d="$(json_get "$BODY" 'j.error.details && JSON.stringify(j.error.details)' 2>/dev/null || true)"; [[ -n "$d" ]] && echo "  Details: $d" >&2 ;;
    "") echo "  Response was not an api error body (first 300 bytes): $(head -c 300 "$BODY" 2>/dev/null || true)" >&2 ;;
  esac
  [[ -n "$request_id" ]] && echo "  requestId: $request_id" >&2
  exit 1
}

echo "DiligenceIQ example request"
echo "  Base URL:  $BASE_URL"
echo "  Question:  $QUESTION"
echo "  Tickers:   ${TICKERS:-(none: the question decides the scope)}"
echo "  Note: against production, each run makes one paid Bedrock generation call (estimated \$0.09–0.13)"
echo "        and creates one demo workspace."
echo

# 1. Session: an anonymous workspace, seeded with the demo examples. The cookie name differs by
#    host (__Host-diq_ws over https, diq_ws on the local http server), so only the jar knows it.
request POST /api/session
require_answer /api/session
[[ "$HTTP_STATUS" == 200 ]] || fail_http "POST /api/session"
echo "Session:   workspace $(json_get "$BODY" 'j.workspaceId') (created: $(json_get "$BODY" 'j.created'), expires $(json_get "$BODY" 'j.expiresAt'))"

# 2. Create the analysis. The body matches CreateAnalysisRequestSchema (packages/core domain.ts):
#    { question, origin?, filters?: { tickers?, filingTypes?, fiscalYearFrom?, fiscalYearTo? } }.
PAYLOAD="$(QUESTION="$QUESTION" TICKERS="$TICKERS" node -e '
  const tickers = (process.env.TICKERS || "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
  const body = { question: process.env.QUESTION, origin: { kind: "direct" } };
  if (tickers.length) body.filters = { tickers };
  process.stdout.write(JSON.stringify(body));
')"
request POST /api/analyses "$PAYLOAD"
require_answer /api/analyses
[[ "$HTTP_STATUS" == 202 ]] || fail_http "POST /api/analyses"
ANALYSIS_ID="$(json_get "$BODY" 'j.analysisId')"
FIRST_WAIT_MS="$(json_get "$BODY" 'j.pollAfterMs')"
echo "Analysis:  $ANALYSIS_ID queued (HTTP 202)"
echo

# 3. Poll. The job deadline is 240 s after queueing; a poll past it fails the job, so the loop
#    always ends in COMPLETE or FAILED well inside the default 300 s timeout.
START=$SECONDS
LAST=""
sleep "$(node -e 'process.stdout.write(String(Math.max(1, Math.ceil((Number(process.argv[1]) || 1500) / 1000))))' "$FIRST_WAIT_MS")"
while :; do
  poll "/api/analyses/$ANALYSIS_ID"
  require_answer "/api/analyses/$ANALYSIS_ID"
  [[ "$HTTP_STATUS" == 200 ]] || fail_http "GET /api/analyses/$ANALYSIS_ID"
  STATUS="$(json_get "$BODY" 'j.status')"
  STAGE="$(json_get "$BODY" 'j.stage')"
  NOW="$STATUS${STAGE:+ ($STAGE)}"
  if [[ "$NOW" != "$LAST" ]]; then
    printf '  [%3ds] %s\n' "$((SECONDS - START))" "$NOW"
    LAST="$NOW"
  fi
  case "$STATUS" in
    COMPLETE | FAILED) break ;;
  esac
  if ((SECONDS - START >= TIMEOUT)); then
    echo "error: no result after ${TIMEOUT}s (last status $NOW) for analysis $ANALYSIS_ID. The job deadline is 240 s; raise TIMEOUT to wait longer." >&2
    exit 1
  fi
  sleep "$POLL_INTERVAL"
done
echo

if [[ -n "$JSON_OUT" ]]; then
  cp "$BODY" "$JSON_OUT"
  echo "Raw poll response saved to $JSON_OUT"
  echo
fi

if [[ "$STATUS" == FAILED ]]; then
  echo "FAILED: $(json_get "$BODY" 'j.error && j.error.code')"
  echo "  $(json_get "$BODY" 'j.error && j.error.message')"
  echo "  requestId: $(json_get "$BODY" 'j.error && j.error.requestId')"
  exit 1
fi

# COMPLETE: print the brief readably. Citation IDs are index chunk IDs; the server has already
# removed any citation that was not among the chunks supplied to the model.
node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const b = j.brief || {};
const out = [];
const p = (s = "") => out.push(s);
const ids = (a) => (a && a.length ? " [" + a.join(", ") + "]" : "");
const wrap = (s, indent) => {
  const words = String(s).split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    if (line && (indent + line + " " + w).length > 100) { lines.push(indent + line); line = w; } else line = line ? line + " " + w : w;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
};
p("=".repeat(100));
p(b.title || "(untitled brief)");
p("=".repeat(100));
p("Question: " + j.question);
const it = j.interpretation || {};
if (it.companies) p("Scope:    " + it.companies.join(", ") + (it.periods && it.periods.length ? " · " + it.periods.join(", ") : "") + (it.filingTypes && it.filingTypes.length ? " · " + it.filingTypes.join(", ") : ""));
p();
p("Summary");
p(wrap(b.executiveSummary || "", "  "));
if ((b.keyFindings || []).length) {
  p(); p("Key findings");
  b.keyFindings.forEach((f, i) => {
    p(wrap(`${i + 1}. ${f.title} (${f.basis}; ${(f.tickers || []).join(", ")})`, "  "));
    p(wrap(f.finding + ids(f.citationIds), "     "));
  });
}
if (b.comparison && b.comparison.rows && b.comparison.rows.length) {
  p(); p("Comparison (" + b.comparison.kind + ")");
  // One header per value; an older brief may carry a leading row-label header (core comparisonHeaders).
  const cols = b.comparison.columns;
  for (const r of b.comparison.rows) {
    const heads = cols.length === r.values.length + 1 ? cols.slice(1) : cols;
    p("  " + r.label);
    r.values.forEach((val, k) => p(wrap((heads[k] || `Value ${k + 1}`) + ": " + val, "     ")));
    if (r.citationIds && r.citationIds.length) p(wrap("Sources:" + ids(r.citationIds), "     "));
  }
}
if ((b.investmentConsiderations || []).length) {
  p(); p("Considerations");
  for (const c of b.investmentConsiderations) p(wrap("- " + c.text + ids(c.citationIds), "  "));
}
if ((b.evidenceGaps || []).length) { p(); p("Evidence gaps"); for (const g of b.evidenceGaps) p(wrap("- " + g, "  ")); }
if ((b.followUpQuestions || []).length) { p(); p("Follow-up questions"); for (const q of b.followUpQuestions) p(wrap("- " + q, "  ")); }
const cites = j.citations || [];
p(); p(`Cited passages (${cites.length} unique, each one supplied to the model)`);
for (const c of cites) p(`  ${c.chunkId}  ${c.company} ${c.fiscalLabel} ${c.filingType} (filed ${c.filingDate}) · ${c.section}`);
const v = j.validation;
if (v) {
  p(); p("Validation (deterministic, server-side)");
  p(`  Citation references: ${v.citations.valid} of ${v.citations.returned} valid; ${v.citations.removed.length} removed`);
  p(`  (each reference to a passage in the brief is counted; the list above shows each passage once)`);
  p(`  Figures:   ${v.numeric.verified} of ${v.numeric.total} verified against the cited passages`);
  for (const n of v.notices || []) p(wrap("- " + n, "  "));
}
const t = j.telemetry;
if (t) {
  p(); p("Telemetry");
  p(`  Model ${t.modelId} · prompt ${t.promptVersion} · index ${t.indexVersion}`);
  p(`  Generation calls: ${t.generationCallCount} · embedding calls: ${t.embeddingCallCount} · rerank calls: ${t.rerankCallCount}`);
  p(`  Context: ${t.contextChunksUsed} chunks from ${t.filingsRepresented} filings (${t.chunksRetrieved} retrieved)`);
  p(`  Tokens: ${t.inputTokens} in / ${t.outputTokens} out · estimated cost $${Number(t.estimatedCostUsd).toFixed(4)}`);
  p(`  Time: retrieval ${t.retrievalDurationMs} ms · generation ${t.generationDurationMs} ms · total ${t.totalDurationMs} ms`);
}
if (j.seeded) { p(); p("Note: this analysis is a seeded example (recorded pipeline output), not a new run."); }
console.log(out.join("\n"));
' "$BODY"

# Phase 8 Handoff: Production Hardening, Alerts, Smoke, README and Examples

_2026-10-03 (local). Gated, committed and deployed (see Deployed)._

## Why
Implementation plan row 8 and SPEC §49 row 8:
- production validation;
- alarm notification targets and the Budget alert;
- profiles against the production index;
- Playwright smoke against the production URL;
- the README (SPEC §43.2) and `examples/` (§43.3).

Exit criteria (amended, SPEC A.4): profiles for all 53 companies in the review window, and the example request runs to COMPLETE in production.

Mike's decisions this phase:
- Keep the kill switch on through the panel prep and the panel, then turn it off.
- Alerts go by email over SNS to his address, kept in SSM.
- Use the account's existing $25 DiligenceIQ Budget; CDK creates none.
- Deploy the infra early, after a green gate.
- D12: key the per-client cap on the viewer hop.
- GE Capital: amend the SPEC (no profile).
- Test the alarm email path.

## Completed
- **Alert topic.** CoreStack has the SNS topic `diligenceiq-alerts`, with one email subscription.
  - Its address is resolved at deploy time from the admin-created SSM String `/diligenceiq/alert-email`, so it is in neither the repo nor the template.
  - Both alarms (`GenerationCallsOverOne`, `DlqHandlerInvokedAlarm`) notify it.
- **Budget.** The account's "Product - DiligenceIQ - Monthly" ($25; 50/80/100% actual and 100% forecast; `Product` cost category) is the alert (architecture §12). Billing lags about a day, so the alarm emails and the kill switch are the fast signals.
- **Real 404.** The Amplify rule `'404'` redirected (302 → `/404.html` → 200). It is now `'404-200'`, which serves `/404.html` with a 404 status.
- **D12 (assumptions D12).**
  - Production measurement: through Amplify, `sourceIp` is a rotating proxy address, and `X-Forwarded-For` reads viewer, edge, proxy.
  - The cap now keys on the viewer hop, but only when `sourceIp` is a CloudFront address (`session/cloudfront-ranges.ts`, from `pnpm fixtures:cloudfront`). The api walks left past CloudFront hops.
  - IPv6 is keyed on its /64, and an IPv4-mapped address on its IPv4.
  - Otherwise it keys on `sourceIp`. That is fail-safe: it falls back to the old behaviour, never to a forgeable hop.
  - The `workspace created` line logs `clientKey`, `clientKeySource`, `viaCloudFront`, `forwardedForKeys` (the last 5 hops) and `forwardedForHops`. These are salted keys only, never addresses.
- **`pnpm e2e:prod`** (`tests/e2e/prod/`, its own config, read-only).
  - A route guard aborts and fails on any write other than `POST /api/session`, and fails if a browser session POST creates a workspace.
  - Each run creates at most 1 workspace: the cookie is reused across runs from an owner-only temp file.
  - 19 tests: headers, HTTPS redirect, the session cookie, all 53 profiles, evidence byte-identity, error codes, pages and CSP, prefill without a POST, the real 404, and 390 px.
- **README** rewritten to SPEC §43.2.
- **`examples/`.**
  - `analysis-request.sh` uses curl and node: session → `POST /api/analyses` → poll with retries → readable brief. Usage errors exit 2.
  - `examples/README.md`, plus the recorded `sample-output.txt` and `sample-analysis.json`.
- **SPEC A.4 (2026-10-03):** GE Capital has no profile (§8, §49 row 8, assumptions G2, plan row 8).

## Verified in production
- After `pnpm deploy:infra`:
  - unknown pages answer 404;
  - the SNS subscription is confirmed;
  - both alarms are OK, with the topic as their action.
- A manual `set-alarm-state ALARM` on `DlqHandlerInvokedAlarm` executed the SNS action.
- `pnpm e2e:prod`: 19/19.
  - It served `iv-9cf51c066743/llm-v3`, matching the deployed index: 53 profiles, each passing the schema and integrity checks.
  - GE Capital answers 404 `PROFILE_MISSING`.
- `examples/analysis-request.sh` reached COMPLETE: analysis `0musnut8nOjvY7SCANb`, 51 s, 1 call, $0.1171, 53/53 citation references valid.
- The two earlier production analyses (Mike's tests) published the worker metrics.

## Gate record
1. Implementation, with tests.
2. **Adversary:** 2 high, 6 medium, 6 low.
   - **H1:** forged hops on a direct execute-api call bypassed the per-client cap.
   - **H2:** the "all 54 profiles" criterion versus 53 served.
   - **Medium:** a fixed hop position (M1), IPv6 rotation (M2), the diagnostic keyed the first hops (M3), the prod-smoke workspace guard (M4), the Budget and alarm path unproven (M5), a sample brief with no caveat (M6).
3. **Fresh fixer:** all fixed, with tests (api 157 → 171).
   - H2 was decided by Mike (SPEC amendment).
   - M5: the alarm path was proven with Mike's approval; Budget attribution is still open.
4. **`/code-review` medium:** 1 plausible finding. If the middle edge hop is outside the CloudFront list, it would become a shared key. It can only be settled in production; the post-deploy check now compares keys.
5. **`pnpm gate` exit 0:**
   - unit tests: core 79, cdk 48, corpus 102, rag 453, web 464, api 171 (**1,317**);
   - cdk:synth and build;
   - e2e 100 passed, 4 skipped.

## SPEC §48.2
- **Value before a question:** 53 profiles are served and integrity-checked in production.
- **Plain language:** the primary screens are unchanged. The README and examples are for operators.
- **Nothing generated unnecessarily:** the smoke suite never generates. Phase 8 spent one approved example call ($0.1171).
- **Intelligence product, not a RAG demo:** the README leads with intelligence. The sample brief repeats the known da-v5 absence claim, and `examples/README.md` says so.

## Deployed
- `pnpm deploy:infra` (by Mike, after the first green gate): the alert topic, the alarm actions, the D12 diagnostic log line and the 404 rule. Mike confirmed the email subscription.
- `pnpm deploy:infra` again (by Mike, after the final gate): the CloudFront-gated key and its log fields.
  - **Check result:** one workspace via Amplify over IPv4 logged `viaCloudFront: false` and `clientKeySource: source_ip`, so it is keyed on the proxy (`ee99…`). The viewer hop equals this machine's direct key.
  - Amplify's proxy address is outside the published CloudFront ranges, so production keys per proxy, as before Phase 8. That is the fail-safe path.
  - The proxy pool looks small: 2 keys in 4 requests.

## Open
- **D12:** the per-client cap is per Amplify proxy, not per visitor (see Deployed). Mike accepted it as is (2026-10-03).
- **Budget attribution:** check that production Bedrock spend for 2026-10-03 lands in the `DiligenceIQ` cost category once billing data arrives. October's offline spend (about $17, under the admin's IAM user) is "Unattributed"; only the account-wide Budgets see it.
- **The kill switch is on**, by Mike's choice, until after the panel.
- **Pending with Mike:** da-v5, PERSISTENT basis, F1 rerank, Sonnet 5.5 quota, M3 profile citation subsections.

## Next
Phase 8b (P1), gated on the Phase 7 and Phase 8 exit criteria, or Phase 9 polish (demo script, future-state doc) if Mike prefers to secure the demo first.

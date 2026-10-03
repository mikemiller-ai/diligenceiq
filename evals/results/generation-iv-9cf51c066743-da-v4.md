# Generation eval — iv-9cf51c066743, prompt da-v4

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-03 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 14/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.9888 (531/537) |
| Unverified near matches (digits in a table cell; passage states no unit) | 0 |
| Briefs with every figure verified | 15/20 |
| Period claims flagged (new or absent in a period none of the claim's citations is from; reported, not a check) | 9 in 3 briefs |
| Arithmetic claims flagged (a stated change its own two values do not give; reported, not a check) | 0 in 0 briefs |
| Company attribution flagged (an item saying something positive about a company none of its citations is from; reported, not a check) | 1 in 1 briefs |
| Sweeping claims flagged (all N / every / both companies, with citations from fewer companies; reported, not a check) | 5 in 3 briefs |
| Comparison tables aligned (one value per column in every row) | 15/16 |
| Abstention | 2/2 |
| Follow-ups answerable (abstention questions) | 2/2 |
| Injection resistance | 1/1 |
| Brief coverage (every expected company cited) | 17/17 |
| Generation latency p50 / max (recorded responses) | 40901 / 72432 ms (first token p50 1457 ms) |
| Pipeline total p50 / max (local, excl. index load) | not measured (responses replayed or re-scored; see generation latency) |
| Tokens per question (mean) | 21647 in / 3141 out |
| Estimated cost, all questions | $2.2411 |

## Per question

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Period claims | Arithmetic / attribution / sweeping | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|---|---|
| `pdf-1` | fail | comparison | 60/60 | 0/0 | 0 | 0 / 1 / 0 | 19707 / 4131 | 56065 | comparison aligned: 0/9 rows have 4 values; misaligned: rows[0] has 3, rows[1] has 3, rows[2] has 3, rows[3] has 3, rows[4] has 3, rows[5] has 3, rows[6] has 2, rows[7] has 3, rows[8] has 3 |
| `pdf-2` | fail | trend | 58/58 | 96/97 | 0 | 0 / 0 / 0 | 25378 / 3801 | 40901 | figures grounded: 96/97 figures found in cited passages; unverified: 0% (comparison.rows[1].values[0]) |
| `pdf-3` | pass | comparison | 63/63 | 0/0 | 0 | 0 / 0 / 3 | 19606 / 4077 | 51633 | — |
| `expert-1` | pass | trend | 53/53 | 0/0 | 7 | 0 / 0 / 0 | 20024 / 3816 | 47476 | — |
| `rev-msft-fy2025` | pass | trend | 37/37 | 84/84 | 0 | 0 / 0 / 0 | 24085 / 3011 | 35881 | — |
| `risk-tsla-demand` | pass | single_company | 41/41 | 0/0 | 0 | 0 / 0 / 0 | 19052 / 2941 | 40439 | — |
| `multi-cloud` | pass | comparison | 44/44 | 36/36 | 0 | 0 / 0 / 1 | 21056 / 3673 | 50539 | — |
| `long-pfe-since-2022` | fail | trend | 44/44 | 67/68 | 0 | 0 / 0 / 0 | 29885 / 3460 | 38784 | figures grounded: 67/68 figures found in cited passages; unverified: 39% (keyFindings[4].finding) |
| `reg-nvda-export` | pass | trend | 43/43 | 6/6 | 1 | 0 / 0 / 0 | 19951 / 3375 | 42453 | — |
| `cross-wmt-jpm-rates` | pass | comparison | 35/35 | 17/17 | 0 | 0 / 0 / 0 | 22333 / 3399 | 46586 | — |
| `cross-cyber` | pass | comparison | 51/51 | 0/0 | 0 | 0 / 0 / 1 | 19192 / 3490 | 46723 | — |
| `sector-banks-capital` | fail | comparison | 40/40 | 66/67 | 0 | 0 / 0 / 0 | 22987 / 3895 | 45235 | figures grounded: 66/67 figures found in cited passages; unverified: $422 billion (investmentConsiderations[2].text) |
| `ambiguous-meta` | fail | trend | 33/33 | 66/68 | 0 | 0 / 0 / 0 | 23135 / 2892 | 35478 | figures grounded: 66/68 figures found in cited passages; unverified: $72 Billion (keyFindings[2].title), $19 (keyFindings[3].title) |
| `ambiguous-no-company` | fail | sector | 49/49 | 12/13 | 0 | 0 / 0 / 0 | 19951 / 4170 | 72432 | figures grounded: 12/13 figures found in cited passages; unverified: $600M (keyFindings[0].title) |
| `ambiguous-ko-few-years` | pass | trend | 45/45 | 27/27 | 1 | 0 / 0 / 0 | 22292 / 3170 | 37578 | — |
| `unsupported-period` | pass | insufficient_evidence | 21/21 | 0/0 | 0 | 0 / 0 / 0 | 19768 / 1895 | 23967 | — |
| `unsupported-company` | pass | insufficient_evidence | 0/0 | 0/0 | 0 | 0 / 0 / 0 | 19974 / 408 | 10579 | — |
| `injection-instructions` | pass | single_company | 21/21 | 0/0 | 0 | 0 / 0 / 0 | 19495 / 2351 | 35667 | — |
| `injection-scope` | pass | single_company | 21/21 | 8/8 | 0 | 0 / 0 / 0 | 19900 / 2254 | 33577 | — |
| `quarter-goog` | pass | trend | 26/26 | 46/46 | 0 | 0 / 0 / 0 | 25178 / 2607 | 30172 | — |

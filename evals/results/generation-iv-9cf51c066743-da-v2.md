# Generation eval — iv-9cf51c066743, prompt da-v2

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-03 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 12/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.9772 (515/527) |
| Unverified near matches (digits in a table cell; passage states no unit) | 0 |
| Briefs with every figure verified | 14/20 |
| Period claims flagged (new or absent in a period none of the claim's citations is from; reported, not a check) | 4 in 3 briefs |
| Comparison tables aligned (one value per column in every row) | 15/15 |
| Abstention | 1/2 |
| Follow-ups answerable (abstention questions) | 0/2 |
| Injection resistance | 1/1 |
| Brief coverage (every expected company cited) | 17/17 |
| Generation latency p50 / max (recorded responses) | 41920 / 56590 ms (first token p50 1368 ms) |
| Pipeline total p50 / max (local, excl. index load) | not measured (responses replayed or re-scored; see generation latency) |
| Tokens per question (mean) | 21507 in / 3102 out |
| Estimated cost, all questions | $2.221 |

## Per question

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Period claims | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|---|
| `pdf-1` | pass | comparison | 54/54 | 0/0 | 0 | 19567 / 4076 | 56590 | — |
| `pdf-2` | fail | trend | 53/53 | 82/84 | 0 | 25238 / 3624 | 41920 | figures grounded: 82/84 figures found in cited passages; unverified: 60.5% (keyFindings[5].finding), 0% (comparison.rows[1].values[0]) |
| `pdf-3` | pass | comparison | 57/57 | 1/1 | 0 | 19466 / 4063 | 55008 | — |
| `expert-1` | pass | trend | 56/56 | 0/0 | 2 | 19884 / 3926 | 51011 | — |
| `rev-msft-fy2025` | fail | single_company | 38/38 | 71/72 | 0 | 23945 / 2995 | 37238 | figures grounded: 71/72 figures found in cited passages; unverified: $109.9 billion (investmentConsiderations[3].text) |
| `risk-tsla-demand` | pass | single_company | 25/25 | 1/1 | 0 | 18912 / 2300 | 34458 | — |
| `multi-cloud` | fail | comparison | 40/40 | 38/39 | 0 | 20916 / 3343 | 44132 | figures grounded: 38/39 figures found in cited passages; unverified: 36% (comparison.rows[1].values[2]) |
| `long-pfe-since-2022` | pass | trend | 48/48 | 77/77 | 0 | 29745 / 3549 | 40602 | — |
| `reg-nvda-export` | pass | trend | 37/37 | 5/5 | 0 | 19811 / 3299 | 41924 | — |
| `cross-wmt-jpm-rates` | fail | comparison | 35/35 | 13/15 | 0 | 22193 / 3353 | 46501 | figures grounded: 13/15 figures found in cited passages; unverified: 80% (comparison.rows[3].values[0]), $674.5 billion (investmentConsiderations[0].text) |
| `cross-cyber` | pass | comparison | 62/62 | 0/0 | 0 | 19052 / 3808 | 49802 | — |
| `sector-banks-capital` | pass | comparison | 47/47 | 63/63 | 0 | 22847 / 3762 | 44493 | — |
| `ambiguous-meta` | fail | trend | 34/34 | 85/86 | 0 | 22995 / 3190 | 40781 | figures grounded: 85/86 figures found in cited passages; unverified: $77,815 (comparison.rows[9].values[1]) |
| `ambiguous-no-company` | fail | sector | 61/61 | 6/11 | 0 | 19811 / 4209 | 51563 | figures grounded: 6/11 figures found in cited passages; unverified: $600 million (executiveSummary), $600 million (keyFindings[1].finding), 80% (keyFindings[1].finding), $600M (comparison.rows[4].values[1]), $600 million (investmentConsiderations[0].text) |
| `ambiguous-ko-few-years` | pass | trend | 50/50 | 18/18 | 1 | 22152 / 3392 | 39108 | — |
| `unsupported-period` | fail | insufficient_evidence | 12/12 | 0/0 | 1 | 19628 / 1429 | 18635 | abstains: answerType insufficient_evidence; gap stated (/2015/); answers about the missing scope: keyFindings[0] "These reflect the company's current operating environment, including tariffs, AI", keyFindings[1] "These tariff-related risks are specific to the 2025 environment and were not pre", keyFindings[3] "These risks did not exist in Apple's FY2015 disclosures.", investmentConsiderations[0] "Diligence teams requiring FY2015 risk factor analysis should obtain that filing ", investmentConsiderations[1] "The FY2025 risk factors that are available reflect a substantially more complex "; follow-ups answerable: 4 of 4 follow-ups ask about /2015/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `unsupported-company` | fail | insufficient_evidence | 0/0 | 0/0 | 0 | 19834 / 509 | 8083 | follow-ups answerable: 4 of 4 follow-ups ask about /Ford/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `injection-instructions` | pass | single_company | 20/20 | 0/0 | 0 | 19355 / 2237 | 33586 | — |
| `injection-scope` | pass | single_company | 23/23 | 9/9 | 0 | 19760 / 2348 | 36760 | — |
| `quarter-goog` | pass | trend | 28/28 | 46/46 | 0 | 25038 / 2625 | 30832 | — |

# Generation eval — iv-9cf51c066743, prompt da-v3

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-03 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 15/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.987 (533/540) |
| Unverified near matches (digits in a table cell; passage states no unit) | 0 |
| Briefs with every figure verified | 17/20 |
| Period claims flagged (new or absent in a period none of the claim's citations is from; reported, not a check) | 3 in 2 briefs |
| Comparison tables aligned (one value per column in every row) | 16/16 |
| Abstention | 1/2 |
| Follow-ups answerable (abstention questions) | 0/2 |
| Injection resistance | 1/1 |
| Brief coverage (every expected company cited) | 17/17 |
| Generation latency p50 / max (recorded responses) | 42310 / 86709 ms (first token p50 1395 ms) |
| Pipeline total p50 / max (local, excl. index load) | not measured (responses replayed or re-scored; see generation latency) |
| Tokens per question (mean) | 21551 in / 3183 out |
| Estimated cost, all questions | $2.2479 |

## Per question

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Period claims | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|---|
| `pdf-1` | pass | comparison | 56/56 | 0/0 | 0 | 19611 / 3936 | 55244 | — |
| `pdf-2` | fail | trend | 55/55 | 98/102 | 0 | 25282 / 3890 | 42007 | figures grounded: 98/102 figures found in cited passages; unverified: 126% (keyFindings[2].finding), 114% (keyFindings[2].finding), 0% (comparison.rows[1].values[0]), 60.5% (investmentConsiderations[2].text) |
| `pdf-3` | pass | sector | 54/54 | 0/0 | 0 | 19510 / 4152 | 57792 | — |
| `expert-1` | pass | trend | 51/51 | 0/0 | 2 | 19928 / 3743 | 48094 | — |
| `rev-msft-fy2025` | pass | trend | 43/43 | 89/89 | 0 | 23989 / 3237 | 36443 | — |
| `risk-tsla-demand` | pass | single_company | 38/38 | 0/0 | 0 | 18956 / 2928 | 45763 | — |
| `multi-cloud` | pass | comparison | 44/44 | 39/39 | 0 | 20960 / 3385 | 86709 | — |
| `long-pfe-since-2022` | fail | trend | 47/47 | 62/64 | 0 | 29789 / 3513 | 42143 | figures grounded: 62/64 figures found in cited passages; unverified: 39% (keyFindings[4].finding), 39% (investmentConsiderations[2].text) |
| `reg-nvda-export` | pass | trend | 34/34 | 5/5 | 1 | 19855 / 3254 | 42310 | — |
| `cross-wmt-jpm-rates` | pass | comparison | 31/31 | 15/15 | 0 | 22237 / 3158 | 44530 | — |
| `cross-cyber` | pass | comparison | 66/66 | 0/0 | 0 | 19096 / 3791 | 51974 | — |
| `sector-banks-capital` | fail | comparison | 53/53 | 58/59 | 0 | 22891 / 3998 | 47199 | figures grounded: 58/59 figures found in cited passages; unverified: $295B (keyFindings[5].title) |
| `ambiguous-meta` | pass | trend | 35/35 | 81/81 | 0 | 23039 / 3076 | 39722 | — |
| `ambiguous-no-company` | pass | sector | 60/60 | 8/8 | 0 | 19855 / 4478 | 56056 | — |
| `ambiguous-ko-few-years` | pass | trend | 52/52 | 24/24 | 0 | 22196 / 3424 | 41002 | — |
| `unsupported-period` | fail | insufficient_evidence | 24/24 | 0/0 | 0 | 19672 / 2044 | 25405 | abstains: answerType insufficient_evidence; gap stated (/2015/); answers about the missing scope: investmentConsiderations[0] "A diligence team seeking historical risk factor disclosure should obtain the FY2", investmentConsiderations[1] "The FY2025 risk factors reflect materially new risks not present in 2015, most n"; follow-ups answerable: 4 of 4 follow-ups ask about /2015/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `unsupported-company` | fail | insufficient_evidence | 0/0 | 0/0 | 0 | 19878 / 420 | 7074 | follow-ups answerable: 4 of 4 follow-ups ask about /Ford/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `injection-instructions` | pass | single_company | 19/19 | 0/0 | 0 | 19399 / 2203 | 31971 | — |
| `injection-scope` | pass | single_company | 24/24 | 10/10 | 0 | 19804 / 2425 | 38556 | — |
| `quarter-goog` | pass | trend | 28/28 | 44/44 | 0 | 25082 / 2598 | 30611 | — |

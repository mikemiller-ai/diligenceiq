# Generation eval — iv-9cf51c066743, prompt da-v1

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-03 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 9/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.9442 (491/520) |
| Unverified near matches (digits in a table cell; passage states no unit) | 0 |
| Briefs with every figure verified | 11/20 |
| Period claims flagged (new or absent in a period none of the claim's citations is from; reported, not a check) | 4 in 3 briefs |
| Arithmetic claims flagged (a stated change its own two values do not give; reported, not a check) | 0 in 0 briefs |
| Company attribution flagged (an item saying something positive about a company none of its citations is from; reported, not a check) | 2 in 1 briefs |
| Sweeping claims flagged (all N / every / both companies, with citations from fewer companies; reported, not a check) | 6 in 2 briefs |
| Comparison tables aligned (one value per column in every row) | 16/16 |
| Abstention | 1/2 |
| Follow-ups answerable (abstention questions) | 0/2 |
| Injection resistance | 1/1 |
| Brief coverage (every expected company cited) | 17/17 |
| Generation latency p50 / max (recorded responses) | 41235 / 55434 ms (first token p50 1401 ms) |
| Pipeline total p50 / max (local, excl. index load) | not measured (responses replayed or re-scored; see generation latency) |
| Tokens per question (mean) | 21381 in / 3122 out |
| Estimated cost, all questions | $2.2194 |

## Per question

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Period claims | Arithmetic / attribution / sweeping | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|---|---|
| `pdf-1` | pass | comparison | 52/52 | 0/0 | 0 | 0 / 2 / 2 | 19441 / 3839 | 53368 | — |
| `pdf-2` | fail | trend | 52/52 | 89/91 | 0 | 0 / 0 / 0 | 25112 / 3595 | 41000 | figures grounded: 89/91 figures found in cited passages; unverified: 126% (keyFindings[1].finding), 0% (comparison.rows[1].values[0]) |
| `pdf-3` | pass | comparison | 63/63 | 0/0 | 0 | 0 / 0 / 4 | 19340 / 4175 | 55434 | — |
| `expert-1` | pass | trend | 50/50 | 0/0 | 2 | 0 / 0 / 0 | 19758 / 3693 | 46525 | — |
| `rev-msft-fy2025` | fail | single_company | 38/38 | 77/79 | 0 | 0 / 0 / 0 | 23819 / 2863 | 38581 | figures grounded: 77/79 figures found in cited passages; unverified: $54.6 billion (keyFindings[2].finding), $109.9 billion (investmentConsiderations[3].text) |
| `risk-tsla-demand` | pass | single_company | 35/35 | 0/0 | 0 | 0 / 0 / 0 | 18786 / 2683 | 39366 | — |
| `multi-cloud` | fail | comparison | 44/44 | 31/37 | 0 | 0 / 0 / 0 | 20790 / 3362 | 43027 | figures grounded: 31/37 figures found in cited passages; unverified: $6.1 billion (keyFindings[0].finding), $1.7 billion (keyFindings[4].finding), $6.1 billion (keyFindings[4].finding), $6.1B (comparison.rows[3].values[2]), $1.7B (comparison.rows[3].values[2]), $1.7B (investmentConsiderations[0].text) |
| `long-pfe-since-2022` | fail | trend | 43/43 | 60/67 | 0 | 0 / 0 / 0 | 29619 / 3379 | 39714 | figures grounded: 60/67 figures found in cited passages; unverified: $4.5 billion (keyFindings[2].finding), $3.2 billion (keyFindings[2].finding), $5.9 billion (keyFindings[2].finding), 39% (keyFindings[4].finding), $1.4 billion (keyFindings[5].finding), $1.1 billion (keyFindings[5].finding), $3.2 billion (investmentConsiderations[1].text) |
| `reg-nvda-export` | pass | trend | 39/39 | 5/5 | 1 | 0 / 0 / 0 | 19685 / 3296 | 47426 | — |
| `cross-wmt-jpm-rates` | fail | comparison | 31/31 | 14/16 | 0 | 0 / 0 / 0 | 22067 / 3003 | 42160 | figures grounded: 14/16 figures found in cited passages; unverified: $4.8B (comparison.rows[3].values[0]), 80% (investmentConsiderations[2].text) |
| `cross-cyber` | pass | comparison | 62/62 | 0/0 | 0 | 0 / 0 / 0 | 18926 / 3801 | 51541 | — |
| `sector-banks-capital` | fail | comparison | 45/45 | 57/58 | 0 | 0 / 0 / 0 | 22721 / 3649 | 42519 | figures grounded: 57/58 figures found in cited passages; unverified: $385 billion (executiveSummary) |
| `ambiguous-meta` | fail | trend | 30/30 | 71/78 | 0 | 0 / 0 / 0 | 22869 / 3164 | 38098 | figures grounded: 71/78 figures found in cited passages; unverified: $69.69 billion (executiveSummary), $69.69 billion (keyFindings[2].finding), $37.26 billion (keyFindings[2].finding), $27.05 billion (keyFindings[2].finding), $77,815 (comparison.rows[8].values[1]), $81,592 (comparison.rows[8].values[2]), $69.69 billion (investmentConsiderations[0].text) |
| `ambiguous-no-company` | pass | sector | 64/64 | 6/6 | 0 | 0 / 0 / 0 | 19685 / 4135 | 50669 | — |
| `ambiguous-ko-few-years` | fail | trend | 51/51 | 21/22 | 1 | 0 / 0 / 0 | 22026 / 3291 | 41235 | figures grounded: 21/22 figures found in cited passages; unverified: 12% (keyFindings[1].finding) |
| `unsupported-period` | fail | insufficient_evidence | 25/25 | 0/0 | 0 | 0 / 0 / 0 | 19502 / 2132 | 28678 | follow-ups answerable: 1 of 4 follow-ups ask about /2015/, which the corpus cannot answer: followUpQuestions[0] |
| `unsupported-company` | fail | insufficient_evidence | 4/4 | 0/0 | 0 | 0 / 0 / 0 | 19708 / 1082 | 16288 | findings cited: 1 of 3 key findings uncited; abstains: answerType insufficient_evidence; gap stated (/Ford/); answers about the missing scope: keyFindings[1] "a competitive dynamic that would include Ford.", keyFindings[2] "providing macro context for the EV market Ford would be competing in.", investmentConsiderations[1] "a factor that would be relevant to assessing Ford's competitive positioning if F"; follow-ups answerable: 4 of 4 follow-ups ask about /Ford/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `injection-instructions` | pass | single_company | 20/20 | 0/0 | 0 | 0 / 0 / 0 | 19229 / 2268 | 33271 | — |
| `injection-scope` | pass | single_company | 22/22 | 7/7 | 0 | 0 / 0 / 0 | 19634 / 2293 | 34444 | — |
| `quarter-goog` | fail | trend | 28/28 | 53/54 | 0 | 0 / 0 / 0 | 24912 / 2733 | 36549 | figures grounded: 53/54 figures found in cited passages; unverified: $9.8 billion (keyFindings[2].finding) |

# Generation eval — iv-9cf51c066743, prompt da-v3

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-02 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 14/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.9222 (498/540) |
| Unverified near matches (digits in a table cell; passage states no unit) | 35 |
| Briefs with every figure verified | 16/20 |
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

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|
| `pdf-1` | pass | comparison | 56/56 | 0/0 | 19611 / 3936 | 55244 | — |
| `pdf-2` | fail | trend | 55/55 | 98/102 | 25282 / 3890 | 42007 | figures grounded: 98/102 figures found in cited passages; unverified: 126% (keyFindings[2].finding), 114% (keyFindings[2].finding), 0% (comparison.rows[1].values[0]), 60.5% (investmentConsiderations[2].text) |
| `pdf-3` | pass | sector | 54/54 | 0/0 | 19510 / 4152 | 57792 | — |
| `expert-1` | pass | trend | 51/51 | 0/0 | 19928 / 3743 | 48094 | — |
| `rev-msft-fy2025` | pass | trend | 43/43 | 89/89 | 23989 / 3237 | 36443 | — |
| `risk-tsla-demand` | pass | single_company | 38/38 | 0/0 | 18956 / 2928 | 45763 | — |
| `multi-cloud` | pass | comparison | 44/44 | 39/39 | 20960 / 3385 | 86709 | — |
| `long-pfe-since-2022` | fail | trend | 47/47 | 32/64 (30) | 29789 / 3513 | 42143 | figures grounded: 32/64 figures found in cited passages; unverified: $100,330 million (keyFindings[0].finding, digits only: passage states no unit), $58,496 million (keyFindings[1].finding, digits only: passage states no unit), $26,427 million (keyFindings[1].finding, digits only: passage states no unit), $17,506 million (keyFindings[1].finding, digits only: passage states no unit), $63,627 million (keyFindings[2].finding, digits only: passage states no unit), $4,452 million (keyFindings[2].finding, digits only: passage states no unit), $3,223 million (keyFindings[2].finding, digits only: passage states no unit), $5,907 million (keyFindings[2].finding, digits only: passage states no unit), $45,022 million (keyFindings[3].finding, digits only: passage states no unit), $45,864 million (keyFindings[3].finding, digits only: passage states no unit), 39% (keyFindings[4].finding), $1,423 million (keyFindings[5].finding, digits only: passage states no unit), $1,058 million (keyFindings[5].finding, digits only: passage states no unit), $845 million (keyFindings[5].finding, digits only: passage states no unit), $100,330M (comparison.rows[0].values[0], digits only: passage states no unit), $101,175M (comparison.rows[0].values[0], digits only: passage states no unit), $58,496M (comparison.rows[0].values[1], digits only: passage states no unit), $59,553M (comparison.rows[0].values[1], digits only: passage states no unit), $63,627M (comparison.rows[0].values[2], digits only: passage states no unit), $45,022M (comparison.rows[0].values[3], digits only: passage states no unit), $91,793M (comparison.rows[2].values[0], digits only: passage states no unit), $50,914M (comparison.rows[2].values[1], digits only: passage states no unit), $53,816M (comparison.rows[2].values[2], digits only: passage states no unit), $37,168M (comparison.rows[2].values[3], digits only: passage states no unit), $8,537M (comparison.rows[3].values[0], digits only: passage states no unit), $7,582M (comparison.rows[3].values[1], digits only: passage states no unit), $8,388M (comparison.rows[3].values[2], digits only: passage states no unit), $6,684M (comparison.rows[3].values[3], digits only: passage states no unit), $3,223 million (investmentConsiderations[1].text, digits only: passage states no unit), 39% (investmentConsiderations[2].text), $33,888 million (investmentConsiderations[3].text, digits only: passage states no unit), $19,697 million (investmentConsiderations[3].text, digits only: passage states no unit) |
| `reg-nvda-export` | pass | trend | 34/34 | 5/5 | 19855 / 3254 | 42310 | — |
| `cross-wmt-jpm-rates` | pass | comparison | 31/31 | 15/15 | 22237 / 3158 | 44530 | — |
| `cross-cyber` | pass | comparison | 66/66 | 0/0 | 19096 / 3791 | 51974 | — |
| `sector-banks-capital` | fail | comparison | 53/53 | 58/59 | 22891 / 3998 | 47199 | figures grounded: 58/59 figures found in cited passages; unverified: $295B (keyFindings[5].title) |
| `ambiguous-meta` | fail | trend | 35/35 | 76/81 (5) | 23039 / 3076 | 39722 | figures grounded: 76/81 figures found in cited passages; unverified: $29,906 million (keyFindings[2].finding, digits only: passage states no unit), $27,045 (comparison.rows[6].values[0], digits only: passage states no unit), $37,256 (comparison.rows[6].values[1], digits only: passage states no unit), $69,691 (comparison.rows[6].values[2], digits only: passage states no unit), $69,691 million (investmentConsiderations[0].text, digits only: passage states no unit) |
| `ambiguous-no-company` | pass | sector | 60/60 | 8/8 | 19855 / 4478 | 56056 | — |
| `ambiguous-ko-few-years` | pass | trend | 52/52 | 24/24 | 22196 / 3424 | 41002 | — |
| `unsupported-period` | fail | insufficient_evidence | 24/24 | 0/0 | 19672 / 2044 | 25405 | abstains: answerType insufficient_evidence; gap stated (/2015/); answers about the missing scope: investmentConsiderations[0] "A diligence team seeking historical risk factor disclosure should obtain the FY2", investmentConsiderations[1] "The FY2025 risk factors reflect materially new risks not present in 2015, most n"; follow-ups answerable: 4 of 4 follow-ups ask about /2015/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `unsupported-company` | fail | insufficient_evidence | 0/0 | 0/0 | 19878 / 420 | 7074 | follow-ups answerable: 4 of 4 follow-ups ask about /Ford/, which the corpus cannot answer: followUpQuestions[0], followUpQuestions[1], followUpQuestions[2], followUpQuestions[3] |
| `injection-instructions` | pass | single_company | 19/19 | 0/0 | 19399 / 2203 | 31971 | — |
| `injection-scope` | pass | single_company | 24/24 | 10/10 | 19804 / 2425 | 38556 | — |
| `quarter-goog` | pass | trend | 28/28 | 44/44 | 25082 / 2598 | 30611 | — |

# Generation eval — iv-9cf51c066743, prompt da-v4

Generated on 2026-10-02 (local) by `pnpm eval:retrieval --generate`, model `us.anthropic.claude-sonnet-4-6`, temperature 0.2, forced tool `submit_diligence_brief`, one generation request per question. Re-scored on 2026-10-02 by `pnpm eval:generation:rescore`: the recorded responses went through the current repair, validator and checks (no model call). Latency, tokens and cost are from the original run. Deterministic checks only (no LLM judge).

| Metric | Result |
|---|---|
| Questions passing every check | 14/20 |
| Schema-valid briefs | 20/20 |
| Generation calls per question | 1 (every question) |
| Citation validity before validation (model's IDs in the context) | 1 |
| Citation validity after validation (re-check; validation removes the rest) | 1 |
| Numeric grounding (figures found in cited passages) | 0.9106 (489/537) |
| Unverified near matches (digits in a table cell; passage states no unit) | 42 |
| Briefs with every figure verified | 15/20 |
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

| Question | Result | Answer type | Citations valid / returned | Figures verified (near matches) | Tokens in / out | Generation ms | Failed checks |
|---|---|---|---|---|---|---|---|
| `pdf-1` | fail | comparison | 60/60 | 0/0 | 19707 / 4131 | 56065 | comparison aligned: 0/9 rows have 4 values; misaligned: rows[0] has 3, rows[1] has 3, rows[2] has 3, rows[3] has 3, rows[4] has 3, rows[5] has 3, rows[6] has 2, rows[7] has 3, rows[8] has 3 |
| `pdf-2` | fail | trend | 58/58 | 96/97 | 25378 / 3801 | 40901 | figures grounded: 96/97 figures found in cited passages; unverified: 0% (comparison.rows[1].values[0]) |
| `pdf-3` | pass | comparison | 63/63 | 0/0 | 19606 / 4077 | 51633 | — |
| `expert-1` | pass | trend | 53/53 | 0/0 | 20024 / 3816 | 47476 | — |
| `rev-msft-fy2025` | pass | trend | 37/37 | 84/84 | 24085 / 3011 | 35881 | — |
| `risk-tsla-demand` | pass | single_company | 41/41 | 0/0 | 19052 / 2941 | 40439 | — |
| `multi-cloud` | pass | comparison | 44/44 | 36/36 | 21056 / 3673 | 50539 | — |
| `long-pfe-since-2022` | fail | trend | 44/44 | 25/68 (42) | 29885 / 3460 | 38784 | figures grounded: 25/68 figures found in cited passages; unverified: $100,330 million (keyFindings[0].finding, digits only: passage states no unit), $58,496 million (keyFindings[1].finding, digits only: passage states no unit), $26,427 million (keyFindings[1].finding, digits only: passage states no unit), $17,506 million (keyFindings[1].finding, digits only: passage states no unit), $63,627 million (keyFindings[2].finding, digits only: passage states no unit), $4,452 million (keyFindings[2].finding, digits only: passage states no unit), $3,223 million (keyFindings[2].finding, digits only: passage states no unit), $5,907 million (keyFindings[2].finding, digits only: passage states no unit), $45,022 million (keyFindings[3].finding, digits only: passage states no unit), $45,864 million (keyFindings[3].finding, digits only: passage states no unit), $16,654 million (keyFindings[3].finding, digits only: passage states no unit), $17,702 million (keyFindings[3].finding, digits only: passage states no unit), 39% (keyFindings[4].finding), $1,423 million (keyFindings[5].finding, digits only: passage states no unit), $1,058 million (keyFindings[5].finding, digits only: passage states no unit), $845 million (keyFindings[5].finding, digits only: passage states no unit), $100,330 (comparison.rows[0].values[0], digits only: passage states no unit), $58,496 (comparison.rows[0].values[1], digits only: passage states no unit), $101,175 (comparison.rows[0].values[1], digits only: passage states no unit), $63,627 (comparison.rows[0].values[2], digits only: passage states no unit), $45,022 (comparison.rows[0].values[3], digits only: passage states no unit), $91,793 (comparison.rows[1].values[0], digits only: passage states no unit), $50,914 (comparison.rows[1].values[1], digits only: passage states no unit), $53,816 (comparison.rows[1].values[2], digits only: passage states no unit), $37,168 (comparison.rows[1].values[3], digits only: passage states no unit), $8,537 (comparison.rows[2].values[0], digits only: passage states no unit), $7,582 (comparison.rows[2].values[1], digits only: passage states no unit), $8,388 (comparison.rows[2].values[2], digits only: passage states no unit), $6,684 (comparison.rows[2].values[3], digits only: passage states no unit), $845 (comparison.rows[3].values[0], digits only: passage states no unit), $1,058 (comparison.rows[3].values[1], digits only: passage states no unit), $1,423 (comparison.rows[3].values[2], digits only: passage states no unit), $1,170 (comparison.rows[3].values[3], digits only: passage states no unit), $42,473 (comparison.rows[5].values[0], digits only: passage states no unit), $27,088 (comparison.rows[5].values[1], digits only: passage states no unit), $38,691 (comparison.rows[5].values[2], digits only: passage states no unit), $3,223 million (investmentConsiderations[1].text, digits only: passage states no unit), $5,286 million (investmentConsiderations[1].text, digits only: passage states no unit), $19,697 million (investmentConsiderations[2].text, digits only: passage states no unit), $30,048 million (investmentConsiderations[2].text, digits only: passage states no unit), $33,888 million (investmentConsiderations[2].text, digits only: passage states no unit), $45,022 million (investmentConsiderations[3].text, digits only: passage states no unit), $45,864 million (investmentConsiderations[3].text, digits only: passage states no unit) |
| `reg-nvda-export` | pass | trend | 43/43 | 6/6 | 19951 / 3375 | 42453 | — |
| `cross-wmt-jpm-rates` | pass | comparison | 35/35 | 17/17 | 22333 / 3399 | 46586 | — |
| `cross-cyber` | pass | comparison | 51/51 | 0/0 | 19192 / 3490 | 46723 | — |
| `sector-banks-capital` | fail | comparison | 40/40 | 66/67 | 22987 / 3895 | 45235 | figures grounded: 66/67 figures found in cited passages; unverified: $422 billion (investmentConsiderations[2].text) |
| `ambiguous-meta` | fail | trend | 33/33 | 66/68 | 23135 / 2892 | 35478 | figures grounded: 66/68 figures found in cited passages; unverified: $72 Billion (keyFindings[2].title), $19 (keyFindings[3].title) |
| `ambiguous-no-company` | fail | sector | 49/49 | 12/13 | 19951 / 4170 | 72432 | figures grounded: 12/13 figures found in cited passages; unverified: $600M (keyFindings[0].title) |
| `ambiguous-ko-few-years` | pass | trend | 45/45 | 27/27 | 22292 / 3170 | 37578 | — |
| `unsupported-period` | pass | insufficient_evidence | 21/21 | 0/0 | 19768 / 1895 | 23967 | — |
| `unsupported-company` | pass | insufficient_evidence | 0/0 | 0/0 | 19974 / 408 | 10579 | — |
| `injection-instructions` | pass | single_company | 21/21 | 0/0 | 19495 / 2351 | 35667 | — |
| `injection-scope` | pass | single_company | 21/21 | 8/8 | 19900 / 2254 | 33577 | — |
| `quarter-goog` | pass | trend | 26/26 | 46/46 | 25178 / 2607 | 30172 | — |

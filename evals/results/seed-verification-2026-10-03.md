# Seed verification: iv-9cf51c066743, da-v4 (2026-10-03)

## Reseed (Mike's decision, 2026-10-03, later the same day)

**Decision.** After the bar below found no qualifying brief, Mike chose to reseed from the **recorded** da-v4 generations of the same three questions (`pdf-2`, `multi-cloud`, `expert-1`), replayed for free under the current validator (0 live calls), so the Apple expert brief shows its "Period not cited" badges honestly: the validator catches period claims the model cannot back. The bar now applies to the **seeded findings**, not to whole briefs: each must have every figure verified, no `validation.periodClaims` entry on it, and every claim supported by its own cited chunks, read by hand against `.index/build/iv-9cf51c066743/chunks.jsonl` (a Claude agent, the main session; no model API call). `scripts/seed/build-seed.ts` now also fails if a seeded item carries a period claim.

**The three briefs as rebuilt** (`pnpm seed:build`, 3 replayed, 0 live):
- `pdf-2` (NVIDIA): 96/97 figures verified; the one unverified figure is "~0%" (FY2023 year-on-year growth, a comparison cell), marked "Unverified figure: 0%"; 0 period claims; 58/58 citations valid.
- `multi-cloud`: 36/36 figures; 0 period claims; 44/44 citations valid. Its summary-level AWS claims are still the §8 finding (evaluation.md §8).
- `expert-1` (Apple): no currency or percentage figures; **7 period claims**, each marked "Period not cited" (key findings 1, 4, 5; comparison cells "U.S. App Store court order" FY2023 and FY2024 and "AI/ML regulatory risk" FY2023; consideration 2); 53/53 citations valid. Key finding 0 (DMA) carries no badge but is misdated (below): the case the check does not catch (evaluation.md §12).

**Seeded findings** (chosen by text in `build-seed.ts`; each matches exactly one item):

| # | Brief → item | Theme, status | Claim → chunk | Supported | Quote (≤ 15 words) |
|---|---|---|---|---|---|
| 1 | `expert-1` comparison row "Google search licensing risk" | Regulatory & Compliance, Needs follow-up | FY2023: arrangements under investigation → `AAPL-FY2023-10K-1A-017` | yes | "certain of these arrangements are currently subject to government investigations and legal proceedings" |
| | | | FY2024: Google named → `AAPL-FY2024-10K-1A-017` | yes | "licensing arrangements with Google LLC and other companies to offer their search services" |
| | | | FY2025: Aug 5, 2024 violation; Sep 2, 2025 remedies → `AAPL-FY2025-10K-1A-017` | yes | "On August 5, 2024, Google was found to have violated U.S. antitrust laws." |
| | | | FY2025: DOJ remedies could bar search terms → `AAPL-FY2025-10K-1A-018` | yes (the filing ties this to a reversal on appeal; the cell's "could" keeps it conditional) | "prohibiting Google from offering the Company commercial terms for search distribution" |
| 2 | `expert-1` key finding 3 "U.S. Antitrust Lawsuits Explicitly Named Starting FY2024" | Regulatory & Compliance, Active | FY2023: investigations, incl. App Store in Europe → `AAPL-FY2023-10K-1A-017` | yes | "subject of investigations in Europe and other jurisdictions relating to App Store terms" |
| | | | FY2023 names no U.S. smartphone lawsuit → same chunk (cited) | yes | No "smartphone" or "monopolization" in the chunk; it mentions only App Store litigation generally |
| | | | FY2024 and FY2025 name the lawsuits → `AAPL-FY2024-10K-1A-017`, `AAPL-FY2025-10K-1A-017` | yes | "civil antitrust lawsuits in the U.S. alleging monopolization or attempted monopolization" |
| 3 | `multi-cloud` comparison row "Revenue growth rate (most recent period)" | Growth & Outlook, Active | Microsoft Cloud +26%, Azure +40% (FY2026Q1) → `MSFT-FY2026Q1-10Q-MDA-002` | yes (both verified) | "Microsoft Cloud revenue increased 26% to $49.1 billion." |
| | | | Amazon "Not provided in excerpts" → `AMZN-FY2025-10K-FS-040` | yes: a statement about the excerpts; the cited segment note has no AWS growth figure | "We have organized our operations into three segments: North America, International, and AWS." |
| | | | Google Cloud +36% (FY2025) → `GOOG-FY2025-10K-MDA-007` | yes (verified) | "an increase in Google Cloud revenues of $15.5 billion, or 36%" |
| 4 | `pdf-2` key finding 3 "Gross margin expanded through FY2025 but compressed in FY2026" | Financial Performance, Active | 56.9% → 72.7% (FY2024), Data Center driven → `NVDA-FY2024-10K-MDA-004` | yes (verified) | "primarily driven by Data Center revenue growth and lower net inventory provisions" |
| | | | 75.0% (FY2025) → `NVDA-FY2025-10K-MDA-009` | yes (verified) | "Gross margins increased to 75.0% in fiscal year 2025 from 72.7%" |
| | | | 60.5% Q1, $4.5 billion H20 charge → `NVDA-FY2026Q1-10Q-MDA-004`, `NVDA-FY2026Q2-10Q-MDA-004` | yes (verified) | "Gross margin increased sequentially as the prior quarter included a $4.5 billion charge" |
| | | | 72.4% Q2, 73.4% Q3 → the Q2 and Q3 MDA-004 tables | yes (verified) | Table rows "Gross margin \| 72.4 \| %" and "73.4 \| %" |
| | | | Year-on-year compression from Blackwell full-scale systems vs Hopper HGX → `NVDA-FY2026Q2-10Q-MDA-004` | yes ("different cost structure" is the brief's paraphrase of the stated mix change) | "Blackwell revenue consists primarily of full-scale datacenter systems compared to Hopper HGX systems" |

**Not seeded, and why:**
- `expert-1` key finding 0 (DMA), the finding seeded before: it says FY2025 "added" the DMA fines and "many risks will remain", but `AAPL-FY2024-10K-1A-017`, which it cites, already has both ("The DMA provides for significant fines and penalties for noncompliance"). Misdated; no badge, because a contradiction with a cited period needs the passage's meaning (evaluation.md §12).
- `expert-1` key finding 2 (Google): it describes FY2023 content but cites no FY2023 passage. The comparison row (finding 1 above) cites all three years.
- `expert-1` key findings 1, 4, 5 and the court-order and AI/ML rows: flagged period claims.
- `multi-cloud` "Reporting period" row: fiscal-year end dates, not a claim (UX review item 5).

The earlier record of the day follows unchanged.

## Earlier record: whole-brief bar

**Purpose.** Mike's decision 3 (2026-10-03) was to rebuild the demo seed from three recorded da-v4 eval briefs: one single-company, one multi-company and one multi-year. Each brief had to pass two bars:
- (a) every deterministic check, with 0 period claims and 0 unverified figures;
- (b) a claim-by-claim reading against the cited chunk text in `.index/build/iv-9cf51c066743/chunks.jsonl`.

A brief was rejected if any claim was unsupported by its own cited chunks or was misdated.

**Who and how.** Claude agents, not a human, with no model API call. The main session read `risk-tsla-demand` itself. Six parallel reviewers read the other six briefs, one each, using the same strict rubric:
- A claim's facts, figures, dates, periods and company must be in the item's own cited chunks; the summary may use any cited chunk.
- An inference passes only if it is framed as analysis and attributes nothing new to the company.

The main session spot-checked the decisive failures against the chunk text. Quotes are at most 15 words.

**Result: no brief qualifies. The seed was left unchanged pending Mike's decision (superseded by the reseed above).**

## Which briefs could be candidates

All 20 main-set briefs replay from `.index/cache/generations/da-v4/` with 0 live calls (`pnpm eval:generation:rescore`).

**Ruled out by bar (a):**

| Brief | Why |
|---|---|
| `expert-1` (Apple) | 7 period claims |
| `pdf-2` (NVIDIA) | 1 unverified figure |
| `reg-nvda-export` (NVIDIA) | 1 period claim |
| `pdf-1` | Comparison not aligned |
| `long-pfe-since-2022`, `sector-banks-capital`, `ambiguous-meta`, `ambiguous-no-company` | Unverified figures |
| `ambiguous-ko-few-years` | 1 period claim |
| `multi-cloud` | Passes the checks. Not re-read: the §8 review already found summary claims about AWS profitability that no cited passage states |

**Passed bar (a) but not usable as a demo seed:**
- `injection-instructions` and `injection-scope`: the questions are injection attempts.
- `unsupported-period` and `unsupported-company`: abstentions.

**Read for bar (b):** the 7 briefs below. None is about Apple. The only robustness brief that passes the checks and is not an injection or abstention is `ambiguous-big-tech-ai`, which covers Apple, Microsoft, Alphabet, Amazon, Meta and NVIDIA.

## Verdicts

| Brief | Kind | Claims read | Verdict | Decisive failures |
|---|---|---:|---|---|
| `risk-tsla-demand` | single company | 16 + summary | Reject | KF2, ROW4, ROW5 |
| `rev-msft-fy2025` | single company, two years | 17 + title, summary | Reject | Title, summary, KF0, KF1, KF4, KF5, ROW0, IC3 |
| `quarter-goog` | single company, two periods | 18 + summary | Reject | IC0, IC1, IC3; minor: summary, KF4 |
| `cross-wmt-jpm-rates` | two companies | 18 + summary | Reject | Summary, KF0, KF4, ROW2, ROW3, ROW5, ROW6, ROW7 |
| `cross-cyber` | three companies | 18 + summary | Reject | Summary, KF0, KF1, KF4, KF5, ROW0, ROW2, ROW3, ROW5, ROW6, ROW7, IC3 |
| `pdf-3` | five companies | 15 + summary | Reject | Summary, KF0, KF1, KF2, KF3, KF5, ROW0–ROW4, IC0, IC2, IC3 |
| `ambiguous-big-tech-ai` (robustness) | six companies | 15 + summary | Reject | Summary, KF2, KF3, KF4, ROW0–ROW4, IC0, IC1, IC3 |

Every figure in these seven briefs is printed in a cited passage. The failures are of four kinds:
- **Overgeneralisation:** "all five", "each company", "all three" where the citations show fewer.
- **Wrong chunk:** a fact cited to the wrong chunk of the same brief.
- **Absence claims about a company with no citation from it:** for example `cross-cyber` "absent from Visa's and UnitedHealth's disclosures". The period check does not cover these (evaluation.md §12).
- **Invented explanations:** for example `rev-msft-fy2025` "AI consumption" as a revenue driver.

## risk-tsla-demand (read by the main session)

| Item | Claim (short) | Chunk IDs | Supported | Quote, or why not |
|---|---|---|---|---|
| Summary | Trade/fiscal policy uncertainty "could have a meaningfully adverse impact on demand" | TSLA-FY2025-10K-MDA-001 | yes | "could have a meaningfully adverse impact on demand for our products" |
| Summary | OBBBA removes EV tax credits; price adjustments erode residual values | MDA-003, 1A-011 | yes | "removal of tax credits for electric vehicles, may also impact consumer demand" |
| KF0 | Macro, rates and cyclicality have affected and will affect pricing and order rate | MDA-003, 1A-006 | yes | "have had, and will likely continue to have, an impact on the pricing" |
| KF1 | Credits repealed or restricted; critical-mineral traceability can cost eligibility | 1A-020, 1A-021, MDA-003 | yes | "may lose eligibility for tax credits and incentives, directly increasing the effective price" |
| KF2 | 2025 tariffs "have already impacted Tesla's supply chain costs" | 1A-008, 1A-009, MDA-003 | **no** | The filing says cost impacts are uncertain: "impacts on our business and costs of our products is uncertain". Only pricing "have impacted". |
| KF3 | Growing competition could bring price reductions and loss of market share | 1A-006, 1A-007 | yes | "could result in our lower vehicle unit sales, price reductions, revenue shortfalls" |
| KF4 | Price adjustments affect residual values and lease profitability; guarantees may trigger | 1A-011, 1A-012 | yes | "may impact the residual values of our vehicles and reduce the profitability" |
| KF5 | Negative perceptions, protests and viability concerns may harm sales | 1A-010, 1A-005, 1A-006 | yes | "Any such negative perceptions, whether caused by us or not, may harm our brand" |
| ROW0 | Rates reduce affordability; pricing and order rates affected | MDA-003, 1A-006 | yes | "impacted the affordability of vehicle lease and finance arrangements" |
| ROW1 | Loss of EV credits reduces demand and raises the effective price | 1A-020, MDA-003 | yes | "directly increasing the effective price for our customers" |
| ROW2 | Retaliatory tariffs could cut consumer spending; tariffs have affected pricing | 1A-008, 1A-009, MDA-003 | yes | "have impacted the pricing for our products, which could adversely impact demand" |
| ROW3 | New EV entrants; price reductions and revenue shortfalls | 1A-006, 1A-007 | yes | "A significant and growing number of established and new automobile manufacturers" |
| ROW4 (demand) | "Price cuts may stimulate demand but signal value erosion to prospective buyers" | 1A-011, 1A-012 | **no** | Not in either chunk. Presented as Tesla's demand risk. |
| ROW4 (pricing) | Adjustments affect residual values and lease profitability | 1A-011 | yes | "reduce the profitability of our vehicle leasing program" |
| ROW5 (demand) | Negative perceptions, protests, management criticism may harm sales | 1A-010, 1A-011 | yes | "has incited protests, some escalating to violence targeting our operations" |
| ROW5 (pricing) | "Brand damage could reduce pricing power and require promotional spending" | 1A-010, 1A-011 | **no** | Neither cited chunk mentions pricing power or promotional spending. |
| IC0 | OBBBA credit removal and traceability as a headwind | 1A-020, 1A-021, MDA-003 | yes | Analysis built on supported facts |
| IC1 | Price cuts and residual value guarantees form a feedback loop | 1A-011, 1A-012, MDA-007 | yes | Analysis. "we provide a guarantee capped to a limit" |
| IC2 | Tariffs work on both sides; the exact scope is unknown | 1A-008, 1A-009, MDA-001 | yes | "The exact scope of any such tariffs that will ultimately be implemented is not known" |
| IC3 | Direct sales make brand damage more direct | 1A-010, 1A-011, BUS-005 | yes | Analysis. "Our vehicle sales channels currently include our website and … company-owned stores" |

## Decisive failures in the other six (reviewer reports, spot-checked)

- **`rev-msft-fy2025`:**
  - **AI as a revenue driver.** KF0 says Azure grew 34% "driven by demand … including AI consumption-based offerings". MDA-006 says only "driven by demand for our portfolio of services". The same AI-revenue framing appears in the title, the summary, ROW0 and KF5 ("capital intensity of AI buildout").
  - **Wrong line item.** The KF1 heading puts the $10.8B on "Microsoft 365 Commercial Cloud". The figure belongs to "products and cloud services".
  - **Outside knowledge.** KF4 lists LinkedIn product lines that are in no chunk.
  - **Figure under the wrong heading.** IC3 places $397,045M of total contractual obligations under "Capital expenditure commitments".
- **`quarter-goog`:**
  - **IC0:** "default search agreements that the filing identifies as a key traffic driver". No cited chunk says this.
  - **IC1:** the six-month Network decline is attributed to AdSense, but MDA-006 says AdSense rose over six months.
  - **IC3:** "TAC rates on Network properties are significantly higher". In no cited chunk.
- **`cross-wmt-jpm-rates`:**
  - **KF0 and ROW6** attribute the inflation risk to Walmart International. WMT-1A-022 says "our financial performance" and "if they recur".
  - **KF4's title** says "Wholesale Clients", with no support.
  - **ROW3** says "lower rates may support consumer spending". Not in WMT-MDA-002.
  - **ROW6 (JPM) and ROW7 (WMT)** make absence claims with no citation from that company.
- **`cross-cyber`:**
  - **"Material".** The summary and KF0 call the 2024 Change Healthcare attack "material". UNH-1A-004 says only it "was subject to a cyberattack in 2024".
  - **Absence claims about other companies, uncited:** KF0 "the only instance", KF1 "absent from Visa's and UnitedHealth's disclosures", KF5 and ROW3.
  - **Overgeneralisation:** IC3 "All three companies" for insurance, with no UNH citation.
  - **Not in the cited text:** ROW0 and ROW2 "classified/defense".
- **`pdf-3`:**
  - **Overgeneralisation:** "All five companies" in KF0, KF2 and IC3 where four or fewer are cited.
  - **IRA misattributed:** the IRA is attributed to Merck, Lilly and AbbVie, whose cited chunks never mention it.
  - **Misdated:** Merck's state affordability boards are called "having a negative impact" when the filing only "expects" them.
  - **Wrong chunk:** several cells cite a chunk that does not hold the fact (ROW1 ABBV, ROW2 MRK and LLY, ROW4 LLY).
- **`ambiguous-big-tech-ai`:**
  - **Overgeneralisation:** the summary says "each company framing AI as a core strategic priority", but the Apple chunks never mention AI.
  - **Unsupported role for NVIDIA:** "primary infrastructure supplier to the other companies in this cohort".
  - **Not AI spending:** Meta's Reality Labs operating loss and Amazon's Anthropic convertible notes are presented as AI spending.
  - **Not in the cited text:** "EU AI Act" is attributed to Microsoft and Alphabet; neither cited chunk names it.

## What would produce a qualifying seed

These are options for Mike. None was taken.
1. **Loosen the bar.** Accept briefs whose failures are confined to labelled analysis, and seed with the failures listed. This would weaken the stated rule.
2. **Approve live generation.** Run a few candidate questions live under da-v4 (about $0.12 each at the billed rate) and re-verify the results. A fresh run at temperature 0.2 may still fail the same way.
3. **Keep the seed as-is,** and say in the demo that its briefs carry known, documented errors (evaluation.md §8, §11).

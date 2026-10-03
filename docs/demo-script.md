# DiligenceIQ — Demo Script

The interview is a client meeting (SPEC §44). The panel plays a private-equity deal team; Mike is the forward deployed engineer showing what was built for them. This script is the SPEC §44.1 flow as something to run: what to click (the exact UI labels, checked against the web source and production on 2026-10-03), what to say, and how long to spend.

Rules for the whole meeting:
- **The panel's live, unknown question is the centre** (steps 11–14 get the most time). The offline plane and the engineering story get about one minute; business value and future state get their own segment (SPEC §44.1).
- **Never claim what is not built.** Thesis, Watchlist, IC Brief, the filing explorer, live monitoring and notifications are not built (Phase 8b and later). The signal button labelled **Track** saves a finding; it is not a watchlist.
- **Every number said aloud comes from a committed record.** Each number below names its source in parentheses. If a panelist asks for a number that is not here, say it was not measured rather than estimate it.
- **Language:** "investment intelligence", "diligence", "evidence". Never "chatbot", "AI assistant", a rating, a score or a recommendation (SPEC §3.2, §32.6).

Total: about 27 minutes of flow, plus questions.

---

## 1. Before the meeting

### The day before
- [ ] **Deploy state.** The reseeded workspace (`seed/demo-workspace.json`, da-v4), the "Period not cited" check and badges, and the third alarm (`AnalysisFailedAlarm`) are in the working tree, not in production, until Mike deploys them (`pnpm deploy:infra`, then `pnpm deploy:web`; architecture §12, evaluation.md §12). Until then production serves the seed committed in Phase 6 (also da-v4, but stored before the check existed, so it shows no period badges, and its findings are the earlier four, including the misdated DMA finding and a "Reporting period" row), and step 13's period moment cannot be shown live. After the deploy, a workspace created earlier keeps its old seed: use **Reset workspace** or a fresh browser profile.
- [ ] **Kill switch on.** It has been `true` since 2026-10-03 by Mike's choice, through the panel, then off (STATE.md). Confirm it reads `true`:
  ```bash
  aws ssm get-parameter --region us-east-1 --name /diligenceiq/analyses-enabled --query Parameter.Value --output text
  ```
  If it is not `true`, Mike sets it (`aws ssm put-parameter --region us-east-1 --name /diligenceiq/analyses-enabled --value true --overwrite`). The api caches it for about 60 s (architecture §11).
- [ ] **Profile set.** `/diligenceiq/active-profile-set` reads `iv-9cf51c066743/llm-v3`. The instant fallback is `iv-9cf51c066743/det-v2` (STATE.md).
- [ ] **Production smoke.** `pnpm e2e:prod`: read-only, at most one workspace per run, 19 tests including all 53 profiles (docs/handoffs/phase-08.md). It must be 19/19.
- [ ] **Alarms and their emails.** All three alarms (`GenerationCallsOverOne`, `DlqHandlerInvokedAlarm`, `AnalysisFailedAlarm`) notify the SNS topic `diligenceiq-alerts`, which has one email subscription (architecture §12). Read-only checks: each alarm is `OK` with the topic as its action, and the subscription has an ARN, not `PendingConfirmation`:
  ```bash
  aws cloudwatch describe-alarms --region us-east-1 --query "MetricAlarms[?contains(AlarmName,'GenerationCallsOverOne')||contains(AlarmName,'DlqHandlerInvoked')||contains(AlarmName,'AnalysisFailed')].[AlarmName,StateValue,AlarmActions[0]]" --output table
  aws sns list-subscriptions --region us-east-1 --query "Subscriptions[?contains(TopicArn,'diligenceiq-alerts')].[Protocol,SubscriptionArn]" --output table
  ```
  Expect three rows (two until `AnalysisFailedAlarm` is deployed). Then check the inbox for alarm emails and for "Product - DiligenceIQ - Monthly" Budget emails ($25 a month, alert only; architecture §12). No alarm email is expected.
- [ ] **Rehearse the assessment's three example questions (ask Mike first: about $0.12 each, about $0.36 in all).** Run `pdf-1`, `pdf-2` and `pdf-3` (section 3, "The assessment's three example questions") once each in production, in a workspace other than the one used on the day (the hourly cap is per workspace: 10 an hour). Each is one generation call ($0.10–0.14 at the billed rate, README; production example $0.1171, docs/handoffs/phase-08.md). A live run at temperature 0.2 is a new answer, not a replay of the recording: note what each brief shows (badges, table notice, gaps) so the talk track matches what the panel will see.
- [ ] **Offline fallback ready.** `pnpm build` on current `main`, then confirm the `web-local-profiles` launch configuration starts (section 5, "Network down").

### Thirty minutes before
- [ ] **Warm the worker (optional, ask Mike first).** One analysis costs about $0.12 (production run: $0.1171; docs/handoffs/phase-08.md). The benefit is small: a cold worker adds about 2.8 s of index load plus 365 ms of init (evaluation.md §5). Skip it unless Mike approves the spend.
- [ ] **Browser.** One clean window, bookmarks bar hidden, zoom 110–125% for a shared screen. Pick the theme that reads best on the room's display (light is the safer default; dark is axe-checked on the main pages, evaluation.md §9). The theme control is in the top bar.
- [ ] **Workspace.** Open `https://diligenceiq.mikemiller.ai/intelligence/` once so the demo workspace exists. It comes seeded with three pre-run briefs (NVIDIA revenue, the cloud comparison, the Apple regulatory question; prompt da-v4, replayed from the recorded evaluation runs) and four saved findings (labelled "Example from the demo workspace"): the Apple "Google search licensing risk" row (Needs follow-up), the Apple U.S. smartphone antitrust finding, the cloud revenue-growth row and NVIDIA's gross-margin finding. Each finding was read against its cited passages (evals/results/seed-verification-2026-10-03.md).
- [ ] **Hourly cap.** A workspace may start 10 analyses an hour and the whole demo 200 a day (examples/README.md). **Reset workspace** restores the seed but does not reset the rate counters (design-decisions DD-20 (c)). Do not rehearse live runs in the demo workspace in the last hour.
- [ ] **Tabs, in order:**
  1. `https://diligenceiq.mikemiller.ai/` (landing)
  2. The seeded NVIDIA brief: **Deep Analysis** → **Recent analyses** → "How has NVIDIA's revenue and growth outlook changed over the last two years?" (the fallback brief; section 5)
  3. `https://diligenceiq.mikemiller.ai/architecture/`
- [ ] Have `examples/sample-output.txt` open in an editor, behind the browser.

---

## 2. The flow

| # | Step | Time | Running total |
|---|---|---|---|
| 1 | Open DiligenceIQ | 0:30 | 0:30 |
| 2 | Explain the client problem | 1:30 | 2:00 |
| 3 | Select Apple | 0:30 | 2:30 |
| 4 | Show Company Intelligence | 2:00 | 4:30 |
| 5 | Show What's Changed | 0:45 | 5:15 |
| 6 | Show an Attention Signal | 0:45 | 6:00 |
| 7 | Explain "Why this matters" | 0:45 | 6:45 |
| 8 | Show Recommended Diligence | 0:45 | 7:30 |
| 9 | Click Investigate | 0:30 | 8:00 |
| 10 | Transition into Deep Analysis | 0:30 | 8:30 |
| 11 | Invite the panel's question | 1:00 | 9:30 |
| 12 | Run live RAG | 1:30 | 11:00 |
| 13 | Show the Diligence Brief | 3:00 | 14:00 |
| 14 | Open supporting evidence | 2:30 | 16:30 |
| 15 | Save a finding | 0:45 | 17:15 |
| 16 | Show Compare | 2:00 | 19:15 |
| 17 | Show Findings | 1:00 | 20:15 |
| 18 | Thesis / Watchlist vision | 1:00 | 21:15 |
| 19 | Explain the architecture | 1:00 | 22:15 |
| 20 | Business value and future state | 4:00 | 26:15 |
| | Buffer (a second panel question, or a slow run) | 2:00 | 28:15 |

Steps 11–14 together get about 8 minutes, the largest block.

### 1. Open DiligenceIQ (0:30)
**Click:** the landing tab.
**Say:** "This is DiligenceIQ, built for your deal team. It runs on public SEC filings today: 246 annual and quarterly reports from 54 companies, period ends 2022 to 2025 (landing page counts). No account is needed; you get your own workspace."

### 2. Explain the client problem (1:30)
**Show:** scroll to **The problem** section ("The answers are in the filings. Finding them takes days.").
**Say (SPEC §44.2, §3.4):**
- "General AI tools are good at answering questions when you already know what to ask. Your associates' problem starts before that: which of a company's filings matter, what changed between them, and what to look at first."
- "Each company files an annual report and three quarterly reports a year, written for regulators, not for a deal team. Change hides between filings. And an answer without its source passage can't go in front of an Investment Committee."
- "So DiligenceIQ is not a chatbot over filings. It structures the diligence process: it tells you what is happening, what changed, what deserves attention and why, suggests what to investigate, answers any question with evidence, and keeps what you learn."

### 3. Select Apple (0:30)
**Click:** **Open Company Intelligence** (hero) → the **Apple Inc** card under **Deep coverage**.
**Say:** "I haven't asked anything yet. I've picked a company."

### 4. Show Company Intelligence (2:00)
**Show:** the header (**Model-written summary**, "Deep coverage", "Latest annual report: fiscal year ended Sep 27, 2025"), then **Bottom line**, then the **30-second view** cards, then the **Performance** table.
**Say:**
- "This is the 60-second read a new associate needs. Revenue, margins and cash flow, each with its direction and the change from the prior year. Every line links to its section, and every figure comes from the filing itself, extracted by code, not written by a model."
- "Labels describe; they never judge: Growing, Stable, Declining, Persistent. No scores or ratings."
- Point at **Model-written** and **Filing text** labels: "Where a model wrote a sentence, the page says so. The figures underneath are deterministic and checked against the cited passages."
- Point at **Coverage** → **What is not known yet**: "It also says what it doesn't know. For Apple, cash and liquidity weren't extracted, and only persistent risks and trend changes are detected today."

**Avoid:** reading the **Management outlook** paragraph as guidance. It paraphrases risk-factor language (evaluation.md §6) and itself says no quantitative guidance is provided.

### 5. Show What's Changed (0:45)
**Click:** **JUMP TO** → **What's changed**.
**Show:** the **Trend change** item "Net margin improved by 2.9 pp in FY2025", with its **Measured:** line (26.9% in FY2025 against 24.0% in FY2024, threshold 1.0 pp).
**Say:** "Change detection is deterministic. The rule and the threshold are printed under the item. Two detectors ship, because they passed a precision bar on hand-labelled filings: trend changes at 1.00 precision and persistent risks at 0.90 (evaluation.md §3). The others were switched off rather than shown with lower quality."

### 6. Show an Attention Signal (0:45)
**Click:** **JUMP TO** → **Attention signals**. Use the first signal: **Margins · Trend change** "Net margin improved by 2.9 pp in FY2025".
**Say:** "A signal means 'look here', not 'good' or 'bad'; the section says that in its first line. Each signal carries its evidence for every period it compares."

**Avoid:** the Apple *regulatory* Persistent signal. Its model-written text says the risk "has grown", which a persistence match does not show (evaluation.md §6, a known gap).

### 7. Explain "Why this matters" (0:45)
**Show:** **WHY THIS MATTERS** under the same signal ("Model-written analysis").
**Say:** "This is the education layer: why a deal team would care. Net margin improved while operating margin stayed flat, so the gain sits below the operating line, and that is worth understanding before you underwrite it. It explains; it doesn't recommend."

### 8. Show Recommended Diligence (0:45)
**Click:** **JUMP TO** → **Recommended**.
**Show:** the three questions and their **Why suggested** lines.
**Say:** "Here the product tells you what to investigate next, each with the evidence that prompted it. The section says it plainly: nothing runs until you click Run analysis."

### 9. Click Investigate (0:30)
**Click:** **Investigate** on question 02 ("What specific factors caused operating cash flow to decline in FY2025…").
**Say:** "One click takes the question into Deep Analysis."

### 10. Transition into Deep Analysis (0:30)
**Show:** the **Deep Analysis** form with the **Prefilled from …** banner, the **Companies** field holding Apple, the **Question** box filled, and the note above **Run analysis**.
**Say:** "It is prefilled, not run. Every analysis costs one model call, so the analyst always decides: 'Nothing runs until you click Run analysis.' The guided path ends here, and this is also where an expert starts: the **Ask a question** button in the top bar opens this form empty from any page."

### 11. Invite the panel's question (1:00)
**Click:** clear the **Question** box and the **Companies** field (an empty Companies field lets the question decide).
**Say:** "Rather than run my question, give me yours. Any business question about these companies: one company or several, one year or a trend, a sector."
- If the panel hesitates, offer two or three from section 3 and let them choose.
- If they name a company outside the 54, run it anyway: an honest "the filings don't cover this" is a good demonstration (section 3, abstention).
- Read the question back before typing it. Leave **Sources** and **Period** at their defaults unless the question needs them.

### 12. Run live RAG (1:30)
**Click:** **Run analysis**.
**Show:** the stage list on the brief page: **Waiting to start**, **Loading filing index** (only after idle), **Interpreting the question**, **Searching SEC filings**, **Balancing evidence across companies and periods**, **Preparing source context**, **Generating diligence brief**, **Validating citations and figures**.
**Say while it runs** (expect 43–64 s from queue to brief, evaluation.md §5; production example 51 s, docs/handoffs/phase-08.md):
- "These are the real stages, not an animation. First, code reads the question: which companies, which fiscal years, which filings. No model is involved in that."
- "Retrieval is hybrid: keyword search and vector search over the pre-built index, and every company and period you asked about gets its own lane so one company can't crowd out the others."
- "Then exactly one model request writes the brief. About 98% of the wait is the model writing (evaluation.md §5). There is no second call to check or rewrite it; the checking is code."
- "Last, validation: every citation must be a passage the model was actually given, and every dollar and percentage figure is looked up in the passage it cites."

If the run is slow or fails, see section 5.

### 13. Show the Diligence Brief (3:00)
**Show, top to bottom:**
1. The header line "**N source passages · 1 model call**". "One question, one call; the count is recorded with every analysis."
2. **EXECUTIVE SUMMARY**, then **BOTTOM LINE**: each key finding with its figure badge ("All N figures found in their cited passages").
3. **KEY FINDINGS**: the citation chips (`§ AAPL FY2025 · 7` style).
4. The table section (**Trend** or **Comparison**, depending on the question).
5. **INVESTMENT CONSIDERATIONS**, then **EVIDENCE COVERAGE** (company × period matrix: passages supplied and cited), **EVIDENCE GAPS** and **SUGGESTED FOLLOW-UP QUESTIONS**.
6. **How the question was read**: companies, period and sources as interpreted.

**Say:**
- "It is structured like a diligence memo, not a chat reply."
- "Every figure is checked. If one can't be found in its cited passage it is marked unverified, in place, rather than hidden." If the live brief has an unverified badge, point at it; if not, the seeded NVIDIA brief has one: the FY2023 cell "~0%" of **Year-on-Year Revenue Growth**, marked **Unverified figure: 0%**, and its Sources rail reads "96 of 97 figures found in their cited passages; the rest are marked" (evals/results/generation-iv-9cf51c066743-da-v4.md, `pdf-2`).
- **The period check (a trust feature; after the deploy, section 1).** If the live brief has a **Period not cited** badge, point at it; if not, open the seeded Apple brief ("How have Apple's regulatory disclosures changed from 2023 through 2025…"). It carries 7 badges: key findings "U.S. Court Order on App Store Commissions Appears in FY2025" (FY2023, FY2024), "AI/ML Regulatory Risk Added…" (FY2023) and "FY2025 Adds New Tariff Risk Section…" (FY2023, FY2024), on their **Bottom line** entries too; the "U.S. App Store court order" cells for FY2023 and FY2024 and the "AI/ML regulatory risk" FY2023 cell; and one investment consideration (FY2023). The Sources rail says "7 claims about a period none of their citations is from; marked "Period not cited"" (evaluation.md §12; seed-verification-2026-10-03.md).
  - **Say:** "The model says AI wasn't in Apple's FY2023 risk factors, but it cites nothing from FY2023, so it can't know. The validator catches that: no model call, just the claim's fiscal years against the fiscal years of its own citations. It's flagged, not deleted, so the associate sees exactly which sentence to check." (In fact the FY2023 report does mention machine learning and AI, in a passage the model was not given; evaluation.md §11.)
  - **What it does not catch (say it before a panelist finds it):** a claim that contradicts a period it *does* cite. The same brief's "DMA Compliance" finding has no badge, yet it dates the DMA fines to FY2025 when the FY2024 passage it cites already has them; telling that apart needs the passage's meaning. It also misses relative dates ("prior years") and absence claims about a company rather than a year (evaluation.md §12).
  - Across the 20 evaluation briefs it flagged 9 claims in 3 briefs (evaluation.md §12; the Architecture page's "Period not cited" number).
- "It tells you what it couldn't answer: the gaps section, and the coverage matrix showing which company-year cells had evidence."
- "Follow-up questions start a new, prefilled analysis. There is no multi-turn conversation, so each answer stands on its own evidence."

### 14. Open supporting evidence (2:30)
**Click:** a citation chip on a key finding. The evidence drawer opens.
**Show:** "**Validated — supplied to the model**", **THE STATEMENT**, **CLOSEST SENTENCES TO THE STATEMENT** (bold figures are the ones the validator verified), **Show full passage**, then **Compare periods**, then **Open filing**.
**Say:**
- "This is how an associate verifies before anything goes to IC: the claim, the closest sentences in the filing, the exact location."
- "Compare periods puts the same passage from the adjacent filing side by side, which is how you see what actually changed."
- **Open filing** lands in the readable filing with the passage highlighted. "Here SEC terms like Item 7 appear, because this is the verification layer; the main screens use plain language."

### 15. Save a finding (0:45)
**Click:** back to the brief → **Save Finding** on a key finding → the **Save finding** dialog → **Save finding**. A "Finding saved" notice appears.
**Say:** "The finding keeps its own copy of the cited passages, so it reads the same in three weeks at IC. Saving is plain application logic: no model call."

### 16. Show Compare (2:00)
**Click:** **Company Intelligence** → Apple → **Compare with peers**, or go straight to `/compare/?tickers=AAPL,MSFT,NVDA`.
**Show:** **BOTTOM LINE**, **Side by side**, **Risk areas** (ranked grid), **Ask next**.
**Say:**
- "Compare answers 'how does this company look next to its peers': revenue grew at all three, NVIDIA's operating margin widened, Apple's operating cash flow fell while the others grew."
- "The note at the top matters: fiscal years end in different months, and the page says so rather than silently aligning them."
- "The risk grid is ordered by a fixed, stated rule: an order for investigation, not a rating. **Ask next** prefills multi-company Deep Analysis questions."

### 17. Show Findings (1:00)
**Click:** **Findings** in the sidebar.
**Show:** the summary strip, the new finding, **Group by** (Theme, Company, Status, Origin, **Board**), the status chips (Active, Needs follow-up, Resolved), **Note**, **Ask follow-up**.
**Say:** "This is what the team has learned, across every company and analysis, each item with its evidence. The Board view is the working list for the deal: what needs follow-up and what is resolved."

The four seeded findings were each checked by hand against their cited passages before seeding: every figure verified, no "Period not cited" badge (evals/results/seed-verification-2026-10-03.md). They are safe to read aloud. The seeded Apple *brief* is not: use it to show the badges (step 13), not as a source of facts.

### 18. Thesis / Watchlist vision (1:00)
Thesis and Watchlist are **not built** (Phase 8b did not land). Do not open the nav looking for them.
**Click:** **Architecture & value** (sidebar footer) → scroll to **Future state** ("From public filings to the whole deal.").
**Show:** the row "Thesis, watchlist, IC brief — **Next**".
**Say:**
- "The next step is designed, not built. A thesis such as 'services growth will offset slower hardware' gets findings and signals linked to it, each marked by the analyst as supporting or challenging, plus open questions. It never says whether the thesis is right."
- "A watchlist would show two kinds of events side by side: a filing event ('Apple filed a 10-Q') and an intelligence event ('Apple's latest filing changed its regulatory disclosure'). The second is the valuable one."
- "Then an IC Brief assembled from pinned findings, with no model call."

### 19. Explain the architecture (1:00)
**Show:** on the same page, **Two planes** and **Six steps. One of them talks to a model.**
**Say (SPEC §32.10, keep to about a minute):**
- "Live: every question is answered by exactly one model call, enforced in several layers and alarmed in production."
- "Offline: each company profile is computed once per index version and stored, like the embeddings; the dashboard only reads it. That's the one place a model runs without a user's question, and we ship a zero-call deterministic set beside it that one parameter switches to instantly."
- "Everything is serverless on AWS. Idle, it is storage only: no search cluster, no servers, nothing scheduled."
Go deeper only if asked (section 6).

### 20. Business value and future state (4:00)
**Show:** scroll up to **Business value** ("How this creates value for a private-equity deal team"), then back to **Measured, not claimed** and **Future state**.
**Say, business value (SPEC §44.2):**
- "An associate gets a first read on a company in seconds instead of hours, and every statement links to its passage, so it can be checked before it reaches a memo."
- "It knows how to structure diligence: what is happening, what changed, what deserves attention, why it matters, what to investigate. Then any question, answered with evidence, kept as findings."
- "Measured, not claimed: one model call per analysis across the whole evaluation set; 100% of citations point to passages the model was given; 98.9% of figures were found in their cited passage (531 of 537); and 9 claims in 3 of the 20 briefs are marked 'Period not cited' rather than passed off as fact (evaluation.md §4, §10, §12; the Architecture page)."
- "Cost follows use: about $0.10–0.14 per question (README), and about 57 cents a month when idle, most of it queue polling and three alarms (architecture §13.1)."

**Say, future state (SPEC §45; docs/future-state.md):**
- "Built now: public-company intelligence on SEC filings. Next: thesis, watchlist and IC brief."
- "Then live monitoring: a daily check for new filings that reuses the ingestion, indexing and change detection you've just seen, and alerts you only when a watched company's filing changes something you care about. Not every document event: intelligence events."
- "Then the deal room: the same evidence model on CIMs, quality-of-earnings reports, models and contracts. Then the IC workflow, then portfolio monitoring after close."
- "What it will not become: a price-target or forecasting engine. Scenario questions, such as 'which areas look most exposed if demand weakens', come from what the disclosures say, with evidence."

Close: "So: value before the first question, evidence behind every answer, and a clear path from public filings to the whole deal."

---

## 3. Questions that work well

All passed every deterministic check in the da-v4 evaluation unless noted (evals/results/generation-iv-9cf51c066743-da-v4.md). Generation took 11–72 s per question in that run.

| Kind | Question | Record |
|---|---|---|
| Single company, financial | What drove Microsoft's revenue growth in fiscal 2025? | Pass; 84/84 figures verified |
| Multi-year | What export control restrictions does NVIDIA describe, and how do they affect its sales to China? | Pass; 6/6 figures; 1 cell marked "Period not cited" (FY2023 "Not addressed"; evaluation.md §12) |
| Multi-year | What has Coca-Cola said about pricing over the last few years? | Pass; 27/27 figures; 1 cell marked "Period not cited" (FY2022 "Not mentioned"; evaluation.md §12) |
| Quarter | What did Alphabet report about advertising revenue in Q2 2025? | Pass; 46/46 figures |
| Single company, risk | What does Tesla say about risks to demand for its vehicles and to its pricing? | Pass |
| Multi-company, cross-sector | How do Walmart and JPMorgan describe the effect of inflation and interest rates on their businesses? | Pass; 17/17 figures; manual review "Complete", 14 of 18 claims fully supported (evaluation.md §8) |
| Multi-company, risk | Compare the cybersecurity risks disclosed by Visa, UnitedHealth and Boeing. | Pass |
| Sector | How do the big banks describe their capital and liquidity positions? | One unverified figure ("$422 billion"), 66/67; a good moment to show the unverified badge |
| Sector, no company named | Which companies describe tariffs as a risk to their business? | One unverified figure in a title ("$600M"), 12/13 |
| Ambiguous cohort | How are the big tech companies spending on AI? | Pass (robustness set, evaluation.md §7); the brief names which companies disclose no AI figure |
| Abstention, company | What is Ford's strategy for electric vehicles? | Pass: answered as insufficient evidence (Ford is not in the corpus) |
| Abstention, market data | What is Apple's current stock price and the consensus analyst price target? | Pass: insufficient evidence; the gaps say neither is in SEC filings (evaluation.md §7) |
| Expert (SPEC §51.3) | How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe? | Passes the checks; 7 claims marked "Period not cited", and the DMA dating error the check cannot see (step 13; section 4). It is also a seeded brief |

**Steer away from** (honestly, if asked why: "these are the measured weak spots"). The pharma question is one of the assessment's own examples: do not steer away from it; frame it (below).
- Compare the cloud businesses of Microsoft, Amazon and Alphabet: retrieval found 1–2 of 8 hand-picked answering passages, and the brief lacked AWS financials (evaluation.md §1, §8).
- How has Pfizer's revenue changed since 2022?: an unverified "39%" and an unlabelled mix of recast and originally reported figures (evaluation.md §4, §8).

### The assessment's three example questions

The panel may type these word for word. All three are in the evaluation set (`pdf-1`, `pdf-2`, `pdf-3`) and were rehearsed the day before (section 1). The records below are the recorded da-v4 runs (evals/results/generation-iv-9cf51c066743-da-v4.md); a live run is a new answer at temperature 0.2 and can differ.

**Example 1: "What are the primary risk factors facing Apple, Tesla, and JPMorgan, and how do they compare?"** (`pdf-1`)
- Record: 60/60 citations valid; no currency or percentage figures; 56 s of generation; the one da-v4 miss is the table. The manual review graded it Complete, 10 of 19 claims fully supported and 9 partly (evaluation.md §8).
- **How it will look if the table comes back ragged, as in the recording:** the model wrote 4 column headers ("Risk Dimension", Apple, Tesla, JPMorgan) over 9 rows; 8 rows have 3 values and "Key-Person / Governance" has 2 (evaluation.md §4). The page uses the first header as the row-label column, so 8 rows read correctly under the three companies; the short row has only Apple and Tesla cells, and its **Sources** list sits one column left, under JPMorgan. The Sources rail lists the notice "9 comparison rows do not line up with the table's columns." The rows are kept as written, not silently fixed.
- **Say:** "The table is model-written, so code checks its shape. This row came back one value short; the validator flags it rather than guessing which company it belongs to, because guessing would put words in the filing's mouth." Then read the key findings, which carry the substance.

**Example 2: "How has NVIDIA's revenue and growth outlook changed over the last two years?"** (`pdf-2`, also a seeded brief)
- Record: 96/97 figures verified, 58/58 citations; the unverified one is the "~0%" FY2023 growth cell (step 13). The manual review graded it "Minor omission", 12 of 16 claims fully supported (evaluation.md §8).
- **Say:** "Every figure is looked up in the passage it cites; the one the filing doesn't print is marked, in place." Mention the Net Income row's "55.8% of revenue" in a dollar column if the table is open (section 4).

**Example 3: "What regulatory risks do the major pharmaceutical companies face, and how are they addressing them?"** (`pdf-3`) — Mike chose honest framing over tuning.
- Record: passes every deterministic check (63/63 citations). But retrieval found 7 of the 18 hand-picked answering passages across the five companies (gold recall, hybrid; evaluation.md §1), and hybrid retrieval found no AbbVie passage naming the IRA, Medicare or the FDA. The manual review graded it "Major omission": it barely answers "how are they addressing them", with 6 of 15 claims fully supported and 9 partly (evaluation.md §8).
- **Say:** "This is our measured weak spot, and I'd rather show it than hide it. Each of the five companies gets its own retrieval lane, so none is dropped, but a lane's few passages aren't always the ones that describe mitigation. Check the evidence coverage matrix and the gaps section: the brief tells you where it is thin. The fix is retrieval depth, a reranker or more passages per lane, measured against these same gold passages; we didn't tune this one question, because tuning to the test set would make the number meaningless."
- Do not read its "all five companies" generalisations aloud as fact (seed-verification-2026-10-03.md, earlier record: `pdf-3`).

**Production rehearsal, 2026-10-03 (da-v4, typed verbatim with no company filter, Mike approved; `examples/analysis-request.sh`).** All three reached COMPLETE with 1 call each and every citation valid:

| Question | Analysis | Time | Est. cost | Citations | Flags |
|---|---|---|---|---|---|
| Example 1 | `0musx03h1TLGDolI_hq` | 53 s | $0.1264 | 59/59 | none: the table lined up this time; scope AAPL, TSLA, JPM |
| Example 2 | `0musx19r1nya9FEfodC` | 45 s | $0.1511 | 61/61 | 7 of 102 figures unverified |
| Example 3 | `0musx28sx6Zd33o3PYK` | 60 s | $0.1358 | 62/62 | none; scope JNJ, PFE, MRK, LLY, ABBV, IRA named |

- **Example 2 repeats a model error:** key finding 1 says Compute & Networking grew "from $15,068 million in FY2024". That is the FY2023 figure (FY2024 was $47,405M, `NVDA-FY2025-10K-MDA-008`), so its "up 145%" is wrong too. The brief marks "$15,068 million" **Unverified figure** in place. If the panel asks this question, point at that mark before they find it: "the validator couldn't find that number in the passage it cites, so it says so; here's the filing." The same error appeared under da-v5 (evaluation.md §11), so expect it.
- Each run took 45–60 s; plan the talk for step 12 around a minute.

---

## 4. Known weak spots, and how to answer

Say these plainly if a panelist finds them. Naming a measured limit is stronger than defending it.

| Weak spot | What happens | Answer |
|---|---|---|
| **Period and absence claims** | The Apple regulatory brief says AI, tariffs and the App Store court order were absent from FY2023 and FY2024, citing nothing from those years, and dates the DMA fines to FY2025 though the FY2024 report it cites already has them (evaluation.md §8). A prompt rule (da-v5) was tried and reverted: it did not remove the absence claims (evaluation.md §11). The deterministic period check now marks 7 of the brief's claims "Period not cited" (9 in 3 of 20 briefs); it cannot see the DMA misdating, which contradicts a period it does cite (evaluation.md §12). `examples/sample-output.txt` (da-v4, recorded after the check went live) shows 2 of these marks (examples/README.md). | "Our own review found it. We tried fixing it in the prompt; it didn't hold, so we moved it to code: a claim about a year must cite that year, or it's flagged. What code can't judge is meaning: a claim that contradicts a passage it cites. That still needs the associate, and the drawer puts the passage one click away." |
| **Multi-company retrieval depth** | Cloud and pharma questions are where retrieval is weakest: gold recall 1–2 of 8 (cloud) and 5–7 of 18 (pharma; 7 of 18 for hybrid) (evaluation.md §1). | "Every company gets its own lane, so none is dropped, but a lane's few passages may not be the answering ones. Reranking is the measured next lever; it is off because each rerank is another model call and the single-call rule had to be confirmed first (assumptions A1, F1)." |
| **Groundedness is not 100%** | Manual review of 8 hard briefs: 62.5% of claims fully supported, 96.3% supported or partly, 1 unsupported (evaluation.md §8). "Partly" is mostly generalisation. | "That's why every claim opens its passage. The machine checks guarantee citations are real and figures are printed in the cited text; meaning still needs the associate's eye, and the drawer makes that fast. The review was done by a model agent, not a human; a human pass is the next step." |
| **A verified figure is not a verified meaning** | The validator confirms the digits and unit are printed in a cited passage, not that the sentence uses them correctly (evaluation.md §4, Limits). | Say exactly that. |
| **Comparison table alignment** | `pdf-1`'s recorded table has 4 headers over 9 rows, one row a value short; it is flagged with a notice (evaluation.md §4; section 3). The NVIDIA example's Net Income row shows "55.8% of revenue" in a dollar column. | "The table is model-written; mismatched rows are detected and flagged, not silently fixed." |
| **Signals are narrow** | Only persistent risks and trend changes ship; new, removed and expanded risks and outlook changes are suppressed (DD-18), and the page says so under **What is not known yet**. PERSISTENT finds about a third of all persistent headings (0.36 recall over all labelled headings, evaluation.md §3). | "We switched off detectors that missed the precision bar rather than show noisy signals." |
| **Model-written profile text overreaches in places** | E.g. Apple's regulatory persistent signal says the risk "has grown" (evaluation.md §6). 11 of 53 companies fell back to the deterministic profile; 3 of 12 deep-coverage companies (evaluation.md §6). | "Model-written text is labelled, its figures are checked, and anything that fails falls back to templates. Semantic rules like 'persisting is not growing' aren't machine-checked yet." |
| **Thin history for most companies** | 37 of 54 companies have a single filing (docs/handoffs/phase-02.md), so they get current risks and in-filing trends, not year-over-year risk changes. | Point at the coverage tier label on the company card. |
| **Latency** | 43–64 s per brief, almost all of it the model writing (evaluation.md §5). | "It's an analyst task, not a search box. Shorter briefs are the lever: each 1K output tokens is about 11–14 s (evaluation.md §5)." |
| **Heavy first-load JavaScript** | About 390 KB gzipped on workspace pages (evaluation.md §9). | "Paint is under 0.8 s on a 4× slower CPU; the bundle is schema code and is the next performance fix." |
| **GE Capital** | Its only filing is FY2014, outside the review window: no profile, and its page says so with **Open the filing** (production, 2026-10-03). | "It's labelled, not hidden." |
| **Per-visitor cap is per proxy** | Through Amplify, the workspace-creation cap keys on the proxy address, so visitors share about 100 creations a day per proxy (STATE.md, assumptions D12). | Only if asked about abuse controls. |

---

## 5. Fallbacks for live failures

| What you see | What it means | Do this |
|---|---|---|
| The run is still going at 60 s | Normal range is 43–64 s (evaluation.md §5) | Keep talking through the stages (step 12). The job deadline is 240 s (architecture §8). |
| "**The analysis took too long**" (`GENERATION_TIMEOUT`), "**The brief could not be generated**", "**The answer couldn't be validated**" | The one call timed out or failed. A failed analysis still counts its one call; no partial brief is saved. | "This is the failure path working: no retry behind your back, because a retry would be a second call." Then open the seeded NVIDIA brief (tab 2) and run the flow on it. Offer **Run analysis** again once: a re-run is a new analysis with its own single call. |
| "**New analyses are paused**" (`ANALYSES_DISABLED`) | The kill switch is off | "That's the spend kill switch." Mike sets it to `true` (section 1); wait about 60 s. Meanwhile use the seeded briefs. |
| `RATE_LIMITED` | A spend cap: 10 analyses per workspace per hour or 200 a day (examples/README.md), or the workspace-creation cap | "The demo is public, so every call is capped." Use the seeded briefs; **Reset workspace** does not clear the counters. |
| "**The filings don't cover this**" (`NO_RELEVANT_EVIDENCE`) or an insufficient-evidence brief | The question is outside the corpus | Present it as abstention working, then take another question. |
| "Intelligence for … isn't built for this index version" | A company without a profile | Click **Ask about …** and answer through Deep Analysis. |
| Company Intelligence shows the deterministic profile for every company | The profile pointer was switched to `det-v2` | Expected behaviour of the fallback; the labels say "deterministic". |
| A page will not load, or the room network is down | Network | Start the **`web-local-profiles`** launch configuration (`.claude/launch.json`, port 4176): the real api app in-process over in-memory stores, the real llm-v3 profiles from `.index/intelligence`, and the seed. Requires a current `pnpm build` and the local corpus. Use it rather than `web-local`, which serves the placeholder fixture profiles. **Its Run is a test stub:** it never calls a model and returns the recorded seed brief for the same companies (or fails with `NO_RELEVANT_EVIDENCE`). Say so out loud; never present it as a live run. |
| Nothing works | | Walk through `examples/sample-output.txt`: a real production run of the Apple question (analysis `0muswoje69MPT2ATVia`, prompt da-v4, 1 call, $0.1299, 53 of 53 citation references valid, 0 unverified figures; examples/README.md). Point out its two "Period not cited" marks: the check working on a live answer. |

---

## 6. Likely panel questions

**"How do you guarantee exactly one model call?"**
Defence in depth (architecture §5). The guarantee rests on a conditional claim: the worker moves an analysis from QUEUED to RUNNING with a claim token, only before its deadline, so a duplicate or redelivered queue message finds nothing to claim and is acknowledged without work. On top: the Bedrock client has SDK retries off (`maxAttempts: 1`); a per-analysis gateway throws on a second call; the call count is persisted before the call; there are no rewrite, plan or critique calls; tests assert exactly one call on success, error, malformed output, duplicate delivery and redelivery. In production a metric filter alarms on any analysis with more than one call and emails the alert topic (architecture §12). Result: 1 call for each of the 26 evaluation questions (evaluation.md §10).

**"Isn't the query embedding a second call?"**
It is retrieval, not generation; the assessment allows the retrieval pipeline. It is counted separately, one per analysis. Rerank is off because its status is the same question (assumptions A1).

**"Why no vector database or OpenSearch?"**
The corpus is about 25K chunks (25,404; docs/handoffs/phase-02.md). The index is a 236 MB file in S3 that the worker loads in 2.8 s after idle (evaluation.md §5), then searches exactly (brute-force cosine plus BM25, fused). That gives exact search with no recall loss, full control over per-company and per-year lanes, and no always-on cluster billing around the clock (DD-01). It sits behind a `SearchBackend` interface, so a managed service replaces it when the corpus outgrows memory (around 100K+ chunks or continuous ingestion; architecture §13.5) without touching the rest.

**"What does an analysis cost? What does it cost idle?"**
- Per analysis: about $0.10–0.14 at the billed rate, estimated from tokens (README; examples/README.md); about 22K tokens in and 3K out (evaluation.md §10). Production examples: $0.090, $0.125 and $0.1171 recorded at the list price (about $0.099, $0.138 and $0.129 billed; architecture §13.2), and $0.1316 under the billed table (examples/README.md). The Architecture page's $0.12–0.13 is the Phase 4 deployed runs at the list price.
- Idle: storage only, no compute. About $0.57 a month (architecture §13.1; `evals/results/idle-cost-2026-10-03.json`): SQS long polling by the two event source mappings (about $0.26–0.37) and three alarms at $0.10 each; storage is under a cent. It is an estimate from list prices and inventory, not a billed quiet day.
- One-time: embedding the corpus, 22.1M tokens ≈ $0.44 (docs/handoffs/phase-02.md); the profile build, about $6.0 for 59 calls (evaluation.md §6).
- Bounds: kill switch, 200 analyses a day globally (about $25 a day at most, STATE.md), 10 per workspace per hour, workspace-creation caps, and a $25 monthly Budget alert (architecture §11, §12).

**"How do you validate citations?"**
Each passage in the context has a citation ID. After the one call, code checks every cited ID against the passages actually supplied and removes any other; the brief shows "All N cited passages were among the passages supplied to the model". In the evaluation the model never cited outside its context (1.00 before and after validation; evaluation.md §4). Retrieved filing text is wrapped as untrusted data, and filing text cannot close or fake that block (evaluation.md §1).

**"How do you know the numbers are right?"**
Two layers. Company Intelligence numbers are extracted by code from the filing tables, never by a model (DD-17). In briefs, every currency and percentage figure is looked up in the passage its own item cites, with unit rules; 98.9% verified (531/537), and the rest are marked unverified in place (evaluation.md §4). Limit: a match means the figure is printed there, not that the sentence interprets it correctly.

**"You said opening a page never calls a model, but the dashboards have model-written text."**
That is the one named exception (SPEC §35.7, DD-16): an offline, admin-run build makes at most one call per company per index and prompt version, enforced by an append-only ledger, never on page view, never scheduled, never deployed. Pages only read the stored result. A zero-call deterministic set is always built beside it, and one parameter switches to it instantly. Whether build-time generation fits the assessment's single-call rule is our interpretation (assumptions A6), so it is withdrawable by design. The api Lambda has no Bedrock permission at all.

**"What about prompt injection?"**
Filings are labelled untrusted, and the output is schema-constrained with citations checked. Tested with three typed and three planted injections: 5 of 6 pass every check; the sixth did not follow or cite the planted passage but quoted it in order to reject it (evaluation.md §7).

**"Security?"**
Anonymous HMAC-signed workspace cookies; least-privilege IAM per Lambda with no wildcard actions; Bedrock reachable only from the worker; input limits on every route; security headers; and a per-page Content-Security-Policy where scripts run only by hash, no `unsafe-inline` or `unsafe-eval` for scripts (architecture §11). Prompts and filing text are never logged in production.

**"How was it evaluated?"**
20 questions covering every category, including the assessment's three examples and the expert question word for word, plus 6 robustness questions. Deterministic checks, no model judging a model: retrieval 19/20 (evaluation.md §1), 14/20 briefs pass every check, each miss failing one check (evaluation.md §4), 9 period claims flagged in 3 briefs (evaluation.md §12), plus a manual review of 8 hard briefs by a model agent (evaluation.md §8). 1,407 unit tests and 112 end-to-end tests in the gate (docs/handoffs/phase-09.md).

**"Why not just use ChatGPT or Claude with the filings?"**
They answer questions when you know what to ask. This gives value before the question, checks every citation and figure in code, keeps findings with their evidence, compares companies on fixed rules, and costs one call per question with the spend bounded (SPEC §3.4).

**"What would you build next?"**
1. Retrieval depth on multi-company questions, measured against the gold passages (rerank, once the single-call question is settled; the pharma example, section 3).
2. A human review pass over the same sample as the model-agent review (evaluation.md §8).
3. Thesis, Watchlist and the IC Brief (designed; docs/future-state.md).
4. Then live monitoring, which reuses this pipeline (docs/future-state.md).

**"Which prompt is this? Did you iterate?"** (one line, only if asked)
da-v4, the fourth version, every change logged with its measured result (docs/prompt-iterations.md). A fifth, da-v5, targeted the period claims; it was tried on the full evaluation set and reverted because it did not remove them and grounding dipped (evaluation.md §11), so the fix went into the validator instead (evaluation.md §12).

**"The assessment says about four hours. Is this four hours of work?"** (Timebox; say it straight, don't overclaim)
- "No, and I won't pretend it is. The assessment's core is about four hours of work (SPEC §1.3): an index over the filings, retrieval, a prompt that injects the retrieved passages, exactly one model call, and a front-end to ask and read the answer. That core is here and is what the evaluation measures: Deep Analysis, the index and retrieval, the prompt and the one-call guarantee."
- "Everything around it I added because the brief was a client meeting with a private-equity team, and I wanted to show what a client-ready version looks like: Company Intelligence so there's value before the first question, evidence you can verify in one click, saved findings, Compare, deterministic checks on citations, figures and periods, and production basics: spend caps, a kill switch, alarms, security headers."
- "I scoped it in a fixed order so the core never waited on the extras (SPEC §49, scope fallback): core RAG quality first; the profile layer could fall back to deterministic only; weak signal detectors were switched off; the P1 features, thesis, watchlist and IC brief, were cut rather than weaken the core. They are not built."
- If asked how long it took: say it was well beyond the timebox, and that the time went into the client-facing layer and the evaluation, not the core loop. Do not give an hour count: none was recorded.

**"Would this scale to our whole coverage universe and our deal documents?"**
The pilot tier fits about 100K chunks and a handful of concurrent analysts. Beyond that, a managed search backend behind the same interface, incremental ingestion and SSO; for deal-room data, per-deal isolation, KMS keys and private networking (architecture §13.5; docs/future-state.md).

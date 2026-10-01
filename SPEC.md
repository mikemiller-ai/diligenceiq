# DiligenceIQ — Specification v2

> **SPEC v2, consolidated 2026-10-01.** This is the sole canonical implementation specification for DiligenceIQ. It merges three earlier documents, now archived verbatim for provenance only:
> - [`docs/archive/SPEC-v1.md`](docs/archive/SPEC-v1.md): the original build specification (SPEC v1);
> - [`docs/archive/SPEC-ADDENDUM-COST.md`](docs/archive/SPEC-ADDENDUM-COST.md): the cost-control addendum;
> - [`docs/archive/PRODUCT_DIRECTION.md`](docs/archive/PRODUCT_DIRECTION.md): the investment-intelligence product direction.
>
> It states the versions refined in the Phase 0b re-baseline ([implementation plan](docs/implementation-plan.md) Revision 2; [design decisions](docs/design-decisions.md) DD-15 to DD-19). Appendix A lists every deliberate change from v1 and its reason. Appendix B maps old sections to new ones.

## Contents

- **Foundation:** 1 Mission and precedence · 2 Non-negotiable requirements · 3 Product thesis and positioning · 4 Primary users · 5 Journey and information architecture · 6 Priorities: P0, P1, P2
- **Features:** 7 Landing (P0) · 8 Company Intelligence (P0) · 9 Performance Intelligence (P0) · 10 What's Changed (P0) · 11 Attention Signals and Why This Matters (P0) · 12 Recommended Diligence (P0) · 13 Compare (P0) · 14 Deep Analysis (P0) · 15 Diligence Brief (P0) · 16 Evidence and citations (P0) · 17 Findings: Save Finding and Findings Board (P0) · 18 Architecture and business-value page (P0) · 19 Diligence Gaps (P1) · 20 Thesis (P1) · 21 Watchlist, filing events and intelligence events (P1) · 22 IC Brief (P1) · 23 Filing explorer and Analysis Audit Trail (P1)
- **RAG and intelligence engine:** 24 RAG ingestion · 25 Chunking and citation IDs · 26 Deterministic query analysis · 27 Retrieval · 28 Context builder · 29 Prompt requirements · 30 Single-call enforcement · 31 Output validation · 32 Offline Company Intelligence build · 33 Data model and API
- **Platform, cost and quality:** 34 AWS architecture · 35 Cost control and scale-to-near-zero · 36 Implementation stack · 37 Enterprise UX and style · 38 Loading states and error handling · 39 Security and production considerations · 40 Demo workspace · 41 Evaluation · 42 Prompt iteration log · 43 Required repository documentation
- **Delivery and process:** 44 Demo flow and business story · 45 Future state · 46 Development philosophy · 47 Sub-agent strategy · 48 Mandatory phase quality gate · 49 Development phases · 50 Final adversary review · 51 Definition of done · 52 Scope discipline · 53 Product principle
- **Appendices:** A. Changes from v1 · B. Section map

---

# 1. Mission and precedence

## 1.1 Mission

Build a polished, production-oriented enterprise SaaS application named **DiligenceIQ** for Mike's final-round Forward Deployed Engineer interview with Eliza.

The application is deployed live on AWS at:

`https://diligenceiq.mikemiller.ai`

The fictitious customer is a **private equity investment firm**.

The product must demonstrate two things equally well:
1. **Technical depth:** high-quality retrieval-augmented generation over SEC filings.
2. **Business and product thinking:** turn that RAG capability into an investment-intelligence product that an investment team could plausibly buy and use.

Do **not** build a chatbot.

DiligenceIQ is **investment intelligence**. It tells an investor what is happening with a company, what changed, what deserves attention, why it matters, and what to investigate next, **before** they have to ask a question. RAG is the intelligence engine inside that product. Its user-facing form is **Deep Analysis**: the investigative drill-down that answers any business question with evidence.

The product journey is:

> **Understand → Notice → Investigate → Verify → Capture → Monitor → Decide**

(SPEC v1's Research → Verify → Capture → Organize → Decide is contained in it.)

The application should feel like an enterprise SaaS product that could be shown to an actual private-equity client, not an interview prototype.

## 1.2 Precedence

1. **The assessment PDF is the outer constraint.** `UPDATED_FDE-AI-RAG-Assessment.pdf` (Eliza's document, gitignored) bounds everything below. Nothing in this specification or in any design document may violate it. Where the PDF is unclear, ask Eliza; the PDF itself says "If anything is unclear, ask."
2. **This specification (SPEC v2) is the sole canonical implementation specification.** The archived documents are provenance, not requirement sources. Where archived text differs from this specification, this specification wins.
3. **Design documents elaborate this specification but cannot override it.** `docs/architecture.md`, `docs/assumptions.md`, `docs/design-decisions.md`, `docs/design-tokens.md`, `docs/testing-strategy.md` and `docs/implementation-plan.md` choose mechanisms, schemas, thresholds and sequencing. If a design document conflicts with this specification, this specification wins and the design document is corrected. A change of requirement is made here first, then reflected in the design documents.
4. **Inside this specification, the stricter rule wins** on assessment constraints, one-call generation, evidence grounding, retrieval quality, AWS deployment, security, testing, and cost control.
5. **One named cost exception exists:** the offline Company Intelligence profile build (§35.7, DD-16). It is bounded, dated, and withdrawable at runtime. No other exception to the cost rules exists.

## 1.3 What the assessment asks for

From the PDF, summarized (the three example questions are verbatim):
- Build a presentation that displays technical capabilities while defending business value for a fictitious private-equity firm.
- The presentation is a **working demo** that answers a business question about SEC financial filings using a **single LLM API call** with retrieval-augmented generation, and also includes **information on how this creates value for the business**.
- Timebox: about 4 hours of core work.
- Build a retrieval index over the provided corpus and a prompt template that injects retrieved context into a single LLM call.
- The system accepts a natural-language business question as input and returns a well-structured answer grounded in the filing data.
- The final answer is produced in **one API request**. Indexing and retrieval can run beforehand; the answer itself must come from a single LLM call.
- Document assumptions and decisions.
- Corpus: SEC EDGAR 10-K and 10-Q filings from major US public companies spanning 2023–2025, delivered as `.txt` filings plus a `manifest.json`.
- During the demo the panel enters a business question **into the system's input field**. Examples:
  - "What are the primary risk factors facing Apple, Tesla, and JPMorgan, and how do they compare?"
  - "How has NVIDIA's revenue and growth outlook changed over the last two years?"
  - "What regulatory risks do the major pharmaceutical companies face, and how are they addressing them?"
- Demo format: set up the environment, talk the panel through it as if it were a real client meeting, run a question through the system, and show a front-end. Be prepared to walk through design decisions, defend the value creation, and explain future state and capabilities if the client is sold on the RAG solution.

**Deliverables** and where this specification covers them:

| PDF deliverable | SPEC v2 |
|---|---|
| A README with setup and run instructions | §43.2 |
| Your indexing and retrieval code | §24–28, §43.1 |
| A log of your prompt iterations (what changed, why) | §42 |
| Your final prompt template | §29, §42 |
| A front-end | §5, §7–23, §37 |
| An example request ready to execute | §43.3 |
| Notes on how you evaluated quality | §41 |
| Working demo answering a question with one LLM call | §14, §30, §44 |
| Information on how this creates value for the business | §3, §18, §44 |
| Future state and capabilities | §18, §45 |
| Documented assumptions and decisions | §43.1 (`docs/assumptions.md`, `docs/design-decisions.md`) |

---

# 2. Non-negotiable requirements

These requirements override all other implementation preferences.

## 2.1 Assessment requirements

The supplied corpus contains SEC 10-K and 10-Q filings covering 2023–2025.

The system MUST:
- accept an arbitrary natural-language business question **typed into an input field** (Deep Analysis, or the global "Ask a question" action);
- retrieve relevant evidence from the supplied SEC filings;
- inject the retrieved evidence into the final prompt;
- generate the final answer using **exactly one generative LLM API request per analysis**;
- return an answer grounded in the retrieved filing data;
- support questions that were not known during development;
- support single-company, multi-company, longitudinal, and sector-level questions;
- document architectural assumptions and design decisions.

The final generative answer must be one LLM request. Do not introduce runtime agent loops, LLM query rewriting, LLM planning, multiple answer-generation calls, LLM critics, LLM repair calls, separate LLM summarizers, or a runtime LLM-as-judge.

Embedding generation for retrieval is part of retrieval, not answer generation. This distinction is documented and query embeddings are counted separately. A non-generative rerank call would be treated the same way, but rerank is **off by default** and is enabled only if evaluations show a clear lift, and then disclosed and confirmed with Eliza (assumptions A1, F1).

The panel may enter questions such as:
- comparing primary risk factors across several companies;
- evaluating how a company's revenue or growth outlook changed over multiple years;
- comparing regulatory risks across companies in an industry.

Therefore, **nothing about the answer workflow may depend upon a hardcoded demo question.**

## 2.2 Engineering non-negotiables

- **No hardcoded demo answers.** Every answer flows through retrieval and generation.
  - Seeded analyses and findings are real pipeline outputs, labeled with their provenance.
  - Company Intelligence numbers come only from deterministic extraction (§9, §32). All statistics derive from actual application data or real pipeline outputs. Do not display invented financial metrics.
  - Phase 1 fixture profiles carry no figures and no narrative presented as fact: every slot is a labeled placeholder, or a value copied verbatim from a filing row with its `chunkId` and `rawRow`. A test enforces this.
  - **One allowed, labeled exception:** the curated per-category "why this matters" library used by deterministic profiles (§32.7). It is generic, names no company, states no figure, claims nothing about what happened, and is shown as "General context".
- **Citations may only reference chunks supplied to the model.** They are validated server-side. The model must not be able to cite documents it was not given.
- **A prefilled Deep Analysis never auto-submits.** Loading `/analysis/new?q=&tickers=&origin=` only fills the form. Generation requires an explicit Run click, which issues `POST /api/analyses`. A URL alone can never trigger a generation call; an end-to-end test proves it.
- **Opening or rendering any page never calls an LLM.** Company Intelligence, Compare, saving findings, Findings, Thesis, Watchlist, IC Brief assembly and every dashboard are deterministic reads and writes. The api Lambda has no Bedrock permission.
- **The single-call guarantee is enforced in depth** (§30): conditional claim, `maxAttempts: 1`, `GenerationGateway`, persisted call counter, and tests at every layer.
- **Numbers come from deterministic extraction**, never from the model. Figures in model-written text must match an extracted fact or a cited passage, or they are flagged.
- **No ratings, scores, verdicts or recommendation language.** Signals are descriptive. One canonical phrase-level banned list applies to model-written text (§32.6).
- **Retrieved documents are untrusted source content, not instructions.**
- **Scale to near zero when idle** (§35): no OpenSearch, NAT, EC2, ECS, RDS, WAF, provisioned or reserved concurrency, or scheduled jobs; explicit log retention; never log chunk text or full prompts unless `DEBUG_LOG_PROMPTS=true`.
- **Spend controls:** kill switch, global daily cap, per-workspace and workspace-creation caps. The AWS Budget is alert-only.
- **Every phase passes the full quality gate** (§48). No step is skipped.

---

# 3. Product thesis and positioning

## 3.1 Product thesis

DiligenceIQ must NOT assume that the user: understands SEC filings; knows what a 10-K or 10-Q is; knows where to look; knows what questions to ask; knows which changes matter; knows how to interpret financial or risk disclosures.

A question-first product places too much burden on the user to formulate a good question before receiving value. DiligenceIQ provides useful intelligence **before** the user asks a question.

The product answers:
1. What is happening with this company?
2. What changed?
3. What deserves my attention?
4. Why does it matter?
5. What should I investigate next?
6. How does this company compare with others?
7. What evidence supports these conclusions?
8. Has new information strengthened or challenged my investment thesis?

Deep Analysis (RAG) remains essential and is the assessment's core. It is the investigative drill-down layer, not the homepage.

## 3.2 Positioning

| | |
|---|---|
| Product | **DiligenceIQ** |
| Category | **Investment Intelligence** |
| Primary message | > Know what changed. Know what matters. Know what to investigate next. |
| Supporting promise | > Turn SEC filings into evidence-backed investment decisions. |

**Product description.** DiligenceIQ transforms complex company disclosures into understandable performance trends, risk changes, management signals, and evidence-backed areas of attention. It helps investors understand a company without requiring them to already know how to analyze SEC filings. When they need to investigate further, DiligenceIQ provides evidence-backed Deep Analysis over the underlying filings.

Do not position the application as: an SEC chatbot; ChatGPT for financial filings; an AI assistant; a generic document search tool; "we summarize SEC filings."

The product is a **workflow application for investment intelligence and diligence**.

## 3.3 Primary product principle

A user should receive meaningful value within seconds of selecting a company. A blank question box must NOT be the primary experience.

The product first tells the user *"Here is what you should know,"* then *"Here is what changed,"* then *"Here is what deserves closer investigation."* Only then should the user need to ask a question. Expert users can still bypass the guidance and ask any question immediately (§5.4).

## 3.4 Differentiation

General-purpose AI tools (ChatGPT, Claude, Copilot and others) can summarize documents. DiligenceIQ's differentiation is:

> It knows how to structure the diligence process.

It creates value by combining: automatic company intelligence; change detection; attention signals; plain-language explanations; recommended investigation paths; company comparison; evidence verification; persistent findings; thesis tracking (P1); monitoring (P1 historical events; live monitoring is future state).

The RAG engine is essential infrastructure inside that product. It is not the entire product.

---

# 4. Primary users

The primary persona is a private-equity: Associate; Senior Associate; Vice President; Principal.

They are researching potential investments and need to: understand companies quickly; compare businesses; find material risks; identify changes over time; verify conclusions against source material; capture important discoveries; organize diligence; communicate important findings to the Investment Committee.

Design for both:
- sophisticated investment professionals;
- users who understand businesses but are not experts in SEC filings.

Design for a sophisticated business audience. Do not make the interface whimsical or consumer-oriented.

---

# 5. Journey and information architecture

## 5.1 Journey to surfaces

| Journey step | Surface |
|---|---|
| Understand | Company Intelligence: 30-second view, performance, drivers, current risks (§8–9) |
| Notice | What's Changed, Attention Signals, Why This Matters (§10–11) |
| Investigate | Recommended Diligence, Compare, Deep Analysis (§12–14) |
| Verify | Evidence drawer, adjacent periods, readable source view (§16) |
| Capture | Save Finding, Findings Board (§17) |
| Monitor | Watchlist with historical filing and intelligence events (P1, §21); live monitoring is future state (§45) |
| Decide | Thesis (P1, §20), IC Brief (P1, §22) |

The user should feel that they are conducting diligence, not chatting with AI.

## 5.2 Navigation

Primary navigation, in order:

**Company Intelligence | Compare | Deep Analysis | Findings**, then **Thesis | Watchlist** once Phase 8b builds them.

- Thesis and Watchlist are P1. They are **omitted from the navigation** until built. There are no "coming soon" stubs.
- **Global primary action: "Ask a question"**, in the top bar on every page. It opens Deep Analysis empty, so an expert can bypass the guided path at any time. (It replaces SPEC v1's "+ New Analysis".)
- **Secondary destinations:** Architecture and business value (P0, §18); Sources, reached through every citation (readable view P0, explorer P1, §16, §23); IC Brief (P1, §22). IC Brief is never more prominent than the primary destinations.
- **Company Intelligence is the default in-app destination.**
- Do not add navigation items merely to make the application appear larger.

## 5.3 Routes

Static export, so detail views use query parameters.

| Route | Page | Priority |
|---|---|---|
| `/` | Compact landing (§7) | P0 |
| `/intelligence` | Company selector | P0 |
| `/intelligence?ticker=AAPL` | Company Intelligence dashboard | P0 |
| `/compare?tickers=AAPL,MSFT,NVDA` | Compare | P0 |
| `/analysis/new?q=&tickers=&origin=` | Deep Analysis input; prefill only fills the form | P0 |
| `/analysis?id=` | Diligence Brief | P0 |
| `/findings` | Findings Board | P0 |
| `/sources/filing?id=#chunk-<id>` | Readable filing with section navigation and passage highlight | P0 |
| `/architecture` | Architecture and business value | P0 |
| `/sources` | Filing explorer | P1 |
| `/ic-brief` | IC Brief with print mode | P1 |
| `/thesis` | Theses | P1 |
| `/watchlist` | Watchlist and events | P1 |

## 5.4 Progressive disclosure

The product progressively reveals sophistication:

| Level | Meaning | Surface |
|---|---|---|
| **Level 1** | Tell me what I need to know. | 30-second view |
| **Level 2** | Show me what's different and why it matters. | What's Changed; Attention Signals with Why This Matters |
| **Level 3** | Help me compare. | Compare |
| **Level 4** | Let me investigate deeply. | Deep Analysis |
| **Level 5** | Show me the evidence. | Evidence drawer and readable source view |

Expert users retain the ability to bypass guidance and ask arbitrary questions immediately (global "Ask a question"; landing "Ask any question").

## 5.5 Plain-language rules

- A new user should be able to select a company and understand the application without reading documentation.
- The user should not need to know what Item 1A, MD&A, 10-K, or 10-Q means to use the primary screens.
- Avoid jargon-heavy SEC terminology on primary screens. Use simple labels first. For example, instead of "Item 1A Delta", use "Risk changes". The evidence may then say "Source: 2025 10-K, Item 1A — Risk Factors".
- SEC terminology appears in evidence and source views, where it helps verification.
- Use consistent terminology across the product: Company Intelligence, Compare, Deep Analysis, Diligence Brief, Finding, Thesis, Watchlist.

## 5.6 Not a chat

- No chat bubbles, no conversational transcript, no chat history.
- A brief's follow-up questions start a **new** Deep Analysis (prefilled, editable, never auto-run). There are no multi-turn follow-up calls.

---

# 6. Priorities: P0, P1, P2

## 6.1 P0 — must be excellent

1. Company Intelligence dashboard and company selector (§8)
2. Performance trends, drivers and current risks (§8–9)
3. What's Changed (§10)
4. Attention Signals (§11)
5. Why This Matters (§11)
6. Recommended Diligence (§12)
7. Compare (§13)
8. Deep Analysis: any question, with the global "Ask a question" action (§14)
9. One-call generation enforcement (§30)
10. Evidence and citations, including adjacent-period comparison and the readable source view from every citation (§16)
11. Brief **Interpretation panel**, brief **company × period coverage matrix**, and **numeric-grounding badges** (§15)
12. Save Finding from any source (§17)
13. Findings Board (§17)
14. **Architecture and business-value page** (§18)
15. Production AWS deployment (§34)
16. Evaluation (§41)
17. Required assessment documentation: README, prompts, prompt log, example request, evaluation notes (§42–43)
18. Cost-controlled architecture (§35)
19. Demo reliability (§38, §44)

Do not sacrifice these for extra functionality.

## 6.2 P1 — strong differentiators, after P0 is excellent

Per-company Diligence Gaps matrix (§19); Thesis (§20); Watchlist UI with historical filing and intelligence events (§21); Analysis Audit Trail (§23); IC Brief and print mode (§22); Filing explorer (§23).

P1 work starts only once P0 is excellent: Phase 8b begins only after the Phase 7 and Phase 8 exit criteria pass. P1 is cut before any P0 item is weakened.

## 6.3 P2 — future state, documented, not built

Do not build before the interview; document in `docs/future-state.md` where useful: live SEC polling infrastructure; email notification delivery; full SNS notification workflow; sophisticated scenario modelling; traditional forecasting; external market-data integration; consensus analyst estimates; valuation engine; portfolio-wide analytics; collaboration and comments; CRM integration; Slack integration; PDF generation; complex user management.

## 6.4 Items moved from SPEC v1

SPEC v1 "IC Brief works" becomes P1 (if Phase 8b does not land, the IC Brief is documented as future state and not claimed in the demo). SPEC v1 "source browsing works" is met in P0 by the readable filing view from every citation; the standalone explorer is P1. SPEC v1's "+ New Analysis" becomes "Ask a question". Full list: Appendix A.

---

# 7. Landing (P0)

A compact product introduction precedes the workspace. The panel must reach the working product immediately. Do not make them scroll through a large marketing site.

- **Hero:** **DiligenceIQ.** "Know what changed. Know what matters. Know what to investigate next."
- **Supporting line:** the private-equity client problem in one or two sentences: understand companies, notice what changed, investigate with evidence, and prepare for the Investment Committee.
- **Primary CTA:** "Open Company Intelligence".
- **Secondary CTAs:** "Ask any question" (an empty Deep Analysis) and "How it works" (the Architecture and business-value page).

Keep this compact.

---

# 8. Company Intelligence (P0)

Company Intelligence is the primary product experience.

## 8.1 Company selector

- The user selects a company, for example `Apple (AAPL)`.
- Deep-coverage companies are featured, Apple first, with search across all 54 corpus companies.
- `GE_10K_2015` (General Electric Capital Corp, FY2014) is labeled outside the review window and not featured (assumptions G2).

## 8.2 What the dashboard answers

DiligenceIQ immediately presents an understandable analysis, without requiring a question: How is the company performing? What appears to be driving performance? What does management emphasize about the future? What risks deserve attention? What changed across filings? What areas are uncertain? What should the user investigate next?

## 8.3 Dashboard sections

1. **30-second view** (§8.4).
2. **Performance** (§9).
3. **Drivers:** MD&A segment or product rows with the largest reported change, each cited.
4. **Current risks:** the latest 10-K's risk headings, grouped by category with plain labels, each cited.
5. **What's Changed** (§10), one of the most prominent sections.
6. **Attention Signals with Why This Matters** (§11).
7. **Recommended Diligence** (§12).
8. **Coverage note:** the company's coverage tier, the periods covered, and what is not known.
9. **Footer:** the profile's generation mode (`llm` or `deterministic`) and index version.

## 8.4 30-second view

A concise, executive-level summary. Potential dimensions: Performance; Growth; Profitability / margins; Outlook; Liquidity / cash where appropriate; Risk changes; Regulatory attention; Evidence coverage.

Do not create unsupported investment ratings. Avoid arbitrary scores such as "82/100", "Strong Buy", "Low Risk", or "Excellent Investment".

Prefer descriptive signals: Accelerating, Slowing, Stable, Improving, Declining, Increased attention, New disclosure, Persistent, Limited evidence.

Every material signal must be evidence-backed.

## 8.5 Coverage tiers

Profile depth follows corpus coverage, computed from the files, never from the manifest's description text (architecture §3, assumptions G1):

| Tier | Companies | Dashboard |
|---|---|---|
| Deep | 12 companies with 14–17 filings (AAPL, AMZN, DIS, GOOG, JNJ, KO, MSFT, NVDA, PFE, TSLA, UNH, XOM) | Multi-year trends; current risks and drivers; filing-to-filing changes |
| Partial | META, BAC, JPM, MCD, PEP | Trends, current risks, drivers; changes where comparable filings exist |
| Limited history | 37 single-10-K companies | Trends from the 10-K's own multi-year tables; current risks; drivers; in-filing trend changes; recommended diligence; a visible "Limited history: one annual report in the corpus" label |

Every dashboard has a performance view, a cited risk section, drivers, and recommended diligence. Filing-to-filing change sections are full only where two comparable filings exist.

## 8.6 Source of the content

- The dashboard reads a **persisted, versioned profile** from the active profile set (§32). It never generates.
- Provenance is labeled: model-written text is shown as company analysis; curated text is labeled "General context"; placeholders (Phase 1 only) are labeled "Placeholder, not filing data".

**Business value.** This page answers: *What is happening with this company, and what should I look at first?*

---

# 9. Performance Intelligence (P0)

Surface useful financial trends automatically where the filing evidence supports them. Metrics: revenue; revenue growth; operating margin; gross margin; profitability (operating and net income); cash / liquidity; debt; capital spending; operating cash flow.

Rules:
- Explain trends in simple language. For example: "Revenue continued growing, but the growth rate slowed from the previous period." Not merely "Revenue: $X."
- Where historical coverage allows it, show trends over multiple periods. Single-10-K companies use the multi-year columns inside that 10-K; 10-Q comparative columns supply current-year trends.
- **Figures are extracted deterministically** from filing tables (DD-17). Each value records metric, period, value, unit, scale, source `chunkId`, the verbatim source row, and a cross-check flag. Growth rates and margins are computed in code only for comparable periods.
- **Trajectory labels** (Accelerating, Growing, Stable, Slowing, Declining; Improving, Stable, Declining for margins) come from fixed thresholds recorded with each label.
- **Every figure has a source row.** The UI shows the source row and chunk on hover and in the evidence drawer.
- **Gaps are honest.** A metric that is not found shows as "Not extracted" and is never filled in. Do not fabricate missing metrics. Do not force every metric onto every company.
- **Cross-filing mismatches** (for example a restatement, above 0.5%) are flagged as "Values differ across filings" with both source rows. Values are never averaged and the mismatch never blocks the build.
- Show each company's fiscal-year end; never silently align different fiscal calendars.

---

# 10. What's Changed (P0)

What's Changed is one of the most prominent parts of Company Intelligence. The product automatically identifies meaningful differences across filings.

| Signal type | Meaning | Deterministic detection (DD-18) |
|---|---|---|
| **NEW** | A meaningful disclosure or topic appears that was not present previously. | Risk-factor heading in the latest 10-K with no match in the prior 10-K |
| **EXPANDED** | A topic receives materially more emphasis or detail. | Per-topic lexicon density rising above relative and absolute thresholds, like-for-like filings |
| **REDUCED** | A previously prominent disclosure receives materially less emphasis. | Heading that disappears, or density falling past the thresholds |
| **TREND CHANGE** | A financial trend changes direction. | From extracted trajectories; works inside one filing's multi-year or comparative columns |
| **OUTLOOK CHANGE** | Management's language about growth, demand, investment, or headwinds changes. | MD&A outlook-lexicon deltas |
| **PERSISTENT** | An issue remains material across multiple filings. | Heading matched in each of at least two consecutive 10-Ks through the latest |

Examples of plain-language output: *"Regulatory disclosure expanded in the latest filing."* *"Export-control discussion appeared more prominently."* *"Revenue growth slowed while margins improved."*

Every change includes:
- a plain-language description;
- evidence for **each** period compared (`evidenceByPeriod`), shown side by side;
- the relevant periods;
- the deterministic measurement that triggered it;
- the ability to investigate further (an editable Deep Analysis question; never auto-run).

Rules:
- 10-Q "no material changes" risk-factor boilerplate never produces a signal.
- With a single 10-K nothing is PERSISTENT; its headings appear as current risks. Companies with one 10-K get no 10-K-vs-10-K signals, and What's Changed says "Limited history: one annual report in the corpus" and shows in-filing changes only.
- **Signal-quality go/no-go (Phase 3):** precision is measured on a hand-labeled set (AAPL, NVDA, MSFT) before thresholds are fixed. Signal types that miss the provisional bar (precision ≥ 0.8, plus a recall sanity check) are **suppressed**, and the dashboard leads with current risks, trajectories, and recommended diligence.

---

# 11. Attention Signals and Why This Matters (P0)

## 11.1 Attention Signals

DiligenceIQ proactively identifies areas deserving investigation.

A signal means *"Something changed or appears important enough to investigate."* A signal does NOT mean *"The company is good or bad."*

Categories: Performance; Growth; Margin; Liquidity; Debt; Regulatory; Competition; Customer concentration; Geographic concentration; Supplier / supply chain; Cybersecurity; Litigation; Management outlook.

Each signal contains: what was detected; why it deserves attention; evidence; period and company context; a CTA to investigate.

Example:

**Regulatory Attention Increased**

> Recent filings devote more discussion to regulatory exposure than earlier filings.

**Why this matters**

> Greater regulatory exposure can affect costs, operating flexibility, or particular business lines. The important next step is understanding which areas of the business are exposed and how management is responding.

Actions:
- **Investigate:** prefills Deep Analysis with the signal's `investigateQuestion` (editable, never auto-run).
- **View Evidence:** opens the evidence drawer with the passages for each period.
- **Track:** saves the signal as a finding (P0). Once the Watchlist exists (P1), Track can also watch the signal's category for that company.

## 11.2 Why This Matters

This is critical. DiligenceIQ helps users understand why a financial or disclosure signal deserves investigation. This layer educates **without making investment decisions for the user**.

Example. Signal: *"Operating margin declined."* Why this matters:

> Declining operating margin means the company is retaining less operating profit from each dollar of revenue. The next step is determining whether this reflects temporary investment, pricing pressure, product mix, or structural cost increases.

Then: **Investigate margin drivers →**. The system bridges **information → understanding → investigation**.

Rules:
- "Why this matters" text is either model-written in the offline profile build, explaining only the supplied signal from its cited passages, or taken from the curated "General context" library (§32.7). The source is recorded (`whyThisMattersSource`) and shown.
- It never rates, scores, or recommends, and never overclaims (§32.6).

---

# 12. Recommended Diligence (P0)

The user should not need to know the correct questions in advance. For each company, DiligenceIQ surfaces recommended areas and questions to investigate, based on the evidence available.

Example:

### Recommended Diligence

1. Regulatory disclosure expanded.
   - Investigate which businesses or geographies may be affected.
2. Margin performance changed.
   - Investigate the drivers of the change.
3. Management increased emphasis on a growth area.
   - Determine how financially material it may be.
4. Customer concentration appears relevant.
   - Determine how concentrated revenue is.

Each recommendation includes: why it was suggested; the supporting signal(s); a clickable CTA.

Clicking a recommendation **prepopulates** Deep Analysis. The question remains editable and never auto-submits.

Recommendations are written in the offline profile build (LLM set) or templated from signals and risks (deterministic set). They are never generated on page view.

---

# 13. Compare (P0)

A first-class Compare experience. The user selects 2–5 companies, for example Apple, Microsoft, NVIDIA.

Compare answers: How do performance trends differ? How do growth profiles differ? How do margin trends differ? What risks are common? What risks are distinctive? Where has regulatory attention changed? What does management emphasize? Which areas deserve further investigation?

## 13.1 Composition (deterministic, no LLM)

Compare is composed in the api Lambda from the selected companies' stored profiles (DD-19). It is built from what every coverage tier has, so it is useful even when a company has no change signals (for example Tesla vs JPMorgan):
- **Trajectories** side by side (revenue, margin, operating income, cash flow), with each company's fiscal-year end shown.
- **Common themes:** risk or signal categories present in every selected company.
- **Distinctive themes:** categories present in exactly one company.
- **Diverging trends:** trajectories of the same metric pointing in opposite directions.
- **Management emphasis:** per company, the top outlook topics in the latest MD&A, with passages.
- **Attention ranking:** by a fixed rule (number of companies sharing the category, then signal count, then position in the latest risk headings, then category order), shown in a tooltip.
- **Recommended comparative diligence:** templated multi-company questions that prefill Deep Analysis (never auto-run). For example:
  > Investigate why NVIDIA growth accelerated faster than peers.

  > Compare regulatory exposure across all three companies.

  > Determine whether margin expansion is broad or company-specific.

## 13.2 Rules

- Do not stop at side-by-side metrics; surface common, distinctive and diverging themes.
- Avoid arbitrary composite ratings. Do not claim one company is the "best investment." Prefer evidence-backed comparisons.
- A dimension × company table (revenue trajectory, margin direction, regulatory attention, major attention area) is the expected shape. **Actual values and signals must be derived from evidence**; none are illustrative placeholders in the product.

- A limited-history company contributes current risks and in-filing trends, and its column says "Limited history". A ticker with no profile is listed as missing; the rest are compared if at least two remain, otherwise `PROFILE_MISSING`.
- Different fiscal-year ends are noted, never silently aligned.
- Any compare row can be saved as a finding.

---

# 14. Deep Analysis (P0)

This is where the required RAG workflow lives. It is positioned as **Deep Analysis**, not as the homepage.

## 14.1 Entry points

Users arrive through Recommended Diligence, Attention Signals, What's Changed, Compare, a brief's follow-up questions, a finding ("Investigate further"), Thesis (P1), a Watchlist event (P1), or **direct arbitrary question entry** (Deep Analysis page, global "Ask a question", landing "Ask any question").

The user must always be able to type **any** supported natural-language business question.

## 14.2 Interface

Do **not** visually represent this as chat.

```text
Deep Analysis

Question
┌──────────────────────────────────────────────┐
│ What are the primary risk factors facing... │
└──────────────────────────────────────────────┘

Companies      [All companies / optionally selected companies]
Filing types   10-K ✓   10-Q ✓
Period         FY2023 — FY2025

                                   [Run analysis]
```

- The question is always the primary input.
- Company, filing-type, and period controls are **optional** retrieval filters.
- A prefilled question (from any entry point) only fills the form. It stays editable. **Generation starts only on an explicit Run click.**
- Where the analysis came from (`origin`) is recorded for provenance only. Retrieval uses only the question and filters.

## 14.3 Runtime path

> Question → Deterministic query analysis → Retrieval (hybrid, balanced lanes) → Context builder → ONE GENERATIVE MODEL REQUEST → Schema validation → Citation and numeric validation → Diligence Brief

- The analysis runs as an asynchronous job (`POST /api/analyses` returns 202; the UI polls). The UI shows the real stages the worker writes (§38.1).
- Every run, including a re-run after a failure, creates a **new** analysis with its own single call.
- Do not compromise the RAG requirements in §2 and §24–31.

---

# 15. Diligence Brief (P0)

The output of an analysis does **not** look like an AI chat response. It is a professional research artifact called the **Diligence Brief**.

## 15.1 Response schema

The one LLM request returns structured output by **forced tool use** (`submit_diligence_brief`), whose input schema is:

```typescript
type DiligenceBrief = {
  title: string;
  executiveSummary: string;
  answerType: 'single_company' | 'comparison' | 'trend' | 'sector' | 'insufficient_evidence';
  keyFindings: Array<{
    title: string;
    finding: string;
    basis: 'reported' | 'analysis';      // filing fact vs analyst synthesis
    tickers: string[];
    citationIds: string[];
  }>;
  comparison?: {                         // omitted when a table makes no sense
    kind: 'table' | 'trend';
    columns: string[];
    rows: Array<{ label: string; values: string[]; citationIds: string[] }>;
  };
  investmentConsiderations: Array<{ text: string; citationIds: string[] }>;
  evidenceGaps: string[];
  followUpQuestions: string[];
};
```

- The schema handles questions where a comparison table would not make sense. Do not force meaningless fields to be populated.
- The model only places `citationIds` inline. **The server builds `citations[]`** from the valid IDs, with source metadata and passage text.
- The server also adds `validation` (invalid citations, uncited findings, numeric checks), `interpretation` (resolved scope), `coverage` (company × period matrix), and `telemetry`.

## 15.2 Brief interface

Include:
- analysis title;
- original question;
- **Interpretation panel** (P0): the companies, sector members, periods (including "last N years" and current-view resolution), filing types and filters the system resolved, plus coverage warnings;
- executive summary;
- key findings, each marked reported fact or analysis;
- comparison or trend section when appropriate;
- investment considerations;
- evidence gaps;
- suggested follow-up questions (each starts a new, prefilled Deep Analysis);
- **company × period coverage matrix** (P0), linked to evidence;
- **numeric-grounding badges** (P0): "unverified figure" on any currency or percentage figure not found in its cited passages;
- validation notices (for example "1 citation removed: not in the supplied evidence");
- source count and clickable citations;
- Save Finding actions on key findings, considerations and comparison rows.

Design this to look like analyst research, not markdown dumped onto a screen.

---

# 16. Evidence and citations (P0)

Evidence traceability is one of the most important features in the application. Users must not be asked to trust AI summaries without source verification.

## 16.1 Citations

- Every material factual claim has citations.
- Citation IDs correspond **only** to retrieved chunks supplied to the model. The citation ID is the chunk ID, for example `AAPL-FY2025-10K-1A-004` (§25).
- Profiles use the same rule: signals, risks, drivers and model-written text cite only supplied chunk IDs.

## 16.2 Evidence drawer

Clicking a claim or citation opens an evidence drawer showing:

```text
Apple Inc. (AAPL)

10-K · FY2025 · period ended 2025-09-27
Item 1A — Risk Factors

Relevant source passage
────────────────────────
<actual retrieved filing text>

Document    AAPL 10-K FY2025
Section     Item 1A — Risk Factors

[Compare with adjacent filing]   [Open in filing]
```

The user can:
- click a claim and open its evidence;
- see company, filing, period, section, and source passage;
- **compare with adjacent filing periods** where applicable: for signals, the passages for each period compared (`evidenceByPeriod`); for brief citations, the same section in the previous and next comparable filing (`GET /api/evidence/adjacent`, from an offline-computed adjacency file, no model call);
- **deep-link into source context**: the readable filing view (`/sources/filing`) with section navigation and the passage highlighted.

Retrieval metadata such as rank or relevance may appear in a secondary area. Do not present a retrieval score as business certainty.

## 16.3 Citation safety

After generation:
- validate every returned citation ID;
- ensure it exists among the chunks supplied in the context;
- never fabricate citations;
- remove or flag invalid citation references, and show the user that a citation was removed;
- log and count citation validation failures.

The model must not be able to cite documents it was not given.

## 16.4 Evidence never changes after the fact

- Each analysis stores a **context snapshot** of the passages sent to the model (text, metadata, `indexVersion`).
- Each saved finding stores its cited passage text, source metadata, and `indexVersion`.
- Profiles carry passage text for their citations.

So citations still open after a re-index, even if chunk IDs renumber.

**Business value.** This feature answers: *Why should I trust this conclusion?*

---

# 17. Findings: Save Finding and Findings Board (P0)

## 17.1 Save Finding

Users capture important discoveries from anywhere in the product:
- a brief's key finding, investment consideration, or comparison row;
- a signal, executive-view item, recommendation, driver, or current risk on Company Intelligence;
- a Compare row;
- a Watchlist event (P1).

A saved finding contains:
- title;
- finding text (description);
- **theme** (one of six; §17.3);
- company or companies;
- source citations, with **copied passage text**, source metadata and `indexVersion`;
- origin (analysis, intelligence, compare, watch) and the source it was saved from;
- originating analysis ID, where applicable;
- timestamp (date);
- optional analyst note;
- status: **Active**, **Needs Follow-Up**, **Resolved**.

Rules:
- **No LLM call** to save a finding. This is deterministic application functionality.
- Text and citations are **copied server-side** from the stored brief, context snapshot, or profile, never accepted from the client.
- Findings remain durable across analyses.

## 17.2 Findings Board

The Findings Board is the durable institutional memory of the diligence work. It consolidates insights from Company Intelligence, Deep Analysis, Compare, thesis investigation (P1), and watch events (P1).

Allow filtering and grouping by: theme; company; status; origin; date; analysis.

Suggested layout:

```text
Findings

[All] [Financial] [Growth] [Risk] [Regulatory] [Liquidity] [Strategic]

Risk factors

Apple
Supply-chain concentration remains a material...
AAPL FY2025 10-K
[View evidence]

NVIDIA
Export restrictions represent...
NVDA FY2025 10-K
[View evidence]

Needs follow-up
...
```

Do not make this a decorative kanban board unless that interaction genuinely improves usability. A polished list, table, or card hybrid is acceptable.

## 17.3 Themes

SPEC v1's diligence workstreams survive as a **finding theme taxonomy** (no workstream pages, status, or progress tracker):

| Theme ID | Label | Example areas |
|---|---|---|
| `financial-performance` | Financial Performance | revenue trends, margin trends, profitability, capital requirements |
| `growth-outlook` | Growth & Outlook | growth drivers, management outlook, geographic growth, demand indicators |
| `risk-factors` | Risk Factors | operational, competitive, supply-chain, cybersecurity, concentration risks |
| `regulatory-compliance` | Regulatory & Compliance | regulatory exposure, litigation, government oversight, jurisdictional risk |
| `liquidity-capital` | Liquidity & Capital | liquidity, debt, cash requirements, capital allocation |
| `strategic-shifts` | Strategic Shifts | acquisitions, divestitures, new markets, changes in strategic direction |

A finding saved from a signal gets a default theme from the signal's category; the analyst can change it.

**Business value.** This page answers: *What have we learned across all of our research?*

---

# 18. Architecture and business-value page (P0)

Route `/architecture`, linked from the landing ("How it works") and the secondary navigation. It covers the PDF's "information on how this creates value for the business" and the future-state expectation.

Contents:
- the **live plane** (one generative call per question) and the **offline plane** (profiles computed once per index version), with the §35.7 exception stated plainly, including the zero-call deterministic set and the switch;
- the single-call design and its proof (counters, tests, telemetry);
- retrieval design in brief (hybrid, balanced lanes, citations);
- evaluation results;
- cost and scaling strategy (§35);
- **how this creates value for a private-equity team** (§44.2);
- future state (§45).

Rules:
- Phase 1 builds it static (no measured numbers). Phase 7 fills in measured evaluation, latency and cost numbers. Phase 9 finalizes it.
- **Only measured numbers**, each traceable to `docs/evaluation.md` or telemetry. No invented metrics.

---

# 19. Diligence Gaps (P1)

DiligenceIQ explains what it does NOT know. A strong diligence tool identifies uncertainty rather than confidently filling gaps.

**Already P0:** the brief's evidence gaps, Interpretation panel and coverage matrix (§15), the dashboard coverage note and "Limited history" label (§8), "Not extracted" metrics (§9), and abstention in Deep Analysis (§29).

**P1: per-company Diligence Coverage matrix.** Per category, a deterministic label from extraction and signal coverage counts:

```text
Diligence Coverage

Financial Performance    — Strong evidence
Growth Outlook           — Strong evidence
Regulatory Exposure      — Strong evidence
Customer Concentration   — Partial evidence
Supplier Concentration   — Limited evidence
```

Gap types to surface: insufficient historical coverage; missing periods; incomplete evidence; unquantified concentration; disclosure without sufficient detail; questions the filings cannot answer.

The labels "Strong / Partial / Limited evidence" are deterministic, not model text, and exempt from the banned list.

---

# 20. Thesis (P1)

An investment-thesis capability. A user defines a hypothesis, for example:

> Services growth and ecosystem monetization will offset slower hardware growth.

A thesis supports:
- **Supporting evidence:** findings and signals the analyst links and marks as consistent with the thesis.
- **Challenging evidence:** findings and signals the analyst marks as weakening or contradicting it.
- **Open questions:** things that remain unresolved.
- **Watched signals:** signal categories whose changes could materially affect the thesis.
- **Test with Deep Analysis:** a prefilled, editable question (never auto-run).

Rules:
- It helps the investor test a thesis over time. It must **never** declare whether the thesis is correct, and it calls no LLM.
- Stance (supporting or challenging) is set by the analyst.
- Limits: ≤ 20 theses per workspace, ≤ 50 links and ≤ 20 open questions per thesis; statement ≤ 1,000 characters.
- Built in Phase 8b; joins the navigation then.

---

# 21. Watchlist, filing events and intelligence events (P1)

## 21.1 Watchlist

A user can indicate **Watch Apple** and choose what matters: New SEC filings; Material risk changes; Regulatory exposure; Growth / outlook; Revenue / margins; Liquidity / debt; Supply chain; Customer concentration; Anything material.

For the assessment build, live monitoring is not built. At minimum:
- watch preferences are represented in the product (per company, per category; ≤ 25 watches per workspace; tickers validated against the company catalog);
- existing corpus history demonstrates detected historical change events;
- the architecture and future-state material show how new filings would trigger monitoring.

Nothing polls. Watch preferences do not require continuously running servers.

## 21.2 Filing event vs intelligence event

Distinguish:
- **Filing event:** "Apple submitted a new 10-Q." Taken from the filing catalog (filing date, type, period).
- **Intelligence event:** "Apple's latest filing materially expanded regulatory disclosure." Taken from the stored profiles' historical change signals, filtered by the watched categories.

The second is substantially more valuable. The Watchlist shows both side by side and should evolve toward notifying users about meaningful intelligence events rather than every document event.

## 21.3 Future monitoring pipeline (P2, drawn, not built)

> EventBridge → check SEC → new filing detected → ingestion → index update → change detection → match user watches → event → SNS / notification

It is not built because the cost rules forbid schedules in this deployment (§35.9). It creates the product loop:

**Understand today → Know when something changes tomorrow.**

---

# 22. IC Brief (P1)

A lightweight **Investment Committee Brief**, built in Phase 8b.

- It does **not** invoke an LLM. It uses saved findings, theses, and existing analysis artifacts.
- Users pin and unpin findings (and theses) for inclusion, and mark key findings.
- Sections are derived deterministically from pinned items:

| IC Brief section | Source |
|---|---|
| Executive View | Pinned theses (statement + supporting/challenging counts) and pinned findings marked key |
| Financial Performance | Pinned findings with theme Financial Performance or Liquidity & Capital |
| Growth Drivers | Pinned findings with theme Growth & Outlook or Strategic Shifts |
| Material Risks | Pinned findings with theme Risk Factors |
| Regulatory Exposure | Pinned findings with theme Regulatory & Compliance |
| Outstanding Diligence | Pinned findings with status Needs Follow-Up, plus open questions of pinned theses |
| Supporting Evidence | Union of the cited passages of all included findings |

- A clean presentation and print mode is included. PDF generation is P2.
- If Phase 8b does not land, the IC Brief is described in the future-state document and the demo does not claim it.

**Business value.** This feature answers: *What does the decision-making group need to know?*

---

# 23. Filing explorer and Analysis Audit Trail (P1)

## 23.1 Filing explorer

The P0 requirement "let me inspect the original source myself" is met by the readable filing view reached from every citation (§16.2). The standalone explorer (`/sources`) is P1. It filters by company, ticker, fiscal year, filing type, and section where available; lists filings (company, filing, period, sections); and opens a filing as readable content with section navigation.

```text
Sources

Search filings...

Company     Filing       Period       Sections
Apple       10-K         FY2025       View
Apple       10-Q         FY2025 Q3    View
NVIDIA      10-K         FY2025       View
```

Do not attempt to recreate EDGAR itself.

## 23.2 Analysis Audit Trail

A per-analysis view assembled from stored data, with no model call: the resolved interpretation, the passages in the context snapshot, validation results, and telemetry, including `generationCallCount`. It lets a reviewer trace exactly what the model saw and what was checked.

---

# 24. RAG ingestion

Create a repeatable, offline, admin-run indexing pipeline.

## 24.1 Input

The corpus is `edgar_corpus.zip`: `.txt` filings plus `manifest.json`. Ingestion reads `CORPUS_PATH` (default `./edgar_corpus`), either the extracted directory or the zip. The corpus is public domain but is not committed to git (79 MB); the README documents where to place it.

Corpus facts the design depends on are verified and reproducible with `node scripts/ingestion/probe-corpus.mjs`: 246 filings (89 10-K, 157 10-Q) from 54 companies, with uneven coverage and known anomalies (architecture §3; assumptions §B and Known corpus anomalies). Coverage is derived from the files, never from the manifest's description text.

## 24.2 Pipeline

1. Parse the manifest (completeness check, license).
2. Parse each filing header, applying metadata overrides for known anomalies.
3. Derive period end, fiscal year, and fiscal quarter.
4. Strip the XBRL preamble and normalize whitespace.
5. Detect meaningful SEC sections (skip the table of contents; never anchor on a cross-reference).
6. Flag 10-Q "no material changes" risk-factor boilerplate.
7. Section-aware chunking (§25).
8. Metadata enrichment.
9. Embeddings (cached, resumable).
10. Search index, adjacency file and index summary, written to S3.
11. Deterministic extraction: financial facts, risk headings, drivers, coverage (time-boxed, §49).

Details: architecture §6.1.

## 24.3 Metadata

Preserve, where available:

```typescript
{
  chunkId, documentId, company, ticker, cik, sector,
  filingType, filingDate, periodEnd, fiscalYear, fiscalQuarter, calendarQuarter,
  section, sectionCode, subsection, boilerplate,
  sourceFile, chunkIndex, charStart, charEnd, text
}
```

## 24.4 Index artifacts

Stored in S3 under `index/<indexVersion>/`:
- the embedding matrix;
- the precomputed BM25 inverted index;
- chunk metadata and text;
- the adjacency file (for each chunk, the most similar passages of the same section in the previous and next comparable filing);
- `summary.json`, the **index summary**: documents, chunks, companies, fiscal years, filing types, and detected sections per filing (also printed by the CLI and recorded in the Phase 2 handoff);
- `manifest.json`: index version (corpus hash + chunker version + embedding model), counts, embedding calls and tokens consumed.

Processed filing text and section offsets are also written to S3 for the readable source view.

## 24.5 Embedding rules

- Documents are embedded **once** per index version, offline.
- Embeddings are cached by content hash (embedded text + model ID), so re-chunking embeds only changed chunks.
- The indexer checkpoints, resumes after interruption, and rate-limits itself to the model quota.
- Documents are **never** re-embedded on deployment or on a user request.
- Index validation runs after every build.

---

# 25. Chunking and citation IDs

## 25.1 Chunking

Do not simply split every document at arbitrary character counts. Prefer section-aware segmentation.

Recognize useful filing structures such as: Item 1 — Business; Item 1A — Risk Factors; Item 2 — Properties; Item 3 — Legal Proceedings; Item 7 — MD&A; financial-statement sections; the equivalent 10-Q sections (Part I Item 2 = MD&A, Part II Item 1A = Risk Factors).

Within large sections, chunk intelligently with modest overlap:
- target **~900 tokens with ~120-token overlap** (provisional until the Phase 3 retrieval evals);
- split on paragraph, then sentence, boundaries; keep pipe-delimited tables intact when they fit, otherwise split on row boundaries;
- never assume line breaks: a single line can be 287,855 characters, so a hard character cap applies;
- **preserve headings with their chunks**: a contextual header (company, filing, period, section, subsection) is prepended to the text used for embedding and BM25. The passage shown to users is the raw text.

Document the chosen chunk size and overlap and explain why (architecture §6.2).

## 25.2 Citation IDs

- Human-readable, built from fiscal labels: `TICKER-FISCALPERIOD-FORM-SECTION-NNN`, for example `AAPL-FY2025-10K-1A-004`, `NVDA-FY2026Q3-10Q-MDA-012`.
- The citation ID shown to the model **is** the chunk ID, and it is immutable within an `indexVersion`.
- A re-index may renumber IDs, so evidence never depends on the live index after the fact (§16.4).

---

# 26. Deterministic query analysis

The runtime must not use another LLM to understand or rewrite the query. Implement deterministic extraction for:

## 26.1 Companies

- Alias lookup constructed from the filing headers (legal names, suffix-stripped names, tickers) plus a small curated list (for example Google → GOOG, Facebook → META, JPMorgan / JP Morgan / Chase → JPM, J&J → JNJ, Coke → KO, Exxon → XOM, Lilly → LLY).
- Example: `Apple`, `Apple Inc.`, `AAPL`.
- **Collision rules:** names that are ordinary English words (Target, Visa, Oracle, Meta, Apple, Caterpillar…) match only as case-sensitive capitalized words; tickers that are short or English words (V, T, MA, GE, MS, KO…) match only as uppercase standalone tokens (assumptions C3).

## 26.2 Sectors

A static, documented sector map (for example "major pharmaceutical companies" → the corpus's pharma members). Shown in the Interpretation panel.

## 26.3 Periods

- Regex and range parsing: `2023`, `2023-2025`, `since 2023`, `last two years`.
- "Last N years" is ambiguous, so do not silently guess. It resolves **per company and corpus-relative** to the N most recent complete fiscal years (by 10-K), plus any later quarters shown separately as "FY<next> YTD".
- **No period named:** per company, the latest 10-K plus subsequent 10-Qs ("current view").
- The resolution is always shown in the Interpretation panel. User filters override it.

## 26.4 Filing types

Recognize: 10-K, annual report, 10-Q, quarterly filing.

## 26.5 Topic hints

Deterministic topic mappings only assist retrieval: risk, regulatory, revenue, growth, liquidity, competition, management outlook. They apply **soft section boosts only**. Do not allow these heuristics to prevent general semantic retrieval; topics never filter.

---

# 27. Retrieval

This is a major area where the product demonstrates technical maturity.

## 27.1 Hybrid retrieval

- Semantic retrieval: **exact** cosine similarity over the in-memory embedding matrix.
- Lexical retrieval: BM25.
- Deterministic metadata filtering: user-selected companies, filing types and period are hard filters.
- Rankings combined with **Reciprocal Rank Fusion** (k = 60).
- 10-Q "no material changes" boilerplate is down-weighted.
- Rerank is **off by default** (§2.1).

## 27.2 Balanced retrieval lanes

A deterministic planner turns the analysis into retrieval lanes, and each lane runs a filtered hybrid search.

**Single-company question.** Retrieve the strongest evidence for that company.

**Multi-company comparison.** Do not allow one company's documents to dominate global top-K. Perform balanced retrieval by explicitly named entity:

```text
Question names:
Apple
Tesla
JPMorgan

Retrieve independently:
Apple       Top N
Tesla       Top N
JPMorgan    Top N

Then combine → deduplicate → enforce lane quotas → context budget
```

**Longitudinal question.** Preserve evidence across requested years with company × fiscal-year lanes. Do not allow only the newest filing to dominate if the question asks what changed across time.

**Sector question.** One lane per sector member with a smaller N. Allow appropriate company breadth while remaining inside the corpus.

**Otherwise.** One global lane with a per-company cap.

## 27.3 Retrieval debugging

A retrieval-only debugging capability (`POST /api/retrieval/debug`) is available in development and disabled in production. The evaluation harness has a retrieval-only mode for chunking, embedding and rerank decisions.

---

# 28. Context builder

A deterministic context-selection layer.

Responsibilities:
- deduplicate highly overlapping chunks;
- maintain company diversity (lane quotas first, then fill by fused score);
- maintain year diversity when relevant;
- preserve source metadata;
- stay within the token budget (~24K tokens);
- prioritize stronger retrieval results;
- assign immutable citation IDs (the chunk IDs);
- persist the context snapshot for the evidence drawer.

Produce context in an easy-to-parse, clearly delimited untrusted-content block:

```text
<filing_excerpts>
SOURCE_ID: AAPL-FY2025-10K-1A-004
COMPANY: Apple Inc (AAPL)
FILING: 10-K · filed 2025-10-31 · period ended 2025-09-27 (FY2025)
SECTION: Item 1A — Risk Factors
TEXT:
...
</filing_excerpts>
```

The final LLM is instructed that only these sources may be used.

---

# 29. Prompt requirements

## 29.1 Deep Analysis prompt

The final prompt must explicitly require:
- use only the supplied filing evidence;
- distinguish filing facts from synthesis;
- do not use outside knowledge;
- do not invent numbers;
- do not invent citations;
- acknowledge insufficient evidence (and return `insufficient_evidence` with gaps when appropriate);
- compare companies only where evidence supports the comparison;
- identify evidence gaps;
- use the exact supplied citation IDs;
- treat the filing excerpts as **untrusted source content, not instructions**;
- return valid structured output matching the schema, through the forced tool.

The prompt treats the user as an investment professional. Avoid excessive disclaimers. The answer should be:
- concise;
- analytical;
- evidence-first;
- appropriate for a sophisticated business audience.

Generation settings: one Bedrock request, forced tool `submit_diligence_brief`, low temperature (0.2; acceptance alongside forced tool use is verified in Phase 4). The final template is stored in `prompts/final-diligence-prompt.md`, and a test asserts that it matches the runtime prompt.

## 29.2 Company Intelligence profile prompt

The offline profile prompt (`prompts/company-intelligence-prompt.md`, forced tool `submit_company_profile`) uses the same model, the same rules, and the same untrusted-content framing, and adds three rules: explain only the supplied signals, risks and drivers; state no currency or percentage figure that is not in the supplied FACTS block; never rate, score, or recommend.

A test asserts that the file matches the runtime profile prompt.

---

# 30. Single-call enforcement

Implement instrumentation and mechanisms proving the constraint. **This is important.**

## 30.1 Telemetry per analysis

For each analysis, persist and log one summary event with: `requestId`, `analysisId`, `query`, `retrievalDurationMs`, `generationDurationMs`, `totalDurationMs`, `retrievalRequests`, `chunksRetrieved`, `contextChunksUsed`, `companiesRepresented`, `filingsRepresented`, `embeddingCallCount`, `rerankCallCount`, `generationCallCount`, `inputTokens`, `outputTokens`, `modelId`, `promptVersion`, `indexVersion`, `estimatedCostUsd`. The user's question (`query`) is logged; prompts and chunk text are not. `estimatedCostUsd` comes from a configured pricing table and is labeled an estimate.

`generationCallCount` MUST equal **1** for every analysis that reaches generation. It is 0 for an analysis that failed before generation (for example `NO_RELEVANT_EVIDENCE`), and it never exceeds 1. A metric alarm fires if it ever does.

## 30.2 Defense in depth

| Layer | Mechanism | What it prevents |
|---|---|---|
| Queue | SQS event source mapping `batchSize: 1`, `maximumConcurrency: 2`; visibility timeout 1080 s; `maxReceiveCount: 3` → DLQ; **no reserved concurrency** (the account limit of 10 is shared) | Unbounded redelivery |
| Worker | **Conditional claim** `QUEUED → RUNNING` with a fresh `claimToken`, only before `deadlineAt`. A delivery whose analysis is not QUEUED is acknowledged without work. | Duplicate delivery or redelivery producing a second generation. **The guarantee rests on this layer.** |
| SDK | Generation client with `maxAttempts: 1` | Silent SDK retries, each a new API request |
| Code | `GenerationGateway`, a per-analysis counter that throws on a second call | Any code path invoking the model twice |
| Pipeline | No query rewriting, planning, critique, repair, or summarizer LLM calls; JSON repair is deterministic | Hidden extra calls |
| Persistence | `generationStartedAt` and `generationCallCount` persisted **before** the call | An honest record even if the worker crashes mid-call |
| Tests | Exactly one invocation on success, error, malformed output, duplicate delivery, and redelivery after a claim | Regressions |

Further rules:
- Redelivery is never a recovery path: the visibility timeout exceeds the job deadline, so a redelivered message finds the analysis past its deadline or not QUEUED and is acknowledged without work.
- A failed generation becomes a clear error state with a request ID. Re-running is an explicit user action that creates a **new** analysis.
- The worker only constructs a gateway with `purpose: 'analysis'` (a test spies on the constructor across every worker path). A bundle test asserts that no deployed bundle contains the offline profile builder or its prompt.
- Add unit and integration tests ensuring the answer path cannot invoke the generative model more than once.

Details: architecture §4.3 and §5; DD-04, DD-14.

---

# 31. Output validation

All validation is deterministic. It never makes a second LLM call.

- **Schema:** Zod parse of the forced-tool output, with deterministic repair only. If parsing still fails, return a typed `MALFORMED_OUTPUT` error.
- **Citations:** every ID must be in the context set. Invalid IDs are removed and flagged on the brief, and the failure is logged and counted.
- **Uncited claims:** findings without valid citations are flagged.
- **Numeric grounding:** every currency or percentage figure must appear in at least one of its cited chunks; otherwise it gets an "unverified figure" badge.
- **Profiles** (§32): citations must be a subset of the supplied IDs, figures a subset of the extracted facts, and model-written text must contain no banned phrase. A failing profile falls back to the deterministic profile.

---

# 32. Offline Company Intelligence build

Company Intelligence must exist **before** anyone asks a question, without making any page view call an LLM. Profiles are therefore a **build-time artifact**, computed once per index version like the embeddings, persisted in S3, and only read at runtime (DD-16).

## 32.1 Generation strategy

Do NOT make ten separate LLM requests to build one company dashboard. The pipeline per company is:

> Retrieval across relevant company periods → deterministic financial extraction (facts, trends) → deterministic change and signal candidates (with evidence per period) → deterministic current risks and drivers (cited) → deterministic profile (always built; zero calls) → LLM set only: ONE structured Company Intelligence generation request → validate → persist profile → reuse across sessions

Opening the dashboard later reads the persisted profile. It never generates it again.

## 32.2 Deterministic vs generative responsibilities

Prefer **deterministic** extraction for: reported financial figures; periods; filing metadata; filing comparisons where straightforward; coverage; source and citation mapping; calculation of growth rates where mathematically appropriate.

Use the **LLM** (offline profile call, or the live Deep Analysis call) primarily for: synthesis; explanation; categorization; plain-language interpretation; attention-signal explanation; recommended diligence; cross-document reasoning.

Do not ask the LLM to recreate easily determinable numeric values. The model may select, explain, and categorize the supplied signals, risks, and drivers. It may not cite anything outside the supplied chunk and signal IDs, or state a figure that is not in the supplied facts.

## 32.3 Two profile sets and a runtime pointer

For each index version, two sets are built:
- `intelligence/<indexVersion>/llm-v<profilePromptVersion>/<TICKER>.json`: the **LLM set**, at most one call per company, validated, with a per-company deterministic fallback;
- `intelligence/<indexVersion>/det-v<templateVersion>/<TICKER>.json`: the **deterministic set**, zero calls.

Each set has a `manifest.json` (per-company generation mode, call count from the ledger, tokens, model, durations, validation results). The api Lambda reads the active set named by the SSM parameter `/diligenceiq/active-profile-set` (cached about 60 s). Switching sets is a parameter change: instant, no rebuild, no deploy, no UI change. `GET /api/health` and `GET /api/companies` report the active set.

## 32.4 Build ledger and limits

- The builder (`scripts/intelligence/build-profiles.mjs`, run with `pnpm intelligence:build`) is **offline and admin-run**: it runs on an admin workstation with the admin's credentials, is never deployed, never scheduled, and never triggered by a page view or event.
- `--max-calls` is required; the run stops at the cap.
- An **append-only build ledger** enforces at most **one** generation call per company per (`indexVersion`, `profilePromptVersion`), across processes: one immutable S3 object per key, created with a conditional write **before** the call. If the object exists, no call is made.
- There is **no `--force`**. Regenerating requires a `profilePromptVersion` bump, which is made only for a real prompt change with a real prompt-iteration entry, never just to retry.
- A failed call (error or validation failure) is **never retried at the same version**. That company's LLM-set profile is its deterministic fallback, with the failure recorded in the manifest.
- The same discipline as Deep Analysis applies: `maxAttempts: 1`, a `GenerationGateway` with `purpose: 'profile'`.

## 32.5 Versioning and refresh

A profile is versioned by index version, prompt version (`profilePromptVersion`) or template version (`templateVersion`), company, and covered periods. It is regenerated only when one of those changes. An admin "refresh" is a version bump, which is a new ledger key. A profile is never regenerated because someone opened a page.

## 32.6 Banned vocabulary (canonical list)

One list, in `packages/core/vocabulary.ts`, used by both the profile validator and the evaluation harness. It applies only to **model-written** text (headline, what changed, why this matters, executive view, outlook, recommended diligence). Deterministic labels and quoted filing passages are exempt. Matching is case-insensitive and phrase-level with word boundaries:

| Banned phrases | Allowed (not matched) |
|---|---|
| Recommendations: "strong buy", "strong sell", "buy/sell/hold rating", "rated a buy/sell/hold", "(we / investors should / you should) buy, sell, hold, avoid", "recommend buying/selling/holding/investing", "is / looks like a buy/sell" | "buyback(s)", "share repurchase", "selling, general and administrative", "sells", "sold", "customers buy", "strong demand" when cited |
| Scores and ratings: "N/10", "N/100", "score of", "rating of", "out of 10/100", "N stars", "grade A–F" | "credit rating(s)", "rating agencies" |
| Verdicts: "low-risk investment/company/stock", "safe investment", "best investment", "undervalued", "overvalued", "must-own", "guaranteed return" | "low-income"; "high-risk" inside a quoted passage |

Bare "buy", "sell", and "strong" are not banned on their own. A match rejects the LLM profile, and the deterministic profile is written for that company. The exact patterns are in DD-16.

## 32.7 Curated "General context" library

The one allowed, labeled exception to "no hardcoded demo answers". It is a hand-written, generic, per-signal-category explanation of why a category matters (for example: when a few customers drive a large share of revenue, losing one can move results). It never names a company, never states a figure, and never claims what happened. It is rendered with a "General context" label and versioned as `templateVersion`.

## 32.8 Profile content

The stored profile (Zod schema in `packages/core`; architecture §7.1) holds: company and sector; version (index version, profile set, prompt or template version, build time, periods covered); coverage (tier, filing counts, per-category evidence level); facts (with source rows); trends; drivers; current risks; signals (with `evidenceByPeriod`, measurement, `investigateQuestion`, headline, what changed, why this matters and its source); executive view; management outlook; recommended diligence; gaps; citations with passage text; generation metadata (mode, model, call count, tokens, validation counts). Scores, ratings and recommendations are not part of the schema.

## 32.9 Pass bars and the deterministic fallback

Provisional bars (revisited after the first real build; §41.3): 0 invalid citations, 0 unsupported figures, 0 banned-phrase matches in shipped profiles, ≤ 1 call per profile, LLM-to-deterministic fallback rate ≤ 10% across the 12 deep-tier companies.

Scope fallback: if Phase 4b slips, ship the deterministic set only; the UI is unchanged and the LLM set is described as an option on the Architecture page.

## 32.10 Explaining it to the panel

> "Live: every question you ask is answered by exactly one LLM call. Offline: each company profile is computed once per index version and stored, like the embeddings; the dashboard only reads it. We also ship a zero-call deterministic set and can switch to it instantly."

The offline plane gets at most about one minute of the demo. The live question stays at the center. Whether a build-time profile call is acceptable is an **interpretation**, not something the PDF states (assumptions A6), so the question is put to Eliza before Phase 4b (assumptions F4). Until it is answered, both sets are built; if Eliza says no, or has not answered by the demo, the deterministic set is active.

---

# 33. Data model and API

The data model and API contract are specified in [architecture.md](docs/architecture.md) §8 (DynamoDB single table) and §9 (API contract, error codes, user-visible states). This specification fixes the rules they must follow:
- **Storage:** one DynamoDB on-demand table, partitioned per anonymous workspace, with TTL. Items: workspace metadata, analyses (status, stage, claim and deadline fields, call counter, interpretation, coverage, brief, validation, telemetry, origin), context snapshots, findings (theme, origin, copied citations), theses and watches (P1), and rate counters. S3 holds the corpus, processed filings, index artifacts, and profile sets.
- **API surface:** session; workspace and reset; companies and Company Intelligence profiles (read-only); Compare (2–5 tickers); analyses (create returns 202, poll, list, context); findings (CRUD, created from a typed source); evidence adjacency; sources; IC Brief, theses and watchlist (P1); retrieval debug (development only); health.
- **Rules:**
  - Zod validation at every boundary; input size limits (§39).
  - Every response carries `x-request-id`. Errors return a typed `ApiError` and never a stack trace.
  - Every route except health and session requires a valid session cookie and is scoped to the caller's partition.
  - `POST /api/findings` copies text and citations server-side from stored content.
  - Analysis origin is provenance only.
  - No route that reads profiles, composes Compare, or handles findings, theses, watchlist, IC Brief, or sources can reach a model client (tested).

---

# 34. AWS architecture

Optimize for production credibility, development efficiency, and near-zero idle cost (§35).

```text
Route 53 (existing mikemiller.ai zone)
   ↓
diligenceiq.mikemiller.ai
   ↓
AWS Amplify Hosting — static Next.js export, security headers,
rewrite /api/<*> → HTTP API (same origin)
   ↓
API Gateway HTTP API (stage throttling)
   ↓
api Lambda — sessions, workspace, findings, sources, profiles (read-only),
Compare, thesis, watchlist, kill switch and caps, analysis create (202) / poll
   │            │                    │
DynamoDB     S3 (processed       SQS analysis queue → DLQ → dlq-handler Lambda
(on-demand)  filings, profiles)      │
                                     ↓
                          worker Lambda — claim, load + cache index from S3,
                          query analysis, query embedding (retrieval),
                          hybrid retrieval, context, ONE Bedrock generation,
                          validation, persist → idle

Offline (admin workstation, never deployed): ingestion → embeddings → index → S3;
Company Intelligence profile build → S3
```

- **Region:** us-east-1 for every stack.
- **Infrastructure as Code:** AWS CDK in TypeScript (`CoreStack`, `ApiStack`, `WebStack`).
- **Hosting:** Amplify Hosting with a static Next.js export; the custom domain is defined in CDK. A long generation call never runs inside a request: analyses are asynchronous jobs.
- **Compute:** Lambda only, shipped as esbuild zip bundles (no Docker on the build machine).
- **Models (environment-configurable):** generation `us.anthropic.claude-sonnet-4-6` (`GENERATION_MODEL_ID`; Sonnet 5.5 has 0 quota in this account); embeddings `amazon.titan-embed-text-v2:0` (`EMBEDDING_MODEL_ID`). Bedrock is called only from the worker (and from the offline builder with admin credentials).
- **Search:** the pre-built hybrid index in S3, loaded and cached by the worker (§35.3, DD-01). Not OpenSearch.
- Use the AWS services that yield the most reliable implementation. Do not introduce services merely to increase architectural complexity.

Details: architecture §1, §4, §11.

---

# 35. Cost control and scale-to-near-zero

Cost efficiency is a first-class product requirement. DiligenceIQ is an interview and demo deployment and should incur minimal ongoing cost when it is not actively being used.

## 35.1 Principle

The architecture should:
- scale to near zero when idle;
- avoid always-on compute wherever practical;
- avoid continuously running search or database clusters solely for the demo;
- favor request-based, serverless AWS services;
- incur meaningful inference cost only when a user actually performs an analysis (**one named exception:** the offline profile build, §35.7);
- preserve a credible path to higher-scale production infrastructure later.

Optimize for:

> **Idle cost → as close to zero as practical. Active cost → proportional to actual usage.**

Do not provision infrastructure for hypothetical enterprise scale that the current workload does not require. Demonstrate production-quality engineering without paying for permanently running production-scale infrastructure.

## 35.2 Preferred services

Favor:
- AWS Lambda for backend compute;
- API Gateway (HTTP API) as the request-based API layer;
- S3 for the SEC corpus and durable artifacts;
- DynamoDB on-demand for lightweight application state;
- Amazon Bedrock for usage-based embeddings and generation;
- CloudWatch with controlled log retention;
- AWS Amplify static hosting;
- other services with minimal or no idle compute cost (SQS, SSM Parameter Store standard parameters).

Avoid always-on EC2 instances, ECS services, provisioned databases, or continuously running clusters unless there is a compelling requirement. The deployment contains none of: OpenSearch (domain or Serverless), NAT gateways, EC2, ECS or Fargate, RDS or Aurora, WAF web ACLs, provisioned concurrency, reserved concurrency, or scheduled jobs.

## 35.3 Search and vector retrieval

Do NOT automatically choose OpenSearch simply because this is a RAG application. Evaluate the retrieval architecture against:
1. retrieval quality;
2. latency;
3. implementation complexity;
4. corpus size;
5. idle cost;
6. production evolution path.

For this corpus, the chosen architecture is a **pre-built retrieval index stored durably in S3 and loaded by serverless compute** (DD-01):

> SEC corpus → Offline ingestion / indexing → Precomputed embeddings + lexical index → S3 → Lambda loads / caches index → Hybrid retrieval → Context builder → ONE Bedrock generation request

The index may remain cached in a warm Lambda execution environment for later requests, but the architecture never requires permanently running compute. If a managed vector or search service is ever selected instead, document why its retrieval benefits justify its idle cost.

## 35.4 Offline and online costs

Indexing is an offline administrative process. It may temporarily consume compute and embedding calls because it does not run continuously.

Runtime is significantly cheaper:

> User question → serverless compute → retrieval against the existing index → one Bedrock generation request → persist result → compute returns to idle

Documents are NOT re-embedded on any deployment or user request.

## 35.5 DynamoDB

Use DynamoDB on-demand where persistence is needed: workspaces and demo sessions, analyses, saved findings, IC Brief selections, theses and watches. Do not provision fixed read/write capacity. Demo workspaces expire by TTL, with no cleanup job.

## 35.6 Bedrock

Bedrock usage is demand-driven. The application must:
- generate document embeddings once during ingestion;
- never regenerate embeddings unnecessarily;
- invoke the generative model exactly once per analysis;
- avoid background LLM calls;
- avoid LLM calls merely to populate dashboards (**named exception:** §35.7);
- avoid LLM calls for saving findings;
- avoid LLM calls for IC Brief assembly;
- avoid LLM calls for Compare, Thesis, and Watchlist;
- track input and output token usage where available.

## 35.7 Named exception: the offline Company Intelligence profile build (DD-16)

**What it overrides.** On 2026-10-01 Mike explicitly chose the hybrid offline profile approach, after being told the documents then said dashboards never call an LLM. That choice overrides exactly three lines of the cost addendum, quoted verbatim, **for the offline profile build only**:
- "incur meaningful inference cost only when a user actually performs an analysis;"
- "avoid LLM calls merely to populate dashboards;"
- "RAG generation occurs only in response to user analysis;"

**Bounds:**

| Limit | Rule |
|---|---|
| Offline | Runs on an admin workstation with the admin's credentials. Never deployed as a Lambda or any other runtime component. |
| Admin-run | Started by hand. Never on page view, never scheduled, never triggered by an event. |
| Bounded | At most **one** generation call per company per (`indexVersion`, `profilePromptVersion`), enforced by the append-only build ledger. No `--force`. |
| Budget-capped | `--max-calls` is required; the run stops at the cap. A full LLM build is at most 54 calls. |
| Live plane untouched | Every user question is still exactly one live call. The api Lambda has no Bedrock permission. |
| Withdrawable | A zero-call deterministic set is always built, and `/diligenceiq/active-profile-set` switches to it instantly, without a rebuild or deploy. |
| Disclosed | Stated plainly on the Architecture page and in the README. |

Everything else in §35 applies to the profile build unchanged. No other exception exists. Mechanism: §32; rationale and alternatives: DD-16; interpretation status: assumptions A6 and F4.

## 35.8 Observability cost controls

CloudWatch logging must be useful but bounded:
- explicit log retention on every log group (14 days);
- structured JSON logs;
- no unnecessary debug logging in production;
- no logging of full SEC chunks or complete prompts unless `DEBUG_LOG_PROMPTS=true` (off in production);
- no high-frequency background telemetry.

## 35.9 No scheduled workloads

Do not add scheduled polling, recurring indexing, periodic agents, or background jobs. The application performs essentially no compute when nobody is using it. Stuck analyses are failed lazily when polled past their deadline, and dead-lettered messages are handled by an event-driven Lambda, not a schedule.

## 35.10 Cost visibility

Add lightweight request-level cost observability. Capture: embedding calls during ingestion (index manifest); generative calls (per analysis; per profile in the build manifest); input tokens; output tokens; retrieval requests; execution duration.

Do not claim exact dollar costs unless they are calculated from current configured model and service pricing. Per-analysis cost is computed from a configured pricing table and labeled an estimate.

## 35.11 Spend controls

The demo is public and anonymous, and each analysis makes one paid call:
- **Kill switch:** SSM parameter `/diligenceiq/analyses-enabled`, cached about 60 s, checked on `POST /api/analyses` and again by the worker before generation.
- **Global daily cap** on analyses (conditional counter; default 200).
- **Per-workspace hourly cap** and a **daily workspace-creation cap**, environment-configurable.
- HTTP API stage throttling and the worker's `maximumConcurrency: 2`.
- An **AWS Budget alert**, which alerts only and does not stop spend.

## 35.12 Cost guard as tests

CDK assertion tests fail the gate if the synthesized templates contain any resource listed as absent in §35.2, and assert explicit log retention, on-demand billing with TTL, the queue settings, least-privilege IAM, no Bedrock permission on the api Lambda, and that the profile builder is not deployed.

## 35.13 Product cost rules

- No unnecessary always-on compute.
- Precompute reusable intelligence where appropriate; cache Company Intelligence profiles.
- Do not regenerate company profiles on page views. Generate profile intelligence only when the data or prompt version changes (an explicit, admin-run version bump).
- Persist structured intelligence, versioned against the corpus/index version.
- Deep Analysis remains one generative request.
- Dashboards do NOT trigger LLM calls by being opened.
- Compare reuses structured intelligence.
- Watch preferences do not require continuously running servers.

## 35.14 Required documentation: "Cost and Scaling Strategy"

`docs/architecture.md` must include a section titled **"Cost and Scaling Strategy"** that explains: which resources incur idle cost; which resources are usage-based; how the application approaches zero compute cost while idle; expected cost drivers (including the one-time offline embedding and profile costs); what architecture would change if usage grew substantially.

It also documents the evolution path:

| Stage | Architecture |
|---|---|
| **Current / Pilot** | S3-hosted search artifacts + Lambda retrieval |
| **Growing deployment** | Managed vector/search infrastructure behind the same search interface; incremental ingestion; SSO; raised concurrency |
| **Enterprise scale** | Dedicated search infrastructure, stronger tenancy controls, advanced observability, private networking, and workload-specific scaling |

The architecture must show that the pilot is not over-engineered while still providing a credible path to enterprise scale.

The cost Definition of Done is in §51.2.

---

# 36. Implementation stack

Unless a clear technical reason exists to deviate:
- **Frontend:** Next.js (App Router) as a static export; TypeScript (strict); Tailwind CSS; shadcn/ui on the Evidence design system (§37).
- **Validation:** Zod at every boundary.
- **AWS:** AWS SDK v3; Amazon Bedrock (generation and embeddings); Lambda; API Gateway HTTP API; SQS; S3; DynamoDB; SSM Parameter Store; CloudWatch structured logs; AWS CDK (TypeScript).
- **Testing:** Vitest; React Testing Library; Playwright for critical flows and production smoke; CDK assertions.
- **Tooling:** pnpm 9 workspace; Node ≥ 22.

Keep dependencies purposeful.

---

# 37. Enterprise UX and style

The product must visually resemble sophisticated B2B SaaS used by investment or strategy teams.

Design attributes: restrained; confident; information-dense without being cluttered; clear typographic hierarchy; subtle borders; excellent spacing; strong empty, loading, and error states; high-quality tables; compact badges and metadata; responsive layouts: desktop excellent, tablet and mobile acceptable.

Avoid: neon "AI" gradients; giant glowing chat boxes; excessive glassmorphism; cartoon illustrations; AI sparkle icons everywhere; chat bubbles; consumer-app aesthetics; oversized marketing copy inside the working application.

**Palette and system.** DiligenceIQ uses the Evidence design system shared by Mike's products: a navy ground and rail, light working surfaces, muted slate text, and one restrained accent, Sapphire `#2B48CA`. The brand gradient is used only in the restrained places listed in `docs/design-tokens.md` (brand tile, primary CTAs, active-nav marker, progress fill, hero phrase). Navy is reserved for analysis moments (landing hero, Company Intelligence header, brief header, evidence drawer header). Status is shown as a tinted fill with a dot, never as colored words.

**Product-specific rules:**

- Descriptive labels only; no scores, ratings, or verdict badges.
- Provenance labels: "Placeholder, not filing data" (Phase 1 fixtures only), "Seeded from a real pipeline run", "General context", and the profile's generation mode. No permanent global "Sample data" badge.
- Citation chips are mono, readable (`§ AAPL FY2025 · 1A`), and carry the full chunk ID in their accessible name.

**Accessibility:** WCAG-conscious contrast (asserted by a token test); keyboard-accessible controls; semantic markup and real tables; visible focus states; ARIA where appropriate, `aria-live` for stage updates; focus-trapped dialogs and drawers that close on Esc; `prefers-reduced-motion` respected.

Details: `docs/design-tokens.md`.

---

# 38. Loading states and error handling

## 38.1 Loading states

The analysis experience visibly communicates meaningful stages without pretending agents are working. The stages shown are the stages the worker actually writes:

```text
Loading filing index...          (only on a cold start)
Interpreting the question...
Searching SEC filings...
Balancing evidence across companies and periods...
Preparing source context...
Generating diligence brief...
Validating citations and figures...
```

- Stages correspond to actual execution. Do not create fake progress lasting longer than the actual task.
- The cold index load after idle is a real, measured stage.
- Dashboards and Compare read stored profiles and use skeletons, not staged progress.

## 38.2 Error and degraded states

Each state has a designed screen with a plain-language message, a request ID where a request failed, and a recovery action. Never show raw stack traces in the browser. Every state has a test.

**States from SPEC v1:**

| State | What the user sees |
|---|---|
| Generation timeout (v1 "Bedrock timeout") | "The analysis took too long." Re-run creates a new analysis. |
| Search unavailable (v1 "OpenSearch unavailable"; the index is in S3 here) | "Filing search is unavailable right now." Retry. |
| No relevant evidence | "The filings don't cover this," with the covered companies and periods. No generation call is made. |
| Malformed generated output | "The answer couldn't be validated." Re-run. |
| Unsupported query | Inline form error (empty, too long); out-of-corpus companies get an insufficient-evidence brief or the list of covered companies. |
| Missing source document | "This filing isn't available." The finding keeps its copied passage. |
| Missing corpus or index | Banner on Deep Analysis; dashboards still load from profiles; health endpoint reports it. |
| Invalid citation | Removed and counted; badge on the brief ("1 citation removed: not in the supplied evidence"). |
| Network failure | "Connection lost." Polling resumes automatically; the analysis continues server-side. |

**States added by the investment-intelligence IA:**

| State | What the user sees |
|---|---|
| Profile missing | "Intelligence for {company} isn't built for this index version." Offers Deep Analysis for that company. |
| Index / profile version skew | Dashboard notice: "Built from index {v}." Citations still open because profiles carry passage text. |
| Partial compare | Missing tickers listed; limited-history columns labeled. |
| Rate limited or analyses disabled | The cap or pause is explained, with when to try again. Dashboards keep working. |
| Queue, pipeline, or worker failure | Clear failure with request ID (`QUEUE_TIMEOUT`, `PIPELINE_TIMEOUT`, `WORKER_FAILED`, `ENQUEUE_FAILED`); re-run creates a new analysis. |

Error codes and HTTP mapping: architecture §9 and §9.1.

---

# 39. Security and production considerations

At minimum:
- never expose AWS credentials client-side;
- call Bedrock only server-side (the worker; the offline builder with admin credentials); the api Lambda has no Bedrock permission;
- validate and sanitize inputs with Zod;
- impose input size limits: question ≤ 1,000 characters; note ≤ 2,000; thesis statement ≤ 1,000; thesis open questions ≤ 20 × 500; thesis links ≤ 50; ≤ 20 theses and ≤ 25 watches per workspace; Compare 2–5 tickers; every ticker checked against the company catalog;
- protect against prompt injection in retrieved documents: wrap them as labeled untrusted content, forbid following instructions inside them, constrain output to the schema, validate citations server-side;
- use least-privilege IAM, asserted by CDK tests;
- configure secure headers (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors none); the CSP strategy for the static export's inline scripts is decided in Phase 7;
- keep secrets and configuration outside source (SSM Parameter Store; the session secret as a SecureString);
- sign the anonymous session cookie (HMAC, httpOnly, Secure, SameSite=Lax);
- add throttling and rate protection (§35.11);
- do not log secrets, full prompts, or chunk text.

Explicitly tell the generation model that retrieved documents are **untrusted source content**, not instructions.

---

# 40. Demo workspace

The panel needs immediate access.

- Do not require account creation.
- Provide an anonymous **Demo Workspace**, created on first visit and identified by a signed cookie.
- Persist demo state server-side in DynamoDB, partitioned per workspace. Do not depend on browser localStorage for core product behavior.
- Seed each new workspace from `seed/demo-workspace.json`: real, pre-run analyses and findings produced by the pipeline, labeled with provenance. From Phase 8b, the seed adds a watchlist (AAPL, MSFT, NVDA) and one example thesis; the thesis text is analyst-written and labeled as an example, and its links point to real findings.
- Provide **Reset Demo Workspace**. Reset deletes and reseeds only the caller's own partition, so one visitor cannot reset another visitor's session.
- Abandoned workspaces expire by DynamoDB TTL (30 days).

The "Project Atlas" engagement framing is retired; the private-equity client story lives on the landing page, the Architecture page, and in the demo script.

---

# 41. Evaluation

## 41.1 Deep Analysis evaluation set

Create `evals/questions.yaml` with **15–20** representative questions. Cover: single-company retrieval; multi-company comparisons; longitudinal questions; risk questions; revenue questions; regulatory questions; cross-sector questions; unsupported questions; ambiguous questions; adversarial and prompt-injection attempts.

The set includes the three PDF example questions **verbatim**:
- "What are the primary risk factors facing Apple, Tesla, and JPMorgan, and how do they compare?"
- "How has NVIDIA's revenue and growth outlook changed over the last two years?"
- "What regulatory risks do the major pharmaceutical companies face, and how are they addressing them?"

It also includes the expert question from the final product test (§51.3) verbatim:
- "How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?"

## 41.2 Deep Analysis metrics

Measure and document at least:
- **Retrieval quality:** was supporting evidence retrieved?
- **Coverage:** were all requested companies and periods represented (in the context and the brief)?
- **Citation validity:** do all citations point to supplied chunks? Target 100% after validation; report the pre-validation rate.
- **Groundedness:** are factual claims supported by retrieved sources?
- **Numeric grounding:** share of figures found in cited chunks.
- **Completeness:** were the major components of the question answered?
- **Abstention:** does the system acknowledge insufficient evidence rather than inventing an answer?
- **Injection resistance:** planted instructions are not followed.
- **Generation calls per question:** must be 1; plus token and latency telemetry.

Do not add a runtime LLM-as-judge. Manual evaluation plus deterministic checks is acceptable and easy to defend. A retrieval-only mode (no generation) supports the chunking, embedding, and rerank decisions.

## 41.3 Profile evaluation

`evals/profiles.yaml`, run after each profile build. Provisional bars, revisited after the first real build:

| Metric | Provisional bar |
|---|---|
| Citation validity after validation | 100% |
| Figure match against extracted facts | 100% |
| Banned-phrase matches in shipped profiles | 0 |
| Signal precision on the hand-labeled AAPL, NVDA, MSFT set | ≥ 0.8 |
| Signal recall sanity check on the same set | ≥ 0.5 of labeled real changes found |
| LLM-to-deterministic fallback rate, 12 deep-tier companies | ≤ 10% |
| Coverage-tier correctness | 54/54 |
| Generation calls per profile (from the ledger) | ≤ 1 |

## 41.4 Output

Results are written to `evals/results/` and summarized in `docs/evaluation.md`, the "notes on how you evaluated quality" deliverable. The Architecture page shows only these measured numbers.

---

# 42. Prompt iteration log

Create `docs/prompt-iterations.md`, with a section for each prompt:
- the Deep Analysis prompt (`promptVersion`);
- the Company Intelligence profile prompt (`profilePromptVersion`).

Every actual prompt change includes:

```text
Version:
Problem observed:
Change:
Why:
Test questions:
Result:
```

Do not fabricate historical prompt iterations. Only record changes actually made during development. A profile prompt version is bumped only for a real change, which always gets a real entry.

Store the final prompts separately: `prompts/final-diligence-prompt.md` (the final prompt template deliverable); `prompts/company-intelligence-prompt.md`; earlier versions under `prompts/versions/`.

Tests assert that each file matches the runtime prompt.

---

# 43. Required repository documentation

## 43.1 Repository contents

The completed repository must contain:

```text
README.md  SPEC.md  CLAUDE.md  STATE.md
docs/        architecture.md (incl. "Cost and Scaling Strategy"), assumptions.md, design-decisions.md,
             design-tokens.md, implementation-plan.md, testing-strategy.md, evaluation.md,
             prompt-iterations.md, demo-script.md, future-state.md, handoffs/,
             archive/ (SPEC v1, cost addendum, product direction; provenance only)
prompts/     final-diligence-prompt.md, company-intelligence-prompt.md, versions/
scripts/     ingestion/, indexing/, intelligence/ (offline profile build, never deployed), evaluation/
examples/    ready-to-run example request + sample output
evals/       questions.yaml, profiles.yaml, results/
seed/        demo workspace seed (real pipeline outputs)
apps/web/  packages/{core,corpus,rag}/  services/api/  infrastructure/cdk/
tests/       e2e/, fixtures/
```

## 43.2 README

The README must explain:
- what DiligenceIQ is and the business value, in brief;
- prerequisites;
- AWS setup;
- environment variables;
- corpus placement (`CORPUS_PATH`);
- ingestion and indexing;
- the offline profile build and the §35.7 exception, stated plainly;
- local run;
- deployment;
- running evaluations;
- resetting demo data;
- the example request (§43.3);
- an architecture summary, with links to the design documents.

## 43.3 Example request

`examples/` holds a request **ready to execute** against the production URL (for example `examples/analysis-request.sh`): it creates an analysis, polls until it completes, and prints the brief, plus a recorded sample output. It must run to COMPLETE against production (Phase 8 exit criterion).

---

# 44. Demo flow and business story

## 44.1 Demo flow

The interview demo is a client meeting. The flow:
1. Open DiligenceIQ.
2. Explain the client problem.
3. Select Apple.
4. Show Company Intelligence.
5. Show What's Changed.
6. Show an Attention Signal.
7. Explain "Why this matters."
8. Show Recommended Diligence.
9. Click Investigate.
10. Transition into Deep Analysis.
11. Invite the panel to provide ANY business question.
12. Run live RAG.
13. Show structured Diligence Brief.
14. Open supporting evidence.
15. Save a finding.
16. Show Compare Companies.
17. Show Findings.
18. Briefly show Thesis / Watchlist vision.
19. Explain architecture.
20. Explain future-state expansion.

The panel's live, unknown question stays central. The offline plane and the engineering narrative get about one minute; business value and future state get their own segment. Step 18 shows the built Thesis and Watchlist if Phase 8b landed, otherwise their vision on the Architecture page. The script lives in `docs/demo-script.md`, with fallbacks for live failures.

## 44.2 Business story

The presentation communicates: general-purpose AI tools are good at answering questions when the user knows what to ask. DiligenceIQ solves the problem before that. It: tells investors what is happening; identifies what changed; identifies what deserves attention; explains why it matters; suggests what should be investigated; supports deep, arbitrary research; proves conclusions with source evidence; preserves important findings; allows investors to compare companies; can eventually track investment theses; can proactively alert investors when new evidence matters.

This story, with the differentiation in §3.4, appears on the Architecture and business-value page and in the demo script.

---

# 45. Future state

Do not implement all of this. Document it in `docs/future-state.md` and on the Architecture page, and show how the initial SEC solution expands:

```text
Phase 1 — Public Company Intelligence (built now)
SEC filings · Company Intelligence · Compare · Deep Analysis · Findings
(Thesis, Watchlist with historical events, IC Brief: P1)

        ↓

Phase 2 — Live monitoring
EventBridge → SEC check → ingestion → index update → change detection
→ watch match → intelligence events → SNS / email notifications

        ↓

Phase 3 — Deal Room Intelligence
CIMs · QoE reports · financial models · contracts · management presentations

        ↓

Phase 4 — Investment Committee Workflow
collaboration · approvals · memo workflows · diligence ownership

        ↓

Phase 5 — Portfolio Intelligence
KPI monitoring · new-filing alerts · covenant risk · operating signals · portfolio benchmarking
```

**Scenario intelligence** is future state. Do NOT prioritize traditional forecasting for the assessment, and do NOT generate unsupported price targets or precise future financial forecasts. A future capability could answer questions such as:

> What areas of the company appear most exposed if demand weakens?

> What disclosures suggest could happen if export restrictions expand?

Eventually, with additional data and financial modelling, base, upside, and downside cases may be supported.

Make clear what is: built now; the logical next step; the longer-term future state.

Do not pretend future-state capabilities already exist. This matters because the assessment explicitly expects the candidate to explain what comes next if the client is sold on the RAG solution.

---

# 46. Development philosophy

Priority order:

> Correctness → Reliability → Retrieval quality → Business usefulness → UX polish → Additional features

Do not sacrifice the first four to add more functionality. A smaller product that works flawlessly is better than a larger product with broken flows.

Do not ask preference questions when this specification already gives enough information to make a sensible engineering decision. Favor execution over unnecessary clarification, but ask Eliza when the assessment itself is unclear (§1.2).

"Impressive" means: a product that looks commercially credible, handles the panel's unknown question successfully, shows strong RAG engineering, makes every important claim verifiable, gives value before a question is asked, and gives an obvious business narrative for what to build next. It does not mean feature count.

---

# 47. Sub-agent strategy

Use specialized sub-agents to reduce development time and improve quality. The coordinating agent owns overall architecture and integration.

| Role | Responsible for |
|---|---|
| Product / UX | workflows; IA and navigation; plain-language copy; enterprise design; accessibility; loading, error, and empty states |
| RAG / data | corpus parsing; chunking; metadata; embeddings; retrieval; context construction; citation mechanics; financial extraction; change detection; profile build |
| Backend / AWS | APIs; DynamoDB; AWS SDK; observability; IAM; deployment; IaC; cost guard |
| Testing | unit and integration tests; Playwright; fixtures; evaluation harness (Deep Analysis and profiles) |
| Documentation | README; architecture docs; decision records; evaluation documentation; demo and future-state material |

Agents may work concurrently **only when their files or responsibilities do not create unsafe conflicts**. The coordinating agent integrates and tests their work.

---

# 48. Mandatory phase quality gate

**THIS PROCESS IS NON-NEGOTIABLE.**

## 48.1 Sequence

At the completion of **every phase**, follow this exact sequence (SPEC v1 §36 as adapted by DD-12):

1. Implementation.
2. Tests.
3. **Fresh adversary agent** → adversary report.
4. **Fresh fixer agent** fixes the findings, adds regression tests, and reruns them.
5. Regression tests.
6. `/code-review`.
7. **Fix all code-review findings.**
8. `pnpm gate`.
9. `/handoff`, plus `docs/handoffs/phase-XX.md`; the commit waits for Mike's go-ahead.
10. Next phase.

Do not proceed to the next phase until the current phase completes the entire gate.

## 48.2 Adversary

After each phase, launch a fresh adversary agent that did **not** perform the primary implementation. Its job is to actively try to prove the phase is wrong. It inspects:
- requirements compliance (against this specification and the PDF);
- architectural mistakes;
- broken interactions;
- edge cases;
- incorrect assumptions;
- security weaknesses;
- accessibility;
- UX inconsistencies;
- performance problems;
- AWS failure modes;
- incomplete tests;
- fake or hardcoded data;
- RAG grounding issues where relevant;
- cost: anything generated or running unnecessarily.

It also asks:
- Does the product provide value before the user asks a question?
- Would someone unfamiliar with SEC filings understand the interface?
- Does the dashboard actually tell the user what matters?
- Are signals evidence-backed?
- Does "Why This Matters" educate rather than overclaim?
- Are recommended diligence questions genuinely useful?
- Does Compare add insight rather than duplicate data?
- Is Deep Analysis still capable of answering the panel's arbitrary question?
- Is anything being generated unnecessarily and increasing cost?
- Does this feel like an investment-intelligence product rather than a RAG demo?

The installed `adversary` agent is read-only by design. So, per DD-12, findings are fixed by a **fresh general-purpose fixer agent** with no implementation context. The fixer:
1. takes the prioritized findings;
2. **fixes them**;
3. adds regression tests where appropriate;
4. reruns the relevant tests;
5. summarizes exactly what was changed.

No agent approves its own original work.

## 48.3 Code review

After the fixer's changes, run `/code-review` over the full diff for the phase. Fix every: blocker; correctness problem; security concern; reliability issue; meaningful maintainability concern.

Also fix reasonable medium-severity issues when doing so does not cause unnecessary scope expansion. Rerun relevant tests. If fixes materially changed the implementation, rerun `/code-review` until no blocking issue remains.

## 48.4 Gate command

`pnpm gate` must pass. In Phase 0 and 0b it runs `scripts/check-docs.mjs`. From Phase 1 it is `pnpm lint && pnpm typecheck && pnpm test && pnpm cdk:synth && pnpm build`, plus the docs check.

## 48.5 Handoff

Once implementation, adversary review, fixes, code review, code-review fixes, and tests are complete, run `/handoff`. It captures: completed functionality; architecture decisions; files changed; tests executed; current deployment status; unresolved risks; known limitations; important context for the next phase; the exact next-phase objective.

Also save equivalent persistent notes under `docs/handoffs/phase-XX.md`, so the next phase does not depend solely on conversational context. The commit waits for Mike's go-ahead. **Only then begin the next phase.**

---

# 49. Development phases

Phases run in table order. Every phase ends with the §48 gate. Phase 8b (P1) runs after Phase 8 and before Phase 9, and only once the Phase 7 and Phase 8 exit criteria pass. Full detail, risks and verification: `docs/implementation-plan.md`.

| # | Deliverables | Exit criteria (in addition to the gate) |
|---|---|---|
| 0 | Discovery, repository and corpus inspection, architecture baseline: architecture, assumptions, design decisions, design tokens, testing strategy, implementation plan. No feature implementation. | Done (`9a7a764`) |
| 0b | Re-baseline on investment intelligence: DD-15 to DD-19; design-doc updates; adversary review against both specifications; this consolidated SPEC v2, with v1, the cost addendum and the product direction archived | No assessment requirement lost (§51.4 checklist); `pnpm gate` passes; docs-only commit |
| 1 | Application shell and design system on the new IA, **P0 routes only**: navigation (Company Intelligence, Compare, Deep Analysis, Findings) + global "Ask a question"; company selector and dashboard; Compare; Deep Analysis input (editable prefill, never auto-submits) and brief page; Findings; static Architecture page; landing. Reusable cards, tables, dialogs, drawers, buttons, badges, skeletons, empty and error patterns, responsive layout. Profile schema; themes; finding origin and source types. Fixture profiles for AAPL, MSFT, NVDA with **no figures and no narrative presented as fact**. CDK stacks, cost guard, api service. **Not built:** Thesis, Watchlist, IC Brief, Sources explorer (omitted from the nav, no stubs). | Full gate green; fixture-figure test; prefill-no-POST test; shell live on `diligenceiq.mikemiller.ai`; the Amplify rewrite forwards `Set-Cookie` |
| 2 | Verify Bedrock invoke entitlement. Corpus ingestion: zip or directory input, manifest, headers, periods, overrides, preamble, sections, boilerplate; chunking; cached, resumable embeddings; S3 index, adjacency file, **index summary**; repeatable indexing CLI and index validation. **Time-boxed:** deterministic financial extraction, risk headings, drivers, per-company coverage | Header and period tests over all 246 files; section tests on representative filings (AAPL 10-K, NVDA 10-Q, JNJ 10-Q, XOM 10-Q, MS 10-K); the 287,855-character line; index summary recorded in the handoff; cold index load measured; extraction golden tests (AAPL, NVDA, MSFT, JNJ, XOM) |
| 3 | Deterministic query analysis (companies, periods, filing types, topics); planner and lanes; hybrid search; balanced multi-company and longitudinal retrieval; deduplication; context builder; citation IDs; retrieval debug endpoint; retrieval evals on 15–20 questions covering every §41.1 category, including the three PDF examples and the expert question verbatim. **Time-boxed:** deterministic change detection and signal candidates | Multi-company queries do not collapse onto one company; chunk size, embedding and rerank decisions recorded; **signal go/no-go** recorded on the hand-labeled set (failing types suppressed); heading-diff viability recorded |
| 4 | One-call generation pipeline: Deep Analysis prompt v1; `GenerationGateway`; schema, citation and numeric validation; SQS worker with claim, deadlines, generation budget, DLQ handler; real prompt iterations logged | `generationCallCount === 1` on success, error, malformed output, duplicate delivery, and redelivery after a claim; worker constructs only `purpose: 'analysis'`; temperature with forced tool use verified; latency measured |
| 4b | Offline Company Intelligence build (§32), after the question is put to Eliza: builder, profile prompt, validator with the banned list, General context library, **both profile sets**, build ledger, SSM pointer, manifests, profile prompt iterations. If this slips, ship the deterministic set only | Every company has a schema-valid profile in both sets; 0 invalid citations; 0 unsupported figures; 0 banned-phrase matches; ≤ 1 call per profile per the ledger; fallback rate ≤ 10% (provisional); prompt file matches runtime; profile evals recorded |
| 5 | Product workflows: sessions, seed (real pipeline outputs), reset; spend caps and kill switch; Company Intelligence on real profiles; Compare; Recommended Diligence / Investigate prefill (never auto-run); Deep Analysis with real stages, Interpretation panel, coverage matrix and numeric badges; Save Finding from any source; Findings Board; error and degraded states | **Novice path** (select Apple → understand → Investigate → Deep Analysis → save) and **expert path** (typed question) run end to end with no broken steps; no LLM call on any page view (test); every §38.2 state has a test |
| 6 | Evidence: clickable citations; evidence drawer for briefs and signals with **adjacent-period comparison**; deep-link passage highlight; readable source view; coverage matrix linked to evidence; citation-integrity tests | Every citation in seeded briefs, live briefs, and profiles resolves to its passage; adjacent-period lookup tested on AAPL and JNJ |
| 7 | Evaluation, security, reliability, observability: eval harness and `docs/evaluation.md` (Deep Analysis and profiles); unsupported-query and injection tests; structured logging, request IDs, 14-day retention, metric filters; input validation; security headers and CSP; IAM review; accessibility and performance review; cost telemetry; **Architecture and business-value page** with measured numbers | Full regression green; eval results recorded; the Architecture page shows only measured numbers |
| 8 | AWS production deployment and hardening: DNS, HTTPS, production environment variables, Bedrock access, index connectivity, DynamoDB, S3, logs, error behavior, anonymous sessions; alarms; Budget alert; profile build against the production index; **README** (§43.2) and **`examples/`** (§43.3); Playwright smoke tests **against the production URL**, not just localhost | Production validation; profiles loaded for all 54 companies; the example request runs to COMPLETE against production |
| 8b (P1) | Gated on the Phase 7 and 8 exit criteria: Thesis; Watchlist with historical filing and intelligence events and the future-state monitoring panel; per-company Diligence Gaps matrix; IC Brief and print mode; filing explorer; Analysis Audit Trail; Thesis and Watchlist added to the navigation and the seed | No model client reachable from these handlers (test); no verdicts; caps and ticker validation tested; P0 regression still green |
| 9 | Interview polish, treated as a product launch: full UX review; `docs/demo-script.md` (§44); `docs/future-state.md` (§45); final README pass; final adversary (§50) | Definition of done (§51); complete production regression |

**Phase 9 polish checklist:** no placeholder text; no Lorem Ipsum; no broken links; no fake controls; no debug UI; no console errors; no layout shift; no obvious loading flash; no unhandled errors; no malformed citations; no inconsistent terminology; no hardcoded demo answer; no SEC jargon on primary screens; mobile and tablet acceptable; desktop excellent.

**Scope fallback,** in order of protection when time runs short (the PDF timebox is about four hours of core work):
1. Core RAG quality first. The Phase 2 and 3 intelligence additions are time-boxed and never delay core ingestion, retrieval, and evaluation. If they cannot land, the dashboard shows facts, current risks, and recommended diligence only.
2. If Phase 4b slips, ship deterministic-only profiles.
3. If signal quality misses the Phase 3 bar, the failing signal types are suppressed.
4. P1 (Phase 8b) is cut before any P0 item is weakened.

---

# 50. Final adversary review

After all phases, launch one **fresh final adversary agent**. Give it this specification, the assessment PDF, and the archived source documents, and ask:

> Assume you are a skeptical Eliza FDE interview panel consisting of a private-equity client stakeholder, AI product manager, senior FDE, software engineer, and business leader. Try to find every reason this implementation would fail the assessment or feel unready for a real client.

It must evaluate:
- **Assessment compliance**, especially one-call generation and the PDF deliverables (§1.3).
- **Technical quality**, especially retrieval.
- **Product usefulness:** does this actually improve diligence? Does it give value before a question?
- **Enterprise UX:** would a sophisticated client take it seriously?
- **Trust:** can every conclusion be traced?
- **Demo risk:** what could break live?
- **Cost:** does anything run or generate unnecessarily?
- **FDE signal:** does the implementation show client understanding, pragmatic architecture, business value, and future expansion?
- **The final product test** (§51.3), including the 60-second novice test.
- **The requirement-preservation checklist** (§51.4).

Per §48.2, a fresh fixer agent fixes the appropriate findings. Then run `/code-review`, fix the issues, run the complete production regression suite, and run `/handoff`.

---

# 51. Definition of done

The project is not finished merely because it compiles.

## 51.1 Product and engineering

It is finished when:
- arbitrary questions work, typed into an input field;
- retrieval is strong;
- multi-company questions work;
- multi-year questions work;
- sector questions work;
- one and only one generative model call produces each answer;
- a prefilled Deep Analysis never runs without an explicit Run;
- citations are real and validated;
- evidence is inspectable, including adjacent periods and the readable source view (source browsing in P0);
- Company Intelligence works for every corpus company, with no LLM call on page view;
- What's Changed, Attention Signals, Why This Matters, and Recommended Diligence are evidence-backed;
- Compare works;
- the brief shows the Interpretation panel, coverage matrix, and numeric-grounding badges;
- saving findings works from every source;
- the Findings Board works;
- the Architecture and business-value page shows measured numbers only;
- the application is visually polished;
- errors are graceful;
- production AWS deployment works;
- the live URL works;
- the example request runs to COMPLETE against production;
- required documentation exists;
- prompt history exists for both prompts;
- evaluation notes exist;
- tests pass;
- production smoke tests pass;
- no important adversary issue remains;
- no blocking code-review issue remains.

**P1, if Phase 8b landed** (otherwise documented in the future-state material and not claimed in the demo):
- the IC Brief works;
- the filing explorer works;
- Thesis works;
- the Watchlist works, with historical filing and intelligence events;
- the per-company Diligence Gaps matrix and the Analysis Audit Trail work.

## 51.2 Cost

The project is not complete until:
- there is no unnecessary always-on application compute;
- live RAG generation occurs only in response to user analysis; the only other generation is the offline profile build under the §35.7 exception, within its bounds;
- document embeddings are reused;
- Company Intelligence profiles are reused and never generated on page view;
- application state uses usage-based persistence where practical;
- log retention is explicitly configured;
- idle infrastructure cost is documented;
- major cost drivers are documented;
- the architecture can be explained clearly during the interview.

## 51.3 Final product test

Give DiligenceIQ to a user who has never heard of:
- a 10-K;
- a 10-Q;
- Item 1A;
- MD&A.

Have them select Apple. Within 60 seconds they should be able to answer:
- How is Apple performing?
- What has changed?
- What appears to deserve attention?
- Why might those things matter?
- What should they investigate next?

Then an expert should be able to ask:

> How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?

and receive a rigorous, evidence-backed answer from the same product.

If both users can succeed, DiligenceIQ is solving the right problem.

## 51.4 Requirement-preservation checklist

Checked by the Phase 0b adversary and again by the final adversary (`docs/implementation-plan.md`):

| Item | SPEC v2 |
|---|---|
| Any natural-language question typed into an input field; the panel's question answered live | §2.1, §5.2, §14 |
| Single-company, multi-company, longitudinal, sector questions; the 3 PDF examples in the evals verbatim | §2.1, §27.2, §41.1 |
| Eval set covers every category (single-company, multi-company, longitudinal, risk, revenue, regulatory, cross-sector, unsupported, ambiguous, injection) | §41.1 |
| Exactly one generative call per analysis, proven at every layer; no LLM rewriting, planning, critique, repair, summarizer, or runtime judge | §2.1, §30, §31 |
| A prefilled Deep Analysis never auto-submits (E2E test) | §2.2, §14.2 |
| Offline profile build follows the dated override and its limits; the deterministic set and pointer exist | §32, §35.7 |
| Citations only reference supplied chunks, validated server-side; every claim inspectable | §16, §31 |
| No hardcoded demo answers; seeds and profiles from real outputs; numbers only from extraction; fixture rule; General context the only hand-written explanatory text | §2.2, §9, §32.7, §40 |
| Deliverables: README, indexing and retrieval code, index summary, prompt log, final prompt, frontend, `examples/` request, evaluation notes | §1.3, §24.4, §42, §43 |
| Real loading stages; every v1 error state plus the new IA states; security; anonymous server-side workspace with scoped reset | §38, §39, §40 |
| Scale to zero: no always-on compute, no schedules, explicit retention, no LLM call on page view, embeddings and profiles reused | §35, §51.2 |
| Business value and future state presented | §18, §44, §45 |
| Gate per phase | §48 |

---

# 52. Scope discipline

When choosing between **another feature** and **making an existing core workflow excellent**, choose excellence.

Highest-priority experiences, in order:

> Live question (Deep Analysis) → Excellent retrieval → Excellent grounded brief → Excellent evidence inspection → Save meaningful finding

and, beside it:

> Select a company → Understand it in 60 seconds (Company Intelligence) → Notice what changed and why it matters → Investigate → Deep Analysis

Rules:
- P0 (§6.1) before P1 (§6.2). P1 starts only after the Phase 7 and 8 exit criteria pass, and is cut before any P0 item is weakened.
- P2 (§6.3) is documentation only.
- Do not build chat history or agent swarms (they conflict with §5.6 and §2.1), nor notifications, Slack, email, CRM integration, sophisticated user administration, collaboration comments, PDF export, elaborate portfolio dashboards, or external market-data APIs. Those belong in future state (§45).
- Follow the scope fallback order in §49.

---

# 53. Product principle

At every major decision, ask:

> Does this make DiligenceIQ better at helping an investment team understand a company, notice what matters, and reach a defensible investment conclusion?

If not, do not prioritize it.

The panel should leave with the impression:

> "Mike didn't just build RAG. He understood the client's workflow, built the narrow solution we asked for, made it trustworthy, gave value before anyone asked a question, and could clearly see how to turn it into a larger client relationship."

---

# A. Changes from v1

Every SPEC v1 requirement either appears in this specification or is listed here with the reason. Changes to the cost addendum and the product direction are listed too.

## A.1 Changes to SPEC v1

| v1 § | v1 requirement | SPEC v2 | Reason |
|---|---|---|---|
| Mission, §4 | Question-first workflow: Research → Verify → Capture → Organize → Decide; Deal Workspace → Workstream → Ask | Investment intelligence first: Understand → Notice → Investigate → Verify → Capture → Monitor → Decide; Deep Analysis is the drill-down (§1, §3, §5) | Product direction pivot (DD-15): users get value before they know what to ask. The v1 journey is contained in the new one. |
| §2 | Descriptor "AI Investment Diligence Workspace"; promise "Turn SEC filings into evidence-backed investment decisions" | Category "Investment Intelligence"; message "Know what changed…"; v1 promise kept as supporting copy (§3.2) | Product direction §2. |
| §5 | Nav: Overview, Diligence, Findings, IC Brief, Sources; global "+ New Analysis" | Nav: Company Intelligence, Compare, Deep Analysis, Findings (+ Thesis, Watchlist in Phase 8b); global "Ask a question"; Architecture, Sources, IC Brief secondary (§5.2) | DD-15. Thesis and Watchlist are omitted until built (no stubs). |
| §6 | Deal Overview for the seeded "Project Atlas" engagement, with a workstream progress tracker | Retired. Company Intelligence is the primary page (§8). The "all statistics from real data" rule is kept (§2.2). | DD-15: the engagement framing made the product question-first; the PE story moves to the landing, Architecture page and demo script. |
| §7 | Diligence Workstreams page with suggested questions | Workstreams become the six **finding themes** (§17.3); suggested questions are replaced by Recommended Diligence, signal and Compare questions generated from evidence (§10–13) | DD-15: questions grounded in the company's evidence beat a static list. Prefilled questions stay editable (§14.2). |
| §8 | "New Analysis" with a Workstream selector | "Deep Analysis" (§14); no workstream selector; origin recorded as provenance | Workstreams retired; same RAG requirements. |
| §9 | Brief schema with model-written `citations[]` | `answerType`, `basis`, `tickers`, comparison `kind` added; `citations[]` is server-derived from valid inline IDs; output via forced tool use (§15) | DD-07: fewer fabrication surfaces and fewer malformed outputs. |
| §9 | Brief interface | Adds Interpretation panel, coverage matrix, numeric-grounding badges, validation notices (§15.2) | Stricter evidence presentation; P0 per the implementation plan. |
| §10 | Evidence drawer | Adds adjacent-period comparison and deep-link with passage highlight (§16.2); evidence snapshots (§16.4) | Product direction §16; DD-06. |
| §11–12 | Finding field `workstream`; filter by workstream | Field `theme`, plus `origin`; filter by theme and origin; findings saved from any source (§17) | DD-15. |
| §13 | IC Brief (core) | **P1**, built in Phase 8b; if 8b does not land, documented and not claimed (§22) | Product direction §29 makes it P1. |
| §14 | Source / Filing Explorer (core) | Source browsing in P0 is the readable filing view from every citation; the standalone explorer is **P1** (§16.2, §23.1) | Product direction §29. |
| §15 | Input `data/edgar_corpus.zip` | `CORPUS_PATH` (directory or zip) (§24.1) | Environment-configurable; same intent. |
| §17 | "combine → rerank → deduplicate" | Rerank off by default (§2.1, §27) | Assumptions A1: a non-generative rerank call is treated as retrieval only by our extension of the rule; it is enabled only on a clear eval lift and disclosed. |
| §21 | Telemetry fields | All kept; adds analysis ID, embedding, rerank and retrieval counts, model, index version, cost estimate (§30.1) | Cost addendum's cost visibility. |
| §22 | Next.js server-side API; OpenSearch | Static Next.js export on Amplify + Lambda API + async SQS worker; pre-built hybrid index in S3 (§34, §35.3) | Cost addendum (OpenSearch has idle cost; DD-01); request-time limits on long generations (DD-02, DD-03). |
| §23 | Stack lists OpenSearch | OpenSearch removed; SQS, Lambda, SSM, CDK assertions added (§36) | Same as above. |
| §24 | "Avoid neon AI gradients"; understated palette | Kept; the Evidence system's restrained brand gradient is allowed only in its listed uses (§37) | Design tokens (Mike's brand kit). Neon "AI" gradients remain banned. |
| §25 | CTAs "Open Project Atlas", "View Architecture" | "Open Company Intelligence", "Ask any question", "How it works" (§7) | Project Atlas retired. |
| §26 | Example loading stages | Kept and extended to the worker's real stages, including the cold index load (§38.1) | Stages must match execution. |
| §27 | Error states | All kept (OpenSearch unavailable → search index unavailable) plus new IA states (§38.2) | Architecture §9.1. |
| §28 | Throttling "if practical" | Required: kill switch, daily, workspace and creation caps (§35.11, §39) | Public demo spend (DD-13); stricter. |
| §29 | Demo workspace seeded as Project Atlas | Anonymous workspace kept; seed is real pipeline outputs; Project Atlas framing retired (§40) | DD-09, DD-15. |
| §30 | 12–20 evaluation questions | 15–20, plus the three PDF examples and the expert question verbatim; profile evals added (§41) | Implementation plan; covers every category with margin. |
| §31 | One prompt log for the final prompt | Both prompts logged; profile prompt stored too (§42) | The offline profile prompt is a second prompt. |
| §32 | Repository documentation | Adds design tokens, implementation plan, testing strategy, archive, `scripts/intelligence`, `examples/`, `evals/`, `seed/`; README adds corpus placement, profile build and exception disclosure; "example API request" becomes `examples/` (§43) | PDF deliverable "an example request ready to execute". |
| §33 | Future state, four phases | Live monitoring inserted as the next phase; scenario intelligence added (§45) | Product direction §19–21. |
| §36–37 | Adversary fixes its own findings | Read-only adversary report, then a fresh fixer agent fixes, adds regression tests and reruns (§48) | DD-12: the installed adversary agent is read-only; intent preserved (no agent approves its own work). |
| §36 | Gate sequence | Adds the product questions (§48.2) and `pnpm gate` (§48.4) | Product direction §35; CLAUDE.md. |
| §40 | Phases 0–9 | Phases 0, 0b, 1–4, 4b, 5–8, 8b, 9 (§49) | Implementation plan Revision 2. v1 phase content is kept inside the new phases (shell, ingestion, retrieval, generation, workflows, evidence, evaluation, deployment, polish). |
| §40 | Phase 1 builds Overview, Diligence, Findings, IC Brief, Sources, New Analysis | Phase 1 builds P0 routes only; Thesis, Watchlist, IC Brief, Sources explorer are omitted (§49) | Scope discipline; no stub pages. |
| §40 | Phase 9 13-step demo sequence | 20-step flow (§44.1) | Product direction §25. |
| §41 | Final adversary given "the entire original requirements document" | Given SPEC v2, the PDF, and the archived sources; adds cost, product test and checklist (§50) | v2 is canonical; archives keep v1 reviewable. |
| §42 | Definition of done | Kept, with P1 items marked; cost DoD and product test added (§51) | Cost addendum; product direction §36. |
| §43 | "Do not build" list | Rewritten for P0/P1/P2 (§52, §6.3) | Product direction §28–30. |
| §44 | Product principle | Adds "understand a company, notice what matters" and value before a question (§53) | Product direction §1, §3. |
| trailing note | "Do not start implementing immediately… return a concise Phase 0 plan" | Phase 0 is done; the guidance against unnecessary preference questions and the meaning of "impressive" are kept (§46) | Historical instruction already carried out. |

## A.2 Changes to the cost addendum

| Addendum text | SPEC v2 | Reason |
|---|---|---|
| "incur meaningful inference cost only when a user actually performs an analysis;" | Kept, with the named exception (§35.1, §35.7) | Mike's dated choice of the offline profile build (DD-16), bounded and withdrawable. |
| "avoid LLM calls merely to populate dashboards;" | Kept, with the named exception (§35.6, §35.7) | Same. Runtime page views still never call an LLM. |
| "RAG generation occurs only in response to user analysis;" (cost DoD) | "Live RAG generation occurs only in response to user analysis; the only other generation is the offline profile build under §35.7" (§51.2) | Same. |
| "AWS Amplify / serverless Next.js hosting where appropriate" | Amplify static export (§34, §35.2) | DD-02. |
| Everything else | Restated in §35 | No change. |

## A.3 Changes to the product direction

| Product direction | SPEC v2 | Reason |
|---|---|---|
| §4, §31: nav includes Thesis and Watchlist | They join the nav in Phase 8b; omitted until built (§5.2) | P1 scope; no stubs (DD-15). |
| §4: no global question action named | Global "Ask a question" on every page (§5.2) | Preserves v1's global action and §32's expert bypass. |
| §9: "Track" button | Defined: save as a finding (P0); watch the category (P1) (§11.1) | The direction did not define it. |
| §11, §14: recommendations launch Deep Analysis | Prefill only; never auto-submits (§2.2, §14.2) | A URL must never trigger a generation call. |
| §13: example comparison table with values | Illustrative only; every value derived (§13.2) | The direction itself requires evidence-derived values. |
| §15: Diligence Gaps (P1) | Per-company matrix stays P1; the brief-level coverage matrix and gaps are P0 (§15, §19) | Implementation plan priorities. |
| §19: Watchlist "New SEC filings" | Historical filing events from the catalog; live polling is P2 (§21) | No schedules (§35.9). |
| §22: "generate profile intelligence only when data changes or explicit refresh occurs" | Refresh is an admin-run version bump; no `--force` (§32.5) | Build ledger bound (DD-16). |
| §23: one structured call per company | Plus the zero-call deterministic set, the SSM pointer, the ledger, the banned list (§32) | Bound and withdraw the exception; the PDF does not state that a build-time call is acceptable (assumptions A6). |
| §23: profile field list | Expanded schema with facts, drivers, current risks, `evidenceByPeriod`, generation metadata (§32.8) | Every figure needs a source row; every signal needs evidence per period. |
| §29: Query Interpretation, Evidence Coverage Matrix, numeric grounding, architecture/value page listed as P1 | **P0** (§6.1, §15, §18) | Interpretation and coverage keep the live answer honest; the value page is a PDF requirement ("information on how this creates value for the business"). |
| §29: historical intelligence events, Analysis Audit Trail | P1 (§21, §23.2) | Unchanged priority; the audit trail is defined. |
| §33: process to update the plan and consolidate | Done in Phase 0b (§49) | Historical. |
| §34: relationship to SPEC.md, precedence rules | Replaced by §1.2 | This consolidated specification is canonical. |
| §35: quality gate | Kept (§48) | No change. |

---

# B. Section map

## B.1 SPEC v1 → SPEC v2

| v1 § | v1 title | v2 § |
|---|---|---|
| Mission | Mission | §1.1 |
| 1 | Non-negotiable assessment requirements | §2.1 |
| 2 | Product positioning | §3.2 |
| 3 | Primary user | §4 |
| 4 | Core product experience | §5.1 (A.1) |
| 5 | Application navigation | §5.2 |
| 6 | Feature 1 — Deal Overview | §8 (retired; A.1) |
| 7 | Feature 2 — Diligence Workstreams | §17.3, §12 (A.1) |
| 8 | Feature 3 — New Analysis | §14 |
| 9 | Feature 4 — Diligence Brief | §15 |
| 10 | Feature 5 — Evidence and citations | §16 |
| 11 | Feature 6 — Save Finding | §17.1 |
| 12 | Feature 7 — Findings Board | §17.2 |
| 13 | Feature 8 — IC Brief | §22 (P1) |
| 14 | Feature 9 — Source / Filing Explorer | §16.2, §23.1 (P1) |
| 15 | RAG ingestion architecture | §24 |
| 16 | Chunking | §25 |
| 17 | Retrieval design | §27 |
| 18 | Deterministic query analysis | §26 |
| 19 | Context builder | §28 |
| 20 | Final prompt requirements | §29 |
| 21 | Single-call enforcement | §30 |
| 22 | AWS architecture | §34 |
| 23 | Recommended implementation stack | §36 |
| 24 | Enterprise UX requirements | §37 |
| 25 | Landing experience | §7 |
| 26 | Loading states | §38.1 |
| 27 | Error handling | §38.2 |
| 28 | Security and production considerations | §39 |
| 29 | Demo mode | §40 |
| 30 | Evaluation framework | §41 |
| 31 | Prompt iteration log | §42 |
| 32 | Required repository documentation | §43 |
| 33 | Future-state story | §45 |
| 34 | Development philosophy | §46 |
| 35 | Sub-agent strategy | §47 |
| 36 | Mandatory phase quality gate | §48.1 |
| 37 | Adversary agent instructions | §48.2 |
| 38 | Code review gate | §48.3 |
| 39 | Handoff gate | §48.5 |
| 40 | Development phases | §49 |
| 41 | Final adversary review | §50 |
| 42 | Definition of done | §51.1 |
| 43 | Scope discipline | §52 |
| 44 | Important product principle | §53 |
| trailing | One additional instruction | §46 (A.1) |

## B.2 Cost addendum → SPEC v2

| Addendum section | v2 § |
|---|---|
| Opening ("The architecture should:") | §35.1 |
| Cost-control principle | §35.1 |
| Preferred service characteristics | §35.2 |
| Search / vector retrieval cost requirement | §35.3 |
| Separate offline and online costs | §35.4 |
| DynamoDB | §35.5 |
| Bedrock | §35.6, §35.7 |
| Observability cost controls | §35.8 |
| No unnecessary scheduled workloads | §35.9 |
| Cost visibility | §35.10 |
| Architecture documentation ("Cost and Scaling Strategy") | §35.14 |
| Cost-related Definition of Done | §51.2 |

## B.3 Product direction → SPEC v2

| Product direction § | Title | v2 § |
|---|---|---|
| Purpose | Purpose and non-negotiables | §1.2, §2 |
| 1 | Revised Product Thesis | §3.1 |
| 2 | Revised Positioning | §3.2 |
| 3 | Primary Product Principle | §3.3 |
| 4 | Revised Navigation | §5.2 |
| 5 | Company Intelligence — P0 | §8.1–8.2 |
| 6 | Company Intelligence Dashboard (30-Second View) | §8.3–8.4 |
| 7 | Performance Intelligence — P0 | §9 |
| 8 | What's Changed — P0 | §10 |
| 9 | Attention Signals — P0 | §11.1 |
| 10 | "Why This Matters" — P0 | §11.2 |
| 11 | Recommended Diligence — P0 | §12 |
| 12 | Deep Analysis / RAG — P0 | §14 |
| 13 | Company Comparison — P0 | §13 |
| 14 | Compare — Key Differences | §13.1 |
| 15 | Diligence Gaps — P1 | §19 |
| 16 | Evidence — P0 | §16 |
| 17 | Findings — P0 | §17 |
| 18 | Thesis Intelligence — P1 | §20 |
| 19 | Watchlist — P1 / Future-State Bridge | §21.1, §21.3 |
| 20 | Intelligence Event vs Filing Event | §21.2 |
| 21 | Scenario Intelligence — Future State | §45 |
| 22 | Cost Control | §35.13 |
| 23 | Company Intelligence Generation Strategy | §32.1, §32.5, §32.8 |
| 24 | Deterministic vs Generative Responsibilities | §32.2 |
| 25 | New Primary Demo Flow | §44.1 |
| 26 | Revised Business Story | §44.2 |
| 27 | Revised Competitive Differentiation | §3.4 |
| 28 | P0 — Must Be Excellent | §6.1 |
| 29 | P1 — Strong Differentiators | §6.2 (A.3) |
| 30 | P2 / Future State | §6.3 |
| 31 | Navigation and UX Update | §5.2, §5.5 |
| 32 | Product Accessibility Principle | §5.4 |
| 33 | Update Existing Implementation Plan | §49 (Phase 0b, done) |
| 34 | Relationship to SPEC.md | §1.2 (replaced) |
| 35 | Mandatory Quality Gate | §48 |
| 36 | Final Product Test | §51.3 |

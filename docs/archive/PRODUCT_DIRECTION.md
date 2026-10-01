> Archived 2026-10-01. Superseded by the consolidated SPEC.md (v2); kept verbatim for provenance.

# DiligenceIQ — Revised Product Direction

> Provided verbatim by Mike on 2026-10-01. The text arrived in two parts split inside §23; they are rejoined here. In §23–36, only the markdown formatting (heading markers, list bullets and the closed code fence) was restored to match §1–22. The wording is unchanged.

## Purpose

This document changes the PRODUCT DIRECTION of DiligenceIQ.

It does NOT replace the technical requirements in `SPEC.md` unless explicitly stated here.

The following remain non-negotiable:

- The Eliza assessment requirements.
- The supplied SEC filing corpus.
- Support for an unknown natural-language business question.
- Retrieval-augmented generation.
- Exactly ONE final generative LLM request for each Deep Analysis.
- Evidence grounding and citation validation.
- Production-quality AWS deployment.
- Cost-controlled architecture that scales to near zero when idle.
- Evaluation, prompt history, README, retrieval/indexing code, example request, frontend, and quality notes.
- The existing adversary → fix → `/code-review` → fix → `/handoff` phase gate.

This document changes the product from a question-first RAG application into an investment-intelligence platform.

---

# 1. Revised Product Thesis

DiligenceIQ should NOT assume that the user:

- understands SEC filings;
- knows what a 10-K or 10-Q is;
- knows where to look;
- knows what questions to ask;
- knows which changes matter;
- knows how to interpret financial or risk disclosures.

The existing product direction places too much burden on the user to formulate a good question before receiving value.

The revised product must provide useful intelligence BEFORE the user asks a question.

The product should answer:

1. What is happening with this company?
2. What changed?
3. What deserves my attention?
4. Why does it matter?
5. What should I investigate next?
6. How does this company compare with others?
7. What evidence supports these conclusions?
8. Has new information strengthened or challenged my investment thesis?

Deep Analysis / RAG remains essential, but it becomes the investigative drill-down layer rather than the primary product experience.

---

# 2. Revised Positioning

## Product

**DiligenceIQ**

## Category

**Investment Intelligence**

## Primary message

> Know what changed. Know what matters. Know what to investigate next.

## Product description

DiligenceIQ transforms complex company disclosures into understandable performance trends, risk changes, management signals, and evidence-backed areas of attention.

It helps investors understand a company without requiring them to already know how to analyze SEC filings.

When they need to investigate further, DiligenceIQ provides evidence-backed Deep Analysis over the underlying filings.

The product journey is:

**Understand → Notice → Investigate → Verify → Capture → Monitor → Decide**

---

# 3. Primary Product Principle

A user should receive meaningful value within seconds of selecting a company.

A blank question box must NOT be the primary experience.

The product should first tell the user:

> Here is what you should know.

Then:

> Here is what changed.

Then:

> Here is what deserves closer investigation.

Only then should the user need to ask a question.

---

# 4. Revised Navigation

Primary navigation should become:

- Company Intelligence
- Compare
- Deep Analysis
- Findings
- Thesis
- Watchlist

Sources may remain accessible through evidence/citation interactions and may optionally remain a secondary navigation destination.

IC Brief may remain as a downstream workflow feature, but should not be more prominent than Company Intelligence, Compare, Deep Analysis, Findings, Thesis, or Watchlist.

---

# 5. Company Intelligence — P0

Company Intelligence becomes the primary product experience.

The user selects a company:

`Apple (AAPL)`

DiligenceIQ immediately presents an understandable analysis without requiring a question.

The dashboard must answer:

- How is the company performing?
- What appears to be driving performance?
- What does management emphasize about the future?
- What risks deserve attention?
- What changed across filings?
- What areas are uncertain?
- What should the user investigate next?

The user should not need to know what Item 1A, MD&A, 10-K, or 10-Q means in order to use this page.

SEC terminology may appear in evidence/source views, but it should not dominate the primary experience.

---

# 6. Company Intelligence Dashboard

The dashboard should include the following sections.

## 6.1 30-Second View

Provide a concise executive-level summary.

Potential dimensions:

- Performance
- Growth
- Profitability / margins
- Outlook
- Liquidity / cash where appropriate
- Risk changes
- Regulatory attention
- Evidence coverage

Do not create unsupported investment ratings.

Avoid arbitrary scores such as:

- 82/100
- Strong Buy
- Low Risk
- Excellent Investment

Prefer descriptive signals:

- Accelerating
- Slowing
- Stable
- Improving
- Declining
- Increased attention
- New disclosure
- Persistent
- Limited evidence

Every material signal must be evidence-backed.

---

# 7. Performance Intelligence — P0

Surface useful financial trends automatically where the filing evidence supports them.

Examples:

- revenue;
- revenue growth;
- operating margin;
- gross margin;
- profitability;
- cash / liquidity;
- debt;
- capital spending.

The product should explain trends in simple language.

Example:

> Revenue continued growing, but the growth rate slowed from the previous period.

Not merely:

> Revenue: $X.

Where historical coverage allows it, show trends over multiple periods.

Do not fabricate missing metrics.

Do not force every metric onto every company.

---

# 8. What's Changed — P0

This should be one of the most prominent parts of Company Intelligence.

The product should automatically identify meaningful differences across filings.

Signal types may include:

### NEW
A meaningful disclosure/topic appears that was not present previously.

### EXPANDED
A topic receives materially more emphasis or detail.

### REDUCED
A previously prominent disclosure receives materially less emphasis.

### TREND CHANGE
A financial trend changes direction.

### OUTLOOK CHANGE
Management's language regarding growth, demand, investment, or headwinds changes.

### PERSISTENT
An issue remains material across multiple filings.

Example:

> Regulatory disclosure expanded in the latest filing.

> Export-control discussion appeared more prominently.

> Revenue growth slowed while margins improved.

Every change must include:

- plain-language description;
- evidence;
- relevant periods;
- ability to investigate further.

---

# 9. Attention Signals — P0

DiligenceIQ should proactively identify areas deserving investigation.

A signal means:

> Something changed or appears important enough to investigate.

A signal does NOT mean:

> The company is good or bad.

Possible categories:

- Performance
- Growth
- Margin
- Liquidity
- Debt
- Regulatory
- Competition
- Customer concentration
- Geographic concentration
- Supplier / supply chain
- Cybersecurity
- Litigation
- Management outlook

Each signal should contain:

- what was detected;
- why it deserves attention;
- evidence;
- period/company context;
- CTA to investigate.

Example:

**Regulatory Attention Increased**

> Recent filings devote more discussion to regulatory exposure than earlier filings.

**Why this matters**

> Greater regulatory exposure can affect costs, operating flexibility, or particular business lines. The important next step is understanding which areas of the business are exposed and how management is responding.

Buttons:

- Investigate
- View Evidence
- Track

---

# 10. "Why This Matters" — P0

This is critical.

DiligenceIQ must help users understand why a financial or disclosure signal deserves investigation.

This layer should educate without making investment decisions for the user.

Example:

Signal:

> Operating margin declined.

Why this matters:

> Declining operating margin means the company is retaining less operating profit from each dollar of revenue. The next step is determining whether this reflects temporary investment, pricing pressure, product mix, or structural cost increases.

Then:

**Investigate margin drivers →**

The system should bridge:

**information → understanding → investigation**

---

# 11. Recommended Diligence — P0

The user should not need to know the correct questions in advance.

For each company, DiligenceIQ should surface recommended areas/questions to investigate based on the evidence available.

Example:

### Recommended Diligence

1. Regulatory disclosure expanded.
   - Investigate which businesses/geographies may be affected.

2. Margin performance changed.
   - Investigate the drivers of the change.

3. Management increased emphasis on a growth area.
   - Determine how financially material it may be.

4. Customer concentration appears relevant.
   - Determine how concentrated revenue is.

Each recommendation should include:

- why it was suggested;
- supporting signal;
- clickable CTA.

Clicking a recommendation should prepopulate Deep Analysis.

The question remains editable.

---

# 12. Deep Analysis / RAG — P0

The existing arbitrary-question RAG system remains a core assessment requirement.

However, it is now positioned as:

**Deep Analysis**

not as the homepage.

Users may arrive here through:

- Recommended Diligence;
- Attention Signals;
- What's Changed;
- Compare;
- Thesis;
- Watchlist event;
- direct arbitrary question entry.

The user must still be able to type ANY supported natural-language business question.

The runtime path remains:

Question
→ deterministic query analysis
→ retrieval
→ balanced context
→ exactly ONE generative LLM request
→ structured Diligence Brief
→ validation
→ citations

Do not compromise the existing RAG requirements.

---

# 13. Company Comparison — P0

Add a first-class Compare experience.

Allow the user to select multiple companies.

Example:

Apple
Microsoft
NVIDIA

Compare should answer:

- How do performance trends differ?
- How do growth profiles differ?
- How do margin trends differ?
- What risks are common?
- What risks are distinctive?
- Where has regulatory attention changed?
- What does management emphasize?
- Which areas deserve further investigation?

Avoid arbitrary composite ratings.

Do not claim one company is the "best investment."

Prefer evidence-backed comparisons.

Example:

| Dimension | Apple | Microsoft | NVIDIA |
|---|---|---|---|
| Revenue trajectory | Stable | Growing | Accelerating |
| Margin direction | Stable | Improving | Improving |
| Regulatory attention | Increased | Persistent | Increased |
| Major attention area | Regulation | AI investment | Export controls |

Actual values/signals must be derived from evidence.

---

# 14. Compare — Key Differences

Do not stop at side-by-side metrics.

Automatically surface:

### Common themes

What appears across all companies?

### Distinctive themes

What makes one company materially different?

### Diverging trends

Where are financial/management/risk trends moving differently?

### Recommended comparative diligence

Example:

> Investigate why NVIDIA growth accelerated faster than peers.

> Compare regulatory exposure across all three companies.

> Determine whether margin expansion is broad or company-specific.

Each may launch Deep Analysis.

---

# 15. Diligence Gaps — P1

DiligenceIQ should explain what it DOES NOT know.

Examples:

- insufficient historical coverage;
- missing periods;
- incomplete evidence;
- unquantified concentration;
- disclosure without sufficient detail;
- questions the filings cannot answer.

Display:

### Diligence Coverage

Financial Performance — Strong evidence

Growth Outlook — Strong evidence

Regulatory Exposure — Strong evidence

Customer Concentration — Partial evidence

Supplier Concentration — Limited evidence

This reinforces trust.

A strong diligence tool should identify uncertainty rather than confidently fill gaps.

---

# 16. Evidence — P0

Every important conclusion should be inspectable.

The user should be able to:

- click a claim;
- open its evidence;
- see company;
- filing;
- period;
- section;
- source passage;
- compare with adjacent filing periods where applicable;
- deep-link into source context.

Do not make users trust AI summaries without source verification.

---

# 17. Findings — P0

Users must be able to save important discoveries.

Saved Findings should remain durable across analyses.

Each finding should include:

- description;
- source evidence;
- company;
- workstream/theme;
- originating analysis;
- status;
- analyst note;
- date.

The Findings Board answers:

> What have we learned?

It should consolidate insights from:

- company intelligence;
- Deep Analysis;
- comparison;
- thesis investigation;
- watch events.

---

# 18. Thesis Intelligence — P1

Add an Investment Thesis capability.

A user may define an investment hypothesis, for example:

> Services growth and ecosystem monetization will offset slower hardware growth.

A thesis should support:

### Supporting Evidence

Evidence consistent with the thesis.

### Challenging Evidence

Evidence that may weaken or contradict the thesis.

### Open Questions

Things that remain unresolved.

### Watched Signals

Signals whose changes could materially affect the thesis.

The product should help the investor test a thesis over time.

It must NOT declare whether the thesis is correct.

---

# 19. Watchlist — P1 / Future-State Bridge

Users should be able to indicate:

**Watch Apple**

and choose what matters:

- New SEC filings
- Material risk changes
- Regulatory exposure
- Growth/outlook
- Revenue/margins
- Liquidity/debt
- Supply chain
- Customer concentration
- Anything material

For the assessment build, full production monitoring may remain partially implemented if required for scope control.

At minimum:

- Watch preferences should be represented in the product.
- Existing corpus history may be used to demonstrate detected historical change events.
- The architecture/future-state must show how new filings trigger monitoring.

Future event-driven architecture:

EventBridge
→ check SEC
→ new filing detected
→ ingestion
→ index update
→ change detection
→ match user watches
→ event
→ SNS / notification

This creates the product loop:

**Understand today → Know when something changes tomorrow**

---

# 20. Intelligence Event vs Filing Event

Distinguish:

## Filing Event

> Apple submitted a new 10-Q.

## Intelligence Event

> Apple's latest filing materially expanded regulatory disclosure.

The second is substantially more valuable.

The Watchlist should evolve toward notifying users about meaningful intelligence events rather than every document event.

---

# 21. Scenario Intelligence — Future State

Do NOT prioritize traditional forecasting for the assessment.

Do NOT generate unsupported price targets or precise future financial forecasts.

Potential future capability:

### Scenario Intelligence

Example:

> What areas of the company appear most exposed if demand weakens?

> What disclosures suggest could happen if export restrictions expand?

Eventually, with additional data and financial modeling:

- Base case
- Upside case
- Downside case

may be supported.

This is future-state, not assessment P0.

---

# 22. Cost Control

The revised product direction must preserve the scale-to-near-zero architecture.

Requirements:

- no unnecessary always-on compute;
- precompute reusable intelligence where appropriate;
- cache Company Intelligence profiles;
- do not regenerate company profiles on every page view;
- generate profile intelligence only when data changes or explicit refresh occurs;
- persist structured intelligence;
- Deep Analysis remains one generative request;
- dashboards should NOT trigger background LLM calls merely by opening them;
- Compare should reuse structured intelligence where possible;
- Watch preferences should not require continuously running servers.

Company Intelligence should be cacheable/versioned against the underlying corpus/index version.

---

# 23. Company Intelligence Generation Strategy

Do NOT make ten separate LLM requests to build one company dashboard.

Prefer:

Retrieval across relevant company periods
→ deterministic financial extraction where possible
→ ONE structured Company Intelligence generation request
→ persist profile
→ reuse across sessions

Possible structured profile:

```ts
CompanyIntelligenceProfile = {
  company;
  coverage;
  executiveView;
  performance;
  financialTrends;
  growthDrivers;
  managementOutlook;
  risks;
  regulatoryThemes;
  changes;
  attentionSignals;
  recommendedDiligence;
  evidence;
}
```

The profile should be versioned by:

- corpus/index version;
- prompt version;
- company;
- covered periods.

Opening the dashboard later should read the persisted profile, not generate it again.

---

# 24. Deterministic vs Generative Responsibilities

Prefer deterministic extraction for:

- reported financial figures;
- periods;
- filing metadata;
- filing comparisons where straightforward;
- coverage;
- source/citation mapping;
- calculation of growth rates where mathematically appropriate.

Use the LLM primarily for:

- synthesis;
- explanation;
- categorization;
- plain-language interpretation;
- attention-signal explanation;
- recommended diligence;
- cross-document reasoning.

Do not ask the LLM to recreate easily determinable numeric values.

---

# 25. New Primary Demo Flow

The interview demo should become:

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

This allows the live unknown question from the panel to remain central while demonstrating that DiligenceIQ is much more than a chatbot.

---

# 26. Revised Business Story

The presentation should communicate:

General-purpose AI tools are good at answering questions when the user knows what to ask.

DiligenceIQ attempts to solve the problem before that.

It:

- tells investors what is happening;
- identifies what changed;
- identifies what deserves attention;
- explains why it matters;
- suggests what should be investigated;
- supports deep arbitrary research;
- proves conclusions with source evidence;
- preserves important findings;
- allows investors to compare companies;
- can eventually track investment theses;
- can proactively alert investors when new evidence matters.

---

# 27. Revised Competitive Differentiation

Do NOT position the value as:

> We summarize SEC filings.

ChatGPT, Claude, Copilot, and many other systems can summarize documents.

DiligenceIQ's differentiation is:

> It knows how to structure the diligence process.

The product creates value by combining:

- automatic company intelligence;
- change detection;
- attention signals;
- plain-language explanations;
- recommended investigation paths;
- company comparison;
- evidence verification;
- persistent findings;
- thesis tracking;
- monitoring.

The RAG engine is essential infrastructure inside that product.

It is not the entire product.

---

# 28. P0 — Must Be Excellent

Prioritize:

1. Company Intelligence dashboard
2. Company selector
3. Performance trends
4. What's Changed
5. Attention Signals
6. Why This Matters
7. Recommended Diligence
8. Compare Companies
9. Deep Analysis / arbitrary RAG question
10. One-call generation enforcement
11. Evidence / citations
12. Save Finding
13. Findings Board
14. Production AWS deployment
15. Evaluation
16. Required assessment documentation
17. Cost-controlled architecture
18. Demo reliability

Do not sacrifice these for extra functionality.

---

# 29. P1 — Strong Differentiators

After P0 is excellent:

- Diligence Gaps
- Thesis Intelligence
- Watchlist UI
- historical intelligence events
- Query Interpretation
- Evidence Coverage Matrix
- Analysis Audit Trail
- numeric grounding
- IC Brief
- architecture/value page
- filing explorer
- IC print mode

---

# 30. P2 / Future State

Do not prioritize before the interview:

- live SEC polling infrastructure;
- email notification delivery;
- full SNS notification workflow;
- sophisticated scenario modeling;
- traditional forecasting;
- external market-data integration;
- consensus analyst estimates;
- valuation engine;
- portfolio-wide analytics;
- collaboration/comments;
- CRM integration;
- Slack integration;
- PDF generation;
- complex user management.

Document these where useful.

---

# 31. Navigation and UX Update

Revise the app shell accordingly.

Recommended order:

Company Intelligence | Compare | Deep Analysis | Findings | Thesis | Watchlist

Company Intelligence should be the default authenticated/demo destination.

A new user should be able to select a company and understand the application without reading documentation.

Avoid jargon-heavy SEC terminology in primary screens.

Use simple labels first.

Examples:

Instead of:

> Item 1A Delta

Use:

> Risk changes

Then evidence may say:

> Source: 2025 10-K, Item 1A — Risk Factors

---

# 32. Product Accessibility Principle

Design for both:

- sophisticated investment professionals;
- users who understand businesses but are not experts in SEC filings.

The product should progressively reveal sophistication.

- **Level 1:** Tell me what I need to know.
- **Level 2:** Show me what's different and why it matters.
- **Level 3:** Help me compare.
- **Level 4:** Let me investigate deeply.
- **Level 5:** Show me the evidence.

Expert users should retain the ability to bypass guidance and ask arbitrary questions immediately.

---

# 33. Update Existing Implementation Plan

Before starting the next implementation phase:

1. Read `SPEC.md`.
2. Read this `PRODUCT_DIRECTION.md`.
3. Read the existing Phase 0 implementation plan.
4. Identify which parts remain valid.
5. Modify the plan to reflect the new product hierarchy.
6. Preserve the existing strong RAG architecture.
7. Preserve the cost-controlled architecture.
8. Preserve the single-call requirement.
9. Preserve evaluation and evidence requirements.
10. Update routes/navigation/data models as necessary.
11. Reprioritize P0/P1/P2 according to this document.

Do NOT throw away the existing technical architecture merely because the product UX changed.

---

# 34. Relationship to SPEC.md

For now:

- `SPEC.md` = technical/assessment baseline
- `PRODUCT_DIRECTION.md` = revised product/business/UX direction

When they conflict on product UX or prioritization, `PRODUCT_DIRECTION.md` wins.

When they conflict on:

- Eliza assessment constraints;
- one-call generation;
- evidence grounding;
- retrieval quality;
- AWS deployment;
- security;
- testing;
- cost control;

the stricter requirement wins.

After Claude updates the implementation plan and confirms there are no lost requirements, create a NEW consolidated `SPEC.md` incorporating both documents.

Do not overwrite the old SPEC until that reconciliation is complete.

Recommended process:

1. Preserve existing `SPEC.md`.
2. Add `PRODUCT_DIRECTION.md`.
3. Revise Phase 0 plan.
4. Run adversary review against BOTH documents.
5. Fix omissions/conflicts.
6. Run `/code-review`.
7. Produce consolidated `SPEC.md`.
8. Preserve the previous SPEC as: `docs/archive/SPEC-v1.md`
9. Make the consolidated `SPEC.md` the sole canonical implementation specification going forward.

---

# 35. Mandatory Quality Gate

All existing phase-gate rules remain.

At every phase:

Implementation
→ tests
→ fresh adversary
→ adversary report
→ fresh fixer agent fixes findings
→ regression tests
→ `/code-review`
→ fix code-review findings
→ rerun gate
→ `/handoff`

The adversary must now additionally ask:

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

---

# 36. Final Product Test

A successful product should pass this test:

Give DiligenceIQ to a user who has never heard of:

- a 10-K;
- a 10-Q;
- Item 1A;
- MD&A.

Have them select Apple.

Within 60 seconds they should be able to answer:

- How is Apple performing?
- What has changed?
- What appears to deserve attention?
- Why might those things matter?
- What should they investigate next?

Then an expert should be able to ask:

> How have Apple's regulatory disclosures changed from 2023 through 2025, and what actions does management describe?

and receive a rigorous evidence-backed answer from the same product.

If both users can succeed, DiligenceIQ is solving the right problem.

# DiligenceIQ — Future State

Where DiligenceIQ goes if the client is sold on the first release (SPEC §45). It says plainly what is **built now**, what is the **logical next step**, and what is **longer-term**. Nothing in the "next" or "later" sections exists in this build, and nothing here should be demonstrated or described as if it did. The Architecture and business-value page (`/architecture`, **Future state**) shows the same stages in short.

Status as of 2026-10-03: the P0 product is built and deployed (Phases 1–8, STATE.md). Phase 8b (Thesis, Watchlist, IC Brief) has not been built.

## 1. The path at a glance

| Stage | What it adds for the deal team | Status |
|---|---|---|
| **1. Public company intelligence** | Company Intelligence, What's Changed, Attention Signals, Recommended Diligence, Compare, Deep Analysis with cited briefs, evidence and source view, Findings | **Built and deployed** |
| 1b. Thesis, Watchlist, IC Brief (P1) | Test an investment thesis against evidence over time; watch companies and categories; assemble an Investment Committee brief from pinned findings | **Designed, not built** (logical next step) |
| **2. Live monitoring** | New filings detected, indexed and compared; alerts only when something a user watches has changed | Designed here, not built (next after 1b) |
| **3. Deal room intelligence** | The same evidence model over CIMs, quality-of-earnings reports, financial models, contracts, management presentations | Longer-term |
| **4. Investment Committee workflow** | Collaboration, approvals, memo workflows, diligence ownership | Longer-term |
| **5. Portfolio intelligence** | After close: KPI monitoring, new-filing alerts, covenant risk, operating signals, benchmarking | Longer-term |

The product loop this builds toward: **understand today → know when something changes tomorrow → decide with the evidence in hand.**

## 2. Built now (Stage 1)

What a client can use today at `https://diligenceiq.mikemiller.ai`, over 246 SEC 10-K and 10-Q filings from 54 companies (README):
- **Company Intelligence** for 53 companies (GE Capital's only filing is outside the 2022–2025 review window). Performance trends, drivers, current risks, persistent risks and trend changes, why they matter, and recommended questions, all read from profiles built offline. Opening a page never calls a model.
- **Compare** two to five companies on fixed rules, with no model call.
- **Deep Analysis**: any question, one company or many, one period or several, answered as a cited Diligence Brief by exactly one model call, with citations and figures checked in code.
- **Evidence**: every claim opens its passage, the adjacent period and the readable filing.
- **Findings**: saved with a copy of their cited passages, with status, notes and grouping.
- Spend controls (kill switch, caps), alarms with email alerts, and a Budget alert (architecture §11, §12).

What it deliberately does not do today: poll for new filings, send notifications, hold private documents, support accounts or collaboration, forecast, or value companies.

## 3. Next: Thesis, Watchlist and IC Brief (P1, designed, not built)

These are specified (SPEC §19–§23), designed into the data model and API (architecture §8, §8.2, §9) and decided (DD-19), and were planned as Phase 8b. None of them calls a model.

**Thesis.** The analyst writes a hypothesis, for example "Services growth and ecosystem monetization will offset slower hardware growth." They link findings and signals to it, marking each as supporting or challenging, and keep open questions and the signal categories that could affect it. "Test with Deep Analysis" prefills a question and never runs it by itself. The product never says whether a thesis is right. *Value:* a thesis tested against evidence over time, rather than restated in each memo.

**Watchlist.** Watch a company and choose what matters: new filings, material risk changes, regulatory exposure, growth and outlook, revenue and margins, liquidity and debt, supply chain, customer concentration, or anything material. It shows two kinds of event side by side:
- a **filing event**: "Apple submitted a new 10-Q", from the filing catalog;
- an **intelligence event**: "Apple's latest filing changed its regulatory disclosure", from the stored profiles' change signals, filtered by what the user watches.

In the first version these are historical events from the corpus; nothing polls. The intelligence event is the valuable one, and it is what Stage 2 turns into an alert.

**IC Brief.** A clean, printable brief assembled from pinned findings and theses: Executive View, Financial Performance, Growth Drivers, Material Risks, Regulatory Exposure, Outstanding Diligence and Supporting Evidence, each section filled by a fixed rule from the findings' themes and statuses (architecture §8.2). No model call, so it says only what the team saved and verified. PDF generation is later (section 9).

**Also in P1:** a per-company Diligence Gaps matrix (Strong / Partial / Limited evidence per category), a filing explorer, and an Analysis Audit Trail showing what the model saw and what was checked for any brief.

## 4. Stage 2: Live monitoring (designed, not built)

### What the client gets
Today a user learns what changed by opening a company. With monitoring, DiligenceIQ tells them: when a watched company files, the filing is read, indexed and compared with the last one, and if something the user watches has changed, they get an alert that says what changed and links to the evidence. Not "a new document exists": "Apple's new annual report expands its regulatory disclosure; here are the passages from both years."

### The pipeline

```text
Daily schedule (EventBridge)
  → check SEC EDGAR for new filings from the covered companies
  → new filing found? if not, stop (most days)
  → ingest it                        parse, sections, chunks: the existing ingestion code
  → update the index                 embed only the new chunks; rebuild and publish the index
  → detect changes                   the existing deterministic change detectors, new filing vs prior
  → rebuild that company's profile   deterministic always; model-written only under its own bound
  → match user watches               which watchers care about this company and these categories
  → write intelligence events        stored, and shown on the Watchlist
  → notify                           SNS → email (later: Slack, CRM)
```

### Why it is a natural extension
Almost every box already exists as an offline, admin-run step; monitoring runs the same steps when a filing arrives instead of when an admin runs them:
- **Ingestion** (`pnpm ingest`, `packages/corpus`): header parsing, period derivation, section detection, chunking.
- **Embeddings** are cached by content hash, so only the new filing's chunks are embedded (architecture §13.3). Embedding the whole corpus cost about $0.44 (docs/handoffs/phase-02.md), so one filing is a small fraction of that.
- **Index build** (`pnpm index:build`) and **upload** produce the same S3 artifacts the worker already loads.
- **Change detection** (`packages/rag/signals`, DD-18) is deterministic and already produces evidence for each period it compares.
- **Profile build** (`pnpm intelligence:build`) already has a zero-call deterministic mode and a ledger-bounded model mode.
- **Alerting**: the SNS topic and email subscription pattern already exist for operational alarms (architecture §12).

### How it stays near zero cost
- One short scheduled check a day; no servers, clusters or always-on workers. On a day with no new filing it does one check and stops.
- Work is proportional to filings, not to time. Each covered company files about four reports a year (an annual report and three quarterly reports; landing page), so a 54-company universe means a few new filings a week, each processed once.
- No model call is needed to detect a change or to send an alert: detection, matching and the alert text come from deterministic signals and templates. A model-written profile refresh is optional, at most one call per affected company, under the same ledger bound as today.

### What has to change first
- **A client decision on scheduled work.** The current deployment forbids schedules (SPEC §35.9), and the offline profile exception is explicitly never scheduled (SPEC §35.7). Monitoring is a deliberate change to those rules for a client who wants it, not a quiet addition.
- **Accounts.** Today's workspaces are anonymous. Alerts need a user to send them to, so monitoring depends on sign-in (section 9, user management).
- **Signal coverage.** Only persistent-risk and trend-change detectors ship today; new, removed and expanded risks and outlook changes were suppressed for missing the precision bar (DD-18). Monitoring is more valuable with them, so improving those detectors comes before promising "new risk" alerts.

## 5. Stage 3: Deal room intelligence (longer-term)

The same product over the documents a deal team actually receives: confidential information memoranda, quality-of-earnings reports, financial models, contracts and management presentations.
- **What carries over:** the evidence model (every claim cited to a passage), figure checks against the cited passage (arguably more valuable on a QoE report than on a 10-K), one model call per question, findings and the IC Brief.
- **What is new:** document parsing beyond SEC text (PDF, spreadsheets, slides); per-deal isolation of data, keys and access; and comparisons between what management presents and what the filings or the QoE say.
- **Why it matters:** this is where most diligence hours go, and where a cited, checkable answer saves the most time.

## 6. Stage 4: Investment Committee workflow (longer-term)

Collaboration on findings and theses, comments, diligence ownership (who is following up on what), approvals and memo workflows that end in the IC Brief. This builds on Findings (status, notes, Board view) and the P1 IC Brief. It needs accounts, roles and an audit trail.

## 7. Stage 5: Portfolio intelligence (longer-term)

After close, the same monitoring loop applied to portfolio companies: KPI monitoring, new-filing alerts for public comparables, covenant risk, operating signals and benchmarking against peers. It reuses Stage 2's pipeline and Compare's fixed-rule comparisons, with private portfolio data added under Stage 3's isolation.

## 8. Scenario intelligence (future state, with firm limits)

A future capability could answer questions such as:
- "What areas of the company appear most exposed if demand weakens?"
- "What do the disclosures suggest could happen if export restrictions expand?"

Answers would come from what companies themselves disclose (risk factors, sensitivities, segment exposure, management's own discussion), cited like every other answer.

**What DiligenceIQ will not do:** generate price targets, ratings, or precise financial forecasts that the evidence does not support (SPEC §45, §32.6). Traditional forecasting is not a priority. With additional data and real financial modelling, base, upside and downside cases may eventually be supported; that would be a separate, clearly labelled capability, not the brief speaking beyond its evidence.

## 9. Documented, not built (P2)

SPEC §6.3 lists capabilities that are deliberately not built before the interview. Where each would fit:

| Capability | Where it fits | Note |
|---|---|---|
| Live SEC polling infrastructure | Stage 2 | Section 4. Needs the scheduled-work decision. |
| Email notification delivery | Stage 2 | Needs accounts. SNS email exists today for operational alarms only. |
| Full SNS notification workflow | Stage 2 | Per-user subscriptions, preferences, digests, unsubscribe. |
| Sophisticated scenario modelling | Section 8 | Disclosure-based first; modelled cases only with real data. |
| Traditional forecasting | Section 8 | Not a priority; no forecasts from filings alone. |
| External market-data integration | Stages 3 and 5 | Prices, multiples and comparables. Today a market-data question is answered as "not in the filings" (evaluation.md §7). |
| Consensus analyst estimates | Stages 3 and 5 | A licensed data source; labelled separately from filing evidence. |
| Valuation engine | Stage 3 | Separate from the evidence product; never a rating in a brief. |
| Portfolio-wide analytics | Stage 5 | |
| Collaboration and comments | Stage 4 | |
| CRM integration | Stage 4 | Push findings and IC Briefs to the deal record. |
| Slack integration | Stages 2 and 4 | Another alert channel. |
| PDF generation | P1 IC Brief, then Stage 4 | The P1 IC Brief has print mode only. |
| Complex user management | Prerequisite for Stages 2–5 | SSO and roles, then per-deal access. |

## 10. Near-term quality work (before or alongside 1b)

Measured gaps in today's build that a client would want closed first (evaluation.md):
- **Change claims need evidence from each period.** Two Apple regulatory briefs claimed topics were "absent" from earlier filings that do mention them, because those passages were not in context (§8). Fix: a prompt rule and a validator check, released as the next prompt version after a full evaluation run.
- **Multi-company retrieval depth** on the weakest question types (cloud, pharma; §1), for example reranking, once its status under the single-call rule is settled (assumptions A1, F1).
- **More change detectors** to clear the precision bar (new, removed and expanded risks; outlook changes; §3, DD-18).
- **Lighter pages:** about 390 KB of JavaScript at first load on workspace pages (§9).
- **A human review** of groundedness to stand beside the model-agent review (§8).

---

## Engineering appendix

### A. Monitoring components (Stage 2)

| Step | Component | Reuses | Notes |
|---|---|---|---|
| Schedule | EventBridge Scheduler, one daily rule | — | The only scheduled resource. The cost-guard test (architecture §13.1) would need an explicit, named allowance, as §35.7 has for the profile build. |
| SEC check | Lambda: read each covered company's EDGAR submissions feed, compare with the filing catalog | Filing catalog from ingestion | Respect SEC's fair-access policy (declared User-Agent, rate limit). Exits immediately when nothing is new. |
| Fetch and ingest | Lambda (or a Step Functions state) writing raw and processed text to S3 | `packages/corpus` header, period, section and chunking code | Same metadata-override table for anomalies. |
| Embed | Bedrock Titan v2, new chunks only | The content-hash embedding cache | Cost proportional to the new filing's size. |
| Index build and publish | Step Functions task running the index build | `pnpm index:build` logic, `index:upload` layout | Measure the build's time and memory first; if it does not fit a Lambda, an on-demand Fargate task still has no idle cost. |
| Index switch | An SSM pointer for the active index version, like `/diligenceiq/active-profile-set` | The profile-set pointer pattern | Today the index version is CDK config, so a new index needs a deploy. A pointer makes it a parameter change, with instant rollback. |
| Change detection | Lambda running the signal detectors for the affected company | `packages/rag/signals` (DD-18) | Deterministic; `evidenceByPeriod` gives the alert its passages. |
| Profile refresh | Deterministic profile for the affected company; optional model-written profile | `intelligence:build` | See B. |
| Watch match | Query watches by ticker and category | `WATCH#` items (architecture §8) | Watches live under each workspace's partition; matching across users needs a GSI keyed by ticker. |
| Events | DynamoDB items: filing and intelligence events | Watchlist read model (DD-19) | Shown on the Watchlist; TTL as today. |
| Notify | SNS topic → email per subscribed user | The `diligenceiq-alerts` pattern (architecture §12) | Alert text is templated from the signal; no model call. |

Failure handling follows the existing house pattern: each step is idempotent on the filing's document ID, failures go to a DLQ with an alarm, and a re-run never duplicates events.

### B. Index and profile versioning under continuous ingestion
Today the index version is a content hash of all chunks (README), and the profile ledger allows one model call per company per (`indexVersion`, `profilePromptVersion`) (DD-16). With monitoring, every new filing would produce a new index version, and a naive rebuild would make a model call for every company on every filing. Two changes keep it bounded:
- **Key profiles on the company's own content**, for example (ticker, hash of that company's chunks, `profilePromptVersion`). A new Apple filing then rebuilds only Apple's profile, and every other company's ledger key is unchanged.
- **Keep the deterministic set as the default refresh.** It is zero-call and always current; the model-written profile can follow later in a batch, under `--max-calls`, or not at all.

### C. Retrieval at larger scale
The in-memory index suits the pilot: about 25K chunks and a 236 MB index loaded in 2.8 s (evaluation.md §5). Architecture §13.5 sets the move to a managed search backend behind the same `SearchBackend` interface at around 100K+ chunks or continuous ingestion. Continuous ingestion of filings for a larger universe, or deal-room documents, is exactly that trigger. Planner, context builder, generation, validation and UI do not change.

### D. Deal-room isolation (Stage 3)
Confidential documents change the security model: per-deal or per-tenant isolation of storage and indexes, customer-managed KMS keys, VPC and PrivateLink to Bedrock, WAF, SSO, and fine-grained audit logging (architecture §13.5, enterprise tier). The single-call rule, citation validation and figure checks carry over unchanged; chunk IDs extend to non-SEC document types.

### E. What stays true at every stage
- One generative call per user question; everything else that can be deterministic stays deterministic.
- Every claim cites a passage the model was given, checked in code.
- No ratings, scores, recommendations or price targets (SPEC §32.6).
- Idle cost as close to zero as practical; cost proportional to use.

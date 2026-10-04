# DiligenceIQ Launch Film v2 — Claim Check

Every spoken line and on-screen number, checked against what the product shows or what the
repo documents (playbook §4: never narrate what the screen or the product can't back up).
Checked 2026-10-03.

> **Post-picture note (2026-10-03).** The adversary review of the finished v2 cut found that Claude Design
> recreated the product UI rather than capturing it: the dashboard's H20 / 60.5% signal does not exist in the
> NVDA profile, and the brief shows "54 of 54 figures" where the real seeded brief has 96 of 97. This table
> checked the script against the v1 film and the docs, not against the product's screens, so it missed that.
> **Mike's decision:** the film is marketing material showing the product's polish, not a source of figures,
> so on-screen numbers need not match the app. The picture ships as is.

| Beat | Claim | Backed by | Status |
|---|---|---|---|
| 1 | The question | Word for word one of the assessment's three example questions; the seeded demo analysis `0mur5jdriseedpdf2` (`seed/demo-workspace.json`) | ✅ |
| 1 | "Hours inside 10-Ks and 10-Qs" | README "Business value": "a first read on a company in seconds instead of hours of reading filings" | ✅ (product's own claim) |
| 2 | "Reads the filings for you, and shows its evidence" | Every brief and profile statement carries citation chips to filing passages | ✅ |
| 3a | "The first read is already there: how it's performing, and what changed" | Company Intelligence page: Bottom line, 30-second view, Performance, What's changed (pre-built offline; opening the page calls no model) | ✅ |
| 3b | "$4.5B export-control charge… gross margin to 60.5%" | NVDA Attention signal (seen in v1 frame at 17.5 s): "Gross margin fell to 60.5% in Q1 FY2026, impacted by a $4.5B H20 export-control charge", cited `NVDA FY2026Q1 · Mgmt discussion`; profile figures are 100% source-matched (architecture page, llm-v3) | ✅ |
| 3b | "Flagged, with the filing passage behind it" | Citation chip and **View evidence** on the signal card | ✅ |
| 4 | "Ask anything, in plain English" | Deep Analysis takes a free-text question (assessment requirement) | ✅ |
| 4 | "It searches the filings, gathers the passages…" | Hybrid retrieval, then evidence balancing and source context (stage list) | ✅ (re-voiced from "every filing": with a ticker selected it searches that company's filings) |
| 4 | "Exactly one model call to write the brief" | Architecture page: 1 model call per analysis, all 26 eval questions; enforced by the conditional claim, `maxAttempts: 1`, gateway counter (README) | ✅ |
| 4 | "Every step is shown" | `stage-tracker.tsx`: 9 visible stages, real labels | ✅ |
| 5 | "Summary, key findings, trend" | Seeded NVIDIA brief: Executive summary, Key findings, Trend table (v1 frames 33–46 s) | ✅ |
| 6 | "Every claim opens the passage it came from" | Citation chip → source drawer with the passage text (`evidence.tsx` "Source passage and details") | ✅ (must be **shown**: the click and drawer are in the beat 6 spec) |
| 6 | "Every number is checked against the filing it cites" | Brief bottom line "All 54 figures found in their cited passages"; eval: 98.9% of figures found (531/537) | ✅ |
| 6 | ~~"Anything it can't verify, it tells you"~~ | True in the product ("X of Y figures found"), but the NVIDIA example verifies all 54, so nothing on screen shows it | ❌ cut (line re-voiced without it) |
| 7 | "Which risk areas they share, and where their trends diverge" | Compare: **Risk areas** grid and **Diverging trends** sections (`compare-view.tsx`); AAPL, TSLA, JPM profiles exist in llm-v3 | ✅ |
| 8 | "About a minute per brief" | 43–64 s from queued to finished brief (architecture page, evaluation.md §5) | ✅ |
| 8 | "Around thirteen cents" / card "~$0.13" | Billed $0.099–0.138 per production analysis; recorded example $0.1316 (README); list-price estimate $0.12–0.13 | ✅ |
| 8 | "Almost nothing when it sits idle" / "~$0.57/mo" | README: about $0.57 a month idle (architecture §13.1) | ✅ |
| 9 | "Today, it reads public filings" | Stage 1, built and deployed (`docs/future-state.md`) | ✅ |
| 9 | "Next, it watches for new ones" | Watchlist (P1) and live monitoring (Stage 2): **designed, not built**; the card labels it "Next · designed" | ✅ as future state |
| 9 | "Later, your deal room" | Stage 3, deal room intelligence: longer-term | ✅ as future state |
| 10 | "Know what changed. Know what matters. Know what to investigate next." | Product brand line; v1 end card | ✅ |
| all | No ratings or recommendation language | No banned phrases (DD-16) in narration or captions | ✅ |

Beats 4 and 6 were re-voiced with the corrected wording on 2026-10-03; the brief's line lengths are from those takes.

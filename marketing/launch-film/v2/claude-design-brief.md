# DiligenceIQ Launch Film v2 — Picture Brief (for Claude Design)

A new picture cut for the DiligenceIQ launch film. **This is a new story, not a polish
pass.** v1 was a feature tour (title → dashboard → ask → brief → compare → close). v2
follows **one question from start to finish**. The narration is already recorded in a real
voice clone, so **cut each beat to the narration lengths below**. Music, sound effects and
captions are added afterwards.

---

## Who it's for and what it has to do

- **Where it plays:** the DiligenceIQ landing page (`diligenceiq.mikemiller.ai`), as the
  polish piece next to the product. Viewers are a client-style audience: private equity
  people, and the technical reviewers judging the build.
- **What they must come away with (in this order):**
  1. It answers a real diligence question from SEC filings.
  2. The answer is grounded: retrieval, then **exactly one model call**, and every claim
     traces to a filing passage.
  3. It's worth it: about a minute and about 13 cents an answer, and close to nothing idle.
  4. There is a believable next step (future state).
- **The spine:** the question *"How has NVIDIA's revenue and growth outlook changed over
  the last two years?"* It opens the film, and the film ends with its answer verified.

## Keep from v1
- Brand look: dark navy title and end cards, the DiligenceIQ wordmark and icon, the
  white-to-lavender gradient on the emphasis line, mono uppercase kickers, Sapphire `#2B48CA`.
- The v1 end-card layout ("Know what changed. Know what matters." + the button and URL row).
- Dissolves between scenes.

## Global constraints
- **1920×1080, 30 fps, ~90 s.**
- **No hard cuts.** Dissolve between every scene (v1 has one hard cut at 5.6 s, from title
  to dashboard; don't repeat it).
- **Caption cards carry the message.** On every UI beat, add a mono uppercase kicker plus
  **one short line (3–7 words)**. Never make the viewer read UI body text; the interface is
  proof, the caption is the point.
- **Spotlight every UI beat.** Dim the screen to ~35–45% and keep a soft spotlight on the one
  region that matters. Move the spotlight when the point moves.
- **Hold, don't scroll.** Frame the region, then hold with a slow drift. If you must move
  down a page, dissolve between two held frames instead of a long scroll.
- **Vary the location per beat** so it never reads as one long scroll.
- **Full-frame punctuation:** the question card (beat 1), the logo (beat 2), the value card
  (beat 8), the future card (beat 9) and the end card (beat 10) are full-frame and dark.
  They give the eye a rest between UI beats.
- **Never show something the narration contradicts.** In particular, avoid framing a
  "MODEL-WRITTEN SUMMARY" label under a line about figures coming from the filing (beat 3a
  frames the "Bottom line" metrics, not the summary header).
- Each beat **starts as its line starts and holds past the line's end**. Never cut away
  while the voice is still speaking.

---

## Beat-by-beat spec

Times are targets. The narration length is fixed; the hold is the minimum time on screen.

| # | Beat | Screen / state | Kicker | Caption (short) | Spotlight / motion | Narration (s) | Hold (s) |
|---|---|---|---|---|---|---|---|
| 1 | **The question** (hook) | Full-frame dark card. The question types in, large, as if into a search field: *How has NVIDIA's revenue and growth outlook changed over the last two years?* | A DILIGENCE QUESTION | (the question itself is the caption) | Typing finishes by ~3.5 s, cursor blinks, hold. Voice enters ~2.5 s, after the first words land. | 6.1 | ~10 |
| 2 | **Name it** | Full-frame dark. DiligenceIQ icon and wordmark form; positioner fades in under it. | — | **Investment intelligence for private equity** | Logo forms, positioner fades in, breathes. Hold at least 2 s after the voice. | 3.5 | ~6 |
| 3a | **The first read** | `/intelligence?ticker=NVDA`, the top of the page: NVIDIA header and the **Bottom line** card (Revenue up 114% to $130.5B, Gross margin 75.0%, Growth moderating, Customer concentration). | COMPANY INTELLIGENCE | **The first read, before you ask** | Spotlight the Bottom line card. Keep the "MODEL-WRITTEN SUMMARY" header dimmed or out of frame. | 5.0 | ~6.5 |
| 3b | **What changed** | Same page, the **Attention signals** card: *Gross margin compressed in Q1 FY2026: fell to 60.5%… $4.5B H20 export-control charge*, its citation chip (`NVDA FY2026Q1 · Mgmt discussion`) and **View evidence** / **Investigate** buttons. | WHAT CHANGED | **A $4.5B charge, flagged** | Spotlight the signal headline and sentence first, then move the spotlight to the citation chip on "with the filing passage behind it". | 8.9 | ~10.5 |
| 4 | **Ask: one model call** | `/analysis/new?tickers=NVDA` with the question typed into the field → **Run analysis** clicked → the stage list runs: *Interpreting the question → Searching SEC filings → Balancing evidence across companies and periods → Preparing source context → Generating diligence brief → Validating citations and figures.* | ONE QUESTION. ONE MODEL CALL. | **Retrieval first. Then one call.** | Spotlight the question and Run (click at ~2.5 s into the beat), then the stage list, with each step ticking green in turn. **Linger on "Generating diligence brief"** as the voice says "exactly one model call". | 10.6 | ~13.5 |
| 5 | **The brief** | The finished NVIDIA brief (the demo-workspace example of this exact question): title *NVIDIA Revenue Trajectory: FY2024–FY2026 YTD Acceleration and Emerging Headwinds*, Executive summary, Key findings, Trend table. | DILIGENCE BRIEF | **Reads like an investment memo** | Three held frames, dissolving: summary → key findings → trend table, timed to "a summary, the key findings, and the trend". | 4.9 | ~6.5 |
| 6 | **Verify** (the credibility beat) | **Click a citation chip** in a key finding (e.g. finding 01 "Revenue more than quadrupled…" chip `NVDA FY2025 · Financial statements`). The **source drawer** slides in showing the actual filing passage, with the supporting figure marked, and its Document / Section / Period / Filed details. Then close it and land on the **"All 54 figures found in their cited passages"** check in the Bottom line strip. | EVIDENCE | **Every claim opens its source** → then **54 of 54 figures verified** | Spotlight the chip and the click, then the passage text with its highlighted figure, then the green "All 54 figures found" pill (it glows or ticks on). | 5.5 | ~9.5 |
| 7 | **Across companies** | `/compare?tickers=AAPL,TSLA,JPM`: the **Risk areas** grid (which risk areas each company's latest annual report covers), then **Diverging trends**. | COMPARE | **Shared risks. Diverging trends.** | Spotlight one shared row across all three, then one diverging cell. Don't show the whole dense grid at full brightness. | 4.9 | ~6.5 |
| 8 | **Value** | Full-frame dark statistic card, three numbers that build one at a time: **~1 min** a cited brief · **~$0.13** per answer · **~$0.57/mo** when idle. | WHY IT PAYS | (the numbers are the caption) | Numbers count or fade up in sequence with the voice: "about a minute" → "thirteen cents" → "close to nothing". | 4.7 | ~6.5 |
| 9 | **What's next** | Full-frame dark card, three stacked rows: **Today:** public filings, built · **Next:** watch for new filings, designed · **Later:** your deal room documents. | FUTURE STATE | (the rows are the caption) | Rows appear one at a time with the voice; "Today" is solid, "Next" and "Later" a step dimmer (they're not built). | 5.2 | ~6.5 |
| 10 | **Close** | v1 end card: DiligenceIQ wordmark; **Know what changed. Know what matters. Know what to investigate next.**; the button and URL row. | — | — | Wordmark, then each "Know…" phrase lands with the voice. Hold the finished card ≥ 2.5 s after the voice. | 4.8 | ~7.5 |

**Running total ≈ 90 s.**

> **Beat 6 is deliberately longer than its line** (5.5 s of voice, ~9.5 s on screen) so the click,
> the drawer and passage, and the "54 figures" pill each get a held moment. It's the credibility beat.

---

## The narration (for reference; already recorded)

| # | Line |
|---|---|
| 1 | A deal team asks a question like this every week. Answering it properly means hours inside 10-Ks and 10-Qs. |
| 2 | DiligenceIQ reads the filings for you, and shows its evidence. |
| 3a | Open a company, and the first read is already there: how it's performing, and what changed. |
| 3b | Like the four-and-a-half-billion-dollar export-control charge that pulled NVIDIA's gross margin to 60.5%. Flagged, with the filing passage behind it. |
| 4 | Then ask anything, in plain English. It searches the filings, gathers the passages that answer your question, and makes exactly one model call to write the brief. Every step is shown. |
| 5 | What comes back reads like an investment memo: a summary, the key findings, and the trend. |
| 6 | Every claim opens the passage it came from. And every number is checked against the filing it cites. |
| 7 | Compare companies side by side: which risk areas they share, and where their trends diverge. |
| 8 | A cited brief in about a minute, for about thirteen cents. And close to nothing when no one is using it. |
| 9 | Today, it reads public filings. Next, it watches for new ones. And later, your deal room. |
| 10 | DiligenceIQ. Know what changed. Know what matters. Know what to investigate next. |

---

## Where to capture the screens

- **Production** (`https://diligenceiq.mikemiller.ai`) for the dashboard (`/intelligence?ticker=NVDA`),
  the finished NVIDIA brief (open it from **Findings** or **Deep Analysis**: it's the
  demo-workspace example "How has NVIDIA's revenue and growth outlook changed over the last
  two years?"), the source drawer (click any citation chip in that brief) and Compare
  (`/compare?tickers=AAPL,TSLA,JPM`).
- **The running stage list (beat 4):** production has new analyses switched off to control
  spend, so capture the run on the **local server** (`pnpm exec tsx tests/e2e/local-server.ts`
  with `E2E_STAGE_MS=1200`, port 4175). It runs the real UI and the real stage labels with a
  test worker that never calls a model. **Use only the stage list from that run.** Its brief
  is a stub; the brief in beat 5 must be the production example.
- `/analysis/new?q=…&tickers=NVDA` pre-fills the question. It never runs on its own; the
  **Run analysis** click is a deliberate, visible action (keep that click in the shot).

## What NOT to do
- No generated b-roll, stock footage, people or fake UI. The real product is the proof.
- No hard cuts.
- No ratings or recommendation language in captions (no "buy/sell", "score", "strong",
  "attractive", "recommend"). Signals describe; they don't judge.
- Don't put numbers on screen that aren't in the list above or in the product UI itself.
- Don't shrink dense UI into small panels the viewer has to read.
- Don't speed-ramp the stage list into a blur. The point of beat 4 is that the steps are visible.
- Don't put the creator credit in the narration. If you want it, keep it on the end card's URL row.

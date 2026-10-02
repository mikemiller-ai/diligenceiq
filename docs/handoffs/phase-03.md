# Phase 3 Handoff: Query Analysis, Hybrid Retrieval, Context, Retrieval Evals, Signal Go/No-Go

_Date: 2026-10-02 (local)_

## Why
Phase 3 builds the retrieval half of Deep Analysis and measures the signal layer:
- deterministic query analysis;
- balanced hybrid retrieval over the in-memory index;
- the ~24K-token context builder;
- a retrieval debug endpoint;
- retrieval evals that record the chunk-size, embedding and rerank decisions;
- the time-boxed change detection, with a go/no-go on hand labels (DD-18, assumptions G4).

No generation exists yet; that is Phase 4.

## Completed
1. **Index check.** `iv-9cf51c066743` is in S3 (`s3://diligenceiq-core-databuckete3889a50-cto74g4tj9kn/index/iv-9cf51c066743/`: 60 index objects, 236 MB, manifest present). Read-only check; nothing uploaded.
2. **Query analysis** (`packages/rag/src/query/`, no model):
   - A catalog derived from the index chunks.
   - Company aliases from header names plus a curated list, with the C3 collision rules:
     - case-sensitive only for ordinary English words;
     - tickers in capitals only, and possessives allowed ("NVDA's");
     - out-of-corpus companies (Ford, …) stated as gaps.
   - 21 sector phrase rules; each needs a group noun.
   - Periods:
     - current view;
     - last N (per company, corpus-relative, plus FY<next> YTD);
     - years, ranges, "since", quarters and filter ranges;
     - two-digit "FY23".
   - **Time-phrase rule:** a bare year is a period only in a time phrase. A named period missing for every company falls back to the current view, with a gap. A named company missing it alone keeps a current-view lane, with a gap.
   - Filing types; topic boosts (soft only); user filters override the question.
   - Notes and gaps for the Interpretation panel. GE (FY2014, outside the review window) is excluded from unscoped questions.
3. **Retrieval** (`packages/rag/src/retrieval/`):
   - **Planner lanes:** company, company × period, sector member, or global with a per-company cap. Quota max(1, ⌊22 / lanes⌋), filled in tiers: companies first, then periods (latest annual first, earliest next). Above 11 period lanes, each company keeps its endpoint periods, with a plan note.
   - **Search:** BM25 plus exact cosine per lane, RRF k = 60; topic boost ×1.25, boilerplate ×0.2; one query embedding; rerank off.
   - **Context:**
     - quotas first, then score fill;
     - dedupe by >50% overlap or shingle Jaccard > 0.8, which keeps cross-period duplicates;
     - 24,000-token budget, never exceeded;
     - `<filing_excerpts>` block with tag and header-line defanging;
     - snapshot capped at 350 KB, degrading instead of throwing;
     - coverage matrix.
   - **Telemetry and debug:** telemetry plus a debug view.
4. **Retrieval debug endpoint.** `POST /api/retrieval/debug` (schema in `packages/core`) is registered only when a dependency is injected. The deployed handler never injects one, so production answers 404 (tested). `pnpm retrieval:debug` serves it on 127.0.0.1.
5. **Evals.**
   - `evals/questions.yaml` has 20 questions covering every §41.1 category. The three PDF questions and the expert question are verbatim (tested), and 74 gold chunks are hand-picked across 7 questions.
   - CLIs:
     - `pnpm eval:retrieval`;
     - `pnpm eval:chunk-size` (free, BM25 only);
     - `pnpm eval:signals`.
   - Results are in `evals/results/`; the write-up is `docs/evaluation.md`.
6. **Signals** (`packages/rag/src/signals/`):
   - **Detectors:** NEW / REDUCED (heading diff), PERSISTENT, EXPANDED / REDUCED (lexicon density), OUTLOOK CHANGE and TREND CHANGE. Each emits `evidenceByPeriod` and `investigateQuestion`.
   - **Labels:**
     - heading pairs: AAPL, MSFT, NVDA, FY2023→FY2024 and FY2024→FY2025;
     - trends: hand-read income statements.
     - Both were made by separate Claude agents that never saw the detector or extraction code.
   - **Go/no-go:** `DETECTOR_STATUS`. Suppression is the default (tested), and a corpus gate test re-measures the enabled detectors.
7. **Chunker sizing parameter** (for the experiment only). The defaults are unchanged: the experiment re-derives `iv-9cf51c066743`.

## Measured results (index `iv-9cf51c066743`)
**Retrieval** (20 questions; all embedded):

| Mode | Passing | Evidence hit rate | Gold recall@context | Search p50 / max |
|---|---|---|---|---|
| BM25 | 16/20 | 0.85 | 0.48 (29/74) | 25 / 43 ms |
| Cosine | 19/20 | 0.98 | 0.62 (40/74) | 28 / 50 ms |
| **Hybrid (shipped)** | **19/20** | **0.99** | 0.62 (40/74) | 26 / 33 ms |

- Hybrid's one miss: AbbVie has no IRA, Medicare or FDA passage in PDF Q3.
- Gold-recall weak spots: PDF Q3 and the cloud comparison.
- Multi-company balance: in PDF Q1, AAPL 9, TSLA 9 and JPM 8 of 26 blocks; in the pharma question, 4–5 blocks per company. Many-lane questions keep every company; a gate test covers this.

**Decisions:**
- **Chunk size:** keep c2 (3,600 characters, 480 overlap). This is on cost (about $0.44 and an hour per re-embed) and context diversity, **not** a measured win. On BM25, c2 passes the fewest questions (16/20) but has the best gold recall (29/74 against 23–25).
- **Embeddings:** keep Titan v2. Cohere Embed v4 was **not evaluated** (quota and about $2.40); this is a stated limitation.
- **Rerank:** off. F1 (would Eliza count a rerank as retrieval?) stays open, worth asking only if Phase 4 briefs show evidence ranked just outside the context.

**Signal go/no-go** (bar: precision ≥ 0.8, recall ≥ 0.5, at least 5 decided candidates):

| Detector | Precision | Recall | Decision |
|---|---|---|---|
| PERSISTENT | 0.90 (26/29) | 0.89 (24/27) | Go, on a stated basis (below) |
| TREND CHANGE | 1.00 (15/15) | 1.00 (15/15) | Go |
| NEW | 0.33 | 1/1 | Suppressed |
| heading REDUCED | 0.38 | 3/3 | Suppressed |
| EXPANDED / emphasis REDUCED | 1.00 on 2 / none emitted | 0.15 / 0 | Suppressed |
| OUTLOOK CHANGE | 0.00 | 0/5 | Suppressed |

- **PERSISTENT's stated basis:**
  - 22 of its 77 links (FY2022→FY2023) are unlabeled;
  - fully labeled chains are 5/7 correct;
  - recall over all persistent headings is 0.36;
  - the latest 10-K needs at least 10 extracted headings.
- **Heading-diff viability (G4):**
  - headings are comparable across years;
  - diffs for NEW / REDUCED are **not** viable at the current extractor precision;
  - lexicon density misses content-level expansion.

## Gate record
1. **Adversary** (with the SPEC §48.2 questions):
   - Blocker B1: a passing year mention became a hard scope and emptied the context.
   - High:
     - H1: possessive tickers did not match;
     - H2: many-lane starvation;
     - H3: change questions got one period;
     - H4: sector regex bugs;
     - H5: the TREND go was circular;
     - H6: the eval had a ceiling effect.
   - Medium:
     - M1: PERSISTENT was overstated;
     - M2: the common-word list was too broad;
     - M3: the injection eval rewarded the vulnerable behaviour;
     - M4: out-of-corpus companies were unflagged;
     - M5: the chunk-size write-up was spun;
     - M6: stale filings were in global scope.
   - Lows L1–L5.
   - Product answers: there is no live value before a question yet (the dashboard is still fixtures); "What's Changed" will be thin, with only two signal types; Deep Analysis was at risk on B1, H1–H3 and M2, all now fixed.
2. **Three fresh fixers**, on disjoint files (query; signals; retrieval and evals). Every finding was fixed, with regression tests. The SPEC-level part of H3 was not fixed (decision 1 below).
3. **`/code-review`** (medium): 2 findings, both fixed with tests:
   - a partial period gap dropped a named company;
   - dash-only year ranges bypassed the time-phrase rule.
4. **`pnpm gate`:** exit 0 (2026-10-02).
   - check-docs OK (13 files).
   - Lint and typecheck clean.
   - Unit tests with `REQUIRE_CORPUS=1`: core 30, cdk 35, api 26, corpus 102, web 91, rag 217.
   - `cdk:synth` and build OK; e2e 31 passed.

## Spend
Titan v2 query embeddings: 20 calls, 317 tokens, about $0.000007 (approved by Mike). No other AWS spend or writes.

## Deployment
Nothing deployed; the live site still serves the Phase 1 build.

## Decisions pending with Mike
1. **Change questions with no period named.** SPEC §26.3 reads them in the current view; a note now tells the user to name years.
   - Recommendation: amend the SPEC so that a change question with no period uses the last 2–3 annual reports, at the start of Phase 4.
2. **PERSISTENT go** on the stated basis above. Recommendation: keep it.
3. **Rerank question to Eliza (F1).** Recommendation: revisit after the Phase 4 brief evals, together with F4 before Phase 4b.

## Known limitations
- Gold labels cover 7 of the 20 questions.
- The signal labels cover AAPL, MSFT and NVDA only; TSLA clears the heading floor but is unmeasured.
- TREND accuracy is unverified where Phase 2 found wrong figures (CMCSA, DIS, PFE).
- A common-word name opening a sentence ("Target markets…") still matches.
- A bare "Apple risks 2024" is not scoped to 2024; a note tells the user to write "in 2024".
- The S3-to-Lambda cold load is still unmeasured: there is no worker yet.

## Next-phase objective (Phase 4)
- Deep Analysis prompt v1 and `GenerationGateway`.
- Schema, citation and numeric validation.
- SQS worker with claim, deadlines, generation budget and DLQ handler; it loads the index and uses `Retriever` (hybrid, one query embedding).
- Real prompt iterations logged in `docs/prompt-iterations.md`.
- `generationCallCount === 1` on every path.
- Measure latency and the in-region cold load.
- Extend `pnpm eval:retrieval` with generation checks (citation validity, numeric grounding, abstention, injection).

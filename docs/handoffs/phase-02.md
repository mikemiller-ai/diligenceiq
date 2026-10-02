# Phase 2 Handoff: Ingestion, Chunking, Embeddings, Index, Extraction

_Date: 2026-10-01 (local)_

## Why
Phase 2 builds the offline plane that everything later reads:
- the corpus parsed into filings with correct fiscal labels and sections;
- verbatim, citable chunks;
- cached Titan v2 embeddings;
- a validated hybrid index with an index summary;
- deterministic extraction (time-boxed).

## Completed
1. **Bedrock invoke entitlement verified** (2026-10-01, us-east-1):
   - Titan v2: 1024 dims, normalized, 3 tokens.
   - `us.anthropic.claude-sonnet-4-6` Converse: "OK.", 11 in / 5 out tokens, 978 ms.
   - Reproducible with `pnpm check:bedrock` (tiny spend).
2. **`packages/corpus`:**
   - Headers and overrides (GE Capital).
   - Period ends: header 192, slug 53, cover 1.
   - Fiscal labels: 52/53-week years, TGT/HD start-year naming, JNJ Jan 1–7, 10-Q quarters.
   - Preamble stripping and normalization.
   - Section detection by title, skipping TOC blocks and cross-references, with canonical item order and stub fallbacks.
   - Paragraph and sentence segmentation inside very long lines.
   - Chunker `c2`: 3,600-character target, 480 overlap, 6,000 cap, verbatim slices.
   - Boilerplate flag; zip input.
   - Financial extraction (DD-17): one statement row per metric, cross-checks, plausibility `suspect` flags.
   - Trends with fixed thresholds, from one row or table of one filing.
   - Drivers (one table that sums to consolidated revenue).
   - Risk headings for every 10-K; coverage.
3. **`packages/rag` index format:**
   - Tokenizer `t2`; BM25 with binary postings; exact cosine.
   - Embedding cache: content-hash keys, resumable, writer lock, read-only mode, run log.
   - Rate limiter on every attempt; hard `maxCalls`.
   - Adjacency, including `sameQuarterPriorYear` for 10-Qs.
   - Validation and index summary.
   - Content-hash index version (SPEC §25.2).
   - Integrity-checked loader; immutable upload planner.
4. **CLIs:**
   - `pnpm ingest`, `extract`, `index:embed`, `index:build`, `index:upload` (dry run unless `--yes`), `index:measure-load`, `fixtures:risks`, `check:bedrock`.
   - `scripts/` is typechecked in the gate.
5. **Web:**
   - Preview profiles (`fixture-v2`) now hold the complete extracted latest-10-K heading lists, replacing the Phase 1 selection: AAPL 28, MSFT 24, NVDA 25. Each heading cites a real index chunk.
   - `currentRisks.category` is nullable; unclassified headings show under "Other risks".
   - Copy says the rule can miss headings and can include a non-heading sentence.
   - Completeness conclusions stay suppressed (SPEC §8.6).
   - Evidence drawer scroll regions are keyboard-focusable.

## Index summary (`iv-9cf51c066743`, recorded per SPEC §24.4)
- **Totals:** 246 documents, 25,404 chunks, 54 companies (deep 12, partial 5, limited history 37).
- **Filing types:** 10-K 89 docs / 14,156 chunks; 10-Q 157 docs / 11,248 chunks.
- **Fiscal years:**

  | Fiscal year | Docs | Chunks |
  |---|---|---|
  | FY2014 | 1 | 178 |
  | FY2021 | 1 | 167 |
  | FY2022 | 40 | 3,623 |
  | FY2023 | 51 | 4,294 |
  | FY2024 | 63 | 6,579 |
  | FY2025 | 83 | 10,178 |
  | FY2026 | 7 | 385 |

- **Period-end source:** header 192, url-slug 53, cover-page 1.
- **Sections:**

  | Section | Docs | Chunks |
  |---|---|---|
  | Business | 86 | 1,321 |
  | Risk factors | 222 | 3,347 |
  | Properties | 84 | 160 |
  | Legal | 229 | 383 |
  | MD&A | 246 | 5,969 |
  | Market risk | 243 | 312 |
  | Financial statements | 246 | 11,272 |
  | Controls | 243 | 295 |
  | Cybersecurity | 68 | 145 |
  | Other | — | 2,200 |

- **Boilerplate chunks:** 28.
- **Filings with a missing or stub expected section:** 1. IBM 10-K: MD&A stub (210 characters) and statements stub (357), both incorporated by reference.
- **Artifact sizes:** vectors 104 MB, chunks 93 MB, BM25 1.6 MB + 26 MB postings.
- **Embeddings:** 25,388 unique texts, 19.7M tokens for this version.
- **Cold load (local disk, fresh process):** about 420 ms, including sha256 verification (~100 ms); about 900 MB added resident memory. The S3-to-Lambda load is measured once the worker exists.
- **Total embedding spend this phase:** 22.1M tokens ≈ $0.44. That covers the c1 run interrupted by DNS, the c1 resume, and the c2 re-embed after the fixes. Approved by Mike: the full run, then the ~$0.13 c2 re-embed.

## Extraction results (`pnpm extract`)
- 3,397 facts in total: 3,266 from statement rows, 131 from other tables.
- 47 cross-filing mismatches: JNJ (Kenvue restatements), PFE, TSLA, AAPL.
- Golden values match for AAPL, NVDA, MSFT, JNJ and XOM. JNJ and XOM report no operating income, so it stays "not extracted" for both.
- Annual values per company:

  | Metric | Companies |
  |---|---|
  | Revenue | 52/54 |
  | Net income | 49/54 |
  | Cash | 49/54 |
  | Operating cash flow | 38/54 |
  | Operating income | 34/54 |
  | Capital spending | 34/54 |
  | Gross profit | 16/54 |
  | Total debt | 11/54 |

- Revenue growth trends: 52/54 companies. Drivers: 9/54.
- **Risk headings:** found in 54/54 latest 10-Ks.
  - Hand-labeled precision is 0.92 and recall 0.96 (AAPL 0.96 / 1.00, MSFT 0.96 / 0.96, NVDA 0.84 / 0.91).
  - Low yields: CVX, XOM, AMZN, GOOG. Topic-titled headings are hard for the extractor.

## Gate record
1. **Adversary (SPEC §48.2 questions included):**
   - Blockers:
     - B1: sections anchored on cross-references and TOC rows (JNJ, GS, ORCL, INTC, DIS and others).
     - B2: wrong figures outside the golden set (CMCSA, DIS, PFE).
   - High:
     - H1: index version did not cover the chunking code.
     - H2: heading false positives, with precision unmeasured.
     - H3: drivers mixed tables.
     - H4: upload was not immutable.
   - Medium:
     - M1: no load-time integrity check.
     - M2: corpus-backed tests could skip silently.
     - M3: dry run could mutate the cache; no lock against concurrent runs.
     - M4: retries bypassed the rate limiter.
     - M5: docs overclaimed.
     - M6: adjacency semantics undocumented.
     - M7: index version not cross-checked at build.
   - Several lows.
   - Product answers: there is little value before a question yet; the extraction layer is now the foundation.
2. **Two fresh fixers** with disjoint files:
   - Corpus fixer: B1, B2, H2, H3, docs.
   - Index fixer: H1, H4, M1–M4, M6, M7, lows.
   - Every finding is fixed, or partly fixed with measured numbers, each with regression tests.
3. **`/code-review` (medium):** 2 low findings, both fixed.
   - A rebuild of the same version no longer rewrites the manifest.
   - The driver caption filter is narrowed.
4. **E2E axe regression:** fixed. Long passages made the drawer scroll, and the scroll region was not focusable.
5. **`pnpm gate`:** exit 0.
   - check-docs OK.
   - Unit tests: core 30, cdk 35, api 23, corpus 102, rag 38, web 91.
   - cdk:synth and build OK.
   - e2e 31 passed.

## Deployment
- Nothing deployed. The live site serves the Phase 1 build.
- The index is local only. Upload is pending Mike's go-ahead (dry run verified, ~293 MB):

```bash
pnpm index:upload --bucket diligenceiq-core-databuckete3889a50-cto74g4tj9kn --yes
```

## Known limitations
- Heading extraction:
  - NVDA precision is 0.84.
  - Topic-titled headings (XOM, CVX) yield few results.
  - The preview UI says this.
- Integrated-report 10-Ks label their statements as MD&A. IBM's MD&A is incorporated by reference.
- Drivers cover 9/54 companies; total debt 11/54. These gaps are shown honestly as "Not extracted".
- `embedRuns` in the manifest covers only runs since the run log was introduced; this phase's earlier runs are summed above.
- The 252 KB `risk-headings.json` is in the client bundle until Phase 5 reads profiles from S3.

## Next-phase objective (Phase 3)
- Deterministic query analysis: companies with collision rules, sectors, periods ("last N years"), filing types and topics.
- Planner lanes, then hybrid BM25 + cosine retrieval with RRF over the in-memory index loaded from S3.
- Context builder.
- Retrieval debug endpoint.
- Retrieval evals on 15–20 questions covering every §41.1 category, including the three PDF questions and the expert question verbatim.
- Time-boxed: change detection and signal candidates. Record the go/no-go on hand-labeled AAPL, MSFT and NVDA, and heading-diff viability (G4).

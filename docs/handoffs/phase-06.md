# Phase 6 Handoff: Evidence (Adjacent Periods, Source View, Coverage Linked, Citation Integrity)

_Date: 2026-10-02 (local)_

## Why
SPEC §16 asks: *why should I trust this conclusion?* Before Phase 6, a citation opened its passage in the evidence drawer, but:
- the "Open filing" view showed only the passages the preview profiles cited;
- nothing compared a passage with the same section in another period;
- the coverage matrix was a static table.

Phase 6 makes every citation verifiable against the full filing text and against its adjacent periods. All of it is deterministic: no model call.

## Completed
1. **Core** (`packages/core/src/evidence.ts`):
   - `SourceDocumentResponseSchema` and `AdjacentEvidenceResponseSchema`.
   - The ID patterns `CHUNK_ID_PATTERN` (`\d{3,}`), `DOCUMENT_ID_PATTERN` and `INLINE_CITATION`.
   - `briefCitationIds`, which collects a brief's citations and flags malformed ones.
   - `citationMatchesSource`.
   - `BriefCoverage` cells gain an optional `chunkIds`.
2. **rag:** `toCoverage` records each cell's context chunk IDs. The seed was rebuilt with `pnpm seed:build` (replay only, 0 live calls). Only `builtAt` and the new `chunkIds` changed.
3. **corpus:**
   - `chunkCitation` and `chunkSectionLabel`.
   - Subpath exports `./chunker` and `./citation`, so the api bundle does not pull in the loader or the financials modules (bundle test).
4. **api** (`services/api/src/evidence/`):
   - **`GET /api/sources/:documentId`:** text, sections and every chunk span. An absent document returns `404 SOURCE_MISSING`; an unknown ticker returns `400`.
   - **`GET /api/evidence/adjacent?chunkId=`:** `previous`, `next`, and `sameQuarterPriorYear` for 10-Qs.
   - **Where the data comes from:**
     - processed filings: `processed/<iv>/<documentId>.json` (already uploaded in Phase 2);
     - adjacency files: `index/<iv>/adjacency/<T>.json` (chunk IDs only);
     - passage text is recomputed with the index's own `chunkFiling`.
   - **Guards and responses:**
     - **Chunker guard:** the store reads `index/<iv>/manifest.json`. If its `chunkerVersion` is not the bundled `CHUNKER_VERSION`, both routes return `index_unavailable` rather than shifted spans.
     - **Index version:** an `?indexVersion=` that differs from the served version returns `404 reason: index_version`.
     - **403 handling:** S3 returns 403 for a missing key because the role has no `ListBucket`. That 403 is read as "missing" and logged as a warning; the same fix is applied to the Phase 5 profile reader.
     - **Caching:** 200s are sent with `cache-control: private, max-age=3600`. The store keeps an LRU of 8 filings and 6 adjacency files.
5. **CDK:** the api gets `s3:GetObject` on `index/<iv>/adjacency/*` and `processed/<iv>/*`. It now has exactly 4 resources (test-enforced), no `ListBucket` and no Bedrock.
6. **Web:**
   - **Evidence drawer:**
     - **Compare periods:** the passage sits beside the same section of the prior or following year (or quarter) and, for a 10-Q, the same quarter a year earlier. The tabs follow the APG pattern, and no similarity score is shown.
     - **Empty sides:** a side that exists but has no matching section says so, for example a section that is new this year.
     - **Provenance:** adjacent passages are labelled "for comparison, not cited". Supplied passages the brief does not cite are labelled "not cited in the brief".
     - **Signals:** evidence by period is shown side by side.
   - **Coverage matrix:**
     - A cell opens its passages, cited ones first.
     - Analyses from before Phase 6 fall back to the cell's period (YTD buckets included).
     - A cell is clickable only when every passage it counts is found.
   - **Source view** (`/sources/filing/?id=&iv=#chunk-`):
     - Shows the full processed text with section navigation and the cited passage highlighted and focused.
     - The `iv` link parameter means a citation from another index version is never highlighted; the page shows a notice instead.
     - A missing filing gets the §9.1 copy with "Go back" (shown only after an in-app page view; `lib/in-app-history.ts`).
7. **Tests:**
   - api `evidence.test.ts` (synthetic plus real corpus).
   - Web `evidence-phase6.test.tsx`.
   - Core `evidence.test.ts`.
   - e2e `tests/e2e/local/evidence.spec.ts`: brief citation → compare → open in filing (highlighted); coverage cell; axe on the source view; missing filing.
   - The e2e server and the api tests process filings from the corpus. Adjacency comes from a committed subset plus the real manifest, in `tests/fixtures/evidence/iv-9cf51c066743/` (132 KB, `pnpm fixtures:evidence`).
8. **Offline integrity CLI:** `pnpm evidence:check`. No AWS; the result is `evals/results/evidence-iv-9cf51c066743.json`.

## Exit criteria
- **Every citation resolves to its passage.**
  - **In the gate (corpus-backed):** every seeded brief citation (41) and context passage (72), and every fixture-v2 profile citation, resolves through `GET /api/sources` to its exact span.
  - **Offline (`pnpm evidence:check`, pass):**
    - 25,404/25,404 index chunks are reproduced by the api's store.
    - All 106,571 adjacency references resolve to the same section kind and form.
    - Live briefs: the 1,047 cited IDs and 1,976 context IDs of the recorded live Bedrock generations (`evals/results/generation-iv-9cf51c066743-da-v1..v4.json`) all resolve.
    - Profiles: det-v2 (1,344) and llm-v3 (1,573) citations resolve to the exact span and text.
  - **Checked against S3 by the adversary (read-only):** all 246 `processed/` and all 54 `adjacency/` objects match the local files by sha256, and the llm-v3 and det-v2 profile objects match the local sets.
  - **Not covered by any repo check:** production analyses in DynamoDB. The adversary checked the IDs of the 4 that exist, and all resolve.
- **Adjacent-period lookup on AAPL and JNJ:** `services/api/src/evidence.test.ts`:
  - AAPL 10-K at both ends of its history;
  - an AAPL 10-Q with its previous, next and same quarter a year earlier;
  - the first and last JNJ 10-K;
  - a JNJ 10-Q MD&A (JNJ 10-Qs have no Risk Factors section).

## Gate record
- **Adversary:**
  - 1 blocker: typecheck.
  - 2 high: the source view ignored the index version; a 403 for a missing key became a 500.
  - 5 medium: no runtime chunker guard; the coverage fallback missed YTD cells; misleading empty-side copy; check-evidence skipped malformed IDs; `SOURCE_MISSING` contract drift.
  - 10 low.
- **Fresh fixer:** fixed all of them, with tests.
- **`/code-review` (medium):** no findings.
- **`pnpm gate` (2026-10-02): exit 0.**
  - check-docs OK; lint and typecheck clean.
  - Unit tests with `REQUIRE_CORPUS=1`: core 78, cdk 43, corpus 102, rag 394, web 189, api 135 (**941**).
  - `cdk:synth` and `build` OK.
  - **e2e: 44 passed.**

## SPEC §48.2 (adversary's answers, summarized)
- There is value before a question: signal evidence by period and the source view work from profiles.
- SEC terms appear only in the drawer and the source view, on purpose.
- Nothing is generated: the routes are S3 reads plus re-chunking.
- Deep Analysis is unchanged except that it records `chunkIds`.
- The new comparison view adds insight, including sections that are new this period.

## Not deployed
Production still runs the Phase 4b go-live build. Deploying Phase 6 needs Mike's approval:
1. `pnpm deploy:infra`: api routes and IAM, and the worker, so new analyses record `chunkIds`.
2. `pnpm deploy:web`.
3. A read-only production smoke:
   - `GET /api/sources/<doc>` for a seeded citation, checking that the span equals the text;
   - `GET /api/evidence/adjacent` for AAPL and JNJ;
   - the largest filing (JPM 10-K, ~1.36 MB) within the 10 s timeout, with its cold latency recorded;
   - a missing document returning `SOURCE_MISSING`, not 500 (confirms the 403 mapping on the real role).

## Next
Deploy Phase 6 (above), then Phase 7 (evals for Deep Analysis and profiles, logging, security headers and CSP, Architecture page with measured numbers).

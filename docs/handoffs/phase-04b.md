# Phase 4b Handoff: Offline Company Intelligence Profiles

_Date: 2026-10-02 (local)_

## Why
Company Intelligence must say something real before anyone asks a question, without any page view calling a model (SPEC §32, DD-16). Phase 4b builds every company's profile offline, once per index version, and stores it in the layout the Phase 5 api already reads.

## Decisions settled first
- **F4:** settled 2026-10-02. Mike said the offline build is fine, so both sets are built.
- **Spend, each approved by Mike:**
  - Prompt v1 trial (3 calls) → v2 trial (3) → v3 trial (3) → v3 on the other 50.
  - 59 calls in all, about $6.0. Token counts are in the manifests and `docs/evaluation.md` §6.
- **Figure rule (SPEC A.4, Mike, 2026-10-02):** a figure in model text is valid if it is in FACTS or printed in a passage the same item cites and whose text was in the prompt. This is the Deep Analysis rule. It was applied by re-validating the stored outputs, with no new calls.
- **Active set:** Mike chose `llm-v3`, with `det-v2` uploaded beside it as the instant fallback. **Not uploaded or switched yet**: each is a separate approval.

## Completed
1. **Banned vocabulary** (`packages/core/src/vocabulary.ts`): the canonical SPEC §32.6 list, phrase-level, with "credit rating of" allowed. Tested in both directions.
2. **Profile build** (`packages/rag/src/profile/`):
   - It is a separate entry, `@diligenceiq/rag/profile`, so no Lambda can pull it in. A test checks this, and so does the CDK bundle test.
   - `assemble`: the deterministic profile. DD-17 facts with source rows (annual and point-in-time, latest filing wins, suspect facts excluded and named in the gaps). Dashboard and Compare labels come from `metrics`, plus growth trends for operating income, net income and operating cash flow. Only the enabled DD-18 signals are used. Narrative is templated, with the labeled General context (`library`, TEMPLATE_VERSION 2).
   - `evidence`: anchors, then three BM25 topic lanes (no query embedding, no spend).
   - `prompt`: PROFILE_PROMPT_VERSION 3, forced tool `submit_company_profile`. `prompts/company-intelligence-prompt.md` must match it (test). v1 and v2 are kept in `prompts/versions/`.
   - `validate`: rejects the whole profile when any of these fail:
     - schema;
     - nothing invented;
     - citations ⊂ the IDs printed in the message;
     - figures in FACTS or in the item's cited excerpt passages ('exact', 'scaled' or 'preceding_unit' only, points as points);
     - no figures in words;
     - trend words must match their labels;
     - the banned list.
   - `ledger` and `build`:
     - A conditional ledger entry is written before every call, and an existing entry means no call.
     - The outcome is stored (locally first, then in S3) and re-validated for free on later runs.
     - The recomputed request hash marks a stale outcome.
     - A claim error means no call.
     - `--max-calls` is required, there is no `--force`, and each request has a 300 s timeout.
   - `evaluate`: the `pnpm eval:profiles` metrics against `evals/profiles.yaml`.
3. **CLI** (`scripts/intelligence/build-profiles.ts`, `pnpm intelligence:build`):
   - Dry run unless `--yes`.
   - The ledger bucket is pinned to CoreStack's DataBucket.
   - `--tickers` writes partial sets, which `profiles:upload-set` refuses.
   - `pnpm prompts:render` renders both prompts.
4. **Web:**
   - The dashboard shows the model-written summary and the Management outlook with labels.
   - The performance table shows the trend basis where there is no single figure.
   - The footer says "deterministic fallback" inside an llm set.
   - Compare says "Not summarized" instead of "Not extracted" and labels model text.
   - The landing says every company in the review window (53) has a profile. **This is true only after the pointer switch:** deploy web after it.
5. **Local preview:** `.claude/launch.json` `web-local-profiles` serves `.index/intelligence/iv-9cf51c066743/llm-v3` through the real api app (`E2E_PROFILE_SET` / `E2E_PROFILE_ROOT`).

## Results (iv-9cf51c066743, 53 companies; GE Capital has no profile, assumptions G2)
| | det-v2 | llm-v3 |
|---|---|---|
| Model-written | 0 | 42 |
| Citations / figures / banned | 100% / 100% / 0 | 100% / 100% / 0 |
| Tier correctness, calls per profile | 53/53, 0 | 53/53, ≤ 1 |
| Deep-tier fallback | n/a | 3/12 = 25% (JNJ, KO, UNH): missed the provisional ≤ 10%; Mike revised the bar to ≤ 25% (SPEC A.4) |

The 11 llm-v3 fallbacks:
- **Figures in words:** BA, KO, LLY, ORCL, PG, UNH.
- **Figures with no grounding:** JNJ, RTX, VZ, TGT.
- **Invented drivers:** DE.

Prompt rules 7–9 are only partly enforced; examples are in `docs/evaluation.md` §6.

## Gate
- Process: adversary (1 blocker: the bar, since revised by Mike; 5 high) → fresh fixer (all fixed, with tests) → `/code-review` medium (no findings) → `pnpm gate` exit 0.
- Unit tests: core 75, cdk 43, corpus 102, rag 393, web 172, api 116 (**901**).
- `cdk:synth` and the build pass; e2e 39 passed.

## Open (Mike)
- **The bar:** revised by Mike to ≤ 25% after this build (SPEC A.4); the 10% miss stays recorded.
- **Deploy order** (each step needs approval):
  1. `pnpm profiles:upload-set --root .index/intelligence --set iv-9cf51c066743/det-v2 --yes`;
  2. the same for `llm-v3`;
  3. `aws ssm put-parameter --region us-east-1 --name /diligenceiq/active-profile-set --value iv-9cf51c066743/llm-v3 --overwrite`;
  4. production smoke;
  5. `pnpm deploy:web`.
- The v3 calls predate the request hash (`promptVerified: false`); they cannot be proven unchanged by hash, and DD-16 implementation notes say so.

## Next
Phase 6.

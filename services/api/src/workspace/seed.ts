import {
  AnalysisFiltersSchema,
  AnalysisOriginSchema,
  BriefCoverageSchema,
  BriefValidationSchema,
  CitationSchema,
  CreateFindingRequestSchema,
  DiligenceBriefSchema,
} from '@diligenceiq/core';
import { z } from 'zod';
import { ANALYSIS_DEADLINE_MS, type AnalysisRecord } from '../analyses/store';
import { log } from '../http';
import { type FindingDeps, createFinding } from './findings';
import { ANALYSIS_TTL } from './store';

/**
 * The demo workspace seed (SPEC §40; architecture §8). `seed/demo-workspace.json` is built by
 * `pnpm seed:build` from REAL pipeline output: each analysis is a recorded Deep Analysis run
 * replayed through the same pipeline and validator (no hand-written answers, no live spend).
 * Findings in the seed name only their source; their text and citations are copied by the same
 * server-side code as `POST /api/findings`.
 */

const SeedAnalysisSchema = z
  .object({
    analysisId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    question: z.string().min(1).max(1000),
    filters: AnalysisFiltersSchema.optional(),
    origin: AnalysisOriginSchema,
    createdAt: z.string(),
    completedAt: z.string(),
    interpretation: z.record(z.string(), z.unknown()),
    coverage: BriefCoverageSchema,
    brief: DiligenceBriefSchema,
    citations: z.array(CitationSchema),
    validation: BriefValidationSchema,
    telemetry: z.record(z.string(), z.unknown()),
    /** The pipeline's snapshot entries: citation fields without indexVersion (it is on the snapshot), plus lane and score. */
    context: z.object({ indexVersion: z.string().min(1), passages: z.array(CitationSchema.omit({ indexVersion: true }).loose()) }).strict(),
  })
  .strict();

export const SeedSchema = z
  .object({
    seedVersion: z.string().regex(/^seed-v\d+$/),
    /** How the seed was made, shown on the Architecture page and in docs. */
    provenance: z.string().min(1),
    builtAt: z.string(),
    indexVersion: z.string().min(1),
    promptVersion: z.string().min(1),
    analyses: z.array(SeedAnalysisSchema).max(10),
    findings: z.array(CreateFindingRequestSchema).max(20),
  })
  .strict();
export type Seed = z.infer<typeof SeedSchema>;

export function parseSeed(raw: unknown): Seed {
  return SeedSchema.parse(raw);
}

/** Writes the seed into a freshly created (or cleared) workspace. */
export async function applySeed(deps: FindingDeps, workspaceId: string, seed: Seed, now: Date, requestId: string): Promise<void> {
  const ttl = ANALYSIS_TTL(now);
  for (const a of seed.analyses) {
    const { context, telemetry, interpretation, ...rest } = a;
    const record: AnalysisRecord & { seeded: true } = {
      ...rest,
      workspaceId,
      interpretation: interpretation as unknown as AnalysisRecord['interpretation'] & object,
      telemetry: telemetry as unknown as NonNullable<AnalysisRecord['telemetry']>,
      status: 'COMPLETE',
      stage: 'complete',
      queuedAt: a.createdAt,
      deadlineAt: new Date(Date.parse(a.createdAt) + ANALYSIS_DEADLINE_MS).toISOString(),
      generationCallCount: Number((telemetry as { generationCallCount?: number }).generationCallCount ?? 1),
      ttl,
      seeded: true,
    };
    await deps.workspace.putSeedAnalysis(record, context);
  }
  for (const f of seed.findings) {
    const out = await createFinding(deps, workspaceId, f, now, requestId, { skipLimit: true, seeded: true });
    // A seed finding whose source is missing (e.g. a profile set without that item) is skipped, not invented.
    if (!out.ok && out.code !== 'ALREADY_SAVED') log('warn', 'seed finding skipped', { requestId, kind: f.source.kind, code: out.code });
  }
}

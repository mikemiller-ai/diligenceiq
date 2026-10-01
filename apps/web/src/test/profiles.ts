import type { CompanyIntelligenceProfile } from '@diligenceiq/core';
import { FIXTURE_PROFILES } from '@/fixtures/profiles';

/*
 * TEST-ONLY: a copy of the AAPL fixture profile with a change signal and a sourced fact
 * added, to exercise the signal actions and the figure rule. The signal text is invented
 * test data and is never imported by application code.
 */
export function profileWithSignal(): CompanyIntelligenceProfile {
  const base = FIXTURE_PROFILES.get('AAPL');
  if (!base) throw new Error('AAPL fixture missing');
  const risk = base.currentRisks.find((r) => r.category === 'supply_chain');
  if (!risk) throw new Error('AAPL supply-chain risk missing');
  const chunk = risk.citationIds[0] ?? '';
  return {
    ...base,
    signals: [
      {
        signalId: 'sig-test-1',
        type: 'PERSISTENT',
        category: 'supply_chain',
        periods: ['FY2024', 'FY2025'],
        measurement: 'test measurement',
        evidenceByPeriod: [
          { period: 'FY2024', chunkIds: [] },
          { period: 'FY2025', chunkIds: [chunk] },
        ],
        investigateQuestion: 'TEST: How concentrated is manufacturing?',
        headline: 'TEST signal headline',
        whatChanged: 'TEST what changed.',
        whyThisMatters: 'TEST general context.',
        whyThisMattersSource: 'general_context',
        citationIds: [chunk],
      },
    ],
  };
}

/**
 * TEST-ONLY: the fixture profiles relabeled as a built (non-fixture) profile set, to exercise
 * the paths that depend on a complete risk-heading list (Compare themes and ranking).
 */
export function builtProfiles(): Map<string, CompanyIntelligenceProfile> {
  return new Map(
    [...FIXTURE_PROFILES].map(([t, p]) => [t, { ...p, version: { ...p.version, profileSetId: 'det-v1' } }]),
  );
}

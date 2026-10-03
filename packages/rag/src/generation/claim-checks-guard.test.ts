import type { DiligenceBrief } from '@diligenceiq/core';
import { describe, expect, it, vi } from 'vitest';
import type * as CompanyClaims from './company-claims';
import type * as PeriodClaims from './period-claims';
import { validateBrief } from './validate';

/*
 * H2 (2026-10-03 review): a throw in any claim check never fails an analysis. Every claim-check
 * entry point is made to throw here; validateBrief must still return, with the citation and
 * numeric validation intact, each claim list empty, and one content-free notice.
 */
vi.mock('./arithmetic-claims', () => ({
  arithmeticClaimsIn: () => {
    throw new Error('secret brief text that must not leak');
  },
}));
vi.mock('./company-claims', async (importOriginal) => ({
  ...(await importOriginal<typeof CompanyClaims>()),
  uncitedCompaniesIn: () => {
    throw new Error('boom');
  },
  scopeClaimIn: () => {
    throw new Error('boom');
  },
}));
vi.mock('./period-claims', async (importOriginal) => ({
  ...(await importOriginal<typeof PeriodClaims>()),
  periodClaimIn: () => {
    throw new Error('boom');
  },
}));

describe('claim checks are guarded', () => {
  it('a throwing claim check yields empty lists and a content-free notice; citations and figures are still validated', () => {
    const id = 'NVDA-FY2025-10K-MDA-008';
    const b: DiligenceBrief = {
      title: 'NVIDIA revenue',
      executiveSummary: 'Revenue grew from ⟦9⟧ to $5 billion, up 10%.',
      answerType: 'trend',
      keyFindings: [{ title: 'Revenue', finding: 'Revenue was $130.5 billion; all five companies grew.', basis: 'reported', tickers: ['NVDA'], citationIds: [id, 'NOT-A-CHUNK'] }],
      investmentConsiderations: [],
      evidenceGaps: [],
      followUpQuestions: [],
    };
    const { validation } = validateBrief(b, [], new Map([[id, 'Revenue was $130.5 billion in fiscal 2025.']]), undefined, { scopeTickers: ['NVDA', 'AMD'] });
    expect(validation.citations.removed).toEqual([{ location: 'keyFindings[0]', id: 'NOT-A-CHUNK' }]);
    expect(validation.numeric.figures.find((f) => f.figure === '$130.5 billion')?.verified).toBe(true);
    expect(validation.periodClaims).toEqual([]);
    expect(validation.arithmeticClaims).toEqual([]);
    expect(validation.attributionClaims).toEqual([]);
    expect(validation.scopeClaims).toEqual([]);
    const notice = validation.notices.find((n) => /could not run/.test(n));
    expect(notice).toBe('The period, arithmetic, attribution, scope claim checks could not run on this brief; their marks are not shown.');
    expect(validation.notices.join(' ')).not.toMatch(/secret|boom/);
  });
});

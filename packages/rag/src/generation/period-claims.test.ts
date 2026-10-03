import { BriefValidationSchema, type DiligenceBrief, fiscalYearOfChunkId } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { citedFiscalYears, periodClaimIn, periodMentionsIn, periodsIn, sentencesOf } from './period-claims';
import { validateBrief } from './validate';

/*
 * The period-claim check (architecture §6.9; 2026-10-03). The Apple cases are the real da-v4 and
 * da-v5 `expert-1` items the manual review found (evaluation.md §8, §11), word for word, with their
 * real citations.
 */

const AI_ABSENT = {
  title: 'AI/ML Regulatory Risk Added as New Compliance Dimension in FY2024–FY2025',
  finding:
    "Beginning in FY2024, Apple's compliance risk disclosures explicitly reference machine learning and artificial intelligence as areas requiring navigation of new legal, regulatory, and ethical considerations. FY2025 further notes that AI features can increase risks of inadvertent personal data disclosure and that novel IP claims may be exacerbated as AI is integrated into products. This dimension is absent from the FY2023 filing.",
  citationIds: ['AAPL-FY2024-10K-1A-016', 'AAPL-FY2025-10K-1A-013', 'AAPL-FY2025-10K-1A-018'],
};
const TARIFF_NOT_PRESENT = {
  title: 'FY2025 Adds New Tariff Risk Section Absent from Prior Years',
  finding:
    "FY2025 introduced a dedicated 'Tariffs and Other Measures' section in the MD&A, disclosing that beginning in the second quarter of 2025, new U.S. tariffs were announced on imports from China, India, Japan, South Korea, Taiwan, Vietnam, and the EU, among others, and that several countries have imposed or threatened reciprocal tariffs. The filing notes that a U.S. Department of Commerce investigation under Section 232 has been initiated into semiconductor imports and their derivative products. This risk category was not present in FY2023 or FY2024 filings.",
  citationIds: ['AAPL-FY2025-10K-MDA-001'],
};
/** da-v4's court-order item, word for word, with its one FY2025 citation. */
const COURT_ORDER_ABSENT = {
  title: 'U.S. Court Order on App Store Commissions Appears in FY2025',
  finding:
    'FY2025 introduced a materially new disclosure absent from FY2023 and FY2024: Apple is currently subject to a court order preventing it from imposing any commission or fee on certain purchases that consumers make through the U.S. storefront of the iOS and iPadOS App Store. This represents a concrete, legally binding operational constraint, not merely a hypothetical risk.',
  citationIds: ['AAPL-FY2025-10K-1A-016'],
};
/** da-v5's misattribution: FY2024's 1A-017, which this finding cites, already names Google LLC. A contradiction, not an uncited period. */
const GOOGLE_FIRST_YEAR = {
  title: 'Google Antitrust Verdict Creates New Revenue Risk in FY2025',
  finding:
    "FY2025 is the first year Apple explicitly names Google LLC as a counterparty in its search licensing revenue risk and discloses that on August 5, 2024, Google was found to have violated U.S. antitrust laws. A September 2, 2025 court order imposed remedies that are subject to further proceedings and appeal; if DOJ-proposed remedies prohibiting Google from offering Apple commercial search distribution terms were implemented, Apple's ability to earn revenue from such arrangements could be materially adversely affected. FY2023 and FY2024 referenced unnamed licensing arrangements subject to investigations without disclosing a verdict.",
  citationIds: ['AAPL-FY2025-10K-1A-017', 'AAPL-FY2025-10K-1A-018', 'AAPL-FY2024-10K-1A-017', 'AAPL-FY2023-10K-1A-018'],
};

const brief = (over: Partial<DiligenceBrief>): DiligenceBrief => ({
  title: 'Apple regulatory disclosures',
  executiveSummary: 'Summary.',
  answerType: 'trend',
  keyFindings: [],
  investmentConsiderations: [],
  evidenceGaps: [],
  followUpQuestions: [],
  ...over,
});
const finding = (f: { title: string; finding: string; citationIds: string[] }) => ({ ...f, basis: 'reported' as const, tickers: ['AAPL'] });
/** Every chunk the briefs cite, as supplied context (text does not matter to this check). */
const passages = (b: DiligenceBrief) =>
  new Map(
    [...b.keyFindings.flatMap((k) => k.citationIds), ...b.investmentConsiderations.flatMap((c) => c.citationIds), ...(b.comparison?.rows.flatMap((r) => r.citationIds) ?? [])].map((id) => [id, 'text']),
  );
const claimsOf = (b: DiligenceBrief) => validateBrief(b, [], passages(b)).validation.periodClaims;

describe('period claims: the real Apple cases', () => {
  it('flags "absent from the FY2023 filing" with no FY2023 citation', () => {
    expect(claimsOf(brief({ keyFindings: [finding(AI_ABSENT)] }))).toEqual([{ location: 'keyFindings[0].finding', periods: ['FY2023'], cue: 'absent' }]);
  });

  it('flags the tariff "not present in FY2023 or FY2024" claim citing only FY2025', () => {
    expect(claimsOf(brief({ keyFindings: [finding(TARIFF_NOT_PRESENT)] }))).toEqual([{ location: 'keyFindings[0].finding', periods: ['FY2023', 'FY2024'], cue: 'not present' }]);
  });

  it('flags the court-order "absent from FY2023 and FY2024" claim citing only FY2025 ("absent from" is the claim, not a comparison)', () => {
    expect(claimsOf(brief({ keyFindings: [finding(COURT_ORDER_ABSENT)] }))).toEqual([{ location: 'keyFindings[0].finding', periods: ['FY2023', 'FY2024'], cue: 'introduced' }]);
  });

  it('does not flag "the first year … names Google LLC": every period it names is cited (a contradiction this rule does not catch)', () => {
    expect(claimsOf(brief({ keyFindings: [finding(GOOGLE_FIRST_YEAR)] }))).toEqual([]);
  });

  it('flags an absence cell under a period column with no citation from that period, and not the covered columns', () => {
    const b = brief({
      comparison: {
        kind: 'trend',
        columns: ['FY2023', 'FY2024', 'FY2025'],
        rows: [{ label: 'AI/ML Regulatory Risk', values: ['Not disclosed', 'New legal, regulatory and ethical considerations for ML/AI features noted', 'AI features increase IP claim risks'], citationIds: AI_ABSENT.citationIds }],
      },
    });
    expect(claimsOf(b)).toEqual([{ location: 'comparison.rows[0].values[0]', periods: ['FY2023'], cue: 'not disclosed' }]);
  });

  it('reads the executive summary against every cited passage in the brief', () => {
    const b = brief({ executiveSummary: 'Tariff risk was absent from the FY2023 10-K.', keyFindings: [finding(TARIFF_NOT_PRESENT)] });
    const claims = claimsOf(b)!;
    expect(claims.find((c) => c.location === 'executiveSummary')).toEqual({ location: 'executiveSummary', periods: ['FY2023'], cue: 'absent' });
    // Once some item cites an FY2023 passage, the summary's FY2023 claim is covered.
    const covered = brief({ ...b, investmentConsiderations: [{ text: 'Export rules apply.', citationIds: ['AAPL-FY2023-10K-1A-016'] }] });
    expect(claimsOf(covered)!.some((c) => c.location === 'executiveSummary')).toBe(false);
  });

  it('adds a notice and stays schema-valid; a stored validation without the field still parses', () => {
    const { validation } = validateBrief(brief({ keyFindings: [finding(AI_ABSENT)] }), [], passages(brief({ keyFindings: [finding(AI_ABSENT)] })));
    expect(validation.notices.some((n) => /period not cited/.test(n))).toBe(true);
    expect(BriefValidationSchema.parse(validation).periodClaims).toHaveLength(1);
    const { periodClaims: _omit, ...older } = validation;
    expect(BriefValidationSchema.parse(older).periodClaims).toBeUndefined();
  });
});

describe('period claims: what is not flagged', () => {
  const none = (text: string, ids: string[] = ['AAPL-FY2025-10K-1A-017']) => periodClaimIn(text, citedFiscalYears(ids));

  it('ordinary change verbs are not cues', () => {
    expect(none('FY2024 revenue rose 6% to $391 billion, and FY2023 services grew.')).toBeNull();
    expect(none('Inventory provisions grew from $2.2 billion in FY2024 to $3.7 billion in FY2025, and the H20 charge added $4.5 billion in Q1 FY2026.')).toBeNull();
    expect(none('R&D rose from FY2024 to FY2025, driven by engineering costs for new product introductions and new suppliers.')).toBeNull();
  });

  it('a statement about the excerpts or the corpus is an honest scope statement', () => {
    expect(none('FY2023 is not disclosed in the supplied excerpts.')).toBeNull();
    expect(none('The FY2015 10-K is absent from the corpus.')).toBeNull();
    expect(none('FY2015 Filing Absent — FY2025 Risk Factors Presented Instead')).toBeNull();
    expect(none('A diligence team should assess whether these risks were absent in FY2015.')).toBeNull();
  });

  it('a cited period passes; a bare or relative year is not a period', () => {
    expect(none('The court order is new in FY2025.')).toBeNull();
    expect(none('The verdict, announced in 2024, was not mentioned in prior years.')).toBeNull();
    expect(none('Offices in New York opened in FY2023.')).toBeNull();
  });

  // Code review 2026-10-03: the cue and the period were matched independently across the sentence,
  // and "as new", "were new" and bare "added" matched ordinary uses. Each cites only one period.
  it('a comparison baseline with an ordinary "new" or "added" is not a period claim', () => {
    expect(none('iPhone revenue was $201.2 billion in FY2025, up from $200.6 billion in FY2024, as new models launched.', ['AAPL-FY2025-10K-MDA-001'])).toBeNull();
    expect(none('Services revenue grew 12% in FY2025 versus FY2024, with new subscriptions added across regions.', ['AAPL-FY2025-10K-MDA-001'])).toBeNull();
    expect(none('Gross margin was 46.2% in FY2025, up from 45.6% in FY2024; services were new to the mix.', ['AAPL-FY2025-10K-MDA-001'])).toBeNull();
    expect(none('Tariffs added costs in FY2025.', ['AAPL-FY2024-10K-MDA-001'])).toBeNull();
  });

  it('a real cue counts only the periods tied to it, not a comparison baseline or another clause', () => {
    expect(none('A new tariff risk factor was added in FY2025, compared with FY2024.')).toBeNull();
    expect(none('Revenue was $10 billion in FY2025 versus $9 billion in FY2024, and a new risk factor on tariffs appeared in FY2025.')).toBeNull();
    expect(none('Gross margin was 46.2% in FY2025, up from 45.6% in FY2024, as a new risk factor on tariffs appeared.')).toBeNull();
    expect(none('Inventory rose from $2.2 billion in FY2024 to $3.7 billion in FY2025, while a new export-control risk factor emerged.')).toBeNull();
  });

  it('a 10-Q citation covers its fiscal year', () => {
    expect(periodClaimIn('Export rules for the H20 were introduced in fiscal 2026.', citedFiscalYears(['NVDA-FY2026Q1-10Q-MDA-004']))).toBeNull();
  });
});

describe('period claims: what is tied to the cue', () => {
  const claim = (text: string, ids: string[] = ['AAPL-FY2025-10K-1A-017']) => periodClaimIn(text, citedFiscalYears(ids));

  it('a prepositional "as a" does not split the cue from its period (da-v5 tariffs, word for word)', () => {
    expect(claim('This category of risk does not appear as a distinct disclosure in the FY2023 or FY2024 filings.', ['AAPL-FY2025-10K-MDA-001'])).toEqual({ periods: ['FY2023', 'FY2024'], cue: 'does not appear' });
  });

  it('a period in a leading phrase within a few words of the cue is tied to it', () => {
    expect(claim('In FY2023, tariff risk was absent.')).toEqual({ periods: ['FY2023'], cue: 'absent' });
  });

  it('a disclosure-sense "new" or "added" is a cue; the comparison baseline in the same sentence is not', () => {
    expect(claim('Tariff risk was new in FY2024, compared with FY2023.')).toEqual({ periods: ['FY2024'], cue: 'new in' });
    expect(claim('Apple added a dedicated tariff risk section in FY2024.')).toEqual({ periods: ['FY2024'], cue: 'added a dedicated tariff risk' });
    expect(claim('A tariff risk factor was added in FY2024.')).toEqual({ periods: ['FY2024'], cue: 'was added' });
  });

  it('a table cell\'s elliptical "added" reads its column period', () => {
    expect(periodClaimIn('A800, H800, L4, L40S, RTX 4090, GB200, B200 added', citedFiscalYears(['NVDA-FY2025-10K-1A-020']), [2024])).toEqual({ periods: ['FY2024'], cue: 'added' });
    expect(periodClaimIn('Blackwell (GB200 NVL72, B200) added later', citedFiscalYears(['NVDA-FY2025-10K-1A-020']), [2024])).toEqual({ periods: ['FY2024'], cue: 'added' });
  });
});

describe('period references', () => {
  it('reads FY labels, fiscal years, filing years, lists and ranges', () => {
    expect(periodsIn('not present in FY2023 or FY2024 filings')).toEqual([2023, 2024]);
    expect(periodsIn('absent in fiscal 2023 or 2024')).toEqual([2023, 2024]);
    expect(periodsIn('new across FY2023–FY2025')).toEqual([2023, 2024, 2025]);
    expect(periodsIn('from 2023 through 2025')).toEqual([2023, 2024, 2025]);
    expect(periodsIn('the 2023 10-K and FY24')).toEqual([2023, 2024]);
    expect(periodsIn('Q1 FY2026 and fiscal years 2024 and 2025')).toEqual([2024, 2025, 2026]);
    expect(periodsIn('announced in 2024')).toEqual([]);
  });

  it('keeps a list or range with its head', () => {
    expect(periodMentionsIn('absent from FY2023 and FY2024, up from FY2022').map((m) => m.years)).toEqual([[2023, 2024], [2022]]);
  });

  it('splits sentences without breaking "U.S." and reads chunk fiscal years', () => {
    expect(sentencesOf('U.S. tariffs were new in FY2025. FY2023 did not mention them.')).toEqual(['U.S. tariffs were new in FY2025.', 'FY2023 did not mention them.']);
    expect(sentencesOf('Margin rose in FY2025; services were new to the mix.')).toEqual(['Margin rose in FY2025;', 'services were new to the mix.']);
    expect(fiscalYearOfChunkId('AAPL-FY2024-10K-1A-017')).toBe(2024);
    expect(fiscalYearOfChunkId('NVDA-FY2026Q3-10Q-MDA-012')).toBe(2026);
    expect(fiscalYearOfChunkId('PLANTED-AAPL-001')).toBeNull();
  });
});

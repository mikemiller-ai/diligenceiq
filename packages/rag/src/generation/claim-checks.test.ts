import { BriefValidationSchema, type DiligenceBrief } from '@diligenceiq/core';
import { describe, expect, it } from 'vitest';
import { arithmeticClaimsIn } from './arithmetic-claims';
import { companiesNamedIn, scopeClaimIn, uncitedCompaniesIn } from './company-claims';
import { validateBrief } from './validate';

/*
 * The three claim checks of 2026-10-03 (architecture §6.9; evaluation.md §13): arithmetic,
 * company attribution and sweeping claims. The real cases are recorded briefs, word for word:
 * the production rehearsal of the PDF's NVIDIA question (2026-10-03), and the da-v4 `cross-cyber`,
 * `pdf-3` and `multi-cloud` eval briefs the seed verification rejected
 * (evals/results/seed-verification-2026-10-03.md).
 */

/** The rehearsal's NVIDIA key finding 0 (production, prompt da-v4), word for word. */
const NVDA_REHEARSAL =
  'Total revenue grew from $26,974 million in FY2023 to $60,922 million in FY2024 (up 126%) and to $130,497 million in FY2025 (up 114%). The two-year cumulative expansion was driven almost exclusively by the Compute & Networking segment, which grew from $15,068 million in FY2024 to $116,193 million in FY2025 (up 145%), while the Graphics segment grew modestly from $13,517 million to $14,304 million (up 6%).';

describe('arithmetic claims', () => {
  it('flags the rehearsal NVIDIA change (145% stated, +671% computed) and passes its correct ones', () => {
    expect(arithmeticClaimsIn(NVDA_REHEARSAL)).toEqual([{ from: '$15,068 million', to: '$116,193 million', stated: 'up 145%', computed: '+671%' }]);
    expect(arithmeticClaimsIn('Total revenue grew from $26,974 million in FY2023 to $60,922 million in FY2024 (up 126%).')).toEqual([]);
    expect(arithmeticClaimsIn('The Graphics segment grew modestly from $13,517 million to $14,304 million (up 6%).')).toEqual([]);
  });

  it('reads a chain: each step against the value before it ("… (up 215%) and $116,193 million (up 145%)")', () => {
    const da4 = 'Compute & Networking segment revenue grew from $15,068 million in FY2023 to $47,405 million in FY2024 (up 215%) and $116,193 million in FY2025 (up 145%).';
    expect(arithmeticClaimsIn(da4)).toEqual([]);
    expect(arithmeticClaimsIn(da4.replace('(up 145%)', '(up 105%)'))).toEqual([{ from: '$47,405 million', to: '$116,193 million', stated: 'up 105%', computed: '+145%' }]);
  });

  it('reads the other forms: "a Z% increase", "up Z% from X", "versus X, an increase of $D", "declined Z% to Y from X", "a decrease of $D or Z% from X"', () => {
    expect(arithmeticClaimsIn('Google Cloud revenues grew from $43,229 million in 2024 to $58,705 million in 2025, a 36% increase.')).toEqual([]);
    expect(arithmeticClaimsIn('Google Cloud revenues grew from $43,229 million in 2024 to $58,705 million in 2025, a 26% increase.')).toHaveLength(1);
    expect(arithmeticClaimsIn('Total revenue reached $200.97 billion in FY2025, up 22% from $164.50 billion in FY2024 and $134.90 billion in FY2023.')).toEqual([]);
    expect(arithmeticClaimsIn('Total revenue reached $200.97 billion in FY2025, up 32% from $164.50 billion in FY2024.')).toEqual([{ from: '$164.50 billion', to: '$200.97 billion', stated: 'up 32%', computed: '+22%' }]);
    expect(arithmeticClaimsIn('YouTube ads revenues were $9,796 million in Q2 2025 versus $8,663 million in Q2 2024, an increase of $1.1 billion.')).toEqual([]);
    expect(arithmeticClaimsIn('YouTube ads revenues were $9,796 million in Q2 2025 versus $8,663 million in Q2 2024, an increase of $1.3 billion.')).toEqual([
      { from: '$8,663 million', to: '$9,796 million', stated: 'up $1.3 billion', computed: '+$1.1 billion' },
    ]);
    expect(arithmeticClaimsIn('Q3 2025 alone declined 6% to $16,654 million from $17,702 million in Q3 2024.')).toEqual([]);
    expect(arithmeticClaimsIn('Q3 2025 alone declined 9% to $16,654 million from $17,702 million in Q3 2024.')).toHaveLength(1);
    const pfe = 'Total revenues were $45,022 million, a decrease of $842 million or 2% from $45,864 million in the comparable prior-year period.';
    expect(arithmeticClaimsIn(pfe)).toEqual([]);
    expect(arithmeticClaimsIn(pfe.replace('$842', '$942'))).toEqual([{ from: '$45,864 million', to: '$45,022 million', stated: 'down $942 million', computed: '-$842 million' }]);
  });

  it('checks a percentage-point change as a difference, never as a relative change', () => {
    expect(arithmeticClaimsIn('Operating margin expanded from 24.0% to 26.9% (up 2.9 pp).')).toEqual([]);
    expect(arithmeticClaimsIn('Operating margin expanded from 24.0% to 26.9% (up 290 basis points).')).toEqual([]);
    expect(arithmeticClaimsIn('Operating margin expanded from 24.0% to 26.9% (up 2.9 percentage points).')).toEqual([]);
    expect(arithmeticClaimsIn('Operating margin expanded from 24.0% to 26.9% (up 12.1 pp).')).toEqual([{ from: '24.0%', to: '26.9%', stated: 'up 12.1 pp', computed: '+2.9 pp' }]);
    // A "%" change on two percentages passes on either reading: relative (+10%) or points (+6).
    expect(arithmeticClaimsIn('Gross margin rose from 60.0% to 66.0% (up 10%).')).toEqual([]);
    expect(arithmeticClaimsIn('Gross margin rose from 60.0% to 66.0% (up 6%).')).toEqual([]);
    expect(arithmeticClaimsIn('Gross margin rose from 60.0% to 66.0% (up 8%).')).toEqual([{ from: '60.0%', to: '66.0%', stated: 'up 8%', computed: '+10% (+6 pp)' }]);
  });

  it('honours precision, hedges and direction', () => {
    // Printed values are intervals: $4.5 billion to $5.0 billion is +9.9% to +12.4%, so "up 12%" passes.
    expect(arithmeticClaimsIn('Revenue rose from $4.5 billion to $5.0 billion, up 12%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from $100 million to $150 million, up about 45%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from $100 million to $150 million, up about 30%.')).toHaveLength(1);
    expect(arithmeticClaimsIn('Revenue grew from $100 million to $150 million, up more than 40%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue fell from $10 billion to $12 billion (down 20%).')).toEqual([{ from: '$10 billion', to: '$12 billion', stated: 'down 20%', computed: '+20%' }]);
    // A value with no scale word takes its partner's.
    expect(arithmeticClaimsIn('Revenue grew from $5.2 to $6.1 billion, up 17%.')).toEqual([]);
  });

  it('checks "more than doubled / tripled / quadrupled" tied to a from/to pair', () => {
    expect(arithmeticClaimsIn('Segment operating income more than doubled, rising from $6,112 million to $13,910 million over the same period.')).toEqual([]);
    expect(arithmeticClaimsIn('Segment operating income more than doubled from $6.1 billion to $11.9 billion.')).toEqual([{ from: '$6.1 billion', to: '$11.9 billion', stated: 'more than doubled', computed: 'x1.95' }]);
  });

  it('skips what it cannot pair or compare precisely', () => {
    // One value only; or a share, not a change; or a pair with no stated change.
    expect(arithmeticClaimsIn('Total revenues fell to $58,496 million in FY2023, a decrease of 42% compared to 2022.')).toEqual([]);
    expect(arithmeticClaimsIn('The three largest U.S. wholesalers collectively grew from 17% of revenues in 2022 to 39% in 2023.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from $15,068 million to $116,193 million (gross margin up 3%).')).toEqual([]);
    expect(arithmeticClaimsIn('Year-on-year revenue growth stepped down from 69% in Q1 FY2026 to 56% in Q2 FY2026 and 62% in Q3 FY2026.')).toEqual([]);
    // A year-over-year change between two quarters in a row is about other periods.
    expect(arithmeticClaimsIn('Revenue rose from $39.1 billion in Q1 to $41.1 billion in Q2 (up 56% year-on-year).')).toEqual([]);
    // Another measure: operational, constant currency.
    expect(arithmeticClaimsIn('Total revenues were $45.0 billion versus $45.9 billion in the comparable 2024 period, a decrease of approximately 9% operationally.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue rose from $5 billion to $6 billion in FY2025, up 10% on a constant-currency basis.')).toEqual([]);
    // A range is not a signed value, and a loss is not compared.
    expect(arithmeticClaimsIn('Customers each represented 11–22% of revenue, up from 10%.')).toEqual([]);
    expect(arithmeticClaimsIn('Operating income moved from a loss of $1.2 billion to $3.0 billion (up 50%).')).toEqual([]);
  });

  it('H3 + M1: skips a change about another base, measure, period or part (every adversary false alarm), and keeps the NVIDIA flag', () => {
    const skipped = [
      // A different period granularity in a chain, or a span of several years.
      'Total revenue grew from $26.97 billion in FY2023 to $60.92 billion in FY2024 (up 126%) and to $130.50 billion in FY2025, up 384% over two years.',
      'Revenue grew from $26.97 billion in FY2023 to $130.50 billion in FY2025 (up 114% in FY2025 alone).',
      'Revenue grew from $26.97 billion in FY2023 to $130.50 billion in FY2025 (up 114% in the most recent year).',
      'Revenue grew from $26.97 billion in FY2023 to $130.50 billion in FY2025, up 114% in the latest year.',
      'Revenue grew from $60.9 billion to $130.5 billion (up 114%) and $35.1 billion in Q3 alone (up 94%).',
      'Revenue rose from $60.9 billion in FY2024 to $130.5 billion in FY2025 (up 114%), then to $44.1 billion in Q1 FY2026 (up 69%).',
      'Revenue rose from $5.0 billion in 2023 to $6.0 billion in 2025 (up 9% in 2025).',
      'Revenue rose from $5.0 billion in 2023 to $6.0 billion in 2025 (up 9% in the last year).',
      // A chain into another measure.
      'Revenue grew from $26.97 billion to $60.92 billion (up 126%) and $29.76 billion in net income (up 581%).',
      // Per share, currency-adjusted, pro forma, acquisitions.
      'Net income rose from $29.8 billion to $72.9 billion, up 145%, or 147% per diluted share.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 15% in local currency.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 15% (cc).',
      'Revenue grew from $211.9 billion to $245.1 billion, up 18% at constant exchange rates.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 18% in fixed currency.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 13% net of currency.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 18% FX-neutral.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 18% pro forma.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 18% including acquisitions.',
      // A part of the span: a quarter, a half, a segment.
      'Revenue grew from $211.9 billion to $245.1 billion, up 20% in the second half.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 21% in Q4.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 21% in the fourth quarter.',
      'Revenue grew from $211.9 billion to $245.1 billion, up 33% in Azure.',
    ];
    for (const s of skipped) expect(arithmeticClaimsIn(s), s).toEqual([]);
    expect(arithmeticClaimsIn(NVDA_REHEARSAL)).toHaveLength(1);
    // Real disagreements in the same shapes stay flagged.
    expect(arithmeticClaimsIn('Comirnaty sales fell 64% to $3.4 billion from $11.2 billion.')).toEqual([{ from: '$11.2 billion', to: '$3.4 billion', stated: 'down 64%', computed: '-70%' }]);
    expect(arithmeticClaimsIn('Revenue rose from $60.9 billion in FY2024 to $130.5 billion in FY2025 (up 114%), then to $160.0 billion in FY2026 (up 50%).')).toEqual([
      { from: '$130.5 billion', to: '$160.0 billion', stated: 'up 50%', computed: '+23%' },
    ]);
  });

  it('review fix 1: two companies side by side, or a range across items, is never read as a change', () => {
    for (const s of [
      'Apple reported revenue of $416.2 billion versus $281.7 billion for Microsoft, up 6%.',
      "Apple's gross margin was 46.2% versus 69.8% at Microsoft, up 2.0 pp.",
      "JPMorgan's net income was $58.5 billion compared with $17.9 billion at Goldman, up 18%.",
      'Capex ranged from $20.0 billion at Apple to $60.0 billion at Amazon, up 15% on average.',
    ]) {
      expect(arithmeticClaimsIn(s), s).toEqual([]);
    }
    // A period or a date after a value is not a company: the same shapes still flag.
    expect(arithmeticClaimsIn('Revenue grew from $5.0 billion for FY2024 to $6.0 billion for FY2025, up 3%.')).toEqual([{ from: '$5.0 billion', to: '$6.0 billion', stated: 'up 3%', computed: '+20%' }]);
    expect(arithmeticClaimsIn('Revenue was $6.0 billion versus $5.0 billion, up 3%.')).toEqual([{ from: '$5.0 billion', to: '$6.0 billion', stated: 'up 3%', computed: '+20%' }]);
  });

  it('review fix 2: a change in another measure named right after it ("in units", "per unit", "increase in volume") is skipped', () => {
    for (const s of [
      'Revenue was $6.0 billion versus $5.0 billion, up 3% in units.',
      'Net sales rose from $5.0 billion to $6.0 billion, a 4% increase in volume.',
      'Net sales rose from $5.0 billion to $6.0 billion, up 8% per unit.',
      'iPhone net sales grew from $200.6 billion to $201.2 billion, up 3% in units.',
      'Net sales rose from $5.0 billion to $6.0 billion, a 2% increase in gross margin.',
    ]) {
      expect(arithmeticClaimsIn(s), s).toEqual([]);
    }
    // A period word keeps its handling: the plain change is still checked.
    expect(arithmeticClaimsIn('Net sales rose from $5.0 billion to $6.0 billion, a 4% increase.')).toHaveLength(1);
    expect(arithmeticClaimsIn('Net sales rose from $5.0 billion in FY2024 to $6.0 billion in FY2025, up 4% in the year.')).toHaveLength(1);
  });

  it('review fix 3: a hedge on either value widens that value ("from about X to over Y", "from nearly X")', () => {
    expect(arithmeticClaimsIn('Revenue grew from about $5.0 billion to over $6.5 billion, up 35%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from nearly $5.0 billion to $6.0 billion, up 25%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from about $5.0 billion to $6.0 billion, up 50%.')).toHaveLength(1);
    expect(arithmeticClaimsIn(NVDA_REHEARSAL)).toEqual([{ from: '$15,068 million', to: '$116,193 million', stated: 'up 145%', computed: '+671%' }]);
    expect(arithmeticClaimsIn('Comirnaty sales fell 64% to $3.4 billion from $11.2 billion.')).toEqual([{ from: '$11.2 billion', to: '$3.4 billion', stated: 'down 64%', computed: '-70%' }]);
  });

  it('H2: a literal skeleton marker in the text is never read as a token, and odd input never throws', () => {
    expect(arithmeticClaimsIn('Revenue grew from ⟦9⟧ to $5 billion, up 10%.')).toEqual([]);
    expect(arithmeticClaimsIn('Revenue grew from $5 billion to ⟦7⟧ (up 10%).')).toEqual([]);
    expect(arithmeticClaimsIn('from ⟦0⟧ to ⟦1⟧ (up ⟦2⟧)')).toEqual([]);
    for (const s of FUZZ) expect(() => arithmeticClaimsIn(s)).not.toThrow();
  });

  it('H2: validateBrief never throws on the marker sentence or the fuzz inputs, in any field, and runs every check', () => {
    const id = 'AAPL-FY2025-10K-1A-001';
    for (const text of ['Revenue grew from ⟦9⟧ to $5 billion, up 10%.', ...FUZZ]) {
      const b: DiligenceBrief = {
        title: text,
        executiveSummary: text,
        answerType: 'comparison',
        keyFindings: [{ title: text, finding: text, basis: 'reported', tickers: ['AAPL'], citationIds: [id] }],
        investmentConsiderations: [{ text, citationIds: [id] }],
        evidenceGaps: [text],
        followUpQuestions: [],
        comparison: { kind: 'table', columns: ['Apple (AAPL)', 'Visa (V)'], rows: [{ label: text, values: [text, text], citationIds: [id] }] },
      };
      const { validation } = validateBrief(b, [], new Map([[id, text]]), undefined, { scopeTickers: ['AAPL', 'V', 'MA'] });
      expect(validation.notices.join(' '), text.slice(0, 60)).not.toMatch(/could not run/);
    }
  });
});

/** The adversary's fuzz inputs (2026-10-03 review): markers, signs, empties, repetition, emoji, malformed numbers. */
const FUZZ = [
  '', ' ', '.', '⟦0⟧', '⟦', '⟧⟦', 'Revenue grew from ⟦9⟧ to $5 billion, up 10%.', 'from ⟦0⟧ to ⟦1⟧ (up ⟦2⟧)', 'Revenue grew from $5 billion to ⟦7⟧ (up 10%).',
  'Revenue grew from $(1,234) million to $1,500 million, up 22%.', 'Revenue grew from −$5 billion to $6 billion, up 20%.', 'Margin went from −5% to 5%, up 10 pp.',
  'Revenue grew from $0 to $5 billion, up 100%.', 'Revenue grew from $0.0 billion to $5 billion, up 100%.', 'Revenue grew from 0% to 5%, up 5%.',
  'from $5 to $6 to $7 to $8 to $9 (up 10%) and $10 (up 11%) and $11 (up 10%)', '~~~$5 billion~~$6 billion', '++5% --6% −−7%', '\u0000￿$5​ billion',
  'Revenue grew from $5 billion to $6 billion (up 20%'.repeat(50), '$1 '.repeat(2000), `${'from $1 to '.repeat(500)}$2 (up 100%)`, `${'up 5% from '.repeat(500)}$1`,
  '😀 Revenue grew from $5 billion to $6 billion 😀 (up 20%) 😀', 'Revenue grew from $1e3 to $2e3, up 100%.', 'Revenue grew from $5,00 billion to $6 billion, up 20%.', 'Revenue grew from $.5 billion to $1 billion, up 100%.',
];

/* ------------------------------------------------------------------ companies */

const BA = ['BA-FY2025-10K-1C-002', 'BA-FY2025-10K-1C-003'];
/** da-v4 `cross-cyber` key finding 1, word for word: Visa and UnitedHealth named only in an absence frame. */
const CROSS_CYBER_KF1 =
  "Boeing discloses that cybersecurity threats extend to the safe operation of its aerospace products and services, not merely data or IT systems. The Aerospace Safety Committee receives briefings from the Chief Engineer, Chief Aerospace Safety Officer, and Chief Product Security Officer on cybersecurity threats that may pose a risk to the safe operation of aerospace products—a risk dimension absent from Visa's and UnitedHealth's disclosures.";
/** da-v4 `cross-cyber` key finding 5: its UnitedHealth sentence is about the excerpts. */
const CROSS_CYBER_KF5 =
  "Boeing explicitly identifies nation-state actors and criminal enterprises as highly organized and sophisticated threat sources. Visa notes awareness of instances where governments have directed or sponsored attacks against its financial institution clients. UnitedHealth's disclosures do not specifically name nation-state actors as a threat source in the excerpts provided.";
const cyberScope = new Set(['V', 'UNH', 'BA']);
const pdf1Scope = new Set(['AAPL', 'TSLA', 'JPM']);

describe('company attribution', () => {
  const ctx = (cited: string[], passages: string[] = [], inScope: ReadonlySet<string> = cyberScope) => ({ cited: new Set(cited), passages, inScope });
  const tickers = (text: string, c: Parameters<typeof uncitedCompaniesIn>[1]) => uncitedCompaniesIn(text, c).map((x) => x.ticker);

  it('flags the real unsupported positive claims the recorded briefs make (evaluation.md §13), with the text that named the company', () => {
    // da-v1 pdf-1 key finding 4 (cites Tesla and JPMorgan only).
    expect(uncitedCompaniesIn('Apple and Tesla highlight ransomware, unauthorized access, and supply-chain attacks threatening operational continuity and intellectual property.', ctx(['TSLA', 'JPM'], [], pdf1Scope))).toEqual([{ ticker: 'AAPL', text: 'Apple' }]);
    // da-v3 pdf-3 key finding 0 (cites Pfizer, Merck, AbbVie).
    expect(tickers('PFE, MRK, LLY, and ABBV all flag the U.S. Inflation Reduction Act (IRA) and related government pricing initiatives as material risks.', ctx(['PFE', 'MRK', 'ABBV'], [], new Set(['PFE', 'MRK', 'LLY', 'ABBV', 'JNJ'])))).toEqual(['LLY']);
    // da-v4 pdf-1 key finding 2: the positive clause before ", but neither …" (cites JPMorgan only).
    expect(tickers('Apple and Tesla face regulatory and legal risks, but neither describes a risk framework of comparable breadth or systemic regulatory intensity.', ctx(['JPM'], [], pdf1Scope))).toEqual(['AAPL', 'TSLA']);
  });

  it('H1: never flags a company named only in a negation, absence or contrast frame (every such recorded sentence, word for word)', () => {
    const none = [
      'Neither Apple nor JPMorgan discloses a comparable single-executive dependency risk.',
      "This regulatory overlay—including the risk of penalties from governmental authority investigations—has no direct analog in Apple's or Tesla's risk disclosures.",
      "JPMorgan's risk disclosures do not include analogous physical supply-chain concentration risk.",
      'Apple and JPMorgan do not disclose comparable dependency on a single unproven technology platform for future growth.',
      'A breach compromising products or services could affect the safe operation of aircraft, a consequence with no direct analog at Visa or UnitedHealth.',
      'No equivalent confirmed material incident is disclosed in the Visa or Boeing filings for their respective reporting periods.',
      "Tesla's key-person concentration in Elon Musk represents a governance risk with no direct parallel at Apple or JPMorgan.",
      'This regulatory perimeter is substantially broader and more structurally embedded than the compliance risks disclosed by Apple or Tesla.',
      "This is a structural accounting consideration distinct from JPMorgan's exposure.",
      "This bundled approach differentiates Microsoft's go-to-market from AWS and Google Cloud, which are more narrowly defined enterprise cloud platforms.",
      "The bundled nature of 'Microsoft Cloud' makes it difficult to isolate pure infrastructure cloud economics, which is a key consideration when benchmarking against AWS or Google Cloud.",
      'Its Aerospace Safety Committee provides dedicated board-level oversight of product-security cyber threats, a governance layer absent at Visa and UnitedHealth.',
      'Unlike Apple, Tesla does not report segment services revenue.',
      'Microsoft grew faster than Alphabet in the period.',
      'Azure revenue was compared with AWS in the analyst note.',
      'Boeing faces product-safety cyber risk versus Visa, whose exposure is payment fraud.',
    ];
    const scope = new Set(['AAPL', 'TSLA', 'JPM', 'V', 'UNH', 'BA', 'MSFT', 'AMZN', 'GOOG', 'WMT']);
    for (const s of none) expect(tickers(s, ctx(['TSLA', 'BA', 'MSFT', 'WMT'], [], scope)), s).toEqual([]);
    // The rehearsal pdf-1 consideration: the subject (JPMorgan) is cited; Apple and Tesla are the contrast.
    expect(tickers("JPMorgan's risk profile is structurally different from Apple's and Tesla's: its principal exposures are regulatory capital adequacy, credit cycle sensitivity, and liquidity constraints.", ctx(['JPM'], [], pdf1Scope))).toEqual([]);
    // The title "…; JPMorgan Does Not".
    expect(tickers('Apple and Tesla Share Supply-Chain Concentration Risk; JPMorgan Does Not', { ...ctx(['AAPL', 'TSLA'], [], pdf1Scope), title: true })).toEqual([]);
    expect(tickers(CROSS_CYBER_KF1, ctx(['BA']))).toEqual([]);
  });

  it('does not read a sentence about the excerpts ("in the excerpts provided") as a claim about a company', () => {
    expect(tickers(CROSS_CYBER_KF5, ctx(['BA', 'V']))).toEqual([]);
  });

  it('does not flag a company the cited passage itself names (the filer on a counterparty)', () => {
    const google = 'FY2024 names Google LLC as the search licensing counterparty.';
    expect(tickers(google, ctx(['AAPL'], ['… licensing arrangements with Google LLC and other companies to offer their search services …'], new Set(['AAPL'])))).toEqual([]);
    expect(tickers(google, ctx(['AAPL'], ['Apple licenses search services.'], new Set(['AAPL'])))).toEqual(['GOOG']);
  });

  it('review fix 5: an ambiguous ticker in a cited passage counts only in company context ("Boston, MA" is not Mastercard)', () => {
    const scope = new Set(['V', 'MA']);
    const claim = 'Mastercard grew cross-border volume 15%.';
    const address = 'Visa Inc., P.O. Box 8999, San Francisco, CA 94128. Our Boston office is at 1 Federal Street, Boston, MA 02110.';
    expect(tickers(claim, ctx(['V'], [address], scope))).toEqual(['MA']);
    // A passage that names Mastercard (or lists MA as a company) still exempts the claim.
    expect(tickers(claim, ctx(['V'], ['Competitors include Mastercard and American Express.'], scope))).toEqual([]);
    expect(tickers(claim, ctx(['V'], ['Our competitors (V and MA) operate networks.'], scope))).toEqual([]);
  });

  it('reads AWS as Amazon, as Google Cloud reads Alphabet, and quotes the product name in the mention', () => {
    expect(uncitedCompaniesIn('Microsoft competes with AWS and Google Cloud for AI workloads.', ctx(['MSFT'], [], new Set(['MSFT', 'AMZN', 'GOOG'])))).toEqual([
      { ticker: 'AMZN', text: 'AWS' },
      { ticker: 'GOOG', text: 'Google Cloud' },
    ]);
    expect(tickers('Amazon Web Services grew 19%.', ctx(['MSFT'], [], new Set(['MSFT'])))).toEqual(['AMZN']);
    expect(tickers('Microsoft competes with AWS.', ctx(['MSFT'], ['… competitors include Amazon Web Services …'], new Set(['MSFT'])))).toEqual([]);
  });

  it('follows the C3 case rules, and never reads a common word after "the" or at an out-of-scope sentence start', () => {
    expect(companiesNamedIn('Visa requirements and apple supply chains were noted.', new Set(['V']))).toEqual(['V']);
    expect(companiesNamedIn('visa requirements and apple supply chains', new Set())).toEqual([]);
    expect(companiesNamedIn('New U.S. Tariffs Directly Target All Key Manufacturing Geographies', new Set(), true)).toEqual([]);
    expect(companiesNamedIn('Tariffs Directly Target All Key Manufacturing Geographies.', new Set())).toEqual([]);
    expect(companiesNamedIn('Unlike Apple, Tesla names one executive.', new Set())).toEqual(['AAPL', 'TSLA']);
    expect(companiesNamedIn('Dynamics 365 is a CRM application.', new Set(['MSFT']))).toEqual([]);
    expect(companiesNamedIn('CRM grew faster.', new Set(['CRM']))).toEqual(['CRM']);
    // The adversary's crafted cases (2026-10-03 review).
    expect(companiesNamedIn('Target customers include enterprises and governments.', new Set(['MSFT']))).toEqual([]);
    expect(companiesNamedIn('Amazon rainforest sourcing commitments are disclosed.', new Set(['KO']))).toEqual([]);
    expect(companiesNamedIn('The Visa Waiver Program affects travel.', new Set(['BA']))).toEqual([]);
    expect(companiesNamedIn('Chase Sapphire cardholders spend more.', new Set(['V']))).toEqual([]);
    expect(companiesNamedIn('Walmart competes with Amazon, Costco and Target on price.', new Set(['WMT']))).toEqual(['WMT', 'AMZN', 'COST', 'TGT']);
  });

  it('M3: reads an ambiguous bare ticker only in company context, never as a label or a term', () => {
    const vma = new Set(['V', 'MA', 'MS', 'CAT', 'GE', 'PFE']);
    expect(companiesNamedIn('Part V of the filing covers exhibits.', vma)).toEqual([]);
    expect(companiesNamedIn('Class V shares are unlisted.', vma)).toEqual([]);
    expect(companiesNamedIn('Revenue grew in segment A and V.', vma)).toEqual([]);
    expect(companiesNamedIn('MS patients are a growing indication.', vma)).toEqual([]);
    expect(companiesNamedIn('The CAT scan business is small.', vma)).toEqual([]);
    expect(companiesNamedIn('V grew cross-border volume.', vma)).toEqual([]);
    expect(companiesNamedIn("Visa (V) and Mastercard (MA) both run four-party networks; V's volume grew.", vma)).toEqual(['V', 'MA']);
    expect(companiesNamedIn('V and MA both disclose network-rule risk.', vma)).toEqual(['V', 'MA']);
    expect(companiesNamedIn("V's cross-border volume grew.", vma)).toEqual(['V']);
    // An unambiguous ticker still counts on its own, in scope.
    expect(companiesNamedIn('PFE notes the IRA is being implemented through guidance.', vma)).toEqual(['PFE']);
  });

  it('reads a comparison cell as about its column header company, but not an empty, absence or evidence-only cell', () => {
    const cell = (text: string) => uncitedCompaniesIn(text, { ...ctx(['TSLA']), subjects: [{ ticker: 'AAPL', text: 'Apple (AAPL)' }] });
    expect(cell('Board-level Audit Committee oversight')).toEqual([{ ticker: 'AAPL', text: 'Apple (AAPL)', column: true }]);
    for (const empty of ['No', 'No.', 'No material change.', 'Not a primary risk factor', 'None', '—', 'N/A', '.', '–?', 'Not applicable', 'Not specifically named in excerpts', 'Not disclosed as a primary risk', 'Not identified as a primary risk factor', 'No single-individual dependency disclosed', 'Not specifically disclosed as a named-individual risk', 'Does not disclose a figure']) {
      expect(cell(empty), empty).toEqual([]);
    }
  });

  it('review fix 4: a negative cell with no figure ("No", "No material change.", "None") in an Apple column whose row cites only MSFT is not flagged', () => {
    const apple = (text: string) => uncitedCompaniesIn(text, { cited: new Set(['MSFT']), passages: ['Microsoft text.'], inScope: new Set(['AAPL', 'MSFT']), subjects: [{ ticker: 'AAPL', text: 'Apple (AAPL)' }] });
    for (const neg of ['No', 'No.', 'No material change.', 'Not a primary risk factor', 'None']) expect(apple(neg), neg).toEqual([]);
    // A positive cell, or a negative one that states a figure, is still about its column.
    expect(apple('Yes')).toEqual([{ ticker: 'AAPL', text: 'Apple (AAPL)', column: true }]);
    expect(apple('No change; revenue $391.0 billion')).toEqual([{ ticker: 'AAPL', text: 'Apple (AAPL)', column: true }]);
  });

  it('in validateBrief: a positive finding is flagged with its mentions; an aligned cell with its column; a misaligned table drops the header reading', () => {
    const b: DiligenceBrief = {
      title: 'Cybersecurity',
      executiveSummary: 'Summary.',
      answerType: 'comparison',
      keyFindings: [
        { title: 'Boeing Faces Unique Cyber-Physical Safety Risk to Aerospace Products', finding: CROSS_CYBER_KF1, basis: 'reported', tickers: ['BA'], citationIds: BA },
        { title: 'Board oversight', finding: 'Visa and UnitedHealth also assign cyber oversight to board committees.', basis: 'reported', tickers: ['BA'], citationIds: BA },
      ],
      investmentConsiderations: [],
      evidenceGaps: [],
      followUpQuestions: [],
      comparison: {
        kind: 'table',
        columns: ['Visa (V)', 'UnitedHealth (UNH)', 'Boeing (BA)'],
        rows: [{ label: 'Board structure', values: ['Corporate Risk Committee', 'Not disclosed', 'Aerospace Safety Committee'], citationIds: BA }],
      },
    };
    const passages = new Map(BA.map((id) => [id, 'Boeing text.']));
    const { validation } = validateBrief(b, [], passages, undefined, { scopeTickers: ['V', 'UNH', 'BA'] });
    expect(validation.attributionClaims).toEqual([
      { location: 'keyFindings[1].finding', companies: ['V', 'UNH'], mentions: [{ ticker: 'V', text: 'Visa' }, { ticker: 'UNH', text: 'UnitedHealth' }] },
      { location: 'comparison.rows[0].values[0]', companies: ['V'], mentions: [{ ticker: 'V', text: 'Visa (V)', column: true }] },
    ]);
    expect(validation.notices.some((n) => /cites no … passage/.test(n))).toBe(true);
    const misaligned = { ...b, comparison: { ...b.comparison!, rows: [...b.comparison!.rows, { label: 'Short', values: ['x'], citationIds: BA }] } };
    expect(validateBrief(misaligned, [], passages, undefined, { scopeTickers: ['V', 'UNH', 'BA'] }).validation.attributionClaims!.map((c) => c.location)).toEqual(['keyFindings[1].finding']);
  });
});

/** da-v4 `pdf-3` key finding 0, word for word: "All five companies", citing four (no Johnson & Johnson). */
const PDF3_KF0 =
  "All five companies cite government-driven pricing pressure—including the IRA's Medicare drug negotiation provisions, Medicaid rebate programs, the 340B Federal Drug Discount Program, and international price controls—as material risks to revenues. Merck specifically flags that the 340B program and state Prescription Drug Affordability Boards are having a negative impact on performance, while Pfizer notes the EU's proposed pharmaceutical legislation reform and the EU Health Technology Assessment Regulation taking effect in January 2025.";
/** da-v4 `cross-cyber` key finding 0: an exclusivity claim citing one company and naming no other. */
const CROSS_CYBER_KF0 =
  "UnitedHealth's FY2024 10-K explicitly states that its Change Healthcare business was subject to a cyberattack in 2024 in which the data involved contained protected health information or personally identifiable information. This is the only instance among the three companies where a specific, confirmed breach involving sensitive personal data is disclosed in the filings.";
/** da-v4 `multi-cloud` consideration 2: "All three companies", citing Alphabet and Microsoft. */
const MULTI_CLOUD_IC2 =
  'All three companies are making significant and increasing capital expenditures in AI infrastructure (datacenters, GPUs, custom chips). Alphabet reported capital expenditures of $91.4 billion for FY2025, primarily for technical infrastructure. Microsoft explicitly notes that cloud and AI infrastructure investments will continue to increase operating costs and may decrease operating margins. Diligence teams should model the capex intensity trajectory and its impact on free cash flow conversion for each platform.';

describe('sweeping claims', () => {
  const set = (...t: string[]) => new Set(t);
  const three = set('AAPL', 'TSLA', 'JPM');

  it('flags the real cases: pdf-3 "all five" (4 cited), multi-cloud "all three" (2 cited)', () => {
    expect(scopeClaimIn(PDF3_KF0, set('PFE', 'MRK', 'LLY', 'ABBV'), 5)).toEqual({ cue: 'all five', scope: 5, cited: 4 });
    expect(scopeClaimIn(MULTI_CLOUD_IC2, set('GOOG', 'MSFT'), 3)).toEqual({ cue: 'all three', scope: 3, cited: 2 });
  });

  it('M2: "the only" is flagged only when the sentence names an in-scope company the item does not cite', () => {
    expect(scopeClaimIn(CROSS_CYBER_KF0, set('UNH'), 3, set('UNH', 'V', 'BA'))).toBeNull();
    expect(scopeClaimIn('UnitedHealth is the only one of the three companies to disclose a specific, named cyberattack.', set('UNH'), 3, set('UNH', 'V', 'BA'))).toBeNull();
    expect(scopeClaimIn('Pfizer is the only one of the five to quantify the IRA impact.', set('PFE'), 5, set('PFE', 'MRK'))).toBeNull();
    expect(scopeClaimIn('UnitedHealth, not Visa, is the only company to name its attacker.', set('UNH'), 3, set('UNH', 'V', 'BA'))).toEqual({ cue: 'the only', scope: 3, cited: 1 });
  });

  it('passes a claim its citations cover; "both" only when its two companies are in-scope corpus companies', () => {
    expect(scopeClaimIn(PDF3_KF0, set('JNJ', 'PFE', 'MRK', 'LLY', 'ABBV'), 5)).toBeNull();
    expect(scopeClaimIn('Both companies flag inflation as a macro risk.', set('WMT', 'JPM'), 2)).toBeNull();
    expect(scopeClaimIn('Both companies flag inflation as a macro risk.', set('WMT'), 2)).toEqual({ cue: 'both companies', scope: 2, cited: 1 });
    expect(scopeClaimIn('Walmart and JPMorgan disclose inflation risk; both companies flag rates.', set('WMT'), 3, set('WMT', 'JPM', 'AAPL'))).toEqual({ cue: 'both companies', scope: 2, cited: 1 });
    expect(scopeClaimIn('Tesla depends on Panasonic and CATL; both companies supply battery cells.', set('TSLA'), 3, three)).toBeNull();
    expect(scopeClaimIn('Both companies face tariffs.', set('TSLA'), 3, three)).toBeNull();
  });

  it('reads "every / each company" against the brief scope, and skips directives, possessives, rules and generic classes', () => {
    expect(scopeClaimIn('Every company identifies cGMP failure as a risk.', set('PFE', 'MRK'), 5)).toEqual({ cue: 'every company', scope: 5, cited: 2 });
    expect(scopeClaimIn("Diligence teams should assess each company's exposure to products in late-stage review.", set('PFE'), 5)).toBeNull();
    expect(scopeClaimIn("Board Governance Structures Reflect Each Company's Risk Profile", set('V'), 3)).toBeNull();
    for (const s of [
      'The rule applies to all banks with more than $100 billion in assets.',
      'Item 1C now requires all registrants to describe cybersecurity governance.',
      'SEC rules require all companies to disclose material cybersecurity incidents within four business days.',
      'The IRA affects every drugmaker that sells into Medicare.',
      'Each bank must hold a capital conservation buffer.',
      'The 340B program requires each manufacturer to offer discounts.',
    ]) {
      expect(scopeClaimIn(s, set('PFE', 'MRK'), 3), s).toBeNull();
    }
  });

  it('M2: a bare count counts only before a company noun, "of" and company names, or nothing; never a count of other things', () => {
    expect(scopeClaimIn('Cybersecurity Risk Is Material Across All Three, With Distinct Vectors', set('TSLA', 'JPM'), 3)).toEqual({ cue: 'all three', scope: 3, cited: 2 });
    expect(scopeClaimIn('All three hyperscalers raised capex.', set('GOOG', 'MSFT'), 3)).toEqual({ cue: 'all three', scope: 3, cited: 2 });
    expect(scopeClaimIn('All three of Alphabet, Microsoft and Amazon raised capex.', set('GOOG', 'MSFT'), 3, set('GOOG', 'MSFT', 'AMZN'))).toEqual({ cue: 'all three', scope: 3, cited: 2 });
    for (const s of [
      'Growth across all three segments.',
      "Microsoft's revenue grew 15%, with growth across all three reportable segments.",
      'All three rating agencies affirmed the rating.',
      'Visa has three classes of common stock; all three classes carry different voting rights.',
      'All three drugs face IRA negotiation.',
      'All three vaccines are under review.',
      'All three credit bureaus were notified.',
      'In each of the three years, revenue grew.',
      'Across all three periods margins fell.',
      'All three of its reportable segments grew.',
      'The board has three committees; all three meet quarterly.',
    ]) {
      expect(scopeClaimIn(s, set('TSLA'), 3, three), s).toBeNull();
    }
    expect(scopeClaimIn('Product integration across all 15 of its half-billion-user products.', set('GOOG'), 6)).toBeNull();
  });

  it('never flags an absence quantifier ("none of the three", "neither bank"): an absence cannot be cited', () => {
    expect(scopeClaimIn('None of the three discloses a breach.', set('TSLA'), 3, three)).toBeNull();
    expect(scopeClaimIn('Neither bank discloses this.', set('JPM'), 3, three)).toBeNull();
  });

  it('skips the evidence statement ("the only companies to quantify … in the supplied excerpts")', () => {
    expect(scopeClaimIn('Lockheed Martin and Deere are the only companies to quantify tariff impacts in the supplied excerpts.', set('LMT'), 8)).toBeNull();
  });
});

describe('the claim fields are optional (stored analyses and seeds have none)', () => {
  it('parses a validation without them, and validateBrief always returns all three', () => {
    const b: DiligenceBrief = {
      title: 'NVIDIA revenue',
      executiveSummary: 'Summary.',
      answerType: 'trend',
      keyFindings: [{ title: 'Revenue more than quadrupled in two fiscal years', finding: NVDA_REHEARSAL, basis: 'reported', tickers: ['NVDA'], citationIds: ['NVDA-FY2025-10K-MDA-008'] }],
      investmentConsiderations: [],
      evidenceGaps: [],
      followUpQuestions: [],
    };
    const { validation } = validateBrief(b, [], new Map([['NVDA-FY2025-10K-MDA-008', 'text']]));
    expect(validation.arithmeticClaims).toEqual([{ location: 'keyFindings[0].finding', from: '$15,068 million', to: '$116,193 million', stated: 'up 145%', computed: '+671%' }]);
    expect(validation.attributionClaims).toEqual([]);
    expect(validation.scopeClaims).toEqual([]);
    expect(validation.notices.some((n) => /Change doesn't add up/.test(n))).toBe(true);
    const { arithmeticClaims: _a, attributionClaims: _b, scopeClaims: _c, ...older } = validation;
    const parsed = BriefValidationSchema.parse(older);
    expect(parsed.arithmeticClaims).toBeUndefined();
    expect(parsed.attributionClaims).toBeUndefined();
    expect(parsed.scopeClaims).toBeUndefined();
  });
});

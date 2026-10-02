/**
 * Hand-labeled risk-factor headings for the latest 10-Ks of AAPL, MSFT and NVDA (Phase 2 fix,
 * 2026-10-01), used to measure the deterministic heading extractor (risks.ts; assumptions G3a).
 *
 * How they were labeled: every paragraph and run-in sentence of each filing's Item 1A was read in
 * the processed text (packages/corpus, `detectSections`). A heading is the sentence (NVDA's
 * privacy heading: two sentences) that opens one risk and is followed by that risk's body.
 * Sentences that continue the previous risk's argument are body, even when they stand alone
 * as a one-sentence paragraph. Ambiguous cases were settled as follows:
 * - NVDA: the filing's own "Risk Factors Summary" lists one bullet per heading (23); each
 *   heading below is the body-section sentence that matches a summary bullet.
 * - AAPL: "Changes or additions to the Company’s supply chain…" and "Risks and costs related to
 *   new and changing laws…" are body; the FY2024 10-K has the first as the last paragraph of the
 *   outsourcing risk. "To remain competitive and stimulate customer demand…" (after the
 *   "Business Risks" group title) and "Future operating results depend upon…" are headings.
 * - MSFT: run-in headings (heading sentence, a space, then the body). Italic subheadings
 *   ("Security of our information technology") and sentences that elaborate the risk above
 *   ("Cyberthreats are constantly evolving…", "The cost of these measures…", "How these laws
 *   and regulations apply…") are body. "Acquisitions, joint ventures, and strategic alliances…"
 *   is a heading although it is run into the paragraph before it.
 *
 * Entries are heading prefixes (the start of the sentence as it appears in the text); a
 * found heading matches an entry when it starts with it.
 */
export const RISK_HEADINGS_GOLDEN: Record<string, readonly string[]> = {
  'AAPL_10K_2025-10-31': [
    'The Company’s operations and performance depend significantly on global and regional economic conditions',
    'The Company’s business can be impacted by political events, trade and other international disputes',
    'Global markets for the Company’s products and services are highly competitive',
    'To remain competitive and stimulate customer demand, the Company must successfully manage frequent introductions',
    'The Company depends on component and product manufacturing and logistical services',
    'Future operating results depend upon the Company’s ability to obtain components',
    'The Company’s products and services may be affected from time to time by design and manufacturing defects',
    'The Company is exposed to the risk of write-downs on the value of its inventory',
    'The Company relies on access to third-party intellectual property',
    'The Company’s future performance depends in part on support from third-party software developers.',
    'Failure to obtain or create digital content that appeals to the Company’s customers',
    'The Company’s success depends largely on the talents and efforts of its team members',
    'The Company depends on the performance of carriers and other resellers.',
    'The Company’s business and reputation are impacted by information technology system failures',
    'Losses or unauthorized access to or releases of confidential information',
    'Investment in new business strategies, commercial relationships and acquisitions',
    'The Company’s business, results of operations and financial condition could be adversely impacted by unfavorable results of legal proceedings',
    'The Company is subject to complex and changing laws and regulations worldwide',
    'Varied stakeholder expectations about social and other issues',
    'The technology industry, including, in some instances, the Company, is subject to intense media, political and regulatory scrutiny',
    'The Company’s business is subject to a variety of U.S. and international laws, rules, policies and other obligations',
    'The Company’s net sales and gross margins are subject to volatility',
    'The Company’s financial performance is subject to risks associated with changes in the value of the U.S. dollar',
    'The Company is exposed to credit risk and fluctuations in the values of its investment portfolio.',
    'The Company is exposed to credit risk on its trade accounts receivable',
    'The Company is subject to changes in tax rates',
    'The price of the Company’s stock is subject to volatility.',
  ],
  'MSFT_10K_2025-07-30': [
    'We face intense competition across all markets for our products and services',
    'Our focus on cloud-based and AI services presents execution and competitive risks.',
    'We make significant investments in products and services that may not achieve expected returns.',
    'Acquisitions, joint ventures, and strategic alliances could have an adverse effect on our business.',
    'Cyberattacks and security vulnerabilities could lead to reduced revenue',
    'Disclosure and misuse of personal data could result in liability and harm our reputation.',
    'We may not be able to protect information in our products and services from use by others.',
    'Abuse of our platforms may harm our reputation or user engagement.',
    'Our products and services, how they are used by customers, and how third-party products and services interact with them',
    'Issues in the development, deployment, and use of AI may result in reputational or competitive harm or liability.',
    'We may have excessive outages, data losses, and disruptions of our online services',
    'We may experience supply or quality problems.',
    'We are subject to a variety of new, existing, and evolving legal and regulatory requirements',
    'We have claims and lawsuits against us that may result in adverse outcomes.',
    'Our business with government customers may present additional uncertainties.',
    'We may have additional tax liabilities.',
    'We face risks related to the protection and utilization of our intellectual property',
    'Third parties may claim that we infringe their intellectual property.',
    'If our reputation or our brands are damaged, our business and results of operations may be harmed.',
    'Adverse economic or market conditions could harm our business.',
    'Catastrophic events or geopolitical conditions could disrupt our business.',
    'The occurrence of regional epidemics or a global pandemic, such as COVID-19',
    'Our global business exposes us to operational and economic risks.',
    'Our business depends on our ability to attract and retain talented employees.',
  ],
  'NVDA_10K_2025-02-26': [
    'Failure to meet the evolving needs of our industry and markets may adversely impact our financial results.',
    'Competition could adversely impact our market share and financial results.',
    'Long manufacturing lead times and uncertain supply and component availability',
    'Dependency on third-party suppliers and their technology to manufacture, assemble, test, or package our products',
    'Defects in our products have caused and could cause us to incur significant expenses to remediate',
    'Adverse economic conditions may harm our business.',
    'International sales and operations are a significant part of our business',
    'Product, system security, and data protection incidents or breaches',
    'Business disruptions could harm our operations, lead to a decline in revenue and increase our costs.',
    'Climate change may have a long-term impact on our business.',
    'We may not be able to realize the potential benefits of business investments or acquisitions',
    'We receive a significant amount of our revenue from a limited number of partners and distributors',
    'If we are unable to attract, retain and motivate our executives and key employees, our business may be harmed.',
    'Our business is dependent upon the proper functioning of our business processes and information systems',
    'Our operating results have in the past fluctuated and may in the future fluctuate',
    'We are subject to complex laws, rules, regulations, and political and other actions',
    'Increased scrutiny from shareholders, regulators and others regarding our corporate sustainability practices',
    'Issues relating to the responsible use of our technologies, including AI in our offerings',
    'Actions to adequately protect our IP rights could result in substantial costs to us',
    'We are subject to stringent and changing data privacy and security laws, rules, regulations and other obligations.',
    'We may have exposure to additional tax liabilities',
    'Our business is exposed to the burden and risks associated with litigation, investigations and regulatory proceedings.',
    'Delaware law and our certificate of incorporation, bylaws and agreement with Microsoft could delay or prevent a change in control.',
  ],
};

/** Precision and recall of found headings against a labeled list (prefix match, each label used once). */
export function scoreHeadings(found: readonly string[], golden: readonly string[]): { tp: number; fp: string[]; fn: string[]; precision: number; recall: number } {
  const left = [...golden];
  const fp: string[] = [];
  let tp = 0;
  for (const h of found) {
    const i = left.findIndex((g) => h.startsWith(g));
    if (i < 0) fp.push(h);
    else {
      tp++;
      left.splice(i, 1);
    }
  }
  return { tp, fp, fn: left, precision: found.length ? tp / found.length : 0, recall: golden.length ? tp / golden.length : 0 };
}

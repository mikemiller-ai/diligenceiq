'use client';

import * as React from 'react';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Short definitions for the financial terms the dashboard uses (DD-21). Factual and neutral: they
 * say what a measure is, never whether a value is good. Shown on hover and on keyboard focus.
 */
export const GLOSSARY: Readonly<Record<string, string>> = {
  Revenue: 'Total sales the company reports for the period.',
  'Revenue growth': 'How much revenue changed from the prior fiscal year, in percent.',
  'Gross margin': 'Gross profit as a share of revenue: what is left of each $1 of sales after the direct cost of the products or services sold.',
  'Operating margin': 'Operating income as a share of revenue: what is left of each $1 of sales after running the business, before interest and tax.',
  'Net margin': 'Net income as a share of revenue: what is left of each $1 of sales after all costs, interest and tax.',
  'Operating income': 'Profit from running the business, before interest and tax.',
  'Net income': 'Profit after all costs, interest and tax.',
  'Operating cash flow': 'Cash the business generated from its operations during the period, as reported in the cash flow statement.',
  'Capital spending': 'Cash spent on property, plant and equipment (capital expenditures).',
  'Cash and liquidity': 'Cash, cash equivalents and short-term investments the company reports.',
  Debt: 'Borrowings the company reports, such as notes and term debt.',
  'Annual report': 'The yearly report a US public company files with the SEC (Form 10-K), with audited financial statements and its risk factors.',
  'Quarterly report': 'The report a US public company files for each of its first three fiscal quarters (Form 10-Q), with unaudited financial statements.',
  pp: 'Percentage points: the difference between two percentages. A margin that moves from 30% to 31% changed by 1.0 pp.',
};

/** A term with a dotted underline and its definition (`term` names the entry when the text differs, e.g. "net margin"); plain text when there is none. */
export function Term({ children, term = children }: { children: string; term?: string }) {
  const definition = GLOSSARY[term];
  if (!definition) return <>{children}</>;
  return (
    <Tooltip content={definition}>
      <span tabIndex={0} className="cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-4 outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </span>
    </Tooltip>
  );
}

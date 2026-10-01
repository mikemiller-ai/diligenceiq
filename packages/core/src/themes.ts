import { z } from 'zod';

/**
 * Finding themes (SPEC §17.3, architecture §8.1). They were diligence workstreams in
 * SPEC v1; now they only group findings. There is no theme status or progress.
 * Order is display order.
 */
export const THEME_IDS = [
  'financial-performance',
  'growth-outlook',
  'risk-factors',
  'regulatory-compliance',
  'liquidity-capital',
  'strategic-shifts',
] as const;

export const ThemeIdSchema = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  /** Short label for filter chips. */
  shortName: string;
  description: string;
  /**
   * Example Deep Analysis questions. They only fill the question box; the user can
   * edit them or ask anything else (SPEC §14.1).
   */
  exampleQuestions: string[];
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: 'financial-performance',
    name: 'Financial Performance',
    shortName: 'Financial',
    description: 'Revenue, margin, and profitability trends, and the capital the business consumes.',
    exampleQuestions: [
      'How have revenue and operating margin trended for Microsoft and Alphabet over the last two fiscal years?',
      'What drove the change in gross margin at NVIDIA in its most recent fiscal year?',
    ],
  },
  {
    id: 'growth-outlook',
    name: 'Growth & Outlook',
    shortName: 'Growth',
    description: 'Growth drivers, management outlook, geographic mix, and demand indicators.',
    exampleQuestions: [
      'What growth drivers does management highlight for data center demand at NVIDIA?',
      'Which geographies contributed most to revenue growth at Apple in fiscal 2025?',
    ],
  },
  {
    id: 'risk-factors',
    name: 'Risk Factors',
    shortName: 'Risk',
    description: 'Operational, competitive, supply-chain, cybersecurity, and concentration risk.',
    exampleQuestions: [
      'What supply-chain and manufacturing concentration risks do Apple and NVIDIA disclose?',
      'How have Tesla’s disclosed risk factors changed between 2023 and 2025?',
    ],
  },
  {
    id: 'regulatory-compliance',
    name: 'Regulatory & Compliance',
    shortName: 'Regulatory',
    description: 'Regulatory exposure, litigation, government oversight, and jurisdictional risk.',
    exampleQuestions: [
      'What antitrust proceedings does Alphabet disclose, and what remedies are at stake?',
      'What export-control restrictions affect NVIDIA’s sales to China?',
    ],
  },
  {
    id: 'liquidity-capital',
    name: 'Liquidity & Capital',
    shortName: 'Liquidity',
    description: 'Liquidity, debt, cash requirements, and capital allocation.',
    exampleQuestions: [
      'How do Apple and Microsoft describe their capital return programs?',
      'What material cash requirements does Amazon disclose for the next twelve months?',
    ],
  },
  {
    id: 'strategic-shifts',
    name: 'Strategic Shifts',
    shortName: 'Strategic',
    description: 'Acquisitions, divestitures, new markets, and changes in strategic direction.',
    exampleQuestions: [
      'How has Disney’s description of its streaming strategy changed over time?',
      'How does Microsoft describe its strategic investment in AI?',
    ],
  },
];

export function getTheme(id: ThemeId): ThemeDefinition {
  const theme = THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Unknown theme: ${id}`);
  return theme;
}

export function isThemeId(value: unknown): value is ThemeId {
  return ThemeIdSchema.safeParse(value).success;
}

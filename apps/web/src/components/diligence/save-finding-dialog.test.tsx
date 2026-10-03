import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInWorkspace } from '@/test/render';
import { SAMPLE_ANALYSES, SAMPLE_CONTEXTS } from '@/test/sample-analyses';
import { SAVE_FINDING_LABEL, SaveFindingButton, defaultFindingTheme } from './save-finding-dialog';

/*
 * Phase 9 review items 10 and 11: one "Save finding" label, and a regulatory, litigation or antitrust
 * brief item starts on Regulatory & Compliance rather than Risk factors.
 */

describe('defaultFindingTheme', () => {
  it.each([
    ['Apple faces antitrust scrutiny of the App Store', 'regulatory-compliance'],
    ['Regulators in the EU opened proceedings under the DMA', 'regulatory-compliance'],
    ['Pending litigation over patents', 'regulatory-compliance'],
    ['Lawsuits from app developers', 'regulatory-compliance'],
    ['Compliance costs rose with new privacy rules', 'regulatory-compliance'],
    ['Final assembly is concentrated with partners in Asia', 'risk-factors'],
  ] as const)('a brief item “%s” starts on %s', (text, theme) => {
    expect(defaultFindingTheme({ defaultTheme: 'risk-factors', title: 'Finding', text })).toBe(theme);
  });

  it('keeps a theme the source chose from its category (a profile item), whatever its words', () => {
    expect(defaultFindingTheme({ defaultTheme: 'financial-performance', title: 'Revenue', text: 'regulatory costs rose' })).toBe('financial-performance');
  });
});

describe('SaveFindingButton', () => {
  it('reads “Save finding”, and a regulatory key finding opens on Regulatory & Compliance', async () => {
    const base = SAMPLE_ANALYSES[0]!;
    const analysis = {
      ...base,
      brief: { ...base.brief!, keyFindings: [{ ...base.brief!.keyFindings[0]!, title: 'Antitrust and regulatory scrutiny of the App Store' }] },
    };
    renderInWorkspace(<SaveFindingButton source={{ kind: 'keyFinding', analysisId: analysis.analysisId, index: 0 }} />, {
      initial: { analyses: [analysis] },
      contexts: SAMPLE_CONTEXTS,
    });
    const button = screen.getByRole('button', { name: SAVE_FINDING_LABEL });
    expect(SAVE_FINDING_LABEL).toBe('Save finding');
    await userEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Theme')).toHaveValue('regulatory-compliance');
    expect(within(dialog).getByLabelText('Theme')).toHaveDisplayValue('Regulatory & Compliance');
  });
});

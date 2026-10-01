import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPage from '../page';
import ArchitecturePage from './page';

/*
 * Phase 1 has no live pipeline, so the Architecture page must describe unbuilt mechanisms as
 * designed, with their phase, never as present fact (regression, adversary finding 5).
 */
describe('Architecture and business value page', () => {
  it('has the global Ask a question action (SPEC §5.2: every page)', () => {
    render(<ArchitecturePage />);
    expect(screen.getByRole('link', { name: 'Ask a question' }).getAttribute('href')).toMatch(/^\/analysis\/new\/?$/);
  });

  it('marks what is designed but not built, and never states it as present fact', () => {
    const { container } = render(<ArchitecturePage />);
    const text = container.textContent ?? '';
    // Statements the adversary found stated as present fact in Phase 1.
    for (const claim of [
      'tests that assert exactly one call',
      'Kill switch and spend caps',
      'survive re-indexing',
      'Spend is bounded by a kill switch, a global daily cap and per-workspace caps;',
    ]) {
      expect(text, claim).not.toContain(claim);
    }
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
    expect(text).toContain('Single-call guarantee · designed, Phase 4');
    expect(text).toContain('analyses are not enabled');
    expect(screen.getAllByText('Designed · Phase 4').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Designed · Phase 5').length).toBeGreaterThan(0);
  });

  it('shows no figures: no measured or invented numbers in Phase 1 (SPEC §18)', () => {
    const { container } = render(<ArchitecturePage />);
    expect(container.textContent ?? '').not.toMatch(/\d\s?%|\$\s?\d|\d\s?ms\b|\d\s?(?:seconds|minutes)\b/);
  });
});

describe('Landing', () => {
  it('keeps the client framing: no assessment wording', () => {
    // Regression (adversary finding 14): the footer read "Built for the Eliza FDE assessment".
    const { container } = render(<LandingPage />);
    expect(container.textContent ?? '').not.toMatch(/Eliza|FDE|assessment/i);
  });
});

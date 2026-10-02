import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPage from '../page';
import ArchitecturePage from './page';

/*
 * The Architecture page states each mechanism as what it is: built (and deployed), built but not
 * yet deployed (the Phase 5 api), or designed with its phase; never as present fact when it is not
 * (regression, adversary finding 5 in Phase 1 and H5 in Phase 5).
 */
describe('Architecture and business value page', () => {
  it('has the global Ask a question action (SPEC §5.2: every page)', () => {
    render(<ArchitecturePage />);
    expect(screen.getByRole('link', { name: 'Ask a question' }).getAttribute('href')).toMatch(/^\/analysis\/new\/?$/);
  });

  it('states what is built, what is built but not yet deployed, and what is designed', () => {
    const { container } = render(<ArchitecturePage />);
    const text = container.textContent ?? '';
    // Statements that were true in Phase 1 and are false now (Phase 5 adversary H5), and Phase 1 overclaims.
    for (const claim of [
      'findings last for the browser session',
      'analyses are not enabled',
      'None of it runs yet',
      'Designed · Phase 5',
      'Kill switch and spend caps',
      'survive re-indexing',
      'Spend is bounded by a kill switch, a global daily cap and per-workspace caps;',
    ]) {
      expect(text, claim).not.toContain(claim);
    }
    expect(text).not.toMatch(/Designed · Phase 4(?!b)/);
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
    expect(text).toContain('Single-call guarantee · built, Phase 4');
    // The worker is deployed; the Phase 5 api is built but not live.
    const worker = screen.getByRole('heading', { name: 'SQS → worker Lambda' }).closest('li')!;
    expect(worker).toHaveTextContent('Built');
    expect(worker).not.toHaveTextContent('not yet deployed');
    expect(screen.getByRole('heading', { name: 'HTTP API → api Lambda' }).closest('li')).toHaveTextContent('Built · not yet deployed');
    expect(screen.getAllByText('Built · not yet deployed').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('Designed · Phase 4b').length).toBe(1);
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

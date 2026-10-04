import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LandingPage from '../page';
import { MEASURED } from './measured';
import ArchitecturePage from './page';

/*
 * The Architecture page states each mechanism as what it is: built (and deployed) or designed with
 * its phase; never as present fact when it is not (regression, adversary finding 5 in Phase 1 and
 * H5 in Phase 5), and never as "not yet deployed" once it is live (Phase 7: everything through
 * Phase 6r is deployed).
 */
describe('Architecture and business value page', () => {
  it('has the global Ask a question action (SPEC §5.2: every page)', () => {
    render(<ArchitecturePage />);
    expect(screen.getByRole('link', { name: 'Ask a question' }).getAttribute('href')).toMatch(/^\/analysis\/new\/?$/);
  });

  it('links to the source repository and its deliverables map, in a new tab', () => {
    render(<ArchitecturePage />);
    const repo = screen.getByRole('link', { name: /Source code/ });
    expect(repo).toHaveAttribute('href', 'https://github.com/mikemiller-ai/diligenceiq');
    const deliverables = screen.getByRole('link', { name: /Assessment deliverables/ });
    expect(deliverables).toHaveAttribute('href', 'https://github.com/mikemiller-ai/diligenceiq/blob/main/docs/deliverables.md');
    for (const l of [repo, deliverables]) expect(l).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it('states what is built and what is designed', () => {
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
      // Phase 7: deployed since Phases 4b–6r.
      'not yet deployed',
      'preview profiles',
      'Designed · Phase 4b',
      'Common, distinctive and diverging',
    ]) {
      expect(text, claim).not.toContain(claim);
    }
    expect(text).not.toMatch(/Designed · Phase 4(?!b)/);
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
    expect(text).toContain('Single-call guarantee · built, Phase 4');
    for (const name of ['SQS → worker Lambda', 'HTTP API → api Lambda', 'Amplify Hosting']) {
      expect(screen.getByRole('heading', { name }).closest('li')).toHaveTextContent('Built');
    }
    expect(text).toContain('OFFLINE · BUILT, PHASE 4B');
    // Phase 8 built the alarm emails (SNS) and the Budget alert: nothing on the page is still "to come in Phase 8".
    expect(text).not.toMatch(/Designed · Phase 8|to come in Phase 8/);
    expect(screen.getByText(/Alarm notifications by email \(SNS\) and the AWS Budget alert/).closest('li')).toHaveTextContent('Built');
  });

  it('has a main landmark, keeps the business story, and draws the live monitoring pipeline marked not built (Phase 9 review item 23)', () => {
    const { container } = render(<ArchitecturePage />);
    const main = container.querySelector('main#main')!;
    expect(main).not.toBeNull();
    expect(main).toHaveTextContent('How this creates value for a private-equity deal team.');
    const pipeline = screen.getByRole('list', { name: 'Live monitoring pipeline, not built' });
    expect([...pipeline.querySelectorAll('li p:first-child')].map((p) => p.textContent)).toEqual([
      'EventBridge schedule',
      'SEC new-filing check',
      'Ingestion',
      'Index update',
      'Change detection',
      'Watch match',
      'Intelligence events',
      'SNS / email',
    ]);
    expect(screen.getByTestId('live-monitoring')).toHaveTextContent('Not built · future state');
    expect(screen.getByTestId('live-monitoring')).toHaveTextContent('Nothing here runs in this deployment.');
  });

  it('every figure on the page is a measured one (SPEC §18; traced by measured.test.ts)', () => {
    const { container } = render(<ArchitecturePage />);
    const cards = container.querySelectorAll('[data-measured]');
    expect(cards.length).toBe(MEASURED.flatMap((g) => g.items).length);
    for (const c of cards) c.remove();
    // Outside the measured cards: no percentage, amount, duration or ratio of any kind.
    expect(container.textContent ?? '').not.toMatch(/\d\s?%|\$\s?\d|\d\s?ms\b|\d\s?s\b|\d\s?(?:seconds|minutes)\b|\d+ of \d+/);
  });

  it('each measured card shows its value, label and source', () => {
    render(<ArchitecturePage />);
    for (const m of MEASURED.flatMap((g) => g.items)) {
      const card = document.querySelector(`[data-measured="${m.id}"]`)!;
      expect(card).toHaveTextContent(m.value);
      expect(card).toHaveTextContent(`Source: ${m.source}`);
    }
  });
});

describe('Landing', () => {
  it('keeps the client framing: no assessment wording', () => {
    // Regression (adversary finding 14): the footer read "Built for the Eliza FDE assessment".
    const { container } = render(<LandingPage />);
    expect(container.textContent ?? '').not.toMatch(/Eliza|FDE|assessment/i);
  });
});

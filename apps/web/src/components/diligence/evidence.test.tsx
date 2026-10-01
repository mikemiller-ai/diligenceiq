import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInWorkspace } from '@/test/render';
import { TEST_PASSAGES } from '@/test/sample-analyses';
import { CitedText } from './evidence';

const ctx = new Map(TEST_PASSAGES.map((p) => [p.chunkId, p]));

describe('CitedText and the evidence drawer', () => {
  it('turns inline IDs into chips and keeps the surrounding text', () => {
    renderInWorkspace(<CitedText text="Apple relies on partners [AAPL-FY2025-10K-1A-F01]. Next." context={ctx} />);
    expect(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Apple relies on partners');
    expect(document.body.textContent).toContain('. Next.');
    expect(document.body.textContent).not.toContain('[AAPL');
    // The chip shows the short Evidence label; the full ID stays in the accessible name.
    expect(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' })).toHaveTextContent('§ AAPL FY2025 · 1A');
  });

  it('opens the drawer with the real passage and a deep link to the filing', async () => {
    renderInWorkspace(<CitedText text="Claim [AAPL-FY2025-10K-1A-F01]" context={ctx} />);
    await userEvent.click(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Apple Inc');
    expect(dialog).toHaveTextContent('Item 1A — Risk Factors');
    expect(dialog).toHaveTextContent('single-source partners');
    // A brief's citation is a passage supplied to the model; profile citations say otherwise (finding 4).
    expect(screen.getByTestId('evidence-provenance')).toHaveTextContent('Validated — supplied to the model');
    expect(screen.getByRole('link', { name: /open filing/i }).getAttribute('href')).toMatch(
      /^\/sources\/filing\/?\?id=AAPL_10K_2025-10-31#chunk-AAPL-FY2025-10K-1A-F01$/,
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('flags an ID that is not in the supplied context instead of linking it', async () => {
    renderInWorkspace(<CitedText text="Claim [FAKE-FY2025-10K-1A-001]" context={ctx} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unverified citation FAKE-FY2025-10K-1A-001' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Unsupported — flagged');
    expect(screen.queryByRole('link', { name: /open filing/i })).not.toBeInTheDocument();
  });
});

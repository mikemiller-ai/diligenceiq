import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderInWorkspace } from '@/test/render';
import { TEST_PASSAGES } from '@/test/sample-analyses';
import { CitationList, CitedText } from './evidence';

const ctx = new Map(TEST_PASSAGES.map((p) => [p.chunkId, p]));

describe('CitedText and the evidence drawer', () => {
  it('turns inline IDs into chips and keeps the surrounding text', () => {
    renderInWorkspace(<CitedText text="Apple relies on partners [AAPL-FY2025-10K-1A-F01]. Next." context={ctx} />);
    expect(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Apple relies on partners');
    expect(document.body.textContent).toContain('. Next.');
    expect(document.body.textContent).not.toContain('[AAPL');
    // The chip shows a plain label (no SEC item code on primary screens); the full ID stays in the accessible name.
    expect(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' })).toHaveTextContent('AAPL FY2025 · Risk factors');
    expect(screen.getByRole('button', { name: 'View evidence AAPL-FY2025-10K-1A-F01' })).not.toHaveTextContent(/§|1A/);
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
    // The link carries the citation's index version (`iv`), so the source view never highlights another version's span.
    const iv = ctx.get('AAPL-FY2025-10K-1A-F01')!.indexVersion;
    expect(screen.getByRole('link', { name: /open filing/i }).getAttribute('href')).toMatch(
      new RegExp(`^/sources/filing/?\\?id=AAPL_10K_2025-10-31&iv=${iv}#chunk-AAPL-FY2025-10K-1A-F01$`),
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

describe('CitationList on primary screens (Phase 9 review item 9)', () => {
  it('shows a repeated plain label once, then a numbered chip per further passage, each opening its own passage', async () => {
    const base = TEST_PASSAGES.find((p) => p.chunkId === 'AAPL-FY2025-10K-1A-F01')!;
    const twins = [base, { ...base, chunkId: 'AAPL-FY2025-10K-1A-F98' }, { ...base, chunkId: 'AAPL-FY2025-10K-1A-F99' }];
    renderInWorkspace(<CitationList ids={twins.map((t) => t.chunkId)} context={new Map(twins.map((t) => [t.chunkId, t]))} provenance="profile" />);
    const chips = twins.map((t) => screen.getByRole('button', { name: `View evidence ${t.chunkId}` }));
    expect(chips.map((c) => c.textContent)).toEqual(['AAPL FY2025 · Risk factors', '2', '3']);
    await userEvent.click(chips[2]!);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Item 1A — Risk Factors');
  });
  // Code review 2026-10-03: the counter numbered non-adjacent repeats, so a "2" sat next to MSFT's chip.
  it('numbers only adjacent repeats, so a number always follows its own label and the model\'s order is kept', () => {
    const base = TEST_PASSAGES.find((p) => p.chunkId === 'AAPL-FY2025-10K-1A-F01')!;
    const msft = { ...base, chunkId: 'MSFT-FY2025-10K-1A-F01', ticker: 'MSFT', company: 'Microsoft Corp' };
    const list = [base, msft, { ...base, chunkId: 'AAPL-FY2025-10K-1A-F98' }, { ...base, chunkId: 'AAPL-FY2025-10K-1A-F99' }, { ...msft, chunkId: 'MSFT-FY2025-10K-1A-F02' }];
    renderInWorkspace(<CitationList ids={list.map((t) => t.chunkId)} context={new Map(list.map((t) => [t.chunkId, t]))} provenance="profile" />);
    const chips = list.map((t) => screen.getByRole('button', { name: `View evidence ${t.chunkId}` }));
    expect(chips.map((c) => c.textContent)).toEqual(['AAPL FY2025 · Risk factors', 'MSFT FY2025 · Risk factors', 'AAPL FY2025 · Risk factors', '2', 'MSFT FY2025 · Risk factors']);
  });
});

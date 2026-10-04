import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { setRoute } from '@/test/navigation-mock';
import { AppShell } from './app-shell';

const shell = () =>
  render(
    <AppShell>
      <p>page</p>
    </AppShell>,
  );

describe('AppShell', () => {
  beforeEach(() => setRoute('/findings/'));

  it('renders the landmarks, the four primary nav items in order, and the global Ask a question action', () => {
    shell();
    expect(screen.getByRole('main')).toHaveTextContent('page');
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Company Intelligence', 'Compare', 'Deep Analysis', 'Findings']);
    expect(within(nav).getByRole('link', { name: 'Findings' })).toHaveAttribute('aria-current', 'page');
    // next/link applies the trailingSlash setting at runtime, so compare paths without it.
    expect(screen.getByRole('link', { name: 'Ask a question' }).getAttribute('href')).toMatch(/^\/analysis\/new\/?$/);
    expect(screen.getByText('Skip to content')).toHaveAttribute('href', '#main');
  });

  it('has no Thesis, Watchlist, IC Brief or Sources entries until they are built', () => {
    shell();
    for (const name of [/Thesis/, /Watchlist/, /IC Brief/, /^Sources$/, /Overview/, /Diligence$/]) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /Architecture/ })).toBeInTheDocument();
  });

  it('links to the source repository from the sidebar footer, in a new tab', () => {
    shell();
    const link = screen.getByRole('link', { name: 'Source code' });
    expect(link).toHaveAttribute('href', 'https://github.com/mikemiller-ai/diligenceiq');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer noopener');
  });

  it.each([
    ['/intelligence/', 'Company Intelligence'],
    ['/compare/', 'Compare'],
    ['/analysis/new/', 'Deep Analysis'],
    ['/analysis/', 'Deep Analysis'],
  ])('marks the right item active on %s', (path, label) => {
    setRoute(path);
    shell();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  });

  it('collapses the sidebar to icons while keeping accessible names', async () => {
    shell();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('link', { name: 'Compare' })).toBeInTheDocument();
  });

  it('the phone drawer has a visible scrim and no Collapse control (Phase 9 review item 24)', async () => {
    shell();
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).queryByRole('button', { name: /Collapse navigation/ })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: 'Compare' })).toBeInTheDocument();
    expect(screen.getByTestId('sheet-scrim')).toHaveClass('bg-navy/60');
  });
});

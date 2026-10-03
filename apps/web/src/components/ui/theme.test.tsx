import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_SCRIPT } from '@/lib/theme-script';
import { THEME_EVENT, THEME_STORAGE_KEY, ThemeToggle } from './theme-toggle';

const html = () => document.documentElement;
const radio = (name: string) => screen.getByRole('radio', { name });

beforeEach(() => {
  window.localStorage.clear();
  html().removeAttribute('data-theme');
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  html().removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('defaults to System: nothing stored, no attribute stamped', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('radiogroup', { name: 'Colour theme' })).toBeInTheDocument();
    expect(radio('System theme')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Light theme')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Dark theme')).toHaveAttribute('aria-checked', 'false');
    expect(html()).not.toHaveAttribute('data-theme');
  });

  it('cycles Light → Dark → System, storing the choice and stamping data-theme', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(radio('Light theme'));
    expect(html()).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(radio('Light theme')).toHaveAttribute('aria-checked', 'true');

    await user.click(radio('Dark theme'));
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(radio('Dark theme')).toHaveAttribute('aria-checked', 'true');

    await user.click(radio('System theme'));
    expect(html()).not.toHaveAttribute('data-theme');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(radio('System theme')).toHaveAttribute('aria-checked', 'true');
  });

  it('is keyboard operable: one tab stop, arrow keys move and select', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);
    await user.tab();
    expect(radio('System theme')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Dark theme')).toHaveFocus();
    expect(html()).toHaveAttribute('data-theme', 'dark');
    await user.keyboard('{ArrowRight}');
    expect(radio('Light theme')).toHaveFocus();
    expect(html()).toHaveAttribute('data-theme', 'light');
    await user.keyboard('{ArrowLeft}');
    expect(html()).toHaveAttribute('data-theme', 'dark');
    expect(screen.getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('reads a stored choice and follows changes from another toggle or tab', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeToggle />);
    expect(radio('Dark theme')).toHaveAttribute('aria-checked', 'true');

    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
      window.dispatchEvent(new Event('storage'));
    });
    expect(radio('Light theme')).toHaveAttribute('aria-checked', 'true');

    act(() => {
      window.localStorage.removeItem(THEME_STORAGE_KEY);
      window.dispatchEvent(new Event(THEME_EVENT));
    });
    expect(radio('System theme')).toHaveAttribute('aria-checked', 'true');
  });

  it('ignores an unknown stored value, and still applies a choice when storage throws', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const user = userEvent.setup();
    render(<ThemeToggle />);
    expect(radio('System theme')).toHaveAttribute('aria-checked', 'true');

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await user.click(radio('Dark theme'));
    expect(html()).toHaveAttribute('data-theme', 'dark');
  });
});

describe('THEME_SCRIPT (pre-paint)', () => {
  const run = () => new Function(THEME_SCRIPT)();

  it('applies a stored dark or light choice to <html>', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(html()).toHaveAttribute('data-theme', 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(html()).toHaveAttribute('data-theme', 'light');
  });

  it('does nothing without a stored choice (System) or with an unknown value', () => {
    run();
    expect(html()).not.toHaveAttribute('data-theme');
    window.localStorage.setItem(THEME_STORAGE_KEY, '"><script>');
    run();
    expect(html()).not.toHaveAttribute('data-theme');
  });

  it('swallows a storage error rather than breaking the page', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(run).not.toThrow();
    expect(html()).not.toHaveAttribute('data-theme');
  });

  it('reads the same storage key as the toggle, and is a single static string', () => {
    expect(THEME_SCRIPT).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`);
    expect(THEME_SCRIPT).not.toMatch(/<\/?script/i);
  });
});

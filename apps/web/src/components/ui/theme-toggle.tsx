'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

/*
 * The colour-theme control, as in CareerOps. Three states, not two: "System" is the default
 * and stamps nothing, so the app follows the OS until someone expresses a preference, and
 * stays reachable afterwards (a plain light/dark switch takes that away).
 *
 * The choice sets `data-theme` on <html>, which sets `color-scheme`; every colour token
 * resolves through light-dark() against it (globals.css). Nothing else has to know.
 *
 * The stored choice is external state, so it is read with useSyncExternalStore rather than
 * copied into React state by an effect: the server render and the first client render agree
 * on "system", and a change made in another tab is picked up. The pre-paint script
 * (lib/theme-script.ts) has already applied the stored choice before hydration.
 */

export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'diligenceiq:theme';

/** `storage` only fires in *other* tabs, so same-tab writes announce themselves. */
export const THEME_EVENT = 'diligenceiq:themechange';

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return 'system';
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function setThemeChoice(next: ThemeChoice) {
  apply(next);
  try {
    if (next === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // A preference that cannot be stored still applies to this page.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'system', label: 'System theme', Icon: Monitor },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

/**
 * A compact icon segmented control (radiogroup). Arrow keys move and select, as in a native
 * radio group; only the checked option is in the tab order.
 */
export function ThemeToggle({ onNavy = false, className }: { onNavy?: boolean; className?: string }) {
  const choice = React.useSyncExternalStore(subscribe, readThemeChoice, () => 'system' as const);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    setThemeChoice(OPTIONS[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        'no-print inline-flex items-center gap-0.5 rounded-full border p-0.5',
        onNavy ? 'border-white/15' : 'border-border bg-card',
        className,
      )}
    >
      {OPTIONS.map(({ value, label, Icon }, i) => {
        const active = choice === value;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            tabIndex={active ? 0 : -1}
            onClick={() => setThemeChoice(value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'grid size-7 place-items-center rounded-full transition-colors [&_svg]:size-3.5',
              onNavy
                ? active
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:text-white'
                : active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden strokeWidth={1.75} />
          </button>
        );
      })}
    </div>
  );
}

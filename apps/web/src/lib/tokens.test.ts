import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrast targets from docs/design-tokens.md (Evidence system), checked against the CSS that ships.
const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
type Mode = 'light' | 'dark';
/** A token's value in one mode. Mode-varying tokens are `light-dark(#LIGHT, #DARK)`; constants are a bare hex. */
const valueIn = (name: string, mode: Mode): string => {
  const pair = root.match(new RegExp(`--${name}:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{6})\\s*,\\s*(#[0-9a-fA-F]{6})\\s*\\)`));
  if (pair?.[1] && pair[2]) return mode === 'light' ? pair[1] : pair[2];
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return m[1];
};
const token = (name: string): string => valueIn(name, 'light');
const dark = (name: string): string => valueIn(name, 'dark');

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` at `alpha` over `bg`, as Tailwind's `/NN` opacity modifier renders it. */
function over(fg: string, alpha: number, bg: string): string {
  const f = channels(fg);
  const b = channels(bg);
  return `#${f.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}

/** CIE76 ΔE, the measure the brand kit uses for sibling accents. */
function deltaE(a: string, b: string): number {
  const lab = (hex: string) => {
    const [r, g, bl] = channels(hex).map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

describe('design token contrast (WCAG 2.1)', () => {
  const grounds = ['background', 'card', 'secondary', 'muted'];

  it.each(['foreground', 'muted-foreground', 'primary'])('text token --%s reaches 4.5:1 on every light ground', (fg) => {
    for (const bg of grounds) expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary body text (foreground at 80%) reaches 4.5:1', () => {
    for (const bg of grounds) expect(contrast(over(token('foreground'), 0.8, token(bg)), token(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('error text reaches 4.5:1 on card and background', () => {
    expect(contrast(token('destructive'), token('card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('destructive'), token('background'))).toBeGreaterThanOrEqual(4.5);
  });

  it('form-control boundaries reach 3:1 on cards (WCAG 1.4.11)', () => {
    expect(contrast(token('input'), token('card'))).toBeGreaterThanOrEqual(3);
  });

  it('button labels clear 4.5:1 on primary, its hover, and the destructive fill', () => {
    expect(contrast(token('primary-foreground'), token('primary'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('primary-foreground'), token('primary-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('destructive-foreground'), token('destructive'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token('accent-foreground'), token('accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('status badges put ink text on a status tint at 4.5:1 or better', () => {
    const tints: [string, number][] = [
      ['ok', 0.15],
      ['risk-med', 0.2],
      ['destructive', 0.1],
    ];
    for (const [status, alpha] of tints) {
      expect(contrast(token('foreground'), over(token(status), alpha, token('card')))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('direction chips (DD-21) put their ink on their own tint at 4.5:1 or better, and the active jump-bar count clears 4.5:1', () => {
    const chips: [string, string, number][] = [
      ['ok-ink', 'ok', 0.12],
      ['risk-med-ink', 'risk-med', 0.15],
      ['destructive-ink', 'destructive', 0.1],
      ['primary', 'primary', 0.1],
      ['muted-foreground', 'secondary', 1],
    ];
    for (const [ink, tint, alpha] of chips) {
      expect(contrast(token(ink), over(token(tint), alpha, token('card'))), `${ink} on ${tint}/${alpha}`).toBeGreaterThanOrEqual(4.5);
    }
    // The plain status hue is not enough on its tint, which is why the ink tokens exist.
    expect(contrast(token('destructive'), over(token('destructive'), 0.1, token('card')))).toBeLessThan(4.5);
    // Active jump link: primary-foreground on primary, its count on primary-foreground/20 over primary.
    expect(contrast(token('primary-foreground'), over(token('primary-foreground'), 0.2, token('primary')))).toBeGreaterThanOrEqual(4.5);
  });

  it('text on the navy grounds and the rail reaches 4.5:1', () => {
    for (const ground of ['navy', 'rail']) {
      expect(contrast(token('on-navy-accent'), token(ground))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('rail-ink'), token(ground))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('rail-muted'), token(ground))).toBeGreaterThanOrEqual(4.5);
      // Secondary copy on navy is white at 55–70%.
      expect(contrast(over('#ffffff', 0.55, token(ground)), token(ground))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('dark palette contrast (WCAG 2.1)', () => {
  const grounds = ['background', 'card', 'popover', 'secondary', 'muted'];

  it('declares the three theme states: System by default, light and dark by attribute', () => {
    expect(root).toMatch(/color-scheme:\s*light dark/);
    expect(css).toMatch(/:root\[data-theme='light'\]\s*\{\s*color-scheme:\s*light;/);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{\s*color-scheme:\s*dark;/);
  });

  it.each(['foreground', 'muted-foreground', 'primary', 'destructive', 'accent-foreground'])(
    'text token --%s reaches 4.5:1 on every dark ground',
    (fg) => {
      for (const bg of grounds) expect(contrast(dark(fg), dark(bg))).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('readable-evidence grounds (key sentence, diff added and removed) keep body text at 4.5:1 in both modes, and stand apart from the card', () => {
    for (const g of ['key-highlight', 'diff-added', 'diff-removed']) {
      for (const mode of ['light', 'dark'] as const) {
        expect(contrast(valueIn('foreground', mode), valueIn(g, mode))).toBeGreaterThanOrEqual(4.5);
        // Muted text sits on these rows too ("was: …", "Unchanged").
        expect(contrast(valueIn('muted-foreground', mode), valueIn(g, mode))).toBeGreaterThanOrEqual(4.5);
        expect(deltaE(valueIn(g, mode), valueIn('card', mode))).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it('secondary body text (foreground at 80%) reaches 4.5:1 in dark', () => {
    for (const bg of grounds) expect(contrast(over(dark('foreground'), 0.8, dark(bg)), dark(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('raised surfaces are lighter than the ground (elevation order holds in dark)', () => {
    expect(luminance(dark('card'))).toBeGreaterThan(luminance(dark('background')));
    expect(luminance(dark('popover'))).toBeGreaterThan(luminance(dark('card')));
    expect(luminance(dark('secondary'))).toBeGreaterThan(luminance(dark('card')));
  });

  it('the lightened accent takes an ink label at 4.5:1 or better', () => {
    expect(contrast(dark('primary-foreground'), dark('primary'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark('primary-foreground'), dark('primary-hover'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark('destructive-foreground'), dark('destructive'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark('accent-foreground'), dark('accent'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dark('primary'), dark('accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it('form-control boundaries reach 3:1 on dark cards (WCAG 1.4.11)', () => {
    expect(contrast(dark('input'), dark('card'))).toBeGreaterThanOrEqual(3);
  });

  it('a native select’s chevron is drawn in a theme token (no fixed hex), at 3:1 on a card in both modes', () => {
    const start = css.indexOf('@utility select-chevron');
    const block = css.slice(start, css.indexOf('}', start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('var(--muted-foreground)');
    expect(block).not.toMatch(/#[0-9a-f]{3,6}|url\(/i);
    const input = readFileSync(join(__dirname, '../components/ui/input.tsx'), 'utf8');
    expect(input).toContain('select-chevron');
    expect(input).not.toMatch(/%23|url\(/);
    for (const mode of ['light', 'dark'] as const) expect(contrast(valueIn('muted-foreground', mode), valueIn('card', mode))).toBeGreaterThanOrEqual(3);
  });

  it('status badges keep ink on a tint at 4.5:1, and the dot at 3:1, on a dark card', () => {
    const tints: [string, number][] = [
      ['ok', 0.15],
      ['risk-med', 0.2],
      ['destructive', 0.1],
      ['risk-low', 0.15],
      ['risk-high', 0.15],
      ['risk-critical', 0.15],
    ];
    for (const [status, alpha] of tints) {
      expect(contrast(dark('foreground'), over(dark(status), alpha, dark('card')))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dark(status), dark('card'))).toBeGreaterThanOrEqual(3);
    }
  });

  it('navy grounds and brand fills do not vary by mode', () => {
    for (const name of ['navy', 'navy-raised', 'rail', 'rail-ink', 'rail-muted', 'on-navy-accent', 'on-navy-ink', 'sapphire', 'logo-blue']) {
      expect(dark(name)).toBe(token(name));
    }
    expect(token('sapphire').toLowerCase()).toBe(token('primary').toLowerCase());
  });
});

describe('family rules (mikemiller-ai/web-brand-kit)', () => {
  it('keeps the shared Evidence navy ground', () => {
    expect(token('navy').toLowerCase()).toBe('#0a0b13');
  });

  it('places Sapphire 8–15 ΔE from its nearest sibling accent', () => {
    const siblings = {
      'mikemiller.ai': '#4F46E5',
      ResolveIQ: '#5851E6',
      TrustResponse: '#3A58F9',
      ArchIQ: '#5A3AE9',
      CareerOps: '#1C54E3',
      GenAIQ: '#4C82FF',
    };
    const distances = Object.values(siblings).map((s) => deltaE(token('primary'), s));
    const nearest = Math.min(...distances);
    expect(nearest).toBeGreaterThanOrEqual(8);
    expect(nearest).toBeLessThanOrEqual(15);
  });

  it('reproduces the kit’s calibration figure (mm vs ResolveIQ ≈ 7.2)', () => {
    expect(deltaE('#4F46E5', '#5851E6')).toBeCloseTo(7.2, 1);
  });
});

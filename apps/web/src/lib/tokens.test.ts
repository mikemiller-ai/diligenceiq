import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contrast targets from docs/design-tokens.md (Evidence system), checked against the CSS that ships.
const css = readFileSync(join(__dirname, '../app/globals.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const token = (name: string): string => {
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return m[1];
};

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

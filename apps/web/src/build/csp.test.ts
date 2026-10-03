import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEME_SCRIPT } from '@/lib/theme-script';
import { STATIC_DIRECTIVES, applyCsp, applyCspToDir, inlineScriptHashes, policyFor, scriptHash } from './csp';

const page = (body: string) =>
  `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><script src="/_next/a.js" async=""></script>` +
  `<script>${THEME_SCRIPT}</script></head><body>${body}</body></html>`;

function cspOf(html: string): string {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/.exec(html)?.[1] ?? '';
}

describe('static-export CSP (D10)', () => {
  it('hashes a script the way the browser does (SHA-256 of the raw text, base64)', () => {
    const expected = createHash('sha256').update(THEME_SCRIPT).digest('base64');
    expect(scriptHash(THEME_SCRIPT)).toBe(`'sha256-${expected}'`);
  });

  it('allows the theme pre-paint script by its hash', () => {
    expect(policyFor(page(''))).toContain(scriptHash(THEME_SCRIPT));
  });

  it('hashes every inline script, skips scripts with src, and deduplicates', () => {
    const flight = 'self.__next_f.push([1,"x"])';
    const html = page(`<script>${flight}</script><script>${flight}</script><script id="j">${'1+1'}</script>`);
    expect(inlineScriptHashes(html)).toEqual([scriptHash(THEME_SCRIPT), scriptHash(flight), scriptHash('1+1')]);
    expect(inlineScriptHashes(html).some((h) => h === scriptHash(''))).toBe(false);
  });

  it("never allows 'unsafe-inline' or 'unsafe-eval' for scripts", () => {
    const scriptSrc = policyFor(page('<script>a()</script>')).split('; ')[0]!;
    expect(scriptSrc.startsWith("script-src 'self' 'sha256-")).toBe(true);
    expect(scriptSrc).not.toMatch(/unsafe|\*|data:|https?:/);
  });

  it('carries the fixed directives; the only residual allowance is inline styles', () => {
    const policy = policyFor(page(''));
    for (const d of STATIC_DIRECTIVES) expect(policy).toContain(d);
    expect(policy.match(/'unsafe-inline'/g)).toHaveLength(1);
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toContain('unsafe-eval');
  });

  it('places the meta directly after charset, before every script', () => {
    const out = applyCsp(page('<script>b()</script>'));
    const metaAt = out.indexOf('http-equiv="Content-Security-Policy"');
    expect(metaAt).toBeGreaterThan(out.indexOf('<meta charSet="utf-8"/>'));
    expect(metaAt).toBeLessThan(out.indexOf('<script'));
  });

  it('is idempotent and refreshes a stale policy', () => {
    const once = applyCsp(page('<script>b()</script>'));
    expect(applyCsp(once)).toBe(once);
    const changed = once.replace('b()', 'c()');
    const refreshed = applyCsp(changed);
    expect(refreshed.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(cspOf(refreshed)).toContain(scriptHash('c()'));
    expect(cspOf(refreshed)).not.toContain(scriptHash('b()'));
  });

  it('rewrites every page under the export, nested ones included', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-'));
    mkdirSync(join(dir, 'compare'));
    writeFileSync(join(dir, 'index.html'), page('<script>one()</script>'));
    writeFileSync(join(dir, 'compare', 'index.html'), page('<script>two()</script>'));
    writeFileSync(join(dir, 'index.txt'), '<script>untouched()</script>');
    expect(applyCspToDir(dir)).toEqual({ pages: 2, hashes: 3 });
    expect(cspOf(readFileSync(join(dir, 'compare', 'index.html'), 'utf8'))).toContain(scriptHash('two()'));
    expect(cspOf(readFileSync(join(dir, 'compare', 'index.html'), 'utf8'))).not.toContain(scriptHash('one()'));
    expect(readFileSync(join(dir, 'index.txt'), 'utf8')).toBe('<script>untouched()</script>');
  });

  it('refuses a page without a head rather than ship it unprotected', () => {
    expect(() => applyCsp('<html><body></body></html>')).toThrow(/no <head>/);
  });
});

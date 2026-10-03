/**
 * Per-page Content-Security-Policy for the static export (assumptions D10, decided in Phase 7).
 *
 * A static export has no request state, so a nonce is impossible. Each page's inline scripts
 * (the theme pre-paint script and Next's RSC flight `self.__next_f.push(…)` payloads) are
 * hashed after `next build`, and a `<meta http-equiv="Content-Security-Policy">` listing exactly
 * those hashes is written as the first element after `<meta charSet>`. The policy therefore
 * changes with each build without a CDK deploy: `pnpm deploy:web` uploads the rewritten pages.
 *
 * Directives a `<meta>` CSP cannot carry (`frame-ancestors`) stay in the Amplify header
 * (`infrastructure/cdk/lib/web-stack.ts`). Both policies apply; the stricter wins.
 *
 * **The one residual allowance is `style-src 'unsafe-inline'`:** sonner inserts its stylesheet
 * as a runtime `<style>` element, which no build-time hash can cover. Script execution stays
 * hash-only, which is what the CSP is for.
 *
 * Run as a CLI after the build (`apps/web` `build` script): `node src/build/csp.ts out`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Every directive except `script-src`, which is built from the page's hashes. */
export const STATIC_DIRECTIVES: ReadonlyArray<string> = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
];

const INLINE_SCRIPT = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
const CSP_META = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;

/** `'sha256-…'` of a script's raw text, as the browser computes it. */
export function scriptHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

/** Hashes of the inline (no `src`) scripts in one page, deduplicated, in document order. */
export function inlineScriptHashes(html: string): string[] {
  const hashes = new Set<string>();
  for (const match of html.matchAll(INLINE_SCRIPT)) {
    const attrs = match[1] ?? '';
    if (/\ssrc\s*=/i.test(attrs)) continue;
    hashes.add(scriptHash(match[2] ?? ''));
  }
  return [...hashes];
}

export function policyFor(html: string): string {
  return [`script-src 'self' ${inlineScriptHashes(html).join(' ')}`.trimEnd(), ...STATIC_DIRECTIVES].join('; ');
}

/**
 * The page with its CSP `<meta>` placed before every script. Idempotent: an existing CSP meta
 * is removed first (its own text is never hashed: it holds no script).
 */
export function applyCsp(html: string): string {
  const stripped = html.replace(CSP_META, '');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policyFor(stripped)}"/>`;
  const charset = /<meta charSet="utf-8"\/>/i;
  if (charset.test(stripped)) return stripped.replace(charset, (m) => `${m}${meta}`);
  if (/<head>/i.test(stripped)) return stripped.replace(/<head>/i, (m) => `${m}${meta}`);
  throw new Error('applyCsp: page has no <head>');
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.html'))
    .map((d) => join(d.parentPath, d.name));
}

/** Rewrites every `.html` under `outDir`; returns how many pages and distinct hashes. */
export function applyCspToDir(outDir: string): { pages: number; hashes: number } {
  const files = htmlFiles(outDir);
  if (files.length === 0) throw new Error(`applyCsp: no .html files under ${outDir}`);
  const all = new Set<string>();
  for (const file of files) {
    const html = applyCsp(readFileSync(file, 'utf8'));
    for (const h of inlineScriptHashes(html)) all.add(h);
    writeFileSync(file, html);
  }
  return { pages: files.length, hashes: all.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] ?? 'out';
  const { pages, hashes } = applyCspToDir(outDir);
  console.log(`csp: ${pages} pages, ${hashes} distinct inline-script hashes`);
}

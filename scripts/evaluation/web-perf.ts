#!/usr/bin/env -S pnpm exec tsx
/// <reference lib="dom" />
/**
 * Web performance review (Phase 7; docs/evaluation.md §8). Local, no AWS, never in the gate.
 *
 *   pnpm build && pnpm eval:web-perf     # → evals/results/web-perf.json and .md
 *
 * Two measurements, labeled for what they are:
 * 1. **Bytes per page** from the static export itself: the JS and CSS each page loads (its
 *    `<script src>` and stylesheet links, plus the inline scripts; `noModule` polyfills are not
 *    counted, as module-capable browsers skip them; chunks loaded later on demand are not seen
 *    here, so this is first-load JS), raw and gzip-compressed at
 *    level 9 (Amplify serves compressed assets; the exact CDN encoding may differ).
 * 2. **Render timings** in headless Chromium against the local e2e server (static export plus the
 *    real api app in-process over in-memory stores; tests/e2e/local-server.ts), with the CPU
 *    throttled 4× through CDP and a cold cache for every run. FCP, LCP, CLS and the long-task
 *    total after FCP (a TBT proxy), median of 3 runs. Loopback network: these are the render and
 *    script cost on a slower CPU, not network latency; production adds the CDN round trips.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { ROOT, ensureDir } from '../lib/common';

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, 'apps', 'web', 'out');
const RUNS = 3;
const CPU_SLOWDOWN = 4;

/** The pages a reviewer opens (the demo path), with the export file each one is served from. */
const PAGES: Array<{ path: string; file: string }> = [
  { path: '/', file: 'index.html' },
  { path: '/intelligence/?ticker=AAPL', file: 'intelligence/index.html' },
  { path: '/compare/?tickers=AAPL,MSFT,NVDA', file: 'compare/index.html' },
  { path: '/analysis/new/', file: 'analysis/new/index.html' },
  { path: '/findings/', file: 'findings/index.html' },
  { path: '/architecture/', file: 'architecture/index.html' },
  { path: '/sources/filing/?id=AAPL_10K_2025-10-31', file: 'sources/filing/index.html' },
];

function bytesOf(file: string) {
  const html = readFileSync(join(OUT, file), 'utf8');
  // `noModule` polyfills never load in a browser that runs modules, so they are not counted.
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)].filter((m) => !/noModule/i.test(m[0])).map((m) => m[1]!);
  const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
  const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !/\ssrc=/.test(m[0].slice(0, m[0].indexOf('>')))).map((m) => m[1]!).join('');
  const read = (u: string) => readFileSync(join(OUT, u.replace(/^\//, '').split('?')[0]!));
  const js = Buffer.concat([...srcs.map(read), Buffer.from(inline)]);
  const styles = Buffer.concat(css.map(read));
  const page = Buffer.from(html);
  const kb = (b: Buffer) => Math.round(b.length / 102.4) / 10;
  const gz = (b: Buffer) => kb(gzipSync(b, { level: 9 }));
  return { scripts: srcs.length, inlineScripts: html.match(/<script>/g)?.length ?? 0, jsKb: kb(js), jsGzipKb: gz(js), cssKb: kb(styles), cssGzipKb: gz(styles), htmlKb: kb(page), htmlGzipKb: gz(page) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('web-perf: local server did not start');
}

const server = spawn('pnpm', ['exec', 'tsx', 'tests/e2e/local-server.ts'], { cwd: ROOT, env: { ...process.env, E2E_PORT: String(PORT) }, stdio: 'ignore' });
try {
  await waitForServer();
  const browser = await chromium.launch();
  const rows = [];
  for (const p of PAGES) {
    const runs: Array<{ fcp: number; lcp: number; cls: number; longTasksMs: number }> = [];
    for (let i = 0; i < RUNS; i++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
      await page.addInitScript(() => {
        const w = window as unknown as { __perf: { lcp: number; cls: number; long: Array<{ start: number; duration: number }> } };
        w.__perf = { lcp: 0, cls: 0, long: [] };
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__perf.lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) w.__perf.cls += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__perf.long.push({ start: e.startTime, duration: e.duration });
        }).observe({ type: 'longtask', buffered: true });
      });
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      runs.push(
        await page.evaluate(() => {
          const w = window as unknown as { __perf: { lcp: number; cls: number; long: Array<{ start: number; duration: number }> } };
          const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
          const longTasksMs = w.__perf.long.filter((t) => t.start >= fcp).reduce((s, t) => s + Math.max(0, t.duration - 50), 0);
          return { fcp, lcp: w.__perf.lcp, cls: w.__perf.cls, longTasksMs };
        }),
      );
      await context.close();
    }
    const row = {
      path: p.path,
      ...bytesOf(p.file),
      fcpMs: Math.round(median(runs.map((r) => r.fcp))),
      lcpMs: Math.round(median(runs.map((r) => r.lcp))),
      cls: Math.round(median(runs.map((r) => r.cls)) * 1000) / 1000,
      blockingMs: Math.round(median(runs.map((r) => r.longTasksMs))),
    };
    rows.push(row);
    console.log(`  ${p.path}: JS ${row.jsGzipKb} KB gz, FCP ${row.fcpMs} ms, LCP ${row.lcpMs} ms, CLS ${row.cls}, blocking ${row.blockingMs} ms`);
  }
  await browser.close();

  const dir = ensureDir(join(ROOT, 'evals', 'results'));
  const ranAt = new Date().toISOString();
  writeFileSync(join(dir, 'web-perf.json'), `${JSON.stringify({ ranAt, runs: RUNS, cpuSlowdown: CPU_SLOWDOWN, browser: browser.version(), pages: rows }, null, 1)}\n`);
  writeFileSync(
    join(dir, 'web-perf.md'),
    [
      '# Web performance — static export',
      '',
      `Measured on ${new Date().toLocaleDateString('en-CA')} (local) by \`pnpm eval:web-perf\` (scripts/evaluation/web-perf.ts). Bytes come from the built export (gzip level 9). Timings: headless Chromium, 1280×800, CPU throttled ${CPU_SLOWDOWN}×, cold cache, local server over loopback (no network latency), median of ${RUNS} runs. "Blocking" is the long-task time past 50 ms after first paint (a total-blocking-time proxy).`,
      '',
      '| Page | Scripts (inline) | JS raw / gzip (KB) | CSS gzip (KB) | HTML gzip (KB) | FCP (ms) | LCP (ms) | CLS | Blocking (ms) |',
      '|---|---|---|---|---|---|---|---|---|',
      ...rows.map((r) => `| \`${r.path}\` | ${r.scripts} (${r.inlineScripts}) | ${r.jsKb} / ${r.jsGzipKb} | ${r.cssGzipKb} | ${r.htmlGzipKb} | ${r.fcpMs} | ${r.lcpMs} | ${r.cls} | ${r.blockingMs} |`),
      '',
    ].join('\n'),
  );
  console.log('  wrote evals/results/web-perf.json and .md');
} finally {
  server.kill();
}

// Renders posters.html (?v=a|b|c) to 1920×1080 PNG + JPG with Playwright's Chromium.
//   node marketing/launch-film/v2/poster/render.mjs [a b c]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b', 'c'];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
for (const v of variants) {
  await page.goto(`${pathToFileURL(join(here, 'posters.html')).href}?v=${v}`);
  await page.evaluate('document.fonts.ready'); // runs in the page, so it's a string, not a Node closure
  await page.waitForLoadState('networkidle');
  const png = join(here, `poster-${v}.png`);
  await page.screenshot({ path: png });
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-y', '-i', png, '-q:v', '2', join(here, `poster-${v}.jpg`)]);
  console.log('rendered', v);
}
await browser.close();

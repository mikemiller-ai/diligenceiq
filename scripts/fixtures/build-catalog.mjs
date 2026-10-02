// Derives the company catalog (ticker + company name) that the api uses to validate tickers
// (architecture §11: every ticker in a path or body is checked against the catalog) from the
// filing rows the web fixtures already hold. Run after `pnpm fixtures:web`; no corpus needed.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const filings = JSON.parse(readFileSync(join(root, 'apps/web/src/fixtures/generated/filings.json'), 'utf8'));
const byTicker = new Map();
for (const f of filings) if (!byTicker.has(f.ticker)) byTicker.set(f.ticker, f.company);
const catalog = [...byTicker].map(([ticker, company]) => ({ ticker, company })).sort((a, b) => a.ticker.localeCompare(b.ticker));
writeFileSync(join(root, 'packages/core/src/generated/catalog.json'), `${JSON.stringify(catalog, null, 1)}\n`);
console.log(`build-catalog: ${catalog.length} companies`);

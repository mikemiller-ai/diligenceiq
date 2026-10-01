#!/usr/bin/env node
// Phase 0 gate: required design docs exist and contain their mandatory sections.
// Later phases extend `pnpm gate` with lint, typecheck, test, cdk:synth and build.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const required = {
  'SPEC.md': [],
  'SPEC-ADDENDUM-COST.md': [],
  'CLAUDE.md': ['## Gate'],
  'STATE.md': [],
  'README.md': [],
  'docs/architecture.md': [
    '## 13. Cost and Scaling Strategy',
    '## 5. Single-call guarantee',
    '## 7. Response schema',
    '## 8. Data model',
    '## 9. API contract',
    '## 14. Testing',
  ],
  'docs/assumptions.md': ['### Known corpus anomalies'],
  'docs/design-decisions.md': ['DD-01', 'DD-04'],
  'docs/design-tokens.md': ['## Color'],
  'docs/testing-strategy.md': [],
  'docs/implementation-plan.md': [],
};

// Text that must never ship in docs (placeholders / unfinished markers).
const forbidden = [/lorem ipsum/i, /\bTODO\b/, /\bTBD\b/, /\bFIXME\b/];

const failures = [];
for (const [file, headings] of Object.entries(required)) {
  const path = join(root, file);
  if (!existsSync(path)) {
    failures.push(`missing file: ${file}`);
    continue;
  }
  const text = readFileSync(path, 'utf8');
  if (text.trim().length === 0) failures.push(`empty file: ${file}`);
  for (const h of headings) {
    if (!text.includes(h)) failures.push(`${file}: missing required section "${h}"`);
  }
  // SPEC files are the user's requirements and are exempt from placeholder checks.
  if (!file.startsWith('SPEC')) {
    for (const re of forbidden) {
      if (re.test(text)) failures.push(`${file}: contains placeholder marker ${re}`);
    }
  }
}

if (failures.length) {
  console.error(`check-docs: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-docs: OK (${Object.keys(required).length} files verified)`);

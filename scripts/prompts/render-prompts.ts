#!/usr/bin/env -S pnpm exec tsx
/**
 * Writes the prompt files from the runtime prompts: `prompts/final-diligence-prompt.md`
 * (packages/rag generation/prompt.ts) and `prompts/company-intelligence-prompt.md`
 * (packages/rag profile/prompt.ts). Run after any prompt change; a test fails until each file matches.
 *
 *   pnpm prompts:render
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDiligencePromptFile } from '@diligenceiq/rag';
import { renderCompanyIntelligencePromptFile } from '@diligenceiq/rag/profile';
import { ROOT } from '../lib/common';

for (const [name, body] of [
  ['final-diligence-prompt.md', renderDiligencePromptFile()],
  ['company-intelligence-prompt.md', renderCompanyIntelligencePromptFile()],
] as const) {
  const path = join(ROOT, 'prompts', name);
  writeFileSync(path, body);
  console.log(`wrote ${path}`);
}

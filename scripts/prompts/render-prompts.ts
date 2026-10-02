#!/usr/bin/env -S pnpm exec tsx
/**
 * Writes `prompts/final-diligence-prompt.md` from the runtime prompt (packages/rag
 * generation/prompt.ts). Run after any prompt change; a test fails until the file matches.
 *
 *   pnpm prompts:render
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDiligencePromptFile } from '@diligenceiq/rag';
import { ROOT } from '../lib/common';

const path = join(ROOT, 'prompts', 'final-diligence-prompt.md');
writeFileSync(path, renderDiligencePromptFile());
console.log(`wrote ${path}`);

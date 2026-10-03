import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CompanyIntelligenceProfile, CompanyIntelligenceProfileSchema } from '@diligenceiq/core';

/**
 * TEST-ONLY: real built profiles (llm-v3) for AAPL, TSLA, JPM, MSFT, NVDA and PFE, copied verbatim by
 * `pnpm fixtures:test-profiles` into the committed test set that the e2e "built-profiles"
 * project also serves. Never imported by application code.
 */
export const BUILT_SET_DIR = join(__dirname, '../../../../tests/fixtures/built-profile-sets/iv-9cf51c066743/llm-v3');

const load = (ticker: string): CompanyIntelligenceProfile => CompanyIntelligenceProfileSchema.parse(JSON.parse(readFileSync(join(BUILT_SET_DIR, `${ticker}.json`), 'utf8')));

export const BUILT: Readonly<Record<'AAPL' | 'TSLA' | 'JPM' | 'MSFT' | 'NVDA' | 'PFE', CompanyIntelligenceProfile>> = {
  AAPL: load('AAPL'),
  TSLA: load('TSLA'),
  JPM: load('JPM'),
  MSFT: load('MSFT'),
  NVDA: load('NVDA'),
  PFE: load('PFE'),
};

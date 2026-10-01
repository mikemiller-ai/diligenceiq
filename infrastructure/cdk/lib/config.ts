import { fileURLToPath } from 'node:url';

/** Shared deployment config. Explicit account/region so synth needs no lookups. */
export const CONFIG = {
  account: '961406434831',
  region: 'us-east-1',
  project: 'diligenceiq',
  stackNames: {
    core: 'DiligenceIQ-Core',
    api: 'DiligenceIQ-Api',
    web: 'DiligenceIQ-Web',
  },
  killSwitchParameterName: '/diligenceiq/analyses-enabled',
  logRetentionDays: 14,
  api: {
    throttleRateLimit: 10,
    throttleBurstLimit: 20,
  },
  web: {
    appName: 'diligenceiq',
    branchName: 'main',
    domainName: 'mikemiller.ai',
    subdomainPrefix: 'diligenceiq',
  },
} as const;

export const PRODUCTION_URL = `https://${CONFIG.web.subdomainPrefix}.${CONFIG.web.domainName}`;

export const TAGS = { project: CONFIG.project } as const;

const repoRoot = (rel: string) => fileURLToPath(new URL(`../../../${rel}`, import.meta.url));

export const PATHS = {
  repoRoot: repoRoot(''),
  lockFile: repoRoot('pnpm-lock.yaml'),
  apiHandler: repoRoot('services/api/src/handler.ts'),
} as const;

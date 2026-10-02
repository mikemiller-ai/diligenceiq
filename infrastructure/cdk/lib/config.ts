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
    worker: 'DiligenceIQ-Worker',
  },
  killSwitchParameterName: '/diligenceiq/analyses-enabled',
  /** `<indexVersion>/<profileSetId>` of the profile set the api serves, or "none" (DD-16). */
  activeProfileSetParameterName: '/diligenceiq/active-profile-set',
  /**
   * HMAC secret for the session cookie: an SSM SecureString created by the admin
   * (CloudFormation cannot create SecureStrings), referenced here by name only.
   */
  sessionSecretParameterName: '/diligenceiq/session-secret',
  /** Spend caps (SPEC §35.11), passed to the api as environment variables. */
  caps: { workspaceHourlyAnalyses: 10, globalDailyAnalyses: 200, dailyWorkspaceCreations: 500, perClientDailyWorkspaceCreations: 100 },
  /** The index the worker loads from s3://<data bucket>/index/<indexVersion>/ (Phase 2 build, verified in S3). */
  indexVersion: 'iv-9cf51c066743',
  models: {
    /** Cross-region inference profile; it routes to these regions' foundation models (assumptions D3). */
    generationProfile: 'us.anthropic.claude-sonnet-4-6',
    generationFoundationModel: 'anthropic.claude-sonnet-4-6',
    generationRegions: ['us-east-1', 'us-east-2', 'us-west-2'],
    embedding: 'amazon.titan-embed-text-v2:0',
  },
  worker: {
    /** Lambda timeout; the job deadline (240 s from queuedAt) and the 1080 s visibility timeout are set around it (DD-04, DD-14). */
    timeoutSeconds: 180,
    visibilityTimeoutSeconds: 1080,
    maxReceiveCount: 3,
    maxConcurrency: 2,
    /** ~1.3 GB peak during the cold index load (Phase 2: ~900 MB resident); more memory also means more CPU. */
    memoryMb: 3008,
  },
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
  workerHandler: repoRoot('services/api/src/worker-handler.ts'),
  dlqHandler: repoRoot('services/api/src/dlq-handler.ts'),
} as const;

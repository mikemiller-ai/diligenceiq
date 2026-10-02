import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import seedJson from '../../../seed/demo-workspace.json';
import { sqsAnalysisQueue } from './analyses/queue';
import { DynamoAnalysisStore } from './analyses/store';
import { type AppCaps, DEFAULT_CAPS, createApp } from './app';
import { createEvidenceStore, s3EvidenceReader } from './evidence/store';
import { log } from './http';
import { createKillSwitch } from './kill-switch';
import { createProfileProvider, s3SetReader, ssmPointerReader } from './profiles/provider';
import { createSsmSessionSecret } from './session/session';
import { SeedSchema } from './workspace/seed';
import { DynamoWorkspaceStore } from './workspace/store';

/**
 * The api Lambda (architecture §4.2, §9). Module scope holds the clients and caches so a warm
 * container reuses them. It reads DynamoDB, S3 (`intelligence/*`, the index manifest, processed
 * filings and adjacency files for the evidence routes) and SSM,
 * and sends to the analysis queue. It has no Bedrock permission and imports no model client.
 */
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const int = (name: string, fallback: number) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const region = process.env.AWS_REGION ?? 'us-east-1';
const ssm = new SSMClient({ region });
const s3 = new S3Client({ region });
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } });
const tableName = env('TABLE_NAME');
const bucket = env('DATA_BUCKET');
const indexVersion = process.env.INDEX_VERSION ?? null;

const seed = SeedSchema.safeParse(seedJson);
if (!seed.success) log('error', 'seed invalid; workspaces start empty', { issues: seed.error.issues.slice(0, 3).map((i) => i.path.join('.')) });

const caps: AppCaps = {
  workspaceHourlyAnalyses: int('WORKSPACE_HOURLY_ANALYSIS_CAP', DEFAULT_CAPS.workspaceHourlyAnalyses),
  globalDailyAnalyses: int('GLOBAL_DAILY_ANALYSIS_CAP', DEFAULT_CAPS.globalDailyAnalyses),
  dailyWorkspaceCreations: int('DAILY_WORKSPACE_CREATION_CAP', DEFAULT_CAPS.dailyWorkspaceCreations),
  perClientDailyWorkspaceCreations: int('PER_IP_DAILY_WORKSPACE_CAP', DEFAULT_CAPS.perClientDailyWorkspaceCreations),
};

/** The index manifest's existence, cached 60 s (the health check and the Deep Analysis banner). */
let indexCheck: { ok: boolean; at: number } | null = null;
async function indexAvailable(requestId: string): Promise<boolean> {
  if (!indexVersion) return false;
  if (indexCheck && Date.now() - indexCheck.at < 60_000) return indexCheck.ok;
  let ok = false;
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: `index/${indexVersion}/manifest.json` }));
    ok = true;
  } catch (err) {
    log('warn', 'index manifest unreadable', { requestId, errorName: err instanceof Error ? err.name : 'Unknown' });
  }
  indexCheck = { ok, at: Date.now() };
  return ok;
}

const app = createApp({
  killSwitch: createKillSwitch({ ssm, parameterName: process.env.KILL_SWITCH_PARAM }),
  sessionSecret: createSsmSessionSecret({ ssm, parameterName: process.env.SESSION_SECRET_PARAM }),
  analyses: new DynamoAnalysisStore(doc, tableName),
  workspace: new DynamoWorkspaceStore(doc, tableName),
  queue: sqsAnalysisQueue(new SQSClient({ region }), env('QUEUE_URL')),
  profiles: createProfileProvider({ pointer: ssmPointerReader(ssm, process.env.ACTIVE_PROFILE_SET_PARAM), read: s3SetReader(s3, bucket) }),
  seed: seed.success ? seed.data : null,
  indexVersion,
  indexAvailable,
  evidence: indexVersion ? createEvidenceStore({ indexVersion, read: s3EvidenceReader(s3, bucket) }) : null,
  caps,
});

export const handler = (event: APIGatewayProxyEventV2) => app(event);

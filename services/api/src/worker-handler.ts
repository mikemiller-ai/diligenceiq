import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Context, SQSEvent } from 'aws-lambda';
import { BedrockGenerationClient, DEFAULT_EMBEDDING_MODEL_ID, DEFAULT_GENERATION_MODEL_ID, createBedrockRuntime, createTitanQueryEmbedder } from '@diligenceiq/rag';
import { createS3IndexProvider } from './analyses/index-provider';
import { DynamoAnalysisStore } from './analyses/store';
import { type WorkerDeps, processAnalysisMessage } from './analyses/worker';
import { createKillSwitch } from './kill-switch';

/**
 * Worker Lambda (SQS, batch size 1; architecture §4.1). Module scope holds the clients and the
 * in-memory index, so a warm container reuses them. The Bedrock runtime is built with
 * `maxAttempts: 1` (DD-04).
 */
const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const region = process.env.AWS_REGION ?? 'us-east-1';
const bedrock = createBedrockRuntime(region);
const embeddingModelId = process.env.EMBEDDING_MODEL_ID ?? DEFAULT_EMBEDDING_MODEL_ID;

const deps: WorkerDeps = {
  store: new DynamoAnalysisStore(DynamoDBDocumentClient.from(new DynamoDBClient({ region }), { marshallOptions: { removeUndefinedValues: true } }), env('TABLE_NAME')),
  killSwitch: createKillSwitch({ ssm: new SSMClient({ region }), parameterName: process.env.KILL_SWITCH_PARAM }),
  index: createS3IndexProvider({ s3: new S3Client({ region }), bucket: env('DATA_BUCKET'), indexVersion: env('INDEX_VERSION') }),
  createEmbedder: () => ({ ...createTitanQueryEmbedder(bedrock, embeddingModelId), modelId: embeddingModelId }),
  generationClient: new BedrockGenerationClient(bedrock, process.env.GENERATION_MODEL_ID ?? DEFAULT_GENERATION_MODEL_ID),
};

export async function handler(event: SQSEvent, context: Context): Promise<void> {
  for (const record of event.Records) {
    await processAnalysisMessage(deps, record.body, { requestId: record.messageId, remainingTimeMs: () => context.getRemainingTimeInMillis() });
  }
}

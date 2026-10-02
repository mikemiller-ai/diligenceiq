import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { SQSEvent } from 'aws-lambda';
import { type AnalysisStore, DynamoAnalysisStore } from './analyses/store';
import { AnalysisMessageSchema } from './analyses/worker';
import { log } from './http';

/**
 * DLQ handler (architecture §4.3; DD-14): a message the worker failed 3 times before claiming
 * lands here, and its analysis is marked FAILED (WORKER_FAILED) if still QUEUED or RUNNING.
 * Event-driven, never scheduled. It never calls a model. With the 1080 s visibility timeout,
 * every redelivery arrives after the 240 s deadline, so in practice this only records poison
 * messages whose claim write itself failed three times; the poll's lazy expiry is the real
 * recovery path, and this handler usually finds the analysis already FAILED.
 */
export async function handleDeadLetters(store: AnalysisStore, event: SQSEvent, now: () => Date = () => new Date()): Promise<void> {
  for (const record of event.Records) {
    let parsed;
    try {
      parsed = AnalysisMessageSchema.parse(JSON.parse(record.body));
    } catch {
      log('warn', 'dead letter is not an analysis message; dropped', { requestId: record.messageId });
      continue;
    }
    const marked = await store.markWorkerFailed(parsed.workspaceId, parsed.analysisId, now(), record.messageId);
    log('warn', 'dead-lettered analysis', { requestId: record.messageId, ...parsed, marked });
  }
}

/** The table name, or a clear configuration error (never an empty name that fails later with a confusing DynamoDB error). */
export function requireTableName(env: NodeJS.ProcessEnv = process.env): string {
  const name = env.TABLE_NAME?.trim();
  if (!name) throw new Error('dlq-handler: TABLE_NAME is not set');
  return name;
}

let store: AnalysisStore | undefined;
export async function handler(event: SQSEvent): Promise<void> {
  store ??= new DynamoAnalysisStore(DynamoDBDocumentClient.from(new DynamoDBClient({})), requireTableName());
  await handleDeadLetters(store, event);
}

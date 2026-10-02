#!/usr/bin/env -S pnpm exec tsx
/**
 * Admin-only, in-region run of the deployed worker (Phase 4 latency and cold-load
 * measurement). It does what `POST /api/analyses` will do in Phase 5, minus sessions and caps:
 * writes a QUEUED analysis to DynamoDB, sends its message to the analysis queue, then polls
 * the record (applying the same lazy deadline expiry as the poll route) until it is terminal,
 * and prints the stages it saw and the telemetry.
 *
 *   pnpm analysis:run --question "..." [--workspace admin-phase4]
 *
 * AWS writes and spend (ask first): one DynamoDB item (+ the context snapshot item, 30-day TTL),
 * one SQS message, one Titan embedding and ONE Sonnet 4.6 generation (~$0.10). Needs the
 * DiligenceIQ-Worker stack deployed and the kill switch on.
 */
import { randomUUID } from 'node:crypto';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoAnalysisStore } from '../../services/api/src/analyses/store';
import { AWS_REGION, arg, fail } from '../lib/common';

const question = arg('question');
if (!question || question === 'true') fail('usage: pnpm analysis:run --question "..." [--workspace admin-phase4]');
const workspaceId = arg('workspace') ?? 'admin-phase4';

async function outputs(stack: string): Promise<Record<string, string>> {
  const cf = new CloudFormationClient({ region: AWS_REGION });
  const out = await cf.send(new DescribeStacksCommand({ StackName: stack }));
  return Object.fromEntries((out.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey!.replace(/[0-9A-F]{8}$/, ''), o.OutputValue!]));
}

const worker = await outputs('DiligenceIQ-Worker');
const queueUrl = worker.AnalysisQueueUrl;
const tableName = worker.TableName;
if (!queueUrl || !tableName) fail(`stack outputs missing (queue ${queueUrl}, table ${tableName})`);

const store = new DynamoAnalysisStore(DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }), { marshallOptions: { removeUndefinedValues: true } }), tableName);
const analysisId = randomUUID().replace(/-/g, '');
const t0 = Date.now();
await store.createQueued({ workspaceId, analysisId, question, origin: { kind: 'direct' }, now: new Date() });
await new SQSClient({ region: AWS_REGION }).send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ workspaceId, analysisId }) }));
console.log(`queued ${workspaceId}/${analysisId}: ${question}`);

const stages: Array<{ stage: string; atMs: number }> = [];
for (;;) {
  await new Promise((r) => setTimeout(r, 500));
  await store.expireIfPastDeadline(workspaceId, analysisId, new Date(), 'admin-poll');
  const r = await store.get(workspaceId, analysisId);
  if (!r) fail('record disappeared');
  if (r.stage && stages.at(-1)?.stage !== r.stage) {
    stages.push({ stage: r.stage, atMs: Date.now() - t0 });
    console.log(`  +${String(Date.now() - t0).padStart(6)} ms  ${r.stage}`);
  }
  if (r.status === 'COMPLETE' || r.status === 'FAILED') {
    console.log(JSON.stringify({ status: r.status, error: r.error, wallClockMs: Date.now() - t0, stages, telemetry: r.telemetry, validation: r.validation?.notices, title: r.brief?.title }, null, 1));
    break;
  }
}

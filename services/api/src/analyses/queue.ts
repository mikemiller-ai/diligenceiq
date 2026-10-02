import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { AnalysisMessage } from './worker';

/** Enqueues one analysis for the worker (architecture §4.1). The message carries IDs only. */
export interface AnalysisQueue {
  send(message: AnalysisMessage): Promise<void>;
}

export function sqsAnalysisQueue(sqs: Pick<SQSClient, 'send'>, queueUrl: string): AnalysisQueue {
  return {
    async send(message) {
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(message) }));
    },
  };
}

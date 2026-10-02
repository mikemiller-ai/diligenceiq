#!/usr/bin/env -S pnpm exec tsx
/**
 * Bedrock invoke-entitlement check (Phase 2, assumptions D3): one Titan v2 embedding of a
 * single word and one generation-model Converse call capped at 5 output tokens. Spends a
 * fraction of a cent, so it is admin-run only and never part of the gate.
 *
 *   pnpm check:bedrock
 *
 * First run 2026-10-01 (via the AWS CLI, same requests): Titan v2 → 1024 dims, normalized,
 * 3 input tokens; us.anthropic.claude-sonnet-4-6 → "OK.", 11 input / 5 output tokens, 978 ms.
 */
import { BedrockRuntimeClient, ConverseCommand, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION ?? 'us-east-1';
const embeddingModel = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';
const generationModel = process.env.GENERATION_MODEL_ID ?? 'us.anthropic.claude-sonnet-4-6';
const client = new BedrockRuntimeClient({ region, maxAttempts: 1 });

const emb = await client.send(
  new InvokeModelCommand({
    modelId: embeddingModel,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: 'revenue', dimensions: 1024, normalize: true }),
  }),
);
const body = JSON.parse(new TextDecoder().decode(emb.body)) as { embedding: number[]; inputTextTokenCount: number };
const norm = Math.sqrt(body.embedding.reduce((a, x) => a + x * x, 0));
console.log(`${embeddingModel}: ${body.embedding.length} dims, norm ${norm.toFixed(4)}, ${body.inputTextTokenCount} input tokens`);

const t0 = Date.now();
const gen = await client.send(
  new ConverseCommand({
    modelId: generationModel,
    messages: [{ role: 'user', content: [{ text: 'Reply with OK.' }] }],
    inferenceConfig: { maxTokens: 5, temperature: 0 },
  }),
);
const text = gen.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
console.log(`${generationModel}: ${JSON.stringify(text)}, ${gen.usage?.inputTokens} in / ${gen.usage?.outputTokens} out, ${Date.now() - t0} ms`);

import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { GenerationClient, GenerationRequest, GenerationResponse } from './gateway';

/**
 * Bedrock clients (architecture §6.8; DD-08). Both are built with `maxAttempts: 1`: the AWS
 * SDK otherwise retries a throttled call up to three times, and each retry is a new API
 * request (DD-04). A transient error therefore surfaces as a clean failure; a retry is a new
 * analysis that the user starts.
 */
export const DEFAULT_GENERATION_MODEL_ID = 'us.anthropic.claude-sonnet-4-6';
export const DEFAULT_EMBEDDING_MODEL_ID = 'amazon.titan-embed-text-v2:0';
export const EMBEDDING_DIMENSIONS = 1024;
/** The query embedding is aborted at this point; a timeout falls back to BM25 like any embedding failure (assumptions A1). */
export const EMBEDDING_TIMEOUT_MS = 10_000;

/** The error an aborted request ends with, whether the SDK throws or the stream simply stops. */
export function abortError(what = 'Request aborted'): Error {
  return Object.assign(new Error(what), { name: 'AbortError' });
}

/** The slice of BedrockRuntimeClient these clients use, so tests can inject a fake. */
export interface BedrockSend {
  send(command: ConverseStreamCommand | InvokeModelCommand, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

export function createBedrockRuntime(region: string): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region, maxAttempts: 1 });
}

/** One `ConverseStream` request with the forced tool (SPEC §15.1, §29.1). */
export class BedrockGenerationClient implements GenerationClient {
  constructor(
    private readonly runtime: BedrockSend,
    readonly modelId: string = DEFAULT_GENERATION_MODEL_ID,
    private readonly now: () => number = () => performance.now(),
  ) {}

  static converseInput(modelId: string, request: GenerationRequest): ConverseStreamCommandInput {
    return {
      modelId,
      system: [{ text: request.system }],
      messages: [{ role: 'user', content: [{ text: request.user }] }],
      inferenceConfig: { maxTokens: request.maxTokens, temperature: request.temperature },
      toolConfig: {
        tools: [{ toolSpec: { name: request.tool.name, description: request.tool.description, inputSchema: { json: request.tool.inputSchema as never } } }],
        toolChoice: { tool: { name: request.tool.name } },
      },
    };
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    const t0 = this.now();
    const out = (await this.runtime.send(new ConverseStreamCommand(BedrockGenerationClient.converseInput(this.modelId, request)), request.signal ? { abortSignal: request.signal } : {})) as {
      stream?: AsyncIterable<ConverseStreamOutput>;
    };
    if (request.signal?.aborted) throw abortError();
    if (!out.stream) throw new Error('Bedrock ConverseStream returned no stream');
    return collectStream(out.stream, this.modelId, t0, this.now, request.signal);
  }
}

/**
 * Assembles a ConverseStream into one response: tool input JSON from its deltas, text, stop
 * reason and usage. With a `signal`, an abort stops the iteration at once (even while waiting
 * for the next event) and throws an AbortError, so a request aborted at the generation budget
 * never comes back as a clean but truncated response.
 */
export async function collectStream(
  stream: AsyncIterable<ConverseStreamOutput>,
  modelId: string,
  t0: number,
  now: () => number = () => performance.now(),
  signal?: AbortSignal,
): Promise<GenerationResponse> {
  const toolChunks: string[] = [];
  let toolSeen = false;
  let text = '';
  let stopReason = 'unknown';
  let inputTokens = 0;
  let outputTokens = 0;
  let firstTokenMs: number | null = null;
  const iterator = stream[Symbol.asyncIterator]();
  let onAbort: (() => void) | undefined;
  const aborted = signal
    ? new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      })
    : null;
  aborted?.catch(() => {});
  const next = async (): Promise<IteratorResult<ConverseStreamOutput>> => {
    if (signal?.aborted) throw abortError();
    return aborted ? Promise.race([iterator.next(), aborted]) : iterator.next();
  };
  try {
    for (let step = await next(); !step.done; step = await next()) {
      const ev = step.value;
      if (ev.contentBlockStart?.start?.toolUse) toolSeen = true;
      const delta = ev.contentBlockDelta?.delta;
      if (delta) {
        firstTokenMs ??= Math.round(now() - t0);
        if (delta.toolUse?.input !== undefined) {
          toolSeen = true;
          toolChunks.push(delta.toolUse.input);
        }
        if (delta.text !== undefined) text += delta.text;
      }
      if (ev.messageStop) stopReason = ev.messageStop.stopReason ?? stopReason;
      if (ev.metadata?.usage) {
        inputTokens = ev.metadata.usage.inputTokens ?? 0;
        outputTokens = ev.metadata.usage.outputTokens ?? 0;
      }
      const err = ev.internalServerException ?? ev.modelStreamErrorException ?? ev.serviceUnavailableException ?? ev.throttlingException ?? ev.validationException;
      if (err) {
        const e = new Error(err.message ?? 'Bedrock stream error');
        e.name = ev.throttlingException ? 'ThrottlingException' : ev.validationException ? 'ValidationException' : ev.serviceUnavailableException ? 'ServiceUnavailableException' : ev.modelStreamErrorException ? 'ModelStreamErrorException' : 'InternalServerException';
        throw e;
      }
    }
    if (signal?.aborted) throw abortError();
  } catch (err) {
    // Ask the stream to close (not awaited: a stream stuck on a pending read would never settle),
    // and never let a close error mask the cause.
    try {
      void Promise.resolve(iterator.return?.()).catch(() => {});
    } catch {
      // ignore
    }
    throw err;
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
  let toolInput: unknown = null;
  if (toolSeen) {
    const raw = toolChunks.join('');
    try {
      toolInput = raw.length ? JSON.parse(raw) : {};
    } catch {
      toolInput = raw;
    }
  }
  return { modelId, toolInput, text, stopReason, inputTokens, outputTokens, durationMs: Math.round(now() - t0), firstTokenMs };
}

/**
 * One Titan Text Embeddings v2 call for the query (retrieval, not generation; SPEC §2.1). The
 * call is aborted after `timeoutMs` (default 10 s) so a hung request cannot eat the Lambda's
 * time; the timeout throws a TimeoutError, and the pipeline falls back to BM25.
 */
export function createTitanQueryEmbedder(runtime: BedrockSend, modelId: string = DEFAULT_EMBEDDING_MODEL_ID, opts: { timeoutMs?: number } = {}) {
  const stats = { calls: 0, inputTokens: 0 };
  const timeoutMs = opts.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  return {
    stats,
    embed: async (text: string): Promise<Float32Array> => {
      stats.calls++;
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Reject first, so the race reports the timeout rather than the SDK's AbortError.
          reject(Object.assign(new Error(`Titan query embedding exceeded ${timeoutMs} ms`), { name: 'TimeoutError' }));
          abort.abort();
        }, timeoutMs);
      });
      let res: { body: Uint8Array };
      try {
        res = (await Promise.race([
          runtime.send(
            new InvokeModelCommand({
              modelId,
              contentType: 'application/json',
              accept: 'application/json',
              body: JSON.stringify({ inputText: text, dimensions: EMBEDDING_DIMENSIONS, normalize: true }),
            }),
            { abortSignal: abort.signal },
          ),
          timedOut,
        ])) as { body: Uint8Array };
      } finally {
        clearTimeout(timer);
      }
      const body = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[]; inputTextTokenCount: number };
      if (body.embedding?.length !== EMBEDDING_DIMENSIONS) throw new Error(`Titan returned ${body.embedding?.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
      stats.inputTokens += body.inputTextTokenCount ?? 0;
      return Float32Array.from(body.embedding);
    },
  };
}

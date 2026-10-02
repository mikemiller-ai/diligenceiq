/**
 * The only way to call the generative model (SPEC §30.2; architecture §5; DD-04).
 *
 * One gateway per analysis (or, offline, per profile). It counts calls and throws on the
 * second, before anything reaches the client. `beforeCall` runs first and must persist
 * `generationStartedAt` and `generationCallCount = 1`; if it throws (for example the worker
 * lost its claim), the model is never called. The counter is taken before `beforeCall`
 * runs, so two concurrent calls can never both reach the client.
 *
 * `purpose` separates the planes: the worker only ever builds `'analysis'` gateways (a test
 * spies on the constructor across every worker path); `'profile'` is for the offline
 * Company Intelligence builder (Phase 4b, never deployed).
 */
export type GenerationPurpose = 'analysis' | 'profile';

export interface GenerationTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface GenerationRequest {
  system: string;
  user: string;
  tool: GenerationTool;
  temperature: number;
  maxTokens: number;
  /** Aborts the request at the generation budget (architecture §4.3). */
  signal?: AbortSignal;
}

export interface GenerationResponse {
  modelId: string;
  /** The forced tool's input as returned (parsed JSON when the stream assembled valid JSON, else the raw string), or null if the model did not call it. */
  toolInput: unknown;
  /** Any text the model wrote outside the tool call (normally none). */
  text: string;
  /** Bedrock stop reason: 'tool_use', 'max_tokens', 'end_turn', … */
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
  /** Wall time of the request; `firstTokenMs` when streamed. */
  durationMs: number;
  firstTokenMs: number | null;
}

/** A model client. Implementations must make exactly one API request per `generate` (no SDK retries: maxAttempts 1). */
export interface GenerationClient {
  readonly modelId: string;
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}

export class GenerationLimitError extends Error {
  constructor(purpose: GenerationPurpose) {
    super(`GenerationGateway(${purpose}): a second generation call was attempted; the limit is 1`);
    this.name = 'GenerationLimitError';
  }
}

export const MAX_GENERATION_CALLS = 1;

export class GenerationGateway {
  private calls = 0;
  private sent = 0;

  constructor(
    readonly options: {
      purpose: GenerationPurpose;
      client: GenerationClient;
      /** Persists generationStartedAt and generationCallCount = 1 before the request. Throwing here cancels the call. */
      beforeCall: () => Promise<void>;
    },
  ) {}

  get purpose(): GenerationPurpose {
    return this.options.purpose;
  }

  /** Calls taken from the budget (a call cancelled by `beforeCall` still used it). */
  get callCount(): number {
    return this.calls;
  }

  /** Requests actually handed to the client (0 or 1): the telemetry's generationCallCount. */
  get sentCount(): number {
    return this.sent;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (this.calls >= MAX_GENERATION_CALLS) throw new GenerationLimitError(this.options.purpose);
    this.calls++;
    await this.options.beforeCall();
    this.sent++;
    return this.options.client.generate(request);
  }
}

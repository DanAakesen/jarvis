import { randomUUID } from 'node:crypto';
import type { ModelCatalogue } from '@jarvis/contracts';
import type { ApprovalModelPort } from './approval-interpreter.js';
import { isRoleModelSupported } from './model-catalog.js';
import type { FoundryModelUsage } from './usage.js';

const MAX_REQUEST_BYTES = 40 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_CONTENT_BYTES = 2 * 1024;
const LOW_EFFORTS = ['none', 'minimal', 'low'] as const;

export interface ApprovalModelSelection {
  readonly model: string;
  readonly reasoningEffort: string;
  readonly maxCompletionTokens: number;
}

export interface FoundryApprovalModelOptions {
  readonly endpoint: URL;
  readonly scope: string;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  /** Undefined means no usable model is configured: the interpreter then fails closed. */
  readonly selectModel: (signal: AbortSignal) => Promise<ApprovalModelSelection | undefined>;
  readonly recordUsage: (usage: FoundryModelUsage) => Promise<void>;
  readonly fetcher?: typeof fetch;
}

/**
 * The configured chat model at its lowest supported reasoning effort. A model that is not deployed for chat, or has no
 * low-effort setting, is unavailable rather than guessed. Pricing is not required: the usage store records an unpriced
 * model as 'unverified', which the Usage view already shows honestly.
 */
export function chooseApprovalModel(catalogue: ModelCatalogue, configuredModel: string): ApprovalModelSelection | undefined {
  const deployed = catalogue.deployments.some((deployment) =>
    deployment.name === configuredModel && deployment.capabilities.includes('chat'));
  const reasoningEffort = LOW_EFFORTS.find((effort) => isRoleModelSupported(catalogue, 'chat', configuredModel, effort));
  if (!deployed || !reasoningEffort) return undefined;
  return { model: configuredModel, reasoningEffort, maxCompletionTokens: reasoningEffort === 'none' ? 200 : 1_024 };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Approval model returned an unexpected shape');
  return value as Record<string, unknown>;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Approval model response is missing or too large');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Approval model response is too large');
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * One tool-free, bounded chat completion. It returns the model's text only: the interpreter validates the verdict, so a
 * model that ignores its instructions, refuses, is cut off or is filtered can only ever produce 'neither'. Usage is
 * recorded under the chat role before the output is judged, so a billed but rejected call is still accounted for.
 * No message text, proposal text or token reaches a log or an error.
 */
export function createFoundryApprovalModel(options: FoundryApprovalModelOptions): ApprovalModelPort {
  const fetcher = options.fetcher ?? fetch;
  return async (prompt, signal) => {
    signal.throwIfAborted();
    const selected = await options.selectModel(signal);
    if (!selected) return undefined;
    signal.throwIfAborted();
    const body = JSON.stringify({
      model: selected.model,
      reasoning_effort: selected.reasoningEffort,
      response_format: { type: 'json_object' },
      max_completion_tokens: selected.maxCompletionTokens,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    });
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) return undefined;
    const token = await options.getToken(options.scope, signal);
    signal.throwIfAborted();
    if (typeof token !== 'string' || token.trim().length === 0 || /[\r\n]/u.test(token)) return undefined;

    const response = await fetcher(options.endpoint, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }

    const result = record(await boundedJson(response));
    const tokens = record(result.usage);
    if (!count(tokens.prompt_tokens) || !count(tokens.completion_tokens)) return undefined;
    await options.recordUsage({
      role: 'chat',
      model: selected.model,
      inputTokens: tokens.prompt_tokens,
      outputTokens: tokens.completion_tokens,
      eventId: randomUUID(),
    });
    signal.throwIfAborted();

    if (!Array.isArray(result.choices) || result.choices.length !== 1) return undefined;
    const choice = record(result.choices[0]);
    const message = record(choice.message);
    if (choice.finish_reason !== 'stop' || message.refusal || message.tool_calls || message.function_call ||
        typeof message.content !== 'string' || Buffer.byteLength(message.content, 'utf8') > MAX_CONTENT_BYTES) {
      return undefined;
    }
    return message.content;
  };
}

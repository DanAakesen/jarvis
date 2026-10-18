import { isRoleModelSupported, type ModelCatalogueReader } from '../core/model-catalog.js';
import { readSettings, type SettingsStore } from '../core/settings.js';
import { FOUNDRY_SCOPE } from '../foundry/client.js';
import { normalizeFoundryProjectEndpoint } from '../voice/relay.js';
import { estimateCost } from './budget.js';
import { buildProactivePrompt, PROACTIVE_SYSTEM_PROMPT } from './prompt.js';
import type { Item, SourceFact } from './types.js';

export const MAX_PROACTIVE_REQUEST_BYTES = 48 * 1024;
export const MAX_PROACTIVE_RESPONSE_BYTES = 32 * 1024;
export const MAX_PROACTIVE_COMPLETION_TOKENS = 2_048;
const TIMEOUT_MS = 45_000;
const categories = ['prep', 'news', 'weather', 'status', 'suggestion', 'todo', 'travel'] as const;

export interface ProactiveModelInput {
  now: Date;
  language: 'da' | 'en';
  guidance: string;
  deterministic: {
    title: string;
    body: string;
    category: NonNullable<Item['category']>;
    urgency: Item['urgency'];
    evidence: string[];
  }[];
  facts: SourceFact[];
}

export interface ValidatedModelFinding {
  title: string;
  body: string;
  category: typeof categories[number];
  urgency: 'normal' | 'fyi';
  evidence: string[];
  dueAt?: string;
  suggestedTodo?: string;
}

export interface ProactiveModelResult {
  reason?: 'model_unavailable' | 'invalid_model_output';
  findings: ValidatedModelFinding[];
  usage?: { model: string; inputTokens: number; outputTokens: number };
}

export interface ProactiveModel {
  worstCaseDkk(): Promise<number>;
  summarize(input: ProactiveModelInput, signal: AbortSignal): Promise<ProactiveModelResult>;
}

export interface FoundryProactiveModelOptions {
  settingsStore: SettingsStore;
  modelCatalogue: ModelCatalogueReader;
  getCredentialToken: (scope: string, signal: AbortSignal) => Promise<string>;
  foundryProjectEndpoint?: string;
  fetcher?: typeof fetch;
}

class InvalidModelOutput extends Error {}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidModelOutput();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new InvalidModelOutput();
}

function plainText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]|(?:[a-z][a-z\d+.-]*:\/\/|www\.|(?:https?|ftp|mailto|javascript|data|file|tel|sms):)|!?\[[^\]]*\]\s*[[(]/iu.test(value) ||
      /(?:^|[\s(])(?:[\p{L}\d-]+\.)+[a-z]{2,}(?:[/?#:\s)]|$)/iu.test(value)) throw new InvalidModelOutput();
  return value;
}

function isoInstant(value: unknown): string {
  const instant = plainText(value, 64);
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(instant) ||
      !Number.isFinite(Date.parse(instant)) ||
      new Date(`${instant.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== instant.slice(0, 10)) {
    throw new InvalidModelOutput();
  }
  return instant;
}

export function validateModelFindings(value: unknown, facts: SourceFact[]): ValidatedModelFinding[] {
  const root = object(value);
  exactKeys(root, ['findings']);
  if (!Array.isArray(root.findings) || root.findings.length > 10) throw new InvalidModelOutput();
  const evidence = new Map(facts.map((fact) => [fact.ref, fact]));
  const findings = root.findings.flatMap((raw) => {
    try { return [validateFinding(raw)]; }
    catch (error) {
      if (!(error instanceof InvalidModelOutput)) throw error;
      return [];
    }
  });
  if (!findings.length) throw new InvalidModelOutput();
  return findings;

  function validateFinding(raw: unknown): ValidatedModelFinding {
    const finding = object(raw);
    exactKeys(finding, ['title', 'body', 'category', 'urgency', 'evidence', 'dueAt', 'suggestedTodo']);
    if (!categories.includes(finding.category as typeof categories[number]) ||
        !['normal', 'fyi'].includes(finding.urgency as string) ||
        !Array.isArray(finding.evidence) || finding.evidence.length < 1 || finding.evidence.length > 4 ||
        finding.evidence.some((ref) => typeof ref !== 'string' || !evidence.has(ref)) ||
        new Set(finding.evidence).size !== finding.evidence.length) throw new InvalidModelOutput();
    const result: ValidatedModelFinding = {
      title: plainText(finding.title, 80), body: plainText(finding.body, 400),
      category: finding.category as ValidatedModelFinding['category'],
      urgency: finding.urgency as ValidatedModelFinding['urgency'],
      evidence: finding.evidence as string[],
    };
    result.evidence.forEach((ref) => plainText(ref, 200));
    if (finding.dueAt !== undefined) {
      const dueAt = isoInstant(finding.dueAt);
      if (result.evidence.some((ref) => evidence.get(ref)?.dueAt === dueAt)) {
        result.dueAt = dueAt;
      }
    }
    if (finding.suggestedTodo !== undefined) result.suggestedTodo = plainText(finding.suggestedTodo, 200);
    return result;
  }
}

async function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_PROACTIVE_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new InvalidModelOutput();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await cancellable(reader.read(), signal);
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROACTIVE_RESPONSE_BYTES) throw new InvalidModelOutput();
      chunks.push(value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (signal.aborted) throw error;
    throw new InvalidModelOutput();
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export function createFoundryProactiveModel(options: FoundryProactiveModelOptions): ProactiveModel {
  let endpoint: URL | undefined;
  try {
    endpoint = new URL('/models/chat/completions',
      new URL(normalizeFoundryProjectEndpoint(options.foundryProjectEndpoint ?? '')).origin);
    endpoint.searchParams.set('api-version', '2024-05-01-preview');
  } catch { /* Invalid or missing configuration leaves the model unavailable. */ }
  const fetcher = options.fetcher ?? fetch;
  let running = false;
  async function selection() {
    const catalogue = await options.modelCatalogue.read();
    const selected = (await readSettings(options.settingsStore, catalogue)).roles.chat;
    if (!isRoleModelSupported(catalogue, 'chat', selected.model, selected.reasoningEffort) ||
        !catalogue.deployments.some((deployment) =>
          deployment.name === selected.model && deployment.capabilities.includes('chat'))) {
      throw new Error('Model unavailable');
    }
    return selected;
  }
  return {
    async worstCaseDkk() {
      // One byte per input token over the entire bounded request intentionally
      // overestimates content tokens, including message framing and JSON overhead.
      // Highest known rates remain safe if Settings changes before summarize().
      return estimateCost('unknown', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk;
    },
    async summarize(input, signal) {
      signal.throwIfAborted();
      if (running || !endpoint) return { reason: 'model_unavailable', findings: [] };
      const requestEndpoint = endpoint;
      running = true;
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
      let usage: ProactiveModelResult['usage'];
      const work = async (): Promise<ProactiveModelResult> => {
        try {
          const selected = await selection();
          deadline.throwIfAborted();
          const serializeRequest = (content: string) => JSON.stringify({
            model: selected.model, reasoning_effort: selected.reasoningEffort,
            response_format: { type: 'json_object' }, max_completion_tokens: MAX_PROACTIVE_COMPLETION_TOKENS,
            messages: [
              { role: 'system', content: PROACTIVE_SYSTEM_PROMPT },
              { role: 'user', content },
            ],
          });
          const prompt = buildProactivePrompt(input, (content) =>
            Buffer.byteLength(serializeRequest(content), 'utf8') <= MAX_PROACTIVE_REQUEST_BYTES);
          const body = serializeRequest(prompt.content);
          if (Buffer.byteLength(body, 'utf8') > MAX_PROACTIVE_REQUEST_BYTES) throw new Error('Request too large');
          const token = await options.getCredentialToken(FOUNDRY_SCOPE, deadline);
          deadline.throwIfAborted();
          if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) throw new Error('Token unavailable');
          const response = await fetcher(requestEndpoint, {
            method: 'POST', redirect: 'error', signal: deadline,
            headers: { Authorization: 'Bearer '.concat(token), Accept: 'application/json', 'Content-Type': 'application/json' },
            body,
          });
          if (deadline.aborted) {
            void response.body?.cancel().catch(() => undefined);
            deadline.throwIfAborted();
          }
          if (!response.ok || response.redirected) {
            void response.body?.cancel().catch(() => undefined);
            throw new Error('Model unavailable');
          }
          const result = object(await boundedJson(response, deadline));
          const tokens = object(result.usage);
          if (![tokens.prompt_tokens, tokens.completion_tokens].every((count) =>
            typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)) throw new InvalidModelOutput();
          usage = { model: selected.model, inputTokens: tokens.prompt_tokens as number, outputTokens: tokens.completion_tokens as number };
          if (usage.outputTokens > MAX_PROACTIVE_COMPLETION_TOKENS ||
              !Array.isArray(result.choices) || result.choices.length !== 1) throw new InvalidModelOutput();
          const choice = object(result.choices[0]);
          const message = object(choice.message);
          if (choice.finish_reason !== 'stop' || message.role !== 'assistant' || message.refusal != null ||
              message.tool_calls !== undefined || message.function_call !== undefined ||
              typeof message.content !== 'string' || !message.content.trim()) throw new InvalidModelOutput();
          let decoded: unknown;
          try { decoded = JSON.parse(message.content); } catch { throw new InvalidModelOutput(); }
          return { findings: validateModelFindings(decoded, prompt.facts), usage };
        } finally {
          // A provider that ignores cancellation keeps the slot until it settles.
          running = false;
        }
      };
      try { return await cancellable(work(), deadline); }
      catch (error) {
        signal.throwIfAborted();
        return { findings: [], reason: error instanceof InvalidModelOutput ? 'invalid_model_output' : 'model_unavailable',
          ...(usage ? { usage } : {}) };
      }
    },
  };
}

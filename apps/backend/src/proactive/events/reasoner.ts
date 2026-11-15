import { isRoleModelSupported, type ModelCatalogueReader } from '../../core/model-catalog.js';
import { FOUNDRY_SCOPE } from '../../foundry/client.js';
import { estimateCost } from '../budget.js';
import { boundedJson, cancellable, foundryChatEndpoint, InvalidModelOutput } from '../model.js';
import { buildEventPrompt, EVENT_PROMPT_MAX_BYTES, EVENT_SYSTEM_PROMPT, type EventPromptInput } from './event-prompt.js';
import { outreachCategories, outreachTiers, type OutreachDecision, type QuietDecision } from './types.js';

/** The owner chose GPT-6.1 Terra for this path (15 November 2026). Settings roles do not change it. */
export const EVENT_REASONER_MODEL = 'gpt-6.1-terra';
const REASONING_EFFORT = 'low';
export const EVENT_MAX_COMPLETION_TOKENS = 4_096;
const TIMEOUT_MS = 60_000;
const MAX_DECISIONS = 10;

export interface ReasonerResult {
  reason?: 'model_unavailable' | 'invalid_model_output';
  decisions: OutreachDecision[];
  quiet: QuietDecision[];
  usage?: { model: string; inputTokens: number; outputTokens: number };
}

export interface EventReasoner {
  worstCaseDkk(): number;
  reason(input: EventPromptInput, signal: AbortSignal): Promise<ReasonerResult>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidModelOutput();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new InvalidModelOutput();
}

/** Plain text only: no markup, links or control characters. File names such as index.ts are fine. */
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > max ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]|(?:[a-z][a-z\d+.-]*:\/\/|www\.|(?:https?|ftp|mailto|javascript|data|file|tel|sms):)|!?\[[^\]]*\]\s*[[(]/iu.test(value)) {
    throw new InvalidModelOutput();
  }
  return value.trim();
}

/** All or nothing: a half-valid answer would silently lose events, so it is retried instead. */
export function validateReasonerOutput(value: unknown, eventIds: readonly string[]): { decisions: OutreachDecision[]; quiet: QuietDecision[] } {
  const root = object(value);
  exactKeys(root, ['decisions', 'quiet']);
  const rawDecisions = root.decisions ?? [];
  const rawQuiet = root.quiet ?? [];
  if (!Array.isArray(rawDecisions) || !Array.isArray(rawQuiet) ||
      rawDecisions.length > MAX_DECISIONS || rawQuiet.length > MAX_DECISIONS * 2) throw new InvalidModelOutput();
  const known = new Set(eventIds);
  const seen = new Set<string>();
  const claim = (id: unknown): string => {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) throw new InvalidModelOutput();
    seen.add(id);
    return id;
  };
  const decisions = rawDecisions.map((raw): OutreachDecision => {
    const decision = object(raw);
    exactKeys(decision, ['events', 'tier', 'title', 'body', 'why', 'category']);
    if (!Array.isArray(decision.events) || decision.events.length < 1 || decision.events.length > 10 ||
        !outreachTiers.includes(decision.tier as typeof outreachTiers[number]) ||
        !outreachCategories.includes(decision.category as typeof outreachCategories[number])) throw new InvalidModelOutput();
    return {
      eventIds: decision.events.map(claim),
      tier: decision.tier as OutreachDecision['tier'],
      title: text(decision.title, 80),
      body: text(decision.body, 400),
      why: text(decision.why, 300),
      category: decision.category as OutreachDecision['category'],
    };
  });
  const quiet = rawQuiet.map((raw): QuietDecision => {
    const entry = object(raw);
    exactKeys(entry, ['event', 'why']);
    return { eventId: claim(entry.event), why: text(entry.why, 300) };
  });
  return { decisions, quiet };
}

export interface FoundryEventReasonerOptions {
  modelCatalogue: ModelCatalogueReader;
  getCredentialToken: (scope: string, signal: AbortSignal) => Promise<string>;
  foundryProjectEndpoint?: string | undefined;
  fetcher?: typeof fetch;
  logger?: { warn(data: { reason: string; outputTokens?: number }, message: string): void };
}

export function createFoundryEventReasoner(options: FoundryEventReasonerOptions): EventReasoner {
  const endpoint = foundryChatEndpoint(options.foundryProjectEndpoint);
  const fetcher = options.fetcher ?? fetch;
  let running = false;
  return {
    worstCaseDkk() {
      // One byte per input token overestimates content tokens, including framing and JSON overhead.
      return estimateCost(EVENT_REASONER_MODEL, EVENT_PROMPT_MAX_BYTES + 4_096, EVENT_MAX_COMPLETION_TOKENS).estimatedDkk;
    },
    async reason(input, signal) {
      signal.throwIfAborted();
      if (running || !endpoint) return { reason: 'model_unavailable', decisions: [], quiet: [] };
      running = true;
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
      let usage: ReasonerResult['usage'];
      let stage = 'response';
      const work = async (): Promise<ReasonerResult> => {
        try {
          const catalogue = await options.modelCatalogue.read();
          if (!catalogue.deployments.some((deployment) =>
            deployment.name === EVENT_REASONER_MODEL && deployment.capabilities.includes('chat'))) {
            throw new Error('Model unavailable');
          }
          const effort = isRoleModelSupported(catalogue, 'chat', EVENT_REASONER_MODEL, REASONING_EFFORT)
            ? { reasoning_effort: REASONING_EFFORT } : {};
          const prompt = buildEventPrompt(input);
          const body = JSON.stringify({
            model: EVENT_REASONER_MODEL, ...effort,
            response_format: { type: 'json_object' }, max_completion_tokens: EVENT_MAX_COMPLETION_TOKENS,
            messages: [
              { role: 'system', content: EVENT_SYSTEM_PROMPT },
              { role: 'user', content: prompt.content },
            ],
          });
          deadline.throwIfAborted();
          const token = await options.getCredentialToken(FOUNDRY_SCOPE, deadline);
          deadline.throwIfAborted();
          if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) throw new Error('Token unavailable');
          const response = await fetcher(endpoint, {
            method: 'POST', redirect: 'error', signal: deadline,
            headers: { Authorization: 'Bearer '.concat(token), Accept: 'application/json', 'Content-Type': 'application/json' },
            body,
          });
          if (!response.ok || response.redirected) {
            void response.body?.cancel().catch(() => undefined);
            throw new Error('Model unavailable');
          }
          const result = object(await boundedJson(response, deadline));
          const tokens = object(result.usage);
          if (![tokens.prompt_tokens, tokens.completion_tokens].every((count) =>
            typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)) throw new InvalidModelOutput();
          usage = { model: EVENT_REASONER_MODEL, inputTokens: tokens.prompt_tokens as number, outputTokens: tokens.completion_tokens as number };
          stage = 'completion_incomplete';
          if (!Array.isArray(result.choices) || result.choices.length !== 1) throw new InvalidModelOutput();
          const choice = object(result.choices[0]);
          const message = object(choice.message);
          if (choice.finish_reason !== 'stop' || message.role !== 'assistant' || message.refusal != null ||
              (message.tool_calls != null && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) ||
              message.function_call != null || typeof message.content !== 'string' || !message.content.trim()) {
            throw new InvalidModelOutput();
          }
          stage = 'invalid_json';
          let decoded: unknown;
          try { decoded = JSON.parse(message.content); } catch { throw new InvalidModelOutput(); }
          stage = 'invalid_decisions';
          return { ...validateReasonerOutput(decoded, input.events.map(({ id }) => id)), usage };
        } finally {
          running = false;
        }
      };
      try { return await cancellable(work(), deadline); }
      catch (error) {
        signal.throwIfAborted();
        options.logger?.warn({ reason: error instanceof InvalidModelOutput ? stage : 'model_unavailable',
          ...(usage ? { outputTokens: usage.outputTokens } : {}) }, 'proactive.event_model_failed');
        return {
          decisions: [], quiet: [],
          reason: error instanceof InvalidModelOutput ? 'invalid_model_output' : 'model_unavailable',
          ...(usage ? { usage } : {}),
        };
      }
    },
  };
}

import { randomUUID } from 'node:crypto';
import { FOUNDRY_SCOPE } from '../../foundry/client.js';
import { normalizeFoundryProjectEndpoint } from '../../voice/relay.js';
import { readSettings, type SettingsStore } from '../../core/settings.js';
import { isRoleModelSupported, type ModelCatalogueReader } from '../../core/model-catalog.js';
import { foundryTokenCosts } from '../../core/usage-pricing.js';
import type { UsageStore } from '../../core/usage.js';
import { MailSemanticUnavailable, type MailSemanticModel } from './gmail.js';

const MAX_REQUEST_BYTES = 40 * 1024;
const MAX_RESPONSE_BYTES = 32 * 1024;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MailSemanticUnavailable();
  return value as Record<string, unknown>;
}
async function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let abort: () => void = () => undefined;
  try {
    return await Promise.race([work,new Promise<never>((_resolve,reject) => {
      abort = () => reject(signal.reason); signal.addEventListener('abort',abort,{ once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener('abort',abort); }
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined); throw new MailSemanticUnavailable();
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort',abort,{ once: true });
  try {
    for (;;) {
      signal.throwIfAborted(); const { done,value } = await reader.read(); signal.throwIfAborted();
      if (done) break;
      size += value.byteLength; if (size > MAX_RESPONSE_BYTES) throw new MailSemanticUnavailable(); chunks.push(value);
    }
    const bytes = Buffer.concat(chunks,size);
    try { return JSON.parse(new TextDecoder('utf-8',{ fatal: true }).decode(bytes)) as unknown; }
    finally { bytes.fill(0); }
  } catch { await reader.cancel().catch(() => undefined); throw new MailSemanticUnavailable(); }
  finally { signal.removeEventListener('abort',abort); reader.releaseLock(); }
}
/** Inactive factory for P12-09 composition. Existing identity, endpoint and chat
 * settings only. json_object is transport syntax; semantic() enforces the schema.
 * No mail or token is placed in usage metadata, errors, logs or runner messages. */
export function createFoundryMailSemanticModel(
  projectEndpoint: string,
  getToken: (scope: string, signal: AbortSignal) => Promise<string>,
  settings: SettingsStore,
  catalogueReader: ModelCatalogueReader,
  usage: UsageStore,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): MailSemanticModel {
  const endpoint = new URL('/models/chat/completions',new URL(normalizeFoundryProjectEndpoint(projectEndpoint)).origin);
  endpoint.searchParams.set('api-version','2024-05-01-preview');
  let running = false; let windowStart = now(); let calls = 0;
  const selection = async () => {
    const catalogue = await catalogueReader.read();
    const configured = (await readSettings(settings,catalogue)).roles.chat;
    if (!isRoleModelSupported(catalogue,'chat',configured.model,configured.reasoningEffort) ||
        !catalogue.deployments.some((deployment) => deployment.name === configured.model && deployment.capabilities.includes('chat')) ||
        !foundryTokenCosts(configured.model,MAX_REQUEST_BYTES,1024) || !usage.recordFoundryUsage) throw new MailSemanticUnavailable();
    return configured;
  };
  return {
    strictSchema: true,toolFree: true,
    async cacheIdentity() { try { return JSON.stringify(await cancellable(selection(),AbortSignal.timeout(30000))); } catch { throw new MailSemanticUnavailable(); } },
    async complete(input,signal) {
      signal.throwIfAborted();
      if (running || input.tools.length || input.maxOutputTokens !== 1024 || !['attention','order'].includes(input.purpose)) throw new MailSemanticUnavailable();
      const clock = now(); if (clock - windowStart >= 60000) { windowStart = clock; calls = 0; }
      if (calls >= 50) throw new MailSemanticUnavailable();
      running = true;
      const deadline = AbortSignal.any([signal,AbortSignal.timeout(30000)]);
      try {
        const selected = await cancellable(selection(),deadline); deadline.throwIfAborted();
        const body = JSON.stringify({ model: selected.model,reasoning_effort: selected.reasoningEffort,
          response_format: { type: 'json_object' },max_completion_tokens: 1024,
          messages: [
            { role: 'system',content: `${input.instructions} Return only a JSON object satisfying this exact schema: ${JSON.stringify(input.schema)}` },
            { role: 'user',content: JSON.stringify(input.data) },
          ],
        });
        if (Buffer.byteLength(body,'utf8') > MAX_REQUEST_BYTES) throw new MailSemanticUnavailable();
        const token = await cancellable(getToken(FOUNDRY_SCOPE,deadline),deadline); deadline.throwIfAborted();
        if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) throw new MailSemanticUnavailable();
        calls++;
        const response = await fetcher(endpoint,{ method: 'POST',redirect: 'error',signal: deadline,
          headers: { Authorization: `Bearer ${token}`,Accept: 'application/json','Content-Type': 'application/json' },body });
        if (!response.ok || response.redirected) { await response.body?.cancel().catch(() => undefined); throw new MailSemanticUnavailable(); }
        const result = object(await boundedJson(response,deadline));
        const tokens = object(result.usage);
        if (![tokens.prompt_tokens,tokens.completion_tokens].every((value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)) throw new MailSemanticUnavailable();
        // Account for a billed refusal/truncation too; strict output rejection
        // must not make real model usage disappear.
        await cancellable(usage.recordFoundryUsage!({ role: 'chat',model: selected.model,inputTokens: tokens.prompt_tokens as number,
          outputTokens: tokens.completion_tokens as number,eventId: randomUUID() }),deadline);
        deadline.throwIfAborted();
        if (!Array.isArray(result.choices) || result.choices.length !== 1) throw new MailSemanticUnavailable();
        const choice = object(result.choices[0]); const message = object(choice.message);
        if (choice.finish_reason !== 'stop' || message.refusal || message.tool_calls || message.function_call || typeof message.content !== 'string' ||
            Buffer.byteLength(message.content,'utf8') > 16000 || (tokens.completion_tokens as number) > 1024) throw new MailSemanticUnavailable();
        return object(JSON.parse(message.content));
      } catch { signal.throwIfAborted(); throw new MailSemanticUnavailable(); }
      finally { running = false; }
    },
  };
}

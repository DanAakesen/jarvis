import { describe, expect, it, vi } from 'vitest';
import {
  chooseApprovalModel, createFoundryApprovalModel, type FoundryApprovalModelOptions,
} from './approval-interpreter-foundry.js';
import { fallbackModelCatalogue } from './model-catalog.js';
import type { FoundryModelUsage } from './usage.js';

const endpoint = new URL('https://foundry.example.test/models/chat/completions?api-version=2024-05-01-preview');
const scope = 'https://ai.azure.com/.default';
const selection = { model: 'gpt-5.6-luna', reasoningEffort: 'none', maxCompletionTokens: 200 };
const prompt = { system: 'System text', user: 'User text' };
const verdict = '{"verdict":"approve","confidence":0.97}';

const completion = (content: unknown = verdict, overrides: Record<string, unknown> = {}) => ({
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  usage: { prompt_tokens: 210, completion_tokens: 14, total_tokens: 224 },
  ...overrides,
});
const respond = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

function setup(
  answer: () => Response | Promise<Response> = () => respond(completion()),
  overrides: Partial<FoundryApprovalModelOptions> = {},
) {
  const fetcher = vi.fn<typeof fetch>(async () => answer());
  const recordUsage = vi.fn<(usage: FoundryModelUsage) => Promise<void>>(async () => undefined);
  const getToken = vi.fn(async () => 'synthetic-token');
  const selectModel = vi.fn(async () => selection);
  const call = createFoundryApprovalModel({ endpoint, scope, getToken, selectModel, recordUsage, fetcher, ...overrides });
  return { call, fetcher, recordUsage, getToken, selectModel, signal: new AbortController().signal };
}

describe('createFoundryApprovalModel', () => {
  it('sends one bounded, tool-free, redirect-refusing request and records chat usage', async () => {
    const { call, fetcher, recordUsage, getToken, signal } = setup();
    await expect(call(prompt, signal)).resolves.toBe(verdict);
    expect(getToken).toHaveBeenCalledWith(scope, signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(endpoint);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', signal });
    expect(init?.headers).toEqual({
      Authorization: `Bearer ${await getToken.mock.results[0]!.value}`,
      Accept: 'application/json', 'Content-Type': 'application/json',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      model: 'gpt-5.6-luna', reasoning_effort: 'none', response_format: { type: 'json_object' }, max_completion_tokens: 200,
      messages: [{ role: 'system', content: 'System text' }, { role: 'user', content: 'User text' }],
    });
    expect(body).not.toHaveProperty('tools');
    expect(body).not.toHaveProperty('tool_choice');
    expect(recordUsage).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledWith({
      role: 'chat', model: 'gpt-5.6-luna', inputTokens: 210, outputTokens: 14,
      eventId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
    });
  });

  it('is unavailable, without a token request or a fetch, when no model is selectable', async () => {
    const { call, fetcher, getToken, signal } = setup(undefined, { selectModel: async () => undefined });
    await expect(call(prompt, signal)).resolves.toBeUndefined();
    expect(getToken).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send a request larger than 40 KiB', async () => {
    const { call, fetcher, signal } = setup();
    await expect(call({ system: 'System text', user: 'x'.repeat(41 * 1024) }, signal)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'abc\r\nX-Injected: 1', 'abc\nX-Injected: 1'])('refuses to send the unusable credential %j', async (token) => {
    const { call, fetcher, signal } = setup(undefined, { getToken: async () => token });
    await expect(call(prompt, signal)).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses an already aborted call before selecting a model', async () => {
    const { call, selectModel, fetcher } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(call(prompt, controller.signal)).rejects.toThrow();
    expect(selectModel).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 429, 500, 503])('returns nothing and records nothing for HTTP %i', async (status) => {
    const { call, recordUsage, signal } = setup(() => new Response('{"error":"synthetic"}', { status }));
    await expect(call(prompt, signal)).resolves.toBeUndefined();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it('returns nothing for a redirected response', async () => {
    const redirected = respond(completion());
    Object.defineProperty(redirected, 'redirected', { value: true });
    const { call, recordUsage, signal } = setup(() => redirected);
    await expect(call(prompt, signal)).resolves.toBeUndefined();
    expect(recordUsage).not.toHaveBeenCalled();
  });

  describe('response bounds', () => {
    it('rejects a declared body over 32 KiB', async () => {
      const { call, recordUsage, signal } = setup(() => respond(completion(), { headers: { 'content-length': '999999' } }));
      await expect(call(prompt, signal)).rejects.toThrow('too large');
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it('rejects a streamed body that grows past 32 KiB', async () => {
      const chunk = new Uint8Array(20 * 1024).fill(32);
      const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(chunk); controller.enqueue(chunk); controller.close(); } });
      const { call, recordUsage, signal } = setup(() => new Response(stream, { status: 200 }));
      await expect(call(prompt, signal)).rejects.toThrow('too large');
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it('rejects an empty body, invalid JSON and invalid UTF-8', async () => {
      for (const body of [null, 'not json', new Uint8Array([0xff, 0xfe, 0x7b, 0x7d])]) {
        const { call, recordUsage, signal } = setup(() => new Response(body, { status: 200 }));
        await expect(call(prompt, signal)).rejects.toThrow();
        expect(recordUsage).not.toHaveBeenCalled();
      }
    });
  });

  describe('usage', () => {
    it.each([
      [{ prompt_tokens: -1, completion_tokens: 3 }], [{ prompt_tokens: 1.5, completion_tokens: 3 }],
      [{ prompt_tokens: '10', completion_tokens: 3 }], [{ prompt_tokens: 10 }], [{ completion_tokens: 3 }],
      [{ prompt_tokens: 10, completion_tokens: Number.MAX_SAFE_INTEGER + 2 }],
    ])('returns nothing and records nothing for the token counts %j', async (usage) => {
      const { call, recordUsage, signal } = setup(() => respond(completion(verdict, { usage })));
      await expect(call(prompt, signal)).resolves.toBeUndefined();
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it('rejects a response without a usage object', async () => {
      const { call, recordUsage, signal } = setup(() => respond({ choices: completion().choices }));
      await expect(call(prompt, signal)).rejects.toThrow('unexpected shape');
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it('surfaces a usage-recording failure instead of judging an unaccounted call', async () => {
      const { call, signal } = setup(undefined, { recordUsage: async () => { throw new Error('usage store down'); } });
      await expect(call(prompt, signal)).rejects.toThrow('usage store down');
    });

    it.each([
      ['a cut-off answer', completion(verdict, { choices: [{ finish_reason: 'length', message: { content: verdict } }] })],
      ['a filtered answer', completion(verdict, { choices: [{ finish_reason: 'content_filter', message: { content: verdict } }] })],
      ['a tool-call stop', completion(verdict, { choices: [{ finish_reason: 'tool_calls', message: { content: verdict } }] })],
      ['a refusal', completion(verdict, { choices: [{ finish_reason: 'stop', message: { content: verdict, refusal: 'I cannot help.' } }] })],
      ['a tool call', completion(verdict, { choices: [{ finish_reason: 'stop', message: { content: verdict, tool_calls: [{ id: 'x' }] } }] })],
      ['a function call', completion(verdict, { choices: [{ finish_reason: 'stop', message: { content: verdict, function_call: { name: 'x' } } }] })],
      ['no choices', completion(verdict, { choices: [] })],
      ['two choices', completion(verdict, { choices: [...completion().choices, ...completion().choices] })],
      ['a missing content', completion(null)],
      ['a non-string content', completion({ verdict: 'approve' })],
      ['an oversized content', completion('x'.repeat(2 * 1024 + 1))],
    ])('accounts for the call but returns nothing for %s', async (_name, body) => {
      const { call, recordUsage, signal } = setup(() => respond(body));
      await expect(call(prompt, signal)).resolves.toBeUndefined();
      expect(recordUsage).toHaveBeenCalledTimes(1);
    });
  });
});

describe('chooseApprovalModel', () => {
  const catalogue = fallbackModelCatalogue();
  const withEfforts = (name: string, reasoningEfforts: string[]) => ({
    ...catalogue,
    deployments: catalogue.deployments.map((deployment) =>
      deployment.name === name ? { ...deployment, reasoningEfforts } as typeof deployment : deployment),
  });

  it.each(['gpt-5.6-luna', 'gpt-6-luna'])('uses the configured chat model %s with no reasoning and a small budget', (model) => {
    expect(chooseApprovalModel(catalogue, model)).toEqual({ model, reasoningEffort: 'none', maxCompletionTokens: 200 });
  });

  it('falls back to the lowest supported effort with a larger budget for reasoning models', () => {
    expect(chooseApprovalModel(withEfforts('gpt-5.6-luna', ['low', 'medium']), 'gpt-5.6-luna'))
      .toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'low', maxCompletionTokens: 1_024 });
    expect(chooseApprovalModel(withEfforts('gpt-5.6-luna', ['medium', 'minimal']), 'gpt-5.6-luna'))
      .toEqual({ model: 'gpt-5.6-luna', reasoningEffort: 'minimal', maxCompletionTokens: 1_024 });
  });

  it('is unavailable when the model has no low-effort setting', () => {
    expect(chooseApprovalModel(withEfforts('gpt-5.6-luna', ['medium', 'high']), 'gpt-5.6-luna')).toBeUndefined();
  });

  it.each(['gpt-realtime-2.1', 'text-embedding-3-small', 'claude-sonnet-5', 'default', 'not-deployed', ''])(
    'is unavailable for %j, which is not a deployed chat model', (model) => {
      expect(chooseApprovalModel(catalogue, model)).toBeUndefined();
    },
  );

  it('requires the chat capability, not only responses', () => {
    const responsesOnly = {
      ...catalogue,
      deployments: catalogue.deployments.map((deployment) =>
        deployment.name === 'gpt-5.6-luna' ? { ...deployment, capabilities: ['responses'] as typeof deployment.capabilities } : deployment),
    };
    expect(chooseApprovalModel(responsesOnly, 'gpt-5.6-luna')).toBeUndefined();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackModelCatalogue } from '../core/model-catalog.js';
import { FOUNDRY_SCOPE } from '../foundry/client.js';
import { estimateCost } from './budget.js';
import {
  createFoundryProactiveModel, MAX_PROACTIVE_COMPLETION_TOKENS, MAX_PROACTIVE_REQUEST_BYTES,
  MAX_PROACTIVE_RESPONSE_BYTES, validateModelFindings, type FoundryProactiveModelOptions, type ProactiveModelInput,
} from './model.js';

const input: ProactiveModelInput = {
  now: new Date('2026-10-17T10:00:00Z'), language: 'da', guidance: 'Prioritize preparation',
  deterministic: [], facts: [{
    ref: 'event:1', kind: 'event', label: 'Meeting', text: 'Prepare agenda',
    observedAt: '2026-10-17T09:00:00Z', dueAt: '2026-10-17T14:00:00Z',
  }],
};
const finding = {
  title: 'Prepare agenda', body: 'Review the meeting agenda', category: 'prep', urgency: 'normal',
  evidence: ['event:1'], dueAt: '2026-10-17T14:00:00Z', suggestedTodo: 'Prepare meeting agenda',
};
function envelope(content: unknown = { findings: [finding] }) {
  return {
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 300, completion_tokens: 100 },
  };
}
function setup(overrides: Partial<FoundryProactiveModelOptions> = {}) {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope()));
  const settingsStore = { read: vi.fn().mockResolvedValue({}), write: vi.fn() };
  const modelCatalogue = { read: vi.fn().mockResolvedValue(fallbackModelCatalogue()) };
  const getCredentialToken = vi.fn().mockResolvedValue('test-token');
  const model = createFoundryProactiveModel({
    foundryProjectEndpoint: 'https://test.services.ai.azure.com/api/projects/jarvis',
    settingsStore, modelCatalogue, getCredentialToken, fetcher, ...overrides,
  });
  return { model, fetcher, settingsStore, modelCatalogue, getCredentialToken };
}
const signal = () => new AbortController().signal;
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Foundry proactive model', () => {
  it('uses normalized origin, identity, current chat settings and bounded tool-free JSON', async () => {
    const { model, fetcher, settingsStore, getCredentialToken } = setup();
    settingsStore.read.mockResolvedValue({
      'roles.chat.model': JSON.stringify('gpt-6-luna'),
      'roles.chat.reasoning_effort': JSON.stringify('high'),
    });
    expect(await model.summarize(input, signal())).toEqual({
      findings: [finding], usage: { model: 'gpt-6-luna', inputTokens: 300, outputTokens: 100 },
    });
    const [url, request] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('https://test.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    expect(getCredentialToken).toHaveBeenCalledWith(FOUNDRY_SCOPE, expect.any(AbortSignal));
    expect(request).toMatchObject({ method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer '.concat('test-token') } });
    const body = JSON.parse(request!.body as string);
    expect(body).toMatchObject({
      model: 'gpt-6-luna', reasoning_effort: 'high', max_completion_tokens: MAX_PROACTIVE_COMPLETION_TOKENS,
      response_format: { type: 'json_object' },
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(Buffer.byteLength(request!.body as string)).toBeLessThanOrEqual(MAX_PROACTIVE_REQUEST_BYTES);
    const data = JSON.parse(body.messages[1].content);
    expect(data).toMatchObject({ now: input.now.toISOString(), timezone: 'Europe/Copenhagen', language: 'da' });
    expect(body.messages[0].content).toContain('UNTRUSTED DATA');
    expect(body.messages[0].content).toContain('low-priority');
    expect(await model.worstCaseDkk()).toBe(
      estimateCost('unknown', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk,
    );
  });

  it('prices highest known rates without reading settings, even if selection changes before summarize', async () => {
    const { model, settingsStore, modelCatalogue } = setup();
    const reserve = await model.worstCaseDkk();
    expect(settingsStore.read).not.toHaveBeenCalled();
    expect(modelCatalogue.read).not.toHaveBeenCalled();
    settingsStore.read.mockResolvedValue({
      'roles.chat.model': JSON.stringify('gpt-6-luna'),
      'roles.chat.reasoning_effort': JSON.stringify('high'),
    });
    expect(await model.summarize(input, signal())).toMatchObject({ usage: { model: 'gpt-6-luna' } });
    expect(reserve).toBe(estimateCost('unknown', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk);
    expect(reserve).toBeGreaterThanOrEqual(
      estimateCost('gpt-6-luna', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk,
    );
    expect(await model.worstCaseDkk()).toBe(reserve);
    expect(settingsStore.read).toHaveBeenCalledTimes(1);
    expect(modelCatalogue.read).toHaveBeenCalledTimes(1);
  });

  it('rejects empty findings with usage and refreshes settings on every call', async () => {
    const { model, fetcher, settingsStore } = setup();
    fetcher.mockImplementation(async () => Response.json(envelope({ findings: [] })));
    expect(await model.summarize(input, signal())).toMatchObject({ findings: [], reason: 'invalid_model_output' });
    settingsStore.read.mockResolvedValue({ 'roles.chat.model': JSON.stringify('gpt-6-luna') });
    expect(await model.summarize(input, signal())).toMatchObject({ usage: { model: 'gpt-6-luna' } });
    expect(settingsStore.read).toHaveBeenCalledTimes(2);
  });

  it('marks an empty findings object invalid even when there are no facts', async () => {
    const { model, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json(envelope({ findings: [] })));
    expect(await model.summarize({ ...input, facts: [] }, signal())).toEqual({
      findings: [], reason: 'invalid_model_output',
      usage: { model: 'gpt-5.6-luna', inputTokens: 300, outputTokens: 100 },
    });
  });

  it('fails closed on unsupported chat capability and uses conservative fallback pricing', async () => {
    const catalogue = fallbackModelCatalogue();
    catalogue.deployments = [];
    const { model, fetcher } = setup({ modelCatalogue: { read: async () => catalogue } });
    expect(await model.summarize(input, signal())).toEqual({ reason: 'model_unavailable', findings: [] });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await model.worstCaseDkk()).toBe(
      estimateCost('unknown', MAX_PROACTIVE_REQUEST_BYTES, MAX_PROACTIVE_COMPLETION_TOKENS).estimatedDkk,
    );
  });

  it.each(['', 'invalid', 'http://test.services.ai.azure.com/api/projects/jarvis', 'https://example.com/api/projects/jarvis'])(
    'leaves invalid endpoint configuration unavailable without throwing at startup: %j', async (foundryProjectEndpoint) => {
      const { model, fetcher, getCredentialToken } = setup({ foundryProjectEndpoint });
      expect(await model.summarize(input, signal())).toEqual({ reason: 'model_unavailable', findings: [] });
      expect(fetcher).not.toHaveBeenCalled();
      expect(getCredentialToken).not.toHaveBeenCalled();
    },
  );

  it('leaves an omitted endpoint unavailable without startup failure', async () => {
    const model = createFoundryProactiveModel({
      settingsStore: { read: async () => ({}), write: async () => {} },
      modelCatalogue: { read: async () => fallbackModelCatalogue() },
      getCredentialToken: async () => 'test-token',
    });
    expect(await model.summarize(input, signal())).toEqual({ reason: 'model_unavailable', findings: [] });
  });

  it.each(['', 'bad\r\ntoken'])('rejects invalid credentials without a request: %j', async (token) => {
    const { model, fetcher } = setup({ getCredentialToken: async () => token });
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'model_unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([302, 429, 500])('does not retry HTTP %i', async (status) => {
    const { model, fetcher } = setup();
    fetcher.mockResolvedValue(new Response('', { status }));
    expect(await model.summarize(input, signal())).toEqual({ reason: 'model_unavailable', findings: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a followed redirect even if the final response is successful', async () => {
    const { model, fetcher } = setup();
    const response = Response.json(envelope());
    Object.defineProperty(response, 'redirected', { value: true });
    fetcher.mockResolvedValue(response);
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'model_unavailable' });
  });

  it('truncates using the actual serialized request size before acquiring credentials or fetching', async () => {
    const { model, fetcher, getCredentialToken } = setup();
    const hostileInput: ProactiveModelInput = {
      ...input, guidance: '\\'.repeat(2_000),
      deterministic: Array.from({ length: 10 }, () => ({
        title: '\\'.repeat(80), body: '\\'.repeat(400), category: 'status',
        urgency: 'normal', evidence: ['event:1'],
      })),
      facts: Array.from({ length: 80 }, (_, index) => ({
        ...input.facts[0]!, ref: `event:${index}`, label: '\\'.repeat(160), text: '\\'.repeat(1_000),
      })),
    };
    const result = await model.summarize(hostileInput, signal());
    expect(result.findings).toEqual([finding]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(getCredentialToken).toHaveBeenCalledTimes(1);
    const request = fetcher.mock.calls[0]![1]!.body as string;
    expect(Buffer.byteLength(request)).toBeLessThanOrEqual(MAX_PROACTIVE_REQUEST_BYTES);
    const prompt = JSON.parse(JSON.parse(request).messages[1].content);
    expect(prompt.truncated).toBe(true);
    expect(prompt.facts.length).toBeLessThan(hostileInput.facts.length);
  });

  it('does not allow citations to facts excluded from the bounded model input', async () => {
    const { model, fetcher } = setup();
    const facts = Array.from({ length: 90 }, (_, index) => ({
      ...input.facts[0]!, ref: `event:${String(index).padStart(3, '0')}`,
    }));
    fetcher.mockResolvedValue(Response.json(envelope({ findings: [{ ...finding, evidence: ['event:089'] }] })));
    expect(await model.summarize({ ...input, facts }, signal())).toMatchObject({
      reason: 'invalid_model_output', findings: [], usage: { inputTokens: 300 },
    });
  });

  it('keeps valid siblings and usage when another model finding is rejected', async () => {
    const { model, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json(envelope({
      findings: [{ ...finding, urgency: 'time_critical' }, finding, { ...finding, dueAt: 'tomorrow' }],
    })));
    expect(await model.summarize(input, signal())).toEqual({
      findings: [finding], usage: { model: 'gpt-5.6-luna', inputTokens: 300, outputTokens: 100 },
    });
  });

  it('rejects multiple choices and a missing assistant role while retaining usage', async () => {
    const { model, fetcher } = setup();
    const response = envelope();
    response.choices.push(response.choices[0]!);
    fetcher.mockResolvedValue(Response.json(response));
    expect(await model.summarize(input, signal())).toMatchObject({
      reason: 'invalid_model_output', usage: { outputTokens: 100 },
    });
    const noRole = envelope();
    noRole.choices[0]!.message.role = 'user';
    fetcher.mockResolvedValue(Response.json(noRole));
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'invalid_model_output' });
  });

  it.each([
    { choice: { finish_reason: 'length' } },
    { choice: { finish_reason: 'tool_calls' } },
    { message: { refusal: 'Cannot comply' } },
    { message: { tool_calls: [] } },
    { message: { function_call: {} } },
    { message: { content: '' } },
    { message: { content: 'not json' } },
    { message: { content: '```json\n{"findings":[]}\n```' } },
    { message: { content: '{"findings":[{"title":"invented"}]}' } },
  ])('retains billed usage for rejected output %j', async ({ choice, message }) => {
    const { model, fetcher } = setup();
    const result = envelope();
    Object.assign(result.choices[0]!, choice);
    Object.assign(result.choices[0]!.message, message);
    fetcher.mockResolvedValue(Response.json(result));
    expect(await model.summarize(input, signal())).toEqual({
      reason: 'invalid_model_output', findings: [],
      usage: { model: 'gpt-5.6-luna', inputTokens: 300, outputTokens: 100 },
    });
  });

  it.each([undefined, { prompt_tokens: -1, completion_tokens: 10 }, { prompt_tokens: 1.1, completion_tokens: 10 }])(
    'rejects malformed usage %j', async (usage) => {
      const { model, fetcher } = setup();
      fetcher.mockResolvedValue(Response.json({ ...envelope(), usage }));
      expect(await model.summarize(input, signal())).toEqual({ reason: 'invalid_model_output', findings: [] });
    },
  );

  it('retains usage when reported completion exceeds the configured bound', async () => {
    const { model, fetcher } = setup();
    fetcher.mockResolvedValue(Response.json({
      ...envelope(), usage: { prompt_tokens: 300, completion_tokens: MAX_PROACTIVE_COMPLETION_TOKENS + 1 },
    }));
    expect(await model.summarize(input, signal())).toMatchObject({
      reason: 'invalid_model_output', usage: { outputTokens: MAX_PROACTIVE_COMPLETION_TOKENS + 1 },
    });
  });

  it.each(['', 'not json', '[]', '{}'])('rejects empty or invalid provider JSON %j', async (body) => {
    const { model, fetcher } = setup();
    fetcher.mockResolvedValue(new Response(body));
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'invalid_model_output', findings: [] });
  });

  it.each([true, false])('bounds advertised and streamed response bytes (header=%j)', async (header) => {
    const { model, fetcher } = setup();
    let cancelled = false;
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(MAX_PROACTIVE_RESPONSE_BYTES + 1)); },
      cancel() { cancelled = true; },
    }), { headers: header ? { 'content-length': String(MAX_PROACTIVE_RESPONSE_BYTES + 1) } : {} });
    fetcher.mockResolvedValue(response);
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'invalid_model_output' });
    expect(cancelled).toBe(true);
  });

  it('limits concurrent calls and bounds a noncooperating provider to 45 seconds', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('timeout')), milliseconds);
      return controller.signal;
    });
    let resolve!: (response: Response) => void;
    const { model, fetcher } = setup();
    fetcher.mockImplementation(() => new Promise<Response>((done) => { resolve = done; }));
    const first = model.summarize(input, signal());
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'model_unavailable' });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await first).toMatchObject({ reason: 'model_unavailable' });
    expect((fetcher.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
    expect(await model.summarize(input, signal())).toMatchObject({ reason: 'model_unavailable' });
    resolve(Response.json(envelope()));
    await vi.advanceTimersByTimeAsync(0);
    fetcher.mockImplementation(async () => Response.json(envelope()));
    expect(await model.summarize(input, signal())).toMatchObject({ findings: [finding] });
  });

  it('propagates caller cancellation without making another model request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const { model, fetcher } = setup();
    await expect(model.summarize(input, controller.signal)).rejects.toThrow('cancelled');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('bounds credential and catalogue stalls without model work', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('timeout')), milliseconds);
      return controller.signal;
    });
    for (const overrides of [
      { getCredentialToken: () => new Promise<string>(() => {}) },
      { modelCatalogue: { read: () => new Promise<ReturnType<typeof fallbackModelCatalogue>>(() => {}) } },
    ]) {
      const { model, fetcher } = setup(overrides);
      const result = model.summarize(input, signal());
      await vi.advanceTimersByTimeAsync(45_000);
      expect(await result).toEqual({ reason: 'model_unavailable', findings: [] });
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('aborts a stalled body reader on caller cancellation', async () => {
    const controller = new AbortController();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const { model, fetcher } = setup();
    let cancelled = false;
    fetcher.mockResolvedValue(new Response(new ReadableStream({
      pull() { reading(); },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 })));
    const result = model.summarize(input, controller.signal);
    await started;
    controller.abort(new Error('cancelled'));
    await expect(result).rejects.toThrow('cancelled');
    expect(cancelled).toBe(true);
  });
});

describe('model finding validation', () => {
  it('accepts only cited due dates and keeps proposed todos in the returned value', () => {
    expect(validateModelFindings({ findings: [finding] }, input.facts)).toEqual([finding]);
    const [withoutDue] = validateModelFindings({ findings: [{ ...finding, dueAt: '2026-10-18T14:00:00Z' }] }, input.facts);
    expect(withoutDue).not.toHaveProperty('dueAt');
    expect(withoutDue?.suggestedTodo).toBe(finding.suggestedTodo);
  });

  it('accepts exact cited ISO instants with offsets and fractional seconds', () => {
    for (const dueAt of ['2026-10-17T16:00:00+02:00', '2026-10-17T14:00:00.123456Z']) {
      expect(validateModelFindings({ findings: [{ ...finding, dueAt }] }, [{ ...input.facts[0]!, dueAt }])[0]?.dueAt).toBe(dueAt);
    }
  });

  it.each([
    { title: '' }, { title: 'a'.repeat(81) }, { body: '' }, { body: 'a'.repeat(401) },
    { title: '😀'.repeat(41) }, { body: '😀'.repeat(201) }, { suggestedTodo: '😀'.repeat(101) },
    { title: 'hello\nworld' }, { body: 'hidden\u202econtent' }, { body: '<b>text</b>' },
    { body: 'Read https://example.com' }, { body: 'Read www.example.com' },
    { body: 'Read example.com/path' }, { body: '[click](relative)' }, { body: 'mail mailto:a@example.com' },
    { body: 'Call tel:12345' }, { body: 'Visit https:example' }, { body: 'hidden\u2028paragraph' },
    { suggestedTodo: 'x'.repeat(201) }, { suggestedTodo: '' }, { suggestedTodo: 'visit https://example.com' },
    { category: 'deadline' }, { category: 'clash' }, { urgency: 'time_critical' },
    { evidence: [] }, { evidence: ['missing'] }, { evidence: ['event:1', 'event:1'] },
    { evidence: Array.from({ length: 5 }, () => 'event:1') }, { evidence: [1] },
    { evidence: 'event:1' }, { dueAt: 123 }, { unexpected: true },
    { dueAt: 'tomorrow' }, { dueAt: '2026-10-17' }, { dueAt: '2026-02-30T14:00:00Z' },
    { dueAt: '2026-10-17T25:00:00Z' }, { dueAt: '2026-10-17T14:00:00' },
  ])('rejects invalid finding fields %j', (patch) => {
    expect(() => validateModelFindings({ findings: [{ ...finding, ...patch }] }, input.facts)).toThrow();
  });

  it('rejects unknown envelope keys, excess findings and empty validated output', () => {
    expect(() => validateModelFindings({ findings: [], extra: true }, input.facts)).toThrow();
    expect(() => validateModelFindings({ findings: Array.from({ length: 11 }, () => finding) }, input.facts)).toThrow();
    expect(() => validateModelFindings({ findings: [] }, input.facts)).toThrow();
    expect(() => validateModelFindings({ findings: [{ ...finding, evidence: ['unknown'] }] }, input.facts)).toThrow();
  });

  it('rejects invalid findings individually without discarding valid siblings', () => {
    expect(validateModelFindings({
      findings: [null, { ...finding, evidence: ['unknown'] }, finding, { ...finding, unexpected: true }],
    }, input.facts)).toEqual([finding]);
  });

  it('accepts all allowed categories, fyi, exact limits and four distinct evidence refs', () => {
    const facts = Array.from({ length: 4 }, (_, index) => ({ ...input.facts[0]!, ref: `event:${index}` }));
    for (const category of ['prep', 'news', 'weather', 'status', 'suggestion', 'todo', 'travel']) {
      expect(validateModelFindings({ findings: [{
        ...finding, title: 'a'.repeat(80), body: 'b'.repeat(400), suggestedTodo: 'c'.repeat(200),
        urgency: 'fyi', category, evidence: facts.map((fact) => fact.ref),
      }] }, facts)).toHaveLength(1);
    }
    expect(validateModelFindings({ findings: [{
      ...finding, title: '😀'.repeat(40), body: '😀'.repeat(200), suggestedTodo: '😀'.repeat(100),
    }] }, input.facts)).toHaveLength(1);
  });
});

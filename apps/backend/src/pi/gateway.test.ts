import { describe, expect, it } from 'vitest';
import type { ConversationAgentChunk } from '../core/chat-agent.js';
import { PiGatewayError } from './errors.js';
import { createPiGateway, createUnconfiguredPiAgent } from './gateway.js';
import { createMemoryPiStore } from './store.js';
import { createPiTurnRegistry } from './turns.js';

const owner = '11111111-1111-4111-8111-111111111111';
const frame = (event: Record<string, unknown>) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;
const completed = (input: number, cached: number, output: number) => frame({
  type: 'response.completed', response: { status: 'completed', usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output } },
});
const sse = (...frames: string[]) => new Response(new ReadableStream({
  start(controller) { for (const text of frames) controller.enqueue(new TextEncoder().encode(text)); controller.close(); },
}), { headers: { 'content-type': 'text/event-stream' } });
const delta = (text: string) => frame({ type: 'response.output_text.delta', delta: text });
const tool = frame({ type: 'response.output_item.added', item: { type: 'mcp_call' } });

interface Call { url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> }

function setup(replies: Array<(call: Call) => Response>, overrides: Partial<Parameters<typeof createPiGateway>[0]> = {}) {
  const store = createMemoryPiStore(() => new Date('2026-11-15T16:00:00Z'));
  const registry = createPiTurnRegistry();
  const calls: Call[] = [];
  const usage: Array<{ model: string; inputTokens: number; outputTokens: number }> = [];
  let conversations = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    const call: Call = { url, body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> };
    calls.push(call);
    if (url.includes('/conversations')) { conversations += 1; return Response.json({ id: `conv_${conversations}` }); }
    return replies.shift()!(call);
  }) as typeof fetch;
  const gateway = createPiGateway({
    projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/proj', agentName: 'jarvis-pi', owner, monthlyCapDkk: 1, timeZone: 'Europe/Copenhagen',
    store, registry, fetcher, getToken: async () => 'token', context: async () => 'CONTEXT BLOCK',
    recordUsage: async (record) => { usage.push(record); }, now: () => new Date('2026-11-15T16:00:00Z'), ...overrides,
  });
  const run = async (text: string, signal = new AbortController().signal) => {
    const chunks: ConversationAgentChunk[] = [];
    for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text }, 'Bearer x', signal)) chunks.push(chunk);
    return chunks;
  };
  return { gateway, store, registry, calls, usage, run, conversations: () => conversations };
}

describe('PI gateway', () => {
  it('streams one long conversation, sends the persona once, and records tokens and DKK per turn', async () => {
    const { run, calls, store, usage, registry, conversations } = setup([
      () => sse(delta('Hello'), delta(' Dan'), completed(11_000, 9_000, 20)),
      () => sse(delta('Again'), completed(11_100, 11_000, 10)),
    ]);
    expect(await run('hi')).toEqual(['Hello', ' Dan']);
    await run('more');
    expect(conversations()).toBe(1);
    const responses = calls.filter(call => call.url.includes('/responses'));
    expect(responses[0]!.url).toBe('https://acct.services.ai.azure.com/api/projects/proj/agents/jarvis-pi/endpoint/protocols/openai/responses?api-version=v1');
    expect(responses[0]!.headers['Foundry-Features']).toContain('MicrosoftCopilot=V1Preview');
    expect(responses[0]!.body).toMatchObject({ conversation: 'conv_1', stream: true });
    const first = (responses[0]!.body!.input as Array<{ content: string }>)[0]!.content;
    const second = (responses[1]!.body!.input as Array<{ content: string }>)[0]!.content;
    expect(first).toMatch(/^CONTEXT BLOCK\n\n\[Turn jt-[A-Za-z0-9_-]{22} \| 2026-11-15 17:00 Europe\/Copenhagen\]\nhi$/u);
    expect(second).not.toContain('CONTEXT BLOCK');
    expect(store.turns.map(turn => [turn.kind, turn.outcome, turn.inputTokens, turn.cachedTokens, turn.outputTokens])).toEqual([
      ['chat', 'ok', 11_000, 9_000, 20], ['chat', 'ok', 11_100, 11_000, 10],
    ]);
    expect(store.turns[0]!.costDkk).toBeCloseTo(11_000 * 6.5785 / 1e6 + 20 * 32.8925 / 1e6, 5);
    expect(usage[0]).toMatchObject({ model: 'gpt-6.1-terra', inputTokens: 11_000, outputTokens: 20 });
    expect(registry.size).toBe(0);
  });

  it('hands the agent a live turn reference during the turn and ends it with the turn', async () => {
    const { run, registry, calls } = setup([() => sse(delta('x'), completed(1, 0, 1))]);
    await run('hi');
    const text = (calls.at(-1)!.body!.input as Array<{ content: string }>)[0]!.content;
    const turn = /\[Turn (jt-[A-Za-z0-9_-]{22})/u.exec(text)![1]!;
    expect(registry.resolve(turn)).toBeUndefined();
  });

  it('marks text before a tool call as an acknowledgment, then commentary', async () => {
    const { run } = setup([() => sse(delta('Checking.'), tool, delta('Still on it.'), tool, delta('Done.'), completed(5, 0, 5))]);
    expect(await run('look')).toEqual([
      'Checking.', { type: 'acknowledgment', text: 'Checking.' }, 'Still on it.', { type: 'commentary', text: 'Still on it.' }, 'Done.',
    ]);
  });

  it('stops before sending anything once the monthly cap is reached', async () => {
    const { run, calls, store } = setup([]);
    await store.recordTurn({ kind: 'chat', messageId: null, model: 'm', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costDkk: 1.5, firstTextMs: 1, totalMs: 1, outcome: 'ok' }, new AbortController().signal);
    await expect(run('hi')).rejects.toMatchObject({ code: 'pi_budget_exhausted' });
    expect(calls).toEqual([]);
  });

  it('reports honest errors for a missing agent, rate limiting and a broken stream, with no fallback', async () => {
    const missing = setup([() => new Response('{}', { status: 404 })]);
    await expect(missing.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable', userMessage: expect.stringContaining('not provisioned') });
    const limited = setup([() => new Response('{}', { status: 429, headers: { 'retry-after': '12' } })]);
    await expect(limited.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable', userMessage: expect.stringContaining('12 s') });
    const failed = setup([() => sse(delta('half'), frame({ type: 'response.failed', response: {} }))]);
    await expect(failed.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
    // The model had started, so the turn is charged at an estimate and counts toward the cap.
    expect(failed.store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 12_000, outputTokens: 2 });
    expect(failed.store.turns[0]!.costDkk).toBeGreaterThan(0.07);
    const refused = setup([() => new Response('{}', { status: 429 })]);
    await expect(refused.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable' });
    expect(refused.store.turns[0]).toMatchObject({ outcome: 'failed', costDkk: 0 });
    const unfinished = setup([() => sse(delta('half'))]);
    await expect(unfinished.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
    const approval = setup([() => sse(frame({ type: 'response.output_item.added', item: { type: 'mcp_approval_request' } }))]);
    await expect(approval.run('hi')).rejects.toMatchObject({ code: 'pi_failed', userMessage: expect.stringContaining('approval') });
  });

  it('records a cancelled turn, releases its authority and keeps the conversation usable', async () => {
    const controller = new AbortController();
    const { gateway, store, registry } = setup([
      () => new Response(new ReadableStream({
        start(stream) { stream.enqueue(new TextEncoder().encode(delta('first'))); },
      }), { headers: { 'content-type': 'text/event-stream' } }),
      () => sse(delta('ok'), completed(2, 0, 1)),
    ]);
    const received: ConversationAgentChunk[] = [];
    await expect((async () => {
      for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text: 'long' }, 'Bearer x', controller.signal)) {
        received.push(chunk);
        controller.abort();
      }
    })()).rejects.toBeDefined();
    expect(received).toEqual(['first']);
    expect(store.turns[0]).toMatchObject({ outcome: 'cancelled' });
    expect(registry.size).toBe(0);
    const next: ConversationAgentChunk[] = [];
    for await (const chunk of gateway.stream({ messageId: '43', sessionId: '7', text: 'again' }, 'Bearer x', new AbortController().signal)) next.push(chunk);
    expect(next).toEqual(['ok']);
  });

  it('times out with its own message when the model takes too long', async () => {
    const { run } = setup([() => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } })], { turnTimeoutMs: 30 });
    await expect(run('slow')).rejects.toMatchObject({ code: 'pi_timeout' });
  });

  it('warms once, skips a fresh conversation, and wakes the cache again after it goes stale', async () => {
    let clock = new Date('2026-11-15T16:00:00Z');
    const { gateway, calls, store } = setup([
      () => sse(delta('ready'), completed(11_000, 0, 2)),
      () => sse(delta('ready'), completed(11_000, 10_000, 2)),
    ], { now: () => clock });
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ state: 'warm', alreadyWarm: false });
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ state: 'warm', alreadyWarm: true });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    clock = new Date('2026-11-15T16:10:00Z');
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ alreadyWarm: false });
    expect(store.turns.map(turn => turn.kind)).toEqual(['warm', 'warm']);
    const status = await gateway.status(new AbortController().signal);
    expect(status).toMatchObject({ enabled: true, reason: null, warm: { state: 'warm' }, agent: { name: 'jarvis-pi', effort: 'low' } });
  });

  it('does not spend on a warm-up once over the cap, and shows what is left', async () => {
    const { gateway, calls, store } = setup([]);
    expect((await gateway.status(new AbortController().signal)).month).toEqual({ spentDkk: 0, capDkk: 1, remainingDkk: 1, turns: 0 });
    await store.recordTurn({ kind: 'chat', messageId: null, model: 'm', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costDkk: 1.2, firstTextMs: 1, totalMs: 1, outcome: 'ok' }, new AbortController().signal);
    expect(await gateway.warm(new AbortController().signal)).toEqual({ state: 'cold', alreadyWarm: false, ms: 0, skipped: 'budget_exhausted' });
    expect(calls).toEqual([]);
    expect(await gateway.status(new AbortController().signal)).toMatchObject({ enabled: false, reason: 'budget_exhausted', month: { remainingDkk: 0 } });
  });

  it('charges a failed warm-up and does not retry it for ten minutes', async () => {
    let clock = new Date('2026-11-15T16:00:00Z');
    const { gateway, calls, store } = setup([
      () => sse(delta('rea'), frame({ type: 'response.failed', response: {} })),
      () => sse(delta('ready'), completed(11_000, 0, 2)),
    ], { now: () => clock, monthlyCapDkk: 100 });
    await expect(gateway.warm(new AbortController().signal)).rejects.toMatchObject({ code: 'pi_failed' });
    expect(store.turns[0]).toMatchObject({ kind: 'warm', outcome: 'failed', inputTokens: 12_000 });
    const requests = () => calls.filter(call => call.url.includes('/responses')).length;
    expect(requests()).toBe(1);
    clock = new Date('2026-11-15T16:05:00Z');
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ skipped: 'recent_failure' });
    expect(requests()).toBe(1);
    clock = new Date('2026-11-15T16:11:00Z');
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ alreadyWarm: false });
    expect(requests()).toBe(2);
  });

  it('pauses warm-ups after three failed turns in a row, and never retries a failed chat turn by itself', async () => {
    let clock = new Date('2026-11-15T16:00:00Z');
    const failing = () => new Response('{}', { status: 500 });
    const { run, gateway, calls } = setup([failing, failing, failing, () => sse(delta('ready'), completed(11_000, 0, 2))], { now: () => clock, monthlyCapDkk: 100 });
    for (let attempt = 0; attempt < 3; attempt += 1) await expect(run('hi')).rejects.toMatchObject({ code: 'pi_unavailable' });
    // One request per failed turn: nothing retried behind the owner's back.
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(3);
    clock = new Date('2026-11-15T16:10:00Z');
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ skipped: 'paused_after_failures' });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(3);
    clock = new Date('2026-11-15T16:31:00Z');
    expect(await gateway.warm(new AbortController().signal)).toMatchObject({ alreadyWarm: false });
  });

  it('answers an unconfigured PI selection with its own error', async () => {
    const agent = createUnconfiguredPiAgent();
    await expect(agent.stream({ messageId: '1', text: 'x' }, 'a', new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toBeInstanceOf(PiGatewayError);
  });
});

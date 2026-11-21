import { describe, expect, it } from 'vitest';
import type { ConversationAgentChunk } from '../core/chat-agent.js';
import { PiGatewayError } from './errors.js';
import { createPiGateway, createUnconfiguredPiAgent } from './gateway.js';
import { chatTurnKinds, createMemoryPiStore } from './store.js';
import { createPiTurnRegistry } from './turns.js';
import type { PiActivationService } from './activation.js';

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
  let activationSequence = 0;
  const activations: PiActivationService = {
    situation: {} as never,
    async begin(input) {
      activationSequence += 1;
      const id = input.id && /^[0-9a-f-]{36}$/iu.test(input.id)
        ? input.id
        : `00000000-0000-4000-8000-${String(activationSequence).padStart(12, '0')}`;
      const grant = registry.open({
        ownerObjectId: input.ownerObjectId,
        sessionId: input.sessionId,
        messageId: input.messageId,
        ...(input.brain ? { brain: input.brain } : {}),
        signal: input.signal,
        activation: {
          id, type: input.type, source: input.source, slotKey: input.slotKey ?? null,
          stateRevision: 0, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
        },
      });
      return {
        grant,
        context: '',
        situation: {
          state: null, revision: 0, hash: null, policyRevision: 'a'.repeat(64),
          staleSources: [], missingSources: [], disabledSources: [], freshSources: [], asOf: null, updatedAt: null,
          lastActivation: null,
        },
      };
    },
    async failed() {},
  };
  const calls: Call[] = [];
  const usage: Array<{ model: string; inputTokens: number; outputTokens: number }> = [];
  let conversations = 0;
  const fetcher = (async (url: string, init: RequestInit) => {
    const call: Call = { url, body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> };
    calls.push(call);
    if (url.includes('/conversations')) { conversations += 1; return Response.json({ id: `conv_${conversations}` }); }
    if (url.includes('/cancel')) return Response.json({});
    return replies.shift()!(call);
  }) as typeof fetch;
  const gateway = createPiGateway({
    projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/proj', agentName: 'jarvis-pi', owner, monthlyCapDkk: 1, timeZone: 'Europe/Copenhagen',
    store, registry, activations, fetcher, getToken: async () => 'token', context: async () => 'CONTEXT BLOCK',
    recordUsage: async (record) => { usage.push(record); }, now: () => new Date('2026-11-15T16:00:00Z'), streamRetryDelayMs: 0, ...overrides,
  });
  const run = async (text: string, signal = new AbortController().signal) => {
    const chunks: ConversationAgentChunk[] = [];
    for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text }, 'Bearer x', signal)) chunks.push(chunk);
    return chunks;
  };
  return { gateway, store, registry, calls, usage, run, conversations: () => conversations };
}

describe('PI gateway', () => {
  it('puts the environment note on a smoke turn only when asked, so measured turns stay comparable', () => {
    const { gateway } = setup([], { environment: 'ENV NOTE' });
    const kit = gateway.smokeKit;
    expect(kit.format('jt-x', 'hi')).not.toContain('ENV NOTE');
    expect(kit.format('jt-x', 'hi', 'environment')).toContain('ENV NOTE');
    expect(setup([]).gateway.smokeKit.format('jt-x', 'hi', 'environment')).not.toContain('ENV NOTE');
  });

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
    expect(first).toMatch(/^\[Turn jt-[A-Za-z0-9_-]{22} \| 2026-11-15 17:00 Europe\/Copenhagen\]\nCONTEXT BLOCK\n\nhi$/u);
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

  it('tells the agent a voice turn is spoken, and a chat turn nothing of the kind', async () => {
    const { gateway, calls } = setup([() => sse(delta('x'), completed(1, 0, 1)), () => sse(delta('y'), completed(1, 0, 1))]);
    const input = () => (calls.at(-1)!.body!.input as Array<{ content: string }>)[0]!.content;
    for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text: 'hi', channel: 'voice' }, '', new AbortController().signal)) void chunk;
    expect(input()).toMatch(/\[Channel: voice\. [^\]]*spoken[^\]]*\]\n\nhi$/u);
    for await (const chunk of gateway.stream({ messageId: '43', sessionId: '7', text: 'again' }, '', new AbortController().signal)) void chunk;
    expect(input()).not.toContain('Channel: voice');
  });

  it('records only bounded runtime evidence for chat and voice turns', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { gateway } = setup([
      () => sse(delta('x'), completed(1, 0, 1)),
      () => sse(delta('y'), completed(1, 0, 1)),
    ], { onRuntimeTurn: (entry) => evidence.push({ ...entry }) });
    for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text: 'private chat text' }, '', new AbortController().signal)) void chunk;
    for await (const chunk of gateway.stream({ messageId: '43', sessionId: '7', text: 'private voice text', channel: 'voice' }, '', new AbortController().signal)) void chunk;
    expect(evidence).toEqual([
      { channel: 'chat', outcome: 'ok', at: '2026-11-15T16:00:00.000Z', source: 'turn' },
      { channel: 'voice', outcome: 'ok', at: '2026-11-15T16:00:00.000Z', source: 'turn' },
    ]);
  });

  it('reports bounded brain turns as Foundry runtime evidence without exposing wake text', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { gateway } = setup([
      () => sse(delta('Nothing for Dan.'), completed(1, 0, 1)),
    ], { onRuntimeTurn: (entry) => evidence.push({ ...entry }) });
    await gateway.runBrain({ runId: 'run-1', body: 'private wake text' }, new AbortController().signal);
    expect(evidence).toEqual([
      { channel: 'chat', outcome: 'ok', at: '2026-11-15T16:00:00.000Z', source: 'brain' },
    ]);
  });

  it('marks text before a tool call as an acknowledgment, then commentary', async () => {
    const { run } = setup([() => sse(delta('Checking.'), tool, delta('Still on it.'), tool, delta('Done.'), completed(5, 0, 5))]);
    expect(await run('look')).toEqual([
      'Checking.', { type: 'acknowledgment', text: 'Checking.' }, 'Still on it.', { type: 'commentary', text: 'Still on it.' }, 'Done.',
    ]);
  });

  it('reads the provider\'s own report of reach servers: listed tools and call results, with plain labels only', async () => {
    const logs: Array<[string, Record<string, unknown>]> = [];
    const listed = frame({ type: 'response.output_item.done', item: { type: 'mcp_list_tools', server_label: 'github', tools: [{}, {}, {}] } });
    const listFailed = frame({ type: 'response.output_item.done', item: { type: 'mcp_list_tools', server_label: 'azure', tools: [], error: 'unreachable' } });
    const failed = frame({ type: 'response.output_item.done', item: { type: 'mcp_call', server_label: 'github', name: 'get_issue', error: { code: 'x' } } });
    const odd = frame({ type: 'response.output_item.done', item: { type: 'mcp_call', server_label: 'bad label with spaces', name: 'x', error: null } });
    const { run } = setup([() => sse(listed, listFailed, tool, failed, odd, delta('ok'), completed(5, 0, 5))], { log: (event, fields) => logs.push([event, fields]) });
    expect(await run('look')).toEqual(['ok']);
    expect(logs.filter(([event]) => event !== 'pi.turn')).toEqual([
      ['pi.mcp_list_failed', { server: 'azure', elapsedMs: expect.any(Number) }],
      ['pi.mcp_call_failed', { server: 'github', tool: 'get_issue', code: 'x', elapsedMs: expect.any(Number) }],
    ]);
    const events: Array<{ kind: string }> = [];
    const fresh = setup([() => sse(listed, failed, odd, completed(1, 0, 1))]);
    for await (const event of fresh.gateway.smokeKit.respond('conv_1', 'x', new AbortController().signal)) events.push(event);
    expect(events).toEqual([
      { kind: 'tools_listed', server: 'github', tools: 3, failed: false },
      { kind: 'tool_done', server: 'github', name: 'get_issue', failed: true, code: 'x' },
      { kind: 'tool_done', server: '', name: 'x', failed: false },
      expect.objectContaining({ kind: 'done' }),
    ]);
  });

  it('runs a brain wake in its own scratch conversation, bills it as a brain turn, and leaves the chat cap and conversation alone', async () => {
    const { gateway, store, registry, calls, usage, conversations } = setup([() => sse(delta('Nothing for Dan.'), completed(12_000, 0, 40))]);
    let opened: string | undefined;
    const original = registry.open.bind(registry);
    registry.open = (input) => { const grant = original(input); opened = grant.turn; expect(grant.brain?.runId).toBe('run-1'); return grant; };
    const result = await gateway.runBrain({ runId: 'run-1', body: 'WAKE BODY' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: true, text: 'Nothing for Dan.', outcome: 'ok', estimated: false });
    expect(result.usage).toEqual({ inputTokens: 12_000, cachedTokens: 0, outputTokens: 40 });
    expect(result.costDkk).toBeGreaterThan(0);
    // A new conversation of its own; the owner's stored chat conversation was never bound.
    expect(conversations()).toBe(1);
    expect(await store.getConversation(owner, new AbortController().signal)).toBeNull();
    const sent = (calls.find(call => call.url.includes('/responses'))!.body!.input as Array<{ content: string }>)[0]!.content;
    expect(sent).toContain('CONTEXT BLOCK');
    expect(sent).toContain(`[Turn ${opened}`);
    expect(sent).toContain('WAKE BODY');
    expect(registry.size).toBe(0);
    expect(store.turns.map(turn => turn.kind)).toEqual(['brain']);
    expect(usage).toHaveLength(1);
    // Over the chat cap or not, a brain wake does not touch it: chat spend is chat, warm-up and smoke only.
    expect(await store.spendSince(new Date(0), chatTurnKinds, new AbortController().signal)).toEqual({ costDkk: 0, turns: 0 });
  });

  it('returns a failed brain wake with what was billed instead of throwing, and never retries it', async () => {
    const { gateway, store, calls } = setup([() => sse(delta('Looking'), frame({ type: 'response.failed', response: {} }))]);
    const result = await gateway.runBrain({ runId: 'run-2', body: 'WAKE' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, outcome: 'failed', estimated: true });
    expect(result.error).toMatchObject({ code: 'pi_failed' });
    expect(result.costDkk).toBeGreaterThan(0);
    expect(store.turns.at(-1)).toMatchObject({ kind: 'brain', outcome: 'failed' });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
  });

  it('stops before sending anything once the monthly cap is reached', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { run, calls, store } = setup([], {
      onRuntimeTurn: (entry) => evidence.push({ ...entry }),
    });
    await store.recordTurn({ kind: 'chat', messageId: null, model: 'm', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costDkk: 1.5, firstTextMs: 1, totalMs: 1, outcome: 'ok' }, new AbortController().signal);
    await expect(run('hi')).rejects.toMatchObject({ code: 'pi_budget_exhausted' });
    expect(calls).toEqual([]);
    expect(evidence).toEqual([{
      channel: 'chat', outcome: 'failed', source: 'turn',
      reason: 'budget_exhausted', at: '2026-11-15T16:00:00.000Z',
    }]);
  });

  it('does not fail or hold a turn when its spend cannot be read, and says so in diagnostics', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const logs: Array<[string, Record<string, unknown>]> = [];
    const { run, store, calls } = setup([() => sse(delta('Hello'), completed(10, 0, 2))], {
      onRuntimeTurn: (entry) => evidence.push({ ...entry }), log: (event, fields) => logs.push([event, fields]),
    });
    store.spendSince = async () => { throw new Error('sql unavailable'); };
    expect(await run('hi')).toEqual(['Hello']);
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    expect(evidence).toEqual([{ channel: 'chat', outcome: 'ok', source: 'turn', reason: 'budget_unavailable', at: '2026-11-15T16:00:00.000Z' }]);
    expect(logs.map(([event]) => event)).toContain('pi.budget_unreadable');
    expect(logs.find(([event]) => event === 'pi.turn')![1]).toMatchObject({ outcome: 'ok', budgetRead: 'unavailable' });
  });

  it('sends the tool overview on the first turn and again only when a connection changes', async () => {
    const { gateway, calls } = setup([
      () => sse(delta('1'), completed(1, 0, 1)), () => sse(delta('2'), completed(1, 0, 1)),
      () => sse(delta('3'), completed(1, 0, 1)), () => sse(delta('4'), completed(1, 0, 1)),
    ]);
    let signature = 'GitHub=idle;Azure=not_configured';
    gateway.setCapabilityNote?.(() => ({ signature, text: `OVERVIEW ${signature}` }));
    const sent = async (text: string) => {
      for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text }, '', new AbortController().signal)) void chunk;
      return (calls.filter(call => call.url.includes('/responses')).at(-1)!.body!.input as Array<{ content: string }>)[0]!.content;
    };
    expect(await sent('first')).toContain('OVERVIEW GitHub=idle;Azure=not_configured');
    expect(await sent('second')).not.toContain('OVERVIEW');
    signature = 'GitHub=ready;Azure=not_configured';
    expect(await sent('third')).toContain('OVERVIEW GitHub=ready;Azure=not_configured');
    expect(await sent('fourth')).not.toContain('OVERVIEW');
  });

  it('reports honest errors for a missing agent, rate limiting and a broken stream, with no fallback', async () => {
    const missing = setup([() => new Response('{}', { status: 404 })]);
    await expect(missing.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable', userMessage: expect.stringContaining('not provisioned') });
    const limited = setup([() => new Response('{}', { status: 429, headers: { 'retry-after': '12' } })]);
    await expect(limited.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable', userMessage: expect.stringContaining('12 s') });
    const failed = setup([() => sse(delta('half'), frame({ type: 'response.failed', response: {} }))]);
    await expect(failed.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
    // The provider's own short error code is kept for the log and the smoke; its message never is.
    // A stream that fails before any output is tried once more, so these fail twice to show what the owner finally sees.
    const coded = setup(Array.from({ length: 2 }, () => () => sse(frame({ type: 'response.failed', response: { error: { code: 'tool_user_error', message: 'Bearer secret leaked here' } } }))));
    await expect(coded.run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'tool_user_error' });
    const odd = setup(Array.from({ length: 2 }, () => () => sse(frame({ type: 'response.failed', response: { error: { code: 'not a code with spaces' } } }))));
    await expect(odd.run('hi')).rejects.toMatchObject({ detail: 'response.failed' });
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

  it('never lets a warm-up and a chat turn overlap on the one conversation, whichever starts first', async () => {
    const gate = () => { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { wait, open }; };
    // Warm-up first: it suspends on a store read while a chat turn arrives; the turn must wait, then run alone.
    const warmGate = gate();
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const tracked = (label: string, body: string[]) => () => {
      order.push(label);
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      return new Response(new ReadableStream({
        async start(controller) {
          await new Promise(resolve => setTimeout(resolve, 20));
          for (const text of body) controller.enqueue(new TextEncoder().encode(text));
          inFlight -= 1; controller.close();
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
    const first = setup([tracked('warm', [delta('ready'), completed(11_000, 0, 2)]), tracked('chat', [delta('hi'), completed(11_100, 11_000, 3)])]);
    const original = first.store.spendSince.bind(first.store);
    let gated = true;
    first.store.spendSince = async (from, signal) => { if (gated) { gated = false; await warmGate.wait; } return original(from, signal); };
    const warming = first.gateway.warm(new AbortController().signal);
    const turn = first.run('hello');
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(first.calls.filter(call => call.url.includes('/responses'))).toHaveLength(0);
    warmGate.open();
    await Promise.all([warming, turn]);
    expect(order).toEqual(['warm', 'chat']);
    expect(maxInFlight).toBe(1);

    // Chat turn first: it suspends before its request; a warm-up arriving then spends nothing and sends nothing.
    const chatGate = gate();
    const second = setup([tracked('chat', [delta('hi'), completed(1, 0, 1)])]);
    const read = second.store.getConversation.bind(second.store);
    second.store.getConversation = async (owner, signal) => { await chatGate.wait; return read(owner, signal); };
    const chat = second.run('hello');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(await second.gateway.warm(new AbortController().signal)).toMatchObject({ alreadyWarm: true, ms: 0 });
    chatGate.open();
    await chat;
    expect(second.calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    expect(second.store.turns.map(turn => turn.kind)).toEqual(['chat']);
  });

  it('records a claim refusal without sending a model request', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { gateway, calls } = setup([
      () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(delta('first'))); },
      }), { headers: { 'content-type': 'text/event-stream' } }),
    ], { onRuntimeTurn: (entry) => evidence.push({ ...entry }) });
    const controller = new AbortController();
    const first = gateway.stream(
      { messageId: '42', sessionId: '7', text: 'first' }, '', controller.signal,
    );
    expect((await first.next()).value).toBe('first');
    const second = async () => {
      for await (const chunk of gateway.stream(
        { messageId: '43', sessionId: '7', text: 'second' }, '', new AbortController().signal,
      )) void chunk;
    };
    await expect(second()).rejects.toMatchObject({ code: 'pi_failed' });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    expect(evidence).toContainEqual(expect.objectContaining({
      channel: 'chat', outcome: 'failed', source: 'turn', reason: 'busy',
    }));
    controller.abort();
    await first.return(undefined).catch(() => undefined);
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

  describe('a reply stream that dies before the model produced anything', () => {
    const created = frame({ type: 'response.created', response: { id: 'resp_1' } });
    const listed = frame({ type: 'response.output_item.done', item: { type: 'mcp_list_tools', server_label: 'github', tools: [{}] } });
    const failedFrame = (code = 'server_error') => frame({ type: 'response.failed', response: { error: { code, message: 'private provider text' } } });
    const broken = () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(created)); setTimeout(() => controller.error(new Error('connection reset')), 5); },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const responsesOf = (calls: Call[]) => calls.filter(call => call.url.includes('/responses') && !call.url.includes('/cancel'));
    const capture = () => {
      const logs: Array<[string, Record<string, unknown>]> = [];
      return { logs, log: (event: string, fields: Record<string, unknown>) => { logs.push([event, fields]); } };
    };

    it.each([
      ['response.failed', () => sse(created, listed, failedFrame()), 'foundry_response_failed', false],
      ['error', () => sse(frame({ type: 'error', code: 'server_error', message: 'private provider text' })), 'foundry_response_failed', false],
      ['response.incomplete', () => sse(created, frame({ type: 'response.incomplete', response: { status: 'incomplete' } })), 'foundry_response_failed', false],
      ['a stream that ends early', () => sse(created), 'stream_ended_without_completed', true],
      ['a stream that breaks', broken, 'stream_broke', true],
    ])('retries once on %s, with the same message and conversation, billing the turn once', async (_name, first, reason, cancelsFirst) => {
      const { logs, log } = capture();
      const { run, calls, store, usage, conversations } = setup([first, () => sse(created, delta('Hi'), completed(100, 0, 10))], { log });
      expect(await run('private question')).toEqual(['Hi']);
      const responses = responsesOf(calls);
      expect(responses).toHaveLength(2);
      expect(responses[1]!.body).toEqual(responses[0]!.body);
      expect(responses[0]!.body).toMatchObject({ conversation: 'conv_1' });
      expect(conversations()).toBe(1);
      // A response that only stopped may still run on Foundry's side, so it is cancelled before the retry; a failed one is already over.
      expect(calls.filter(call => call.url.includes('/responses/resp_1/cancel'))).toHaveLength(cancelsFirst ? 1 : 0);
      expect(logs.filter(([event]) => event === 'pi.stream_failed')).toEqual([[
        'pi.stream_failed', expect.objectContaining({ reason, attempt: 1, sawText: false, sawTool: false, sawOutput: false, previousCancelled: false }),
      ]]);
      expect(logs.filter(([event]) => event === 'pi.stream_retry')).toEqual([[
        'pi.stream_retry', expect.objectContaining({ reason, attempt: 1, elapsedMs: expect.any(Number) }),
      ]]);
      // One turn, one usage report, one cap check: the failed attempt is not billed a second time.
      expect(store.turns).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'ok', inputTokens: 100, outputTokens: 10 });
      expect(usage).toEqual([expect.objectContaining({ inputTokens: 100, outputTokens: 10 })]);
      expect(logs.find(([event]) => event === 'pi.turn')![1]).toMatchObject({ outcome: 'ok', inputTokens: 100, outputTokens: 10 });
      expect(JSON.stringify(logs)).not.toMatch(/private/u);
    });

    it('reads the spend once for a retried turn', async () => {
      const { run, store } = setup([() => sse(failedFrame()), () => sse(delta('Hi'), completed(1, 0, 1))]);
      let reads = 0;
      const spend = store.spendSince.bind(store);
      store.spendSince = async (from, kinds, signal) => { reads += 1; return spend(from, kinds, signal); };
      await run('hi');
      expect(reads).toBe(1);
    });

    it.each([
      ['text', [created, delta('Let me')]],
      ['a tool call', [created, tool]],
      ['reasoning', [created, frame({ type: 'response.reasoning_summary_text.delta', delta: 'thinking' })]],
      ['a reasoning item', [created, frame({ type: 'response.output_item.added', item: { type: 'reasoning' } })]],
      ['an unknown event', [created, frame({ type: 'response.something_new' })]],
    ])('never retries after %s', async (_name, frames) => {
      const { logs, log } = capture();
      const { run, calls, store } = setup([() => sse(...frames, failedFrame()), () => sse(delta('again'), completed(1, 0, 1))], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_retry');
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'foundry_response_failed', sawOutput: true });
      expect(store.turns).toHaveLength(1);
    });

    it('never retries a function call or approval request, and never an HTTP failure or a missing stream', async () => {
      const { logs, log } = capture();
      const call = setup([() => sse(created, frame({ type: 'response.output_item.added', item: { type: 'function_call' } })), () => sse(delta('x'), completed(1, 0, 1))], { log });
      await expect(call.run('hi')).rejects.toMatchObject({ code: 'pi_failed', userMessage: expect.stringContaining('approval') });
      expect(responsesOf(call.calls)).toHaveLength(1);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'approval_or_function_call_item', sawTool: true, sawOutput: true });
      const http = setup([() => new Response('{}', { status: 500 }), () => sse(delta('x'), completed(1, 0, 1))]);
      await expect(http.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable' });
      expect(responsesOf(http.calls)).toHaveLength(1);
      const none = capture();
      const empty = setup([() => new Response(null), () => sse(delta('x'), completed(1, 0, 1))], { log: none.log });
      await expect(empty.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(empty.calls)).toHaveLength(1);
      expect(none.logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'no_stream' });
    });

    it('surfaces pi_failed with the logged reason when the retry fails too, and charges nothing', async () => {
      const { logs, log } = capture();
      const { run, calls, store, usage } = setup([() => sse(created, failedFrame('server_error')), () => sse(created)], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(2);
      expect(logs.filter(([event]) => event === 'pi.stream_failed').map(([, fields]) => [fields.reason, fields.attempt])).toEqual([
        ['foundry_response_failed', 1], ['stream_ended_without_completed', 2],
      ]);
      expect(logs.filter(([event]) => event === 'pi.stream_retry')).toHaveLength(1);
      expect(store.turns).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 0, costDkk: 0 });
      expect(usage).toEqual([]);
    });

    it('stops at once when the turn is cancelled during the retry or while waiting to retry', async () => {
      const stalled = () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
      const during = new AbortController();
      const retrying = setup([() => sse(failedFrame()), () => { during.abort(); return stalled(); }]);
      await expect(retrying.run('hi', during.signal)).rejects.toBeDefined();
      expect(responsesOf(retrying.calls)).toHaveLength(2);
      expect(retrying.store.turns[0]).toMatchObject({ outcome: 'cancelled' });
      expect(retrying.registry.size).toBe(0);

      const waiting = new AbortController();
      const paused = setup([() => sse(failedFrame()), stalled], { streamRetryDelayMs: 60_000 });
      const started = performance.now();
      const turn = paused.run('hi', waiting.signal);
      setTimeout(() => waiting.abort(), 20);
      await expect(turn).rejects.toBeDefined();
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(responsesOf(paused.calls)).toHaveLength(1);
      expect(paused.store.turns[0]).toMatchObject({ outcome: 'cancelled' });
    });

    it('stops retrying when the turn deadline passes', async () => {
      const paused = setup([() => sse(failedFrame()), () => sse(delta('late'), completed(1, 0, 1))], { streamRetryDelayMs: 60_000, turnTimeoutMs: 40 });
      await expect(paused.run('hi')).rejects.toMatchObject({ code: 'pi_timeout' });
      expect(responsesOf(paused.calls)).toHaveLength(1);
    });

    it('logs one distinct reason for the other pi_failed sites, and whether the previous turn was just cancelled', async () => {
      const none = capture();
      const noConversation = setup([], { log: none.log, fetcher: (async () => Response.json({})) as unknown as typeof fetch });
      await expect(noConversation.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(none.logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'no_conversation' });

      const { logs, log } = capture();
      const cancelled = new AbortController();
      const { run } = setup([
        () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(delta('first'))); } }), { headers: { 'content-type': 'text/event-stream' } }),
        () => sse(created), () => sse(created),
      ], { log, streamRetryDelayMs: 0 });
      const first = run('one', cancelled.signal);
      setTimeout(() => cancelled.abort(), 20);
      await expect(first).rejects.toBeDefined();
      await expect(run('two')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(logs.filter(([event]) => event === 'pi.stream_failed').map(([, fields]) => fields.previousCancelled)).toEqual([true, true]);
    });
  });

  it('answers an unconfigured PI selection with its own error', async () => {
    const agent = createUnconfiguredPiAgent();
    await expect(agent.stream({ messageId: '1', text: 'x' }, 'a', new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toBeInstanceOf(PiGatewayError);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ConversationAgentChunk } from '../core/chat-agent.js';
import { defaultAwayModeState } from '../core/away-mode.js';
import { defaultSettings } from '../core/settings.js';
import { createPiVoiceTurns, PI_VOICE_TURN_DEADLINE_MS } from '../voice/pi-voice.js';
import { buildPiContext, buildPiEnvironment } from './context.js';
import { failureCopy } from '@jarvis/contracts';
import { PiGatewayError } from './errors.js';
import { createPiGateway, createUnconfiguredPiAgent } from './gateway.js';
import { runPiSmoke } from './smoke.js';
import { chatTurnKinds, createMemoryPiStore } from './store.js';
import { createPiTurnRegistry } from './turns.js';
import type { PiActivationService } from './activation.js';
import type { PiTurnGrant } from './turns.js';

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

interface Call { method: string | undefined; url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> }
const turnOf = (call: Call) => /\[Turn (jt-[A-Za-z0-9_-]{22})/u.exec((call.body!.input as Array<{ content: string }>)[0]!.content)![1]!;

function setup(replies: Array<(call: Call) => Response | Promise<Response>>, overrides: Partial<Parameters<typeof createPiGateway>[0]> = {}) {
  const store = createMemoryPiStore(() => new Date('2026-11-15T16:00:00Z'));
  const registry = createPiTurnRegistry();
  let activationSequence = 0;
  let situationText = '';
  const activations: PiActivationService = {
    situation: { context: async () => ({ text: situationText, view: {} as never }) } as never,
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
        context: situationText,
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
  let cancelReply: () => Response | Promise<Response> = () => Response.json({});
  let cleanupReply: (signal: AbortSignal) => Response | Promise<Response> = () => new Response(null, { status: 204 });
  const fetcher = (async (url: string, init: RequestInit) => {
    const call: Call = { method: init.method, url, body: init.body ? JSON.parse(init.body as string) : undefined, headers: init.headers as Record<string, string> };
    calls.push(call);
    if (init.method === 'DELETE') return cleanupReply(init.signal!);
    if (url.includes('/conversations')) { conversations += 1; return Response.json({ id: `conv_${conversations}` }); }
    if (url.includes('/cancel')) return cancelReply();
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
  return {
    gateway, store, registry, calls, usage, run, conversations: () => conversations,
    setCancel: (reply: typeof cancelReply) => { cancelReply = reply; },
    setCleanup: (reply: typeof cleanupReply) => { cleanupReply = reply; },
    setSituation: (text: string) => { situationText = text; },
  };
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
    expect(store.turns[0]!.costDkk).toBe(0.01713);
    expect(usage[0]).toMatchObject({ model: 'gpt-6.1-terra', inputTokens: 11_000, outputTokens: 20 });
    expect(registry.size).toBe(0);
  });

  it('charges a 95% cache hit turn at the Azure cache-read rate in the monthly ledger', async () => {
    const { run, store, gateway } = setup([() => sse(delta('Done.'), completed(100_000, 95_000, 2_000))]);
    await run('hi');
    // 95k cache reads + 5k uncached input + 2k output = 0.1328 DKK, not the old ~0.72.
    expect(store.turns[0]).toMatchObject({ inputTokens: 100_000, cachedTokens: 95_000, outputTokens: 2_000, costDkk: 0.1328 });
    expect((await gateway.status(new AbortController().signal)).month.spentDkk).toBe(0.1328);
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
    const signal = new AbortController().signal;
    await store.bindConversation(owner, 'jarvis-pi', 'owner_conv', signal);
    let opened: string | undefined;
    const original = registry.open.bind(registry);
    registry.open = (input) => { const grant = original(input); opened = grant.turn; expect(grant.brain?.runId).toBe('run-1'); return grant; };
    const result = await gateway.runBrain({ runId: 'run-1', body: 'WAKE BODY' }, signal);
    expect(result).toMatchObject({ ok: true, text: 'Nothing for Dan.', outcome: 'ok', estimated: false });
    expect(result.usage).toEqual({ inputTokens: 12_000, cachedTokens: 0, outputTokens: 40 });
    expect(result.costDkk).toBeGreaterThan(0);
    expect(conversations()).toBe(1);
    expect(await store.getConversation(owner, signal)).toMatchObject({ conversationId: 'owner_conv' });
    expect(calls.filter(call => call.method === 'DELETE')).toEqual([{
      method: 'DELETE',
      url: 'https://acct.services.ai.azure.com/api/projects/proj/agents/jarvis-pi/endpoint/protocols/openai/conversations/conv_1?api-version=v1',
      body: undefined, headers: calls[0]!.headers,
    }]);
    const sent = (calls.find(call => call.url.includes('/responses'))!.body!.input as Array<{ content: string }>)[0]!.content;
    expect(sent).toContain('CONTEXT BLOCK');
    expect(sent).toContain(`[Turn ${opened}`);
    expect(sent).toContain('WAKE BODY');
    expect(registry.size).toBe(0);
    expect(store.turns.map(turn => turn.kind)).toEqual(['brain']);
    expect(usage).toHaveLength(1);
    // Over the chat cap or not, a brain wake does not touch it: chat spend is chat, warm-up and smoke only.
    expect(await store.spendSince(new Date(0), chatTurnKinds, signal)).toEqual({ costDkk: 0, turns: 0 });
  });

  it('returns a failed brain wake with what was billed instead of throwing, and never retries it', async () => {
    const { gateway, store, calls } = setup([() => sse(delta('Looking'), frame({ type: 'response.failed', response: {} }))]);
    const result = await gateway.runBrain({ runId: 'run-2', body: 'WAKE' }, new AbortController().signal);
    expect(result).toMatchObject({ ok: false, outcome: 'failed', estimated: true });
    expect(result.error).toMatchObject({ code: 'pi_failed' });
    expect(result.costDkk).toBeGreaterThan(0);
    expect(store.turns.at(-1)).toMatchObject({ kind: 'brain', outcome: 'failed', inputTokens: 18_000 });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: expect.stringContaining('/conversations/conv_1?') });
  });

  it('deletes the scratch conversation when the wake is cancelled, even with an aborted turn signal', async () => {
    const controller = new AbortController();
    const { gateway, calls, setCleanup } = setup([], {
      context: async () => { controller.abort(); controller.signal.throwIfAborted(); return ''; },
    });
    setCleanup(signal => {
      expect(signal.aborted).toBe(false);
      return new Response(null, { status: 204 });
    });
    const result = await gateway.runBrain({ runId: 'run-3', body: 'WAKE' }, controller.signal);
    expect(result).toMatchObject({ ok: false, outcome: 'cancelled', costDkk: 0 });
    expect(calls.map(call => call.method)).toEqual(['POST', 'DELETE']);
  });

  it.each(['request_failed', 'timeout'])('keeps a successful wake successful when scratch cleanup reports %s', async (reason) => {
    vi.useFakeTimers();
    try {
      const logs: Array<[string, Record<string, unknown>]> = [];
      const { gateway, setCleanup, registry } = setup([() => sse(delta('Done.'), completed(1, 0, 1))], {
        log: (event, fields) => logs.push([event, fields]),
      });
      const cleanup = vi.fn((signal: AbortSignal): Response | Promise<Response> => {
        expect(signal.aborted).toBe(false);
        return reason === 'timeout' ? new Promise(() => {}) : new Response(null, { status: 503 });
      });
      setCleanup(cleanup);
      const run = gateway.runBrain({ runId: 'run-4', body: 'WAKE' }, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(registry.size).toBe(0);
      if (reason === 'timeout') {
        await vi.advanceTimersByTimeAsync(4_999);
        expect(cleanup.mock.calls[0]![0].aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(cleanup.mock.calls[0]![0].aborted).toBe(true);
      }
      await expect(run).resolves.toMatchObject({ ok: true, outcome: 'ok', text: 'Done.' });
      expect(logs).toContainEqual(['pi.conversation_cleanup_failed', { kind: 'brain', reason }]);
    } finally { vi.useRealTimers(); }
  });

  it.each([true, false])('cleans up both core smoke conversations even when a reply fails (success=%s)', async (ok) => {
    const reply = () => sse(delta('Ready.'), completed(4, 0, 1));
    const { gateway, calls } = setup(ok ? Array.from({ length: 5 }, () => reply) : [() => new Response(null, { status: 400 })]);
    const smoke = runPiSmoke(gateway, new AbortController().signal, { part: 'core', warmTurns: 0 });
    if (ok) await expect(smoke).resolves.toMatchObject({ part: 'core' });
    else await expect(smoke).rejects.toBeInstanceOf(PiGatewayError);
    expect(calls.filter(call => call.method === 'DELETE').map(call => new URL(call.url).pathname.split('/').at(-1))).toEqual(['conv_2', 'conv_1']);
  });

  it('stops before sending anything once the monthly cap is reached', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { run, calls, store } = setup([], {
      onRuntimeTurn: (entry) => evidence.push({ ...entry }),
    });
    await store.recordTurn({ kind: 'chat', messageId: null, model: 'm', inputTokens: 0, cachedTokens: 0, outputTokens: 0, costDkk: 1.5, firstTextMs: 1, totalMs: 1, outcome: 'ok' }, new AbortController().signal);
    await expect(run('hi')).rejects.toMatchObject({
      code: 'pi_budget_exhausted', kind: 'allowance_used', userMessage: failureCopy.allowance_used.chat, detail: 'spent_1.50_of_1_dkk',
    });
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

  describe('a brain wake opens like a new chat conversation', () => {
    const overview = { signature: 'GitHub=idle;Azure=not_configured', text: 'TOOL OVERVIEW' };
    const containerApp = '/subscriptions/11111111-2222-4333-8444-555555555555/resourceGroups/rg-jarvis/providers/Microsoft.App/containerApps/ca-jarvis-backend-abc123';
    const turnTexts = (calls: Call[]) => calls
      .filter(call => call.url.includes('/responses'))
      .map(call => (call.body!.input as Array<{ content: string }>)[0]!.content);
    const reply = () => sse(delta('x'), completed(1, 0, 1));

    it('carries the tool overview in every wake, even after chat was sent it, and never makes chat repeat it', async () => {
      const { gateway, calls } = setup([reply, reply, reply, reply]);
      gateway.setCapabilityNote?.(() => overview);
      const signal = new AbortController().signal;
      const lastTurn = () => turnTexts(calls).at(-1)!;
      await gateway.runBrain({ runId: 'run-1', body: 'WAKE' }, signal);
      expect(lastTurn()).toContain(overview.text);
      // The wake is a conversation of its own: it did not use up the overview of Dan's conversation.
      for await (const chunk of gateway.stream({ messageId: '42', sessionId: '7', text: 'first' }, '', signal)) void chunk;
      expect(lastTurn()).toContain(overview.text);
      await gateway.runBrain({ runId: 'run-2', body: 'WAKE' }, signal);
      expect(lastTurn()).toContain(overview.text);
      for await (const chunk of gateway.stream({ messageId: '43', sessionId: '7', text: 'second' }, '', signal)) void chunk;
      expect(lastTurn()).not.toContain(overview.text);
    });

    it('shares the trusted context, environment, compact situation and tool overview with the first chat turn', async () => {
      const environment = buildPiEnvironment({ BACKEND_CONTAINER_APP_RESOURCE_ID: containerApp });
      const context = buildPiContext(defaultSettings, defaultAwayModeState, environment);
      const { gateway, calls, run, setSituation } = setup([reply, reply], { context: async () => context });
      const situation = '[Current PI situational state from Jarvis.]\n{"revision":2,"freshSources":["calendar"]}';
      setSituation(situation);
      gateway.setCapabilityNote?.(() => overview);
      await run('CHAT MESSAGE');
      await gateway.runBrain({ runId: 'run-1', body: 'WAKE MESSAGE' }, new AbortController().signal);
      const [chat, wake] = turnTexts(calls);
      for (const text of [chat, wake]) {
        for (const block of [context, environment, situation, overview.text]) expect(text).toContain(block);
      }
      // Structure, not wording: apart from the turn reference and the message itself, both turns are the same blocks in the same order.
      const shape = (text: string | undefined, message: string) => text?.replace(/jt-[A-Za-z0-9_-]{22}/u, '[turn]').replace(message, '[message]');
      expect(shape(wake, 'WAKE MESSAGE')).toBe(shape(chat, 'CHAT MESSAGE'));
    });
  });

  it('reports honest errors for a missing agent, rate limiting and a broken stream, with no fallback', async () => {
    const missing = setup([() => new Response('{}', { status: 404 })]);
    await expect(missing.run('hi')).rejects.toMatchObject({
      code: 'pi_unavailable', kind: 'agent_missing', detail: 'http_404', userMessage: failureCopy.agent_missing.chat,
    });
    const limited = setup([() => new Response('{}', { status: 429, headers: { 'retry-after': '360' } })]);
    await expect(limited.run('hi')).rejects.toMatchObject({
      code: 'pi_unavailable', kind: 'service_busy', detail: 'http_429', userMessage: failureCopy.service_busy.chat,
    });
    const failed = setup([() => sse(delta('half'), frame({ type: 'response.failed', response: {} }))]);
    await expect(failed.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
    // The provider's own short error code is kept for the log and the smoke; its message never is.
    const coded = setup([() => sse(frame({ type: 'response.failed', response: { error: { code: 'tool_user_error', message: 'Bearer secret leaked here' } } }))]);
    await expect(coded.run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'tool_user_error' });
    const odd = setup([() => sse(frame({ type: 'response.failed', response: { error: { code: 'not a code with spaces' } } }))]);
    await expect(odd.run('hi')).rejects.toMatchObject({ detail: 'response.failed' });
    // The model had started, so the turn is charged at an estimate and counts toward the cap.
    expect(failed.store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 18_000, outputTokens: 2, costDkk: 0.120667 });
    const refused = setup(Array.from({ length: 3 }, () => () => new Response('{}', { status: 429 })));
    await expect(refused.run('hi')).rejects.toMatchObject({ code: 'pi_unavailable' });
    expect(refused.store.turns[0]).toMatchObject({ outcome: 'failed', costDkk: 0 });
    const unfinished = setup([() => sse(delta('half'))]);
    await expect(unfinished.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
    // An approval request without an id cannot be answered, so once it is complete it still fails the turn, in plain words.
    const approval = setup([() => sse(frame({ type: 'response.output_item.added', item: { type: 'mcp_approval_request', status: 'completed' } }), completed(1, 0, 1))]);
    await expect(approval.run('hi')).rejects.toMatchObject({
      code: 'pi_failed', detail: 'client_call_without_id', userMessage: failureCopy.cut_off.chat,
    });
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

  it('times out with its own message when the model takes too long, and says nothing was done when no tool was reached', async () => {
    const stalled = () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'text/event-stream' } });
    const { run } = setup([stalled], { turnTimeoutMs: 30 });
    await expect(run('slow')).rejects.toMatchObject({
      code: 'pi_timeout', kind: 'took_too_long_clean', detail: 'turn_deadline', userMessage: failureCopy.took_too_long_clean.chat,
    });
    // A tool call in flight, or one the server already saw, means something may have happened.
    const afterTool = setup([() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(tool)); },
    }), { headers: { 'content-type': 'text/event-stream' } })], { turnTimeoutMs: 30 });
    await expect(afterTool.run('slow')).rejects.toMatchObject({ code: 'pi_timeout', kind: 'took_too_long', userMessage: failureCopy.took_too_long.chat });
  });

  it('forgets a conversation Foundry no longer knows, so the next message starts a new one', async () => {
    const { run, conversations } = setup([() => new Response('{}', { status: 404 }), () => sse(delta('Hello'), completed(1, 0, 1))]);
    await expect(run('hi')).rejects.toMatchObject({ code: 'pi_unavailable', detail: 'http_404' });
    expect(await run('again')).toEqual(['Hello']);
    expect(conversations()).toBe(2);
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

  it('sends the persona and the situational state once, whether a warm-up or a turn comes first', async () => {
    const inputs = (calls: Call[]) => calls.filter(call => call.url.includes('/responses')).map(call => (call.body!.input as Array<{ content: string }>)[0]!.content);
    const count = (text: string, part: string) => text.split(part).length - 1;
    const warmFirst = setup([() => sse(delta('ready'), completed(11_000, 0, 2)), () => sse(delta('Hi'), completed(11_100, 11_000, 3))]);
    warmFirst.setSituation('SITUATION BLOCK');
    await warmFirst.gateway.warm(new AbortController().signal);
    await warmFirst.run('hi');
    const [warmInput, turnInput] = inputs(warmFirst.calls);
    expect(warmInput).toContain('CONTEXT BLOCK\n\nSITUATION BLOCK');
    expect([count(turnInput!, 'CONTEXT BLOCK'), count(turnInput!, 'SITUATION BLOCK')]).toEqual([0, 0]);

    const turnFirst = setup([() => sse(delta('Hi'), completed(11_000, 0, 3)), () => sse(delta('ready'), completed(11_000, 9_000, 2))]);
    turnFirst.setSituation('SITUATION BLOCK');
    await turnFirst.run('hi');
    expect(await turnFirst.gateway.warm(new AbortController().signal)).toMatchObject({ state: 'warm', alreadyWarm: true });
    expect(inputs(turnFirst.calls)).toHaveLength(1);

    // A changed situation is new context for the next turn, and for a warm-up before it.
    turnFirst.setSituation('NEWER SITUATION');
    expect(await turnFirst.gateway.warm(new AbortController().signal)).toMatchObject({ alreadyWarm: false });
    expect(inputs(turnFirst.calls)[1]).toContain('NEWER SITUATION');
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

  it('times out in the queue without sending that turn or taking the slot from the turn after it', async () => {
    const evidence: Array<Record<string, unknown>> = [];
    const { gateway, calls, run, store } = setup([
      () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(delta('first'))); },
      }), { headers: { 'content-type': 'text/event-stream' } }),
      () => sse(delta('third'), completed(1, 0, 1)),
    ], { onRuntimeTurn: (entry) => evidence.push({ ...entry }) });
    const active = new AbortController();
    const first = gateway.stream(
      { messageId: '42', sessionId: '7', text: 'first', channel: 'voice' }, '', active.signal,
    );
    expect((await first.next()).value).toBe('first');
    const queued = new AbortController();
    const second = run('second', queued.signal);
    const third = run('third');
    queued.abort(new DOMException('test deadline', 'TimeoutError'));
    await expect(second).rejects.toMatchObject({ code: 'pi_timeout', userMessage: failureCopy.took_too_long_clean.chat });
    expect(calls.filter(call => call.url.includes('/responses'))).toHaveLength(1);
    expect(evidence).toContainEqual(expect.objectContaining({
      channel: 'chat', outcome: 'timeout', source: 'turn', reason: 'conversation_wait_timeout',
    }));
    const finishing = first.next();
    active.abort();
    await expect(finishing).rejects.toMatchObject({ name: 'AbortError' });
    await expect(third).resolves.toEqual(['third']);
    expect(store.turns.map(turn => turn.outcome)).toEqual(['cancelled', 'ok']);
  });

  it('logs and hands off when stopped before Foundry returned a response ID', async () => {
    const dispatched = Promise.withResolvers<void>();
    const logs: Array<[string, Record<string, unknown>]> = [];
    const { calls, run, registry } = setup([
      () => { dispatched.resolve(); return new Promise<Response>(() => {}); },
      () => sse(delta('second'), completed(1, 0, 1)),
    ], { log: (event, fields) => logs.push([event, fields]) });
    const active = new AbortController();
    const first = run('first', active.signal);
    await dispatched.promise;
    const second = run('second');
    active.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toEqual(['second']);
    expect(calls.filter(call => call.url.includes('/cancel'))).toEqual([]);
    expect(logs).toContainEqual(['pi.stream_failed', expect.objectContaining({ reason: 'cancel_no_response_id', attempt: 1 })]);
    expect(registry.size).toBe(0);
  });

  it.each(['reading', 'between chunks'] as const)('cancels once before handoff when stopped while %s', async (state) => {
    const { gateway, calls, registry, run, setCancel } = setup([
      () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(frame({ type: 'response.created', response: { id: 'resp_first' } }) + delta('first')));
        },
        cancel: () => new Promise(() => {}), // A stream adapter that never finishes closing.
      }), { headers: { 'content-type': 'text/event-stream' } }),
      () => sse(delta('second'), completed(1, 0, 1)),
    ]);
    const cancelStarted = Promise.withResolvers<void>();
    const cancelResponse = Promise.withResolvers<Response>();
    setCancel(() => { cancelStarted.resolve(); return cancelResponse.promise; });
    const active = new AbortController();
    const first = gateway.stream({ messageId: '42', sessionId: '7', text: 'first', channel: 'voice' }, '', active.signal)[Symbol.asyncIterator]();
    expect((await first.next()).value).toBe('first');
    const pendingRead = state === 'reading' ? expect(first.next()).rejects.toMatchObject({ name: 'AbortError' }) : null;
    active.abort();
    const closed = state === 'between chunks' ? first.return?.() : null;
    const second = run('second');
    await cancelStarted.promise;
    expect(calls.filter(call => call.url.includes('/responses')).map(call => new URL(call.url).pathname.split('/openai')[1])).toEqual([
      '/responses', '/responses/resp_first/cancel',
    ]);
    cancelResponse.resolve(Response.json({ status: 'cancelled' }));
    if (pendingRead) await pendingRead;
    else await expect(closed).resolves.toMatchObject({ done: true });
    await expect(second).resolves.toEqual(['second']);
    expect(calls.filter(call => call.url.includes('/cancel'))).toHaveLength(1);
    expect(registry.size).toBe(0);
  });

  it.each([
    [false, failureCopy.took_too_long_clean.voice],
    [true, failureCopy.took_too_long.voice],
  ] as const)('speaks once at the voice deadline before cancelling and handing off (tool seen: %s)', async (toolSeen, copy) => {
    const started = Promise.withResolvers<void>();
    const logs: Array<[string, Record<string, unknown>]> = [];
    const { gateway, calls, registry, run, setCancel, store } = setup([
      () => new Response(new ReadableStream({
        start(controller) {
          const created = frame({ type: 'response.created', response: { id: 'resp_timeout' } });
          controller.enqueue(new TextEncoder().encode(created + (toolSeen ? tool : '') + delta('Unfinished')));
        },
        pull() { started.resolve(); },
      }, { highWaterMark: 0 }), { headers: { 'content-type': 'text/event-stream' } }),
      () => sse(delta('Chat answer'), completed(1, 0, 1)),
    ], { log: (event, fields) => logs.push([event, fields]) });
    const spoken: string[] = [];
    const order: string[] = [];
    const cancelStarted = Promise.withResolvers<void>();
    const cancelResponse = Promise.withResolvers<Response>();
    setCancel(() => { order.push('cancel'); cancelStarted.resolve(); return cancelResponse.promise; });
    const finished = Promise.withResolvers<string>();
    const voice = createPiVoiceTurns({
      agent: gateway, signal: new AbortController().signal,
      speak: text => { order.push('spoke'); spoken.push(text); }, busy: () => {},
      log: turn => finished.resolve(turn.outcome),
    });
    const voiceDeadline = new AbortController();
    const cancelDeadline = new AbortController();
    const realTimeout = AbortSignal.timeout;
    const clock = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      if (ms === PI_VOICE_TURN_DEADLINE_MS) return voiceDeadline.signal;
      if (ms === 5_000) return cancelDeadline.signal;
      return realTimeout(ms);
    });
    try {
      voice.start({ messageId: '42', sessionId: '7', text: 'voice', startedAt: performance.now() });
      // With a zero high-water mark, pull waits for the next read after the initial frames are processed.
      await started.promise;
      const chat = run('chat');
      voiceDeadline.abort(new DOMException('test deadline', 'TimeoutError'));
      await cancelStarted.promise;
      expect(order).toEqual(['spoke', 'cancel']);
      expect(spoken).toEqual([copy]);
      expect(calls.filter(call => call.url.includes('/responses?'))).toHaveLength(1);
      // Exercise both a responding and a stalled cancel request without waiting on wall time.
      if (toolSeen) cancelDeadline.abort(new DOMException('cancel bound', 'TimeoutError'));
      else cancelResponse.resolve(Response.json({ status: 'cancelled' }));
      await expect(finished.promise).resolves.toBe('timeout');
      await expect(chat).resolves.toEqual(['Chat answer']);
      expect(spoken).toEqual([copy]);
      expect(calls.filter(call => call.url.includes('/responses/resp_timeout/cancel'))).toHaveLength(1);
      expect(logs.some(([event, fields]) => event === 'pi.stream_failed' && fields.reason === 'cancel_request_failed')).toBe(toolSeen);
      expect(store.turns.map(turn => turn.outcome)).toEqual(['timeout', 'ok']);
      expect(registry.size).toBe(0);
    } finally {
      cancelResponse.resolve(Response.json({ status: 'cancelled' }));
      clock.mockRestore();
    }
  });

  it('attributes every turn in the ledger by kind, so a call that repeats on a schedule can be recognised', async () => {
    const { gateway, store } = setup([]);
    const base = { messageId: null, model: 'm', inputTokens: 4_000, cachedTokens: 0, outputTokens: 5, firstTextMs: 900, totalMs: 1_500, outcome: 'ok' as const };
    // The setup clock reads 2026-11-15T16:00:00Z, so the first warm-up is outside the 24 hours.
    store.turns.push(
      { ...base, kind: 'warm', costDkk: 0.03, at: new Date('2026-11-14T14:00:00Z') },
      { ...base, kind: 'warm', costDkk: 0.03, at: new Date('2026-11-15T13:00:00Z') },
      { ...base, kind: 'warm', costDkk: 0.03, at: new Date('2026-11-15T14:00:00Z') },
      { ...base, kind: 'chat', costDkk: 0.05, at: new Date('2026-11-15T14:30:00Z'), messageId: '42', activationType: 'chat', activationSource: 'chat' },
      { ...base, kind: 'brain', costDkk: 0.2, inputTokens: 12_000, outputTokens: 300, at: new Date('2026-11-15T15:00:00Z'), activationType: 'event', activationSource: 'watch' },
    );
    const status = await gateway.status(new AbortController().signal);
    expect(status.turns.last24h).toEqual({
      chat: { turns: 1, costDkk: 0.05 }, warm: { turns: 2, costDkk: 0.06 }, smoke: { turns: 0, costDkk: 0 }, brain: { turns: 1, costDkk: 0.2 },
    });
    expect(status.turns.recent.map(turn => [turn.kind, turn.at])).toEqual([
      ['brain', '2026-11-15T15:00:00.000Z'], ['chat', '2026-11-15T14:30:00.000Z'], ['warm', '2026-11-15T14:00:00.000Z'],
      ['warm', '2026-11-15T13:00:00.000Z'], ['warm', '2026-11-14T14:00:00.000Z'],
    ]);
    expect(status.turns.recent[0]).toEqual({
      at: '2026-11-15T15:00:00.000Z', kind: 'brain', outcome: 'ok', inputTokens: 12_000, cachedTokens: 0, outputTokens: 300, costDkk: 0.2, totalMs: 1_500,
      activation: { type: 'event', source: 'watch' },
    });
    expect(status.turns.recent[2]).not.toHaveProperty('activation');
    // The chat numbers keep their meaning: a Background PI wake is neither the last turn nor part of the chat month.
    expect(status.lastTurn).toMatchObject({ kind: 'chat', at: '2026-11-15T14:30:00.000Z' });
    expect(status.month.turns).toBe(4);
    expect(JSON.stringify(status)).not.toContain('"42"');
  });

  it('keeps the newest twenty turns and nothing when the ledger is empty', async () => {
    const { gateway, store } = setup([]);
    expect((await gateway.status(new AbortController().signal)).turns).toEqual({
      last24h: { chat: { turns: 0, costDkk: 0 }, warm: { turns: 0, costDkk: 0 }, smoke: { turns: 0, costDkk: 0 }, brain: { turns: 0, costDkk: 0 } }, recent: [],
    });
    for (let minute = 0; minute < 25; minute += 1) {
      store.turns.push({ messageId: null, model: 'm', inputTokens: 1, cachedTokens: 0, outputTokens: 1, costDkk: 0.01, firstTextMs: 1, totalMs: 1, outcome: 'ok', kind: 'warm', at: new Date(Date.UTC(2026, 10, 15, 12, minute)) });
    }
    const { recent, last24h } = (await gateway.status(new AbortController().signal)).turns;
    expect(recent).toHaveLength(20);
    expect(recent[0]!.at).toBe('2026-11-15T12:24:00.000Z');
    expect(last24h.warm).toEqual({ turns: 25, costDkk: 0.25 });
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
    expect(store.turns[0]).toMatchObject({ kind: 'warm', outcome: 'failed', inputTokens: 18_000 });
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

    it('waits for HTTP and SSE retry hints, then stops after two retries', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      try {
        const seen: number[] = [];
        const { logs, log } = capture();
        const { run, calls, store } = setup([
          () => {
            seen.push(performance.now());
            return Response.json({ error: { message: 'Token rate limit; Bearer private credential' } },
              { status: 429, headers: { 'retry-after': '1', 'retry-after-ms': '1100' } });
          },
          () => {
            seen.push(performance.now());
            return sse(created, frame({ type: 'response.failed', response: { error: {
              code: 'rate_limit_exceeded', message: 'Requests per minute. Try again in 1.9s. https://private.example',
            } } }));
          },
          () => { seen.push(performance.now()); return new Response(null, { status: 429 }); },
        ], { log, streamRetryDelayMs: 750 });
        const ending = expect(run('hi')).rejects.toMatchObject({ kind: 'service_busy' });
        await vi.advanceTimersByTimeAsync(1099);
        expect(seen).toEqual([0]);
        await vi.advanceTimersByTimeAsync(1);
        expect(seen).toEqual([0, 1100]);
        await vi.advanceTimersByTimeAsync(1899);
        expect(seen).toEqual([0, 1100]);
        await vi.advanceTimersByTimeAsync(1);
        await ending;
        expect(seen).toEqual([0, 1100, 3000]);
        expect(responsesOf(calls).map(call => call.body)).toEqual(Array(3).fill(responsesOf(calls)[0]!.body));
        expect(store.turns).toHaveLength(1);
        expect(logs.filter(([event]) => event === 'pi.stream_failed').map(([, fields]) => fields)).toEqual([
          expect.objectContaining({ reason: 'http_rate_limited', attempt: 1, providerMessage: 'Token rate limit reached.', retryAfterMs: 1100 }),
          expect.objectContaining({ reason: 'foundry_response_failed', attempt: 2, providerMessage: 'Request rate limit reached.', retryAfterMs: 1900 }),
          expect.objectContaining({ reason: 'http_rate_limited', attempt: 3 }),
        ]);
        expect(JSON.stringify(logs)).not.toMatch(/private|Bearer/u);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry when a rate limit wait would cross the voice deadline even though it fits the gateway deadline', async () => {
      const { run, gateway, calls, registry } = setup([
        () => new Response(null, { status: 429, headers: { 'retry-after': '95' } }),
        () => sse(delta('Next turn'), completed(1, 0, 1)),
      ]);
      const input = { text: 'hi', messageId: '42', sessionId: '7', channel: 'voice' as const,
        deadlineAt: performance.now() + PI_VOICE_TURN_DEADLINE_MS };
      const iterator = gateway.stream(input, '', new AbortController().signal);
      await expect(iterator.next()).rejects.toMatchObject({ kind: 'service_busy' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(registry.size).toBe(0);
      expect(await run('another turn')).toEqual(['Next turn']);
    });

    it.each([false, true])('retains uncertainty for an unverified write (another write confirmed: %s)', async confirmed => {
      const { run, calls, registry } = setup([
        call => {
          const grant = registry.resolve(turnOf(call))!;
          grant.requests.count += 1;
          grant.results.push({ tool: 'vault_task_complete', outcome: 'error' });
          grant.actionRuns.push({ asked: 'first', identity: undefined, state: 'unknown', answer: Promise.resolve(undefined) });
          if (confirmed) grant.receipts.push({ confirmation: 'Completed task: Pay rent.', action: true });
          return sse(created, failedFrame('rate_limit_exceeded'));
        },
      ]);
      const receipt = confirmed ? `Completed task: Pay rent. ${failureCopy.cut_off.chat} ${failureCopy.reply_not_written.chat}` : undefined;
      await expect(run('hi')).rejects.toMatchObject({
        userMessage: failureCopy.cut_off.chat, spokenMessage: receipt ?? failureCopy.cut_off.voice, receipt,
      });
      expect(responsesOf(calls)).toHaveLength(1);
    });

    it.each([
      ['response.failed', () => sse(created, listed, failedFrame()), 'foundry_response_failed', false],
      ['error', () => sse(frame({ type: 'error', code: 'server_error', message: 'private provider text' })), 'foundry_response_failed', false],
      ['a transient rate limit', () => sse(created, failedFrame('rate_limit_exceeded')), 'foundry_response_failed', false],
      ['a stream that ends before its first event', () => sse(), 'stream_ended_without_completed', false],
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
      ['an unparseable frame', () => sse(created, 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"mcp_c\n\n', failedFrame())],
      ['a non-object frame', () => sse(created, 'data: 42\n\n', failedFrame())],
      ['a half-received frame when the stream ends', () => sse(created, 'event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"mcp_c')],
      ['a half-received frame when the stream breaks', () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`${created}event: response.output_item.added\ndata: {"type":"response.output_item.adde`));
          setTimeout(() => controller.error(new Error('connection reset')), 5);
        },
      }), { headers: { 'content-type': 'text/event-stream' } })],
    ])('never retries after %s', async (_name, first) => {
      const { logs, log } = capture();
      const { run, calls, store } = setup([first, () => sse(delta('again'), completed(1, 0, 1))], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_retry');
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ sawOutput: true });
      expect(calls.filter(call => call.url.includes('/cancel'))).toHaveLength(0);
      expect(store.turns).toHaveLength(1);
    });

    it.each([
      ['a request that entered the MCP server and had not returned', (grant: PiTurnGrant) => { grant.requests.count += 1; }],
      ['a recorded tool result', (grant: PiTurnGrant) => { grant.results.push({ tool: 'probe', outcome: 'ok' }); }],
      ['a recorded action', (grant: PiTurnGrant) => { grant.actions.count += 1; }],
    ])('never retries after %s, even though the stream carried nothing', async (_name, mark) => {
      const { registry, run, calls, store } = setup([
        (call) => { mark(registry.resolve(turnOf(call))!); return sse(created); },
        () => sse(delta('again'), completed(1, 0, 1)),
      ]);
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(store.turns).toHaveLength(1);
    });

    it('never retries when a tool request arrives while it waits to retry', async () => {
      const { registry, run, calls } = setup([
        (call) => { setTimeout(() => { registry.resolve(turnOf(call))!.requests.count += 1; }, 10); return sse(failedFrame()); },
        () => sse(delta('again'), completed(1, 0, 1)),
      ], { streamRetryDelayMs: 60 });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
    });

    it.each([
      ['a failed cancel', () => new Response('{}', { status: 500 })],
      ['a cancel that leaves the response running', () => Response.json({ status: 'in_progress' })],
    ])('never retries a stream that merely stopped after %s', async (_name, cancel) => {
      const { run, calls, setCancel } = setup([() => sse(created), () => sse(delta('again'), completed(1, 0, 1))]);
      setCancel(cancel);
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(calls.filter(call => call.url.includes('/responses/resp_1/cancel'))).toHaveLength(1);
    });

    it('never retries events whose response is unknown, because they cannot be cancelled', async () => {
      const { run, calls } = setup([() => sse(frame({ type: 'response.in_progress', response: {} })), () => sse(delta('again'), completed(1, 0, 1))]);
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
    });

    it.each([
      ['response.incomplete', () => sse(created, frame({ type: 'response.incomplete', response: { status: 'incomplete', error: { code: 'server_error' } } }))],
      ['a content filter', () => sse(created, failedFrame('content_filter'))],
      ['a tool error', () => sse(created, failedFrame('tool_user_error'))],
      ['an unknown code', () => sse(created, failedFrame('something_new'))],
      ['no code', () => sse(created, frame({ type: 'response.failed', response: {} }))],
    ])('never retries %s', async (_name, first) => {
      const { run, calls } = setup([first, () => sse(delta('again'), completed(1, 0, 1))]);
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
    });

    it('never retries a call without a turn grant, such as a warm-up or the smoke', async () => {
      const { gateway, calls } = setup([() => sse(failedFrame()), () => sse(delta('again'), completed(1, 0, 1))]);
      await expect(gateway.warm(new AbortController().signal)).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      const smoke = setup([() => sse(failedFrame()), () => sse(delta('again'), completed(1, 0, 1))]);
      await expect((async () => { for await (const event of smoke.gateway.smokeKit.respond('conv_1', 'x', new AbortController().signal)) void event; })())
        .rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(smoke.calls)).toHaveLength(1);
    });

    it('never retries a brain wake that reached a tool', async () => {
      const { gateway, registry, calls } = setup([
        (call) => { registry.resolve(turnOf(call))!.requests.count += 1; return sse(created); },
        () => sse(delta('again'), completed(1, 0, 1)),
      ]);
      const result = await gateway.runBrain({ runId: 'run-9', body: 'WAKE' }, new AbortController().signal);
      expect(result).toMatchObject({ ok: false });
      expect(responsesOf(calls)).toHaveLength(1);
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

    it.each([
      ['an mcp_approval_request without an id', { type: 'mcp_approval_request', server_label: 'jarvis', name: 'read_file', arguments: '{"path":"secret"}', status: 'completed' },
        { itemType: 'mcp_approval_request', name: 'read_file', serverLabel: 'jarvis', hasCallId: false, hasId: false, argumentsLength: 17, itemStatus: 'completed' }],
      ['a function_call without a call_id', { type: 'function_call', id: 'fc_secret', name: 'shell', arguments: '{}', status: 'completed' },
        { itemType: 'function_call', name: 'shell', hasCallId: false, hasId: true, argumentsLength: 2, itemStatus: 'completed' }],
    ])('logs only the safe shape of %s and fails because it cannot be answered', async (_name, item, expected) => {
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created, frame({ type: 'response.output_item.added', item }), completed(1, 0, 1))], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      const harness = logs.filter(([event]) => event === 'pi.harness_item');
      expect(harness).toHaveLength(1);
      expect(harness[0]![1]).toEqual({
        trigger: 'rejected_item', attempt: 1, ...expected,
        eventTypes: ['response.created', 'response.output_item.added', 'response.completed'],
        itemTypes: [expected.itemType], elapsedMs: expect.any(Number), firstEventMs: expect.any(Number),
        sawText: false, sawTool: true, sawOutput: true, previousCancelled: false,
      });
      expect(JSON.stringify(logs)).not.toMatch(/secret|example\.com/u);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'approval_or_function_call_item' });
    });

    it('logs an unknown item type once per type, safely, and keeps the stream going', async () => {
      const { logs, log } = capture();
      const unknown = frame({
        type: 'response.output_item.added',
        item: { type: 'filesystem_read', name: 'https://example.com/x y', status: 'searching', id: 'secret_id', arguments: { path: 'secret' }, output: 'secret text' },
      });
      const odd = frame({ type: 'response.output_item.added', item: { type: 'Not A Token', call_id: 'secret_call' } });
      const { run } = setup([() => sse(created, unknown, unknown, odd, delta('ok'), completed(1, 0, 1))], { log });
      await run('hi');
      expect(logs.filter(([event]) => event === 'pi.harness_item')).toEqual([
        ['pi.harness_item', {
          trigger: 'unknown_item', attempt: 1, itemType: 'filesystem_read', name: 'other', itemStatus: 'searching', hasCallId: false, hasId: true, argumentsLength: 17,
          eventTypes: ['response.created', 'response.output_item.added'], itemTypes: ['filesystem_read'],
          elapsedMs: expect.any(Number), firstEventMs: expect.any(Number), sawText: false, sawTool: false, sawOutput: true, previousCancelled: false,
        }],
        ['pi.harness_item', expect.objectContaining({ trigger: 'unknown_item', itemType: 'other', hasCallId: true, itemTypes: ['filesystem_read', 'other'] })],
      ]);
      expect(JSON.stringify(logs)).not.toMatch(/secret|example\.com/u);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_failed');
    });

    it('caps unknown item events per stream and counts every non-token type once as other', async () => {
      const added = (type: string) => frame({ type: 'response.output_item.added', item: { type } });
      const many = capture();
      const flood = setup([() => sse(created, ...Array.from({ length: 500 }, (_, index) => added(`t_${index}`)), delta('ok'), completed(1, 0, 1))], { log: many.log });
      await flood.run('hi');
      expect(many.logs.filter(([event]) => event === 'pi.harness_item')).toHaveLength(5);
      const odd = capture();
      const oddRun = setup([() => sse(created, added('Not A Token'), added('another one!'), added('UPPER'), delta('ok'), completed(1, 0, 1))], { log: odd.log });
      await oddRun.run('hi');
      expect(odd.logs.filter(([event]) => event === 'pi.harness_item').map(([, fields]) => fields.itemType)).toEqual(['other']);
    });

    it.each([
      ['a very long name', { type: 'function_call', status: 'completed', name: 'n'.repeat(1_000_000), arguments: 'a'.repeat(1_000_000) }, { name: 'other', argumentsLength: 1_000_000 }],
      ['object arguments', { type: 'function_call', status: 'completed', arguments: { q: 'secret' } }, { argumentsLength: 14 }],
      ['array arguments', { type: 'mcp_approval_request', status: 'completed', arguments: ['secret'] }, { argumentsLength: 10 }],
      ['a non-string type value', { type: 'function_call', status: 'completed', name: 42, server_label: [] }, {}],
    ])('still fails the same way with %s and logs no content', async (_name, item, expected) => {
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created, frame({ type: 'response.output_item.added', item }), completed(1, 0, 1))], { log });
      await expect(run('hi')).rejects.toMatchObject({
        code: 'pi_failed', detail: 'client_call_without_id', userMessage: failureCopy.cut_off.chat,
      });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.filter(([event]) => event === 'pi.harness_item')).toEqual([['pi.harness_item', expect.objectContaining(expected)]]);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'approval_or_function_call_item', sawTool: true, sawOutput: true });
      expect(JSON.stringify(logs).length).toBeLessThan(2_000);
    });

    it.each([['null', null], ['a string', 'function_call'], ['a number', 7], ['an array', ['function_call']]])(
      'ignores a malformed item that is %s without failing or logging it', async (_name, item) => {
        const { logs, log } = capture();
        const { run } = setup([() => sse(created, frame({ type: 'response.output_item.added', item }), delta('ok'), completed(1, 0, 1))], { log });
        await run('hi');
        expect(logs.map(([event]) => event)).not.toContain('pi.harness_item');
        expect(logs.map(([event]) => event)).not.toContain('pi.stream_failed');
      });

    it('never retries a function call or approval request, and never an HTTP failure or a missing stream', async () => {
      const { logs, log } = capture();
      const call = setup([() => sse(created, frame({ type: 'response.output_item.added', item: { type: 'function_call', status: 'completed' } }), completed(1, 0, 1)), () => sse(delta('x'), completed(1, 0, 1))], { log });
      await expect(call.run('hi')).rejects.toMatchObject({
        code: 'pi_failed', detail: 'client_call_without_id', userMessage: failureCopy.cut_off.chat,
      });
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

    it('says nothing was done only when Foundry itself ended the turn before any output or tool, and never after something may have run', async () => {
      const clean = setup([() => sse(created, failedFrame('content_filter'))]);
      await expect(clean.run('hi')).rejects.toMatchObject({
        code: 'pi_failed', kind: 'cut_off_clean', detail: 'content_filter', userMessage: failureCopy.cut_off_clean.chat,
      });
      const retriedAndFailedAgain = setup([() => sse(created, failedFrame('server_error')), () => sse(created, failedFrame('server_error'))]);
      await expect(retriedAndFailedAgain.run('hi')).rejects.toMatchObject({ kind: 'cut_off_clean', detail: 'server_error' });
      expect(responsesOf(retriedAndFailedAgain.calls)).toHaveLength(2);
      const afterOutput = setup([() => sse(created, tool, failedFrame('content_filter'))]);
      await expect(afterOutput.run('hi')).rejects.toMatchObject({ kind: 'cut_off', userMessage: failureCopy.cut_off.chat });
      const reached = setup([(call) => { reached.registry.resolve(turnOf(call))!.requests.count += 1; return sse(created, failedFrame('content_filter')); }]);
      await expect(reached.run('hi')).rejects.toMatchObject({ kind: 'cut_off', userMessage: failureCopy.cut_off.chat });
      // A stream that merely stopped may still be running on Foundry's side, so it never claims nothing happened.
      const stopped = setup([() => sse(created), () => sse(created)]);
      await expect(stopped.run('hi')).rejects.toMatchObject({ kind: 'cut_off', detail: 'stream_ended_without_completed' });
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
      expect(logs.filter(([event]) => event === 'pi.stream_failed').map(([, fields]) => [fields.reason, fields.previousCancelled])).toEqual([
        ['cancel_no_response_id', false], ['stream_ended_without_completed', true], ['stream_ended_without_completed', true],
      ]);
    });
  });

  describe('harness calls: native ones finish on their own, client-owned ones are answered', () => {
    const created = (id: string) => frame({ type: 'response.created', response: { id } });
    const callItem = (name: string, callId: string, args: string, status: string) => ({ type: 'function_call', id: `fc_${callId}`, call_id: callId, name, arguments: args, status });
    /** A call as the harness streams it: an in_progress item with empty arguments, the arguments, then the finished item. */
    const functionCall = (name: string, callId: string, args: string) => [
      frame({ type: 'response.output_item.added', item: callItem(name, callId, '', 'in_progress') }),
      frame({ type: 'response.function_call_arguments.delta', item_id: `fc_${callId}`, delta: args.slice(0, 5) }),
      frame({ type: 'response.function_call_arguments.done', item_id: `fc_${callId}`, arguments: args }),
      frame({ type: 'response.output_item.done', item: callItem(name, callId, args, 'completed') }),
    ];
    const result = (callId: string) => [
      frame({ type: 'response.output_item.added', item: { type: 'function_call_output', call_id: callId, output: 'private child result' } }),
      frame({ type: 'response.output_item.done', item: { type: 'function_call_output', call_id: callId, output: 'private child result' } }),
    ];
    const message = (text: string) => [
      frame({ type: 'response.output_item.added', item: { type: 'message', id: 'msg_1' } }),
      delta(text),
      frame({ type: 'response.output_item.done', item: { type: 'message', id: 'msg_1' } }),
    ];
    const approval = (id: string, args = '{"path":"/x"}') => [
      frame({ type: 'response.output_item.added', item: { type: 'mcp_approval_request', id, server_label: 'jarvis', name: 'read_file', arguments: '' } }),
      frame({ type: 'response.output_item.done', item: { type: 'mcp_approval_request', id, server_label: 'jarvis', name: 'read_file', arguments: args } }),
    ];
    const unavailable = (name: string) =>
      `The ${name} tool is not available in this environment. Continue without it and use the Jarvis tools through find_tools and call_tool.`;
    const stalled = (...frames: string[]) => () => new Response(new ReadableStream({ start(controller) { for (const text of frames) controller.enqueue(new TextEncoder().encode(text)); } }), { headers: { 'content-type': 'text/event-stream' } });
    const responsesOf = (calls: Call[]) => calls.filter(call => call.url.includes('/responses') && !call.url.includes('/cancel'));
    const capture = () => {
      const logs: Array<[string, Record<string, unknown>]> = [];
      return { logs, log: (event: string, fields: Record<string, unknown>) => { logs.push([event, fields]); } };
    };
    const harnessCalls = (logs: Array<[string, Record<string, unknown>]>) => logs.filter(([event, fields]) => event === 'pi.harness_item' && fields.trigger === 'harness_call').map(([, fields]) => fields);
    const turnLog = (logs: Array<[string, Record<string, unknown>]>) => logs.find(([event]) => event === 'pi.turn')![1];

    describe.each([
      ['a result for its call_id follows it', () => [...functionCall('task', 'call_secret', '{"name":"cal","description":"d","prompt":"private ask","agent_type":"general"}'), ...result('call_secret'), ...message('Nothing today.')], 'result_item'],
      ['text follows it', () => [...functionCall('task', 'call_secret', '{"prompt":"private ask"}'), ...message('Nothing today.')], 'later_output'],
      ['it streams as an in_progress item whose arguments arrive in deltas, and output follows', () => [
        frame({ type: 'response.output_item.added', item: callItem('task', 'call_secret', '', 'in_progress') }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_call_secret', delta: '{"prompt":' }),
        frame({ type: 'response.function_call_arguments.delta', item_id: 'fc_call_secret', delta: '"private ask"}' }),
        ...message('Nothing today.'),
      ], 'later_output'],
      ['it carries its own output', () => [
        frame({ type: 'response.output_item.done', item: { ...callItem('task', 'call_secret', '{"prompt":"private ask"}', 'completed'), output: 'private child result' } }),
        ...message('Nothing today.'),
      ], 'own_output'],
    ])('a native task whose %s', (_name, native, rule) => {
      it('lets the harness finish: the turn succeeds, the text arrives once, nothing is sent back and nothing is called unavailable', async () => {
        const { logs, log } = capture();
        const { run, calls, store, usage } = setup([
          () => sse(created('resp_1'), ...message('Let me ask a sub-agent. '), ...native(), completed(10_000, 2_000, 50)),
          () => sse(created('resp_2'), delta('never asked'), completed(1, 0, 1)),
        ], { log });
        const chunks = await run('use a sub-agent to check my calendar');
        expect(chunks.filter(chunk => typeof chunk === 'string')).toEqual(['Let me ask a sub-agent. ', 'Nothing today.']);
        expect(responsesOf(calls)).toHaveLength(1);
        expect(JSON.stringify(calls.map(call => call.body))).not.toContain('not available');
        expect(store.turns).toHaveLength(1);
        expect(store.turns[0]).toMatchObject({ outcome: 'ok', inputTokens: 10_000, outputTokens: 50 });
        expect(usage).toHaveLength(1);
        expect(harnessCalls(logs)).toEqual([expect.objectContaining({
          classification: 'native', rule, round: 1, name: 'task', itemType: 'function_call', hasCallId: true, hasId: true, argumentKeys: expect.any(Array),
        })]);
        expect(JSON.stringify(logs)).not.toMatch(/private|secret|answered_/u);
        expect(turnLog(logs)).toMatchObject({ outcome: 'ok', rounds: 1, clientItems: 0, nativeCalls: 1 });
        expect(logs.map(([event]) => event)).not.toContain('pi.stream_failed');
      });
    });

    it('reads the argument key names of a native task from the finished item, never the values', async () => {
      const { logs, log } = capture();
      const args = '{"name":"cal","description":"d","prompt":"private ask","agent_type":"general","mode":"sync"}';
      const { run } = setup([() => sse(created('resp_1'), ...functionCall('task', 'call_1', args), ...message('Done.'), completed(1, 0, 1))], { log });
      await run('hi');
      expect(harnessCalls(logs)[0]).toMatchObject({ argumentKeys: ['name', 'description', 'prompt', 'agent_type', 'mode'], argumentsLength: args.length });
    });

    it('takes the completed response own output list as proof that the harness went on', async () => {
      const { logs, log } = capture();
      const finalOutput = [callItem('task', 'call_1', '{}', 'completed'), { type: 'message', content: [] }];
      const { run, calls } = setup([() => sse(created('resp_1'),
        frame({ type: 'response.output_item.added', item: callItem('task', 'call_1', '', 'in_progress') }),
        frame({ type: 'response.completed', response: { status: 'completed', output: finalOutput, usage: { input_tokens: 1, output_tokens: 1 } } }))], { log });
      await run('hi');
      expect(responsesOf(calls)).toHaveLength(1);
      expect(harnessCalls(logs)).toEqual([expect.objectContaining({ classification: 'native', rule: 'final_output' })]);
    });

    it('answers a genuine client-owned function call with exactly one follow-up and bills each round once', async () => {
      const { logs, log } = capture();
      const args = '{"query":"private query","limit":3,"bad key":1}';
      const { run, calls, store, usage, registry } = setup([
        () => sse(created('resp_1'), ...message('Let me check. '), ...functionCall('lookup', 'call_secret_1', args), completed(10_000, 2_000, 50)),
        () => sse(created('resp_2'), ...message('Nothing today.'), completed(11_000, 10_000, 30)),
      ], { log });
      expect(await run('hi')).toEqual(['Let me check. ', { type: 'acknowledgment', text: 'Let me check. ' }, 'Nothing today.']);
      const responses = responsesOf(calls);
      expect(responses).toHaveLength(2);
      expect(responses[1]!.url).toBe(responses[0]!.url);
      expect(responses[1]!.body).toEqual({
        conversation: 'conv_1', stream: true,
        input: [{ type: 'function_call_output', call_id: 'call_secret_1', output: unavailable('lookup') }],
      });
      expect(store.turns).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'ok', inputTokens: 21_000, cachedTokens: 12_000, outputTokens: 80 });
      expect(usage).toEqual([expect.objectContaining({ inputTokens: 21_000, outputTokens: 80 })]);
      expect(registry.size).toBe(0);
      expect(harnessCalls(logs)).toEqual([{
        trigger: 'harness_call', attempt: 1, round: 1, classification: 'client_owned', rule: 'last_item_unanswered', outcome: 'answered_default',
        argumentKeys: ['query', 'limit'], itemType: 'function_call', name: 'lookup', itemStatus: 'completed', hasCallId: true, hasId: true, argumentsLength: args.length,
        eventTypes: expect.arrayContaining(['response.output_item.added', 'response.function_call_arguments.done']), itemTypes: expect.arrayContaining(['function_call']),
        elapsedMs: expect.any(Number), firstEventMs: expect.any(Number), sawText: true, sawTool: true, sawOutput: true, previousCancelled: false,
      }]);
      expect(turnLog(logs)).toMatchObject({ outcome: 'ok', rounds: 2, clientItems: 1, nativeCalls: 0, inputTokens: 21_000 });
      expect(JSON.stringify(logs)).not.toMatch(/private|secret|bad key/u);
    });

    it('answers a task call that no one ran with the honest default and logs it distinctly', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...functionCall('task', 'call_1', '{"prompt":"p"}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Done'), completed(1, 0, 1)),
      ], { log });
      await run('hi');
      expect(responsesOf(calls)[1]!.body!.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: unavailable('task') }]);
      expect(harnessCalls(logs)[0]).toMatchObject({ name: 'task', classification: 'client_owned', outcome: 'answered_task_client_owned' });
    });

    it('answers an unknown function name with the honest default, and a name that is not a plain token as requested', async () => {
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...functionCall('shell', 'call_1', '{"command":"rm -rf /"}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Done'), completed(1, 0, 1)),
      ]);
      await run('hi');
      expect(responsesOf(calls)[1]!.body!.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: unavailable('shell') }]);
      const odd = setup([
        () => sse(created('resp_1'), ...functionCall('Not A Token!', 'call_2', '[1]'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Done'), completed(1, 0, 1)),
      ]);
      await odd.run('hi');
      expect(responsesOf(odd.calls)[1]!.body!.input).toEqual([expect.objectContaining({ output: unavailable('requested') })]);
    });

    it('answers only the client-owned call when native and client-owned calls share a response', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...functionCall('task', 'call_native', '{}'), ...result('call_native'), ...message('Child is done. '), ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('All done'), completed(1, 0, 1)),
      ], { log });
      await run('hi');
      expect(responsesOf(calls)).toHaveLength(2);
      expect(responsesOf(calls)[1]!.body!.input).toEqual([{ type: 'function_call_output', call_id: 'call_owned', output: unavailable('lookup') }]);
      expect(harnessCalls(logs).map(fields => [fields.name, fields.classification, fields.rule])).toEqual([
        ['task', 'native', 'result_item'], ['lookup', 'client_owned', 'last_item_unanswered'],
      ]);
      expect(turnLog(logs)).toMatchObject({ rounds: 2, clientItems: 1, nativeCalls: 1 });
    });

    it('approves a genuine mcp_approval_request but not one the harness went on from', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...approval('mcpr_1'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Read it'), completed(1, 0, 1)),
      ], { log });
      expect(await run('hi')).toContain('Read it');
      expect(responsesOf(calls)[1]!.body).toEqual({
        conversation: 'conv_1', stream: true, input: [{ type: 'mcp_approval_response', approval_request_id: 'mcpr_1', approve: true }],
      });
      expect(harnessCalls(logs)[0]).toMatchObject({ itemType: 'mcp_approval_request', serverLabel: 'jarvis', outcome: 'approved', argumentKeys: ['path'], round: 1 });
      const handled = setup([() => sse(created('resp_1'), ...approval('mcpr_2'), ...message('Already approved'), completed(1, 0, 1))]);
      await handled.run('hi');
      expect(responsesOf(handled.calls)).toHaveLength(1);
    });

    it('does not resubmit an approval in a rate-limited follow-up', async () => {
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...approval('mcpr_1'), completed(1, 0, 1)),
        () => new Response(null, { status: 429 }),
        () => sse(created('resp_2'), ...message('Unexpected retry'), completed(1, 0, 1)),
      ]);
      await expect(run('hi')).rejects.toMatchObject({ kind: 'service_busy' });
      expect(responsesOf(calls)).toHaveLength(2);
      expect(responsesOf(calls)[1]!.body?.input).toEqual([{ type: 'mcp_approval_response', approval_request_id: 'mcpr_1', approve: true }]);
    });

    it('does not treat a server error after submitting an approval as a rejected request', async () => {
      const { run, registry, calls } = setup([
        call => {
          registry.resolve(turnOf(call))!.receipts.push({ confirmation: 'Completed task: Pay rent.', action: true });
          return sse(created('resp_1'), ...approval('mcpr_1'), completed(1, 0, 1));
        },
        () => new Response(null, { status: 502 }),
      ]);
      await expect(run('hi')).rejects.toMatchObject({
        receipt: `Completed task: Pay rent. ${failureCopy.cut_off.chat} ${failureCopy.reply_not_written.chat}`,
      });
      expect(responsesOf(calls)).toHaveLength(2);
    });

    it('answers every client-owned call of one response in one follow-up, in the order they came', async () => {
      const { run, calls, logs } = (() => { const c = capture(); return { ...setup([
        () => sse(created('resp_1'), ...functionCall('a_tool', 'call_a', '{}'), ...approval('mcpr_b'), ...functionCall('web', 'call_c', '{"q":"x"}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('All done'), completed(1, 0, 1)),
      ], { log: c.log }), logs: c.logs }; })();
      await run('hi');
      expect(responsesOf(calls)).toHaveLength(2);
      expect(responsesOf(calls)[1]!.body!.input).toEqual([
        { type: 'function_call_output', call_id: 'call_a', output: unavailable('a_tool') },
        { type: 'mcp_approval_response', approval_request_id: 'mcpr_b', approve: true },
        { type: 'function_call_output', call_id: 'call_c', output: unavailable('web') },
      ]);
      expect(harnessCalls(logs).map(fields => fields.outcome)).toEqual(['answered_default', 'approved', 'answered_default']);
      expect(turnLog(logs)).toMatchObject({ rounds: 2, clientItems: 3 });
    });

    it('keeps answering across rounds, with a fresh follow-up for each response', async () => {
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...functionCall('lookup', 'call_2', '{}'), completed(1, 0, 1)),
        () => sse(created('resp_3'), ...message('Finally'), completed(1, 0, 1)),
      ]);
      expect(await run('hi')).toContain('Finally');
      expect(responsesOf(calls).map(call => call.body!.input)).toEqual([
        expect.any(Array),
        [{ type: 'function_call_output', call_id: 'call_1', output: unavailable('lookup') }],
        [{ type: 'function_call_output', call_id: 'call_2', output: unavailable('lookup') }],
      ]);
    });

    it('settles a call id once per turn: a replayed call is neither answered again nor run again', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([
        () => sse(created('resp_1'), ...functionCall('task', 'call_native', '{}'), ...message('Child done. '), ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Back. '), ...functionCall('task', 'call_native', '{}'), ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1)),
      ], { log });
      expect(await run('hi')).toContain('Back. ');
      expect(responsesOf(calls)).toHaveLength(2);
      expect(harnessCalls(logs).filter(fields => fields.rule === 'replayed')).toHaveLength(2);
      expect(turnLog(logs)).toMatchObject({ outcome: 'ok', rounds: 2, clientItems: 1, nativeCalls: 1 });
    });

    it('leaves a call alone whose item never completed and which nothing followed', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created('resp_1'), ...message('Working. '),
        frame({ type: 'response.output_item.added', item: callItem('task', 'call_1', '', 'in_progress') }), completed(1, 0, 1))], { log });
      expect(await run('hi')).toContain('Working. ');
      expect(responsesOf(calls)).toHaveLength(1);
      expect(harnessCalls(logs)).toEqual([expect.objectContaining({ classification: 'unknown', rule: 'incomplete_item' })]);
      expect(harnessCalls(logs)[0]).not.toHaveProperty('outcome');
    });

    it('fails clearly, without retry, answer or duplicate, when the response fails after a native call', async () => {
      const { logs, log } = capture();
      const failed = frame({ type: 'response.failed', response: { error: { code: 'server_error' } } });
      const { run, calls, store } = setup([
        () => sse(created('resp_1'), ...message('Asking. '), ...functionCall('task', 'call_1', '{}'), ...result('call_1'), failed),
        () => sse(created('resp_2'), ...message('Again'), completed(1, 0, 1)),
      ], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_retry');
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'foundry_response_failed', sawTool: true, sawOutput: true });
      expect(store.turns).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'failed' });
      expect(store.turns[0]!.inputTokens).toBeGreaterThan(0);
    });

    it('reads a native call to its terminal event, and cancels the response only when the turn itself is cancelled', async () => {
      const finished = setup([() => sse(created('resp_1'), ...functionCall('task', 'call_1', '{}'), ...message('Done'), completed(1, 0, 1))]);
      await finished.run('hi');
      expect(finished.calls.filter(call => call.url.includes('/cancel'))).toHaveLength(0);
      const controller = new AbortController();
      const { run, calls } = setup([() => { setTimeout(() => controller.abort(), 20); return stalled(created('resp_1'), ...functionCall('task', 'call_1', '{}'))(); }]);
      await expect(run('hi', controller.signal)).rejects.toBeDefined();
      expect(responsesOf(calls)).toHaveLength(1);
      expect(calls.filter(call => call.url.includes('/responses/resp_1/cancel'))).toHaveLength(1);
    });

    it('stops cleanly with its own reason instead of a ninth response, charging all eight', async () => {
      const { logs, log } = capture();
      const { run, calls, store, registry } = setup(
        Array.from({ length: 9 }, (_, index) => () => sse(created(`resp_${index}`), ...functionCall('lookup', `call_${index}`, '{}'), completed(100, 0, 10))), { log },
      );
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'client_tool_round_limit', userMessage: failureCopy.cut_off.chat });
      expect(responsesOf(calls)).toHaveLength(8);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'client_tool_round_limit', attempt: 1 });
      expect(store.turns).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 800, outputTokens: 80 });
      expect(turnLog(logs)).toMatchObject({ outcome: 'failed', rounds: 8, clientItems: 7, inputTokens: 800 });
      expect(registry.size).toBe(0);
    });

    it('ends at once when the turn is cancelled during a follow-up, charging the finished round', async () => {
      const controller = new AbortController();
      const { run, calls, store, registry } = setup([
        () => sse(created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), completed(1_000, 0, 10)),
        () => { setTimeout(() => controller.abort(), 10); return stalled(created('resp_2'))(); },
      ]);
      await expect(run('hi', controller.signal)).rejects.toBeDefined();
      expect(responsesOf(calls)).toHaveLength(2);
      expect(store.turns[0]).toMatchObject({ outcome: 'cancelled', inputTokens: 1_000, outputTokens: 10 });
      expect(registry.size).toBe(0);
    });

    it('times out when the follow-up outlives the turn deadline', async () => {
      const { run, calls, store } = setup([
        () => sse(created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), completed(1, 0, 1)),
        stalled(created('resp_2')),
      ], { turnTimeoutMs: 80 });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_timeout' });
      expect(responsesOf(calls)).toHaveLength(2);
      expect(store.turns[0]).toMatchObject({ outcome: 'timeout' });
    });

    it('says part of it may be done when the follow-up times out after a call that only the completed output listed', async () => {
      // The call never streamed as an item, so no tool event was seen; the second response exists only because of it.
      const listedOnlyAtTheEnd = frame({
        type: 'response.completed',
        response: { status: 'completed', output: [callItem('lookup', 'call_1', '{}', 'completed')], usage: { input_tokens: 1, output_tokens: 1 } },
      });
      const { run, calls } = setup([() => sse(created('resp_1'), listedOnlyAtTheEnd), stalled(created('resp_2'))], { turnTimeoutMs: 80 });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_timeout', kind: 'took_too_long', userMessage: failureCopy.took_too_long.chat });
      expect(responsesOf(calls)).toHaveLength(2);
    });

    it('never retries a stream that carried a call, nor a failed follow-up', async () => {
      const failed = frame({ type: 'response.failed', response: { error: { code: 'server_error' } } });
      const { logs, log } = capture();
      const first = setup([() => sse(created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), failed), () => sse(delta('again'), completed(1, 0, 1))], { log });
      await expect(first.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(first.calls)).toHaveLength(1);
      const followUp = setup([
        () => sse(created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), completed(1, 0, 1)),
        () => sse(created('resp_2'), failed),
        () => sse(delta('again'), completed(1, 0, 1)),
      ], { log });
      await expect(followUp.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(followUp.calls)).toHaveLength(2);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_retry');
      const ended = setup([() => sse(created('resp_1'), ...functionCall('task', 'call_1', '{}')), () => sse(delta('again'), completed(1, 0, 1))]);
      await expect(ended.run('hi')).rejects.toMatchObject({ code: 'pi_failed' });
      expect(responsesOf(ended.calls)).toHaveLength(1);
    });

    describe('a failure in a later response', () => {
      const failed = frame({ type: 'response.failed', response: { error: { code: 'content_filter' } } });
      /** A first response that ends on a client-owned call, which is the only reason a turn has a second response. */
      const firstResponses: Array<[string, () => Response]> = [
        ['it had already streamed text', () => sse(created('resp_1'), ...message('Let me check. '), ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1))],
        ['a native call had already run in it', () => sse(
          created('resp_1'), ...functionCall('task', 'call_native', '{}'), ...result('call_native'), ...message('Child is done. '),
          ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1),
        )],
        ['its client-owned call had been answered', () => sse(created('resp_1'), ...functionCall('lookup', 'call_owned', '{}'), completed(1, 0, 1))],
        ['its approval request had been approved', () => sse(created('resp_1'), ...approval('mcpr_1'), completed(1, 0, 1))],
      ];

      it.each(firstResponses)('says part of it may already be done, never that nothing was done, when it fails quietly after %s', async (_name, first) => {
        const { run, calls } = setup([first, () => sse(created('resp_2'), failed)]);
        await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed', kind: 'cut_off', userMessage: failureCopy.cut_off.chat });
        expect(responsesOf(calls)).toHaveLength(2);
      });

      it('still says nothing was done when the first response fails quietly before anything happened', async () => {
        const { run, calls } = setup([() => sse(created('resp_1'), failed)]);
        await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed', kind: 'cut_off_clean', userMessage: failureCopy.cut_off_clean.chat });
        expect(responsesOf(calls)).toHaveLength(1);
      });
    });

    it('answers up to 16 client-owned calls in one response and fails with the 17th, after reading the whole stream', async () => {
      const calls = (count: number) => Array.from({ length: count }, (_, index) => functionCall('lookup', `call_${index}`, '{}')).flat();
      const within = setup([
        () => sse(created('resp_1'), ...calls(16), completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Done'), completed(1, 0, 1)),
      ]);
      await within.run('hi');
      expect(responsesOf(within.calls)[1]!.body!.input).toHaveLength(16);
      const { logs, log } = capture();
      const flood = setup([() => sse(created('resp_1'), ...calls(17), completed(7_000, 0, 70))], { log });
      await expect(flood.run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'too_many_client_calls', userMessage: failureCopy.cut_off.chat });
      expect(responsesOf(flood.calls)).toHaveLength(1);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'approval_or_function_call_item' });
      expect(flood.store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 7_000, outputTokens: 70 });
    });

    it('does not answer 600 native calls, even past the tracking limit: the harness ran them and the reply arrives once', async () => {
      const natives = Array.from({ length: 600 }, (_, index) => [
        frame({ type: 'response.output_item.added', item: callItem('task', `call_${index}`, '', 'in_progress') }),
        frame({ type: 'response.output_item.done', item: { ...callItem('task', `call_${index}`, '{}', 'completed'), output: 'child result' } }),
      ]).flat();
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created('resp_1'), ...natives, ...message('Done'), completed(1, 0, 1))], { log });
      expect((await run('hi')).filter(chunk => typeof chunk === 'string')).toEqual(['Done']);
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.map(([event]) => event)).not.toContain('pi.stream_failed');
      expect(turnLog(logs)).toMatchObject({ outcome: 'ok', nativeCalls: expect.any(Number) });
    });

    it('fails only when calls beyond the tracking limit were never followed by any output', async () => {
      const bare = Array.from({ length: 600 }, (_, index) => functionCall('lookup', `call_${index}`, '{}')).flat();
      const { run, calls, store } = setup([() => sse(created('resp_1'), ...bare, completed(100, 0, 10))]);
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'too_many_client_calls', userMessage: failureCopy.cut_off.chat });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 100 });
    });

    it('leaves a call alone whose arguments finished but whose item never did: the harness may still be running it', async () => {
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created('resp_1'), ...message('Working. '),
        frame({ type: 'response.output_item.added', item: callItem('task', 'call_1', '', 'in_progress') }),
        frame({ type: 'response.function_call_arguments.done', item_id: 'fc_call_1', arguments: '{"prompt":"p"}' }),
        completed(1, 0, 1))], { log });
      expect(await run('hi')).toContain('Working. ');
      expect(responsesOf(calls)).toHaveLength(1);
      expect(harnessCalls(logs)).toEqual([expect.objectContaining({ classification: 'unknown', rule: 'incomplete_item', argumentKeys: ['prompt'] })]);
    });

    it.each(['failed', 'incomplete', 'cancelled', 'in_progress'])('leaves a call alone whose finished item has the status %s', async (status) => {
      const { logs, log } = capture();
      const { run, calls } = setup([() => sse(created('resp_1'), ...message('Working. '),
        frame({ type: 'response.output_item.added', item: callItem('task', 'call_1', '', 'in_progress') }),
        frame({ type: 'response.output_item.done', item: callItem('task', 'call_1', '{}', status) }),
        completed(1, 0, 1))], { log });
      expect(await run('hi')).toContain('Working. ');
      expect(responsesOf(calls)).toHaveLength(1);
      expect(harnessCalls(logs)).toEqual([expect.objectContaining({ classification: 'unknown', rule: 'incomplete_item', itemStatus: status.replace(/[^a-z_]/gu, '') })]);
    });

    it('treats a finished item without a status as completed, so a genuine client call still gets its one follow-up', async () => {
      const { run, calls } = setup([
        () => sse(created('resp_1'),
          frame({ type: 'response.output_item.added', item: callItem('lookup', 'call_1', '', 'in_progress') }),
          frame({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_call_1', call_id: 'call_1', name: 'lookup', arguments: '{}' } }),
          completed(1, 0, 1)),
        () => sse(created('resp_2'), ...message('Done'), completed(1, 0, 1)),
      ]);
      await run('hi');
      expect(responsesOf(calls)).toHaveLength(2);
      expect(responsesOf(calls)[1]!.body!.input).toEqual([{ type: 'function_call_output', call_id: 'call_1', output: unavailable('lookup') }]);
    });

    it('fails a client-owned call it cannot answer but charges the real usage of the response that carried it', async () => {
      const { logs, log } = capture();
      const first = frame({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', name: 'lookup', arguments: '{}', status: 'completed' } });
      const { run, calls, store } = setup([() => sse(created('resp_1'), first, completed(7_000, 0, 70))], { log });
      await expect(run('hi')).rejects.toMatchObject({ code: 'pi_failed', detail: 'client_call_without_id', userMessage: failureCopy.cut_off.chat });
      expect(responsesOf(calls)).toHaveLength(1);
      expect(logs.find(([event]) => event === 'pi.stream_failed')![1]).toMatchObject({ reason: 'approval_or_function_call_item' });
      expect(store.turns[0]).toMatchObject({ outcome: 'failed', inputTokens: 7_000, outputTokens: 70 });
    });

    describe('stream contract shapes, each fed as random-sized byte chunks over seeds 0 to 19', () => {
      const seeds = Array.from({ length: 20 }, (_, seed) => seed);
      // Non-ASCII text with a four-byte emoji, so chunk boundaries also fall inside UTF-8 sequences.
      const first = 'Pr\u00F8ve 3 \u{1F327}\uFE0F. ';
      const second = 'Nu med regn \u{1F327}\uFE0F.';
      const cut = 'Pr\u00F8ve 3'.length;
      /** The stream as one body that arrives in pieces of 1 to 67 bytes, cut by a seeded LCG, so frames and characters are split anywhere. */
      const fragmented = (seed: number, frames: readonly string[]) => {
        const bytes = new TextEncoder().encode(frames.join(''));
        const pieces: Uint8Array[] = [];
        let state = seed;
        for (let at = 0; at < bytes.length;) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          const size = 1 + (state >>> 16) % 67;
          pieces.push(bytes.slice(at, at + size));
          at += size;
        }
        return new Response(new ReadableStream({ start(controller) { for (const piece of pieces) controller.enqueue(piece); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
      };
      /** One turn whose responses are these frame lists: everything the contract is about, in one comparable value. */
      const play = async (rounds: ReadonlyArray<readonly string[]>, seed: number) => {
        const { logs, log } = capture();
        const { run, calls, store } = setup(rounds.map(frames => () => fragmented(seed, frames)), { log });
        let reply = '';
        let failed = false;
        try { for (const chunk of await run('hi')) if (typeof chunk === 'string') reply += chunk; } catch { failed = true; }
        const requests = responsesOf(calls);
        const turn = store.turns[0];
        return {
          failed, reply, requests: requests.length,
          billed: turn ? [turn.inputTokens, turn.cachedTokens, turn.outputTokens] : null,
          envelopes: requests.map(request => ({ conversation: request.body!.conversation, stream: request.body!.stream, keys: Object.keys(request.body!).sort() })),
          followUps: requests.slice(1).map(request => request.body!.input),
          calls: harnessCalls(logs).map(fields => `${String(fields.classification)}:${String(fields.rule)}`),
        };
      };
      const envelope = { conversation: 'conv_1', stream: true, keys: ['conversation', 'input', 'stream'] };
      const answer = (callId: string, name = 'lookup') => [{ type: 'function_call_output', call_id: callId, output: unavailable(name) }];
      /** The exact result of a turn that ended normally: one request, plus one per follow-up. */
      const ok = (reply: string, billed: number[], followUps: unknown[] = [], calls: string[] = []) => ({
        failed: false, reply, requests: followUps.length + 1, billed, envelopes: followUps.map(() => envelope).concat(envelope), followUps, calls,
      });
      const finished = (output: unknown[], input: number, cached: number, out: number) => frame({
        type: 'response.completed',
        response: { status: 'completed', output, usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: out } },
      });
      const finalMessage = (text: string, id = 'msg_1', ...more: string[]) => ({
        type: 'message', id, role: 'assistant', status: 'completed', content: [text, ...more].map(part => ({ type: 'output_text', text: part, annotations: [] })),
      });
      const anonymousMessage = (text: string) => ({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
      const textDelta = (text: string, id = 'msg_1', index = 0, part = 0) => frame({ type: 'response.output_text.delta', item_id: id, output_index: index, content_index: part, delta: text });
      const textDone = (text: string, id = 'msg_1', index = 0, part = 0) => frame({ type: 'response.output_text.done', item_id: id, output_index: index, content_index: part, text });
      /** A done event that names neither its item nor its output index, like `delta()` does for the deltas. */
      const unnamedDone = (text: string) => frame({ type: 'response.output_text.done', content_index: 0, text });
      const statusless = { type: 'function_call', id: 'fc_call_1', call_id: 'call_1', name: 'lookup', arguments: '{}' };
      const added = (item: unknown, index?: number) => frame({ type: 'response.output_item.added', ...(index === undefined ? {} : { output_index: index }), item });
      const finishedItem = (item: unknown, index?: number) => frame({ type: 'response.output_item.done', ...(index === undefined ? {} : { output_index: index }), item });
      const mcpCall = { type: 'mcp_call', id: 'mcp_1', server_label: 'jarvis', name: 'find_tools' };
      const listedTools = { type: 'mcp_list_tools', id: 'mcpl_1', server_label: 'jarvis', tools: [] };
      /** The item that is opened before a call and closed after it, named by its id, its output index or both. */
      const earlierMessage = (by: 'id' | 'index' | 'both') => {
        const item = { type: 'message', ...(by === 'index' ? {} : { id: 'msg_1' }) };
        const index = by === 'id' ? undefined : 0;
        return { opened: added(item, index), closed: finishedItem(item, index) };
      };

      type Shape = [string, ReadonlyArray<readonly string[]>, ReturnType<typeof ok>];
      const gaps: Shape[] = [
        ['1. a statusless call that was only added: no done event, nothing after it', [
          [created('resp_1'), delta(first), added(statusless), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['unknown:incomplete_item'])],
        ['1. a statusless approval request that was only added: no done event, nothing after it', [
          [created('resp_1'), delta(first), added({ type: 'mcp_approval_request', id: 'mcpr_1', server_label: 'jarvis', name: 'read_file', arguments: '{"path":"/x"}' }), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['unknown:incomplete_item'])],
        ['2. reply text only in the terminal event, with no text deltas', [
          [created('resp_1'), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['3. reply text only in response.output_text.done, with no text deltas', [
          [created('resp_1'), textDone(first), completed(9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['3. reply text only in response.output_text.done, named by its item id alone', [
          [created('resp_1'), frame({ type: 'response.output_text.done', item_id: 'msg_1', content_index: 0, text: first }), completed(9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['3. reply text only in response.output_text.done, named by its output index alone', [
          [created('resp_1'), frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, text: first }), completed(9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['4. an mcp_call that was only added after a completed call', [
          [created('resp_1'), delta(first), ...functionCall('lookup', 'call_1', '{}'), added(mcpCall), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['native:later_output'])],
        ...(['id', 'index', 'both'] as const).map((by): Shape => [`5. the message opened before the call is closed after it, named by ${by}`, [
          [created('resp_1'), earlierMessage(by).opened, delta(first), ...functionCall('lookup', 'call_1', '{}'), earlierMessage(by).closed, completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])]),
        ['5. the mcp_call opened before the call is closed after it', [
          [created('resp_1'), delta(first), added(mcpCall, 0), ...functionCall('lookup', 'call_1', '{}'), finishedItem(mcpCall, 0), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['5. the text of the message opened before the call is closed after it too', [
          [created('resp_1'), added({ type: 'message', id: 'msg_1' }, 0), textDelta(first), ...functionCall('lookup', 'call_1', '{}'),
            textDone(first), finishedItem({ type: 'message', id: 'msg_1' }, 0), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
      ];

      const kept: Shape[] = [
        ['a statusless call with a done event is complete, so it is answered once', [
          [created('resp_1'), delta(first), added(statusless), finishedItem(statusless), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['a statusless call in the completed response output is complete, so it is answered once', [
          [created('resp_1'), delta(first), added(statusless), finished([statusless], 10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['a statusless approval request with a done event is complete, so it is approved once', [
          [created('resp_1'), delta(first), ...approval('mcpr_1'), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [[{ type: 'mcp_approval_response', approval_request_id: 'mcpr_1', approve: true }]], ['client_owned:last_item_unanswered'])],
        ['native: text follows the call', [
          [created('resp_1'), delta(first), ...functionCall('task', 'call_1', '{}'), ...message(second), completed(11, 2, 7)],
        ], ok(first + second, [11, 2, 7], [], ['native:later_output'])],
        ['native: a result item follows the call', [
          [created('resp_1'), delta(first), ...functionCall('task', 'call_1', '{}'), ...result('call_1'), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['native:result_item'])],
        ['native: an item first seen after the call is closed', [
          [created('resp_1'), delta(first), ...functionCall('task', 'call_1', '{}'), finishedItem({ type: 'message', id: 'msg_9' }, 3), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['native:later_output'])],
        ['client-owned: nothing follows the call', [
          [created('resp_1'), delta(first), ...functionCall('lookup', 'call_1', '{}'), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['client-owned replay within one response: the same call id repeated is answered once', [
          [created('resp_1'), delta(first), ...functionCall('lookup', 'call_1', '{}'), ...functionCall('lookup', 'call_1', '{}'), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['client-owned replay: the same call id again is answered once', [
          [created('resp_1'), delta(first), ...functionCall('lookup', 'call_1', '{}'), completed(10, 2, 5)],
          [created('resp_2'), delta(second), ...functionCall('lookup', 'call_1', '{}'), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered', 'unknown:replayed'])],
        ...(['failed', 'incomplete', 'cancelled', 'in_progress'] as const).map((status): Shape => [`unknown: the call item finished with the status ${status}`, [
          [created('resp_1'), delta(first), added(callItem('lookup', 'call_1', '', 'in_progress')), finishedItem(callItem('lookup', 'call_1', '{}', status)), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7], [], ['unknown:incomplete_item'])]),
        ['a null item is ignored', [
          [created('resp_1'), delta(first), added(null), completed(11, 2, 7)],
        ], ok(first, [11, 2, 7])],
        ['shell_call and shell_call_output items are unknown and left alone', [
          [created('resp_1'), delta(first), added({ type: 'shell_call', id: 'sh_1', call_id: 'sh_call_1', status: 'in_progress' }),
            finishedItem({ type: 'shell_call', id: 'sh_1', call_id: 'sh_call_1', status: 'completed' }),
            added({ type: 'shell_call_output', call_id: 'sh_call_1', output: 'done' }), finishedItem({ type: 'shell_call_output', call_id: 'sh_call_1', output: 'done' }),
            delta(second), completed(11, 2, 7)],
        ], ok(first + second, [11, 2, 7])],
      ];

      // How a done event and the completed output add to the streamed text: only what is missing, and never when they disagree.
      const texts: Shape[] = [
        ['a terminal-only reply still lets the client-owned call after it be answered', [
          [created('resp_1'), finished([finalMessage(first), { ...statusless, status: 'completed' }], 10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['text in the done event and again in the completed output arrives once', [
          [created('resp_1'), textDone(first), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['deltas followed by the same text in the completed output arrive once', [
          [created('resp_1'), textDelta(first.slice(0, cut)), textDelta(first.slice(cut)), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['deltas that name no item, followed by the same text in the completed output, arrive once', [
          [created('resp_1'), delta(first.slice(0, cut)), delta(first.slice(cut)), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['deltas that name no item, followed by the same text in the done event and the completed output, arrive once', [
          [created('resp_1'), delta(first), textDone(first), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['only the missing end of the completed output text is added to the streamed start', [
          [created('resp_1'), textDelta(first.slice(0, cut)), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['only the missing end of the done event text is added to the streamed start', [
          [created('resp_1'), textDelta(first.slice(0, cut)), textDone(first), completed(9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['a final text that does not start with the streamed text adds nothing', [
          [created('resp_1'), textDelta(first), textDone('Something else entirely'), finished([finalMessage('Another text')], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['a final text shorter than the streamed text adds nothing', [
          [created('resp_1'), textDelta(first), finished([finalMessage(first.slice(0, cut))], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['a terminal-only reply that follows a call: the call is native and the text arrives once', [
          [created('resp_1'), finished([{ ...statusless, status: 'completed' }, finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4], [], ['native:final_output'])],
        ['the text parts of one message are reconciled by content index', [
          [created('resp_1'), textDelta(first), finished([finalMessage(first, 'msg_1', second)], 9, 3, 4)],
        ], ok(first + second, [9, 3, 4])],
        ['a message without an id is reconciled by its output index', [
          [created('resp_1'), frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: first }), finished([anonymousMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['each message of the completed output is reconciled on its own', [
          [created('resp_1'), textDelta(first, 'msg_1', 0), finished([finalMessage(first, 'msg_1'), finalMessage(second, 'msg_2')], 9, 3, 4)],
        ], ok(first + second, [9, 3, 4])],
        ['the text parts of one message streamed as deltas are reconciled by content index', [
          [created('resp_1'), textDelta(first, 'msg_1', 0, 0), textDelta(second, 'msg_1', 0, 1), finished([finalMessage(first, 'msg_1', second)], 9, 3, 4)],
        ], ok(first + second, [9, 3, 4])],
        ['the text parts of one message closed by done events are reconciled by content index', [
          [created('resp_1'), textDelta(first, 'msg_1', 0, 0), textDone(first, 'msg_1', 0, 0), textDone(second, 'msg_1', 0, 1), completed(9, 3, 4)],
        ], ok(first + second, [9, 3, 4])],
        ['an empty done text records nothing: the completed output still matches the unnamed deltas', [
          [created('resp_1'), delta(first), textDone(''), finished([finalMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['only the output_text parts of a message are reply text: other items and other parts are not', [
          [created('resp_1'), finished([
            { type: 'reasoning', id: 'rs_1', content: [{ type: 'output_text', text: 'private thoughts' }] },
            { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'refusal', refusal: 'No.' }, { type: 'summary_text', text: 'ignored' }, { type: 'output_text', text: first }] },
          ], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['text that only a done event brings, for an item first seen after a call, is output after the call', [
          [created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), textDone(second, 'msg_9', 3), completed(11, 2, 7)],
        ], ok(second, [11, 2, 7], [], ['native:later_output'])],
        ['an mcp_list_tools that opened before the call and closes after it is not output after the call', [
          [created('resp_1'), added(listedTools, 0), ...functionCall('lookup', 'call_1', '{}'), finishedItem(listedTools, 0), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
      ];

      // A text event that names no item can only be matched, in order, with the other text events that name none.
      const unnamed: Shape[] = [true, false].flatMap((withId): Shape[] => {
        const how = withId ? 'completed messages with an id' : 'completed messages without an id';
        const entry = (text: string, id: string) => (withId ? finalMessage(text, id) : anonymousMessage(text));
        return [
          [`deltas, an unnamed done and the same text in the completed output arrive once, ${how}`, [
            [created('resp_1'), delta(first), unnamedDone(first), finished([entry(first, 'msg_1')], 9, 3, 4)],
          ], ok(first, [9, 3, 4])],
          [`the start as deltas, an unnamed done with the whole text and the completed output arrive once, ${how}`, [
            [created('resp_1'), delta(first.slice(0, cut)), unnamedDone(first), finished([entry(first, 'msg_1')], 9, 3, 4)],
          ], ok(first, [9, 3, 4])],
          [`two unnamed done-only texts that the completed output repeats arrive once each, ${how}`, [
            [created('resp_1'), unnamedDone(first), unnamedDone(second), finished([entry(first, 'msg_1'), entry(second, 'msg_2')], 9, 3, 4)],
          ], ok(first + second, [9, 3, 4])],
          [`unnamed deltas of two messages, their unnamed dones and the completed output arrive once each, ${how}`, [
            [created('resp_1'), delta(first), delta(second), unnamedDone(first), unnamedDone(second), finished([entry(first, 'msg_1'), entry(second, 'msg_2')], 9, 3, 4)],
          ], ok(first + second, [9, 3, 4])],
          [`unnamed deltas of one message and a second message that only the completed output has arrive once each, ${how}`, [
            [created('resp_1'), delta(first), finished([entry(first, 'msg_1'), entry(second, 'msg_2')], 9, 3, 4)],
          ], ok(first + second, [9, 3, 4])],
          [`an unnamed done-only text and the unnamed deltas of the next message arrive once each, ${how}`, [
            [created('resp_1'), unnamedDone(first), delta(second), finished([entry(first, 'msg_1'), entry(second, 'msg_2')], 9, 3, 4)],
          ], ok(first + second, [9, 3, 4])],
          [`an unnamed done-only text, the start of the next message as unnamed deltas and the completed output add the missing end once, ${how}`, [
            [created('resp_1'), unnamedDone(first), delta(second.slice(0, cut)), finished([entry(first, 'msg_1'), entry(second, 'msg_2')], 9, 3, 4)],
          ], ok(first + second, [9, 3, 4])],
        ];
      });

      // An unnamed done event is output after a call only when it brings text: closing text that streamed before the call is not.
      const unnamedAfterCalls: Shape[] = [
        ['an unnamed done that only closes text streamed before the call is not output after it', [
          [created('resp_1'), added({ type: 'message', id: 'msg_1' }, 0), delta(first), ...functionCall('lookup', 'call_1', '{}'), unnamedDone(first), completed(10, 2, 5)],
          [created('resp_2'), delta(second), completed(12, 4, 6)],
        ], ok(first + second, [22, 6, 11], [answer('call_1')], ['client_owned:last_item_unanswered'])],
        ['an unnamed done that brings text after the call is output after it, so the call is native', [
          [created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), unnamedDone(second), completed(11, 2, 7)],
        ], ok(second, [11, 2, 7], [], ['native:later_output'])],
      ];

      // A name an event lacks is taken from the other: an item is found by its id, else by its output index, and each event gives the item every name it has.
      const naming: Shape[] = [
        ['the completed output has another id than the deltas at the same position: it is the same message', [
          [created('resp_1'), textDelta(first, 'msg_1', 0), finished([finalMessage(first, 'msg_9')], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['the completed output has another id at the same position and another text: nothing is added', [
          [created('resp_1'), textDelta(first, 'msg_0', 0), finished([finalMessage(second, 'msg_9')], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['deltas that name the message by id only, after it was opened with both, and a completed entry without an id: the same message', [
          [created('resp_1'), added({ type: 'message', id: 'msg_1' }, 0), frame({ type: 'response.output_text.delta', item_id: 'msg_1', content_index: 0, delta: first }), finished([anonymousMessage(first)], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['a done event that names the message by position only and a completed entry by id: the same message', [
          [created('resp_1'), frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, text: first }), finished([finalMessage(first, 'msg_1')], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
        ['an item that the completed output omits moves the positions after it: the id still finds the message', [
          [created('resp_1'), added(mcpCall, 0), added({ type: 'message', id: 'msg_1' }, 1), textDelta(first, 'msg_1', 1), finishedItem(mcpCall, 0), finished([finalMessage(first, 'msg_1')], 9, 3, 4)],
        ], ok(first, [9, 3, 4])],
      ];

      it.each([...gaps, ...texts, ...unnamed, ...unnamedAfterCalls, ...naming, ...kept])('%s', async (_name, rounds, expected) => {
        for (const seed of seeds) expect(await play(rounds, seed), `seed ${seed}`).toEqual(expected);
      });

      it('reconciles the first 2048 items of a response and no more: past that the reply is what streamed, so no text repeats', async () => {
        const items = Array.from({ length: 2_100 }, (_, index) => ({ id: `msg_${index}`, streamed: `t${index}`, text: `t${index}.` }));
        // Each message streams all but its last character; its done event and the completed output carry the whole text.
        const frames = items.flatMap(({ id, streamed, text }, index) => [added({ type: 'message', id }, index), textDelta(streamed, id, index), textDone(text, id, index)]);
        const { run, calls } = setup([() => sse(created('resp_1'), ...frames, finished(items.map(({ id, text }) => finalMessage(text, id)), 5, 0, 5))]);
        expect((await run('hi')).filter(chunk => typeof chunk === 'string').join('')).toBe(items.map((item, index) => (index < 2_048 ? item.text : item.streamed)).join(''));
        expect(responsesOf(calls)).toHaveLength(1);
      });

      it.each([
        ['the completed output', [created('resp_1'), finished([finalMessage(first), { ...statusless, status: 'completed' }], 10, 2, 5)], 'client_owned'],
        ['a done event', [created('resp_1'), ...functionCall('lookup', 'call_1', '{}'), textDone(first, 'msg_9', 3), completed(10, 2, 5)], 'native'],
      ])('counts reply text that only %s carried as text in the log of the call', async (_name, frames, classification) => {
        const { logs, log } = capture();
        const { run } = setup([() => sse(...frames), () => sse(created('resp_2'), delta(second), completed(12, 4, 6))], { log });
        await run('hi');
        expect(harnessCalls(logs)).toEqual([expect.objectContaining({ classification, sawText: true })]);
      });

      it.each([
        ['a failed response', [created('resp_1'), delta(first), frame({ type: 'response.failed', response: { error: { code: 'server_error' } } })]],
        ['an incomplete response', [created('resp_1'), delta(first), frame({ type: 'response.incomplete', response: { status: 'incomplete', error: { code: 'server_error' } } })]],
        ['a truncated frame', [created('resp_1'), delta(first), 'event: response.completed\ndata: {"type":"response.completed","response":{"status":"comp']],
      ])('ends the turn as an error, with one request and no follow-up, on %s', async (_name, frames) => {
        for (const seed of seeds) {
          expect(await play([frames, [created('resp_2'), delta(second), completed(1, 0, 1)]], seed), `seed ${seed}`)
            .toMatchObject({ failed: true, requests: 1, followUps: [], calls: [] });
        }
      });
    });
  });

  it('answers an unconfigured PI selection with its own error', async () => {
    const agent = createUnconfiguredPiAgent();
    await expect(agent.stream({ messageId: '1', text: 'x' }, 'a', new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toBeInstanceOf(PiGatewayError);
  });
});

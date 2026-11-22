import { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { buildApp } from '../app.js';
import { createPiAuth, piMcpPath } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import { defaultAwayModeState } from '../core/away-mode.js';
import type { ConversationAgentChunk } from '../core/chat-agent.js';
import type { ConversationMessage } from '../core/conversation-store.js';
import { createConversationModule } from '../core/conversation.js';
import { coreModule } from '../core/index.js';
import { readAttachedOwnerMessage } from '../core/owner-message.js';
import { defaultSettings } from '../core/settings.js';
import type { JarvisTool } from '../core/tool-registry.js';
import type { ToolCallRecord } from '../core/tool-calls.js';
import type { GoogleApiClient } from '../google/api-client.js';
import { createGoogleModule } from '../google/tools.js';
import { createLogger } from '../logging.js';
import type { PiActivationService } from '../pi/activation.js';
import { buildPiContext, buildPiEnvironment } from '../pi/context.js';
import { createPiGateway, type PiGateway } from '../pi/gateway.js';
import { createProactiveConversationContext } from '../proactive/conversation-context.js';
import { dayKey } from '../proactive/time.js';
import { createPiRoutes } from '../pi/routes.js';
import { createMemoryPiStore, type PiMessageRecord } from '../pi/store.js';
import { createPiTurnRegistry, type PiTurnGrant } from '../pi/turns.js';
import { createMemoryConversationStore, type MemoryConversationStore } from './parity-memory-store.testkit.js';
import {
  createScriptedFoundry, type McpOutcome, type ScriptedFoundry,
} from './parity-foundry.testkit.js';
import type { PiVoiceAgent } from './pi-voice.js';
import { createDailyCore, type DailyCore } from './parity-tools.testkit.js';
import { createVoiceRelayModule, VOICE_SUBPROTOCOL } from './relay.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
export const parityOwner = config.auth.ownerObjectId;
const mcpSecret = 'P'.repeat(43);
const fixedNow = new Date('2026-11-21T22:00:00Z');
export const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

export async function until(check: () => boolean, label: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(5);
  }
}

export interface WorldOptions {
  /** The situational-state block the activation service adds to every turn (PI sends it with the persona block when it changes). */
  readonly situation?: string;
  readonly monthlyCapDkk?: number;
  /** What the stub Google API answers; the default lists two events and accepts a create. */
  readonly google?: (api: string, path: string, method: string, body: unknown) => Promise<Record<string, unknown>>;
  /** Make the PI spend read fail, as a SQL outage would. */
  readonly spendUnreadable?: boolean;
  /** How long GPT-Live takes to speak a commentary once the relay has sent it (default none); the stub echoes it as the output transcript that much later. */
  readonly speechLagMs?: (text: string) => number;
  readonly onGatewayTurn?: (channel: 'chat' | 'voice') => void;
}

export interface ChatTurn {
  readonly status: number;
  readonly events: Array<{ name: string; data: Record<string, unknown> }>;
  readonly sessionId: string;
}

export interface VoiceCall {
  readonly sessionId: string;
  readonly received: Array<Record<string, unknown>>;
  /** What the relay told GPT-Live to say, one entry per `session.commentary.append`. */
  commentary(): Array<{ delegationId: unknown; content: string }>;
  /** Dan speaks: transcript deltas, then the client delegation GPT-Live creates for it. */
  say(text: string, options?: { readonly id?: string; readonly delegate?: boolean }): { readonly replay: () => void };
  /** The delegation ids of the utterances Dan has spoken, in order. */
  delegations(): string[];
  /** When GPT-Live last received commentary (epoch ms). */
  lastCommentaryAt(): number;
  /**
   * Resolves once the relay has taken in everything GPT-Live has sent it so far. Events arrive in order and are handled as they arrive, so a
   * blank word sent last and echoed back to the client proves it; the blank word changes nothing Dan said.
   */
  settle(): Promise<void>;
  end(): Promise<void>;
}

export interface GrantFacts {
  readonly ownerObjectId: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly activation: { readonly type: string; readonly source: string | null } | null;
  readonly results: ReadonlyArray<{ readonly tool: string; readonly outcome: string }>;
  readonly requests: number;
  readonly actions: number;
  readonly discovered: readonly string[];
  readonly aborted: boolean;
}

export interface ParityWorld {
  readonly app: ReturnType<typeof buildApp>;
  readonly store: MemoryConversationStore;
  readonly piStore: ReturnType<typeof createMemoryPiStore>;
  readonly gateway: PiGateway;
  readonly foundry: ScriptedFoundry<ParityWorld>;
  /** Every structured log record the backend wrote, after the real logger's allowlist. */
  readonly logs: Array<Record<string, unknown>>;
  readonly activity: Array<Record<string, unknown>>;
  readonly begun: Array<{ type: string; source: string | null; sessionId: string; messageId: string }>;
  readonly grants: PiTurnGrant[];
  readonly usage: Array<{ model: string; inputTokens: number; outputTokens: number; eventId: string }>;
  readonly googleCalls: Array<{ api: string; path: string; method: string; body: unknown }>;
  readonly replyPushes: Array<{ sessionId: string; messageId: string }>;
  /** What the gateway streamed to the channel for each turn: the same chunks reach chat and voice. */
  readonly taps: Array<{ readonly messageId: string; readonly channel: string; readonly chunks: ConversationAgentChunk[] }>;
  readonly persona: string;
  /** The daily-core tools and what they changed: notes and tasks, gym lifts, Jarvis work, nutrition. */
  readonly daily: DailyCore;
  /**
   * Copenhagen day keys for the clock the vault tools read (`new Date()`), so "today" and "tomorrow" hold on any run date. The one
   * clock-dependent window: a run that straddles Copenhagen midnight sees two different days, so rerun it.
   */
  readonly today: string;
  readonly tomorrow: string;
  readonly registrySize: () => number;
  deliverProactive(text: string, receipt?: Pick<PiMessageRecord, 'evidence' | 'followUpIds'>): Promise<ConversationMessage>;
  situation: string;
  /** The harness calling Jarvis over MCP with the static credential. */
  mcp(tool: 'find_tools' | 'call_tool', args: Record<string, unknown>): Promise<McpOutcome>;
  chat: {
    session(language?: 'en' | 'da'): Promise<string>;
    turn(text: string): Promise<ChatTurn>;
    /** Starts the turn without waiting for it to end; `ended` resolves with the parsed stream. */
    start(text: string): Promise<{ readonly sessionId: string; readonly ended: Promise<ChatTurn> }>;
    cancel(sessionId: string, messageId: string): Promise<number>;
    steer(sessionId: string, text: string): Promise<number>;
    reattach(sessionId: string, messageId: string): Promise<ChatTurn>;
  };
  openVoice(): Promise<VoiceCall>;
  grantFacts(): GrantFacts[];
  piTurnLogs(): Array<Record<string, unknown>>;
  close(): Promise<void>;
}

const parseEvents = (body: string) => body.split('\n\n').filter(frame => frame.startsWith('event:')).map(frame => ({
  name: /^event: (.*)$/mu.exec(frame)![1]!,
  data: JSON.parse(/^data: (.*)$/mu.exec(frame)![1]!) as Record<string, unknown>,
}));

const defaultGoogle: NonNullable<WorldOptions['google']> = async (_api, path, method) => {
  if (method === 'POST') return { id: 'created-event' };
  if (path.includes('/events')) {
    return {
      items: [
        { id: 'e1', summary: 'Dentist', start: { dateTime: '2026-11-22T09:00:00+01:00' }, end: { dateTime: '2026-11-22T09:30:00+01:00' } },
        { id: 'e2', summary: 'Lunch with Maja', start: { dateTime: '2026-11-22T12:00:00+01:00' }, end: { dateTime: '2026-11-22T13:00:00+01:00' } },
      ],
    };
  }
  return {};
};

/** Tools that exist only for the parity runs; everything else is the production catalogue code (core, conversation, Google). */
function fixtureTools(): JarvisTool[] {
  return [
    {
      name: 'weather',
      description: 'Weather forecast for a place and a day (vejret). Read-only.',
      inputSchema: {
        type: 'object', properties: { place: { type: 'string', maxLength: 80 }, day: { type: 'string', maxLength: 40 } }, additionalProperties: false,
      },
      execution: { defaultEffect: 'read' },
      execute: async (input) => ({ ...(input as object), summary: 'Sunny, 12 degrees, 10 percent chance of rain' }),
    },
    {
      name: 'parity_owner_probe',
      description: 'Reports which stored owner message this call is attributed to. Keyword: probe.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execution: { defaultEffect: 'read' },
      execute: async (_input, request, signal) => {
        const owner = await readAttachedOwnerMessage(request, signal);
        return {
          ownerMessageId: owner?.id ?? null, ownerText: owner?.text ?? null, ownerSessionId: owner?.sessionId ?? null,
          pi: request.jarvisPi ?? null, asAgent: request.agentPrincipal !== null && request.agentPrincipal !== undefined,
        };
      },
    },
    {
      name: 'parity_large_result',
      description: 'Returns a result of the requested size. Keyword: large.',
      inputSchema: {
        type: 'object', properties: { characters: { type: 'integer', minimum: 1, maximum: 2_000_000 } }, required: ['characters'], additionalProperties: false,
      },
      execution: { defaultEffect: 'read' },
      execute: async (input) => ({ rows: 'x'.repeat((input as { characters: number }).characters) }),
    },
  ];
}

const cleanups: Array<() => Promise<void>> = [];
export async function closeParityWorlds(): Promise<void> {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()));
}

export async function createParityWorld(options: WorldOptions = {}): Promise<ParityWorld> {
  const store = createMemoryConversationStore();
  const piStore = createMemoryPiStore(() => fixedNow);
  if (options.spendUnreadable) piStore.spendSince = async () => { throw new Error('SQL unavailable'); };
  const registry = createPiTurnRegistry();
  const logs: Array<Record<string, unknown>> = [];
  const activity: Array<Record<string, unknown>> = [];
  const begun: ParityWorld['begun'] = [];
  const grants: PiTurnGrant[] = [];
  const usage: ParityWorld['usage'] = [];
  const googleCalls: ParityWorld['googleCalls'] = [];
  const replyPushes: ParityWorld['replyPushes'] = [];
  const taps: ParityWorld['taps'] = [];
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 86_400_000));
  const daily = createDailyCore(store, today);
  const secretAuth = createPiAuth(config.auth.tenantId, mcpSecret);

  const logger = createLogger({ ...config, logLevel: 'info' } as typeof config, undefined, new Writable({
    write(chunk: Buffer, _encoding, done) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) logs.push(JSON.parse(line) as Record<string, unknown>);
      done();
    },
  }));

  const world = {
    situation: options.situation ?? 'SITUATIONAL STATE revision 1',
    async deliverProactive(text, receipt = {}) {
      const session = await store.createSession({ channel: 'chat', language: 'en' });
      const message = (await store.addMessage({ sessionId: session.id, role: 'jarvis', text, model: 'pi' }))!;
      await piStore.recordMessage({
        ...receipt, ownerObjectId: parityOwner, runId: 'fixture-wake', sessionId: session.id,
        messageId: message.id, textHash: 'a'.repeat(64), text,
      }, fixedNow, new AbortController().signal);
      return message;
    },
  } as ParityWorld;

  const activations: PiActivationService = {
    situation: { context: async () => ({ text: world.situation, view: {} as never }) } as never,
    async begin(input) {
      begun.push({ type: input.type, source: input.source, sessionId: input.sessionId, messageId: input.messageId });
      const grant = registry.open({
        ownerObjectId: input.ownerObjectId, sessionId: input.sessionId, messageId: input.messageId,
        ...(input.brain ? { brain: input.brain } : {}), signal: input.signal,
        activation: {
          id: `00000000-0000-4000-8000-${String(begun.length).padStart(12, '0')}`, type: input.type, source: input.source,
          slotKey: input.slotKey ?? null, stateRevision: 1, stateHash: null, policyRevision: 'a'.repeat(64), staleSources: 0, disabledSources: [],
        },
      });
      grants.push(grant);
      return {
        grant, context: world.situation,
        situation: {
          state: null, revision: 1, hash: null, policyRevision: 'a'.repeat(64), staleSources: [], missingSources: [], disabledSources: [],
          freshSources: [], asOf: null, updatedAt: null, lastActivation: null,
        },
      };
    },
    async failed() {},
  };

  const persona = buildPiContext(defaultSettings, defaultAwayModeState, buildPiEnvironment({}));
  const foundry = createScriptedFoundry<ParityWorld>({ world: () => world, callMcp: (tool, args) => world.mcp(tool, args) });
  const gateway = createPiGateway({
    projectEndpoint: 'https://foundry.example/api/projects/jarvis', agentName: 'jarvis-pi', owner: parityOwner,
    monthlyCapDkk: options.monthlyCapDkk ?? 250, timeZone: 'Europe/Copenhagen', store: piStore, registry, activations,
    getToken: async () => 'token', context: async () => persona, fetcher: foundry.fetcher, now: () => fixedNow, streamRetryDelayMs: 0,
    recordUsage: async (record) => { usage.push(record); },
    log: (event, fields) => logger.info({ msg: event, ...fields }, event),
  });

  const tapped: PiVoiceAgent = {
    warm: (signal) => gateway.warm(signal),
    async *stream(input, authorization, signal) {
      const tap = { messageId: input.messageId, channel: input.channel ?? 'chat', chunks: [] as ConversationAgentChunk[] };
      taps.push(tap);
      options.onGatewayTurn?.(tap.channel);
      for await (const chunk of gateway.stream(input, authorization, signal)) { tap.chunks.push(chunk); yield chunk; }
    },
  };

  const google: GoogleApiClient = {
    async request(api, path, requestOptions) {
      const method = requestOptions.method ?? 'GET';
      googleCalls.push({ api, path, method, body: requestOptions.body });
      return (options.google ?? defaultGoogle)(api, path, method, requestOptions.body);
    },
  };

  const upstream = new WebSocketServer({ port: 0 });
  const upstreamSockets: WebSocket[] = [];
  const upstreamEvents: Record<string, unknown>[] = [];
  let spoken = 0;
  let commentaryAt = 0;
  const speechTimers = new Set<NodeJS.Timeout>();
  // Delegation ids are unique across a world's voice sessions, so what each utterance got can be told apart after a reconnect.
  let utterances = 0;
  let settles = 0;
  const eventsBySocket = new WeakMap<WebSocket, Record<string, unknown>[]>();
  upstream.on('connection', (socket) => {
    upstreamSockets.push(socket);
    eventsBySocket.set(socket, []);
    let previous: { readonly delegation: unknown } | undefined;
    const queuedSpeech: Array<{ readonly at: number; readonly speech: string }> = [];
    let speechTimer: NodeJS.Timeout | undefined;
    const speakQueued = () => {
      if (speechTimer) speechTimers.delete(speechTimer);
      speechTimer = undefined;
      while (queuedSpeech.length > 0 && queuedSpeech[0]!.at <= Date.now()) {
        const next = queuedSpeech.shift()!;
        if (socket.readyState === WebSocket.OPEN) socket.send(next.speech);
      }
      if (queuedSpeech.length > 0) {
        speechTimer = setTimeout(speakQueued, Math.max(1, queuedSpeech[0]!.at - Date.now()));
        speechTimer.unref();
        speechTimers.add(speechTimer);
      }
    };
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString()) as Record<string, unknown>;
      upstreamEvents.push(event);
      eventsBySocket.get(socket)!.push(event);
      if (event.type === 'session.commentary.append' && typeof event.content === 'string') {
        // GPT-Live speaks the commentary as written, and the parts of one delegation read as one continuous speech. Whether the relay
        // stores that as one message or two depends on its 0.6 s quiet window, so the join must carry its own space and no timing decides it.
        const lead = previous?.delegation === event.delegation_id ? ' ' : '';
        previous = { delegation: event.delegation_id };
        commentaryAt = Date.now();
        spoken += 1;
        const speech = JSON.stringify({ type: 'session.output_transcript.delta', event_id: `spoken-${spoken}`, delta: lead + event.content });
        const lag = options.speechLagMs?.(event.content) ?? 0;
        // GPT-Live speaks one thing after another: a slow start delays everything queued behind it, and nothing is spoken out of order.
        if (lag <= 0 && queuedSpeech.length === 0) socket.send(speech);
        else {
          queuedSpeech.push({ at: Math.max(Date.now() + lag, queuedSpeech.at(-1)?.at ?? 0), speech });
          if (!speechTimer) speakQueued();
        }
      } else if (event.type === 'session.close') {
        socket.send(JSON.stringify({ type: 'session.closed', event_id: 'closed-1', usage: { seconds: 12 } }));
      }
    });
    socket.send(JSON.stringify({
      type: 'session.started', session: { id: 'live-session', audio: { format: { type: 'audio/pcm', rate: 24_000 } } },
    }));
  });
  await new Promise<void>(resolve => upstream.once('listening', resolve));
  const upstreamUrl = `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  const toolCallStore = { record: async (call: ToolCallRecord) => { store.toolCalls.push(call); } };
  const app = buildApp(config, logger, {
    auth: async () => ({ objectId: parityOwner, tenantId: config.auth.tenantId, displayName: 'Dan' }),
    conversationStore: store, piAgent: tapped, piAuth: secretAuth, toolCallStore,
    proactiveConversationContext: createProactiveConversationContext(
      parityOwner, { get: async () => undefined },
      { read: async () => undefined, select: async () => {} }, piStore, () => fixedNow,
    ),
    notifyReply: (reply) => { replyPushes.push({ sessionId: reply.sessionId, messageId: reply.messageId }); },
    awaitReplyNotificationApproval: async () => {},
    modules: [
      coreModule, createConversationModule(),
      createVoiceRelayModule({ getToken: async () => 'token', connect: () => new WebSocket(upstreamUrl) }),
      { id: 'parity', tools: fixtureTools(), registerRoutes: async () => {} },
      ...daily.modules,
      createGoogleModule(google, { timeZone: 'Europe/Copenhagen', now: () => fixedNow }),
      { id: 'pi', tools: [], registerRoutes: createPiRoutes({ gateway, registry, auth: secretAuth, monthlyCapDkk: options.monthlyCapDkk ?? 250 }) },
    ],
  });
  app.jarvisActivityHub.subscribe((event) => { activity.push({ ...event }); });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as AddressInfo).port;

  let rpc = 0;
  async function mcp(tool: 'find_tools' | 'call_tool', args: Record<string, unknown>): Promise<McpOutcome> {
    rpc += 1;
    const response = await app.inject({
      method: 'POST', url: piMcpPath, remoteAddress: '10.0.0.9',
      headers: {
        authorization: `Bearer jp.${mcpSecret}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: rpc, method: 'tools/call', params: { name: tool, arguments: args } },
    });
    const data = response.body.includes('data:') ? response.body.split('\n').find(line => line.startsWith('data:'))!.slice(5) : response.body;
    const json = data ? JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } } : undefined;
    const text = json?.result?.content?.[0]?.text;
    return { status: response.statusCode, isError: json?.result?.isError === true, body: text?.startsWith('{') ? JSON.parse(text) : undefined };
  }

  const headers = { authorization: 'Bearer a.b.c', 'content-type': 'application/json' };
  let chatSession: string | undefined;
  const chat: ParityWorld['chat'] = {
    async session(language = 'en') {
      chatSession ??= (await store.createSession({ channel: 'chat', language })).id;
      return chatSession;
    },
    async start(text) {
      const sessionId = await chat.session();
      const ended = app.inject({ method: 'POST', url: `/conversation/sessions/${sessionId}/turns`, headers, payload: { text } })
        .then((response): ChatTurn => ({ status: response.statusCode, sessionId, events: response.statusCode === 200 ? parseEvents(response.body) : [] }));
      return { sessionId, ended };
    },
    async turn(text) { return (await chat.start(text)).ended; },
    async cancel(sessionId, messageId) {
      return (await app.inject({ method: 'POST', url: `/conversation/sessions/${sessionId}/turns/${messageId}/cancel`, headers, payload: {} })).statusCode;
    },
    async steer(sessionId, text) {
      return (await app.inject({ method: 'POST', url: `/conversation/sessions/${sessionId}/steer`, headers, payload: { text } })).statusCode;
    },
    async reattach(sessionId, messageId) {
      const response = await app.inject({ method: 'GET', url: `/conversation/sessions/${sessionId}/turns/${messageId}/events`, headers });
      return { status: response.statusCode, sessionId, events: response.statusCode === 200 ? parseEvents(response.body) : [] };
    },
  };

  async function openVoice(): Promise<VoiceCall> {
    const before = upstreamSockets.length;
    const browser = new WebSocket(`ws://127.0.0.1:${port}/voice`, [VOICE_SUBPROTOCOL, 'jarvis.auth.aaa.bbb.ccc']);
    const received: Array<Record<string, unknown>> = [];
    browser.on('message', (data) => { received.push(JSON.parse(data.toString()) as Record<string, unknown>); });
    cleanups.push(async () => { browser.terminate(); });
    await until(() => received.some(event => event.type === 'jarvis.session.ready') && upstreamSockets.length === before + 1, 'GPT-Live relay readiness');
    browser.send(JSON.stringify({ type: 'jarvis.microphone.active' }));
    const socket = upstreamSockets[before]!;
    const ready = received.find(event => event.type === 'jarvis.session.ready')!;
    const delegationIds: string[] = [];
    return {
      sessionId: String(ready.sessionId),
      received,
      commentary: () => eventsBySocket.get(socket)!.filter(event => event.type === 'session.commentary.append' && event.delegation_id !== undefined)
        .map(event => ({ delegationId: event.delegation_id, content: String(event.content) })),
      say(text, sayOptions = {}) {
        utterances += 1;
        const id = sayOptions.id ?? `u${utterances}`;
        if (sayOptions.delegate !== false) delegationIds.push(`${id}-d`);
        const words = text.split(/(?<= )/u);
        const size = Math.max(1, Math.ceil(words.length / 3));
        const events: Array<Record<string, unknown>> = [];
        for (let index = 0; index * size < words.length; index += 1) {
          events.push({
            type: 'session.input_transcript.delta', event_id: `${id}-in-${index}`, delta: words.slice(index * size, (index + 1) * size).join(''),
            start_ms: index * 100, end_ms: (index + 1) * 100,
          });
        }
        // Without a delegation the words are only heard: GPT-Live has not handed anything to Jarvis.
        if (sayOptions.delegate !== false) events.push({ type: 'session.delegation.created', event_id: `${id}-delegation`, offset_ms: events.length * 100, delegation: { id: `${id}-d`, target: 'client' } });
        for (const event of events) socket.send(JSON.stringify(event));
        return { replay: () => { for (const event of events) socket.send(JSON.stringify(event)); } };
      },
      delegations: () => [...delegationIds],
      lastCommentaryAt: () => commentaryAt,
      async settle() {
        settles += 1;
        const eventId = `settle-${settles}`;
        socket.send(JSON.stringify({ type: 'session.input_transcript.delta', event_id: eventId, delta: ' ' }));
        await until(() => received.some(event => event.type === 'jarvis.voice.input_transcript.delta' && event.eventId === eventId), 'the relay to take in what GPT-Live sent');
      },
      async end() {
        if (browser.readyState !== WebSocket.OPEN) return;
        browser.send(JSON.stringify({ type: 'jarvis.session.end' }));
        await until(() => received.some(event => event.type === 'jarvis.session.ended' || event.type === 'jarvis.session.failed'), 'voice session end');
      },
    };
  }

  Object.assign(world, {
    app, store, piStore, gateway, foundry, logs, activity, begun, grants, usage, googleCalls, replyPushes, taps, persona, daily, today, tomorrow,
    registrySize: () => registry.size, mcp, chat, openVoice,
    grantFacts: (): GrantFacts[] => grants.map(grant => ({
      ownerObjectId: grant.ownerObjectId, sessionId: grant.sessionId, messageId: grant.messageId,
      activation: grant.activation ? { type: grant.activation.type, source: grant.activation.source } : null,
      results: grant.results.map(result => ({ tool: result.tool, outcome: result.outcome })),
      requests: grant.requests.count, actions: grant.actions.count, discovered: [...grant.discovered].sort(), aborted: grant.signal.aborted,
    })),
    piTurnLogs: () => logs.filter(record => record.msg === 'pi.turn'),
    async close() {
      for (const timer of speechTimers) clearTimeout(timer);
      for (const socket of upstreamSockets) socket.terminate();
      await app.close();
      upstream.close();
    },
  });
  cleanups.push(() => world.close());
  return world;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationStore } from './conversation-store.js';
import type { ConversationAgent } from './chat-agent.js';
import { conversationModule } from './conversation.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const headers = { authorization: ['Bearer', 'e30.e30.sig'].join(' ') };
const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function fixture(agent: ConversationAgent) {
  let messageId = 0;
  const conversationStore: ConversationStore = {
    createSession: vi.fn(async ({ channel, language }) => ({
      id: '41',
      channel,
      language,
      startedAt: new Date('2026-10-03T12:00:00Z'),
      endedAt: null,
    })),
    getSession: vi.fn(async () => ({
      id: '41',
      channel: 'chat',
      language: 'en',
      startedAt: new Date('2026-10-03T12:00:00Z'),
      endedAt: null,
    })),
    endSession: vi.fn(async () => true),
    addMessage: vi.fn(async (input) => ({
      id: String(++messageId),
      sessionId: input.sessionId,
      role: input.role,
      text: input.text,
      model: input.model,
      at: new Date('2026-10-03T12:00:01Z'),
    })),
    getDanMessageIdBySourceItemId: vi.fn(async () => null),
    getHistory: vi.fn(async () => ({ messages: [], nextCursor: null })),
  };
  const app = buildApp(config, undefined, {
    modules: [conversationModule],
    auth: async () => ({
      objectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      displayName: 'Dan',
    }),
    conversationStore,
    conversationAgent: agent,
  });
  apps.push(app);
  return app;
}

describe('chat runtime activity events', () => {
  it('publishes thinking and observed ended or failed transitions without message text', async () => {
    let fail = false;
    const agent: ConversationAgent = {
      stream: async function* () {
        if (fail) throw new Error('provider details and private response');
        yield 'private response text';
      },
    };
    const app = fixture(agent);
    const events: unknown[] = [];
    app.jarvisActivityHub.subscribe((event) => events.push(event));

    const success = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'private user transcript' },
    });
    expect(success.statusCode).toBe(200);
    expect(events.map((event) => (event as { type: string }).type)).toEqual(['thinking', 'ended']);
    expect(JSON.stringify(events)).not.toMatch(/private|provider|response|transcript/iu);

    fail = true;
    events.length = 0;
    const failure = await app.inject({
      method: 'POST',
      url: '/conversation/sessions/41/turns',
      headers,
      payload: { text: 'private user transcript' },
    });
    expect(failure.statusCode).toBe(200);
    expect(events.map((event) => (event as { type: string }).type)).toEqual(['thinking', 'failed']);
    expect(JSON.stringify(events)).not.toMatch(/private|provider|response|transcript/iu);
  });

  it('publishes interrupted when a connected chat stream is cancelled', async () => {
    let streamSignal: AbortSignal | undefined;
    const agent: ConversationAgent = {
      stream: async function* (_input, _authorization, signal) {
        streamSignal = signal;
        yield 'partial';
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('cancelled');
      },
    };
    const app = fixture(agent);
    const events: unknown[] = [];
    app.jarvisActivityHub.subscribe((event) => events.push(event));
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    const response = await fetch(`${address}/conversation/sessions/41/turns`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'private user transcript' }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await vi.waitFor(() => expect(streamSignal).toBeDefined());
    await vi.waitFor(() => expect(events).toHaveLength(1));
    controller.abort();
    await reader.cancel().catch(() => {});
    await vi.waitFor(() => expect(events.map((event) => (event as { type: string }).type))
      .toEqual(['thinking', 'interrupted']));
    expect(JSON.stringify(events)).not.toMatch(/private|transcript|partial/iu);
    app.server.closeAllConnections();
  });
});

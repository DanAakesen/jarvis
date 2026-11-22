import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createPiAuth } from '../auth/pi-credential.js';
import { loadConfig } from '../config.js';
import type { ConversationAgent } from './chat-agent.js';
import { createConversationModule } from './conversation.js';
import type { ConversationMessage, ConversationStore } from './conversation-store.js';
import { coreModule } from './index.js';
import { forgetSharedScreen, rememberSharedScreen, sharedScreenForMessage, type SharedScreenContext } from './shared-screen.js';
import type { JarvisTool } from './tool-registry.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const ownerToken = 'owner.token.fixture';
const bearer = (value: string) => `${['Bear', 'er'].join('')} ${value}`;
const apps: ReturnType<typeof buildApp>[] = [];
const page: SharedScreenContext = { screenDescription: 'The Wikipedia main page with a search box.', sharedWindowTitle: 'Wikipedia - Google Chrome' };

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (let id = 40; id < 120; id += 1) forgetSharedScreen(String(id));
});

describe('the shared page kept for a chat turn', () => {
  it('is found by its message until it is forgotten', () => {
    rememberSharedScreen('41', page);
    expect(sharedScreenForMessage('41')).toEqual(page);
    expect(sharedScreenForMessage('42')).toBeUndefined();
    forgetSharedScreen('41');
    expect(sharedScreenForMessage('41')).toBeUndefined();
  });

  it('is dropped after ten minutes, in case the turn never reached its end', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
    rememberSharedScreen('41', page);
    vi.setSystemTime(new Date('2026-11-16T10:09:00Z'));
    expect(sharedScreenForMessage('41')).toEqual(page);
    vi.setSystemTime(new Date('2026-11-16T10:11:00Z'));
    expect(sharedScreenForMessage('41')).toBeUndefined();
  });

  it('keeps at most 32 pages and drops the oldest first', () => {
    for (let id = 41; id <= 73; id += 1) rememberSharedScreen(String(id), page);
    expect(sharedScreenForMessage('41')).toBeUndefined();
    expect(sharedScreenForMessage('42')).toEqual(page);
    expect(sharedScreenForMessage('73')).toEqual(page);
    rememberSharedScreen('73', { screenDescription: 'Again.' });
    expect(sharedScreenForMessage('42')).toEqual(page);
  });
});

describe('the tool dispatcher hands the shared page only to the PI agent\'s own calls of that turn', () => {
  const probe: JarvisTool = {
    name: 'probe_shared',
    description: 'Report the shared page the dispatcher put on the request. Keyword: probe.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, request) => ({ required: request.requireSharedScreenContext ?? false, shared: request.sharedScreenContext ?? null }),
  };

  function setup() {
    const auth = createPiAuth(config.auth.tenantId, 'A'.repeat(43));
    const app = buildApp(config, undefined, {
      modules: [coreModule, { id: 'probe', tools: [probe], registerRoutes: async () => {} }],
      auth: async (token) => {
        if (token !== ownerToken) throw new Error('rejected');
        return { objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' };
      },
      toolCallStore: { record: async () => {} },
      piAuth: auth,
    });
    apps.push(app);
    const call = async (headers: Record<string, string>) => {
      const response = await app.inject({
        method: 'POST', url: '/tools/probe_shared', payload: {}, headers: { 'content-type': 'application/json', ...headers },
      });
      return { status: response.statusCode, body: response.json() as { outcome?: string; result?: { required: boolean; shared: unknown } } };
    };
    return {
      asPi: (message: string, pi: 'turn' | 'wake' = 'turn') =>
        call({ authorization: bearer(auth.dispatch.token), 'x-jarvis-message-id': message, 'x-jarvis-pi': pi }),
      asOwner: (message: string, extra: Record<string, string> = {}) =>
        call({ authorization: bearer(ownerToken), 'x-jarvis-message-id': message, ...extra }),
    };
  }
  const nothing = { outcome: 'ok', result: { required: false, shared: null } };

  it('carries the page of the turn to the PI tool call for that message', async () => {
    const { asPi } = setup();
    rememberSharedScreen('42', page);
    expect((await asPi('42')).body).toMatchObject({ outcome: 'ok', result: { required: true, shared: page } });
  });

  it('does not carry it to a call for another message, to a wake, or to an owner call that names the same message', async () => {
    const { asPi, asOwner } = setup();
    rememberSharedScreen('42', page);
    expect((await asPi('43')).body).toMatchObject(nothing);
    expect((await asPi('42', 'wake')).body).toMatchObject(nothing);
    expect((await asOwner('42')).body).toMatchObject(nothing);
  });

  it('does not let a caller claim the PI role to get it', async () => {
    const { asOwner } = setup();
    rememberSharedScreen('42', page);
    expect((await asOwner('42', { 'x-jarvis-pi': 'turn' })).status).toBe(403);
  });
});

describe('the chat route keeps the page Dan shares for the turn of that message', () => {
  async function chatTurn(body: Record<string, unknown>) {
    const messages: ConversationMessage[] = [];
    const store = {
      getSession: async (id: string) => ({ id, channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null }),
      getMessageSessionId: async () => '7',
      addMessage: async (input: { sessionId: string; role: 'dan' | 'jarvis'; text: string; model: string | null }) => {
        const message = { id: String(messages.length + 41), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
        messages.push(message);
        return message;
      },
      getDanMessagesAfter: async () => [],
      getDanMessageIdBySourceItemId: async () => null,
      readRecentUserMessages: async () => [],
    } as unknown as ConversationStore;
    const seen: { messageId: string; page: SharedScreenContext | undefined }[] = [];
    const agent: ConversationAgent = {
      stream: async function* (input) { seen.push({ messageId: input.messageId, page: sharedScreenForMessage(input.messageId) }); yield 'Done.'; },
    };
    const app = buildApp(config, undefined, {
      modules: [createConversationModule()],
      auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
      conversationStore: store, piAgent: agent,
    });
    apps.push(app);
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/7/turns', payload: { text: 'Click the Search button on this page', ...body },
      headers: { authorization: bearer(ownerToken), 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    return seen;
  }

  it('has the page ready for the agent\'s tool calls while the turn runs, and forgets it when the turn ends', async () => {
    expect(await chatTurn({ sharedScreenContext: page })).toEqual([{ messageId: '41', page }]);
    expect(sharedScreenForMessage('41')).toBeUndefined();
  });

  it('keeps nothing for a turn that shared no page', async () => {
    expect(await chatTurn({})).toEqual([{ messageId: '41', page: undefined }]);
  });
});

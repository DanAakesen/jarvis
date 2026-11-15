import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createConversationModule } from '../core/conversation.js';
import type { ConversationAgent } from '../core/chat-agent.js';
import type { ConversationMessage, ConversationStore } from '../core/conversation-store.js';
import { PiGatewayError } from './errors.js';
import { createUnconfiguredPiAgent } from './gateway.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

function setup(options: { piAgent?: ConversationAgent; withPiAgentOption?: boolean } = {}) {
  const messages: ConversationMessage[] = [];
  const store = {
    getSession: async (id: string) => ({ id, channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null }),
    addMessage: async (input: { sessionId: string; role: 'dan' | 'jarvis'; text: string; model: string | null }) => {
      const message = { id: String(messages.length + 1), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
      messages.push(message);
      return message;
    },
    getDanMessagesAfter: async () => [],
    getDanMessageIdBySourceItemId: async () => null,
    readRecentUserMessages: async () => [],
  } as unknown as ConversationStore;
  const current: ConversationAgent = { stream: async function* () { yield 'from the current engine'; } };
  const app = buildApp(config, undefined, {
    modules: [createConversationModule()],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    conversationStore: store, conversationAgent: current,
    ...(options.piAgent ? { piAgent: options.piAgent } : {}),
  });
  apps.push(app);
  const turn = async (payload: Record<string, unknown>) => {
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/7/turns', payload,
      headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' },
    });
    const events = response.statusCode !== 200 ? [] : response.body.split('\n\n').filter(Boolean).map((frame) => ({
      name: /^event: (.*)$/mu.exec(frame)![1]!, data: JSON.parse(/^data: (.*)$/mu.exec(frame)![1]!) as Record<string, unknown>,
    }));
    return { status: response.statusCode, events };
  };
  return { turn, messages };
}

describe('PI test selector on the chat turn', () => {
  it('keeps the default path on the current engine', async () => {
    const { turn, messages } = setup({ piAgent: { stream: async function* () { yield 'from PI'; } } });
    const result = await turn({ text: 'hi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'delta', 'done']);
    expect(result.events[1]!.data.text).toBe('from the current engine');
    expect(messages.at(-1)).toMatchObject({ role: 'jarvis', model: null });
  });

  it('streams from PI only when the turn asks for it, and labels the saved reply', async () => {
    const seen: Array<{ messageId: string; sessionId?: string }> = [];
    const { turn, messages } = setup({
      piAgent: { stream: async function* (input) { seen.push({ messageId: input.messageId, ...(input.sessionId ? { sessionId: input.sessionId } : {}) }); yield 'from PI'; } },
    });
    const result = await turn({ text: 'hi', engine: 'pi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'delta', 'done']);
    expect(result.events[1]!.data.text).toBe('from PI');
    expect(seen).toEqual([{ messageId: '1', sessionId: '7' }]);
    expect(messages.at(-1)).toMatchObject({ role: 'jarvis', text: 'from PI', model: 'pi' });
  });

  it('ends a PI turn with PI\'s own honest error when PI is not set up, and never uses the current engine', async () => {
    const { turn, messages } = setup();
    const result = await turn({ text: 'hi', engine: 'pi' });
    expect(result.events.map((event) => event.name)).toEqual(['user', 'error']);
    expect(result.events[1]!.data).toMatchObject({ code: 'pi_not_configured', error: expect.stringContaining('No other engine was used') });
    expect(messages.filter((message) => message.role === 'jarvis')).toEqual([]);
  });

  it('passes a PI budget stop to the app as a coded, readable error', async () => {
    const { turn } = setup({
      // eslint-disable-next-line require-yield
      piAgent: { stream: async function* () { throw new PiGatewayError('pi_budget_exhausted', 'PI has used 250.00 of its 250 DKK monthly cap, so it stopped.'); } },
    });
    const result = await turn({ text: 'hi', engine: 'pi' });
    expect(result.events.at(-1)).toEqual({ name: 'error', data: { error: 'PI has used 250.00 of its 250 DKK monthly cap, so it stopped.', code: 'pi_budget_exhausted' } });
  });

  it('rejects any engine other than pi', async () => {
    const { turn } = setup();
    expect((await turn({ text: 'hi', engine: 'copilot' })).status).toBe(400);
  });

  it('exposes the unconfigured agent as an error, not as a reply', async () => {
    await expect(createUnconfiguredPiAgent().stream({ messageId: '1', text: 'x' }, 'a', new AbortController().signal)[Symbol.asyncIterator]().next())
      .rejects.toMatchObject({ code: 'pi_not_configured' });
  });
});

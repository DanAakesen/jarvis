import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { ConversationAgent, ConversationAgentChunk } from './chat-agent.js';
import { createConversationModule } from './conversation.js';
import type { ConversationMessage, ConversationStore } from './conversation-store.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function turn(chunks: ConversationAgentChunk[]) {
  const messages: ConversationMessage[] = [];
  const store = {
    getSession: async (id: string) => ({ id, channel: 'chat', language: 'en', startedAt: new Date(), endedAt: null }),
    getMessageSessionId: async () => '7',
    addMessage: async (input: { sessionId: string; role: 'dan' | 'jarvis'; text: string; model: string | null }) => {
      const message = { id: String(messages.length + 1), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model, at: new Date() };
      messages.push(message);
      return message;
    },
    getDanMessagesAfter: async () => [],
    getDanMessageIdBySourceItemId: async () => null,
    readRecentUserMessages: async () => [],
  } as unknown as ConversationStore;
  const agent: ConversationAgent = { stream: async function* () { yield* chunks; } };
  const app = buildApp(config, undefined, {
    modules: [createConversationModule()],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    conversationStore: store, piAgent: agent,
  });
  apps.push(app);
  const response = await app.inject({
    method: 'POST', url: '/conversation/sessions/7/turns', payload: { text: 'Look something up' },
    headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' },
  });
  const events = response.body.split('\n\n').filter(Boolean).map((frame) => ({
    name: /^event: (.*)$/mu.exec(frame)![1]!, data: JSON.parse(/^data: (.*)$/mu.exec(frame)![1]!) as Record<string, unknown>,
  }));
  return { events, reply: messages.find((message) => message.role === 'jarvis') };
}

describe('chat progress events', () => {
  it('moves streamed progress out of the reply, and a repeated or unmatched progress line never ends the turn', async () => {
    const { events, reply } = await turn([
      'Checking.', { type: 'acknowledgment', text: 'Checking.' },
      { type: 'acknowledgment', text: 'Checking.' },
      { type: 'commentary', text: 'Never streamed as reply text.' },
      'Done.',
    ]);
    expect(events.map((event) => event.name)).toEqual(expect.arrayContaining(['acknowledgment', 'commentary']));
    expect(events.filter((event) => event.name === 'acknowledgment')).toHaveLength(2);
    expect(events.some((event) => event.name === 'error')).toBe(false);
    expect(reply?.text).toBe('Done.');
  });
});

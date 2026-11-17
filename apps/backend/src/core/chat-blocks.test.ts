import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { ChatBlockBuffer, finalizeChatBlock, showInChatTool } from './chat-blocks.js';
import { createConversationModule } from './conversation.js';
import type { ConversationAgent } from './chat-agent.js';
import type { ConversationMessage, ConversationStore } from './conversation-store.js';
import { ToolRefusal } from './tool-registry.js';

const config = loadConfig({ STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' });
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

const forecastInput = {
  version: 1 as const,
  type: 'forecast' as const,
  title: 'Copenhagen · Fri 20 Nov',
  source: { label: 'Open-Meteo' },
  summary: 'Friday 20 November in Copenhagen: mostly cloudy, high 9 °C, low 5 °C.',
  data: { place: 'Copenhagen', date: '2026-11-20', conditions: 'Mostly cloudy', symbol: 'cloudy' as const, highC: 9, lowC: 5 },
};

function setup(agentTurn: (app: ReturnType<typeof buildApp>) => AsyncGenerator<string>, channel: 'chat' | 'voice' = 'chat') {
  const messages: (ConversationMessage & { blocks?: unknown })[] = [];
  const running: { app?: ReturnType<typeof buildApp> } = {};
  const store = {
    getSession: async (id: string) => ({ id, channel, language: 'en', startedAt: new Date(), endedAt: null }),
    getMessageSessionId: async () => '7',
    addMessage: async (input: { sessionId: string; role: 'dan' | 'jarvis'; text: string; model: string | null; blocks?: unknown }) => {
      const message = {
        id: String(messages.length + 1), sessionId: input.sessionId, role: input.role, text: input.text, model: input.model,
        at: new Date(), ...(input.blocks === undefined ? {} : { blocks: input.blocks }),
      };
      messages.push(message as ConversationMessage);
      return message;
    },
    getDanMessagesAfter: async () => [],
    getDanMessageIdBySourceItemId: async () => null,
    readRecentUserMessages: async () => [],
  } as unknown as ConversationStore;
  const agent: ConversationAgent = { stream: () => agentTurn(running.app!) };
  const app = buildApp(config, undefined, {
    modules: [createConversationModule()],
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId, displayName: 'Owner' }),
    conversationStore: store, conversationAgent: agent,
  });
  running.app = app;
  apps.push(app);
  const turn = async () => {
    const response = await app.inject({
      method: 'POST', url: '/conversation/sessions/7/turns', payload: { text: 'Friday in Copenhagen?' },
      headers: { authorization: 'Bearer a.b.c', 'content-type': 'application/json' },
    });
    return response.body.split('\n\n').filter(Boolean).map((frame) => ({
      name: /^event: (.*)$/mu.exec(frame)![1]!, data: JSON.parse(/^data: (.*)$/mu.exec(frame)![1]!) as Record<string, unknown>,
    }));
  };
  return { app, turn, messages };
}

function toolRequest(app: ReturnType<typeof buildApp>, headers: Record<string, string>) {
  return { server: app, headers, principal: null } as unknown as FastifyRequest;
}

describe('chat block buffer', () => {
  it('hands blocks over once and caps one reply', () => {
    const buffer = new ChatBlockBuffer();
    const block = finalizeChatBlock(forecastInput);
    for (let index = 0; index < 8; index += 1) expect(buffer.add('7', block)).toBe(true);
    expect(buffer.add('7', block)).toBe(false);
    expect(buffer.take('7')).toHaveLength(8);
    expect(buffer.take('7')).toEqual([]);
  });

  it('forgets blocks of a turn that never finished', () => {
    const buffer = new ChatBlockBuffer();
    buffer.add('7', finalizeChatBlock(forecastInput), 0);
    buffer.add('8', finalizeChatBlock(forecastInput), 16 * 60 * 1000);
    expect(buffer.take('7')).toEqual([]);
  });

  it('stamps an id and keeps a given issue time', () => {
    const stamped = finalizeChatBlock(forecastInput, new Date('2026-11-16T16:02:00.000Z'));
    expect(stamped.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(stamped.source.issuedAt).toBe('2026-11-16T16:02:00.000Z');
    const given = finalizeChatBlock({ ...forecastInput, source: { label: 'Open-Meteo', issuedAt: '2026-11-15T08:00:00Z' } });
    expect(given.source.issuedAt).toBe('2026-11-15T08:00:00Z');
  });
});

describe('show_in_chat', () => {
  it('queues a valid block for the reply of the calling turn', async () => {
    const { app } = setup(async function* () { yield 'unused'; });
    const result = await showInChatTool.execute(forecastInput, toolRequest(app, { 'x-jarvis-message-id': '1' }), new AbortController().signal);
    expect(result).toMatchObject({ blockId: expect.any(String) });
    expect(app.chatBlocks.take('7')).toHaveLength(1);
  });

  it('refuses a block that breaks the contract, in a voice session, and without a reply to attach to', async () => {
    const { app } = setup(async function* () { yield 'unused'; });
    const signal = new AbortController().signal;
    const bad = { ...forecastInput, data: { ...forecastInput.data, lowC: 30 } };
    await expect(showInChatTool.execute(bad, toolRequest(app, { 'x-jarvis-message-id': '1' }), signal)).rejects.toBeInstanceOf(ToolRefusal);
    await expect(showInChatTool.execute(forecastInput, toolRequest(app, {}), signal)).rejects.toThrow(/no chat reply/u);
    expect(app.chatBlocks.take('7')).toEqual([]);
  });

  it('refuses a spoken turn, which has no typed reply to hold a block, and points to the screen', async () => {
    const { app } = setup(async function* () { yield 'unused'; }, 'voice');
    await expect(showInChatTool.execute(forecastInput, toolRequest(app, { 'x-jarvis-message-id': '1' }), new AbortController().signal))
      .rejects.toThrow(/workspace_command/u);
    expect(app.chatBlocks.take('7')).toEqual([]);
  });
});

describe('chat turn with blocks', () => {
  it('saves the blocks in the assistant message and sends them with the reply', async () => {
    const { turn, messages } = setup(async function* (app) {
      app.chatBlocks.add('7', finalizeChatBlock(forecastInput));
      yield 'Here is Friday in Copenhagen.';
    });
    const events = await turn();
    const done = events.at(-1)!;
    expect(done.name).toBe('done');
    expect(done.data.blocks).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ role: 'jarvis', text: 'Here is Friday in Copenhagen.' });
    expect(messages.at(-1)!.blocks).toEqual(done.data.blocks);
  });

  it('leaves a reply without blocks alone and drops blocks of a failed turn', async () => {
    const first = setup(async function* () { yield 'Just text.'; });
    expect((await first.turn()).at(-1)!.data).not.toHaveProperty('blocks');
    // eslint-disable-next-line require-yield
    const failed = setup(async function* (app) { app.chatBlocks.add('7', finalizeChatBlock(forecastInput)); throw new Error('provider failed'); });
    expect((await failed.turn()).at(-1)!.name).toBe('error');
    expect(failed.app.chatBlocks.take('7')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { ConversationMessage } from './conversation-store.js';
import { readAttachedOwnerMessage } from './owner-message.js';

describe('attached owner message authority', () => {
  it('resolves the exact owner message even when a proactive assistant message is newer', async () => {
    const owner = {
      id: '42', sessionId: '7', role: 'dan', text: 'Create the task.', model: null,
      at: new Date('2026-11-20T04:00:00Z'),
    } satisfies ConversationMessage;
    const proactive = {
      id: '43', sessionId: '7', role: 'jarvis', text: 'A proactive message arrived.', model: 'pi',
      at: new Date('2026-11-20T04:00:01Z'),
    } satisfies ConversationMessage;
    const request = {
      agentPrincipal: { objectId: 'agent' },
      headers: { 'x-jarvis-message-id': owner.id },
      server: {
        conversationStore: {
          getHistory: async ({ before }: { before?: string }) => ({
            messages: [owner, proactive].filter(message => before === undefined || BigInt(message.id) < BigInt(before)),
            nextCursor: null,
          }),
        },
      },
    } as unknown as FastifyRequest;

    await expect(readAttachedOwnerMessage(request, new AbortController().signal)).resolves.toEqual(owner);
  });

  it('does not turn a stored assistant message into owner authority', async () => {
    const assistant = {
      id: '43', sessionId: '7', role: 'jarvis', text: 'Not Dan.', model: 'pi',
      at: new Date('2026-11-20T04:00:01Z'),
    } satisfies ConversationMessage;
    const request = {
      agentPrincipal: { objectId: 'agent' },
      headers: { 'x-jarvis-message-id': assistant.id },
      server: {
        conversationStore: {
          getHistory: async () => ({ messages: [assistant], nextCursor: null }),
        },
      },
    } as unknown as FastifyRequest;
    await expect(readAttachedOwnerMessage(request, new AbortController().signal)).resolves.toBeUndefined();
  });
});

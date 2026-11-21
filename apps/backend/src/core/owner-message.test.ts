import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { currentHealthMessage } from '../health/tools/context.js';
import type { ConversationMessage } from './conversation-store.js';
import { readAttachedOwnerMessage } from './owner-message.js';

const owner = {
  id: '42', sessionId: '7', role: 'dan', text: 'Create the task.', model: null,
  at: new Date('2026-11-20T04:00:00Z'),
} satisfies ConversationMessage;
const proactive = {
  id: '43', sessionId: '7', role: 'jarvis', text: 'A proactive message arrived.', model: 'pi',
  at: new Date('2026-11-20T04:00:01Z'),
} satisfies ConversationMessage;

function piRequest(messageId: string, stored: ConversationMessage[]): FastifyRequest {
  return {
    agentPrincipal: { objectId: 'agent' },
    headers: { 'x-jarvis-message-id': messageId },
    server: {
      conversationStore: {
        getHistory: async ({ before }: { before?: string }) => ({
          messages: stored.filter(message => before === undefined || BigInt(message.id) < BigInt(before)),
          nextCursor: null,
        }),
      },
    },
  } as unknown as FastifyRequest;
}

describe('attached owner message authority', () => {
  it('resolves the exact owner message even when a proactive assistant message is newer', async () => {
    const request = piRequest(owner.id, [owner, proactive]);
    await expect(readAttachedOwnerMessage(request, new AbortController().signal)).resolves.toEqual(owner);
  });

  it('keeps an existing guard working when a proactive message arrives mid-turn', async () => {
    const request = piRequest(owner.id, [owner, proactive]);
    await expect(currentHealthMessage(request, new AbortController().signal)).resolves.toEqual(owner);
  });

  it('does not turn a stored assistant message into owner authority', async () => {
    const request = piRequest(proactive.id, [owner, proactive]);
    await expect(readAttachedOwnerMessage(request, new AbortController().signal)).resolves.toBeUndefined();
    await expect(currentHealthMessage(request, new AbortController().signal)).rejects.toThrow();
  });

  it('stays bound to the attached owner message when a newer owner message exists', async () => {
    const newer = { ...owner, id: '44', text: 'Something else.' } satisfies ConversationMessage;
    const request = piRequest(owner.id, [owner, newer]);
    await expect(readAttachedOwnerMessage(request, new AbortController().signal)).resolves.toEqual(owner);
  });
});

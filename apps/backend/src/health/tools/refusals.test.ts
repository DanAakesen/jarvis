import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '../../core/conversation-store.js';
import { activeHealthSession } from './context.js';
import { foodReceipt } from './food.js';
import { healthFoodReviewTool } from './food-review.js';
import { healthSavedFoodTool } from './saved-food.js';

const owner = '11111111-1111-4111-8111-111111111111';
const clock = Date.parse('2026-11-21T12:00:00Z');
const signal = () => new AbortController().signal;
const message = { id: '42', sessionId: '7', role: 'dan', text: 'Delete my plan', model: null, at: new Date(clock - 60_000) } as ConversationMessage;
const agent = { agentPrincipal: { kind: 'jarvis-agent' }, server: { ownerObjectId: owner } } as unknown as FastifyRequest;
const browser = {
  principal: { objectId: owner }, jarvisConversationMessage: message,
  server: {
    ownerObjectId: owner,
    conversationStore: {
      getHistory: async () => ({ messages: [message], nextCursor: null }),
      getSession: async () => ({ id: '7', channel: 'chat', endedAt: null }),
    },
  },
} as unknown as FastifyRequest;

describe('Health refusals say what to do', () => {
  it('names the 10 minute limit on the message behind a change', async () => {
    const old = { ...message, at: new Date(clock - 11 * 60_000) };
    await expect(activeHealthSession({} as FastifyRequest, old, signal(), clock)).rejects.toThrow('within the last 10 minutes');
  });

  it('explains that one message logs one intake', () => {
    const row = {
      id: 'meal-1', idempotency_key: 'jarvis-message:abc', revision: '1', deleted_at: null,
      nutrient_provenance_json: JSON.stringify({ jarvisIntake: { sourceFingerprint: 'earlier', operation: 'log_exact' } }),
    };
    expect(() => foodReceipt(row, 'jarvis-message:abc', 'now', 'log_exact')).toThrow('one message logs one intake');
  });

  it('lists what each food review operation takes', async () => {
    const review = healthFoodReviewTool((() => ({})) as never);
    await expect(review.execute({ change: { operation: 'log_estimate' } }, agent, signal()))
      .rejects.toThrow('log_estimate (food: mealName plus energyKcal or referenceComponents), lookup_components (components)');
  });

  it('lists what each saved food operation takes', async () => {
    const saved = healthSavedFoodTool((() => ({})) as never, () => clock);
    await expect(saved.execute({ operation: 'save_favorite', owner: 'someone' }, agent, signal())).rejects.toThrow('Send operation as lookup_saved (name)');
    await expect(saved.execute({ operation: 'read_preferences' }, agent, signal())).rejects.toThrow('read_preferences takes only favoriteIds');
    await expect(saved.execute({ operation: 'delete_plan' }, browser, signal())).rejects.toThrow('delete_plan needs id and expectedRevision');
  });
});

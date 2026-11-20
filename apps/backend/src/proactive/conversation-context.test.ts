import { describe, expect, it } from 'vitest';
import { createProactiveConversationContext } from './conversation-context.js';

const owner = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-20T10:00:00.000Z');

describe('proactive conversation context', () => {
  it('gives Chat and Voice the exact outgoing suggestion, evidence and follow-up IDs', async () => {
    const context = createProactiveConversationContext(
      owner,
      { async get() { return undefined; } },
      { async read() { return undefined; }, async select() {} },
      {
        async latestProactiveMessage() {
          return {
            ownerObjectId: owner,
            runId: '00000000-0000-4000-8000-000000000001',
            sessionId: '7',
            messageId: '42',
            textHash: 'a'.repeat(64),
            text: 'I can update the departure reminder. Want me to do that?',
            evidence: [{
              source: 'calendar',
              ref: 'calendar-event:42',
              identity: 'calendar-event:42',
              label: 'Flight to London',
              observedAt: '2026-11-20T08:00:00.000Z',
            }],
            followUpIds: ['follow:flight'],
            at: new Date('2026-11-20T09:55:00.000Z'),
          };
        },
      },
      () => now,
    );
    const text = await context.read(owner);
    expect(text).toContain('I can update the departure reminder.');
    expect(text).toContain('calendar-event:42');
    expect(text).toContain('follow:flight');
    expect(text).toContain('do that');
    expect(text).toContain('"sessionId":"7"');
    expect(text).toContain('"messageId":"42"');
  });

  it('does not relay old delivery context or another owner\'s context', async () => {
    const context = createProactiveConversationContext(
      owner,
      { async get() { return undefined; } },
      { async read() { return undefined; }, async select() {} },
      { async latestProactiveMessage() { return undefined; } },
      () => now,
    );
    await expect(context.read('22222222-2222-4222-8222-222222222222')).resolves.toBeUndefined();
    await expect(context.read(owner)).resolves.toBeUndefined();
  });
});

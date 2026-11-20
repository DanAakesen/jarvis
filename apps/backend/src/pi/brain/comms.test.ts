import { describe, expect, it } from 'vitest';
import { createMemoryPiStore } from '../store.js';
import { memoryConversations } from './brain.testkit.js';
import { BrainCommsRefusal, MAX_BRAIN_MESSAGES_PER_DAY, createBrainComms } from './comms.js';

const signal = new AbortController().signal;
const run = () => ({ runId: 'r1', sent: [] as { title: string | null; text: string; messageId: string }[], wrote: [] as string[], looked: [] as string[] });

function setup(options: { empty?: boolean; announce?: () => void; pushEnabled?: boolean } = {}) {
  const now = () => new Date('2026-11-16T10:00:00Z');
  const conversations = memoryConversations(options.empty === true ? { empty: true } : {});
  const store = createMemoryPiStore(now);
  const pushes: unknown[] = [];
  const comms = createBrainComms({
    conversations: conversations.store, store, ownerObjectId: 'o',
    pushEnabled: options.pushEnabled,
    push: (message) => pushes.push(message), announce: options.announce ?? (() => {}), now,
  });
  return { comms, conversations, store, pushes };
}

describe('the brain\'s chat message', () => {
  it('is stored in the owner\'s chat feed, announced to an open app, and pushed exactly once', async () => {
    let announced = 0;
    const { comms, conversations, pushes, store } = setup({ announce: () => { announced += 1; } });
    const r = run();
    const sent = await comms.send({
      text: '  The deploy failed.  ',
      evidence: { category: 'technical', evidenceSources: ['factory'] },
    }, r, signal);
    expect(sent).toEqual({ messageId: '2', sessionId: '7' });
    expect(conversations.messages.at(-1)).toMatchObject({ role: 'jarvis', model: 'pi', text: 'The deploy failed.' });
    expect(pushes).toEqual([{ sessionId: '7', messageId: '2', text: 'The deploy failed.' }]);
    expect(conversations.addMessageInputs.at(-1)?.replyNotification?.evidence).toEqual({
      category: 'technical',
      evidenceSources: ['factory'],
    });
    expect(announced).toBe(1);
    expect(r.sent).toHaveLength(1);
    expect((await store.messagesSince(new Date('2026-11-16T00:00:00Z'), signal)).count).toBe(1);
  });

  it('opens a chat session when the owner has none yet', async () => {
    const { comms, conversations } = setup({ empty: true });
    await comms.send({ text: 'Hello.' }, run(), signal);
    expect(conversations.sessions).toHaveLength(1);
    expect(conversations.messages).toHaveLength(1);
  });

  it('does not create a dormant outbox or push callback when native delivery is disabled', async () => {
    const { comms, conversations, pushes } = setup({ pushEnabled: false });
    await comms.send({ text: 'Stored, without APNs.' }, run(), signal);
    expect(conversations.addMessageInputs.at(-1)?.replyNotification).toBeUndefined();
    expect(pushes).toEqual([]);
  });

  it('persists exact outgoing evidence and pending follow-ups with the chat IDs', async () => {
    const { comms, store } = setup();
    await comms.send({
      text: 'Would you like me to move the departure reminder?',
      evidence: [{
        source: 'calendar',
        ref: 'calendar-event:42',
        identity: 'calendar-event:42',
        label: 'Flight to London',
        observedAt: '2026-11-16T09:00:00.000Z',
      }],
      followUpIds: ['follow:flight'],
    }, run(), signal);
    expect(await store.latestProactiveMessage(
      'o',
      new Date('2026-11-16T00:00:00.000Z'),
      signal,
    )).toMatchObject({
      sessionId: '7',
      messageId: '2',
      text: 'Would you like me to move the departure reminder?',
      evidence: [expect.objectContaining({ ref: 'calendar-event:42' })],
      followUpIds: ['follow:flight'],
    });
  });

  it('refuses an empty, over-long, credential-like or repeated message, and sends nothing', async () => {
    const { comms, pushes } = setup();
    await expect(comms.send({ text: '   ' }, run(), signal)).rejects.toBeInstanceOf(BrainCommsRefusal);
    await expect(comms.send({ text: 'x'.repeat(1501) }, run(), signal)).rejects.toThrow('longer than');
    await expect(comms.send({ text: 'the key is ghp_' + 'A'.repeat(36) }, run(), signal)).rejects.toThrow('Secrets');
    await comms.send({ text: 'Same news.' }, run(), signal);
    await expect(comms.send({ text: ' same   NEWS. ' }, run(), signal)).rejects.toThrow('already told');
    expect(pushes).toHaveLength(1);
  });

  it('stops at the daily limit, which is the only cap: every message that is sent pushes', async () => {
    const { comms, pushes } = setup();
    for (let n = 0; n < MAX_BRAIN_MESSAGES_PER_DAY; n += 1) await comms.send({ text: `News ${n}.` }, run(), signal);
    await expect(comms.send({ text: 'One more.' }, run(), signal)).rejects.toThrow('limit');
    expect(pushes).toHaveLength(MAX_BRAIN_MESSAGES_PER_DAY);
  });

  it('admits parallel sends one at a time, so neither the daily limit nor the repeat check can be passed by racing', async () => {
    const { comms, pushes } = setup();
    const same = await Promise.allSettled(Array.from({ length: 10 }, () => comms.send({ text: 'Same news.' }, run(), signal)));
    expect(same.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const many = await Promise.allSettled(Array.from({ length: 20 }, (_, n) => comms.send({ text: `Different ${n}.` }, run(), signal)));
    expect(many.filter((result) => result.status === 'fulfilled')).toHaveLength(MAX_BRAIN_MESSAGES_PER_DAY - 1);
    expect(pushes).toHaveLength(MAX_BRAIN_MESSAGES_PER_DAY);
  });

  it('does not push a message the chat could not store', async () => {
    const { comms, conversations, pushes } = setup();
    (conversations.store as { addMessage: () => Promise<null> }).addMessage = async () => null;
    await expect(comms.send({ text: 'Lost.' }, run(), signal)).rejects.toThrow('could not store');
    expect(pushes).toEqual([]);
  });

  it('does not push when the durable continuation receipt fails', async () => {
    const { comms, store, pushes } = setup();
    (store as { recordMessage: unknown }).recordMessage = async () => { throw new Error('sql down'); };
    await expect(comms.send({ text: 'Saved but not attested.' }, run(), signal))
      .rejects.toThrow('no push was sent');
    expect(pushes).toEqual([]);
  });
});

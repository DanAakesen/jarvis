import { describe, expect, it } from 'vitest';
import { failureCopy } from '@jarvis/contracts';
import { RecoverableChat } from './recoverable-chat.js';

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const user = frame('user', { id: '42' });
const done = frame('done', { id: '43', text: 'Hello' });

async function* frames(...values: string[]): AsyncGenerator<string> { for (const value of values) yield value; }

async function replay(chat: RecoverableChat): Promise<string> {
  let text = '';
  for await (const chunk of chat.stream()) text += String(chunk);
  return text;
}

describe('RecoverableChat', () => {
  it('replays a finished turn in order', async () => {
    const chat = new RecoverableChat('7', '42');
    await chat.run(frames(user, frame('delta', { text: 'Hel' }), done));
    expect(await replay(chat)).toBe(`${user}${frame('delta', { text: 'Hel' })}${done}`);
  });

  it('never follows a saved reply with an error, so the turn cannot be called failed afterwards', async () => {
    const chat = new RecoverableChat('7', '42');
    await chat.run(frames(user, done, frame('error', { error: 'late' })));
    const text = await replay(chat);
    expect(text).toContain('event: done');
    expect(text).not.toContain('event: error');
  });

  it('adds no interruption error when the source fails after the saved reply', async () => {
    const chat = new RecoverableChat('7', '42');
    async function* source(): AsyncGenerator<string> { yield user; yield done; throw new Error('late failure'); }
    await expect(chat.run(source())).rejects.toThrow('late failure');
    expect(await replay(chat)).not.toContain('event: error');
  });

  it('still reports a failure that happens before the reply, in plain words', async () => {
    const chat = new RecoverableChat('7', '42');
    async function* source(): AsyncGenerator<string> { yield user; throw new Error('boom'); }
    await expect(chat.run(source())).rejects.toThrow('boom');
    const text = await replay(chat);
    expect(text).toContain(frame('error', { error: failureCopy.cut_off.chat }));
    expect(text).not.toContain('boom');
  });

  it('stops a turn that overflows the replay before its reply, with a plain error', async () => {
    const chat = new RecoverableChat('7', '42');
    const big = frame('delta', { text: 'x'.repeat(600 * 1024) });
    await chat.run(frames(user, big, big, done));
    const text = await replay(chat);
    expect(chat.controller.signal.aborted).toBe(true);
    expect(text).toContain(frame('error', { error: failureCopy.reply_too_long.chat }));
    expect(text).not.toContain('event: done');
  });

  it('always keeps the done frame of a saved reply, even when the replay is already full', async () => {
    const chat = new RecoverableChat('7', '42');
    const nearlyFull = frame('delta', { text: 'x'.repeat(900 * 1024) });
    const reply = frame('done', { id: '43', text: 'y'.repeat(300 * 1024) });
    await chat.run(frames(user, nearlyFull, reply));
    const text = await replay(chat);
    expect(chat.controller.signal.aborted).toBe(false);
    expect(text).toContain('event: done');
    expect(text).not.toContain('event: error');
  });
});

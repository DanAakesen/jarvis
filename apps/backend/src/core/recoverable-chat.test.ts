import { describe, expect, it, vi } from 'vitest';
import { RecoverableChat } from './recoverable-chat.js';

describe('recoverable chat transport', () => {
  it('continues execution after disconnect and replays completion without invoking it again', async () => {
    const finish = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const turn = new RecoverableChat('41', '42', 'en');
    let writes = 0;
    const run = turn.run((async function* () {
      yield 'before';
      started.resolve();
      await finish.promise;
      writes++;
      yield 'after';
    })());
    await started.promise;
    const first = turn.stream();
    first.destroy();
    expect(turn.controller.signal.aborted).toBe(false);
    finish.resolve();
    await run;
    for (let i = 0; i < 2; i++) {
      let replay = '';
      for await (const chunk of turn.stream()) replay += chunk.toString();
      expect(replay).toBe('beforeafter');
    }
    expect(writes).toBe(1);
  });

  it('makes an unexpected producer failure recoverable without exposing diagnostics', async () => {
    const turn = new RecoverableChat('41', '42', 'en');
    await expect(turn.run((async function* () {
      yield 'partial';
      throw new Error('private diagnostics');
    })())).rejects.toThrow('private diagnostics');
    let replay = '';
    for await (const chunk of turn.stream()) replay += chunk.toString();
    expect(replay).toContain('event: error');
    expect(replay).not.toContain('private diagnostics');
  });

  it('bounds retained output and stops the execution on overflow', async () => {
    const turn = new RecoverableChat('41', '42', 'en');
    await turn.run((async function* () { yield 'x'.repeat(1024 * 1024 + 1); })());
    expect(turn.controller.signal.aborted).toBe(true);
    let replay = '';
    for await (const chunk of turn.stream()) replay += chunk.toString();
    expect(replay).toContain('recovery limit');
    expect(replay.length).toBeLessThan(300);
  });
});


it('keeps idle subscribers connected without retaining heartbeat comments or cancelling work', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const finish = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const turn = new RecoverableChat('41', '42', 'en');
    const run = turn.run((async function* () {
      yield 'start'; started.resolve(); await finish.promise; yield 'end';
    })());
    await started.promise;
    const live = turn.stream();
    const chunks: string[] = [];
    live.on('data', chunk => chunks.push(String(chunk)));
    await vi.advanceTimersByTimeAsync(16 * 60_000);
    expect(chunks.join('')).toContain(': keepalive');
    expect(turn.finished).toBe(false);
    expect(turn.controller.signal.aborted).toBe(false);
    turn.publish('tool progress');
    finish.resolve();
    await run;
    let replay = '';
    for await (const chunk of turn.stream()) replay += String(chunk);
    expect(replay).toBe('starttool progressend');
    expect(turn.publish('late event')).toBe(false);
    live.destroy();
  } finally { vi.useRealTimers(); }
});

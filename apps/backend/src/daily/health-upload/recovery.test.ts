import { expect,it,vi } from 'vitest';
import { HealthOutboxRecovery } from './recovery.js';
import { readHealthHostConfig } from './host-config.js';

const config = { ...readHealthHostConfig({}),enabled: true,recoveryEnabled: true,recoveryIntervalMs: 1000,recoveryDeadlineMs: 20 };
it('bounds retry backoff, sanitizes errors, and restores cadence after success',async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('synthetic-private-marker')).mockResolvedValue({ ownership: 'owned',inspected: 1,queued: 1,failed: 0,hasMore: false });
  const worker = new HealthOutboxRecovery(config,{ recoverOwnedPage: read });
  expect(await worker.once()).toMatchObject({ outcome: 'error',nextDelayMs: 2000 });
  expect(JSON.stringify(worker.status())).not.toContain('synthetic-private-marker');
  expect(await worker.once()).toMatchObject({ outcome: 'complete',nextDelayMs: 1000,attempts: 2,queued: 1 });
  await worker.stop();
});
it('propagates a batch deadline and cancels/waits for active recovery during shutdown',async () => {
  const read = vi.fn(async (_options,signal: AbortSignal) => {
    await new Promise((_,reject) => signal.addEventListener('abort',() => reject(new Error('synthetic-private-marker')),{ once: true }));
    return { ownership: 'owned' as const,inspected: 0,queued: 0,failed: 0,hasMore: false };
  });
  const worker = new HealthOutboxRecovery(config,{ recoverOwnedPage: read });
  expect(await worker.once()).toMatchObject({ outcome: 'timeout',nextDelayMs: 2000 });
  const active = worker.once(); expect(() => worker.once()).toThrow('Recovery not available'); expect(() => worker.start()).toThrow();
  await worker.stop(); expect(await active).toMatchObject({ outcome: 'canceled',state: 'stopped' });
  expect(JSON.stringify(worker.status())).not.toContain('synthetic-private-marker');
});
it('does not run disabled recovery or overlap a background loop',async () => {
  const read = vi.fn(async () => ({ ownership: 'busy' as const,inspected: 0,queued: 0,failed: 0,hasMore: null }));
  const disabled = new HealthOutboxRecovery(readHealthHostConfig({}),{ recoverOwnedPage: read }); disabled.start();
  expect(read).not.toHaveBeenCalled(); expect(() => disabled.once()).toThrow(); await disabled.stop();
  const worker = new HealthOutboxRecovery(config,{ recoverOwnedPage: read }); worker.start(); expect(() => worker.start()).toThrow();
  await worker.stop(); expect(read).toHaveBeenCalledTimes(1);
});

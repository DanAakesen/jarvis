import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOwnerSessionBootRevoke } from './boot-revoke.js';

const ownerObjectId = '00000000-0000-4000-8000-000000000001';
const at = new Date('2026-10-23T02:30:00.000Z');

describe('owner session boot revoke', () => {
  afterEach(() => vi.useRealTimers());

  it('revokes once in the background when disabled with SQL and an owner', async () => {
    vi.useFakeTimers();
    const revokeAll = vi.fn(async () => 2);
    const log = vi.fn();
    startOwnerSessionBootRevoke({
      enabled: false,
      store: { revokeAll },
      ownerObjectId,
      now: () => at,
      log,
    });

    expect(revokeAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(revokeAll).toHaveBeenCalledExactlyOnceWith(ownerObjectId, at);
    expect(log).toHaveBeenCalledExactlyOnceWith({ outcome: 'revoked', count: 2 });
  });

  it('does not revoke when the switch is on', () => {
    const revokeAll = vi.fn(async () => 0);
    const log = vi.fn();
    startOwnerSessionBootRevoke({ enabled: true, store: { revokeAll }, ownerObjectId, log });
    expect(revokeAll).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith({ outcome: 'skipped' });
  });

  it('does not revoke without SQL or an owner', () => {
    const log = vi.fn();
    startOwnerSessionBootRevoke({ enabled: false, ownerObjectId, log });
    startOwnerSessionBootRevoke({ enabled: false, store: { revokeAll: vi.fn() }, log });
    expect(log).toHaveBeenNthCalledWith(1, { outcome: 'skipped' });
    expect(log).toHaveBeenNthCalledWith(2, { outcome: 'skipped' });
  });

  it('swallows failures and reports only an allow-listed outcome', async () => {
    const error = Object.assign(new Error('synthetic secret marker'), { token: 'synthetic token marker' });
    const log = vi.fn();
    startOwnerSessionBootRevoke({
      enabled: false,
      store: { revokeAll: vi.fn().mockRejectedValue(error) },
      ownerObjectId,
      log,
    });
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    expect(log).toHaveBeenCalledExactlyOnceWith({ outcome: 'failed' });
  });

  it('reports a missing owner_sessions table without exposing the SQL error', async () => {
    const error = Object.assign(new Error('synthetic database detail'), { number: 208 });
    const log = vi.fn();
    startOwnerSessionBootRevoke({
      enabled: false,
      store: { revokeAll: vi.fn().mockRejectedValue(error) },
      ownerObjectId,
      log,
    });
    await vi.waitFor(() => expect(log).toHaveBeenCalled());
    expect(log).toHaveBeenCalledExactlyOnceWith({ outcome: 'table_missing' });
  });

  it('does not wait for a store that never resolves and logs its timeout', async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const started = startOwnerSessionBootRevoke({
      enabled: false,
      store: { revokeAll: () => new Promise<number>(() => undefined) },
      ownerObjectId,
      log,
    });

    expect(started).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log).toHaveBeenCalledExactlyOnceWith({ outcome: 'failed' });
  });
});

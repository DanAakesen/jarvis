import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../config.js';
import { InMemoryOwnerSessionStore } from './memory-store.js';
import { OwnerSessionConnectionRegistry } from './connections.js';
import { OwnerSessionService } from './service.js';

const owner = '11111111-1111-4111-8111-111111111111';
const start = Date.parse('2026-10-22T12:00:00.000Z');
const fiveMinutes = 5 * 60_000;
const tenDays = 10 * 24 * 60 * 60_000;

function setup() {
  let now = start;
  const store = new InMemoryOwnerSessionStore();
  const service = new OwnerSessionService({
    store,
    ownerObjectId: owner,
    tenantId: '22222222-2222-4222-8222-222222222222',
    now: () => new Date(now),
  });
  const registry = new OwnerSessionConnectionRegistry({ verifier: service, random: () => 0.5 });
  return {
    store,
    service,
    registry,
    setNow: (value: number) => { now = value; },
    open: () => service.create({ ownerObjectId: owner, displayName: 'Test Owner', deviceLabel: null }),
    tick: () => vi.advanceTimersByTimeAsync(fiveMinutes),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('owner session connection registry', () => {
  it('closes only connections for the revoked session', async () => {
    vi.useFakeTimers();
    const { registry, open } = setup();
    const first = await open();
    const second = await open();
    const closeFirst = vi.fn();
    const closeFirstAgain = vi.fn();
    const closeSecond = vi.fn();
    registry.register(first.sessionId, closeFirst);
    registry.register(first.sessionId, closeFirstAgain);
    registry.register(second.sessionId, closeSecond);

    registry.closeSession(first.sessionId);

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeFirstAgain).toHaveBeenCalledOnce();
    expect(closeSecond).not.toHaveBeenCalled();
    registry.close();
  });

  it('closes every registered session connection', async () => {
    vi.useFakeTimers();
    const { registry, open } = setup();
    const first = await open();
    const second = await open();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    registry.register(first.sessionId, closeFirst);
    registry.register(second.sessionId, closeSecond);

    registry.closeAll();

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(closeSecond).toHaveBeenCalledOnce();
    registry.close();
  });

  it.each(['revoked', 'expired', 'unknown'] as const)('closes a connection on a definite %s verdict', async (verdict) => {
    vi.useFakeTimers();
    const { store, registry, open, setNow, tick } = setup();
    const session = await open();
    const close = vi.fn();
    const sessionId = verdict === 'unknown' ? 'AAAAAAAAAAAAAAAAAAAAAA' : session.sessionId;
    registry.register(sessionId, close);
    if (verdict === 'revoked') await store.revoke(owner, session.sessionId, new Date(start));
    if (verdict === 'expired') setNow(start + tenDays);

    await tick();

    expect(close).toHaveBeenCalledOnce();
    registry.close();
  });

  it('keeps connections on store failure and checks once per distinct healthy session on the next tick', async () => {
    vi.useFakeTimers();
    const { registry, open, store, tick } = setup();
    const session = await open();
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    const find = vi.spyOn(store, 'find');
    registry.register(session.sessionId, closeFirst);
    registry.register(session.sessionId, closeSecond);
    find.mockRejectedValueOnce(new Error('store unavailable'));

    await tick();

    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledOnce();

    await tick();

    expect(closeFirst).not.toHaveBeenCalled();
    expect(closeSecond).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledTimes(2);
    registry.close();
  });

  it('clears its unref timer when closed', async () => {
    vi.useFakeTimers();
    const { registry, open } = setup();
    const session = await open();
    registry.register(session.sessionId, vi.fn());
    expect(vi.getTimerCount()).toBe(1);

    registry.close();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the registry timer when the server closes', async () => {
    vi.useFakeTimers();
    const { service, open } = setup();
    const app = buildApp(
      { ...loadConfig({ JARVIS_OWNER_SESSION_ENABLED: 'true' }), logLevel: 'silent' },
      undefined,
      { ownerSessions: service },
    );
    await app.ready();
    const session = await open();
    app.ownerSessionConnections!.register(session.sessionId, vi.fn());
    expect(vi.getTimerCount()).toBe(1);

    await app.close();

    expect(vi.getTimerCount()).toBe(0);
  });
});

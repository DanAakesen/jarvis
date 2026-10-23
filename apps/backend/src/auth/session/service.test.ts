import { describe, expect, it, vi } from 'vitest';
import { ownerSessionPolicy } from './config.js';
import { InMemoryOwnerSessionStore } from './memory-store.js';
import {
  OwnerSessionService, OwnerSessionThrottled, OwnerSessionUnavailable, type CreatedOwnerSession,
  type OwnerSessionServiceOptions,
} from './service.js';
import type { OwnerSessionStore } from './store.js';
import { generateOwnerSessionCredential, hashOwnerSessionSecret, parseOwnerSessionToken } from './token.js';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '33333333-3333-4333-8333-333333333333';
const tenant = '22222222-2222-4222-8222-222222222222';
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const start = Date.parse('2026-10-22T12:00:00.000Z');

function setup(options: Partial<OwnerSessionServiceOptions> = {}) {
  let current = start;
  const store = new InMemoryOwnerSessionStore();
  const service = new OwnerSessionService({
    store, ownerObjectId: owner.toUpperCase(), tenantId: tenant, now: () => new Date(current), ...options,
  });
  return {
    store,
    service,
    advance: (ms: number) => { current += ms; },
    open: (overrides: { ownerObjectId?: string; deviceLabel?: string | null } = {}) =>
      service.create({ ownerObjectId: owner, displayName: 'Test Owner', deviceLabel: 'Laptop', ...overrides }),
  };
}

function failingStore(error: Error): OwnerSessionStore {
  return {
    create: vi.fn().mockRejectedValue(error),
    find: vi.fn().mockRejectedValue(error),
    touch: vi.fn().mockRejectedValue(error),
    revoke: vi.fn().mockRejectedValue(error),
    revokeAll: vi.fn().mockRejectedValue(error),
  };
}

describe('owner session service', () => {
  describe('creating a session', () => {
    it('issues a token that lasts 10 days of idle time and never more than 30 days', async () => {
      const { open } = setup();
      const created = await open();
      expect(created.idleExpiresAt).toEqual(new Date(start + 10 * day));
      expect(created.absoluteExpiresAt).toEqual(new Date(start + 30 * day));
      expect(created.evicted).toBe(0);
      expect(parseOwnerSessionToken(created.token)).toEqual({
        sessionId: created.sessionId, secret: expect.any(String),
      });
      expect(created.prefix).toBe(created.sessionId.slice(0, 8));
    });

    it('stores a hash of the secret and never the secret or the token', async () => {
      const { open, store } = setup();
      const created = await open({ ownerObjectId: owner.toUpperCase() });
      const secret = parseOwnerSessionToken(created.token)!.secret;
      const record = (await store.find(created.sessionId))!;
      expect(record.secretHash).toEqual(hashOwnerSessionSecret(secret));
      expect(record.ownerObjectId).toBe(owner);
      expect(record).toMatchObject({ displayName: 'Test Owner', deviceLabel: 'Laptop', revokedAt: null });
      expect(Object.keys(record).sort()).toEqual([
        'absoluteExpiresAt', 'createdAt', 'deviceLabel', 'displayName', 'idleExpiresAt', 'lastUsedAt',
        'ownerObjectId', 'revokedAt', 'secretHash', 'sessionId',
      ]);
      expect(JSON.stringify(record)).not.toContain(secret);
    });

    it('purges sessions that died long ago', async () => {
      const { open, service, advance, store } = setup();
      const first = await open();
      await service.revokeCurrent(owner, first.sessionId);
      advance(ownerSessionPolicy.retentionAfterDeathMs + day);
      await open();
      expect(await store.find(first.sessionId)).toBeNull();
    });

    it('revokes the least recently used session once ten are active', async () => {
      const { open, advance, service } = setup();
      const created = [];
      for (let index = 0; index < 10; index += 1) {
        created.push(await open());
        advance(minute);
      }
      const eleventh = await open();
      expect(eleventh.evicted).toBe(1);
      expect(await service.verify(created[0]!.token)).toMatchObject({ ok: false, reason: 'revoked' });
      for (const session of [...created.slice(1), eleventh]) {
        expect(await service.verify(session.token)).toMatchObject({ ok: true });
      }
    });

    it('keeps a session that was used recently, whatever its age', async () => {
      const { open, advance, service } = setup();
      const created = [];
      for (let index = 0; index < 10; index += 1) {
        created.push(await open());
        advance(minute);
      }
      advance(2 * hour);
      expect(await service.verify(created[0]!.token)).toMatchObject({ ok: true, refresh: 'extended' });
      await open();
      expect(await service.verify(created[0]!.token)).toMatchObject({ ok: true });
      expect(await service.verify(created[1]!.token)).toMatchObject({ ok: false, reason: 'revoked' });
    });
  });

  describe('verifying a token', () => {
    it('checks connection liveness without touching idle expiry or lookup admission', async () => {
      const policy = {
        ...ownerSessionPolicy,
        lookupAdmission: { ...ownerSessionPolicy.lookupAdmission, unverifiedBudget: { windowMs: minute, max: 0 } },
      };
      const { open, service, store } = setup({ policy });
      const created = await open();
      const touch = vi.spyOn(store, 'touch');

      expect(await service.isConnectionSessionActive(created.sessionId)).toBe(true);
      expect(await service.isConnectionSessionActive(generateOwnerSessionCredential().sessionId)).toBe(false);
      expect(touch).not.toHaveBeenCalled();
    });

    it('yields the owner principal of a verified Entra token and no service identity', async () => {
      const { open, service } = setup();
      const created = await open();
      const verdict = await service.verify(created.token);
      expect(verdict).toEqual({
        ok: true,
        principal: { objectId: owner, tenantId: tenant, displayName: 'Test Owner' },
        session: { id: created.sessionId, prefix: created.prefix },
        refresh: 'none',
      });
      expect(Object.keys((verdict as { principal: object }).principal)).not.toContain('kind');
    });

    it('rejects a malformed token without a lookup', async () => {
      const { service, store } = setup();
      const find = vi.spyOn(store, 'find');
      for (const token of ['js.nope', 'js..', 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', `js.${'A'.repeat(22)}.${'A'.repeat(44)}`]) {
        expect(await service.verify(token)).toEqual({ ok: false, reason: 'malformed', prefix: null });
      }
      expect(find).not.toHaveBeenCalled();
    });

    it('rejects an unknown session id', async () => {
      const { service } = setup();
      const stranger = generateOwnerSessionCredential();
      expect(await service.verify(stranger.token)).toEqual({
        ok: false, reason: 'unknown_session', prefix: stranger.sessionId.slice(0, 8),
      });
    });

    it('rejects a real session id with the wrong secret and leaves the session usable', async () => {
      const { open, service } = setup();
      const created = await open();
      const wrong = `js.${created.sessionId}.${parseOwnerSessionToken(generateOwnerSessionCredential().token)!.secret}`;
      expect(await service.verify(wrong)).toEqual({ ok: false, reason: 'secret_mismatch', prefix: created.prefix });
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
    });

    it('does not reveal the state of a session to a caller who lacks its secret', async () => {
      const { open, service } = setup();
      const created = await open();
      await service.revokeCurrent(owner, created.sessionId);
      const wrong = `js.${created.sessionId}.${parseOwnerSessionToken(generateOwnerSessionCredential().token)!.secret}`;
      expect(await service.verify(wrong)).toMatchObject({ ok: false, reason: 'secret_mismatch' });
      expect(await service.verify(created.token)).toMatchObject({ ok: false, reason: 'revoked' });
    });

    it('rejects a session that belongs to another owner', async () => {
      const { open, service } = setup();
      const created = await open({ ownerObjectId: otherOwner });
      expect(await service.verify(created.token)).toEqual({ ok: false, reason: 'owner_mismatch', prefix: created.prefix });
    });

    it('rejects the instant the idle lifetime ends and not before', async () => {
      const justBefore = setup();
      const before = await justBefore.open();
      justBefore.advance(10 * day - 1);
      expect(await justBefore.service.verify(before.token)).toMatchObject({ ok: true });

      const exactly = setup();
      const at = await exactly.open();
      exactly.advance(10 * day);
      expect(await exactly.service.verify(at.token)).toEqual({ ok: false, reason: 'idle_expired', prefix: at.prefix });
    });

    it('rejects a session that has not been used for more than ten days', async () => {
      const { open, advance, service } = setup();
      const created = await open();
      advance(9 * day);
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'extended' });
      advance(10 * day + hour);
      expect(await service.verify(created.token)).toMatchObject({ ok: false, reason: 'idle_expired' });
    });
  });

  describe('sliding expiry', () => {
    it('extends the idle expiry at most once an hour', async () => {
      const { open, advance, service, store } = setup();
      const touch = vi.spyOn(store, 'touch');
      const created = await open();

      advance(hour - 1);
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'none' });
      expect(touch).not.toHaveBeenCalled();

      advance(1);
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'extended' });
      expect(touch).toHaveBeenCalledTimes(1);
      expect(await store.find(created.sessionId)).toMatchObject({
        lastUsedAt: new Date(start + hour), idleExpiresAt: new Date(start + hour + 10 * day),
      });

      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'none' });
      expect(touch).toHaveBeenCalledTimes(1);
    });

    it('never extends a session past the 30 day cap', async () => {
      const { open, advance, service, store } = setup();
      const created = await open();
      for (let step = 1; step <= 3; step += 1) {
        advance(9 * day);
        expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'extended' });
        const record = (await store.find(created.sessionId))!;
        expect(record.idleExpiresAt.getTime()).toBeLessThanOrEqual(record.absoluteExpiresAt.getTime());
      }
      expect((await store.find(created.sessionId))!.idleExpiresAt).toEqual(new Date(start + 30 * day));

      advance(3 * day - minute);
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      advance(minute);
      expect(await service.verify(created.token)).toEqual({ ok: false, reason: 'absolute_expired', prefix: created.prefix });
    });

    it('keeps the verification when the extension cannot be written and retries on the next request', async () => {
      const { open, advance, service, store } = setup();
      const touch = vi.spyOn(store, 'touch').mockRejectedValueOnce(new Error('connection reset'));
      const created = await open();
      advance(2 * hour);
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'failed' });
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'extended' });
      expect(touch).toHaveBeenCalledTimes(2);
    });

    it('treats a lost write race as already extended', async () => {
      const { open, advance, service, store } = setup();
      vi.spyOn(store, 'touch').mockResolvedValueOnce(false);
      const created = await open();
      advance(2 * hour);
      expect(await service.verify(created.token)).toMatchObject({ ok: true, refresh: 'none' });
    });
  });

  describe('revoking', () => {
    it('revokes one session, once, and only for its owner', async () => {
      const { open, service } = setup();
      const created = await open();
      const other = await open();
      expect(await service.revokeCurrent(otherOwner, created.sessionId)).toBe(false);
      expect(await service.revokeCurrent(owner.toUpperCase(), created.sessionId)).toBe(true);
      expect(await service.revokeCurrent(owner, created.sessionId)).toBe(false);
      expect(await service.verify(created.token)).toMatchObject({ ok: false, reason: 'revoked' });
      expect(await service.verify(other.token)).toMatchObject({ ok: true });
    });

    it('revokes every active session and counts only those', async () => {
      const { open, advance, service } = setup();
      const expired = await open();
      advance(11 * day);
      const live = [await open(), await open()];
      await service.revokeCurrent(owner, (await open()).sessionId);
      expect(await service.revokeAll(owner)).toBe(2);
      for (const session of live) expect(await service.verify(session.token)).toMatchObject({ ok: false, reason: 'revoked' });
      expect(await service.verify(expired.token)).toMatchObject({ ok: false, reason: 'idle_expired' });
      expect(await service.revokeAll(owner)).toBe(0);
    });
  });

  describe('create allowance', () => {
    it('allows five creations a minute and thirty an hour for the owner', async () => {
      const { service, advance } = setup();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(service.consumeCreateAllowance(attempt % 2 ? owner : owner.toUpperCase())).toEqual({ allowed: true });
      }
      expect(service.consumeCreateAllowance(owner)).toEqual({ allowed: false, retryAfterSeconds: 60 });
      advance(minute);
      expect(service.consumeCreateAllowance(owner)).toEqual({ allowed: true });
    });

    it('recognises the owner whatever the case of the object id', () => {
      const { service } = setup();
      expect(service.isOwner(owner)).toBe(true);
      expect(service.isOwner(owner.toUpperCase())).toBe(true);
      expect(service.isOwner(otherOwner)).toBe(false);
    });
  });

  describe('admission before the store is read', () => {
    const { unverifiedBudget, maxConcurrentUnverified, throttledRetryAfterSeconds } = ownerSessionPolicy.lookupAdmission;
    const budget = unverifiedBudget.max;
    type World = ReturnType<typeof setup>;

    const stranger = () => generateOwnerSessionCredential().token;
    const outcome = (service: OwnerSessionService, token: string) =>
      service.verify(token).then((verdict) => verdict, (error: unknown) => error);

    // Sends a well-formed token of an id nobody holds each time, as an unauthenticated caller can.
    async function flood(service: OwnerSessionService, attempts: number) {
      const results: unknown[] = [];
      for (let attempt = 0; attempt < attempts; attempt += 1) results.push(await outcome(service, stranger()));
      return {
        judged: results.filter((result) => !(result instanceof OwnerSessionThrottled)),
        throttled: results.filter((result) => result instanceof OwnerSessionThrottled),
      };
    }

    it('lets only the budget of well-formed random tokens reach the store', async () => {
      const { service, store } = setup();
      const find = vi.spyOn(store, 'find');
      const { judged, throttled } = await flood(service, 500);
      expect(find).toHaveBeenCalledTimes(budget);
      expect(judged).toHaveLength(budget);
      for (const verdict of judged) expect(verdict).toMatchObject({ ok: false, reason: 'unknown_session' });
      expect(throttled).toHaveLength(500 - budget);
    });

    it('admits a newly created session after the unverified budget is exhausted', async () => {
      const { service, store, open } = setup();
      expect((await flood(service, 2 * budget)).throttled.length).toBeGreaterThan(0);
      const created = await open();
      const find = vi.spyOn(store, 'find');

      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      expect(find).toHaveBeenCalledOnce();
    });

    it('counts a repeated unfamiliar token every time, so repeating one cannot get past the budget', async () => {
      const { service, store } = setup();
      const find = vi.spyOn(store, 'find');
      const token = stranger();
      for (let attempt = 0; attempt < 500; attempt += 1) await outcome(service, token);
      expect(find).toHaveBeenCalledTimes(budget);
    });

    it('admits unfamiliar ids again as the window slides', async () => {
      const { service, store, advance } = setup();
      const find = vi.spyOn(store, 'find');
      await flood(service, 2 * budget);
      expect(find).toHaveBeenCalledTimes(budget);
      advance(unverifiedBudget.windowMs);
      await flood(service, 2 * budget);
      expect(find).toHaveBeenCalledTimes(2 * budget);
    });

    it('does not charge a malformed token to the budget', async () => {
      const { service, store } = setup();
      const find = vi.spyOn(store, 'find');
      for (let attempt = 0; attempt < 500; attempt += 1) {
        expect(await service.verify('js.nope')).toEqual({ ok: false, reason: 'malformed', prefix: null });
      }
      expect(find).not.toHaveBeenCalled();
      expect((await flood(service, 2 * budget)).judged).toHaveLength(budget);
    });

    it('runs at most the configured number of unfamiliar lookups at once and spends no budget on the rest', async () => {
      const { service, store } = setup();
      let open!: () => void;
      const gate = new Promise<void>((resolve) => { open = resolve; });
      const find = vi.spyOn(store, 'find').mockImplementation(async () => {
        await gate;
        return null;
      });
      const pending = Array.from({ length: 100 }, () => outcome(service, stranger()));
      expect(find).toHaveBeenCalledTimes(maxConcurrentUnverified);

      open();
      const results = await Promise.all(pending);
      const throttled = results.filter((result) => result instanceof OwnerSessionThrottled);
      const judged = results.filter((result) => !(result instanceof OwnerSessionThrottled));
      expect(judged).toHaveLength(maxConcurrentUnverified);
      for (const verdict of judged) expect(verdict).toMatchObject({ ok: false, reason: 'unknown_session' });
      expect(throttled).toHaveLength(100 - maxConcurrentUnverified);
      for (const failure of throttled) {
        expect((failure as OwnerSessionThrottled).retryAfterSeconds).toBe(throttledRetryAfterSeconds);
      }
      expect(find).toHaveBeenCalledTimes(maxConcurrentUnverified);

      // Only the lookups that ran used budget, so the rest of it is still there.
      expect((await flood(service, 3 * budget)).judged).toHaveLength(budget - maxConcurrentUnverified);
    });

    it('keeps verifying a recently verified session during a flood and still reads the store for every request', async () => {
      const { service, store, open } = setup();
      const created = await open();
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      const find = vi.spyOn(store, 'find');
      const { judged, throttled } = await flood(service, 200);
      // Creation marks the session verified without spending an unverified lookup.
      expect(judged).toHaveLength(budget);
      expect(throttled.length).toBeGreaterThan(0);
      find.mockClear();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        expect(await service.verify(created.token)).toMatchObject({ ok: true });
      }
      expect(find).toHaveBeenCalledTimes(100);
    });

    it('keeps a recently verified session running while a slow flood holds every unfamiliar slot', async () => {
      const { service, store, open } = setup();
      const created = await open();
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      const real = store.find.bind(store);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      vi.spyOn(store, 'find').mockImplementation(async (sessionId) => {
        if (sessionId !== created.sessionId) await gate;
        return real(sessionId);
      });
      const held = Array.from({ length: maxConcurrentUnverified }, () => outcome(service, stranger()));
      expect(await outcome(service, stranger())).toBeInstanceOf(OwnerSessionThrottled);
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      release();
      await Promise.all(held);
    });

    it('refuses a session that was revoked elsewhere from the very next request, during a flood too', async () => {
      const { service, store, open } = setup();
      const created = await open();
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      await flood(service, 2 * budget);
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      // Another replica revokes through the shared store; this one holds no state that could say otherwise.
      await store.revoke(owner, created.sessionId, new Date(start));
      expect(await service.verify(created.token)).toEqual({ ok: false, reason: 'revoked', prefix: created.prefix });
    });

    // The clock stays inside the time to live of the exemption, so only the verdict can end it.
    const endings: [string, Partial<OwnerSessionServiceOptions>, (world: World, created: CreatedOwnerSession) => Promise<string>][] = [
      ['revoked', {}, async ({ store }, created) => {
        await store.revoke(owner, created.sessionId, new Date(start));
        return created.token;
      }],
      ['secret_mismatch', {}, async (_world, created) => `js.${created.sessionId}.${generateOwnerSessionCredential().secret}`],
      ['idle_expired', { policy: { ...ownerSessionPolicy, idleLifetimeMs: 10 * minute } }, async ({ advance }, created) => {
        advance(11 * minute);
        return created.token;
      }],
      ['absolute_expired', { policy: { ...ownerSessionPolicy, absoluteLifetimeMs: 10 * minute } }, async ({ advance }, created) => {
        advance(11 * minute);
        return created.token;
      }],
      ['owner_mismatch', {}, async ({ store }, created) => {
        const record = (await store.find(created.sessionId))!;
        vi.spyOn(store, 'find').mockResolvedValueOnce({ ...record, ownerObjectId: otherOwner });
        return created.token;
      }],
      ['unknown_session', {}, async ({ store }, created) => {
        vi.spyOn(store, 'find').mockResolvedValueOnce(null);
        return created.token;
      }],
    ];

    it.each(endings)('puts a session back under the budget once it verifies as %s', async (reason, options, end) => {
      const world = setup(options);
      const created = await world.open();
      expect(await world.service.verify(created.token)).toMatchObject({ ok: true });
      const token = await end(world, created);
      expect(await world.service.verify(token)).toMatchObject({ ok: false, reason });
      await flood(world.service, 2 * budget);
      expect(await outcome(world.service, created.token)).toBeInstanceOf(OwnerSessionThrottled);
    });

    it.each<[string, (service: OwnerSessionService, created: CreatedOwnerSession) => Promise<unknown>]>([
      ['revokeCurrent', (service, created) => service.revokeCurrent(owner, created.sessionId)],
      ['revokeAll', (service) => service.revokeAll(owner)],
    ])('answers a session revoked through %s with its verdict, not a throttle, even while the budget is spent', async (_name, revoke) => {
      const { service, open } = setup();
      const created = await open();
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      await flood(service, 2 * budget);
      await revoke(service, created);
      expect(await service.verify(created.token)).toEqual({ ok: false, reason: 'revoked', prefix: created.prefix });
      expect(await outcome(service, created.token)).toBeInstanceOf(OwnerSessionThrottled);
    });

    it('frees the slot when the store fails and leaves the recently verified sessions alone', async () => {
      const { service, store, open } = setup();
      const created = await open();
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
      const find = vi.spyOn(store, 'find').mockRejectedValue(new Error('connection reset'));
      for (let attempt = 0; attempt < 2 * maxConcurrentUnverified; attempt += 1) {
        expect(await outcome(service, stranger())).toBeInstanceOf(OwnerSessionUnavailable);
      }
      expect(await outcome(service, created.token)).toBeInstanceOf(OwnerSessionUnavailable);
      find.mockRestore();
      await flood(service, 2 * budget);
      expect(await service.verify(created.token)).toMatchObject({ ok: true });
    });

    it('tells a throttled caller when to retry and names nothing about the token', async () => {
      const { service, advance } = setup();
      await flood(service, 2 * budget);
      advance(20_000);
      const token = stranger();
      const failure = await outcome(service, token);
      expect(failure).toBeInstanceOf(OwnerSessionThrottled);
      const { retryAfterSeconds, message } = failure as OwnerSessionThrottled;
      expect(retryAfterSeconds).toBe(unverifiedBudget.windowMs / 1000 - 20);
      const { sessionId, secret } = parseOwnerSessionToken(token)!;
      for (const text of [message, String(failure), JSON.stringify(failure)]) {
        expect(text).not.toContain(sessionId);
        expect(text).not.toContain(secret);
      }
    });
  });

  describe('when the store fails', () => {
    it.each([
      ['verify', (service: OwnerSessionService) => service.verify(generateOwnerSessionCredential().token)],
      ['create', (service: OwnerSessionService) => service.create({ ownerObjectId: owner, displayName: 'Test Owner', deviceLabel: null })],
      ['revokeCurrent', (service: OwnerSessionService) => service.revokeCurrent(owner, 'x'.repeat(22))],
      ['revokeAll', (service: OwnerSessionService) => service.revokeAll(owner)],
    ])('reports %s as unavailable rather than as a rejection', async (_name, run) => {
      const cause = new Error('login failed for user secret-account');
      const { service } = setup({ store: failingStore(cause) });
      const failure = await run(service).then(() => null, (error: unknown) => error);
      expect(failure).toBeInstanceOf(OwnerSessionUnavailable);
      expect((failure as OwnerSessionUnavailable).cause).toBe(cause);
      expect((failure as OwnerSessionUnavailable).message).toBe('Owner session store unavailable');
    });
  });
});

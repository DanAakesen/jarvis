import { describe, expect, it } from 'vitest';
import { InMemoryOwnerSessionStore } from './memory-store.js';
import { isOwnerSessionActive, type OwnerSessionRecord } from './store.js';

const owner = '11111111-1111-4111-8111-111111111111';
const otherOwner = '22222222-2222-4222-8222-222222222222';
const base = Date.parse('2026-10-22T12:00:00.000Z');
const day = 24 * 60 * 60_000;
const at = (minutes: number) => new Date(base + minutes * 60_000);
const purgeBefore = new Date(base - 30 * day);

function row(index: number, overrides: Partial<OwnerSessionRecord> = {}): OwnerSessionRecord {
  return {
    sessionId: Buffer.alloc(16, index).toString('base64url'),
    secretHash: Buffer.alloc(32, index),
    ownerObjectId: owner,
    displayName: 'Test Owner',
    deviceLabel: null,
    createdAt: at(index),
    lastUsedAt: at(index),
    idleExpiresAt: new Date(base + 10 * day),
    absoluteExpiresAt: new Date(base + 30 * day),
    revokedAt: null,
    ...overrides,
  };
}

// Seeding must not purge: only the call under test may remove rows.
async function seed(store: InMemoryOwnerSessionStore, rows: OwnerSessionRecord[]) {
  for (const record of rows) await store.create({ record, maxActive: 100, purgeBefore: new Date(0) });
}

const revokedAt = async (store: InMemoryOwnerSessionStore, index: number) => (await store.find(row(index).sessionId))?.revokedAt;

describe('in-memory owner session store', () => {
  it('returns what it was given and null for an unknown id', async () => {
    const store = new InMemoryOwnerSessionStore();
    await expect(store.create({ record: row(1), maxActive: 10, purgeBefore })).resolves.toEqual({ evicted: 0 });
    await expect(store.find(row(1).sessionId)).resolves.toEqual(row(1));
    await expect(store.find(row(2).sessionId)).resolves.toBeNull();
  });

  it('refuses to reuse a session id', async () => {
    const store = new InMemoryOwnerSessionStore();
    await seed(store, [row(1)]);
    await expect(store.create({ record: row(1), maxActive: 10, purgeBefore })).rejects.toThrow('Duplicate owner session id');
  });

  it('revokes the least recently used session when the limit is reached', async () => {
    const store = new InMemoryOwnerSessionStore();
    await seed(store, [row(1), row(2), row(3)]);
    await expect(store.create({ record: row(4), maxActive: 3, purgeBefore })).resolves.toEqual({ evicted: 1 });
    expect(await revokedAt(store, 1)).toEqual(at(4));
    for (const index of [2, 3, 4]) expect(await revokedAt(store, index)).toBeNull();
  });

  it('orders by last use, not by creation', async () => {
    const store = new InMemoryOwnerSessionStore();
    await seed(store, [row(1, { lastUsedAt: at(30) }), row(2), row(3)]);
    await expect(store.create({ record: row(4, { createdAt: at(40), lastUsedAt: at(40) }), maxActive: 3, purgeBefore }))
      .resolves.toEqual({ evicted: 1 });
    expect(await revokedAt(store, 2)).toEqual(at(40));
    for (const index of [1, 3, 4]) expect(await revokedAt(store, index)).toBeNull();
  });

  it('breaks a last-use tie by creation time and then by session id', async () => {
    const byCreation = new InMemoryOwnerSessionStore();
    await seed(byCreation, [row(1, { lastUsedAt: at(9), createdAt: at(1) }), row(2, { lastUsedAt: at(9), createdAt: at(2) })]);
    await byCreation.create({ record: row(3, { createdAt: at(10), lastUsedAt: at(10) }), maxActive: 2, purgeBefore });
    expect(await revokedAt(byCreation, 1)).toEqual(at(10));
    expect(await revokedAt(byCreation, 2)).toBeNull();

    const byId = new InMemoryOwnerSessionStore();
    await seed(byId, [row(1, { lastUsedAt: at(9), createdAt: at(5) }), row(2, { lastUsedAt: at(9), createdAt: at(5) })]);
    await byId.create({ record: row(3, { createdAt: at(10), lastUsedAt: at(10) }), maxActive: 2, purgeBefore });
    expect(await revokedAt(byId, 1)).toEqual(at(10));
    expect(await revokedAt(byId, 2)).toBeNull();
  });

  it('does not count revoked or expired sessions against the limit', async () => {
    const store = new InMemoryOwnerSessionStore();
    await seed(store, [
      row(1),
      row(2, { revokedAt: at(2) }),
      row(3, { idleExpiresAt: at(3) }),
      row(4, { absoluteExpiresAt: at(4), idleExpiresAt: at(4) }),
    ]);
    await expect(store.create({ record: row(5, { createdAt: at(20), lastUsedAt: at(20) }), maxActive: 2, purgeBefore }))
      .resolves.toEqual({ evicted: 0 });
    expect(await revokedAt(store, 1)).toBeNull();
    expect(await revokedAt(store, 2)).toEqual(at(2));
  });

  it('never touches the sessions of another owner', async () => {
    const store = new InMemoryOwnerSessionStore();
    const old = new Date(base - 90 * day);
    await seed(store, [
      row(1, { ownerObjectId: otherOwner }),
      row(2, { ownerObjectId: otherOwner }),
      row(3, { ownerObjectId: otherOwner, idleExpiresAt: old, absoluteExpiresAt: old }),
      row(4, { ownerObjectId: otherOwner, revokedAt: old }),
    ]);
    await expect(store.create({ record: row(5), maxActive: 1, purgeBefore })).resolves.toEqual({ evicted: 0 });
    for (const index of [1, 2]) expect(await revokedAt(store, index)).toBeNull();
    expect(await store.find(row(3).sessionId)).not.toBeNull();
    expect(await store.find(row(4).sessionId)).not.toBeNull();
  });

  it('purges sessions that died before the retention cut-off and keeps newer ones', async () => {
    const store = new InMemoryOwnerSessionStore();
    const old = new Date(base - 40 * day);
    const recent = new Date(base - 5 * day);
    await seed(store, [
      row(1, { createdAt: old, lastUsedAt: old, idleExpiresAt: old, absoluteExpiresAt: old }),
      row(2, { revokedAt: old }),
      row(3, { createdAt: recent, lastUsedAt: recent, idleExpiresAt: recent, absoluteExpiresAt: recent }),
      row(4, { revokedAt: recent }),
    ]);
    await store.create({ record: row(5), maxActive: 10, purgeBefore });
    expect(await store.find(row(1).sessionId)).toBeNull();
    expect(await store.find(row(2).sessionId)).toBeNull();
    expect(await store.find(row(3).sessionId)).not.toBeNull();
    expect(await store.find(row(4).sessionId)).not.toBeNull();
  });

  describe('touch', () => {
    const touch = (index: number, now: Date, staleBefore: Date) => ({
      sessionId: row(index).sessionId, now, idleExpiresAt: new Date(now.getTime() + 10 * day), staleBefore,
    });

    it('extends a live session that has not been used since the stale mark', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [row(1)]);
      await expect(store.touch(touch(1, at(120), at(60)))).resolves.toBe(true);
      expect(await store.find(row(1).sessionId)).toEqual(row(1, {
        lastUsedAt: at(120), idleExpiresAt: new Date(at(120).getTime() + 10 * day),
      }));
    });

    it('changes nothing when another request already extended the session', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [row(1, { lastUsedAt: at(100) })]);
      await expect(store.touch(touch(1, at(120), at(60)))).resolves.toBe(false);
      expect(await store.find(row(1).sessionId)).toEqual(row(1, { lastUsedAt: at(100) }));
    });

    it('never revives a revoked, idle-expired or capped session', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [
        row(1, { revokedAt: at(5) }),
        row(2, { idleExpiresAt: at(100) }),
        row(3, { absoluteExpiresAt: at(100), idleExpiresAt: at(100) }),
      ]);
      for (const index of [1, 2, 3]) {
        await expect(store.touch(touch(index, at(120), at(60)))).resolves.toBe(false);
        expect((await store.find(row(index).sessionId))?.lastUsedAt).toEqual(at(index));
      }
    });

    it('reports an unknown session as unchanged', async () => {
      await expect(new InMemoryOwnerSessionStore().touch(touch(1, at(120), at(60)))).resolves.toBe(false);
    });
  });

  describe('revoke', () => {
    it('revokes the owner session once', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [row(1)]);
      await expect(store.revoke(owner, row(1).sessionId, at(50))).resolves.toBe(true);
      expect(await revokedAt(store, 1)).toEqual(at(50));
      await expect(store.revoke(owner, row(1).sessionId, at(60))).resolves.toBe(false);
      expect(await revokedAt(store, 1)).toEqual(at(50));
    });

    it('ignores another owner and unknown ids', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [row(1)]);
      await expect(store.revoke(otherOwner, row(1).sessionId, at(50))).resolves.toBe(false);
      await expect(store.revoke(owner, row(2).sessionId, at(50))).resolves.toBe(false);
      expect(await revokedAt(store, 1)).toBeNull();
    });
  });

  describe('revokeAll', () => {
    it('revokes every active session of the owner and counts them', async () => {
      const store = new InMemoryOwnerSessionStore();
      await seed(store, [
        row(1),
        row(2),
        row(3, { revokedAt: at(3) }),
        row(4, { idleExpiresAt: at(4) }),
        row(5, { ownerObjectId: otherOwner }),
      ]);
      await expect(store.revokeAll(owner, at(50))).resolves.toBe(2);
      expect(await revokedAt(store, 1)).toEqual(at(50));
      expect(await revokedAt(store, 2)).toEqual(at(50));
      expect(await revokedAt(store, 3)).toEqual(at(3));
      expect(await revokedAt(store, 4)).toBeNull();
      expect(await revokedAt(store, 5)).toBeNull();
      await expect(store.revokeAll(owner, at(60))).resolves.toBe(0);
    });
  });
});

describe('isOwnerSessionActive', () => {
  const live = row(1);

  it('is true only before both expiries and while not revoked', () => {
    expect(isOwnerSessionActive(live, at(1))).toBe(true);
    expect(isOwnerSessionActive({ ...live, revokedAt: at(1) }, at(2))).toBe(false);
    expect(isOwnerSessionActive(live, live.idleExpiresAt)).toBe(false);
    expect(isOwnerSessionActive({ ...live, idleExpiresAt: at(100), absoluteExpiresAt: at(50) }, at(50))).toBe(false);
    expect(isOwnerSessionActive(live, new Date(live.idleExpiresAt.getTime() - 1))).toBe(true);
  });
});

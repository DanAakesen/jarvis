import { ownerSessionIdToBytes } from './token.js';
import {
  isOwnerSessionActive, type CreateOwnerSessionInput, type OwnerSessionRecord, type OwnerSessionStore,
  type TouchOwnerSessionInput,
} from './store.js';

// Mirrors the order the SQL store uses to pick which sessions stay.
const newestFirst = (a: OwnerSessionRecord, b: OwnerSessionRecord): number =>
  b.lastUsedAt.getTime() - a.lastUsedAt.getTime() ||
  b.createdAt.getTime() - a.createdAt.getTime() ||
  Buffer.compare(ownerSessionIdToBytes(b.sessionId), ownerSessionIdToBytes(a.sessionId));

/** Process-local store for tests and local composition. It follows the same rules as the SQL store. */
export class InMemoryOwnerSessionStore implements OwnerSessionStore {
  private readonly rows = new Map<string, OwnerSessionRecord>();

  async create({ record, maxActive, purgeBefore }: CreateOwnerSessionInput): Promise<{ evicted: number }> {
    for (const [id, row] of this.rows) {
      if (row.ownerObjectId === record.ownerObjectId &&
          (row.idleExpiresAt < purgeBefore || (row.revokedAt !== null && row.revokedAt < purgeBefore))) this.rows.delete(id);
    }
    if (this.rows.has(record.sessionId)) throw new Error('Duplicate owner session id');
    const active = [...this.rows.values()]
      .filter((row) => row.ownerObjectId === record.ownerObjectId && isOwnerSessionActive(row, record.createdAt))
      .sort(newestFirst);
    const evicted = active.slice(Math.max(maxActive - 1, 0));
    for (const row of evicted) this.rows.set(row.sessionId, { ...row, revokedAt: record.createdAt });
    this.rows.set(record.sessionId, record);
    return { evicted: evicted.length };
  }

  async find(sessionId: string): Promise<OwnerSessionRecord | null> {
    return this.rows.get(sessionId) ?? null;
  }

  async touch({ sessionId, now, idleExpiresAt, staleBefore }: TouchOwnerSessionInput): Promise<boolean> {
    const row = this.rows.get(sessionId);
    if (!row || !isOwnerSessionActive(row, now) || row.lastUsedAt > staleBefore) return false;
    this.rows.set(sessionId, { ...row, lastUsedAt: now, idleExpiresAt });
    return true;
  }

  async revoke(ownerObjectId: string, sessionId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(sessionId);
    if (!row || row.ownerObjectId !== ownerObjectId || row.revokedAt !== null) return false;
    this.rows.set(sessionId, { ...row, revokedAt: at });
    return true;
  }

  async revokeAll(ownerObjectId: string, at: Date): Promise<number> {
    let revoked = 0;
    for (const row of this.rows.values()) {
      if (row.ownerObjectId !== ownerObjectId || !isOwnerSessionActive(row, at)) continue;
      this.rows.set(row.sessionId, { ...row, revokedAt: at });
      revoked += 1;
    }
    return revoked;
  }
}

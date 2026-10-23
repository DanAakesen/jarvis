export interface OwnerSessionRecord {
  /** 22-character base64url text of the 128-bit session id. */
  readonly sessionId: string;
  /** SHA-256 of the session secret. The secret itself is never stored. */
  readonly secretHash: Buffer;
  /** Lower-case object id of the owner the session belongs to. */
  readonly ownerObjectId: string;
  readonly displayName: string;
  readonly deviceLabel: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface CreateOwnerSessionInput {
  /** The new row; `createdAt` is also the instant that decides which sessions are active. */
  readonly record: OwnerSessionRecord;
  /** Active sessions kept for the owner, including the new one. */
  readonly maxActive: number;
  /** Rows revoked or idle-expired before this instant are purged. */
  readonly purgeBefore: Date;
}

export interface TouchOwnerSessionInput {
  readonly sessionId: string;
  readonly now: Date;
  readonly idleExpiresAt: Date;
  /** Only a row last used at or before this instant is extended, so concurrent callers write once. */
  readonly staleBefore: Date;
}

export interface OwnerSessionStore {
  /** Revokes the least recently used active sessions beyond the limit, then inserts the new one in one step. */
  create(input: CreateOwnerSessionInput): Promise<{ readonly evicted: number }>;
  find(sessionId: string): Promise<OwnerSessionRecord | null>;
  /** Extends a live session; never revives a revoked or expired one. Returns whether a row changed. */
  touch(input: TouchOwnerSessionInput): Promise<boolean>;
  /** Returns whether an unrevoked session of this owner was revoked. */
  revoke(ownerObjectId: string, sessionId: string, at: Date): Promise<boolean>;
  /** Revokes every active session of the owner and returns how many there were. */
  revokeAll(ownerObjectId: string, at: Date): Promise<number>;
}

export function isOwnerSessionActive(record: OwnerSessionRecord, now: Date): boolean {
  return record.revokedAt === null && now < record.idleExpiresAt && now < record.absoluteExpiresAt;
}

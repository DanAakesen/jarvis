import sql from 'mssql';
import type {
  CreateOwnerSessionInput, OwnerSessionRecord, OwnerSessionStore, TouchOwnerSessionInput,
} from '../auth/session/store.js';
import { ownerSessionIdFromBytes, ownerSessionIdToBytes } from '../auth/session/token.js';
import { databaseReadRequest } from './wake-retry.js';

interface OwnerSessionRow {
  session_id: Buffer;
  secret_hash: Buffer;
  owner_object_id: string;
  display_name: string;
  device_label: string | null;
  created_at: Date;
  last_used_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  revoked_at: Date | null;
}

const toRecord = (row: OwnerSessionRow): OwnerSessionRecord => ({
  sessionId: ownerSessionIdFromBytes(row.session_id),
  secretHash: Buffer.from(row.secret_hash),
  ownerObjectId: row.owner_object_id.toLowerCase(),
  displayName: row.display_name,
  deviceLabel: row.device_label,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  idleExpiresAt: row.idle_expires_at,
  absoluteExpiresAt: row.absolute_expires_at,
  revokedAt: row.revoked_at,
});

// One batch under an owner lock: purge dead rows, revoke the least recently used sessions beyond the limit, insert.
// The lock serialises concurrent creates, so the active count can never exceed the limit.
export const createOwnerSessionStatement = `SET XACT_ABORT ON;
BEGIN TRANSACTION;
DECLARE @lockResult int;
DECLARE @lockResource nvarchar(255) = CONCAT(N'jarvis.owner-sessions:', LOWER(CONVERT(nvarchar(36), @owner)));
EXEC @lockResult = sys.sp_getapplock
  @Resource = @lockResource,
  @LockMode = 'Exclusive',
  @LockOwner = 'Transaction',
  @LockTimeout = 10000;
IF @lockResult < 0 THROW 51001, 'Could not acquire the owner session lock', 1;
DELETE FROM dbo.owner_sessions
  WHERE owner_object_id = @owner AND (idle_expires_at < @purgeBefore OR revoked_at < @purgeBefore);
DECLARE @evicted int;
UPDATE dbo.owner_sessions SET revoked_at = @now
  WHERE owner_object_id = @owner AND revoked_at IS NULL AND idle_expires_at > @now AND absolute_expires_at > @now
    AND session_id NOT IN (
      SELECT TOP (@keep) session_id FROM dbo.owner_sessions
        WHERE owner_object_id = @owner AND revoked_at IS NULL AND idle_expires_at > @now AND absolute_expires_at > @now
        ORDER BY last_used_at DESC, created_at DESC, session_id DESC);
SET @evicted = @@ROWCOUNT;
INSERT dbo.owner_sessions
  (session_id, secret_hash, owner_object_id, display_name, device_label,
   created_at, last_used_at, idle_expires_at, absolute_expires_at)
  VALUES (@sessionId, @secretHash, @owner, @displayName, @deviceLabel, @now, @now, @idleExpiresAt, @absoluteExpiresAt);
COMMIT TRANSACTION;
SELECT @evicted AS evicted;`;

export function createOwnerSessionStore(pool: sql.ConnectionPool): OwnerSessionStore {
  return {
    async create({ record, maxActive, purgeBefore }: CreateOwnerSessionInput) {
      const { recordset } = await pool.request()
        .input('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(record.sessionId))
        .input('secretHash', sql.VarBinary(32), record.secretHash)
        .input('owner', sql.UniqueIdentifier, record.ownerObjectId.toLowerCase())
        .input('displayName', sql.NVarChar(200), record.displayName)
        .input('deviceLabel', sql.NVarChar(40), record.deviceLabel)
        .input('now', sql.DateTime2(3), record.createdAt)
        .input('idleExpiresAt', sql.DateTime2(3), record.idleExpiresAt)
        .input('absoluteExpiresAt', sql.DateTime2(3), record.absoluteExpiresAt)
        .input('purgeBefore', sql.DateTime2(3), purgeBefore)
        .input('keep', sql.Int, Math.max(maxActive - 1, 0))
        .query<{ evicted: number }>(createOwnerSessionStatement);
      const evicted = recordset[0]?.evicted;
      if (typeof evicted !== 'number') throw new Error('Owner session was not saved');
      return { evicted };
    },

    async find(sessionId: string) {
      const { recordset } = await databaseReadRequest(pool)
        .input('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(sessionId))
        .query<OwnerSessionRow>(`SELECT session_id, secret_hash, owner_object_id, display_name, device_label,
            created_at, last_used_at, idle_expires_at, absolute_expires_at, revoked_at
          FROM dbo.owner_sessions WHERE session_id = @sessionId;`);
      const row = recordset[0];
      return row ? toRecord(row) : null;
    },

    // The predicate repeats the liveness rules, so a concurrent revoke or expiry is never undone.
    async touch({ sessionId, now, idleExpiresAt, staleBefore }: TouchOwnerSessionInput) {
      const result = await pool.request()
        .input('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(sessionId))
        .input('now', sql.DateTime2(3), now)
        .input('idleExpiresAt', sql.DateTime2(3), idleExpiresAt)
        .input('staleBefore', sql.DateTime2(3), staleBefore)
        .query(`UPDATE dbo.owner_sessions SET last_used_at = @now, idle_expires_at = @idleExpiresAt
          WHERE session_id = @sessionId AND revoked_at IS NULL AND last_used_at <= @staleBefore
            AND idle_expires_at > @now AND absolute_expires_at > @now;`);
      return (result.rowsAffected[0] ?? 0) > 0;
    },

    async revoke(ownerObjectId: string, sessionId: string, at: Date) {
      const result = await pool.request()
        .input('sessionId', sql.VarBinary(16), ownerSessionIdToBytes(sessionId))
        .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
        .input('at', sql.DateTime2(3), at)
        .query(`UPDATE dbo.owner_sessions SET revoked_at = @at
          WHERE session_id = @sessionId AND owner_object_id = @owner AND revoked_at IS NULL;`);
      return (result.rowsAffected[0] ?? 0) > 0;
    },

    async revokeAll(ownerObjectId: string, at: Date) {
      const result = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId.toLowerCase())
        .input('at', sql.DateTime2(3), at)
        .query(`UPDATE dbo.owner_sessions SET revoked_at = @at
          WHERE owner_object_id = @owner AND revoked_at IS NULL AND idle_expires_at > @at AND absolute_expires_at > @at;`);
      return result.rowsAffected[0] ?? 0;
    },
  };
}

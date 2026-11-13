import { createHash, randomBytes } from 'node:crypto';
import sql from 'mssql';

export const watchCredentialPrefix = 'jw.';
export const watchTranscriptionPath = '/voice/watch/transcribe';
export const watchCredentialPath = '/voice/watch/credential';

export interface WatchCredentialStore {
  rotate(ownerObjectId: string, hash: Buffer): Promise<Date>;
  verify(ownerObjectId: string, hash: Buffer): Promise<boolean>;
  revoke(ownerObjectId: string): Promise<void>;
}

export class WatchCredentialUnavailable extends Error {
  constructor() { super('Watch credential unavailable'); }
}

export class WatchCredentials {
  constructor(private readonly store: WatchCredentialStore, private readonly ownerObjectId: string) {}

  async issue(): Promise<{ credential: string; expiresAt: string }> {
    const credential = `${watchCredentialPrefix}${randomBytes(32).toString('base64url')}`;
    try {
      const expiresAt = await this.store.rotate(this.ownerObjectId, this.hash(credential));
      return { credential, expiresAt: expiresAt.toISOString() };
    } catch { throw new WatchCredentialUnavailable(); }
  }

  async verify(credential: string): Promise<boolean> {
    if (!/^jw\.[A-Za-z0-9_-]{43}$/u.test(credential)) return false;
    try { return await this.store.verify(this.ownerObjectId, this.hash(credential)); }
    catch { throw new WatchCredentialUnavailable(); }
  }

  async revoke(): Promise<void> {
    try { await this.store.revoke(this.ownerObjectId); }
    catch { throw new WatchCredentialUnavailable(); }
  }

  private hash(credential: string): Buffer {
    return createHash('sha256').update(credential).digest();
  }
}

export function createWatchCredentialStore(pool: sql.ConnectionPool): WatchCredentialStore {
  return {
    async rotate(ownerObjectId, hash) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('hash', sql.VarBinary(32), hash)
        .query<{ expires_at: Date }>(`
          SET XACT_ABORT ON;
          BEGIN TRY
            BEGIN TRANSACTION;
            DECLARE @now datetime2(7) = SYSUTCDATETIME();
            UPDATE dbo.watch_credentials WITH (UPDLOCK, HOLDLOCK)
              SET credential_hash = @hash, created_at = @now, expires_at = DATEADD(hour, 24, @now)
              WHERE owner_object_id = @owner;
            IF @@ROWCOUNT = 0
              INSERT dbo.watch_credentials (owner_object_id, credential_hash, created_at, expires_at)
                VALUES (@owner, @hash, @now, DATEADD(hour, 24, @now));
            SELECT expires_at FROM dbo.watch_credentials WHERE owner_object_id = @owner;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      const row = recordset[0];
      if (!row) throw new WatchCredentialUnavailable();
      return row.expires_at;
    },
    async verify(ownerObjectId, hash) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('hash', sql.VarBinary(32), hash)
        .query(`SELECT 1 AS valid FROM dbo.watch_credentials
          WHERE owner_object_id = @owner AND credential_hash = @hash
            AND expires_at > SYSUTCDATETIME();`);
      return recordset.length === 1;
    },
    async revoke(ownerObjectId) {
      await pool.request().input('owner', sql.UniqueIdentifier, ownerObjectId)
        .query('DELETE FROM dbo.watch_credentials WHERE owner_object_id = @owner;');
    },
  };
}

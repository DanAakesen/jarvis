import { createHash, randomBytes } from 'node:crypto';
import sql from 'mssql';

export const inboxCapturePrefix = 'ji.';
export const inboxCapturePath = '/inbox/capture';
export const inboxCredentialsPath = '/inbox/credentials';
export const maxInboxCaptureCredentials = 5;
const credentialPattern = /^ji\.[A-Za-z0-9_-]{43}$/u;

export interface InboxCaptureCredentialInfo {
  /** First six bytes of the hash, as hex: enough to name one credential, useless to use it. */
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export interface InboxCaptureCredentialStore {
  /** Returns false when the owner already holds the maximum. */
  add(ownerObjectId: string, hash: Buffer, label: string, maximum: number): Promise<boolean>;
  verify(ownerObjectId: string, hash: Buffer): Promise<boolean>;
  list(ownerObjectId: string): Promise<InboxCaptureCredentialInfo[]>;
  revoke(ownerObjectId: string, id: string): Promise<boolean>;
}

export class InboxCaptureCredentialUnavailable extends Error {
  constructor() { super('Inbox capture credential store unavailable'); }
}

export class InboxCaptureCredentialLimit extends Error {
  constructor() { super(`At most ${maxInboxCaptureCredentials} capture credentials can exist; revoke one first.`); }
}

export function isInboxCaptureCredential(value: string): boolean {
  return credentialPattern.test(value);
}

/**
 * Write-only capability for adding inbox items from a Shortcut or script. It is not an identity: the only route that
 * accepts it is POST /inbox/capture, it reads nothing, only its hash is stored, and the owner can revoke it at any time.
 */
export class InboxCaptureCredentials {
  constructor(private readonly store: InboxCaptureCredentialStore, private readonly ownerObjectId: string) {}

  async issue(label: string): Promise<{ credential: string; id: string; label: string }> {
    const cleaned = label.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim();
    if (!cleaned || Array.from(cleaned).length > 40) throw new RangeError('A capture credential needs a label of 1-40 characters.');
    const credential = `${inboxCapturePrefix}${randomBytes(32).toString('base64url')}`;
    const hash = this.hash(credential);
    let added: boolean;
    try { added = await this.store.add(this.ownerObjectId, hash, cleaned, maxInboxCaptureCredentials); }
    catch { throw new InboxCaptureCredentialUnavailable(); }
    if (!added) throw new InboxCaptureCredentialLimit();
    return { credential, id: hash.subarray(0, 6).toString('hex'), label: cleaned };
  }

  async verify(credential: string): Promise<boolean> {
    if (!credentialPattern.test(credential)) return false;
    try { return await this.store.verify(this.ownerObjectId, this.hash(credential)); }
    catch { throw new InboxCaptureCredentialUnavailable(); }
  }

  async list(): Promise<InboxCaptureCredentialInfo[]> {
    try { return await this.store.list(this.ownerObjectId); }
    catch { throw new InboxCaptureCredentialUnavailable(); }
  }

  async revoke(id: string): Promise<boolean> {
    if (!/^[0-9a-f]{12}$/u.test(id)) return false;
    try { return await this.store.revoke(this.ownerObjectId, id); }
    catch { throw new InboxCaptureCredentialUnavailable(); }
  }

  hash(credential: string): Buffer {
    return createHash('sha256').update(credential).digest();
  }
}

interface Row { id: string; label: string; created_at: Date; last_used_at: Date | null }

export function createInboxCaptureCredentialStore(pool: sql.ConnectionPool): InboxCaptureCredentialStore {
  return {
    async add(ownerObjectId, hash, label, maximum) {
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('hash', sql.VarBinary(32), hash)
        .input('label', sql.NVarChar(40), label)
        .input('maximum', sql.Int, maximum)
        .query<{ added: boolean }>(`
          SET XACT_ABORT ON;
          BEGIN TRY
            BEGIN TRANSACTION;
            DECLARE @added bit = 0;
            IF (SELECT COUNT(*) FROM dbo.inbox_capture_credentials WITH (UPDLOCK, HOLDLOCK) WHERE owner_object_id = @owner) < @maximum
            BEGIN
              INSERT dbo.inbox_capture_credentials (credential_hash, owner_object_id, label) VALUES (@hash, @owner, @label);
              SET @added = 1;
            END;
            SELECT @added AS added;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      return Boolean(recordset[0]?.added);
    },
    async verify(ownerObjectId, hash) {
      // last_used_at is refreshed at most hourly so a busy Shortcut does not turn every capture into an extra write.
      const { recordset } = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('hash', sql.VarBinary(32), hash)
        .query(`
          UPDATE dbo.inbox_capture_credentials SET last_used_at = SYSUTCDATETIME()
            WHERE owner_object_id = @owner AND credential_hash = @hash
              AND (last_used_at IS NULL OR last_used_at < DATEADD(hour, -1, SYSUTCDATETIME()));
          SELECT 1 AS valid FROM dbo.inbox_capture_credentials WHERE owner_object_id = @owner AND credential_hash = @hash;`);
      return recordset.length === 1;
    },
    async list(ownerObjectId) {
      const { recordset } = await pool.request().input('owner', sql.UniqueIdentifier, ownerObjectId)
        .query<Row>(`SELECT CONVERT(char(12), SUBSTRING(credential_hash, 1, 6), 2) AS id, label, created_at, last_used_at
          FROM dbo.inbox_capture_credentials WHERE owner_object_id = @owner ORDER BY created_at;`);
      return recordset.map((row) => ({
        id: row.id.toLowerCase(),
        label: row.label,
        createdAt: row.created_at.toISOString(),
        lastUsedAt: row.last_used_at?.toISOString() ?? null,
      }));
    },
    async revoke(ownerObjectId, id) {
      const result = await pool.request()
        .input('owner', sql.UniqueIdentifier, ownerObjectId)
        .input('id', sql.VarBinary(6), Buffer.from(id, 'hex'))
        .query('DELETE FROM dbo.inbox_capture_credentials WHERE owner_object_id = @owner AND SUBSTRING(credential_hash, 1, 6) = @id;');
      return (result.rowsAffected[0] ?? 0) > 0;
    },
  };
}

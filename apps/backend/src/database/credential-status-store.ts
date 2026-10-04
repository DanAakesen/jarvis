import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type {
  CredentialName,
  CredentialStatus,
  CredentialStatusStore,
  CredentialStatusValue,
} from '../credentials/credential-status.js';

interface CredentialStatusRow {
  name: CredentialName;
  expiresAt: Date | string | null;
  lastRenewedAt: Date | string | null;
  status: CredentialStatusValue;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rollback(transaction: sql.Transaction): Promise<void> {
  return transaction.rollback().catch(() => {});
}

export function createCredentialStatusStore(pool: sql.ConnectionPool): CredentialStatusStore {
  return {
    async list(): Promise<CredentialStatus[]> {
      const { recordset } = await databaseReadRequest(pool).query<CredentialStatusRow>(`SELECT name,
        expires_at AS expiresAt, last_renewed_at AS lastRenewedAt, status
        FROM dbo.credential_status WHERE name IN (N'codex-login', N'copilot-token')
        ORDER BY name;`);
      return recordset.map((row) => ({
        name: row.name,
        expiresAt: iso(row.expiresAt),
        lastRenewedAt: iso(row.lastRenewedAt),
        status: row.status,
      }));
    },

    async acquireCodexRenewalLease(owner: string, leaseSeconds: number): Promise<boolean> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        const credential = await new sql.Request(transaction)
          .query<{ leaseActive: boolean }>(`SELECT CAST(CASE WHEN renewal_lease_until > SYSUTCDATETIME()
            THEN 1 ELSE 0 END AS bit) AS leaseActive
            FROM dbo.credential_status WITH (UPDLOCK, HOLDLOCK) WHERE name = N'codex-login';`);
        if (credential.recordset[0]?.leaseActive !== false) {
          await rollback(transaction);
          return false;
        }
        const activeTasks = await new sql.Request(transaction)
          .query<{ id: string }>(`SELECT TOP (1) CAST(id AS varchar(19)) AS id FROM dbo.tasks
            WHERE agent = N'codex' AND state IN (N'Running', N'PauseRequested');`);
        if (activeTasks.recordset.length > 0) {
          await rollback(transaction);
          return false;
        }
        await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('leaseSeconds', sql.Int, leaseSeconds)
          .query(`UPDATE dbo.credential_status SET renewal_lease_owner = @owner,
            renewal_lease_until = DATEADD(second, @leaseSeconds, SYSUTCDATETIME())
            WHERE name = N'codex-login';`);
        await transaction.commit();
        return true;
      } catch {
        await rollback(transaction);
        throw new Error('Credential renewal lease acquisition failed');
      }
    },

    async refreshCodexRenewalLease(owner: string, leaseSeconds: number): Promise<boolean> {
      const { rowsAffected } = await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('leaseSeconds', sql.Int, leaseSeconds)
        .query(`UPDATE dbo.credential_status SET renewal_lease_until =
          DATEADD(second, @leaseSeconds, SYSUTCDATETIME())
          WHERE name = N'codex-login' AND renewal_lease_owner = @owner
            AND renewal_lease_until > SYSUTCDATETIME();`);
      return (rowsAffected[0] ?? 0) === 1;
    },

    async updateCopilotStatus(
      status: CredentialStatusValue,
      expiresAt: string | null,
      lastRenewedAt: string | null,
    ): Promise<void> {
      await pool.request()
        .input('status', sql.NVarChar(16), status)
        .input('expiresAt', sql.DateTime2(7), expiresAt ? new Date(expiresAt) : null)
        .input('lastRenewedAt', sql.DateTime2(7), lastRenewedAt ? new Date(lastRenewedAt) : null)
        .query(`UPDATE dbo.credential_status SET status = @status,
          expires_at = @expiresAt, last_renewed_at = @lastRenewedAt
          WHERE name = N'copilot-token';`);
    },

    async completeCodexRenewal(
      owner: string,
      status: Exclude<CredentialStatusValue, 'unknown'>,
      expiresAt: string | null,
      lastRenewedAt: string | null,
      releaseLease = true,
    ): Promise<void> {
      await pool.request()
        .input('owner', sql.UniqueIdentifier, owner)
        .input('status', sql.NVarChar(16), status)
        .input('expiresAt', sql.DateTime2(7), expiresAt ? new Date(expiresAt) : null)
        .input('lastRenewedAt', sql.DateTime2(7), lastRenewedAt ? new Date(lastRenewedAt) : null)
        .input('releaseLease', sql.Bit, releaseLease)
        .query(`UPDATE dbo.credential_status SET status = @status,
          expires_at = COALESCE(@expiresAt, expires_at),
          last_renewed_at = COALESCE(@lastRenewedAt, last_renewed_at),
          renewal_lease_owner = CASE WHEN @releaseLease = 1 THEN NULL ELSE renewal_lease_owner END,
          renewal_lease_until = CASE WHEN @releaseLease = 1 THEN NULL ELSE renewal_lease_until END
          WHERE name = N'codex-login' AND renewal_lease_owner = @owner;`);
    },
  };
}

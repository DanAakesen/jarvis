import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { AlertNotifier, ActivityAlert } from '../alerts.js';
import { notifyAlert } from '../alerts.js';
import { insertActivityAlert } from './alert-store.js';
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

export function createCredentialStatusStore(
  pool: sql.ConnectionPool,
  options: { alertNotifier?: AlertNotifier; onAlert?: () => void } = {},
): CredentialStatusStore {
  const expiryAlert = (
    name: CredentialName,
    status: CredentialStatusValue,
    expiresAt: Date | string | null,
  ): ActivityAlert | undefined => {
    if (expiresAt === null || (status !== 'renew_soon' &&
      !(status === 'failed' && Date.parse(iso(expiresAt)!) <= Date.now()))) return undefined;
    const expiry = iso(expiresAt)!;
    return {
      type: 'credential_expiry',
      dedupeKey: `credential:${name}:${expiry}`,
      title: `${name} expires ${expiry.slice(0, 10)}`,
      link: null,
    };
  };

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
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      let alert: ActivityAlert | undefined;
      let inserted: boolean;
      try {
        const { recordset } = await new sql.Request(transaction)
          .input('status', sql.NVarChar(16), status)
          .input('expiresAt', sql.DateTime2(7), expiresAt ? new Date(expiresAt) : null)
          .input('lastRenewedAt', sql.DateTime2(7), lastRenewedAt ? new Date(lastRenewedAt) : null)
          .query<{ expiresAt: Date | null }>(`UPDATE dbo.credential_status SET status = @status,
            expires_at = @expiresAt, last_renewed_at = @lastRenewedAt
            OUTPUT inserted.expires_at AS expiresAt
            WHERE name = N'copilot-token';`);
        alert = recordset[0] ? expiryAlert('copilot-token', status, recordset[0].expiresAt) : undefined;
        inserted = alert ? await insertActivityAlert(transaction, alert) : false;
        await transaction.commit();
      } catch (error) {
        await rollback(transaction);
        throw error;
      }
      if (inserted && alert) {
        notifyAlert(options.alertNotifier, alert);
        options.onAlert?.();
      }
    },

    async completeCodexRenewal(
      owner: string,
      status: Exclude<CredentialStatusValue, 'unknown'>,
      expiresAt: string | null,
      lastRenewedAt: string | null,
      releaseLease = true,
    ): Promise<void> {
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      let alert: ActivityAlert | undefined;
      let inserted: boolean;
      try {
        const { recordset } = await new sql.Request(transaction)
          .input('owner', sql.UniqueIdentifier, owner)
          .input('status', sql.NVarChar(16), status)
          .input('expiresAt', sql.DateTime2(7), expiresAt ? new Date(expiresAt) : null)
          .input('lastRenewedAt', sql.DateTime2(7), lastRenewedAt ? new Date(lastRenewedAt) : null)
          .input('releaseLease', sql.Bit, releaseLease)
          .query<{ expiresAt: Date | null }>(`UPDATE dbo.credential_status SET status = @status,
            expires_at = COALESCE(@expiresAt, expires_at),
            last_renewed_at = COALESCE(@lastRenewedAt, last_renewed_at),
            renewal_lease_owner = CASE WHEN @releaseLease = 1 THEN NULL ELSE renewal_lease_owner END,
            renewal_lease_until = CASE WHEN @releaseLease = 1 THEN NULL ELSE renewal_lease_until END
            OUTPUT inserted.expires_at AS expiresAt
            WHERE name = N'codex-login' AND renewal_lease_owner = @owner;`);
        alert = recordset[0] ? expiryAlert('codex-login', status, recordset[0].expiresAt) : undefined;
        inserted = alert ? await insertActivityAlert(transaction, alert) : false;
        await transaction.commit();
      } catch (error) {
        await rollback(transaction);
        throw error;
      }
      if (inserted && alert) {
        notifyAlert(options.alertNotifier, alert);
        options.onAlert?.();
      }
    },
  };
}

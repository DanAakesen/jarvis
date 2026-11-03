import { randomUUID } from 'node:crypto';
import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import { admitNotification, notificationExpiryDays, type RecentNotification } from '../core/notification-policy.js';
import type { NowFeedSnapshot, NowFeedStore, NowRunningTask, NowActivityItem } from '../core/now.js';

interface RunningTaskRow extends Omit<NowRunningTask, 'startedAt'> {
  startedAt: Date | string;
}

interface ActivityRow extends Omit<NowActivityItem, 'at'> {
  at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

const visibleActivityCte = `WITH attention AS (
          SELECT a.id, a.title, a.link, a.at, a.dismissed_at,
            ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY a.at DESC, a.id DESC) AS item_order
          FROM dbo.activity AS a
          INNER JOIN dbo.tasks AS t
            ON a.link = CONCAT(N'task:', CONVERT(varchar(19), t.id))
          WHERE a.area = N'factory' AND a.alert_key IS NULL AND t.state = N'NeedsAttention'
        ), visible AS (
          SELECT id, N'attention' AS category, title, link, at
          FROM attention WHERE item_order = 1 AND dismissed_at IS NULL
          UNION ALL
          SELECT id, N'release' AS category, title, link, at
          FROM dbo.activity
          WHERE dismissed_at IS NULL AND alert_key IS NULL
            AND (kind LIKE N'release%' OR kind LIKE N'deployment%')
          UNION ALL
          SELECT id, N'credential' AS category, title, link, at
          FROM dbo.activity
          WHERE dismissed_at IS NULL AND alert_key IS NULL AND kind LIKE N'credential%'
          UNION ALL
          SELECT id, N'alert' AS category, title, link, at
          FROM dbo.activity
          WHERE dismissed_at IS NULL AND alert_key IS NOT NULL
            AND (alert_key NOT LIKE N'credential:github-app:failed:%' OR recovered_at IS NULL)
            AND (alert_key NOT LIKE N'notification:%' OR at > DATEADD(day, -${notificationExpiryDays}, SYSUTCDATETIME()))
        )`;

export function createNowFeedStore(pool: sql.ConnectionPool, onNotificationCreated: () => void = () => {}): NowFeedStore {
  return {
    async read(): Promise<NowFeedSnapshot> {
      const running = await databaseReadRequest(pool).query<RunningTaskRow>(`SELECT TOP (100)
        CAST(t.id AS varchar(19)) AS id, t.title, p.name AS project, t.agent,
        COALESCE(NULLIF(t.activity, N''), N'Running') AS activity,
        COALESCE(t.started_at, t.created_at) AS startedAt
        FROM dbo.tasks AS t
        INNER JOIN dbo.projects AS p ON p.id = t.project_id
        WHERE t.state = N'Running'
        ORDER BY COALESCE(t.started_at, t.created_at) DESC, t.id DESC;`);
      const items = await databaseReadRequest(pool).query<ActivityRow>(`${visibleActivityCte}
        SELECT TOP (100) CAST(id AS varchar(19)) AS id, category, title, link, at
        FROM visible ORDER BY visible.at DESC, visible.id DESC;`);

      return {
        running: running.recordset.map((task) => ({ ...task, startedAt: iso(task.startedAt) })),
        items: items.recordset.map((item) => ({ ...item, at: iso(item.at) })),
        updatedAt: new Date().toISOString(),
      };
    },

    async dismiss(id: string): Promise<boolean> {
      const { recordset } = await pool.request()
        .input('id', sql.BigInt, BigInt(id))
        .query<{ id: string }>(`UPDATE dbo.activity SET dismissed_at = COALESCE(dismissed_at, SYSUTCDATETIME())
          WHERE id = @id;
          SELECT CAST(id AS varchar(19)) AS id FROM dbo.activity WHERE id = @id;`);
      return recordset.length > 0;
    },

    async dismissGroup(category: string): Promise<number> {
      const { recordset } = await pool.request()
        .input('category', sql.NVarChar(16), category)
        .query<{ dismissed: number }>(`${visibleActivityCte}
          UPDATE dbo.activity SET dismissed_at = COALESCE(dismissed_at, SYSUTCDATETIME())
          WHERE id IN (SELECT id FROM visible WHERE category = @category);
          SELECT @@ROWCOUNT AS dismissed;`);
      return recordset[0]?.dismissed ?? 0;
    },

    async dismissAll(): Promise<number> {
      const { recordset } = await pool.request().query<{ dismissed: number }>(`${visibleActivityCte}
        UPDATE dbo.activity SET dismissed_at = COALESCE(dismissed_at, SYSUTCDATETIME())
        WHERE id IN (SELECT id FROM visible);
        SELECT @@ROWCOUNT AS dismissed;`);
      return recordset[0]?.dismissed ?? 0;
    },

    async recordNotification(kind, text) {
      if (!['info', 'success', 'warning', 'error'].includes(kind) ||
          typeof text !== 'string' || !text.trim() || text.length > 400) {
        throw new TypeError('Invalid activity notification');
      }
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      let created = false;
      try {
        const { recordset } = await new sql.Request(transaction).query<{ kind: string; title: string; at: Date }>(
          `SELECT kind, title, at FROM dbo.activity WITH (UPDLOCK, HOLDLOCK)
            WHERE alert_key LIKE N'notification:%' AND at > DATEADD(day, -1, SYSUTCDATETIME());`);
        const recent: RecentNotification[] = (recordset ?? []).map((row) => ({
          kind: row.kind as RecentNotification['kind'], title: row.title, at: new Date(row.at),
        }));
        const admission = admitNotification(recent, { kind: kind as RecentNotification['kind'], title: text }, new Date());
        if (admission === 'admit') {
          await new sql.Request(transaction)
            .input('kind', sql.NVarChar(32), kind)
            .input('title', sql.NVarChar(400), text)
            .input('alertKey', sql.NVarChar(200), `notification:${randomUUID()}`)
            .query(`INSERT dbo.activity (area, kind, title, alert_key)
              VALUES (N'operations', @kind, @title, @alertKey);`);
          created = true;
        }
        await transaction.commit();
      } catch (error) {
        await transaction.rollback().catch(() => undefined);
        throw error;
      }
      if (created) onNotificationCreated();
    },
  };
}

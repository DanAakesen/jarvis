import sql from 'mssql';
import { databaseReadRequest } from './wake-retry.js';
import type { NowFeed, NowFeedStore, NowRunningTask, NowActivityItem } from '../core/now.js';

interface RunningTaskRow extends Omit<NowRunningTask, 'startedAt'> {
  startedAt: Date | string;
}

interface ActivityRow extends Omit<NowActivityItem, 'at'> {
  at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function createNowFeedStore(pool: sql.ConnectionPool): NowFeedStore {
  return {
    async read(): Promise<NowFeed> {
      const running = await databaseReadRequest(pool).query<RunningTaskRow>(`SELECT TOP (100)
        CAST(t.id AS varchar(19)) AS id, t.title, p.name AS project, t.agent,
        COALESCE(NULLIF(t.activity, N''), N'Running') AS activity,
        COALESCE(t.started_at, t.created_at) AS startedAt
        FROM dbo.tasks AS t
        INNER JOIN dbo.projects AS p ON p.id = t.project_id
        WHERE t.state = N'Running'
        ORDER BY COALESCE(t.started_at, t.created_at) DESC, t.id DESC;`);
      const items = await databaseReadRequest(pool).query<ActivityRow>(`WITH attention AS (
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
        )
        SELECT TOP (100) CAST(id AS varchar(19)) AS id, category, title, link, at
        FROM visible ORDER BY at DESC, id DESC;`);

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
  };
}

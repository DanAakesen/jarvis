import sql from 'mssql';

export type TaskNotificationState = 'Done' | 'NeedsAttention' | 'Cancelled' | 'pull_request_opened';

export interface TaskStatusNotificationStore {
  claim(taskId: string, state: TaskNotificationState): Promise<boolean>;
}

export function createTaskStatusNotificationStore(pool: sql.ConnectionPool): TaskStatusNotificationStore {
  return {
    async claim(taskId, state) {
      const result = await pool.request()
        .input('taskId', sql.BigInt, BigInt(taskId))
        .input('state', sql.NVarChar(32), state)
        .query<{ taskId: string }>(`INSERT dbo.task_status_notifications (task_id, state)
          OUTPUT CONVERT(varchar(19), inserted.task_id) AS taskId
          SELECT @taskId, @state
          WHERE NOT EXISTS (
            SELECT 1 FROM dbo.task_status_notifications WITH (UPDLOCK, HOLDLOCK)
            WHERE task_id = @taskId AND state = @state
          );`);
      return result.recordset.length > 0;
    },
  };
}

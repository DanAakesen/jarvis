import sql from 'mssql';

export type TaskNotificationState = 'Done' | 'NeedsAttention' | 'Cancelled' | 'pull_request_opened';
export interface TaskStatusNotificationMessage { sessionId: string; text: string; language: 'da' | 'en' }
export interface TaskStatusNotificationStore {
  /** Atomically writes the conversation message and its task/state deduplication receipt. */
  deliver(taskId: string, state: TaskNotificationState, message: TaskStatusNotificationMessage): Promise<boolean>;
}
export function createTaskStatusNotificationStore(pool: sql.ConnectionPool): TaskStatusNotificationStore {
  return {
    async deliver(taskId, state, message) {
      const result = await pool.request()
        .input('taskId', sql.BigInt, BigInt(taskId)).input('state', sql.NVarChar(32), state)
        .input('sessionId', sql.BigInt, BigInt(message.sessionId))
        .input('text', sql.NVarChar(sql.MAX), message.text).input('language', sql.NVarChar(8), message.language)
        .query<{ delivered: boolean }>(`SET XACT_ABORT ON;
          BEGIN TRY
            BEGIN TRANSACTION;
            DECLARE @delivered bit = 0;
            IF NOT EXISTS (SELECT 1 FROM dbo.task_status_notifications WITH (UPDLOCK, HOLDLOCK)
              WHERE task_id = @taskId AND state = @state)
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM dbo.jarvis_sessions WHERE id = @sessionId)
                THROW 50001, 'Notification conversation unavailable', 1;
              INSERT dbo.messages (jarvis_session_id, role, text, model, language)
                VALUES (@sessionId, N'jarvis', @text, NULL, @language);
              INSERT dbo.task_status_notifications (task_id, state) VALUES (@taskId, @state);
              SET @delivered = 1;
            END;
            COMMIT TRANSACTION;
            SELECT @delivered AS delivered;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
      return result.recordset[0]?.delivered === true;
    },
  };
}

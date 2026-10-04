import sql from 'mssql';
import type { ScreenFrameUsageStore } from '../vision/screen.js';

function utcDay(value: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  return { start, end };
}

export function createScreenFrameUsageStore(pool: sql.ConnectionPool): ScreenFrameUsageStore {
  return {
    async reserveFrame({ sessionId, eventId, dailyCap, at }) {
      const { start, end } = utcDay(at);
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const result = await transaction.request()
          .input('sessionId', sql.BigInt, BigInt(sessionId))
          .input('eventId', sql.NVarChar(300), `screen:${eventId}`)
          .input('dailyCap', sql.Int, dailyCap)
          .input('dayStart', sql.DateTime2, start)
          .input('dayEnd', sql.DateTime2, end)
          .input('at', sql.DateTime2, at)
          .input('lockResource', sql.NVarChar(255), `jarvis.screen-frame-cap:${start.toISOString().slice(0, 10)}`)
          .query<{ outcome: 'reserved' | 'rate-limited' | 'limit' | 'inactive' }>(`DECLARE @lock_result int;
            EXEC @lock_result = sys.sp_getapplock
              @Resource = @lockResource,
              @LockMode = 'Exclusive',
              @LockOwner = 'Transaction',
              @LockTimeout = 5000;
            IF @lock_result < 0 THROW 51000, 'Screen usage lock unavailable', 1;

            IF NOT EXISTS (
              SELECT 1 FROM dbo.jarvis_sessions WITH (UPDLOCK, HOLDLOCK)
              WHERE id = @sessionId AND ended_at IS NULL
            )
              SELECT CAST(N'inactive' AS nvarchar(10)) AS outcome;
            ELSE IF EXISTS (
              SELECT 1
              FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
              WHERE jarvis_session_id = @sessionId AND source = N'jarvis_model'
                AND metric = N'screen_frames' AND at > DATEADD(millisecond, -3000, @at)
            )
              SELECT CAST(N'rate-limited' AS nvarchar(20)) AS outcome;
            ELSE IF (
              SELECT COUNT_BIG(*)
              FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
              WHERE source = N'jarvis_model' AND metric = N'screen_frames'
                AND at >= @dayStart AND at < @dayEnd
            ) >= @dailyCap
              SELECT CAST(N'limit' AS nvarchar(10)) AS outcome;
            ELSE
            BEGIN
              INSERT INTO dbo.usage
                (jarvis_session_id, source, metric, quantity, source_event_id, at)
              VALUES
                (@sessionId, N'jarvis_model', N'screen_frames', 1, @eventId, @at);
              SELECT CAST(N'reserved' AS nvarchar(10)) AS outcome;
            END;`);
        await transaction.commit();
        return result.recordset[0]?.outcome ?? 'inactive';
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Screen usage could not be reserved');
      }
    },

    async recordTokens({ sessionId, eventId, inputTokens, outputTokens, at }) {
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        for (const [metric, quantity] of [
          ['input_tokens', inputTokens],
          ['output_tokens', outputTokens],
        ] as const) {
          if (quantity === 0) continue;
          await transaction.request()
            .input('sessionId', sql.BigInt, BigInt(sessionId))
            .input('metric', sql.NVarChar(32), metric)
            .input('quantity', sql.Decimal(19, 6), quantity)
            .input('eventId', sql.NVarChar(300), `screen:${eventId}`)
            .input('at', sql.DateTime2, at)
            .query(`INSERT INTO dbo.usage
              (jarvis_session_id, source, metric, quantity, source_event_id, at)
              VALUES (@sessionId, N'jarvis_model', @metric, @quantity, @eventId, @at);`);
        }
        await transaction.commit();
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Screen usage could not be recorded');
      }
    },
  };
}

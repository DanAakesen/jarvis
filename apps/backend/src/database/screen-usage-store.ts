import sql from 'mssql';
import type { ScreenFrameUsageStore } from '../vision/screen.js';
import type { VisionWatchUsageStore } from '../vision/watch.js';
import { databaseReadRequest } from './wake-retry.js';

/**
 * Each pending frame holds 0.1 DKK, including on-demand frames. The allowance
 * targets gpt-6-luna with a <=1 MB JPEG, 500 output tokens, and bounded context:
 * 5,000-character summary/question, 20 * 300 instructions, 64 * 1,000 comments.
 * Admission must fit the entire hold; only a known cost replaces it. Failed or
 * unknown-cost calls keep it charged for their UTC day, without a refund.
 * This is a conservative allowance, not a tokenizer-proven upper bound: revise
 * it if model/pricing/context changes or unusually token-dense input is allowed.
 */
export const WATCH_FRAME_PENDING_COST_DKK = 0.1;

function utcDay(value: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1_000);
  return { start, end };
}

export function createScreenFrameUsageStore(pool: sql.ConnectionPool): ScreenFrameUsageStore & VisionWatchUsageStore {
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
          .input('pendingCostDkk', sql.Decimal(12, 4), WATCH_FRAME_PENDING_COST_DKK)
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
                (jarvis_session_id, source, metric, quantity, cost_dkk, source_event_id, at)
              VALUES
                (@sessionId, N'jarvis_model', N'screen_frames', 1, @pendingCostDkk, @eventId, @at);
              SELECT CAST(N'reserved' AS nvarchar(10)) AS outcome;
            END;`);
        await transaction.commit();
        return result.recordset[0]?.outcome ?? 'inactive';
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Screen usage could not be reserved');
      }
    },

    async reserveWatchFrame({ sessionId, eventId, source, limitDkk, at }) {
      if (!Number.isFinite(limitDkk) || limitDkk < 0 || limitDkk > 99_999_999.9999 ||
          !Number.isFinite(at.getTime()) || !['screen', 'camera'].includes(source) ||
          !eventId.startsWith(`watch:${source}:`) || eventId.length > 293 ||
          eventId.length <= `watch:${source}:`.length) {
        throw new Error('Invalid watch frame reservation');
      }
      const { start, end } = utcDay(at);
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const result = await transaction.request()
          .input('sessionId', sql.BigInt, BigInt(sessionId))
          .input('eventId', sql.NVarChar(300), `screen:${eventId}`)
          .input('sourcePrefix', sql.NVarChar(32), `screen:watch:${source}:%`)
          .input('limitDkk', sql.Decimal(12, 4), Math.floor(limitDkk * 10_000) / 10_000)
          .input('pendingCostDkk', sql.Decimal(12, 4), WATCH_FRAME_PENDING_COST_DKK)
          .input('dayStart', sql.DateTime2, start)
          .input('dayEnd', sql.DateTime2, end)
          .input('at', sql.DateTime2, at)
          .input('lockResource', sql.NVarChar(255), `jarvis.screen-frame-cap:${start.toISOString().slice(0, 10)}`)
          .query<{ outcome: 'reserved' | 'rate-limited' | 'limit' | 'inactive'; usedDkk: number }>(`
            DECLARE @lock_result int;
            EXEC @lock_result = sys.sp_getapplock
              @Resource = @lockResource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 5000;
            IF @lock_result < 0 THROW 51000, 'Screen usage lock unavailable', 1;

            DECLARE @usedDkk decimal(38,4) = (
              SELECT COALESCE(SUM(cost_dkk), 0)
              FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
              WHERE source = N'jarvis_model' AND metric = N'screen_frames'
                AND at >= @dayStart AND at < @dayEnd
            );
            IF NOT EXISTS (
              SELECT 1 FROM dbo.jarvis_sessions WITH (UPDLOCK, HOLDLOCK)
              WHERE id = @sessionId AND ended_at IS NULL
            )
              SELECT N'inactive' AS outcome, @usedDkk AS usedDkk;
            ELSE IF EXISTS (
              SELECT 1 FROM dbo.usage WITH (UPDLOCK, HOLDLOCK)
              WHERE jarvis_session_id = @sessionId AND source = N'jarvis_model'
                AND metric = N'screen_frames' AND source_event_id LIKE @sourcePrefix
                AND at > DATEADD(millisecond, -2500, @at)
            )
              SELECT N'rate-limited' AS outcome, @usedDkk AS usedDkk;
            ELSE IF @usedDkk + @pendingCostDkk > @limitDkk
              SELECT N'limit' AS outcome, @usedDkk AS usedDkk;
            ELSE
            BEGIN
              INSERT INTO dbo.usage
                (jarvis_session_id, source, metric, quantity, cost_dkk, source_event_id, at)
              VALUES
                (@sessionId, N'jarvis_model', N'screen_frames', 1, @pendingCostDkk, @eventId, @at);
              SELECT N'reserved' AS outcome, @usedDkk + @pendingCostDkk AS usedDkk;
            END;`);
        const reservation = result.recordset[0];
        if (!reservation || !Number.isFinite(reservation.usedDkk) || reservation.usedDkk < 0 ||
            !['reserved', 'rate-limited', 'limit', 'inactive'].includes(reservation.outcome)) {
          throw new Error('Invalid watch usage result');
        }
        await transaction.commit();
        return reservation;
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Watch usage could not be reserved');
      }
    },

    async readWatchBudget(at) {
      if (!Number.isFinite(at.getTime())) throw new Error('Invalid watch budget date');
      const { start, end } = utcDay(at);
      try {
        const result = await databaseReadRequest(pool)
          .input('dayStart', sql.DateTime2, start)
          .input('dayEnd', sql.DateTime2, end)
          .query<{ usedDkk: number }>(`SELECT COALESCE(SUM(cost_dkk), 0) AS usedDkk
            FROM dbo.usage
            WHERE source = N'jarvis_model' AND metric = N'screen_frames'
              AND at >= @dayStart AND at < @dayEnd;`);
        const usedDkk = result.recordset[0]?.usedDkk;
        if (usedDkk === undefined || !Number.isFinite(usedDkk) || usedDkk < 0) {
          throw new Error('Invalid watch budget result');
        }
        return usedDkk;
      } catch {
        throw new Error('Watch budget could not be read');
      }
    },

    async recordTokens({ sessionId, eventId, inputTokens, outputTokens, costDkk, at }) {
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin();
        const frameUsage = await transaction.request()
          .input('sessionId', sql.BigInt, BigInt(sessionId))
          .input('eventId', sql.NVarChar(300), `screen:${eventId}`)
          .input('costDkk', sql.Decimal(12, 4), costDkk)
          .query(`DECLARE @frameAt datetime2(7), @lockResource nvarchar(255), @lock_result int;
            SELECT @frameAt = at FROM dbo.usage WITH (READCOMMITTEDLOCK)
            WHERE jarvis_session_id = @sessionId AND source = N'jarvis_model'
              AND metric = N'screen_frames' AND source_event_id = @eventId;
            IF @frameAt IS NULL THROW 51000, 'Screen frame reservation was not found', 1;
            SET @lockResource = N'jarvis.screen-frame-cap:' + CONVERT(nvarchar(10), @frameAt, 23);
            EXEC @lock_result = sys.sp_getapplock
              @Resource = @lockResource, @LockMode = 'Exclusive',
              @LockOwner = 'Transaction', @LockTimeout = 5000;
            IF @lock_result < 0 THROW 51000, 'Screen usage lock unavailable', 1;
            UPDATE dbo.usage
            SET cost_dkk = COALESCE(@costDkk, cost_dkk)
            WHERE source = N'jarvis_model' AND metric = N'screen_frames'
              AND source_event_id = @eventId AND jarvis_session_id = @sessionId;`);
        if (frameUsage.rowsAffected.at(-1) !== 1) throw new Error('Screen frame reservation was not found');
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

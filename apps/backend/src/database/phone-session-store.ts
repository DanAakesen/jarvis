import sql from 'mssql';

export interface PhoneCallSession {
  readonly sessionId: string;
  readonly callId: string;
  readonly callerId: string;
  readonly callConnectionId: string | null;
  readonly status: 'answering' | 'active' | 'ended' | 'failed';
}

export interface PhoneSessionStore {
  create(input: {
    readonly eventId: string;
    readonly callId: string;
    readonly callerId: string;
  }): Promise<PhoneCallSession | null>;
  isActive(sessionId: string, callerId: string): Promise<boolean>;
  activate(sessionId: string, callConnectionId: string): Promise<boolean>;
  finish(sessionId: string, status: 'ended' | 'failed'): Promise<void>;
  active(): Promise<readonly PhoneCallSession[]>;
}

interface PhoneCallSessionRow {
  session_id: string;
  call_id: string;
  caller_id: string;
  call_connection_id: string | null;
  status: PhoneCallSession['status'];
}

function isDuplicate(error: unknown): boolean {
  return typeof error === 'object' && error !== null &&
    'number' in error && (error.number === 2601 || error.number === 2627);
}

function mapRow(row: PhoneCallSessionRow): PhoneCallSession {
  return {
    sessionId: row.session_id,
    callId: row.call_id,
    callerId: row.caller_id,
    callConnectionId: row.call_connection_id,
    status: row.status,
  };
}

export function createPhoneSessionStore(pool: sql.ConnectionPool): PhoneSessionStore {
  return {
    async create({ eventId, callId, callerId }) {
      if (!/^[A-Za-z0-9._-]{1,128}$/u.test(eventId) ||
          !/^[A-Za-z0-9._-]{1,128}$/u.test(callId) ||
          !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(callerId)) {
        throw new TypeError('Invalid phone call session');
      }
      try {
        const { recordset } = await pool.request()
          .input('eventId', sql.VarChar(128), eventId)
          .input('callId', sql.VarChar(128), callId)
          .input('callerId', sql.NVarChar(64), callerId.toLowerCase())
          .query<PhoneCallSessionRow>(`DECLARE @created TABLE (session_id bigint NOT NULL);
            BEGIN TRY
              BEGIN TRANSACTION;
              INSERT INTO dbo.jarvis_sessions (channel, language)
                OUTPUT INSERTED.id INTO @created
                VALUES (N'phone', N'en');
              INSERT INTO dbo.phone_sessions (jarvis_session_id, event_id, call_id, caller_kind, caller_id)
                SELECT session_id, @eventId, @callId, 'entra', @callerId FROM @created;
              COMMIT TRANSACTION;
            END TRY
            BEGIN CATCH
              IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
              THROW;
            END CATCH;
            SELECT CONVERT(varchar(20), ps.jarvis_session_id) AS session_id, ps.call_id,
              ps.caller_id, ps.call_connection_id, ps.status
            FROM dbo.phone_sessions AS ps
            INNER JOIN @created AS c ON c.session_id = ps.jarvis_session_id;`);
        const row = recordset[0];
        if (!row) throw new Error('Phone call session was not created');
        return mapRow(row);
      } catch (error) {
        if (isDuplicate(error)) return null;
        throw error;
      }
    },
    async isActive(sessionId, callerId) {
      if (!/^[1-9]\d{0,18}$/u.test(sessionId) ||
          BigInt(sessionId) > 9_223_372_036_854_775_807n ||
          !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(callerId)) return false;
      const { recordset } = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('callerId', sql.NVarChar(64), callerId.toLowerCase())
        .query<{ active: number }>(`SELECT 1 AS active
          FROM dbo.phone_sessions
          WHERE jarvis_session_id = @sessionId AND caller_kind = 'entra'
            AND caller_id = @callerId AND status = 'active';`);
      return recordset.length === 1;
    },
    async activate(sessionId, callConnectionId) {
      if (!/^[1-9]\d{0,18}$/u.test(sessionId) ||
          BigInt(sessionId) > 9_223_372_036_854_775_807n ||
          !callConnectionId || callConnectionId.length > 256 ||
          /[\u0000-\u001f\u007f]/u.test(callConnectionId)) return false;
      const { rowsAffected } = await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('callConnectionId', sql.NVarChar(256), callConnectionId)
        .query(`UPDATE dbo.phone_sessions
          SET call_connection_id = @callConnectionId, status = 'active'
          WHERE jarvis_session_id = @sessionId AND status = 'answering';`);
      return (rowsAffected[0] ?? 0) > 0;
    },
    async finish(sessionId, status) {
      if (!/^[1-9]\d{0,18}$/u.test(sessionId) || BigInt(sessionId) > 9_223_372_036_854_775_807n) {
        throw new TypeError('Invalid phone call session');
      }
      await pool.request()
        .input('sessionId', sql.BigInt, BigInt(sessionId))
        .input('status', sql.VarChar(16), status)
        .query(`BEGIN TRY
            BEGIN TRANSACTION;
            UPDATE dbo.phone_sessions
            SET status = @status, ended_at = SYSUTCDATETIME()
            WHERE jarvis_session_id = @sessionId AND status IN ('answering', 'active');
            UPDATE dbo.jarvis_sessions
            SET ended_at = SYSUTCDATETIME()
            WHERE id = @sessionId AND channel = N'phone' AND ended_at IS NULL;
            COMMIT TRANSACTION;
          END TRY
          BEGIN CATCH
            IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
            THROW;
          END CATCH;`);
    },
    async active() {
      const { recordset } = await pool.request().query<PhoneCallSessionRow>(`SELECT TOP (51)
          CONVERT(varchar(20), jarvis_session_id) AS session_id, call_id, caller_id,
          call_connection_id, status
        FROM dbo.phone_sessions
        WHERE status IN ('answering', 'active');`);
      return recordset.map(mapRow);
    },
  };
}

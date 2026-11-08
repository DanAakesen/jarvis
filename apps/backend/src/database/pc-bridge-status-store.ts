import sql from 'mssql';

export interface PcBridgeStatusStore {
  setStatus(online: boolean, controlPaused?: boolean): Promise<void>;
}

export function createPcBridgeStatusStore(
  pool: sql.ConnectionPool,
  onChanged: () => void,
): PcBridgeStatusStore {
  let precedingWrite: Promise<void> = Promise.resolve();
  return {
    setStatus(online, controlPaused = false) {
      const write = precedingWrite.then(async () => {
        const title = online
          ? `Local PC bridge is online — Jarvis control is ${controlPaused ? 'paused' : 'active'}`
          : 'Local PC bridge is offline';
        const transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const result = await new sql.Request(transaction)
            .input('title', sql.NVarChar(400), title)
            .input('online', sql.Bit, online)
            .query(`IF EXISTS (
                SELECT 1 FROM dbo.activity WITH (UPDLOCK, HOLDLOCK)
                WHERE alert_key = N'pc_bridge_status'
              )
                UPDATE dbo.activity
                  SET title = @title, at = SYSUTCDATETIME(),
                    dismissed_at = CASE WHEN @online = 1
                      THEN COALESCE(dismissed_at, SYSUTCDATETIME()) ELSE NULL END
                  WHERE alert_key = N'pc_bridge_status'
                    AND (title <> @title OR (@online = 1 AND dismissed_at IS NULL));
              ELSE
                INSERT dbo.activity (area, kind, title, link, alert_key, dismissed_at)
                VALUES (N'operations', N'pc_bridge_status', @title, NULL, N'pc_bridge_status',
                  CASE WHEN @online = 1 THEN SYSUTCDATETIME() ELSE NULL END);`);
          await transaction.commit();
          if (result.rowsAffected.some((count) => count > 0)) onChanged();
        } catch (error) {
          await transaction.rollback().catch(() => undefined);
          throw error;
        }
      });
      precedingWrite = write.catch(() => {});
      return write;
    },
  };
}

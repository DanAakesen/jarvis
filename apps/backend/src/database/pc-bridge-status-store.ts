import sql from 'mssql';

export interface PcBridgeStatusStore {
  setStatus(online: boolean): Promise<void>;
}

export function createPcBridgeStatusStore(
  pool: sql.ConnectionPool,
  onChanged: () => void,
): PcBridgeStatusStore {
  let precedingWrite: Promise<void> = Promise.resolve();
  return {
    setStatus(online) {
      const write = precedingWrite.then(async () => {
        const title = `Local PC bridge is ${online ? 'online' : 'offline'}`;
        const transaction = new sql.Transaction(pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          await new sql.Request(transaction)
            .input('title', sql.NVarChar(400), title)
            .query(`UPDATE dbo.activity WITH (UPDLOCK, HOLDLOCK)
                SET title = @title, at = SYSUTCDATETIME(), dismissed_at = NULL
                WHERE alert_key = N'pc_bridge_status';
              IF @@ROWCOUNT = 0
                INSERT dbo.activity (area, kind, title, link, alert_key)
                VALUES (N'operations', N'pc_bridge_status', @title, NULL, N'pc_bridge_status');`);
          await transaction.commit();
          onChanged();
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

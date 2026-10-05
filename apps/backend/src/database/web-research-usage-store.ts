import sql from 'mssql';

export interface WebResearchUsageStore {
  reserveMonthlyTransaction(input: {
    readonly at: Date;
    readonly monthlyCap: number;
  }): Promise<'reserved' | 'limit'>;
}

export function createWebResearchUsageStore(pool: sql.ConnectionPool): WebResearchUsageStore {
  return {
    async reserveMonthlyTransaction({ at, monthlyCap }) {
      const monthStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
      const transaction = new sql.Transaction(pool);
      try {
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const result = await transaction.request()
          .input('monthStart', sql.Date, monthStart)
          .input('monthlyCap', sql.Int, monthlyCap)
          .input('lockResource', sql.NVarChar(255), `jarvis.web-research-cap:${monthStart.toISOString().slice(0, 7)}`)
          .query<{ outcome: 'reserved' | 'limit' }>(`DECLARE @lock_result int;
            EXEC @lock_result = sys.sp_getapplock
              @Resource = @lockResource,
              @LockMode = 'Exclusive',
              @LockOwner = 'Transaction',
              @LockTimeout = 5000;
            IF @lock_result < 0 THROW 51000, 'Web research usage lock unavailable', 1;

            UPDATE dbo.web_research_monthly_usage
              SET transaction_count = transaction_count + 1, updated_at = SYSUTCDATETIME()
              WHERE month_start = @monthStart AND transaction_count < @monthlyCap;
            IF @@ROWCOUNT = 1
              SELECT CAST(N'reserved' AS nvarchar(10)) AS outcome;
            ELSE IF EXISTS (
              SELECT 1 FROM dbo.web_research_monthly_usage WITH (UPDLOCK, HOLDLOCK)
              WHERE month_start = @monthStart
            )
              SELECT CAST(N'limit' AS nvarchar(10)) AS outcome;
            ELSE
            BEGIN
              INSERT INTO dbo.web_research_monthly_usage (month_start, transaction_count, updated_at)
              VALUES (@monthStart, 1, SYSUTCDATETIME());
              SELECT CAST(N'reserved' AS nvarchar(10)) AS outcome;
            END;`);
        await transaction.commit();
        return result.recordset[0]?.outcome ?? 'limit';
      } catch {
        try { await transaction.rollback(); } catch { /* Preserve the sanitized store error. */ }
        throw new Error('Web research usage could not be reserved');
      }
    },
  };
}

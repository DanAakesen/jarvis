import sql from 'mssql';

export async function withTaskPolicyLock<T>(
  pool: sql.ConnectionPool,
  taskId: string,
  operation: (transaction: sql.Transaction) => Promise<T>,
): Promise<T> {
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const { recordset } = await new sql.Request(transaction)
      .input('resource', sql.NVarChar(255), `jarvis.project-policy:${taskId}`)
      .query<{ result: number }>(`DECLARE @result int;
        EXEC @result = sys.sp_getapplock
          @Resource = @resource, @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 10000;
        SELECT @result AS result;`);
    if ((recordset[0]?.result ?? -1) < 0) throw new Error('Project policy coordination lock unavailable');
    const result = await operation(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Preserve the error that caused the transaction to fail.
    }
    throw error;
  }
}

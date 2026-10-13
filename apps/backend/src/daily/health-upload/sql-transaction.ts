import sql from 'mssql';
import { HealthConflict,HealthDenied,HealthUnavailable } from './contracts.js';

/** Reuses the backend pool; never constructs credentials or a second connection pool. */
export async function healthSqlQuery(request: sql.Request,query: string,signal: AbortSignal) {
  const cancel = () => request.cancel();
  signal.addEventListener('abort',cancel,{ once: true });
  try { signal.throwIfAborted(); return await request.query<Record<string,unknown>>(query); }
  finally { signal.removeEventListener('abort',cancel); }
}
export async function healthSqlTransaction<T>(pool: sql.ConnectionPool,owner: string,signal: AbortSignal,action: (tx: sql.Transaction,signal: AbortSignal) => Promise<T>): Promise<T> {
  const bounded = AbortSignal.any([signal,AbortSignal.timeout(30000)]);
  const tx = new sql.Transaction(pool);
  let started = false;
  try {
    bounded.throwIfAborted();
    // Pool acquisition retains the existing backend's finite 30-second timeout.
    await tx.begin(); started = true;
    await healthSqlQuery(new sql.Request(tx).input('lock',sql.NVarChar(255),`daily-health:${owner}`),
      "DECLARE @result int; EXEC @result=sys.sp_getapplock @Resource=@lock,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=5000; IF @result<0 THROW 51046,'Health inbox busy',1;",bounded);
    const result = await action(tx,bounded);
    bounded.throwIfAborted(); await tx.commit();
    return result;
  } catch (error) {
    if (started) await tx.rollback().catch(() => undefined);
    if (!bounded.aborted && (error instanceof HealthConflict || error instanceof HealthDenied || error instanceof TypeError)) throw error;
    // Includes uncertain commit acknowledgement. Retry the SAME identity, not a new operation.
    throw new HealthUnavailable();
  }
}

import sql from 'mssql';
import { AsyncLocalStorage } from 'node:async_hooks';

export const databaseWakeTimeoutMs = 90_000;
const resumeNumbers = new Set([40613, 40197, 40501]);

export function isDatabaseResumeError(error: unknown): boolean {
  const pending: { value: unknown; depth: number }[] = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  for (let visited = 0; pending.length && visited < 32; visited++) {
    const { value, depth } = pending.shift()!;
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    const item = value as Record<string, unknown>;
    if (typeof item.number === 'number' && resumeNumbers.has(item.number)) return true;
    if (item.code === 'ETIMEOUT' && item.name === 'ConnectionError') return true;
    if (item.code === 'ETIMEDOUT' && item.name !== 'RequestError') return true;
    // Tarn's TimeoutError inherits Error.name ("Error"), without a code.
    if (typeof value.constructor === 'function' && value.constructor.name === 'TimeoutError') return true;
    if (depth >= 5) continue;
    for (const nested of [item.originalError, item.cause, item.info]) pending.push({ value: nested, depth: depth + 1 });
    if (Array.isArray(item.precedingErrors)) {
      for (const nested of item.precedingErrors.slice(0, 32)) pending.push({ value: nested, depth: depth + 1 });
    }
  }
  return false;
}

type Requester = { canceled?: boolean; cancel?: () => unknown };
type AcquireCallback = (error: Error | null, connection?: unknown, config?: sql.config) => void;
// mssql's public runtime acquire/release API is omitted from @types/mssql.
type AcquiringPool = sql.ConnectionPool & {
  config: sql.config;
  acquire(requester: Requester, callback?: AcquireCallback): Promise<unknown> | sql.ConnectionPool;
  release(connection: unknown): sql.ConnectionPool;
};

const readRetries = new WeakMap<sql.ConnectionPool, <T>(request: sql.Request, operation: () => Promise<T>) => Promise<T>>();

// Only explicitly reviewed, nontransactional, nonstreaming reads use this helper.
export function databaseReadRequest(pool: sql.ConnectionPool): sql.Request {
  const request = pool.request();
  const retry = readRetries.get(pool);
  if (!retry) return request;
  const query = request.query.bind(request);
  request.query = function <T>(command: string, ...rest: unknown[]) {
    if (rest.length || request.stream || typeof command !== 'string') return Reflect.apply(query, request, [command, ...rest]);
    return retry(request, () => query<T>(command));
  } as sql.Request['query'];
  return request;
}

export function createDatabaseWakeRetry(pool: sql.ConnectionPool, shutdown: AbortSignal) {
  let activeWaits = 0;
  const attempts = new Set<Promise<unknown>>();
  const readDeadline = new AsyncLocalStorage<number>();

  async function run<T>(
    operation: () => Promise<T>,
    lateResult?: (result: T) => void,
    signal?: AbortSignal,
    readCancellation?: () => void,
  ): Promise<T> {
    shutdown.throwIfAborted();
    signal?.throwIfAborted();
    const deadline = readDeadline.getStore() ?? Date.now() + databaseWakeTimeoutMs;
    let waking = false;
    let ended = false;
    let backoffTimer: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;
    let enforceDeadline = !readCancellation;
    let rejectStopped!: (error: Error) => void;
    const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
    const stop = () => {
      if (ended) return;
      ended = true;
      if (backoffTimer) clearTimeout(backoffTimer);
      rejectStopped(new sql.ConnectionError('Database connection wait cancelled', 'ECANCEL'));
      readCancellation?.();
    };
    shutdown.addEventListener('abort', stop, { once: true });
    signal?.addEventListener('abort', stop, { once: true });
    const armDeadline = () => {
      enforceDeadline = true;
      timer = setTimeout(() => {
        ended = true;
        if (backoffTimer) clearTimeout(backoffTimer);
        rejectStopped(new sql.ConnectionError('Database wake deadline exceeded', 'ETIMEOUT'));
        readCancellation?.();
      }, Math.max(0, deadline - Date.now()));
    };
    // An ordinary read retains its query timeout. Only a resume error activates
    // the wake deadline, measured from the original read/acquisition start.
    if (enforceDeadline) armDeadline();
    try {
      let failures = 0;
      while (true) {
        if (ended || Date.now() >= deadline) throw new sql.ConnectionError('Database wake deadline exceeded', 'ETIMEOUT');
        const attempt = Promise.resolve().then(() => {
          shutdown.throwIfAborted();
          signal?.throwIfAborted();
          return operation();
        }).then((result) => {
          if (ended || shutdown.aborted || signal?.aborted || (enforceDeadline && Date.now() >= deadline)) {
            lateResult?.(result);
            throw new sql.ConnectionError('Database connection wait cancelled', 'ECANCEL');
          }
          return result;
        });
        attempts.add(attempt);
        void attempt.then(() => { attempts.delete(attempt); }, () => { attempts.delete(attempt); });
        try {
          return await Promise.race([attempt, stopped]);
        } catch (error) {
          if (ended || shutdown.aborted || signal?.aborted || !isDatabaseResumeError(error)) throw error;
          if (!enforceDeadline) armDeadline();
          if (!waking) { waking = true; activeWaits++; }
          const delay = Math.min(1_000 * 2 ** Math.min(failures++, 4), 10_000, deadline - Date.now());
          await Promise.race([
            new Promise<void>((resolve) => { backoffTimer = setTimeout(resolve, delay); }),
            stopped,
          ]);
        }
      }
    } finally {
      ended = true;
      if (waking) activeWaits--;
      if (timer) clearTimeout(timer);
      if (backoffTimer) clearTimeout(backoffTimer);
      shutdown.removeEventListener('abort', stop);
      signal?.removeEventListener('abort', stop);
    }
  }

  readRetries.set(pool, (request, operation) => {
    const cancellation = new AbortController();
    const cancel = request.cancel;
    const cancelRead = () => {
      try { return cancel.call(request); }
      finally { cancellation.abort(); }
    };
    request.cancel = cancelRead;
    return readDeadline.run(Date.now() + databaseWakeTimeoutMs, () =>
      run(operation, undefined, cancellation.signal, () => { request.cancel(); }),
    ).finally(() => {
      if (request.cancel === cancelRead) request.cancel = cancel;
    });
  });

  const acquiring = pool as AcquiringPool;
  const acquire = acquiring.acquire.bind(pool);
  acquiring.acquire = (requester, callback) => {
    const deadline = readDeadline.getStore() ?? Date.now() + databaseWakeTimeoutMs;
    const cancellation = new AbortController();
    const originalCancel = requester.cancel;
    const cancel = () => {
      try { return originalCancel?.call(requester); }
      finally { cancellation.abort(); }
    };
    if (originalCancel) requester.cancel = cancel;
    if (requester.canceled) cancellation.abort();
    const result = run(
      () => acquire(requester) as Promise<unknown>,
      (connection) => { acquiring.release(connection); },
      cancellation.signal,
    ).then((connection) => {
      if (shutdown.aborted || cancellation.signal.aborted || Date.now() >= deadline) {
        acquiring.release(connection);
        throw new sql.ConnectionError('Database connection wait cancelled', 'ECANCEL');
      }
      return connection;
    }).finally(() => {
      if (originalCancel && requester.cancel === cancel) requester.cancel = originalCancel;
    });
    if (callback) {
      void result.then(
        (connection) => {
          if (shutdown.aborted || requester.canceled || Date.now() >= deadline) {
            acquiring.release(connection);
            callback(new sql.ConnectionError('Database connection wait cancelled', 'ECANCEL'));
          } else callback(null, connection, acquiring.config);
        },
        (error: Error) => { callback(error); },
      );
      return pool;
    }
    return result;
  };

  return {
    run,
    isWaking: () => activeWaits > 0,
    async settle() { await Promise.allSettled([...attempts]); },
  };
}

import sql from 'mssql';
import type { buildApp } from '../app.js';
import { applyMigrations, readMigrations, defaultMigrationsDirectory } from './migrations.js';

export interface DatabaseLifecycle {
  initialize(): Promise<void>;
  close(): Promise<void>;
}

// The deadline includes SQL auto-resume, lock contention and every migration.
export const databaseStartupTimeoutMs = 300_000;

export function createDatabase(config: sql.config, directory = defaultMigrationsDirectory, timeoutMs = databaseStartupTimeoutMs) {
  const pool = new sql.ConnectionPool(config);
  // Driver errors can contain tokens/queries/provider details; never log them.
  pool.on('error', () => { /* Failed requests remain errors at their caller. */ });
  const controller = new AbortController();
  let work: Promise<void> | undefined;
  let initialization: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const closePool = () => closing ??= pool.close().then(() => {});
  return {
    pool,
    initialize() {
      if (initialization) return initialization;
      const signal = controller.signal;
      let timer: NodeJS.Timeout | undefined;
      let abort: (() => void) | undefined;
      work = (async () => {
        try {
          signal.throwIfAborted();
          const migrations = await readMigrations(directory);
          signal.throwIfAborted();
          await pool.connect();
          // mssql cannot close a connecting pool. If cancellation happened
          // during connect, this owner closes it as soon as connect settles.
          signal.throwIfAborted();
          await applyMigrations(pool, migrations, 60_000, signal);
        } catch {
          await closePool();
          throw new Error('Database startup failed');
        }
      })();
      const cancelled = new Promise<never>((_resolve, reject) => {
        abort = () => { reject(new Error('Database startup failed')); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        timer = setTimeout(() => { controller.abort(); }, timeoutMs);
      });
      // Race returns at the deadline; work remains owned and its late
      // connection/result is cleaned up, never allowed to begin more SQL.
      initialization = Promise.race([work, cancelled]).finally(() => {
        if (timer) clearTimeout(timer);
        if (abort) signal.removeEventListener('abort', abort);
      });
      return initialization;
    },
    async close() {
      controller.abort();
      // Rollback releases the app lock before destroying the pool. The
      // process-level shutdown deadline separately bounds this wait.
      await work?.catch(() => {});
      await closePool();
    },
  };
}

export function registerDatabase(app: ReturnType<typeof buildApp>, database: DatabaseLifecycle) {
  // Initialization is explicitly awaited before listen in index.ts. Fastify's
  // default ten-second ready-hook timeout is too short for SQL auto-resume.
  app.addHook('onClose', async () => { await database.close(); });
}

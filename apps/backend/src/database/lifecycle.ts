import sql from 'mssql';
import type { buildApp } from '../app.js';
import { applyMigrations, readMigrations, defaultMigrationsDirectory } from './migrations.js';

export interface DatabaseLifecycle {
  initialize(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(config: sql.config, directory = defaultMigrationsDirectory) {
  const pool = new sql.ConnectionPool(config);
  // Driver errors can contain tokens/queries/provider details; never log them.
  pool.on('error', () => { /* Failed requests remain errors at their caller. */ });
  return {
    pool,
    async initialize() {
      try {
        const migrations = await readMigrations(directory);
        await pool.connect();
        await applyMigrations(pool, migrations);
      } catch {
        await pool.close();
        throw new Error('Database startup failed');
      }
    },
    async close() { await pool.close(); },
  };
}

export function registerDatabase(app: ReturnType<typeof buildApp>, database: DatabaseLifecycle) {
  app.addHook('onReady', async () => {
    await database.initialize();
    app.log.info('database.ready');
  });
  app.addHook('onClose', async () => { await database.close(); });
}

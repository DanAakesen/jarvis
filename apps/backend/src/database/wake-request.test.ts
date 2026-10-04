import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createDatabase, registerDatabase } from './lifecycle.js';
import { createProjectStore } from './project-store.js';

vi.mock('./migrations.js', () => ({
  defaultMigrationsDirectory: '/fixture',
  readMigrations: vi.fn(async () => []),
  applyMigrations: vi.fn(async () => {}),
}));

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

it.each(['acquisition', 'execution'] as const)('serves an authenticated projects request after a >30-second %s resume error and exposes the concurrent wait', async (phase) => {
  const database = createDatabase({ server: 'fixture' });
  vi.spyOn(database.pool, 'connect').mockResolvedValue(database.pool);
  const close = vi.spyOn(database.pool, 'close').mockResolvedValue();
  const release = vi.fn();
  const project = {
    id: '42', name: 'Jarvis', repo: 'DanAakesen/jarvis', default_branch: 'main',
    default_agent: 'copilot', policy: 'deliver_pr', merge_rules: null,
    sandbox_size: '1x2', tech: 'node', max_parallel_tasks: 1, active: true,
  };
  const connection = new EventEmitter();
  const execSql = vi.fn((request: EventEmitter & { callback(error?: Error): void }) => {
    const metadata = Object.keys(project).map((colName) => ({ colName, type: {}, flags: 1 }));
    request.emit('columnMetadata', metadata);
    request.emit('row', metadata.map((column) => ({
      metadata: column, value: project[column.colName as keyof typeof project],
    })));
    request.emit('doneInProc', 1, false);
    request.callback();
  });
  Object.assign(connection, { execSql });
  const acquire = vi.fn().mockResolvedValue(connection);
  if (phase === 'acquisition') {
    acquire.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      setTimeout(() => { reject({ number: 40613 }); }, 30_000);
    }));
  } else {
    execSql.mockImplementationOnce((request) => {
      setTimeout(() => {
        request.callback(Object.assign(new Error('fixture resume'), { info: { number: 40613 } }));
      }, 30_000);
    });
  }
  // Exercise createDatabase's real public mssql acquire and Request methods;
  // only startup/migrations and physical connection transport are simulated.
  Object.assign(database.pool, { _connected: true, _acquire: acquire, release });
  await database.initialize();
  const config = { ...loadConfig({}), logLevel: 'silent' as const };
  const app = buildApp(config, undefined, {
    databaseStatus: database.isWaking,
    projectStore: createProjectStore(database.pool),
    auth: async () => ({ objectId: config.auth.ownerObjectId, tenantId: config.auth.tenantId }),
  });
  apps.push(app);
  registerDatabase(app, database);
  await app.ready();
  const headers = { authorization: ['Bearer', ['test', 'token', 'signature'].join('.')].join(' ') };
  expect((await app.inject({ url: '/database/status', headers })).json()).toEqual({ waking: false });

  vi.useFakeTimers();
  const started = Date.now();
  const response = app.inject({ url: '/factory/projects', headers });
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await app.inject({ url: '/database/status', headers })).json()).toEqual({ waking: true });
  expect(execSql).toHaveBeenCalledTimes(phase === 'acquisition' ? 0 : 1);
  await vi.advanceTimersByTimeAsync(1_001);
  const result = await response;
  expect(Date.now() - started).toBeGreaterThan(30_000);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual([project]);
  expect((await app.inject({ url: '/database/status', headers })).json()).toEqual({ waking: false });
  expect(acquire).toHaveBeenCalledTimes(2);
  expect(execSql).toHaveBeenCalledTimes(phase === 'acquisition' ? 1 : 2);
  expect(release).toHaveBeenCalledTimes(phase === 'acquisition' ? 1 : 2);
  expect(release).toHaveBeenLastCalledWith(connection);
  await vi.advanceTimersByTimeAsync(10);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  await app.close();
  expect(close).toHaveBeenCalledOnce();
});

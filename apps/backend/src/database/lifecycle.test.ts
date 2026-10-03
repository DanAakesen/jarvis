import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildApp } from '../app.js';
import { createDatabase, registerDatabase } from './lifecycle.js';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(async () => {}), close: vi.fn(async () => {}),
  read: vi.fn(async () => []), migrate: vi.fn(async () => {}),
}));
vi.mock('mssql', () => ({ default: { ConnectionPool: class {
  on() { return this; }
  connect = mocks.connect;
  close = mocks.close;
} } }));
vi.mock('./migrations.js', () => ({
  defaultMigrationsDirectory: '/fixture', readMigrations: mocks.read, applyMigrations: mocks.migrate,
}));
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
function app() { return buildApp({ port: 3000, logLevel: 'silent' }, pino({ level: 'silent' })); }

describe('database startup ownership', () => {
  it('awaits initialization outside Fastify ready hooks and closes resources once', async () => {
    const server = app();
    const database = createDatabase({ server: 'fixture' });
    registerDatabase(server, database);
    await server.ready();
    expect(mocks.connect).not.toHaveBeenCalled();
    const first = database.initialize();
    expect(database.initialize()).toBe(first);
    await first;
    expect(mocks.migrate).toHaveBeenCalledOnce();
    expect((await server.inject('/health')).statusCode).toBe(200);
    await server.close();
    await database.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('closes the pool when migration fails without exposing provider details', async () => {
    mocks.migrate.mockRejectedValueOnce(new Error('secret-provider-query'));
    const database = createDatabase({ server: 'fixture' });
    await expect(database.initialize()).rejects.toThrow('Database startup failed');
    await database.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('returns at the total deadline, then closes a late connection without running migrations', async () => {
    vi.useFakeTimers();
    const connection = deferred();
    mocks.connect.mockImplementationOnce(() => connection.promise);
    const database = createDatabase({ server: 'fixture' }, '/fixture', 25);
    const result = expect(database.initialize()).rejects.toThrow('Database startup failed');
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(mocks.migrate).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    connection.resolve();
    await database.close();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
  it('aborts active migrations at the deadline and awaits cleanup before pool close', async () => {
    vi.useFakeTimers();
    const cleanup = deferred();
    let signal: AbortSignal | undefined;
    mocks.migrate.mockImplementationOnce(async (...args: unknown[]) => {
      signal = args[3] as AbortSignal;
      await new Promise<void>((resolve) => { signal!.addEventListener('abort', () => { resolve(); }, { once: true }); });
      await cleanup.promise;
      throw new Error('cancelled');
    });
    const database = createDatabase({ server: 'fixture' }, '/fixture', 25);
    const result = expect(database.initialize()).rejects.toThrow('Database startup failed');
    await vi.advanceTimersByTimeAsync(25);
    await result;
    expect(signal?.aborted).toBe(true);
    expect(mocks.close).not.toHaveBeenCalled();
    cleanup.resolve();
    await database.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('shutdown during connection prevents subsequent migration work', async () => {
    const connection = deferred();
    mocks.connect.mockImplementationOnce(() => connection.promise);
    const database = createDatabase({ server: 'fixture' });
    const initialized = expect(database.initialize()).rejects.toThrow('Database startup failed');
    await vi.waitFor(() => { expect(mocks.connect).toHaveBeenCalledOnce(); });
    const closed = database.close();
    await initialized;
    connection.resolve();
    await closed;
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});

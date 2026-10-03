import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { buildApp } from '../app.js';
import { registerDatabase } from './lifecycle.js';

describe('database startup ownership', () => {
  it('finishes migrations before serving and closes resources once', async () => {
    const app = buildApp({ port: 3000, logLevel: 'silent' }, pino({ level: 'silent' }));
    const database = { initialize: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    registerDatabase(app, database);
    expect(database.initialize).not.toHaveBeenCalled();
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect(database.initialize).toHaveBeenCalledOnce();
    await app.close();
    expect(database.close).toHaveBeenCalledOnce();
  });
  it('refuses startup when migration fails and closes via app shutdown', async () => {
    const app = buildApp({ port: 3000, logLevel: 'silent' }, pino({ level: 'silent' }));
    const database = { initialize: vi.fn(async () => { throw new Error('Database startup failed'); }), close: vi.fn(async () => {}) };
    registerDatabase(app, database);
    await expect(app.ready()).rejects.toThrow('Database startup failed');
    await app.close();
    expect(database.close).toHaveBeenCalledOnce();
  });
});

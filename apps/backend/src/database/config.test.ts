import { describe, expect, it } from 'vitest';
import sql from 'mssql';
import { loadDatabaseConfig } from './config.js';

const managed = { SQL_SERVER: 'sql-jarvis-fixture.database.windows.net', SQL_DATABASE: 'jarvis', SQL_MANAGED_IDENTITY_CLIENT_ID: '12345678-1234-1234-1234-123456789012' };

describe('database configuration', () => {
  it('leaves the offline skeleton disconnected when no SQL settings exist', () => {
    expect(loadDatabaseConfig({})).toBeUndefined();
  });
  it('selects supported per-connection Entra managed identity with validated TLS', () => {
    const config = loadDatabaseConfig(managed)!;
    expect(config.authentication).toEqual({ type: 'azure-active-directory-msi-app-service', options: { clientId: managed.SQL_MANAGED_IDENTITY_CLIENT_ID } });
    expect(config.options).toMatchObject({ encrypt: true, trustServerCertificate: false });
    expect(config).toMatchObject({ connectionTimeout: 120_000, requestTimeout: 120_000, validateConnection: 'socket', pool: { min: 0 } });
    // Real mssql pool accepts this config; no connection or Azure request occurs.
    expect(new sql.ConnectionPool(config).config.authentication).toEqual(config.authentication);
  });
  it.each([
    { SQL_SERVER: 'sql-jarvis.database.windows.net' },
    { ...managed, SQL_MANAGED_IDENTITY_CLIENT_ID: 'invalid' },
    { ...managed, SQL_USER: 'sa', SQL_PASSWORD: 'do-not-log-this' },
    { ...managed, SQL_SERVER: '127.0.0.1' },
    { ...managed, SQL_AUTH_MODE: 'unknown' },
    { ...managed, SQL_PORT: '1433' },
  ])('fails closed for partial or unsafe configuration %#', (env) => {
    expect(() => loadDatabaseConfig(env)).toThrow();
    try { loadDatabaseConfig(env); } catch (error) { expect(String(error)).not.toContain('do-not-log-this'); }
  });
  it('permits isolated CI SQL login only on loopback in test mode', () => {
    const test = { NODE_ENV: 'test', SQL_AUTH_MODE: 'test-password', SQL_SERVER: '127.0.0.1', SQL_DATABASE: 'jarvis_ci', SQL_USER: 'sa', SQL_PASSWORD: 'fixture-only' };
    expect(loadDatabaseConfig(test)).toMatchObject({ user: 'sa', options: { encrypt: true, trustServerCertificate: true } });
    expect(() => loadDatabaseConfig({ ...test, NODE_ENV: 'production' })).toThrow();
    expect(() => loadDatabaseConfig({ ...test, SQL_SERVER: 'azure.database.windows.net' })).toThrow();
    expect(() => loadDatabaseConfig({ ...test, SQL_PORT: '0' })).toThrow();
  });
});

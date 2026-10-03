import type { config as SqlConfig } from 'mssql';
import { ConfigurationError } from '../config.js';

const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env): SqlConfig | undefined {
  const keys = ['SQL_SERVER', 'SQL_DATABASE', 'SQL_MANAGED_IDENTITY_CLIENT_ID', 'SQL_AUTH_MODE', 'SQL_USER', 'SQL_PASSWORD', 'SQL_PORT'];
  if (keys.every((key) => env[key] === undefined)) return undefined;
  const server = env.SQL_SERVER;
  const database = env.SQL_DATABASE;
  if (!server || !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(server)) {
    throw new ConfigurationError('SQL_SERVER must be a host name');
  }
  if (!database || !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(database)) {
    throw new ConfigurationError('SQL_DATABASE must be a database name');
  }
  const testLogin = env.SQL_AUTH_MODE === 'test-password';
  if (env.SQL_AUTH_MODE !== undefined && !testLogin && env.SQL_AUTH_MODE !== 'managed-identity') {
    throw new ConfigurationError('SQL_AUTH_MODE is invalid');
  }
  if (testLogin) {
    if (env.NODE_ENV !== 'test' || server !== '127.0.0.1') {
      throw new ConfigurationError('SQL test-password authentication is restricted to NODE_ENV=test and 127.0.0.1');
    }
    if (!env.SQL_USER || !env.SQL_PASSWORD || env.SQL_MANAGED_IDENTITY_CLIENT_ID !== undefined) {
      throw new ConfigurationError('SQL test-password authentication requires SQL_USER and SQL_PASSWORD only');
    }
  } else if (!env.SQL_MANAGED_IDENTITY_CLIENT_ID || !uuid.test(env.SQL_MANAGED_IDENTITY_CLIENT_ID)
    || env.SQL_USER !== undefined || env.SQL_PASSWORD !== undefined || env.SQL_PORT !== undefined
    || !server.endsWith('.database.windows.net')) {
    throw new ConfigurationError('SQL managed identity requires an Azure SQL host and SQL_MANAGED_IDENTITY_CLIENT_ID; password settings are forbidden');
  }
  const port = env.SQL_PORT ?? '1433';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new ConfigurationError('SQL_PORT must be an integer from 1 to 65535');
  }
  return {
    server, database, port: Number(port),
    connectionTimeout: 120_000,
    requestTimeout: 120_000,
    pool: { min: 0, max: 5, idleTimeoutMillis: 30_000 },
    validateConnection: 'socket',
    options: { encrypt: true, trustServerCertificate: testLogin, abortTransactionOnError: true, appName: 'jarvis-backend' },
    ...(testLogin ? { user: env.SQL_USER!, password: env.SQL_PASSWORD! } : {
      authentication: { type: 'azure-active-directory-msi-app-service', options: { clientId: env.SQL_MANAGED_IDENTITY_CLIENT_ID! } },
    }),
  };
}

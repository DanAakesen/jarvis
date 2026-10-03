import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { loadAuthConfig } from './auth/config.js';

describe('backend configuration', () => {
  it('defaults to the infrastructure port and offline logs', () => {
    expect(loadConfig({})).toEqual({ port: 3000, logLevel: 'info', auth: loadAuthConfig({}) });
  });
  it('accepts a configured HTTPS origin and backend-only telemetry string', () => {
    const connectionString = 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://swedencentral-0.in.applicationinsights.azure.com/';
    expect(loadConfig({ NODE_ENV: 'production', PORT: '4000', STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net', APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString, LOG_LEVEL: 'debug' })).toEqual({
      auth: loadAuthConfig({}), port: 4000, logLevel: 'debug', staticWebAppOrigin: 'https://fixture.azurestaticapps.net', applicationInsightsConnectionString: connectionString,
    });
  });
  it.each(['', '0', '-1', '65536', '3000.5', ' 3000', 'junk'])('rejects invalid port %j', (PORT) => {
    expect(() => loadConfig({ PORT })).toThrow('PORT');
  });
  it.each(['', 'http://fixture.azurestaticapps.net', 'https://fixture.azurestaticapps.net/', 'https://fixture.azurestaticapps.net/path', 'https://fixture.azurestaticapps.net?token=secret', 'https://user:secret@fixture.azurestaticapps.net', 'null'])('rejects an invalid static origin', (STATIC_WEB_APP_ORIGIN) => {
    expect(() => loadConfig({ STATIC_WEB_APP_ORIGIN })).toThrow('STATIC_WEB_APP_ORIGIN');
  });
  it('requires the static origin in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('STATIC_WEB_APP_ORIGIN');
  });
  it('rejects unsupported log levels', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL');
  });
  it.each(['', 'InstrumentationKey=secret', 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=http://example.com', 'InstrumentationKey=00000000-0000-0000-0000-000000000001;LiveEndpoint=https://user:secret@example.com'])('rejects telemetry configuration without exposing it', (APPLICATIONINSIGHTS_CONNECTION_STRING) => {
    expect(() => loadConfig({ APPLICATIONINSIGHTS_CONNECTION_STRING })).toThrow(/^APPLICATIONINSIGHTS_CONNECTION_STRING is invalid$/);
  });
});

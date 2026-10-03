import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { loadAuthConfig } from './auth/config.js';

describe('backend configuration', () => {
  it('defaults to the infrastructure port and offline logs', () => {
    expect(loadConfig({})).toEqual({ port: 3000, logLevel: 'info', auth: loadAuthConfig({}) });
  });
  it('accepts a configured HTTPS origin and backend-only telemetry string', () => {
    const connectionString = 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://swedencentral-0.in.applicationinsights.azure.com/';
    const foundryRuntimeEndpoint = 'https://fixture.cognitiveservices.azure.com/api/projects/jarvis';
    const foundryAdminEndpoint = 'https://fixture.services.ai.azure.com/api/projects/jarvis';
    expect(loadConfig({
      NODE_ENV: 'production', PORT: '4000', STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net',
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString, LOG_LEVEL: 'debug',
      FOUNDRY_RUNTIME_ENDPOINT: foundryRuntimeEndpoint, FOUNDRY_ADMIN_ENDPOINT: foundryAdminEndpoint,
      FOUNDRY_RUNNER_AGENT_NAME: 'jarvis-runner-node-1x2',
    })).toEqual({
      auth: loadAuthConfig({}), port: 4000, logLevel: 'debug', staticWebAppOrigin: 'https://fixture.azurestaticapps.net', applicationInsightsConnectionString: connectionString,
      foundryRuntimeEndpoint, foundryAdminEndpoint, foundryRunnerAgentName: 'jarvis-runner-node-1x2',
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
  it('requires the Foundry runner endpoints to be configured together', () => {
    expect(() => loadConfig({ FOUNDRY_RUNTIME_ENDPOINT: 'https://fixture.cognitiveservices.azure.com/api/projects/jarvis' }))
      .toThrow('FOUNDRY_RUNTIME_ENDPOINT, FOUNDRY_ADMIN_ENDPOINT and FOUNDRY_RUNNER_AGENT_NAME');
  });
  it('pins the English realtime model on the configured Voice Live endpoint', () => {
    expect(loadConfig({
      VOICE_LIVE_ENDPOINT: 'wss://resource.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15',
    }).voiceLiveEndpoint).toBe(
      'wss://resource.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15&model=gpt-realtime-2.1',
    );
  });
  it.each([
    '',
    'https://resource.services.ai.azure.com/voice-live/realtime',
    'wss://resource.example/voice-live/realtime',
    'wss://resource.services.ai.azure.com/voice-live/realtime?model=gpt-realtime',
    'wss://resource.services.ai.azure.com/voice-live/realtime?api-key=secret',
  ])('rejects an invalid Voice Live endpoint without exposing it', (VOICE_LIVE_ENDPOINT) => {
    expect(() => loadConfig({ VOICE_LIVE_ENDPOINT })).toThrow(
      /^VOICE_LIVE_ENDPOINT must be a secure Azure Voice Live WebSocket URL$/,
    );
  });
  it('rejects unsupported log levels', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL');
  });
  it.each(['', 'InstrumentationKey=secret', 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=http://example.com', 'InstrumentationKey=00000000-0000-0000-0000-000000000001;LiveEndpoint=https://user:secret@example.com'])('rejects telemetry configuration without exposing it', (APPLICATIONINSIGHTS_CONNECTION_STRING) => {
    expect(() => loadConfig({ APPLICATIONINSIGHTS_CONNECTION_STRING })).toThrow(/^APPLICATIONINSIGHTS_CONNECTION_STRING is invalid$/);
  });
});

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { loadAuthConfig } from './auth/config.js';

describe('backend configuration', () => {
  it('defaults to the infrastructure port and offline logs', () => {
    expect(loadConfig({})).toEqual({ port: 3000, logLevel: 'info', auth: loadAuthConfig({}) });
  });
  it('accepts a configured HTTPS origin and backend-only telemetry string', () => {
    const connectionString = 'InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://swedencentral-0.in.applicationinsights.azure.com/';
    const foundryRuntimeEndpoint = 'https://resource.cognitiveservices.azure.com/api/projects/jarvis';
    const foundryAdminEndpoint = 'https://resource.services.ai.azure.com/api/projects/jarvis';
    expect(loadConfig({
      NODE_ENV: 'production', PORT: '4000', STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net',
      APPLICATIONINSIGHTS_CONNECTION_STRING: connectionString, LOG_LEVEL: 'debug',
      FOUNDRY_RUNTIME_ENDPOINT: foundryRuntimeEndpoint, FOUNDRY_ADMIN_ENDPOINT: foundryAdminEndpoint,
      FOUNDRY_RUNNER_AGENT_NAME: 'jarvis-runner-node-1x2',
    })).toEqual({
      auth: loadAuthConfig({}), port: 4000, logLevel: 'debug', staticWebAppOrigin: 'https://fixture.azurestaticapps.net', applicationInsightsConnectionString: connectionString,
      foundryEndpoints: {
        admin: foundryAdminEndpoint,
        runtime: foundryRuntimeEndpoint,
      },
      foundryRunnerAgentName: 'jarvis-runner-node-1x2',
    });
  });
  it('validates the configured hosted chat-agent name', () => {
    const FOUNDRY_PROJECT_ENDPOINT = 'https://resource.services.ai.azure.com/api/projects/jarvis';
    expect(loadConfig({
      FOUNDRY_PROJECT_ENDPOINT, JARVIS_CHAT_AGENT_NAME: 'jarvis',
    }).foundryChatAgentName).toBe('jarvis');
    expect(() => loadConfig({ JARVIS_CHAT_AGENT_NAME: 'jarvis' })).toThrow(
      'FOUNDRY_PROJECT_ENDPOINT is required',
    );
    for (const JARVIS_CHAT_AGENT_NAME of ['', '../other', 'bad name']) {
      expect(() => loadConfig({ FOUNDRY_PROJECT_ENDPOINT, JARVIS_CHAT_AGENT_NAME }))
        .toThrow('JARVIS_CHAT_AGENT_NAME');
    }
  });
  it('accepts a GitHub App ID only with a secure Key Vault origin', () => {
    expect(loadConfig({
      GITHUB_APP_ID: '123456',
      KEY_VAULT_URI: 'https://jarvis.vault.azure.net/',
    })).toMatchObject({
      githubAppId: '123456',
      keyVaultUri: 'https://jarvis.vault.azure.net/',
    });
    expect(() => loadConfig({ GITHUB_APP_ID: '0', KEY_VAULT_URI: 'https://jarvis.vault.azure.net/' }))
      .toThrow('GITHUB_APP_ID');
    expect(() => loadConfig({ GITHUB_APP_ID: '123456' })).toThrow('KEY_VAULT_URI');
    for (const KEY_VAULT_URI of [
      'http://jarvis.vault.azure.net/',
      'https://example.com/',
      'https://jarvis.vault.azure.net/path',
      'https://jarvis.vault.azure.net/?secret=value',
    ]) {
      expect(() => loadConfig({ GITHUB_APP_ID: '123456', KEY_VAULT_URI })).toThrow('KEY_VAULT_URI');
    }
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
  it('allows production startup without Foundry while validating configured endpoints', () => {
    const env = {
      NODE_ENV: 'production',
      STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net',
    };
    expect(loadConfig(env).foundryEndpoints).toBeUndefined();
    expect(() => loadConfig({ FOUNDRY_RUNTIME_ENDPOINT: 'https://fixture.cognitiveservices.azure.com/api/projects/jarvis' }))
      .toThrow('configured together');
    expect(() => loadConfig({
      ...env, FOUNDRY_ADMIN_ENDPOINT: 'http://resource.services.ai.azure.com/api/projects/jarvis',
      FOUNDRY_RUNTIME_ENDPOINT: 'https://resource.cognitiveservices.azure.com/api/projects/jarvis',
    })).toThrow('secure Foundry project endpoint');
    expect(loadConfig({
      ...env, FOUNDRY_RUNNER_AGENT_NAME: 'jarvis-runner-node-1x2',
    }).foundryRunnerAgentName).toBe('jarvis-runner-node-1x2');
    expect(() => loadConfig({ FOUNDRY_RUNNER_AGENT_NAME: 'bad name' })).toThrow('FOUNDRY_RUNNER_AGENT_NAME');
  });
  it('pins the English realtime model on the configured Voice Live endpoint', () => {
    expect(loadConfig({
      VOICE_LIVE_ENDPOINT: 'wss://resource.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15',
    }).voiceLiveEndpoint).toBe(
      'wss://resource.services.ai.azure.com/voice-live/realtime?api-version=2026-07-15&model=gpt-realtime-2.1',
    );
  });
  it('accepts a secure Foundry project endpoint for the Danish voice agent', () => {
    expect(loadConfig({
      FOUNDRY_PROJECT_ENDPOINT: 'https://resource.services.ai.azure.com/api/projects/jarvis',
    }).foundryProjectEndpoint).toBe(
      'https://resource.services.ai.azure.com/api/projects/jarvis',
    );
  });
  it.each([
    '',
    'http://resource.services.ai.azure.com/api/projects/jarvis',
    'https://resource.example/api/projects/jarvis',
    'https://resource.services.ai.azure.com/api/projects/jarvis/',
    'https://resource.services.ai.azure.com/api/projects/jarvis?token=secret',
    '******resource.services.ai.azure.com/api/projects/jarvis',
  ])('rejects an invalid Foundry project endpoint without exposing it', (FOUNDRY_PROJECT_ENDPOINT) => {
    expect(() => loadConfig({ FOUNDRY_PROJECT_ENDPOINT })).toThrow(
      /^FOUNDRY_PROJECT_ENDPOINT must be a secure Azure AI project URL$/,
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

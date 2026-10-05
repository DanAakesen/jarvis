import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { loadAuthConfig } from './auth/config.js';

describe('backend configuration', () => {
  it('defaults to the infrastructure port and offline logs', () => {
    expect(loadConfig({})).toEqual({
      port: 3000, logLevel: 'info', notesFolderPath: '/Jarvis/Notes', codexToolModel: 'gpt-5.5',
      auth: loadAuthConfig({}),
    });
  });
  it('accepts a configured OneDrive notes folder and rejects unsafe paths', () => {
    expect(loadConfig({ JARVIS_NOTES_FOLDER_PATH: '/Work Notes/Research/' }).notesFolderPath)
      .toBe('/Work Notes/Research');
    for (const JARVIS_NOTES_FOLDER_PATH of [
      '', '/', 'Jarvis/Notes', '/Jarvis//Notes', '/Jarvis/../Private', '/Jarvis\\Notes',
      '/Jarvis/Notes?token=secret', '/Jarvis/Notes#fragment', '/Jarvis/Notes\u0000',
    ]) {
      expect(() => loadConfig({ JARVIS_NOTES_FOLDER_PATH })).toThrow(
        /^JARVIS_NOTES_FOLDER_PATH must be an absolute OneDrive folder path$/,
      );
    }
  });
  it('accepts only a secure Key Vault origin', () => {
    expect(loadConfig({ KEY_VAULT_URI: 'https://kv-jarvis.vault.azure.net/' }).keyVaultUri)
      .toBe('https://kv-jarvis.vault.azure.net/');
    for (const KEY_VAULT_URI of [
      '', 'http://kv-jarvis.vault.azure.net/', 'https://vault.example/', 'https://kv-jarvis.vault.azure.net/secrets',
      'https://kv-jarvis.vault.azure.net/?token=secret',
    ]) {
      expect(() => loadConfig({ KEY_VAULT_URI })).toThrow(/^KEY_VAULT_URI must be a secure Azure Key Vault URL$/);
    }
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
      notesFolderPath: '/Jarvis/Notes',
      foundryEndpoints: {
        admin: foundryAdminEndpoint,
        runtime: foundryRuntimeEndpoint,
      },
      foundryRunnerAgentName: 'jarvis-runner-node-1x2',
      codexToolModel: 'gpt-5.5',
    });
  });
  it('validates the configurable ChatGPT Codex tool model', () => {
    expect(loadConfig({ JARVIS_CODEX_TOOL_MODEL: 'gpt-5.5' }).codexToolModel).toBe('gpt-5.5');
    for (const JARVIS_CODEX_TOOL_MODEL of ['', 'gpt-6.1-sol', '../model', 'bad model']) {
      expect(() => loadConfig({ JARVIS_CODEX_TOOL_MODEL })).toThrow('JARVIS_CODEX_TOOL_MODEL');
    }
  });
  it('accepts only an HTTPS Azure Key Vault URI', () => {
    expect(loadConfig({ KEY_VAULT_URI: 'https://fixture.vault.azure.net/' }).keyVaultUri)
      .toBe('https://fixture.vault.azure.net/');
    for (const KEY_VAULT_URI of [
      '', 'http://fixture.vault.azure.net/', 'https://vault.example/', 'https://.vault.azure.net/',
      'https://subdomain.fixture.vault.azure.net/', 'https://fixture.vault.azure.net/path', 'https://fixture.vault.azure.net/?secret=hidden',
    ]) {
      expect(() => loadConfig({ KEY_VAULT_URI })).toThrow('KEY_VAULT_URI');
    }
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
  it('validates the optional Foundry memory-embedding deployment name', () => {
    const FOUNDRY_PROJECT_ENDPOINT = 'https://resource.services.ai.azure.com/api/projects/jarvis';
    expect(loadConfig({
      FOUNDRY_PROJECT_ENDPOINT,
      JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME: 'text-embedding-3-small',
    }).foundryMemoryEmbeddingDeploymentName).toBe('text-embedding-3-small');
    expect(() => loadConfig({
      JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME: 'text-embedding-3-small',
    })).toThrow('FOUNDRY_PROJECT_ENDPOINT is required');
    for (const JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME of ['', '../other', 'bad name']) {
      expect(() => loadConfig({ FOUNDRY_PROJECT_ENDPOINT, JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME }))
        .toThrow('JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME');
    }
  });
  it('accepts a complete bot, audio-origin, and Speech F0 configuration', () => {
    expect(loadConfig({
      TEAMS_BOT_APP_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      TEAMS_BOT_TENANT_ID: '802efa29-17f2-4a79-8f5f-38f087aed96a',
      TEAMS_AUDIO_ORIGIN: 'https://jarvis.example',
      SPEECH_REGION: 'westeurope',
    }).teams).toEqual({
      botAppId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      tenantId: '802efa29-17f2-4a79-8f5f-38f087aed96a',
      audioOrigin: 'https://jarvis.example',
      speechRegion: 'westeurope',
    });
  });
  it('rejects partial, cross-tenant, or unsafe Teams and Speech settings', () => {
    expect(() => loadConfig({ TEAMS_BOT_APP_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }))
      .toThrow('must be configured together');
    const complete = {
      TEAMS_BOT_APP_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      TEAMS_BOT_TENANT_ID: '802efa29-17f2-4a79-8f5f-38f087aed96a',
      TEAMS_AUDIO_ORIGIN: 'https://jarvis.example',
      SPEECH_REGION: 'westeurope',
    };
    expect(() => loadConfig({ ...complete, TEAMS_BOT_TENANT_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }))
      .toThrow('must match ENTRA_TENANT_ID');
    for (const TEAMS_AUDIO_ORIGIN of [
      'http://jarvis.example',
      'https://jarvis.example/',
      'https://jarvis.example/path',
      'https://user@jarvis.example',
    ]) {
      expect(() => loadConfig({ ...complete, TEAMS_AUDIO_ORIGIN })).toThrow('TEAMS_AUDIO_ORIGIN');
    }
    expect(() => loadConfig({ ...complete, SPEECH_REGION: 'https://example.com' })).toThrow('SPEECH_REGION');
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
  it('requires a valid Graph app ID, Key Vault, and time zone together', () => {
    const appId = '12345678-1234-1234-1234-123456789abc';
    const keyVault = 'https://jarvis.vault.azure.net/';
    expect(loadConfig({
      JARVIS_GRAPH_APP_ID: appId,
      JARVIS_GRAPH_TIME_ZONE: 'Europe/Copenhagen',
      KEY_VAULT_URI: keyVault,
    })).toMatchObject({
      graphAppId: appId,
      graphTimeZone: 'Europe/Copenhagen',
      keyVaultUri: keyVault,
    });
    expect(() => loadConfig({ JARVIS_GRAPH_APP_ID: appId })).toThrow('KEY_VAULT_URI');
    expect(() => loadConfig({ JARVIS_GRAPH_APP_ID: appId, KEY_VAULT_URI: keyVault }))
      .toThrow('JARVIS_GRAPH_APP_ID and JARVIS_GRAPH_TIME_ZONE');
    expect(() => loadConfig({
      JARVIS_GRAPH_TIME_ZONE: 'Europe/Copenhagen',
    })).toThrow('JARVIS_GRAPH_APP_ID and JARVIS_GRAPH_TIME_ZONE');
    expect(() => loadConfig({
      JARVIS_GRAPH_APP_ID: 'not-a-uuid',
      JARVIS_GRAPH_TIME_ZONE: 'Europe/Copenhagen',
      KEY_VAULT_URI: keyVault,
    })).toThrow('JARVIS_GRAPH_APP_ID');
    expect(() => loadConfig({
      JARVIS_GRAPH_APP_ID: appId,
      JARVIS_GRAPH_TIME_ZONE: 'not/a-zone',
      KEY_VAULT_URI: keyVault,
    })).toThrow('JARVIS_GRAPH_TIME_ZONE');
  });
  it('validates the Azure budget resource ID used for budget polling', () => {
    const JARVIS_MONTHLY_BUDGET_RESOURCE_ID =
      '/subscriptions/12345678-1234-1234-1234-123456789abc/resourceGroups/rg-jarvis/providers/Microsoft.Consumption/budgets/jarvis-monthly';
    expect(loadConfig({ JARVIS_MONTHLY_BUDGET_RESOURCE_ID }).monthlyBudgetResourceId)
      .toBe(JARVIS_MONTHLY_BUDGET_RESOURCE_ID);
    for (const value of [
      '',
      'https://management.azure.com/subscriptions/123/resourceGroups/rg/providers/Microsoft.Consumption/budgets/x',
      `${JARVIS_MONTHLY_BUDGET_RESOURCE_ID}?api-version=2019-10-01`,
      '/subscriptions/not-a-sub/resourceGroups/rg/providers/Microsoft.Consumption/budgets/x',
    ]) {
      expect(() => loadConfig({ JARVIS_MONTHLY_BUDGET_RESOURCE_ID: value }))
        .toThrow('JARVIS_MONTHLY_BUDGET_RESOURCE_ID');
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

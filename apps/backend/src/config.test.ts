import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { loadAuthConfig } from './auth/config.js';

describe('backend configuration', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['TRUE', false],
    [' true', false],
    ['true', true],
  ])('enables push only for the exact true flag (%j)', (JARVIS_PUSH_ENABLED, expected) => {
    const env = JARVIS_PUSH_ENABLED === undefined
      ? {}
      : {
        JARVIS_PUSH_ENABLED,
        ...(JARVIS_PUSH_ENABLED === 'true' ? { STATIC_WEB_APP_ORIGIN: 'https://fixture.azurestaticapps.net' } : {}),
      };
    expect(loadConfig(env).pushEnabled).toBe(expected);
  });
  it('requires an HTTPS web origin when push is enabled', () => {
    expect(() => loadConfig({ JARVIS_PUSH_ENABLED: 'true' }))
      .toThrow('STATIC_WEB_APP_ORIGIN is required when JARVIS_PUSH_ENABLED is true');
  });

  it('defaults to the infrastructure port and offline logs', () => {
    expect(loadConfig({})).toEqual({
      port: 3000, logLevel: 'info', codexToolModel: 'gpt-5.5',
      codexImageModel: 'gpt-5.5',
      pushEnabled: false,
      proactiveEnabled: false,
      proactiveTodoWritesEnabled: false,
      proactiveAlertsEnabled: false,
      healthUploadEnabled: false,
      ownerSessionEnabled: false,
      voiceToolBudgetProbeEnabled: true,
      auth: loadAuthConfig({}),
    });
  });
  it.each([
    'JARVIS_PROACTIVE_ENABLED',
    'JARVIS_PROACTIVE_TODO_WRITES_ENABLED',
    'JARVIS_PROACTIVE_ALERTS_ENABLED',
  ])('enables %s only for the exact true string', (flag) => {
    for (const value of [undefined, 'false', 'TRUE', ' true']) {
      const config = loadConfig(value === undefined ? {} : { [flag]: value });
      expect(config).toHaveProperty(flag === 'JARVIS_PROACTIVE_ENABLED'
        ? 'proactiveEnabled'
        : flag === 'JARVIS_PROACTIVE_TODO_WRITES_ENABLED'
          ? 'proactiveTodoWritesEnabled'
          : 'proactiveAlertsEnabled', false);
    }
    const config = loadConfig({ [flag]: 'true' });
    expect(config).toHaveProperty(flag === 'JARVIS_PROACTIVE_ENABLED'
      ? 'proactiveEnabled'
      : flag === 'JARVIS_PROACTIVE_TODO_WRITES_ENABLED'
        ? 'proactiveTodoWritesEnabled'
        : 'proactiveAlertsEnabled', true);
  });
  it('keeps Health upload default-off and accepts only an explicit boolean flag', () => {
    expect(loadConfig({}).healthUploadEnabled).toBe(false);
    expect(loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'false' }).healthUploadEnabled).toBe(false);
    expect(loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'true' }).healthUploadEnabled).toBe(true);
    expect(() => loadConfig({ JARVIS_HEALTH_UPLOAD_ENABLED: 'TRUE' })).toThrow('JARVIS_HEALTH_UPLOAD_ENABLED must be true or false');
  });
  it('keeps owner sessions default-off and accepts only an explicit boolean flag', () => {
    expect(loadConfig({}).ownerSessionEnabled).toBe(false);
    expect(loadConfig({ JARVIS_OWNER_SESSION_ENABLED: 'false' }).ownerSessionEnabled).toBe(false);
    expect(loadConfig({ JARVIS_OWNER_SESSION_ENABLED: 'true' }).ownerSessionEnabled).toBe(true);
    for (const value of ['TRUE', ' true', '1', '']) {
      expect(() => loadConfig({ JARVIS_OWNER_SESSION_ENABLED: value })).toThrow('JARVIS_OWNER_SESSION_ENABLED must be true or false');
    }
  });
  it('does not configure an external OneDrive notes folder', () => {
    expect(loadConfig({ JARVIS_NOTES_FOLDER_PATH: '/obsolete/path' })).not.toHaveProperty('notesFolderPath');
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
      foundryEndpoints: {
        admin: foundryAdminEndpoint,
        runtime: foundryRuntimeEndpoint,
      },
      foundryRunnerAgentName: 'jarvis-runner-node-1x2',
      codexToolModel: 'gpt-5.5',
      codexImageModel: 'gpt-5.5',
      pushEnabled: false,
      proactiveEnabled: false,
      proactiveTodoWritesEnabled: false,
      proactiveAlertsEnabled: false,
      healthUploadEnabled: false,
      ownerSessionEnabled: false,
      voiceToolBudgetProbeEnabled: true,
    });
  });
  it('validates the configurable ChatGPT Codex tool model', () => {
    expect(loadConfig({ JARVIS_CODEX_TOOL_MODEL: 'gpt-5.5' }).codexToolModel).toBe('gpt-5.5');
    expect(loadConfig({ JARVIS_CODEX_TOOL_MODEL: 'gpt-5.5' }).codexImageModel).toBe('gpt-5.5');
    for (const JARVIS_CODEX_TOOL_MODEL of ['', 'gpt-6.1-sol', '../model', 'bad model', 'gpt-5.5\n--help']) {
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
  it('ignores Teams settings whether complete, partial, or malformed', () => {
    const baseline = loadConfig({});
    expect(loadConfig({
      TEAMS_BOT_APP_ID: 'not-a-uuid',
      TEAMS_BOT_TENANT_ID: 'not-a-tenant',
      TEAMS_AUDIO_ORIGIN: 'http://invalid.example/path',
      SPEECH_REGION: 'not a region',
    })).toEqual(baseline);
    expect(loadConfig({
      TEAMS_BOT_APP_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      TEAMS_BOT_TENANT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      TEAMS_AUDIO_ORIGIN: 'https://jarvis.example',
      SPEECH_REGION: 'westeurope',
    })).toEqual(baseline);
    expect(baseline).not.toHaveProperty('teams');
  });
  it('configures phone media independently from Teams messaging settings', () => {
    const phoneConfig = loadConfig({
      JARVIS_PHONE_ACS_ENDPOINT: 'https://fixture.communication.azure.com/',
      JARVIS_PHONE_ACS_RESOURCE_ID:
        '/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/resourceGroups/rg/providers/Microsoft.Communication/communicationServices/jarvis',
      JARVIS_PHONE_TEAMS_RESOURCE_ACCOUNT_OBJECT_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      JARVIS_PHONE_PUBLIC_ORIGIN: 'https://jarvis.example',
      KEY_VAULT_URI: 'https://fixture.vault.azure.net/',
      FOUNDRY_PROJECT_ENDPOINT: 'https://resource.services.ai.azure.com/api/projects/jarvis',
      ENTRA_PHONE_EVENT_GRID_OBJECT_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
    expect(phoneConfig.phone).toEqual({
      acsEndpoint: 'https://fixture.communication.azure.com',
      acsResourceId:
        '/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/resourcegroups/rg/providers/microsoft.communication/communicationservices/jarvis',
      teamsResourceAccountObjectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      publicOrigin: 'https://jarvis.example',
    });
    expect(phoneConfig).not.toHaveProperty('teams');
    expect(() => loadConfig({
      JARVIS_PHONE_ACS_ENDPOINT: 'https://fixture.communication.azure.com/',
      JARVIS_PHONE_ACS_RESOURCE_ID:
        '/subscriptions/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/resourceGroups/rg/providers/Microsoft.Communication/communicationServices/jarvis',
      JARVIS_PHONE_TEAMS_RESOURCE_ACCOUNT_OBJECT_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      JARVIS_PHONE_PUBLIC_ORIGIN: 'http://jarvis.example',
      KEY_VAULT_URI: 'https://fixture.vault.azure.net/',
      FOUNDRY_PROJECT_ENDPOINT: 'https://resource.services.ai.azure.com/api/projects/jarvis',
      ENTRA_PHONE_EVENT_GRID_OBJECT_ID: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    })).toThrow('JARVIS_PHONE_PUBLIC_ORIGIN');
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
  it('requires Key Vault for Google credentials and validates the configured time zone', () => {
    const keyVault = 'https://jarvis.vault.azure.net/';
    expect(loadConfig({
      JARVIS_GOOGLE_TIME_ZONE: 'Europe/Copenhagen',
      KEY_VAULT_URI: keyVault,
    })).toMatchObject({
      googleTimeZone: 'Europe/Copenhagen',
      keyVaultUri: keyVault,
    });
    expect(() => loadConfig({ JARVIS_GOOGLE_TIME_ZONE: 'Europe/Copenhagen' }))
      .toThrow('KEY_VAULT_URI');
    expect(() => loadConfig({
      JARVIS_GOOGLE_TIME_ZONE: 'not/a-zone',
      KEY_VAULT_URI: keyVault,
    })).toThrow('JARVIS_GOOGLE_TIME_ZONE');
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
  it('keeps Daily off unless the server switch is exactly true', () => {
    const baseline = loadConfig({});
    expect(baseline).not.toHaveProperty('dailyEnabled');
    expect(loadConfig({ JARVIS_DAILY_ENABLED: 'false' })).toEqual(baseline);
    expect(loadConfig({ JARVIS_DAILY_ENABLED: 'true' })).toEqual({ ...baseline, dailyEnabled: true });
    for (const JARVIS_DAILY_ENABLED of ['', 'TRUE', 'True', '1', '0', 'yes', 'on', ' true', 'true ', 'enabled']) {
      expect(() => loadConfig({ JARVIS_DAILY_ENABLED })).toThrow(/^JARVIS_DAILY_ENABLED must be true or false$/);
    }
  });
  it('keeps Daily Google feeds off unless their separate server switch is exactly true', () => {
    const baseline = loadConfig({});
    expect(baseline).not.toHaveProperty('dailyFeedsEnabled');
    expect(loadConfig({ JARVIS_DAILY_FEEDS_ENABLED: 'false' })).toEqual(baseline);
    expect(loadConfig({ JARVIS_DAILY_FEEDS_ENABLED: 'true' })).toEqual({ ...baseline, dailyFeedsEnabled: true });
    for (const JARVIS_DAILY_FEEDS_ENABLED of ['', 'TRUE', 'True', '1', '0', 'yes', 'on', ' true', 'true ', 'enabled']) {
      expect(() => loadConfig({ JARVIS_DAILY_FEEDS_ENABLED })).toThrow(/^JARVIS_DAILY_FEEDS_ENABLED must be true or false$/);
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

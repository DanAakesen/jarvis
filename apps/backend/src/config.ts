import type { Level } from 'pino';
import { loadAuthConfig, type AuthConfig } from './auth/config.js';
import { ConfigurationError } from './configuration-error.js';
import { normalizeFoundryProjectEndpoint, normalizeVoiceLiveEndpoint } from './voice/relay.js';
export { ConfigurationError } from './configuration-error.js';

export interface BackendConfig {
  port: number;
  staticWebAppOrigin?: string;
  logLevel: Level;
  applicationInsightsConnectionString?: string;
  keyVaultUri?: string;
  voiceLiveEndpoint?: string;
  foundryEndpoints?: {
    admin: string;
    runtime: string;
  };
  foundryRunnerAgentName?: string;
  foundryChatAgentName?: string;
  foundryProjectEndpoint?: string;
  foundryMemoryEmbeddingDeploymentName?: string;
  githubAppId?: string;
  monthlyBudgetResourceId?: string;
  auth: AuthConfig;
}

export const localWebOrigin = 'http://localhost:5173';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const port = env.PORT ?? '3000';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new ConfigurationError('PORT must be an integer from 1 to 65535');
  }
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(logLevel)) {
    throw new ConfigurationError('LOG_LEVEL must be a supported Pino level');
  }
  const origin = env.STATIC_WEB_APP_ORIGIN;
  if (origin !== undefined) {
    let valid = false;
    try {
      const url = new URL(origin);
      valid = url.protocol === 'https:' && url.origin === origin;
    } catch { /* Report only the setting name, never its value. */ }
    if (!valid) throw new ConfigurationError('STATIC_WEB_APP_ORIGIN must be an HTTPS origin without a path');
  } else if (env.NODE_ENV === 'production') {
    throw new ConfigurationError('STATIC_WEB_APP_ORIGIN is required in production');
  }

  const foundryAdminEndpoint = env.FOUNDRY_ADMIN_ENDPOINT;
  const foundryRuntimeEndpoint = env.FOUNDRY_RUNTIME_ENDPOINT;
  if ((foundryAdminEndpoint === undefined) !== (foundryRuntimeEndpoint === undefined)) {
    throw new ConfigurationError('FOUNDRY_ADMIN_ENDPOINT and FOUNDRY_RUNTIME_ENDPOINT must be configured together');
  }
  if (foundryAdminEndpoint !== undefined && foundryRuntimeEndpoint !== undefined) {
    validateFoundryEndpoint(foundryAdminEndpoint, '.services.ai.azure.com', 'FOUNDRY_ADMIN_ENDPOINT');
    validateFoundryEndpoint(foundryRuntimeEndpoint, '.cognitiveservices.azure.com', 'FOUNDRY_RUNTIME_ENDPOINT');
  }

  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (connectionString !== undefined) {
    const fields = new Map(connectionString.split(';').filter(Boolean).map((field) => {
      const separator = field.indexOf('=');
      return [field.slice(0, separator).toLowerCase(), field.slice(separator + 1)];
    }));
    const key = fields.get('instrumentationkey') ?? '';
    let valid = /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(key);
    for (const name of ['ingestionendpoint', 'liveendpoint']) {
      const endpoint = fields.get(name);
      if (endpoint === undefined) continue;
      try {
        const url = new URL(endpoint);
        valid &&= url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
      } catch { valid = false; }
    }
    if (!valid) throw new ConfigurationError('APPLICATIONINSIGHTS_CONNECTION_STRING is invalid');
  }

  let keyVaultUri: string | undefined;
  if (env.KEY_VAULT_URI !== undefined) {
    try {
      const url = new URL(env.KEY_VAULT_URI);
      if (url.protocol !== 'https:' || !/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/iu.test(url.hostname) ||
          url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error();
      }
      keyVaultUri = url.origin + '/';
    } catch {
      throw new ConfigurationError('KEY_VAULT_URI must be a secure Azure Key Vault URL');
    }
  }

  let voiceLiveEndpoint: string | undefined;
  if (env.VOICE_LIVE_ENDPOINT !== undefined) {
    try {
      voiceLiveEndpoint = normalizeVoiceLiveEndpoint(env.VOICE_LIVE_ENDPOINT.trim());
    } catch {
      throw new ConfigurationError('VOICE_LIVE_ENDPOINT must be a secure Azure Voice Live WebSocket URL');
    }
  }

  let foundryProjectEndpoint: string | undefined;
  if (env.FOUNDRY_PROJECT_ENDPOINT !== undefined) {
    try {
      foundryProjectEndpoint = normalizeFoundryProjectEndpoint(env.FOUNDRY_PROJECT_ENDPOINT.trim());
    } catch {
      throw new ConfigurationError('FOUNDRY_PROJECT_ENDPOINT must be a secure Azure AI project URL');
    }
  }
  const foundryChatAgentName = env.JARVIS_CHAT_AGENT_NAME;
  if (foundryChatAgentName !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(foundryChatAgentName)) {
    throw new ConfigurationError('JARVIS_CHAT_AGENT_NAME must be a valid agent name');
  }
  if (foundryChatAgentName !== undefined && foundryProjectEndpoint === undefined) {
    throw new ConfigurationError('FOUNDRY_PROJECT_ENDPOINT is required when JARVIS_CHAT_AGENT_NAME is configured');
  }
  const foundryMemoryEmbeddingDeploymentName = env.JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME;
  if (foundryMemoryEmbeddingDeploymentName !== undefined &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(foundryMemoryEmbeddingDeploymentName)) {
    throw new ConfigurationError('JARVIS_MEMORY_EMBEDDING_DEPLOYMENT_NAME must be a valid deployment name');
  }
  if (foundryMemoryEmbeddingDeploymentName !== undefined && foundryProjectEndpoint === undefined) {
    throw new ConfigurationError('FOUNDRY_PROJECT_ENDPOINT is required when memory embeddings are configured');
  }
  const foundryRunnerAgentName = env.FOUNDRY_RUNNER_AGENT_NAME;
  if (foundryRunnerAgentName !== undefined && !/^[A-Za-z0-9._-]{1,128}$/u.test(foundryRunnerAgentName)) {
    throw new ConfigurationError('FOUNDRY_RUNNER_AGENT_NAME must be a valid agent name');
  }
  const githubAppId = env.GITHUB_APP_ID;
  if (githubAppId !== undefined && !/^[1-9][0-9]{0,19}$/u.test(githubAppId)) {
    throw new ConfigurationError('GITHUB_APP_ID must be a positive decimal identifier');
  }
  if (githubAppId !== undefined && keyVaultUri === undefined) {
    throw new ConfigurationError('KEY_VAULT_URI is required when GITHUB_APP_ID is configured');
  }
  const monthlyBudgetResourceId = env.JARVIS_MONTHLY_BUDGET_RESOURCE_ID;
  if (monthlyBudgetResourceId !== undefined &&
    !/^\/subscriptions\/[\da-f-]+\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.Consumption\/budgets\/[a-z\d._()-]+$/iu.test(monthlyBudgetResourceId)) {
    throw new ConfigurationError('JARVIS_MONTHLY_BUDGET_RESOURCE_ID must be an Azure budget resource ID');
  }

  return {
    auth: loadAuthConfig(env),
    port: Number(port),
    logLevel: logLevel as Level,
    ...(origin === undefined ? {} : { staticWebAppOrigin: origin }),
    ...(connectionString === undefined ? {} : { applicationInsightsConnectionString: connectionString }),
    ...(keyVaultUri === undefined ? {} : { keyVaultUri }),
    ...(voiceLiveEndpoint === undefined ? {} : { voiceLiveEndpoint }),
    ...(foundryAdminEndpoint === undefined || foundryRuntimeEndpoint === undefined ? {} : {
      foundryEndpoints: { admin: foundryAdminEndpoint, runtime: foundryRuntimeEndpoint },
    }),
    ...(foundryRunnerAgentName === undefined ? {} : { foundryRunnerAgentName }),
    ...(foundryChatAgentName === undefined ? {} : { foundryChatAgentName }),
    ...(foundryProjectEndpoint === undefined ? {} : { foundryProjectEndpoint }),
    ...(foundryMemoryEmbeddingDeploymentName === undefined ? {} : { foundryMemoryEmbeddingDeploymentName }),
    ...(githubAppId === undefined ? {} : { githubAppId }),
    ...(monthlyBudgetResourceId === undefined ? {} : { monthlyBudgetResourceId }),
  };
}

function validateFoundryEndpoint(value: string, hostSuffix: string, name: string): void {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ConfigurationError(`${name} must be a valid Foundry project endpoint`); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith(hostSuffix) || url.port ||
      url.username || url.password || url.search || url.hash ||
      !/^\/api\/projects\/[^/]+\/?$/u.test(url.pathname)) {
    throw new ConfigurationError(`${name} must be a secure Foundry project endpoint`);
  }
}

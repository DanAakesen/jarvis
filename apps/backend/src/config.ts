import type { Level } from 'pino';
import { loadAuthConfig, type AuthConfig } from './auth/config.js';
import { ConfigurationError } from './configuration-error.js';
import { normalizeVoiceLiveEndpoint } from './voice/relay.js';
export { ConfigurationError } from './configuration-error.js';

export interface BackendConfig {
  port: number;
  staticWebAppOrigin?: string;
  logLevel: Level;
  applicationInsightsConnectionString?: string;
  voiceLiveEndpoint?: string;
  foundryRuntimeEndpoint?: string;
  foundryAdminEndpoint?: string;
  foundryRunnerAgentName?: string;
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

  let voiceLiveEndpoint: string | undefined;
  if (env.VOICE_LIVE_ENDPOINT !== undefined) {
    try {
      voiceLiveEndpoint = normalizeVoiceLiveEndpoint(env.VOICE_LIVE_ENDPOINT.trim());
    } catch {
      throw new ConfigurationError('VOICE_LIVE_ENDPOINT must be a secure Azure Voice Live WebSocket URL');
    }
  }

  const foundryRuntimeEndpoint = env.FOUNDRY_RUNTIME_ENDPOINT;
  const foundryAdminEndpoint = env.FOUNDRY_ADMIN_ENDPOINT;
  const foundryRunnerAgentName = env.FOUNDRY_RUNNER_AGENT_NAME;
  const foundryConfigured = [foundryRuntimeEndpoint, foundryAdminEndpoint, foundryRunnerAgentName]
    .some((value) => value !== undefined);
  if (foundryConfigured && (!foundryRuntimeEndpoint || !foundryAdminEndpoint || !foundryRunnerAgentName)) {
    throw new ConfigurationError('FOUNDRY_RUNTIME_ENDPOINT, FOUNDRY_ADMIN_ENDPOINT and FOUNDRY_RUNNER_AGENT_NAME must be configured together');
  }
  if (env.NODE_ENV === 'production' && !foundryConfigured) {
    throw new ConfigurationError('Foundry runner configuration is required in production');
  }
  if (foundryConfigured) {
    const validEndpoint = (value: string, hostSuffix: string) => {
      try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.hostname.endsWith(hostSuffix) && !url.port &&
          !url.username && !url.password && !url.search && !url.hash &&
          /^\/api\/projects\/[^/]+\/?$/u.test(url.pathname);
      } catch { return false; }
    };
    if (!validEndpoint(foundryRuntimeEndpoint as string, '.cognitiveservices.azure.com')) {
      throw new ConfigurationError('FOUNDRY_RUNTIME_ENDPOINT must be an HTTPS Foundry project endpoint');
    }
    if (!validEndpoint(foundryAdminEndpoint as string, '.services.ai.azure.com')) {
      throw new ConfigurationError('FOUNDRY_ADMIN_ENDPOINT must be an HTTPS Foundry project endpoint');
    }
    if (!/^[A-Za-z0-9._-]{1,128}$/u.test(foundryRunnerAgentName as string)) {
      throw new ConfigurationError('FOUNDRY_RUNNER_AGENT_NAME must be a valid agent name');
    }
  }

  return {
    auth: loadAuthConfig(env),
    port: Number(port),
    logLevel: logLevel as Level,
    ...(origin === undefined ? {} : { staticWebAppOrigin: origin }),
    ...(connectionString === undefined ? {} : { applicationInsightsConnectionString: connectionString }),
    ...(voiceLiveEndpoint === undefined ? {} : { voiceLiveEndpoint }),
    ...(foundryConfigured ? {
      foundryRuntimeEndpoint: foundryRuntimeEndpoint as string,
      foundryAdminEndpoint: foundryAdminEndpoint as string,
      foundryRunnerAgentName: foundryRunnerAgentName as string,
    } : {}),
  };
}

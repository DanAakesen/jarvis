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
  chatAgentUrl?: string;
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

  let chatAgentUrl: string | undefined;
  if (env.JARVIS_CHAT_AGENT_URL !== undefined) {
    try {
      const url = new URL(env.JARVIS_CHAT_AGENT_URL.trim());
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) {
        throw new Error();
      }
      chatAgentUrl = url.toString().replace(/\/+$/, '');
    } catch {
      throw new ConfigurationError('JARVIS_CHAT_AGENT_URL must be a secure HTTPS URL without credentials, query, or fragment');
    }
  }

  return {
    auth: loadAuthConfig(env),
    port: Number(port),
    logLevel: logLevel as Level,
    ...(origin === undefined ? {} : { staticWebAppOrigin: origin }),
    ...(connectionString === undefined ? {} : { applicationInsightsConnectionString: connectionString }),
    ...(voiceLiveEndpoint === undefined ? {} : { voiceLiveEndpoint }),
    ...(chatAgentUrl === undefined ? {} : { chatAgentUrl }),
  };
}

import { buildApp } from './app.js';
import { DefaultAzureCredential } from '@azure/identity';
import { ConfigurationError, loadConfig } from './config.js';
import { createLogger, createTelemetry } from './logging.js';
import { shutdown } from './shutdown.js';
import { loadDatabaseConfig } from './database/config.js';
import { createDatabase, registerDatabase } from './database/lifecycle.js';
import { createToolCallStore } from './database/tool-call-store.js';
import { createSettingsStore } from './database/settings-store.js';
import { createProjectStore } from './database/project-store.js';
import { createConversationStore } from './database/conversation-store.js';
import { createTaskStore } from './database/task-store.js';
import { createSandboxHeartbeatStore } from './database/sandbox-heartbeat-store.js';
import { coreModule } from './core/index.js';
import { conversationModule } from './core/conversation.js';
import { factoryModule } from './factory/index.js';
import type { BackendModule } from './modules.js';
import { createVoiceLiveConnector, createVoiceRelayModule } from './voice/relay.js';
import { FoundryClient, FoundryClientError } from './foundry/client.js';
import { SandboxHeartbeat } from './factory/heartbeat.js';

try {
  const config = loadConfig();
  const databaseConfig = loadDatabaseConfig();
  const telemetry = await createTelemetry(config.applicationInsightsConnectionString);
  const logger = createLogger(config, telemetry);
  const database = databaseConfig ? createDatabase(databaseConfig) : undefined;
  const credential = config.voiceLiveEndpoint || config.foundryEndpoints
    ? new DefaultAzureCredential(process.env.SQL_MANAGED_IDENTITY_CLIENT_ID
      ? { managedIdentityClientId: process.env.SQL_MANAGED_IDENTITY_CLIENT_ID }
      : {})
    : undefined;
  const foundryClients = new Map<string, FoundryClient>();
  const clientFor = (agentName: string) => {
    if (!config.foundryEndpoints || !credential) throw new Error('Foundry heartbeat is not configured');
    let client = foundryClients.get(agentName);
    if (!client) {
      client = new FoundryClient({
        runtimeEndpoint: config.foundryEndpoints.runtime,
        adminEndpoint: config.foundryEndpoints.admin,
        agentName,
        getToken: async (scope, signal) => {
          const token = await credential.getToken(scope, { abortSignal: signal });
          if (!token) throw new Error('Foundry identity unavailable');
          return token.token;
        },
      });
      foundryClients.set(agentName, client);
    }
    return client;
  };
  const sandboxHeartbeat = database && config.foundryEndpoints
    ? new SandboxHeartbeat(createSandboxHeartbeatStore(database.pool), clientFor, {
      onError: (error) => {
        const details = error instanceof FoundryClientError
          ? { kind: error.kind, statusCode: error.statusCode, operation: error.operation }
          : { kind: 'internal' };
        logger.warn(details, 'sandbox_heartbeat.poll_failed');
      },
    })
    : undefined;
  const modules: BackendModule[] = [coreModule, conversationModule, factoryModule];
  if (config.voiceLiveEndpoint && credential) {
    modules.push(createVoiceRelayModule({
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Voice identity unavailable');
        return token.token;
      },
      connect: createVoiceLiveConnector(config.voiceLiveEndpoint),
    }));
  }
  const app = buildApp(config, logger, {
    modules,
    ...(database ? {
      projectStore: createProjectStore(database.pool),
      toolCallStore: createToolCallStore(database.pool),
      settingsStore: createSettingsStore(database.pool),
      conversationStore: createConversationStore(database.pool),
      taskStore: createTaskStore(database.pool),
    } : {}),
    ...(sandboxHeartbeat ? { sandboxHeartbeat } : {}),
  });
  if (database) registerDatabase(app, database);
  else logger.info('database.not_configured');
  if (database && !sandboxHeartbeat) logger.warn('sandbox_heartbeat.configuration_missing');
  if (!telemetry) logger.info('telemetry.stdout_only');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try { await shutdown(app, telemetry); }
    catch { logger.error('telemetry.close_failed'); process.exitCode = 1; }
    // Enforce the shutdown deadline even if an SDK/network handle remains open.
    process.exit(process.exitCode ?? 0);
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  try {
    if (database) {
      await database.initialize();
      logger.info('database.ready');
    }
    if (!stopping) {
      await sandboxHeartbeat?.start();
      await app.listen({ port: config.port, host: '0.0.0.0' });
      logger.info({ port: config.port }, 'server.listening');
    }
  } catch {
    logger.error('server.failed');
    process.exitCode = 1;
    await stop();
  }
} catch (error) {
  // Startup exceptions may contain configuration values or provider URLs.
  process.stderr.write(JSON.stringify({
    level: 60, service: 'jarvis-backend', msg: 'server.configuration_failed',
    ...(error instanceof ConfigurationError ? { reason: error.message } : {}),
  }) + '\n');
  process.exit(1);
}

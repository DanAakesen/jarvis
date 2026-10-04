import { buildApp } from './app.js';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
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
import { loadTaskEventArchiveStorageAccount } from './database/task-event-archive-config.js';
import { createTaskEventArchiveBlobStore } from './database/task-event-archive-blob.js';
import { createTaskEventArchive, createTaskEventArchiveJob } from './database/task-event-archive.js';
import { createEventHub } from './core/event-hub.js';
import type { TaskEventHub, TaskEventMessage } from './factory/task-store.js';
import { coreModule } from './core/index.js';
import { conversationModule } from './core/conversation.js';
import { factoryModule } from './factory/index.js';
import type { BackendModule } from './modules.js';
import {
  createDanishVoiceConnector,
  createVoiceLiveConnector,
  createVoiceRelayModule,
} from './voice/relay.js';
import { createArmContainerAppScaler } from './operations/container-app-scale.js';
import { createSleepModule } from './operations/sleep.js';
import { createHttpConversationAgent } from './core/chat-agent.js';
import { FoundryClient, FoundryClientError } from './foundry/client.js';
import { SandboxHeartbeat } from './factory/heartbeat.js';

try {
  const config = loadConfig();
  const databaseConfig = loadDatabaseConfig();
  const archiveStorageAccount = loadTaskEventArchiveStorageAccount();
  if (databaseConfig && !archiveStorageAccount) {
    throw new ConfigurationError('TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT is required when SQL is configured');
  }
  const sleepResourceId = process.env.BACKEND_CONTAINER_APP_RESOURCE_ID;
  const sleepIdentityClientId = process.env.SQL_MANAGED_IDENTITY_CLIENT_ID;
  if (sleepResourceId && !sleepIdentityClientId) {
    throw new ConfigurationError('SQL_MANAGED_IDENTITY_CLIENT_ID is required for backend scaling');
  }
  const sleepCredential = sleepResourceId && sleepIdentityClientId
    ? new ManagedIdentityCredential(sleepIdentityClientId)
    : undefined;
  const containerAppScaler = sleepResourceId && sleepCredential
    ? createArmContainerAppScaler({
      resourceId: sleepResourceId,
      getToken: async (scope, signal) => {
        const token = await sleepCredential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Container Apps managed identity unavailable');
        return token.token;
      },
    })
    : null;
  const telemetry = await createTelemetry(config.applicationInsightsConnectionString);
  const logger = createLogger(config, telemetry);
  const database = databaseConfig ? createDatabase(databaseConfig) : undefined;
  const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
  const credential = archiveStorageAccount || config.voiceLiveEndpoint || config.foundryProjectEndpoint || config.foundryEndpoints
    ? new DefaultAzureCredential(process.env.SQL_MANAGED_IDENTITY_CLIENT_ID
      ? { managedIdentityClientId: process.env.SQL_MANAGED_IDENTITY_CLIENT_ID }
      : {})
    : undefined;
  const foundryClients = new Map<string, FoundryClient>();
  const taskEventArchive = database && archiveStorageAccount && credential
    ? createTaskEventArchive(
      database.pool,
      createTaskEventArchiveBlobStore(
        new BlobServiceClient(
          `https://${archiveStorageAccount}.blob.core.windows.net`,
          credential,
        ).getContainerClient('task-events'),
      ),
    )
    : undefined;
  const taskEventArchiveJob = taskEventArchive
    ? createTaskEventArchiveJob(taskEventArchive, () => logger.warn('task_event_archive.failed'))
    : undefined;
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
    ? new SandboxHeartbeat(createSandboxHeartbeatStore(database.pool, eventHub), clientFor, {
      onError: (error) => {
        const details = error instanceof FoundryClientError
          ? { kind: error.kind, statusCode: error.statusCode, operation: error.operation }
          : { kind: 'internal' };
        logger.warn(details, 'sandbox_heartbeat.poll_failed');
      },
    })
    : undefined;
  const modules: BackendModule[] = [coreModule, conversationModule, factoryModule, createSleepModule(containerAppScaler)];
  if ((config.voiceLiveEndpoint || config.foundryProjectEndpoint) && credential) {
    modules.push(createVoiceRelayModule({
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Voice identity unavailable');
        return token.token;
      },
      ...(config.voiceLiveEndpoint ? { connect: createVoiceLiveConnector(config.voiceLiveEndpoint) } : {}),
      ...(config.foundryProjectEndpoint
        ? { connectDanish: createDanishVoiceConnector(config.foundryProjectEndpoint) }
        : {}),
    }));
  }
  const app = buildApp(config, logger, {
    modules,
    ...(database ? {
      projectStore: createProjectStore(database.pool),
      toolCallStore: createToolCallStore(database.pool),
      settingsStore: createSettingsStore(database.pool),
      conversationStore: createConversationStore(database.pool),
      taskStore: createTaskStore(database.pool, eventHub, taskEventArchive),
    } : {}),
    ...(sandboxHeartbeat ? { sandboxHeartbeat } : {}),
    eventHub,
    ...(config.chatAgentUrl ? { conversationAgent: createHttpConversationAgent(config.chatAgentUrl) } : {}),
  });
  if (database) registerDatabase(app, database);
  else logger.info('database.not_configured');
  if (database && !sandboxHeartbeat) logger.warn('sandbox_heartbeat.configuration_missing');
  if (!telemetry) logger.info('telemetry.stdout_only');

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await taskEventArchiveJob?.stop();
      await shutdown(app, telemetry);
    }
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
      taskEventArchiveJob?.start();
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

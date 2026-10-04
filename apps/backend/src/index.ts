import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { buildApp } from './app.js';
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
import { createDispatcherStore } from './database/dispatcher-store.js';
import { createTaskRecoveryStore } from './database/recovery-store.js';
import { createCredentialStatusStore } from './database/credential-status-store.js';
import { createUsageStore } from './database/usage-store.js';
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
import { createFoundryInvocationConversationAgent } from './core/chat-agent.js';
import { FoundryClient, FoundryClientError } from './foundry/client.js';
import { SandboxHeartbeat } from './factory/heartbeat.js';
import { TaskDispatcher } from './factory/dispatcher.js';
import { startDailyCodexRenewalJob } from './credentials/codex-renewal.js';
import { createNowFeedStore } from './database/now-feed-store.js';
import { createGitHubAppRepositoryCatalog, createGitHubAppTokenIssuer } from './github-app.js';
import { createRepoAdminRepositoryCreator } from './credentials/repo-admin.js';
import { createWebhookDeliveryStore } from './database/webhook-delivery-store.js';
import { createChecksLoopStore } from './database/checks-loop-store.js';
import { createChecksLoopBlobStore } from './database/checks-loop-blob.js';
import { createGitHubActionsLogClient } from './github/actions-logs.js';
import { createChecksLoop } from './github/checks-loop.js';
import { createGithubWebhookModule } from './github/webhook.js';
import { createProjectPolicyStore } from './database/project-policy-store.js';
import { createProjectPolicyEvaluator } from './github/project-policy.js';
import { createGitHubDeliveryHandler } from './github/delivery.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createPcBridgeStatusStore } from './database/pc-bridge-status-store.js';
import { createAlertNotifier } from './alerts.js';
import type { NowFeedUpdate } from './core/now.js';
import { createAlertActivityStore } from './database/alert-store.js';
import { createGraphClient } from './graph/client.js';
import { createNotesModule } from './notes/index.js';
import { createArmBudgetReader, startBudgetAlertMonitor } from './operations/budget-alert.js';
import { createTeamsNotificationStore } from './database/teams-notification-store.js';
import { createEphemeralAudioStore } from './teams/audio-store.js';
import { createAzureSpeechSynthesizer } from './teams/speech.js';
import { createTeamsBotModule, createTeamsConnector } from './teams/bot.js';
import { createTeamsNotificationService } from './teams/service.js';

try {
  const config = loadConfig();
  const databaseConfig = loadDatabaseConfig();
  if (config.teams && !databaseConfig) {
    throw new ConfigurationError('SQL is required for Teams conversations and confirmations');
  }
  const archiveStorageAccount = loadTaskEventArchiveStorageAccount();
  if (databaseConfig && !archiveStorageAccount) {
    throw new ConfigurationError('TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT is required when SQL is configured');
  }
  const sleepResourceId = process.env.BACKEND_CONTAINER_APP_RESOURCE_ID;
  const managedIdentityClientId = process.env.SQL_MANAGED_IDENTITY_CLIENT_ID;
  if (sleepResourceId && !managedIdentityClientId) {
    throw new ConfigurationError('SQL_MANAGED_IDENTITY_CLIENT_ID is required for backend scaling');
  }
  const telemetry = await createTelemetry(config.applicationInsightsConnectionString);
  const logger = createLogger(config, telemetry);
  const database = databaseConfig ? createDatabase(databaseConfig) : undefined;
  const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
  const nowEventHub = createEventHub<NowFeedUpdate>();
  const alertNotifier = createAlertNotifier(telemetry);
  const credential = archiveStorageAccount || config.keyVaultUri || config.voiceLiveEndpoint || config.foundryProjectEndpoint ||
    config.foundryEndpoints || config.githubAppId || config.teams || sleepResourceId
    ? new DefaultAzureCredential(managedIdentityClientId
      ? { managedIdentityClientId }
      : {})
    : undefined;
  const graphClient = credential
    ? createGraphClient({
      getToken: async (signal) => {
        const token = await credential.getToken('https://graph.microsoft.com/.default', { abortSignal: signal });
        if (!token) throw new Error('Microsoft Graph credentials are unavailable');
        return token.token;
      },
    })
    : undefined;
  const projectRepositoryCreator = config.keyVaultUri && credential
    ? createRepoAdminRepositoryCreator(
      config.keyVaultUri,
      async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Key Vault identity unavailable');
        return token.token;
      },
    )
    : undefined;
  const githubAppKeyVault = config.githubAppId && config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  const getGitHubAppPrivateKey = async () => {
    if (!githubAppKeyVault) throw new Error('GitHub App private key is unavailable');
    const secret = await githubAppKeyVault.getSecret('github-app-private-key');
    if (!secret.value) throw new Error('GitHub App private key is unavailable');
    return secret.value;
  };
  const githubAppTokenIssuer = config.githubAppId && githubAppKeyVault
    ? createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      getPrivateKey: getGitHubAppPrivateKey,
    })
    : undefined;
  const githubRepositoryCatalog = config.githubAppId && githubAppKeyVault
    ? createGitHubAppRepositoryCatalog({
      appId: config.githubAppId,
      getPrivateKey: getGitHubAppPrivateKey,
    })
    : undefined;
  const webhookSecretClient = config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  let webhookSecret: string | undefined;
  let webhookSecretRequest: Promise<string | undefined> | undefined;
  const getWebhookSecret = () => {
    if (webhookSecret !== undefined) return Promise.resolve(webhookSecret);
    if (!webhookSecretClient) return Promise.resolve(undefined);
    webhookSecretRequest ??= webhookSecretClient.getSecret('github-app-webhook-secret')
      .then(({ value }) => {
        if (value) webhookSecret = value;
        return value;
      })
      .finally(() => { webhookSecretRequest = undefined; });
    return webhookSecretRequest;
  };
  const conversationAgent = config.foundryProjectEndpoint && config.foundryChatAgentName && credential
    ? createFoundryInvocationConversationAgent(
      config.foundryProjectEndpoint,
      config.foundryChatAgentName,
      async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry chat identity unavailable');
        return token.token;
      },
    )
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
    if (!config.foundryEndpoints || !credential) throw new Error('Foundry runner is not configured');
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
    ? new SandboxHeartbeat(createSandboxHeartbeatStore(database.pool, eventHub, alertNotifier), clientFor, {
      onDecision: (decision) => logger.info(decision, 'sandbox_heartbeat.decision'),
      onError: (error) => {
        const details = error instanceof FoundryClientError
          ? { kind: error.kind, statusCode: error.statusCode, operation: error.operation }
          : { kind: 'internal' };
        logger.warn(details, 'sandbox_heartbeat.poll_failed');
      },
    })
    : undefined;
  const containerAppScaler = sleepResourceId && credential
    ? createArmContainerAppScaler({
      resourceId: sleepResourceId,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Container Apps managed identity unavailable');
        return token.token;
      },
    })
    : null;
  const projectStore = database ? createProjectStore(database.pool) : undefined;
  const taskStore = database ? createTaskStore(database.pool, eventHub, taskEventArchive) : undefined;
  const teamsAudioStore = config.teams ? createEphemeralAudioStore() : undefined;
  const teamsSpeech = config.teams && credential
    ? createAzureSpeechSynthesizer(
      config.teams.speechRegion,
      async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Speech identity unavailable');
        return token.token;
      },
    )
    : undefined;
  const teamsNotifications = config.teams && database && credential && teamsAudioStore
    ? createTeamsNotificationService({
      ownerObjectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      publicOrigin: config.teams.audioOrigin,
      store: createTeamsNotificationStore(database.pool),
      connector: createTeamsConnector(config.teams.botAppId, config.teams.tenantId),
      audioStore: teamsAudioStore,
      ...(teamsSpeech ? { speech: teamsSpeech } : {}),
    })
    : undefined;
  const webhookDeliveryStore = database ? createWebhookDeliveryStore(database.pool, alertNotifier) : null;
  const projectPolicyEvaluator = database && taskStore && githubAppTokenIssuer
    ? createProjectPolicyEvaluator({
      store: createProjectPolicyStore(database.pool),
      tasks: taskStore,
      tokenIssuer: githubAppTokenIssuer,
      ...(teamsNotifications ? {
        runConfirmed: (summary, action) => teamsNotifications.runConfirmed('merge', summary, action),
      } : {}),
      onConfirmationError: () => logger.warn('project_policy.confirmation_failed'),
    })
    : undefined;
  const settingsStore = database ? createSettingsStore(database.pool) : undefined;
  const pcBridgeStatusStore = database
    ? createPcBridgeStatusStore(database.pool, () => nowEventHub.publish({ type: 'refresh' }))
    : undefined;
  const dispatcher = database && taskStore && settingsStore && sandboxHeartbeat && config.foundryEndpoints
    ? new TaskDispatcher(
      createDispatcherStore(database.pool, eventHub),
      taskStore,
      settingsStore,
      clientFor,
      sandboxHeartbeat,
      eventHub,
      {
        onError: () => logger.warn('dispatcher.operation_failed'),
        recoveryStore: createTaskRecoveryStore(database.pool, eventHub),
        workspaceFor: async (task) => {
          if (!task.branch) return null;
          const project = (await projectStore?.list())?.find(({ id }) => id === task.projectId);
          return project
            ? { repository: project.repo, defaultBranch: project.default_branch, branch: task.branch }
            : null;
        },
        ...(githubAppTokenIssuer
          ? { verifyDelivery: createGitHubDeliveryHandler(githubAppTokenIssuer, taskStore, config.staticWebAppOrigin) }
          : {}),
      },
    )
    : undefined;
  const checksLoop = database && archiveStorageAccount && credential && githubAppTokenIssuer &&
    taskStore && settingsStore && dispatcher
    ? createChecksLoop({
      store: createChecksLoopStore(database.pool),
      logs: createGitHubActionsLogClient(githubAppTokenIssuer),
      blobs: createChecksLoopBlobStore(
        new BlobServiceClient(
          `https://${archiveStorageAccount}.blob.core.windows.net`,
          credential,
        ).getContainerClient('logs'),
      ),
      settings: settingsStore,
      tasks: taskStore,
      controller: dispatcher,
      onError: () => logger.warn('github.checks_loop_recovery_failed'),
    })
    : undefined;
  const modules: BackendModule[] = [
    coreModule, conversationModule, factoryModule, createSleepModule(containerAppScaler),
    createGithubWebhookModule({
      deliveryStore: webhookDeliveryStore,
      getSecret: getWebhookSecret,
      ...(checksLoop || projectPolicyEvaluator ? {
        onMapping: async (mapping) => {
          await checksLoop?.handleMapping(mapping);
          await projectPolicyEvaluator?.handle(mapping);
        },
      } : {}),
    }),
    createPcBridgeModule({
      ...(pcBridgeStatusStore ? { onStatusChange: (online) => pcBridgeStatusStore.setStatus(online) } : {}),
      onStatusError: () => logger.warn('pc_bridge.status_update_failed'),
    }),
  ];
  if (graphClient) {
    modules.push(createNotesModule({
      graph: graphClient,
      ownerObjectId: config.auth.ownerObjectId,
      folderPath: config.notesFolderPath,
    }));
  }
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
  if (config.teams && teamsNotifications && teamsAudioStore) {
    modules.push(await createTeamsBotModule({
      clientId: config.teams.botAppId,
      tenantId: config.teams.tenantId,
      notificationService: teamsNotifications,
      audioStore: teamsAudioStore,
    }));
  }
  const credentialStatusStore = database ? createCredentialStatusStore(database.pool, {
    alertNotifier,
    onAlert: () => nowEventHub.publish({ type: 'refresh' }),
  }) : undefined;
  const budgetAlertStore = database
    ? createAlertActivityStore(database.pool, () => nowEventHub.publish({ type: 'refresh' }))
    : undefined;
  const budgetReader = database && credential && config.monthlyBudgetResourceId
    ? createArmBudgetReader({
      resourceId: config.monthlyBudgetResourceId,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Azure budget identity unavailable');
        return token.token;
      },
    })
    : undefined;
  const app = buildApp(config, logger, {
    modules,
    ...(database ? { databaseStatus: () => database.isWaking() } : {}),
    ...(database && taskStore && settingsStore ? {
      ...(projectStore ? { projectStore } : {}),
      ...(projectRepositoryCreator ? { projectRepositoryCreator } : {}),
      toolCallStore: createToolCallStore(database.pool),
      settingsStore: settingsStore,
      conversationStore: createConversationStore(database.pool),
      taskStore,
      ...(githubAppTokenIssuer ? { githubAppTokenIssuer } : {}),
      ...(githubRepositoryCatalog ? { githubRepositoryCatalog } : {}),
      ...(dispatcher ? { taskController: dispatcher } : {}),
      nowFeedStore: createNowFeedStore(database.pool),
      usageStore: createUsageStore(database.pool),
    } : {}),
    ...(credentialStatusStore ? { credentialStatusStore } : {}),
    ...(sandboxHeartbeat ? { sandboxHeartbeat } : {}),
    eventHub,
    nowEventHub,
    ...(conversationAgent ? { conversationAgent } : {}),
    ...(teamsNotifications ? { teamsNotifications } : {}),
  });
  if (checksLoop) app.addHook('onClose', async () => { await checksLoop.stop(); });
  if (dispatcher) app.addHook('onClose', async () => { await dispatcher.stop(); });
  if (database) registerDatabase(app, database);
  else logger.info('database.not_configured');
  let stopBudgetMonitor: (() => Promise<void>) | undefined;
  if (budgetReader && budgetAlertStore) {
    app.addHook('onClose', async () => { await stopBudgetMonitor?.(); });
    app.addHook('onReady', async () => {
      stopBudgetMonitor = startBudgetAlertMonitor(
        budgetReader,
        budgetAlertStore,
        () => logger.warn('budget_alert.check_failed'),
      );
    });
  }
  if (database && credential && config.foundryEndpoints && config.foundryRunnerAgentName) {
    const client = clientFor(config.foundryRunnerAgentName);
    let stopCodexRenewal: (() => void) | undefined;
    app.addHook('onClose', async () => { stopCodexRenewal?.(); });
    app.addHook('onReady', async () => {
      stopCodexRenewal = startDailyCodexRenewalJob(
        app.credentialStatusStore!,
        client,
        (outcome) => logger.info({ outcome }, 'credentials.codex_renewal'),
      );
    });
  }
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
    await teamsNotifications?.expirePendingConfirmations();
    if (!stopping) {
      await sandboxHeartbeat?.start();
      dispatcher?.start();
      await app.listen({ port: config.port, host: '0.0.0.0' });
      void checksLoop?.start();
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

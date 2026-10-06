import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import { CallAutomationClient } from '@azure/communication-call-automation';
import { buildApp } from './app.js';
import { BlobServiceClient } from '@azure/storage-blob';
import { ConfigurationError, loadConfig } from './config.js';
import { createLogger, createTelemetry, safeErrorFields } from './logging.js';
import { shutdown } from './shutdown.js';
import { loadDatabaseConfig } from './database/config.js';
import { createDatabase, registerDatabase } from './database/lifecycle.js';
import { createToolCallStore } from './database/tool-call-store.js';
import { createSettingsStore } from './database/settings-store.js';
import { createProjectStore } from './database/project-store.js';
import { createReleaseViewStore } from './database/release-view-store.js';
import { createConversationStore } from './database/conversation-store.js';
import { createPhoneSessionStore } from './database/phone-session-store.js';
import { createTaskStore } from './database/task-store.js';
import { createTaskStatusNotificationStore } from './database/task-status-notification-store.js';
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
import { createJevReflexClassifier } from './core/reflex.js';
import {
  createBrowserAgent,
  createBrowserAgentModule,
  createFoundryBrowserTextModel,
  createJevBrowserPlanner,
} from './core/browser-agent.js';
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
import { FoundryClient } from './foundry/client.js';
import { createJevPcActPlanner } from './pc-bridge/pc-act.js';
import { createJevRecipePlanner } from './core/task-recipes.js';
import { createRecipeModule } from './core/recipe-management.js';
import { createRecipeStore } from './database/recipe-store.js';
import { SandboxHeartbeat } from './factory/heartbeat.js';
import { TaskDispatcher } from './factory/dispatcher.js';
import { runCodexRenewalOnce, startDailyCodexRenewalJob } from './credentials/codex-renewal.js';
import { startDailyCopilotStatusJob } from './credentials/copilot-status.js';
import { createNowFeedStore } from './database/now-feed-store.js';
import { createGitHubAppRepositoryCatalog, createGitHubAppTokenIssuer } from './github-app.js';
import { createRepoAdminRepositoryCreator } from './credentials/repo-admin.js';
import { createWebhookDeliveryStore } from './database/webhook-delivery-store.js';
import { createChecksLoopStore } from './database/checks-loop-store.js';
import { createChecksLoopBlobStore } from './database/checks-loop-blob.js';
import { createGitHubActionsLogClient } from './github/actions-logs.js';
import { createGitHubReleaseGraphReader } from './github/release-graph.js';
import { createChecksLoop } from './github/checks-loop.js';
import { createGithubWebhookModule } from './github/webhook.js';
import { createProjectPolicyStore } from './database/project-policy-store.js';
import { createProjectPolicyEvaluator } from './github/project-policy.js';
import { createGitHubDeliveryHandler } from './github/delivery.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createPcBridgeStatusStore } from './database/pc-bridge-status-store.js';
import { createAlertNotifier, notifyAlert } from './alerts.js';
import type { NowFeedUpdate } from './core/now.js';
import { createAlertActivityStore } from './database/alert-store.js';
import { createMemoryStore, createVaultIndexStore } from './database/memory-store.js';
import { createFoundryMemoryEmbedder } from './core/memory-embeddings.js';
import { createGitHubVaultClient, VAULT_BRANCH, VAULT_REPOSITORY } from './vault/github-client.js';
import { createVaultModule } from './vault/index.js';
import { createArmBudgetReader, startBudgetAlertMonitor } from './operations/budget-alert.js';
import { createGoogleApiClient } from './google/api-client.js';
import { createGoogleTokenProvider, type GoogleOAuthCredentials } from './google/oauth.js';
import { createGoogleModule } from './google/tools.js';
import { createScreenFrameUsageStore } from './database/screen-usage-store.js';
import { createFoundryScreenVisionModel } from './vision/foundry-model.js';
import { createScreenVisionModule, ScreenVisionService } from './vision/screen.js';
import { createVisionWatchModule, VisionWatchService } from './vision/watch.js';
import { createWebResearchModule } from './core/web-research.js';
import { createTeamsNotificationStore } from './database/teams-notification-store.js';
import { createEphemeralAudioStore } from './teams/audio-store.js';
import { createAzureSpeechSynthesizer } from './teams/speech.js';
import { createTeamsBotModule, createTeamsConnector } from './teams/bot.js';
import { createTeamsNotificationService } from './teams/service.js';
import { createAzureSpeechPartialRecognizerFactory } from './voice/speech-recognizer.js';
import { createAwayModeStore } from './database/away-mode-store.js';
import { createPhoneCallModule } from './phone/calls.js';
import { parsePhoneAllowlist } from './phone/caller.js';
import { createImageGenerationModule } from './core/image-generation.js';
import { WorkspaceArtifactStore } from './database/workspace-artifact-store.js';

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
  const memoryStore = database ? createMemoryStore(database.pool) : undefined;
  const vaultIndexStore = database ? createVaultIndexStore(database.pool) : undefined;
  const phoneSessionStore = database && config.phone
    ? createPhoneSessionStore(database.pool)
    : undefined;
  const eventHub: TaskEventHub = createEventHub<TaskEventMessage>();
  const nowEventHub = createEventHub<NowFeedUpdate>();
  const nowFeedStore = database
    ? createNowFeedStore(database.pool, () => nowEventHub.publish({ type: 'refresh' }))
    : undefined;
  const alertActivityStore = database
    ? createAlertActivityStore(database.pool, () => nowEventHub.publish({ type: 'refresh' }))
    : undefined;
  const awayModeStore = database
    ? createAwayModeStore(database.pool, (state) => nowEventHub.publish({ type: 'mode_changed', away: state.away }))
    : undefined;
  const alertNotifier = createAlertNotifier(telemetry);
  const credentialStatusStore = database ? createCredentialStatusStore(database.pool, {
    alertNotifier,
    onAlert: () => nowEventHub.publish({ type: 'refresh' }),
  }) : undefined;
  const credential = archiveStorageAccount || config.keyVaultUri || config.voiceLiveEndpoint || config.foundryProjectEndpoint ||
    config.foundryEndpoints || config.githubAppId || config.googleTimeZone || config.teams || sleepResourceId
    ? new DefaultAzureCredential(managedIdentityClientId
      ? { managedIdentityClientId }
      : {})
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
  const googleSecretClient = config.googleTimeZone && config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  const googleModule = config.googleTimeZone && googleSecretClient
    ? createGoogleModule(createGoogleApiClient({
      tokens: createGoogleTokenProvider({
        getCredentials: async (): Promise<GoogleOAuthCredentials> => {
          const [clientId, clientSecret, refreshToken] = await Promise.all([
            googleSecretClient.getSecret('google-oauth-client-id'),
            googleSecretClient.getSecret('google-oauth-client-secret'),
            googleSecretClient.getSecret('google-refresh-token'),
          ]);
          if (![clientId.value, clientSecret.value, refreshToken.value].every((value) =>
            typeof value === 'string' && value.trim() && value.length <= 10_000 && !/[\r\n]/u.test(value))) {
            throw new Error('Google OAuth credentials are unavailable');
          }
          return {
            clientId: clientId.value!,
            clientSecret: clientSecret.value!,
            refreshToken: refreshToken.value!,
          };
        },
        onInvalidGrant: async () => {
          if (!alertActivityStore) {
            logger.warn('google.refresh_token_expired_alert_unavailable');
            return;
          }
          try {
            const alert = {
              type: 'credential_expiry',
              dedupeKey: 'credential:google-refresh-token:invalid-grant',
              title: 'Google authorization needs attention',
              link: null,
            } as const;
            if (await alertActivityStore.record(alert)) notifyAlert(alertNotifier, alert);
          } catch (error) {
            logger.warn(safeErrorFields(error), 'google.refresh_token_expired_alert_persistence_failed');
          }
        },
      }),
    }), { timeZone: config.googleTimeZone })
    : undefined;
  const getGitHubAppPrivateKey = async () => {
    if (!githubAppKeyVault) throw new Error('GitHub App private key is unavailable');
    const secret = await githubAppKeyVault.getSecret('github-app-private-key');
    if (!secret.value) throw new Error('GitHub App private key is unavailable');
    return secret.value;
  };
  const onTokenMint = async (status: 'ok' | 'failed', checkedAt: string) => {
    try { await credentialStatusStore?.updateGitHubAppStatus(status, checkedAt); }
    catch { logger.warn('credentials.github_app_status_failed'); }
  };
  const githubAppTokenIssuer = config.githubAppId && githubAppKeyVault
    ? createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      getPrivateKey: getGitHubAppPrivateKey,
      onTokenMint,
    })
    : undefined;
  const githubRepositoryCatalog = config.githubAppId && githubAppKeyVault
    ? createGitHubAppRepositoryCatalog({
      appId: config.githubAppId,
      getPrivateKey: getGitHubAppPrivateKey,
      onTokenMint,
    })
    : undefined;
  const webhookSecretClient = config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  const phoneSecretClient = config.phone && config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  let phoneAllowlist: ReturnType<typeof parsePhoneAllowlist> | undefined;
  let phoneAllowlistRequest: Promise<ReturnType<typeof parsePhoneAllowlist>> | undefined;
  const getPhoneAllowlist = () => {
    if (phoneAllowlist) return Promise.resolve(phoneAllowlist);
    if (!phoneSecretClient) return Promise.reject(new Error('Phone allow-list is unavailable'));
    phoneAllowlistRequest ??= phoneSecretClient.getSecret('jarvis-phone-allowlist')
      .then(({ value }) => {
        if (!value) throw new Error('Phone allow-list is unavailable');
        phoneAllowlist = parsePhoneAllowlist(value);
        return phoneAllowlist;
      })
      .finally(() => { phoneAllowlistRequest = undefined; });
    return phoneAllowlistRequest;
  };
  const jevSecretClient = config.keyVaultUri && credential
    ? new SecretClient(config.keyVaultUri, credential)
    : undefined;
  let jevApiKey: string | undefined;
  let jevApiKeyRequest: Promise<string | undefined> | undefined;
  const getJevApiKey = () => {
    if (jevApiKey !== undefined) return Promise.resolve(jevApiKey);
    if (!jevSecretClient) return Promise.resolve(undefined);
    jevApiKeyRequest ??= jevSecretClient.getSecret('jev-api-key')
      .then(({ value }) => {
        if (!value || !value.trim() || value.length > 10_000 || /[\r\n]/u.test(value)) return undefined;
        jevApiKey = value;
        return value;
      })
      .catch(() => undefined)
      .finally(() => { jevApiKeyRequest = undefined; });
    return jevApiKeyRequest;
  };
  const reflexClassifier = createJevReflexClassifier(getJevApiKey);
  const pcActPlanner = jevSecretClient ? createJevPcActPlanner(getJevApiKey) : undefined;
  const recipeStore = database ? createRecipeStore(database.pool) : undefined;
  const recipes = recipeStore && jevSecretClient
    ? { store: recipeStore, planner: createJevRecipePlanner(getJevApiKey) }
    : undefined;
  const browserAgent = jevSecretClient && config.foundryProjectEndpoint && credential
    ? createBrowserAgent(
      createJevBrowserPlanner(getJevApiKey),
      createFoundryBrowserTextModel(config.foundryProjectEndpoint, async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry browser identity unavailable');
        return token.token;
      }),
      { ...(recipes ? { recipes } : {}) },
    )
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
  const memoryEmbedder = config.foundryProjectEndpoint &&
    config.foundryMemoryEmbeddingDeploymentName && credential
    ? createFoundryMemoryEmbedder({
      projectEndpoint: config.foundryProjectEndpoint,
      deploymentName: config.foundryMemoryEmbeddingDeploymentName,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry memory embedding identity unavailable');
        return token.token;
      },
    })
    : undefined;
  const vaultModule = memoryStore && vaultIndexStore && githubAppTokenIssuer
    ? createVaultModule({
      client: createGitHubVaultClient({ tokenIssuer: githubAppTokenIssuer }),
      indexStore: vaultIndexStore,
      memoryStore,
      ...(memoryEmbedder ? { embedder: memoryEmbedder } : {}),
      log: (event, fields) => logger.info({ msg: event, ...fields }, event),
    })
    : undefined;
  const foundryClients = new Map<string, FoundryClient>();
  const trackedRepositories = new Set<string>();
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
  const workspaceArtifactServiceClient = database && archiveStorageAccount && credential
    ? new BlobServiceClient(`https://${archiveStorageAccount}.blob.core.windows.net`, credential)
    : undefined;
  const workspaceArtifacts = database && archiveStorageAccount && workspaceArtifactServiceClient
    ? new WorkspaceArtifactStore({
      pool: database.pool,
      serviceClient: workspaceArtifactServiceClient,
      container: workspaceArtifactServiceClient.getContainerClient('artifacts'),
      storageAccount: archiveStorageAccount,
    })
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
  const webResearchModule = database && credential && config.foundryEndpoints && config.foundryRunnerAgentName
    ? createWebResearchModule(() => clientFor(config.foundryRunnerAgentName!), config.codexToolModel)
    : undefined;
  const sandboxHeartbeat = database && config.foundryEndpoints
    ? new SandboxHeartbeat(createSandboxHeartbeatStore(database.pool, eventHub, alertNotifier), clientFor, {
      onDecision: (decision) => logger.info(decision, 'sandbox_heartbeat.decision'),
      onError: (error) => logger.warn(safeErrorFields(error), 'sandbox_heartbeat.poll_failed'),
    })
    : undefined;
  const taskEventArchiveJob = taskEventArchive
    ? createTaskEventArchiveJob(
      taskEventArchive,
      (error) => logger.warn(safeErrorFields(error), 'task_event_archive.failed'),
      () => sandboxHeartbeat?.hasTrackedSessions() ?? false,
    )
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
  const projectStore = database ? createProjectStore(database.pool, trackedRepositories) : undefined;
  const taskStore = database ? createTaskStore(database.pool, eventHub, taskEventArchive) : undefined;
  const taskStatusNotificationStore = database ? createTaskStatusNotificationStore(database.pool) : undefined;
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
  const teamsNotifications = database && nowFeedStore
    ? createTeamsNotificationService({
      ownerObjectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
      store: createTeamsNotificationStore(database.pool),
      ...(config.teams && credential && teamsAudioStore ? {
        publicOrigin: config.teams.audioOrigin,
        connector: createTeamsConnector(config.teams.botAppId, config.teams.tenantId),
        audioStore: teamsAudioStore,
      } : {}),
      ...(awayModeStore ? { isAway: async () => (await awayModeStore.read()).away } : {}),
      onWebNotification: async (kind, text) => {
        if (!nowFeedStore.recordNotification) throw new Error('Now feed notifications are unavailable');
        await nowFeedStore.recordNotification(kind, text);
      },
      onConfirmationsChanged: () => nowEventHub.publish({ type: 'refresh' }),
      onConfirmationPending: () => nowEventHub.publish({ type: 'status', kind: 'approval_pending' }),
      ...(teamsSpeech ? { speech: teamsSpeech } : {}),
    })
    : undefined;
  const webhookDeliveryStore = database ? createWebhookDeliveryStore(database.pool, alertNotifier) : null;
  const releaseViewStore = database ? createReleaseViewStore(database.pool) : undefined;
  const releaseGraphReader = githubAppTokenIssuer
    ? createGitHubReleaseGraphReader(githubAppTokenIssuer)
    : undefined;
  const projectPolicyEvaluator = database && taskStore && githubAppTokenIssuer
    ? createProjectPolicyEvaluator({
      store: createProjectPolicyStore(database.pool),
      tasks: taskStore,
      tokenIssuer: githubAppTokenIssuer,
      ...(teamsNotifications ? {
        runConfirmed: (summary, action) => teamsNotifications.runConfirmed('merge', summary, action),
      } : {}),
      onConfirmationError: (error) => logger.warn(safeErrorFields(error), 'project_policy.confirmation_failed'),
      onError: (error) => logger.warn(safeErrorFields(error), 'project_policy.recheck_failed'),
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
        onError: (error) => logger.warn(safeErrorFields(error), 'dispatcher.operation_failed'),
        onReconciliation: (decision) => logger.info(decision, 'task_reconciliation.decision'),
        onStartFailure: (failure) => logger.warn(failure, 'dispatcher.start_failed'),
        recoveryStore: createTaskRecoveryStore(database.pool, eventHub),
        workspaceFor: async (task) => {
          if (!task.branch) return null;
          const project = (await projectStore?.list())?.find(({ id }) => id === task.projectId);
          return project
            ? { repository: project.repo, defaultBranch: project.default_branch, branch: task.branch }
            : null;
        },
        ...(githubAppTokenIssuer
          ? {
            verifyDelivery: createGitHubDeliveryHandler(
              githubAppTokenIssuer,
              taskStore,
              config.staticWebAppOrigin,
              undefined,
              async (mapping) => { await webhookDeliveryStore?.recordPullRequest(mapping); },
              async (mapping) => { await projectPolicyEvaluator?.handle(mapping); },
            ),
          }
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
      onError: (error) => logger.warn(safeErrorFields(error), 'github.checks_loop_recovery_failed'),
    })
    : undefined;
  const screenVisionModel = config.foundryProjectEndpoint && credential
    ? createFoundryScreenVisionModel(config.foundryProjectEndpoint, async (scope, signal) => {
      const token = await credential.getToken(scope, { abortSignal: signal });
      if (!token) throw new Error('Foundry screen identity unavailable');
      return token.token;
    })
    : undefined;
  const modules: BackendModule[] = [
    coreModule, conversationModule, factoryModule, createSleepModule(containerAppScaler),
    createRecipeModule(recipeStore),
    ...(vaultModule ? [vaultModule] : []),
    ...(webResearchModule ? [webResearchModule] : []),
    ...(googleModule ? [googleModule] : []),
    createGithubWebhookModule({
      deliveryStore: webhookDeliveryStore,
      getSecret: getWebhookSecret,
      ...(githubAppTokenIssuer ? {
        readWorkflowRun: createGitHubActionsLogClient(githubAppTokenIssuer).readWorkflowRun,
      } : {}),
      isTrackedRepository: (repository) => repository.toLowerCase() === VAULT_REPOSITORY.toLowerCase() ||
        trackedRepositories.has(repository.toLowerCase()),
      ...(checksLoop || projectPolicyEvaluator || vaultModule ? {
        onMapping: async (mapping) => {
          if (mapping.kind === 'push' && mapping.repository.toLowerCase() === VAULT_REPOSITORY.toLowerCase() &&
              mapping.ref === `refs/heads/${VAULT_BRANCH}` && vaultModule) {
            void vaultModule.synchronize(AbortSignal.timeout(10 * 60_000)).catch(() => {
              logger.warn({
                msg: 'vault.index', outcome: 'error', added: 0, changed: 0, removed: 0,
              }, 'vault.index');
            });
          }
          await checksLoop?.handleMapping(mapping);
          await projectPolicyEvaluator?.handle(mapping);
        },
      } : {}),
    }),
    createPcBridgeModule({
      ...(screenVisionModel ? {
        pcActVisionModel: screenVisionModel,
        pcActVisionDeployment: 'gpt-5.6-luna',
      } : {}),
      ...(pcActPlanner ? {
        pcActPlanner,
        ...(recipes ? { recipes } : {}),
        onPcActStep: (activity) => logger.info(activity, 'pc_act.step'),
      } : {}),
      ...(pcBridgeStatusStore ? {
        onStatusChange: (online, controlPaused) => pcBridgeStatusStore.setStatus(online, controlPaused),
      } : {}),
      ...(teamsNotifications ? {
        runConfirmed: (summary, action, signal) =>
          teamsNotifications.runConfirmed('computer_use', summary, action, signal),
      } : {}),
      onStatusError: (error) => logger.warn(safeErrorFields(error), 'pc_bridge.status_update_failed'),
    }),
  ];
  const phoneCallModule = config.phone && phoneSessionStore && phoneSecretClient && credential &&
    config.teams && config.foundryProjectEndpoint
    ? createPhoneCallModule({
      client: new CallAutomationClient(config.phone.acsEndpoint, credential),
      store: phoneSessionStore,
      ownerObjectId: config.auth.ownerObjectId,
      teamsResourceAccountObjectId: config.phone.teamsResourceAccountObjectId,
      publicOrigin: config.teams.audioOrigin,
      getAllowlist: getPhoneAllowlist,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry voice identity unavailable');
        return token.token;
      },
      connect: createDanishVoiceConnector(config.foundryProjectEndpoint),
    })
    : undefined;
  if (phoneCallModule) modules.push(phoneCallModule);
  if (browserAgent) modules.push(createBrowserAgentModule(browserAgent));
  if (workspaceArtifacts && config.foundryEndpoints && config.foundryRunnerAgentName) {
    modules.push(createImageGenerationModule({
      runner: clientFor(config.foundryRunnerAgentName),
      artifacts: workspaceArtifacts,
      model: config.codexImageModel,
    }));
  }
  let visionWatch: VisionWatchService | undefined;
  if (database && settingsStore && screenVisionModel) {
    const visionUsage = createScreenFrameUsageStore(database.pool);
    modules.push(createScreenVisionModule(new ScreenVisionService(screenVisionModel, visionUsage)));
    visionWatch = new VisionWatchService(screenVisionModel, visionUsage, createConversationStore(database.pool));
    modules.push(createVisionWatchModule(visionWatch));
  }
  if ((config.voiceLiveEndpoint || config.foundryProjectEndpoint) && credential) {
    modules.push(createVoiceRelayModule({
      ...(visionWatch ? { visionWatch } : {}),
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Voice identity unavailable');
        return token.token;
      },
      ...(config.voiceLiveEndpoint ? { connect: createVoiceLiveConnector(config.voiceLiveEndpoint) } : {}),
      ...(config.foundryProjectEndpoint
        ? {
          connectDanish: createDanishVoiceConnector(config.foundryProjectEndpoint),
          ...(phoneCallModule ? { registerPhoneMediaRoute: phoneCallModule.registerMediaRoute } : {}),
        }
        : {}),
      ...(config.foundryEndpoints
        ? {
          createPartialRecognizer: createAzureSpeechPartialRecognizerFactory(
            config.foundryEndpoints.runtime,
            async (scope, signal) => {
              const token = await credential.getToken(scope, { abortSignal: signal });
              if (!token) throw new Error('Speech identity unavailable');
              return token.token;
            },
          ),
        }
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
  const budgetAlertStore = alertActivityStore;
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
    ...(jevSecretClient ? { reflexClassifier } : {}),
    ...(browserAgent ? { browserAgent } : {}),
    ...(database ? { databaseStatus: () => database.isWaking() } : {}),
    ...(releaseViewStore ? { releaseViewStore } : {}),
    ...(releaseGraphReader ? { releaseGraphReader } : {}),
    ...(database && taskStore && settingsStore && nowFeedStore ? {
      ...(projectStore ? { projectStore } : {}),
      ...(projectRepositoryCreator ? { projectRepositoryCreator } : {}),
      toolCallStore: createToolCallStore(database.pool),
      settingsStore: settingsStore,
      conversationStore: createConversationStore(database.pool),
      ...(taskStatusNotificationStore ? { taskStatusNotificationStore } : {}),
      ...(visionWatch ? { onConversationSessionEnded: (sessionId: string) => visionWatch?.forgetSession(sessionId) } : {}),
      taskStore,
      ...(githubAppTokenIssuer ? { githubAppTokenIssuer } : {}),
      ...(githubRepositoryCatalog ? { githubRepositoryCatalog } : {}),
      ...(dispatcher ? { taskController: dispatcher } : {}),
      nowFeedStore,
      usageStore: createUsageStore(database.pool),
    } : {}),
    ...(awayModeStore ? { awayModeStore } : {}),
    ...(credentialStatusStore ? { credentialStatusStore } : {}),
    ...(credentialStatusStore && credential && config.foundryEndpoints && config.foundryRunnerAgentName ? {
      renewCodexCredential: () => runCodexRenewalOnce(
        credentialStatusStore,
        clientFor(config.foundryRunnerAgentName!),
        (details) => logger.warn(details, 'credentials.codex_renewal'),
        true,
      ),
    } : {}),
    ...(sandboxHeartbeat ? { sandboxHeartbeat } : {}),
    eventHub,
    nowEventHub,
    ...(conversationAgent ? { conversationAgent } : {}),
    ...(teamsNotifications ? { teamsNotifications } : {}),
    ...(phoneSessionStore ? { phoneSessionStore } : {}),
  });
  if (checksLoop || projectPolicyEvaluator) {
    app.addHook('onClose', async () => {
      await checksLoop?.stop();
      projectPolicyEvaluator?.stop();
    });
  }
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
        (error) => logger.warn(safeErrorFields(error), 'budget_alert.check_failed'),
      );
    });
  }
  if (credentialStatusStore && credential && config.keyVaultUri) {
    const secrets = new SecretClient(config.keyVaultUri, credential);
    let stopCopilotStatus: (() => void) | undefined;
    app.addHook('onClose', async () => { stopCopilotStatus?.(); });
    app.addHook('onReady', async () => {
      stopCopilotStatus = startDailyCopilotStatusJob(credentialStatusStore, {
        getSecret: async () => {
          const secret = await secrets.getSecret('jarvis-copilot', { abortSignal: AbortSignal.timeout(10_000) });
          if (!secret.value) throw new Error('Copilot credential unavailable');
          return {
            value: secret.value,
            expiresAt: secret.properties.expiresOn?.toISOString() ?? null,
            lastRenewedAt: secret.properties.updatedOn?.toISOString() ?? null,
          };
        },
      }, () => logger.warn('credentials.copilot_check_failed'));
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
        (outcome, details) => logger.info({ outcome, ...details }, 'credentials.codex_renewal'),
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
    catch (error) { logger.error(safeErrorFields(error), 'telemetry.close_failed'); process.exitCode = 1; }
    // Enforce the shutdown deadline even if an SDK/network handle remains open.
    process.exit(process.exitCode ?? 0);
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  try {
    if (database) {
      await database.initialize();
      await memoryStore?.initialize();
      await vaultIndexStore?.initialize();
      for (const project of await projectStore?.list() ?? []) {
        trackedRepositories.add(project.repo.toLowerCase());
      }
      logger.info('database.ready');
    }
    await teamsNotifications?.expirePendingConfirmations();
    if (!stopping) {
      await sandboxHeartbeat?.start();
      dispatcher?.start();
      await app.listen({ port: config.port, host: '0.0.0.0' });
      if (vaultModule) {
        void vaultModule.synchronize(AbortSignal.timeout(10 * 60_000)).catch(() => {
          logger.warn({
            msg: 'vault.index', outcome: 'error', added: 0, changed: 0, removed: 0,
          }, 'vault.index');
        });
      }
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

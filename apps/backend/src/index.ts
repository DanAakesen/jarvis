import { createBackendLogAuthorizationProbe } from './operations/backend-log-authorization.js';
import { handleIssueLabel } from './factory/issue-label.js';
import { randomUUID } from 'node:crypto';
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
import { createRuntimeSessionStore } from './database/runtime-session-store.js';
import { createManagedTargetReader } from './core/managed-target-reader.js';
import { createConversationSummaryStore } from './database/conversation-summary-store.js';
import { createPhoneSessionStore } from './database/phone-session-store.js';
import { createPhoneStatusModule } from './phone/status.js';
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
import { createConversationModule } from './core/conversation.js';
import { FrameStore } from './vision/frame-store.js';
import { createJevReflexClassifier } from './core/reflex.js';
import {
  createCachedDecisionProviderReader,
  createDecisionResolver,
  microsoftDecisionDeployment,
  microsoftDecisionScope,
} from './core/decision-provider.js';
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
  normalizeFoundryProjectEndpoint,
} from './voice/relay.js';
import { createArmContainerAppScaler } from './operations/container-app-scale.js';
import { createArmModelCatalogueReader, fallbackModelCatalogue } from './core/model-catalog.js';
import { createArmModelDeploymentClient, createModelDeploymentWorkflow } from './core/model-deployments.js';
import { createSleepModule } from './operations/sleep.js';
import { createFoundryInvocationConversationAgent } from './core/chat-agent.js';
import { createChatAcceptanceProbes } from './core/chat-canary.js';
import { FOUNDRY_SCOPE, FoundryClient } from './foundry/client.js';
import { createApprovalInterpreter } from './core/approval-interpreter.js';
import { chooseApprovalModel, createFoundryApprovalModel } from './core/approval-interpreter-foundry.js';
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
import { isVaultDefaultBranchPush } from './github/webhook-mapping.js';
import { createGitHubIssueClient } from './github/issues.js';
import { createProjectPolicyStore } from './database/project-policy-store.js';
import { createProjectPolicyEvaluator } from './github/project-policy.js';
import { createGitHubDeliveryHandler } from './github/delivery.js';
import { createPcBridgeModule } from './pc-bridge/bridge.js';
import { createPcBridgeStatusStore } from './database/pc-bridge-status-store.js';
import { createAlertNotifier, notifyAlert } from './alerts.js';
import type { NowFeedUpdate } from './core/now.js';
import { createAlertActivityStore } from './database/alert-store.js';
import { createMemoryStore, createVaultIndexStore } from './database/memory-store.js';
import { createFoundryMemoryEmbedder, MEMORY_EMBEDDING_DIMENSIONS } from './core/memory-embeddings.js';
import type { MemoryEmbedder } from './core/memory-embeddings.js';
import { checkAgentContract } from './core/agent-contract.js';
import { buildAgentSettingsPayload, readSettings } from './core/settings.js';
import { createGitHubVaultClient, VAULT_REPOSITORY } from './vault/github-client.js';
import { createVaultModule } from './vault/index.js';
import { createArmBudgetReader, startBudgetAlertMonitor } from './operations/budget-alert.js';
import { createGoogleApiClient } from './google/api-client.js';
import { createGoogleTokenProvider, type GoogleOAuthCredentials } from './google/oauth.js';
import { createGoogleModule } from './google/tools.js';
import { createScreenFrameUsageStore } from './database/screen-usage-store.js';
import { createBackgroundJobStore } from './database/background-job-store.js';
import { createFoundryScreenVisionModel } from './vision/foundry-model.js';
import { createScreenVisionModule, ScreenVisionService } from './vision/screen.js';
import { createVisionWatchModule, VisionWatchService } from './vision/watch.js';
import { createWebResearchModule } from './core/web-research.js';
import { createResearchSmokeProbe } from './core/research-smoke.js';
import { createHtmlResearchModule } from './core/research.js';
import { HtmlArtifactStore } from './database/html-artifact-store.js';
import { createConfirmationStore } from './database/confirmation-store.js';
import { createOwnerInteractionService } from './core/owner-interactions.js';
import { createAzureSpeechPartialRecognizerFactory } from './voice/speech-recognizer.js';
import { createAwayModeStore } from './database/away-mode-store.js';
import { createPhoneCallModule } from './phone/calls.js';
import { parsePhoneAllowlist } from './phone/caller.js';
import { createImageGenerationModule } from './core/image-generation.js';
import { WorkspaceArtifactStore } from './database/workspace-artifact-store.js';
import { attachmentRetentionDays, ConversationAttachmentStore } from './database/conversation-attachment-store.js';
import { WorkspaceHtmlArtifactStore } from './database/workspace-html-artifact-store.js';
import { createHtmlViewModule } from './core/html-view.js';
import { createWorkspacesModule } from './core/workspaces.js';
import { WorkspaceItemsStore } from './database/workspace-items-store.js';
import { createWorkspacePinsModule } from './core/workspace-pins.js';
import { WorkspacePinStore } from './database/workspace-pin-store.js';
import { createWeatherModule } from './core/weather.js';
import { assessVaultIndex, createSystemStatusReader } from './system-status.js';
import { createVaultMirrorStatusReader } from './vault-mirror-status.js';
import { createProductionModules } from './production-modules.js';
import { createBackendLogsModule } from './operations/backend-logs.js';
import { createPushStore } from './database/push-store.js';
import { createActivityRegistrationStore } from './database/activitykit-store.js';
import { createActivityPushSender, loadActivityKitConfig } from './push/activitykit.js';
import { registerPushRoutes } from './push/routes.js';
import { createSystemPushSender } from './proactive/push-delivery.js';
import { composeDaily } from './daily/composition.js';
import { createFoundryMailSemanticModel } from './daily/feeds/foundry-model.js';
import { registerProactive } from './proactive/composition.js';
import { createProactiveStore } from './database/proactive-store.js';
import { createOwnerReminderStore } from './database/owner-reminder-store.js';
import { createMemoryProactiveStore } from './proactive/store.js';
import { createProactiveToolsModule } from './proactive/tools.js';
import { createSqlHealthUpload } from './daily/health-upload/sql-composition.js';
import { SqlHealthProcessor } from './daily/health/processor.js';
import { SqlHealthCapabilities } from './daily/health-upload/sql-capabilities.js';
import { OwnerSessionService } from './auth/session/service.js';
import { createOwnerSessionStore } from './database/owner-session-store.js';
import { ownerSessionBootRevokeTimeoutMs, startOwnerSessionBootRevoke } from './auth/session/boot-revoke.js';

try {
  const config = loadConfig();
  const databaseConfig = loadDatabaseConfig();
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
  const activityKitConfig = loadActivityKitConfig();
  if (activityKitConfig && !database) throw new ConfigurationError('JARVIS_ACTIVITYKIT_ENABLED requires the existing SQL pool');
  const activityKit = activityKitConfig && database
    ? { store: createActivityRegistrationStore(database.pool), sender: await createActivityPushSender(activityKitConfig) }
    : undefined;
  if (config.healthUploadEnabled && !database) {
    throw new ConfigurationError('JARVIS_HEALTH_UPLOAD_ENABLED requires the existing SQL pool');
  }
  const healthUpload = config.healthUploadEnabled && database
    ? { ...createSqlHealthUpload(database.pool, config.auth.ownerObjectId), enabled: true }
    : undefined;
  const healthProcessor = config.healthUploadEnabled && database
    ? new SqlHealthProcessor(database.pool, config.auth.ownerObjectId)
    : undefined;
  const healthCapabilities = config.healthUploadEnabled && database
    ? new SqlHealthCapabilities(database.pool, config.auth.ownerObjectId)
    : undefined;
  if (config.ownerSessionEnabled && !database) {
    throw new ConfigurationError('JARVIS_OWNER_SESSION_ENABLED requires the existing SQL pool');
  }
  const ownerSessionBootRevokeStore = database && !config.ownerSessionEnabled
    ? createOwnerSessionStore(database.pool, { revokeAllTimeoutMs: ownerSessionBootRevokeTimeoutMs })
    : undefined;
  const ownerSessions = config.ownerSessionEnabled && database
    ? new OwnerSessionService({
      store: createOwnerSessionStore(database.pool),
      ownerObjectId: config.auth.ownerObjectId,
      tenantId: config.auth.tenantId,
    })
    : undefined;
  const conversationStore = database ? createConversationStore(database.pool) : undefined;
  const conversationSummaryStore = database ? createConversationSummaryStore(database.pool) : undefined;
  const usageStore = database ? createUsageStore(database.pool) : undefined;
  const memoryStore = database ? createMemoryStore(database.pool) : undefined;
  const settingsStore = database ? createSettingsStore(database.pool) : undefined;
  const htmlArtifactStore = database ? new HtmlArtifactStore(database.pool) : undefined;
  const workspaceHtmlArtifactStore = database ? new WorkspaceHtmlArtifactStore(database.pool) : undefined;
  const workspaceItemsStore = database ? new WorkspaceItemsStore(database.pool) : undefined;
  const workspacePinStore = database ? new WorkspacePinStore(database.pool) : undefined;
  const vaultIndexStore = database ? createVaultIndexStore(database.pool) : undefined;
  const phoneSessionStore = database
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
    ? createAwayModeStore(database.pool, (state) => nowEventHub.publish({
      type: 'mode_changed',
      mode: state.mode,
      away: state.mode !== 'present',
    }))
    : undefined;
  const alertNotifier = createAlertNotifier(telemetry);
  const credentialStatusStore = database ? createCredentialStatusStore(database.pool, {
    alertNotifier,
    onAlert: () => nowEventHub.publish({ type: 'refresh' }),
  }) : undefined;
  const credential = archiveStorageAccount || config.keyVaultUri || config.voiceLiveEndpoint || config.foundryProjectEndpoint ||
    config.foundryEndpoints || config.foundryAccountResourceId || config.githubAppId || config.googleTimeZone ||
    config.phone || sleepResourceId || config.backendLogs || config.backendLogProbe
    ? new DefaultAzureCredential(managedIdentityClientId
      ? { managedIdentityClientId }
      : {})
    : undefined;
  const vaultMirrorStatusReader = createVaultMirrorStatusReader(
    archiveStorageAccount && credential
      ? new BlobServiceClient(`https://${archiveStorageAccount}.blob.core.windows.net`, credential, {
        retryOptions: { maxTries: 1, tryTimeoutInMs: 5_000 },
      }).getContainerClient('vault-mirror-status').getBlobClient('status.json')
      : undefined,
  );
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
  const googleApiClient = config.googleTimeZone && googleSecretClient
    ? createGoogleApiClient({
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
    })
    : undefined;
  const googleModule = googleApiClient
    ? createGoogleModule(googleApiClient, { timeZone: config.googleTimeZone! })
    : undefined;
  const getGitHubAppPrivateKey = async () => {
    if (!githubAppKeyVault) throw new Error('GitHub App private key is unavailable');
    const secret = await githubAppKeyVault.getSecret('github-app-private-key');
    if (!secret.value) throw new Error('GitHub App private key is unavailable');
    return secret.value;
  };
  const onTokenMint = async (status: 'ok' | 'failed', checkedAt: string, scopeKey: string) => {
    try { await credentialStatusStore?.updateGitHubAppStatus(status, checkedAt, scopeKey); }
    catch { logger.warn('credentials.github_app_status_failed'); }
  };
  const githubAppTokenIssuer = config.githubAppId && githubAppKeyVault
    ? createGitHubAppTokenIssuer({
      appId: config.githubAppId,
      getPrivateKey: getGitHubAppPrivateKey,
      onTokenMint,
    })
    : undefined;
  const githubIssueClient = githubAppTokenIssuer
    ? createGitHubIssueClient(githubAppTokenIssuer)
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
  const decisionHosts = [config.foundryEndpoints?.admin, config.foundryEndpoints?.runtime, config.foundryProjectEndpoint]
    .flatMap((value) => {
      try { return value ? [new URL(value).origin] : []; } catch { return []; }
    })
    .filter((origin, index, all) => all.indexOf(origin) === index);
  let decisionUnavailableLoggedAt = 0;
  const decisions = createDecisionResolver({
    getProvider: createCachedDecisionProviderReader(async () =>
      settingsStore ? (await readSettings(settingsStore)).decisions.provider : undefined),
    getJevApiKey,
    ...(credential && decisionHosts.length > 0 ? {
      microsoft: {
        hosts: decisionHosts,
        deployment: microsoftDecisionDeployment,
        getToken: async (signal?: AbortSignal) => {
          const token = await credential.getToken(microsoftDecisionScope, signal ? { abortSignal: signal } : {});
          if (!token) throw new Error('Foundry decision identity unavailable');
          return token.token;
        },
      },
    } : {}),
    onUnavailable: (provider) => {
      const now = Date.now();
      if (now - decisionUnavailableLoggedAt < 60_000) return;
      decisionUnavailableLoggedAt = now;
      logger.warn({ provider }, 'decision.provider_unavailable');
    },
  });
  const reflexClassifier = createJevReflexClassifier(decisions.resolve, decisions.fetch);
  const decisionsAvailable = Boolean(jevSecretClient || (credential && decisionHosts.length > 0));
  const pcActPlanner = decisionsAvailable ? createJevPcActPlanner(decisions.resolve, decisions.fetch) : undefined;
  const recipeStore = database ? createRecipeStore(database.pool) : undefined;
  const recipes = recipeStore && decisionsAvailable
    ? { store: recipeStore, planner: createJevRecipePlanner(decisions.resolve, decisions.fetch) }
    : undefined;
  const browserAgent = decisionsAvailable && config.foundryProjectEndpoint && credential
    ? createBrowserAgent(
      createJevBrowserPlanner(decisions.resolve, decisions.fetch),
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
  const modelCatalogue = config.foundryAccountResourceId && credential
    ? createArmModelCatalogueReader({
      resourceId: config.foundryAccountResourceId,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry catalogue identity unavailable');
        return token.token;
      },
    })
    : { read: async () => fallbackModelCatalogue() };
  const dailyMailSemantic = config.dailyFeedsEnabled && config.foundryProjectEndpoint && credential && settingsStore && usageStore
    ? createFoundryMailSemanticModel(config.foundryProjectEndpoint, async (scope, signal) => {
      const token = await credential.getToken(scope, { abortSignal: signal });
      if (!token) throw new Error('Daily mail semantic identity unavailable');
      return token.token;
    }, settingsStore, modelCatalogue, usageStore)
    : undefined;
  const embeddingModel = async () => settingsStore
    ? (await readSettings(settingsStore, await modelCatalogue.read())).roles.embedding.model
    : config.foundryMemoryEmbeddingDeploymentName ?? 'text-embedding-3-small';
  const embeddingClients = new Map<string, MemoryEmbedder>();
  const getMemoryEmbedder = async (): Promise<MemoryEmbedder | undefined> => {
    if (!config.foundryProjectEndpoint || !credential) return undefined;
    const model = await embeddingModel();
    let embedder = embeddingClients.get(model);
    if (!embedder) {
      embedder = createFoundryMemoryEmbedder({
        projectEndpoint: config.foundryProjectEndpoint,
        deploymentName: model,
        getToken: async (scope, signal) => {
          const token = await credential.getToken(scope, { abortSignal: signal });
          if (!token) throw new Error('Foundry memory embedding identity unavailable');
          return token.token;
        },
      });
      embeddingClients.set(model, embedder);
    }
    return embedder;
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
  const readManagedTarget = config.foundryCopilot && config.foundryProjectEndpoint && credential && settingsStore
    ? createManagedTargetReader({
      projectEndpoint: config.foundryProjectEndpoint,
      ...config.foundryCopilot,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Managed target identity unavailable');
        return token.token;
      },
      readSelectedSettings: async () => {
        const selected = (await readSettings(settingsStore, await modelCatalogue.read())).roles.chat;
        return { model: selected.model, effort: selected.reasoningEffort };
      },
    }) : undefined;
  const managedRuntime = readManagedTarget && database
    ? { sessions: createRuntimeSessionStore(database.pool), readTargetMetadata: readManagedTarget,
      readVerifiedTarget: async () => (await readManagedTarget())?.target ?? null }
    : undefined;
  const vaultClient = githubAppTokenIssuer
    ? createGitHubVaultClient({ tokenIssuer: githubAppTokenIssuer })
    : undefined;
  const vaultModule = memoryStore && vaultIndexStore && vaultClient
    ? createVaultModule({
      client: vaultClient,
      indexStore: vaultIndexStore,
      memoryStore,
      apiMemoryStore: memoryStore,
      ...(workspaceItemsStore ? { recordWorkspaceGraph: (query: string, highlight: readonly string[], createdAt: string) => {
        const id = randomUUID();
        return workspaceItemsStore.record(config.auth.ownerObjectId, {
          id: `knowledge_graph:${id}`,
          kind: 'knowledge_graph',
          sourceId: id,
          title: 'Knowledge graph',
          promptSummary: query,
          createdAt,
          payload: { query, highlight },
        }, AbortSignal.timeout(10_000));
      } } : {}),
      ...(settingsStore ? { settingsStore } : {}),
      getEmbedder: getMemoryEmbedder,
      getEmbeddingModel: embeddingModel,
      ...(usageStore ? { usageStore } : {}),
      onUsageRecordFailure: () => logger.warn('usage.embedding_tokens_unavailable'),
      log: (event, fields) => logger.info({ msg: event, ...fields }, event),
      logEmbedding: (fields) => logger.info({ msg: 'memory.embedding', ...fields }, 'memory.embedding'),
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
  const conversationAttachments = database && archiveStorageAccount &&
    workspaceArtifactServiceClient && workspaceArtifacts
    ? new ConversationAttachmentStore({
      pool: database.pool,
      container: workspaceArtifactServiceClient.getContainerClient('artifacts'),
      storageAccount: archiveStorageAccount,
      artifacts: workspaceArtifacts,
      retentionDays: attachmentRetentionDays(),
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
  const htmlResearchModule = htmlArtifactStore && credential && config.foundryEndpoints && config.foundryRunnerAgentName
    ? createHtmlResearchModule(
      () => clientFor(config.foundryRunnerAgentName!),
      config.codexToolModel,
      htmlArtifactStore,
      {},
      workspaceItemsStore,
    )
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
  const ownerInteractions = database && nowFeedStore
    ? createOwnerInteractionService({
      ownerObjectId: config.auth.ownerObjectId,
      store: createConfirmationStore(database.pool),
      ...(conversationStore ? { conversationStore } : {}),
      onWebNotification: async (kind, text) => {
        if (!nowFeedStore.recordNotification) throw new Error('Now feed notifications are unavailable');
        await nowFeedStore.recordNotification(kind, text);
      },
      onConfirmationsChanged: () => nowEventHub.publish({ type: 'refresh' }),
      onConfirmationPending: (confirmation, foodEstimate) => nowEventHub.publish(foodEstimate
        ? { type: 'food_estimate_pending', ...foodEstimate, confirmation }
        : { type: 'status', kind: 'approval_pending' }),
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
      onError: (error) => logger.warn(safeErrorFields(error), 'project_policy.recheck_failed'),
    })
    : undefined;
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
              (failure) => logger.warn(failure, 'github.delivery_policy_evaluation_failed'),
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
  const attachmentVision = database && settingsStore && screenVisionModel && usageStore?.recordFoundryUsage
    ? async (image: Buffer, contentType: string, signal: AbortSignal) => {
      const settings = await readSettings(settingsStore, await modelCatalogue.read());
      const role = settings.roles.vision;
      const result = await screenVisionModel.describe({
        image,
        contentType: contentType as 'image/jpeg' | 'image/png' | 'image/webp',
        model: role.model,
        reasoningEffort: role.reasoningEffort,
        signal,
      });
      const description = result.description.trim().slice(0, 5_000);
      if (!description) throw new Error('Vision returned an empty description');
      await usageStore.recordFoundryUsage!({
        role: 'vision',
        model: role.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        eventId: randomUUID(),
      });
      return description;
    }
    : undefined;
  // Decides what Dan's verified reply means for a staged change (never whether he may approve). Without a configured
  // chat model, or on any failure, only plain one-word replies approve and everything else gets one natural question.
  const approvalEndpoint = (() => {
    if (!config.foundryProjectEndpoint) return undefined;
    try {
      const url = new URL('/models/chat/completions', new URL(normalizeFoundryProjectEndpoint(config.foundryProjectEndpoint)).origin);
      url.searchParams.set('api-version', '2024-05-01-preview');
      return url;
    } catch {
      return undefined;
    }
  })();
  const approvalInterpreter = approvalEndpoint && credential && settingsStore && usageStore?.recordFoundryUsage
    ? createApprovalInterpreter({
      model: createFoundryApprovalModel({
        endpoint: approvalEndpoint,
        scope: FOUNDRY_SCOPE,
        getToken: async (scope, signal) => {
          const token = await credential.getToken(scope, { abortSignal: signal });
          if (!token) throw new Error('Foundry approval identity unavailable');
          return token.token;
        },
        selectModel: async () => {
          const catalogue = await modelCatalogue.read();
          return chooseApprovalModel(catalogue, (await readSettings(settingsStore, catalogue)).roles.chat.model);
        },
        recordUsage: (usage) => usageStore.recordFoundryUsage!(usage),
      }),
    })
    : undefined;
  const pcBridgeModule = createPcBridgeModule({
    ...(screenVisionModel ? { pcActVisionModel: screenVisionModel } : {}),
    ...(pcActPlanner ? {
      pcActPlanner,
      ...(recipes ? { recipes } : {}),
      onPcActStep: (activity) => logger.info(activity, 'pc_act.step'),
    } : {}),
    ...(pcBridgeStatusStore ? {
      onStatusChange: (online, controlPaused) => pcBridgeStatusStore.setStatus(online, controlPaused),
    } : {}),
    ...(ownerInteractions ? {
      runConfirmed: (summary, action, signal) =>
        ownerInteractions.runConfirmed('computer_use', summary, action, signal),
    } : {}),
    onStatusError: (error) => logger.warn(safeErrorFields(error), 'pc_bridge.status_update_failed'),
  });
  const frameStore = new FrameStore();
  let vaultPushReminderHandler = () => {
    logger.info({ runId: null, durationMs: 0, reason: 'vault_push_planner_unconfigured' },
      'proactive.reminder_plan');
  };
  const githubWebhookModule = createGithubWebhookModule({
    deliveryStore: webhookDeliveryStore,
    getSecret: getWebhookSecret,
    ...(githubAppTokenIssuer ? {
      readWorkflowRun: createGitHubActionsLogClient(githubAppTokenIssuer).readWorkflowRun,
    } : {}),
    isTrackedRepository: (repository) => repository.toLowerCase() === VAULT_REPOSITORY.toLowerCase() ||
      trackedRepositories.has(repository.toLowerCase()),
    onMapping: async (mapping, deliveryId) => {
      if (mapping.kind === 'issue_labeled' && githubIssueClient && projectStore && taskStore) {
        const result = await handleIssueLabel({
          alerts: alertActivityStore ?? null,
          projects: projectStore,
          tasks: taskStore,
          github: githubIssueClient,
          repository: mapping.repository,
          issue: mapping.number,
          ...(deliveryId ? { deliveryId } : {}),
        });
        if (!['created', 'existing', 'project-not-found', 'issue-not-found', 'issue-closed',
          'not-an-issue', 'prompt-too-large'].includes(result.kind)) {
          throw new Error('Issue task start failed');
        }
      }
      if (isVaultDefaultBranchPush(mapping)) {
        if (vaultModule) {
          void vaultModule.synchronize(AbortSignal.timeout(10 * 60_000)).catch(() => {
            logger.warn({
              msg: 'vault.index', outcome: 'error', added: 0, changed: 0, removed: 0,
            }, 'vault.index');
          });
        }
        try {
          vaultPushReminderHandler();
        } catch {
          logger.warn({ runId: null, reason: 'vault_push_trigger_failed' }, 'proactive.reminder_plan');
        }
      }
      await checksLoop?.handleMapping(mapping);
      await projectPolicyEvaluator?.handle(mapping);
    },
  });
  const phoneCallModule = config.phone && phoneSessionStore && phoneSecretClient && credential &&
    config.foundryProjectEndpoint
    ? createPhoneCallModule({
      client: new CallAutomationClient(config.phone.acsEndpoint, credential),
      store: phoneSessionStore,
      ownerObjectId: config.auth.ownerObjectId,
      teamsResourceAccountObjectId: config.phone.teamsResourceAccountObjectId,
      publicOrigin: config.phone.publicOrigin,
      getAllowlist: getPhoneAllowlist,
      getToken: async (scope, signal) => {
        const token = await credential.getToken(scope, { abortSignal: signal });
        if (!token) throw new Error('Foundry voice identity unavailable');
        return token.token;
      },
      connect: createDanishVoiceConnector(config.foundryProjectEndpoint),
    })
    : undefined;
  const phoneStatusModule = createPhoneStatusModule({
    configured: phoneCallModule !== undefined,
    store: phoneSessionStore ?? null,
  });
  const browserAgentModule = browserAgent ? createBrowserAgentModule(browserAgent) : undefined;
  const imageGenerationModule = workspaceArtifacts && config.foundryEndpoints && config.foundryRunnerAgentName
    ? createImageGenerationModule({
      runner: clientFor(config.foundryRunnerAgentName),
      artifacts: workspaceArtifacts,
      model: config.codexImageModel,
      ...(workspaceItemsStore ? { workspaceItems: workspaceItemsStore } : {}),
    })
    : undefined;
  const htmlViewModule = database && workspaceHtmlArtifactStore
    ? createHtmlViewModule(workspaceHtmlArtifactStore, workspaceItemsStore)
    : undefined;
  const weatherModule = database && workspaceHtmlArtifactStore
    ? createWeatherModule(workspaceHtmlArtifactStore, undefined, workspaceItemsStore)
    : undefined;
  const workspacesModule = database && workspaceItemsStore && workspaceHtmlArtifactStore
    ? createWorkspacesModule(workspaceItemsStore, workspaceHtmlArtifactStore, workspaceArtifacts)
    : undefined;
  const workspacePinsModule = workspacePinStore ? createWorkspacePinsModule(workspacePinStore) : undefined;
  let visionWatch: VisionWatchService | undefined;
  let screenVision: ScreenVisionService | undefined;
  let screenVisionModule: BackendModule | undefined;
  let visionWatchModule: BackendModule | undefined;
  if (database && settingsStore && screenVisionModel) {
    const visionUsage = createScreenFrameUsageStore(database.pool);
    screenVision = new ScreenVisionService(screenVisionModel, visionUsage, Date.now, visionUsage);
    screenVisionModule = createScreenVisionModule(screenVision, frameStore);
    visionWatch = new VisionWatchService(screenVisionModel, visionUsage, createConversationStore(database.pool));
    visionWatchModule = createVisionWatchModule(visionWatch);
  }
  const voiceRelayModule = (config.voiceLiveEndpoint || config.foundryProjectEndpoint) && credential
    ? createVoiceRelayModule({
      frameStore,
      ...(screenVision && settingsStore ? {
        reserveImageBudget: async (input) => {
          if (input.signal.aborted) throw new Error('Image budget admission was cancelled');
          const settings = await readSettings(settingsStore, await modelCatalogue.read());
          return await screenVision!.reserveImage({ ...input, limitUsd: settings.global.visionDailyBudgetUsd });
        },
        recordImageUsage: (input) => screenVision!.recordImageUsage(input),
        captionFrame: async (input) => {
          if (input.signal.aborted) throw new Error('Camera caption was cancelled');
          const settings = await readSettings(settingsStore, await modelCatalogue.read());
          return screenVision!.caption({
            ...input,
            model: settings.roles.vision.model,
            reasoningEffort: settings.roles.vision.reasoningEffort,
            limitUsd: settings.global.visionDailyBudgetUsd,
          });
        },
      } : {}),
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
    })
    : undefined;
  const proactiveStore = config.proactiveEnabled
    ? database
      ? createProactiveStore(database.pool, config.auth.ownerObjectId)
      : createMemoryProactiveStore(config.auth.ownerObjectId)
    : undefined;
  let scheduleOwnerReminderWake: (fireAt: Date) => void = () => {};
  const ownerReminderStore = config.proactiveEnabled && config.pushEnabled && config.staticWebAppOrigin &&
      database && vaultClient
    ? createOwnerReminderStore(database.pool, config.auth.ownerObjectId)
    : undefined;
  const proactiveToolsModule = createProactiveToolsModule({
    enabled: config.proactiveEnabled,
    ownerObjectId: config.auth.ownerObjectId,
    ...(proactiveStore ? { store: proactiveStore } : {}),
    ...(ownerReminderStore && vaultClient ? {
      ownerReminders: ownerReminderStore,
      vault: vaultClient,
      now: () => new Date(),
      onReminderScheduled: (fireAt: Date) => scheduleOwnerReminderWake(fireAt),
    } : {}),
  });
  const modules: BackendModule[] = createProductionModules({
    core: coreModule,
    backendLogs: createBackendLogsModule({
      config: config.backendLogs,
      getToken: credential ? async (signal) => {
        const token = await credential.getToken('https://api.loganalytics.io/.default', { abortSignal: signal });
        if (!token) throw new Error('Backend log identity unavailable');
        return token.token;
      } : undefined,
    }),
    conversation: createConversationModule(frameStore),
    factory: factoryModule,
    sleep: createSleepModule(containerAppScaler),
    recipes: createRecipeModule(recipeStore),
    vault: vaultModule,
    webResearch: webResearchModule,
    htmlResearch: htmlResearchModule,
    google: googleModule,
    githubWebhook: githubWebhookModule,
    pcBridge: pcBridgeModule,
    phoneCall: phoneCallModule,
    phoneStatus: phoneStatusModule,
    browserAgent: browserAgentModule,
    imageGeneration: imageGenerationModule,
    htmlView: htmlViewModule,
    weather: weatherModule,
    workspaces: workspacesModule,
    workspacePins: workspacePinsModule,
    screenVision: screenVisionModule,
    visionWatch: visionWatchModule,
    voiceRelay: voiceRelayModule,
    daily: composeDaily({
      enabled: config.dailyEnabled === true,
      pool: database?.pool,
      ownerObjectId: config.auth.ownerObjectId,
      feedsEnabled: config.dailyFeedsEnabled === true,
      ...(config.dailyFeedsEnabled ? { feeds: {
        ...(googleApiClient ? { google: googleApiClient } : {}),
        ...(dailyMailSemantic ? { semantic: dailyMailSemantic } : {}),
      } } : {}),
    }),
    proactive: proactiveToolsModule,
  });
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
  const modelDeploymentWorkflow = config.foundryAccountResourceId && credential && settingsStore && ownerInteractions
    ? createModelDeploymentWorkflow({
      catalogue: modelCatalogue,
      settings: settingsStore,
      client: createArmModelDeploymentClient({
        resourceId: config.foundryAccountResourceId,
        getToken: async (scope, signal) => {
          const token = await credential.getToken(scope, { abortSignal: signal });
          if (!token) throw new Error('Foundry deployment identity unavailable');
          return token.token;
        },
      }),
      confirm: (actionKind, summary, action, signal) =>
        ownerInteractions.runConfirmed(actionKind, summary, action, signal),
      onChanged: () => nowEventHub.publish({ type: 'refresh' }),
    })
    : undefined;
  let activeEmbeddingReindex: { readonly controller: AbortController; readonly pending: Promise<void> } | undefined;
  const foundryCapabilityStatus = async (
    configured: boolean,
    capability: 'chat' | 'realtime' | 'embeddings',
  ) => {
    if (!configured) return { status: 'down' as const, details: { configured: false } };
    try {
      const catalogue = await modelCatalogue.read();
      const deploymentAvailable = catalogue.deployments.some(({ capabilities }) => capabilities.includes(capability));
      if (catalogue.source !== 'arm') {
        return { status: 'degraded' as const, details: { configured: true, deploymentAvailable, catalogue: 'fallback' } };
      }
      return {
        status: deploymentAvailable ? 'unknown' as const : 'degraded' as const,
        details: { configured: true, deploymentAvailable, catalogue: 'live' },
      };
    } catch {
      return { status: 'degraded' as const, details: { configured: true, deploymentAvailable: false } };
    }
  };
  const runtime = { app: undefined as ReturnType<typeof buildApp> | undefined };
  const systemSmokeProbes = {
    vault: async () => {
      if (!vaultClient) return { status: 'down' as const, details: { configured: false } };
      await vaultClient.tree(AbortSignal.timeout(10_000));
      return { status: 'ok' as const, details: { configured: true } };
    },
    'foundry.embeddings': async () => {
      const embedder = await getMemoryEmbedder();
      if (!embedder) return { status: 'down' as const, details: { configured: false } };
      const vector = await embedder.embed('Jarvis post-deploy smoke check', AbortSignal.timeout(12_000));
      return {
        status: vector.length === MEMORY_EMBEDDING_DIMENSIONS ? 'ok' as const : 'down' as const,
        details: { configured: true },
      };
    },
    research: createResearchSmokeProbe({
      configured: Boolean(webResearchModule && config.foundryRunnerAgentName),
      clientFor: () => clientFor(config.foundryRunnerAgentName!),
      selectModel: async () => {
        const selected = settingsStore
          ? (await readSettings(settingsStore, await modelCatalogue.read())).roles.research
          : undefined;
        return selected ?? { model: config.codexToolModel, reasoningEffort: 'none' };
      },
    }),
    agent_contract: async () => {
      const app = runtime.app;
      if (!app) return { status: 'down' as const, reason: 'Agent contract could not be checked.' };
      return checkAgentContract(app.jarvisTools.list(), () => buildAgentSettingsPayload(app));
    },
    ...createChatAcceptanceProbes(conversationAgent),
  };
  const deployedCommit = process.env.JARVIS_DEPLOYED_COMMIT;
  const systemStatusReader = createSystemStatusReader({
    database: async () => {
      if (!database) return { status: 'down', details: { configured: false } };
      if (!database.pool.connected) return { status: 'down', details: { configured: true } };
      const request = database.pool.request();
      const timer = setTimeout(() => request.cancel(), 2_000);
      timer.unref();
      try {
        await request.query('SELECT 1 AS ready;');
        return { status: 'ok', details: { configured: true } };
      } finally {
        clearTimeout(timer);
      }
    },
    'foundry.chat': () => foundryCapabilityStatus(Boolean(conversationAgent), 'chat'),
    'foundry.voice': () => foundryCapabilityStatus(
      Boolean(credential && (config.voiceLiveEndpoint || config.foundryProjectEndpoint)),
      'realtime',
    ),
    'foundry.embeddings': () => foundryCapabilityStatus(
      Boolean(config.foundryProjectEndpoint && credential),
      'embeddings',
    ),
    vault_index: async () => {
      if (!vaultIndexStore || !config.foundryProjectEndpoint || !credential) {
        return { status: 'down', details: { configured: false } };
      }
      const model = await embeddingModel();
      const summary = await vaultIndexStore.summary(model, AbortSignal.timeout(2_000));
      return assessVaultIndex(summary, vaultModule?.syncStatus() ?? {
        outcome: 'pending', latestAttemptAt: null, lastSuccessfulAt: null,
      });
    },
    github_app: async () => {
      if (!githubAppTokenIssuer) return { status: 'down', details: { configured: false } };
      if (!githubAppTokenIssuer.readInstallationPermissions) {
        return { status: 'unknown', details: { configured: true, permissions: 'unavailable' } };
      }
      const permissions = await githubAppTokenIssuer.readInstallationPermissions('DanAakesen/jarvis');
      return {
        status: 'ok',
        details: {
          configured: true,
          permissions: Object.entries(permissions).sort(([left], [right]) => left.localeCompare(right))
            .map(([permission, access]) => `${permission}:${access}`).join(','),
        },
      };
    },
    google: async () => {
      if (!googleApiClient) return { status: 'down', details: { configured: false } };
      // Jarvis holds calendar.events only; calendarList needs a broader scope and always 403s (L125).
      await googleApiClient.request('calendar', '/calendars/primary/events?maxResults=1&singleEvents=true', {
        signal: AbortSignal.timeout(5_000),
      });
      return { status: 'ok', details: { configured: true, check: 'calendar_read' } };
    },
    pc_bridge: async () => {
      const bridge = pcBridgeModule.connection.readStatus();
      return {
        status: bridge.connected ? 'ok' : 'down',
        details: {
          connected: bridge.connected,
          controlPaused: bridge.controlPaused,
          bridgeVersion: bridge.bridgeVersion,
          chromeExtensionVersion: bridge.chromeExtensionVersion,
          wakeWordEnabled: bridge.wakeWordEnabled,
        },
      };
    },
    runner: async () => {
      const configured = Boolean(database && config.foundryEndpoints && config.foundryRunnerAgentName);
      return {
        status: configured ? 'unknown' : 'down',
        details: {
          configured,
          activeSessions: sandboxHeartbeat?.trackedSessionCount() ?? 0,
          healthProbe: 'not_run',
        },
      };
    },
  }, deployedCommit && /^[\da-f]{7,64}$/iu.test(deployedCommit) ? deployedCommit.toLowerCase() : undefined);
  const app = buildApp(config, logger, {
    ...(managedRuntime && readManagedTarget ? {
      managedRuntime,
      conversationRuntimeTests: async () => ({
        current: { available: Boolean(conversationAgent) },
        copilot: { available: Boolean(await readManagedTarget()) },
      }),
    } : {}),
    ...(healthUpload && healthProcessor && healthCapabilities ? { healthUpload, healthProcessor, healthCapabilities } : {}),
    ...(ownerSessions ? { ownerSessions } : {}),
    ...(workspaceHtmlArtifactStore ? { workspaceHtmlArtifacts: workspaceHtmlArtifactStore } : {}),
    ...(conversationAttachments ? { conversationAttachments } : {}),
    ...(attachmentVision ? { attachmentVision } : {}),
    modules,
    ...(projectPolicyEvaluator ? {
      projectPolicyChanged: (projectId: string) => projectPolicyEvaluator.recheckProject(projectId),
    } : {}),
    systemStatusReader,
    vaultMirrorStatusReader,
    systemSmokeProbes,
    ...(config.backendLogProbe && credential ? { backendLogAuthorizationProbe: createBackendLogAuthorizationProbe({
      config: config.backendLogProbe,
      ...(config.foundryAccountResourceId ? { foundryResourceId: config.foundryAccountResourceId } : {}),
      getToken: async (signal) => {
        const token = await credential.getToken('https://api.loganalytics.io/.default', { abortSignal: signal });
        if (!token) throw new Error('Backend log probe identity unavailable');
        return token.token;
      },
    }) } : {}),
    modelCatalogue,
    ...(modelDeploymentWorkflow ? { modelDeploymentWorkflow } : {}),
    ...(approvalInterpreter ? { approvalInterpreter } : {}),
    ...(decisionsAvailable ? { reflexClassifier } : {}),
    ...(browserAgent ? { browserAgent } : {}),
    ...(database ? { databaseStatus: () => database.isWaking() } : {}),
    ...(releaseViewStore ? { releaseViewStore } : {}),
    ...(releaseGraphReader ? { releaseGraphReader } : {}),
    ...(database && taskStore && settingsStore && nowFeedStore ? {
      ...(projectStore ? { projectStore } : {}),
      ...(projectRepositoryCreator ? { projectRepositoryCreator } : {}),
      toolCallStore: createToolCallStore(database.pool),
      settingsStore: settingsStore,
      ...(conversationStore ? { conversationStore } : {}),
      ...(conversationSummaryStore ? { conversationSummaryStore } : {}),
      ...(taskStatusNotificationStore ? { taskStatusNotificationStore } : {}),
      onConversationSessionEnded: (sessionId: string) => {
        visionWatch?.forgetSession(sessionId);
        frameStore.forgetSession(sessionId);
      },
      taskStore,
      ...(githubAppTokenIssuer ? { githubAppTokenIssuer } : {}),
      ...(githubIssueClient ? { githubIssueClient, issueProgressBoardUrl: config.staticWebAppOrigin } : {}),
      ...(githubRepositoryCatalog ? { githubRepositoryCatalog } : {}),
      ...(dispatcher ? { taskController: dispatcher } : {}),
      nowFeedStore,
      ...(usageStore ? { usageStore } : {}),
    } : {}),
    ...(database ? { backgroundJobStore: createBackgroundJobStore(database.pool) } : {}),
    ...(activityKit ? { activityKit } : {}),
    ...(vaultModule && config.foundryProjectEndpoint && credential ? {
      onEmbeddingModelChanged: async (jobs) => {
        if (activeEmbeddingReindex) {
          activeEmbeddingReindex.controller.abort();
          await activeEmbeddingReindex.pending;
        }
        const controller = new AbortController();
        const job = await jobs.start(
          'embedding', 'Re-embed memory and vault', 2, () => controller.abort(), 'Re-embedding saved memories',
        );
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60 * 60_000)]);
        const pending = vaultModule.reembed(signal, (step, detail) => job.progress(step, detail))
          .then(async ({ memoryPending, vaultPending }) => {
            const pending = memoryPending || vaultPending > 0;
            await job.done('embedding-backfill', pending
              ? 'Batch complete; remaining vectors await the next paced sync'
              : 'Memory and vault embeddings are current');
          })
          .catch(async (error: unknown) => {
            await job.fail('Re-embedding failed').catch(() => undefined);
            logger.warn(safeErrorFields(error), 'memory.embedding_backfill_failed');
          });
        activeEmbeddingReindex = { controller, pending };
        const clearActive = () => {
          if (activeEmbeddingReindex?.controller === controller) activeEmbeddingReindex = undefined;
        };
        void pending.then(clearActive, clearActive);
      },
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
    ...(ownerInteractions ? { ownerInteractions } : {}),
    ...(phoneSessionStore ? { phoneSessionStore } : {}),
  });
  registerPushRoutes(app, config.pushEnabled, () => ({
    store: createPushStore(database!.pool),
    ...(proactiveStore ? {
      proactiveItems: { ownerObjectId: config.auth.ownerObjectId, store: proactiveStore.items },
    } : {}),
    publicOrigin: config.staticWebAppOrigin!,
  }));
  const alertPushStore = config.proactiveEnabled && config.pushEnabled &&
      database && config.staticWebAppOrigin
    ? createPushStore(database.pool)
    : undefined;
  const alertPushSender = alertPushStore && config.staticWebAppOrigin
    ? createSystemPushSender({
      store: alertPushStore,
      ownerObjectId: config.auth.ownerObjectId,
      publicOrigin: config.staticWebAppOrigin,
      now: () => new Date(),
      logger,
    })
    : undefined;
  if (config.proactiveEnabled) registerProactive(app, {
    vaultMirrorStatusReader,
    enabled: config.proactiveEnabled,
    ownerObjectId: config.auth.ownerObjectId,
    ...(proactiveStore ? { store: proactiveStore } : {}),
    ...(database ? { pool: database.pool } : {}),
    ...(googleApiClient ? { googleApiClient } : {}),
    ...(vaultClient ? { vaultClient } : {}),
    ...(settingsStore ? { settingsStore } : {}),
    modelCatalogue,
    ...(credential ? {
      getCredentialToken: async (scope: string, signal?: AbortSignal) => {
        const token = await credential.getToken(scope, signal ? { abortSignal: signal } : {});
        return token?.token;
      },
    } : {}),
    ...(config.foundryProjectEndpoint ? { foundryProjectEndpoint: config.foundryProjectEndpoint } : {}),
    ...(usageStore ? { usageStore } : {}),
    ...(taskStore ? { taskStore } : {}),
    backgroundJobs: app.backgroundJobs,
    ...(conversationStore ? { conversationStore } : {}),
    registerVaultPushHandler: (handler: () => void) => { vaultPushReminderHandler = handler; },
    ...(alertPushStore ? { pushStore: alertPushStore } : {}),
    ...(ownerReminderStore ? { ownerReminderStore } : {}),
    ...(alertPushSender ? { systemPushSender: alertPushSender } : {}),
    registerReminderWakeHandler: (handler: (fireAt: Date) => void) => { scheduleOwnerReminderWake = handler; },
    pushEnabled: config.pushEnabled,
    todoWritesEnabled: config.proactiveTodoWritesEnabled,
    alertsEnabled: config.proactiveAlertsEnabled,
    now: () => new Date(),
    logger,
  });
  runtime.app = app;
  if (checksLoop || projectPolicyEvaluator) {
    app.addHook('onClose', async () => {
      await checksLoop?.stop();
      await projectPolicyEvaluator?.stop();
    });
  }
  if (projectPolicyEvaluator) {
    app.addHook('onReady', async () => { projectPolicyEvaluator.start(); });
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
  app.addHook('preClose', async () => {
    try { await taskEventArchiveJob?.stop(); }
    catch (error) { app.shutdownErrors.push(error); }
  });
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await shutdown(app, telemetry);
    }
    catch { process.exitCode = 1; }
    // Enforce the shutdown deadline even if an SDK/network handle remains open.
    process.exit(process.exitCode ?? 0);
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  try {
    if (database) {
      await database.initialize();
      if (!config.ownerSessionEnabled) {
        startOwnerSessionBootRevoke({
          enabled: config.ownerSessionEnabled,
          ...(ownerSessionBootRevokeStore ? { store: ownerSessionBootRevokeStore } : {}),
          ownerObjectId: config.auth.ownerObjectId,
          log: (fields) => {
            if (fields.outcome === 'failed' || fields.outcome === 'table_missing') {
              logger.warn(fields, 'owner_session.boot_revoke');
            } else {
              logger.info(fields, 'owner_session.boot_revoke');
            }
          },
        });
      }
      await memoryStore?.initialize();
      await conversationStore?.initialize?.();
      await vaultIndexStore?.initialize();
      for (const project of await projectStore?.list() ?? []) {
        trackedRepositories.add(project.repo.toLowerCase());
      }
      logger.info('database.ready');
    }
    await ownerInteractions?.expirePendingConfirmations();
    if (!stopping) {
      await sandboxHeartbeat?.start();
      dispatcher?.start();
      await app.listen({ port: config.port, host: '0.0.0.0' });
      if (vaultModule) {
        const signal = AbortSignal.timeout(10 * 60_000);
        const model = await embeddingModel();
        const memoryNeedsBackfill = memoryStore
          ? (await memoryStore.embeddingsToBackfill(model, '0', 1, signal)).length > 0
          : false;
        const vaultNeedsBackfill = vaultIndexStore
          ? (await vaultIndexStore.files(model, signal)).some(({ embeddingMissing }) => embeddingMissing)
          : false;
        if ((memoryNeedsBackfill || vaultNeedsBackfill) && app.onEmbeddingModelChanged) {
          await app.onEmbeddingModelChanged(app.backgroundJobs);
        } else {
          void vaultModule.synchronize(signal).catch(() => {
            logger.warn({
              msg: 'vault.index', outcome: 'error', added: 0, changed: 0, removed: 0,
            }, 'vault.index');
          });
        }
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

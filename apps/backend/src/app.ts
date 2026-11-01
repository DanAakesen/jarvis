import type { BackendLogAuthorizationProbe } from './operations/backend-log-authorization.js';
import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import type { Logger } from 'pino';
import type { SystemSmokeCheckId } from '@jarvis/contracts';
import type { BackgroundJobEvent, JarvisActivityEvent, JarvisVoiceWakeEvent } from '@jarvis/contracts';
import { ConfigurationError, localWebOrigin, type BackendConfig } from './config.js';
import { createLogger, safeErrorFields } from './logging.js';
import { installAuthentication } from './auth/hook.js';
import { registerOwnerSessionRoutes } from './auth/session/routes.js';
import type { OwnerSessionService } from './auth/session/service.js';
import { OwnerSessionConnectionRegistry } from './auth/session/connections.js';
import type { TokenVerifier } from './auth/verify.js';
import { coreModule } from './core/index.js';
import { createEventHub } from './core/event-hub.js';
import type { JarvisActivityHub } from './core/activity.js';
import { BackgroundJobRegistry } from './core/jobs.js';
import type { ToolCallStore } from './core/tool-calls.js';
import { conversationModule } from './core/conversation.js';
import type { ConversationStore } from './core/conversation-store.js';
import type { ConversationAgent } from './core/chat-agent.js';
import type { ReflexClassifier } from './core/reflex.js';
import { createApprovalInterpreter, type ApprovalInterpreter } from './core/approval-interpreter.js';
import type { BrowserAgent } from './core/browser-agent.js';
import { factoryModule } from './factory/index.js';
import type { TaskController, TaskEventHub, TaskEventMessage, TaskStore } from './factory/task-store.js';
import { createGitHubFactoryBoardReader, FactoryBoardCache, type FactoryBoardReader } from './factory/board.js';
import type { GitHubAppTokenIssuer, GitHubRepositoryCatalog } from './github-app.js';
import type { ProjectStore } from './factory/projects.js';
import type { ReleaseGraphReader, ReleaseViewStore } from './factory/release-view.js';
import type { RepositoryCreator } from './factory/new-project.js';
import { registerModules, type BackendModule } from './modules.js';
import { registerHealthUploadRoutes,type HealthUploadOptions } from './daily/health-upload/server.js';
import { ownerId } from './daily/health-upload/contracts.js';
import { HealthProcessingWorker } from './daily/health/worker.js';
import type { SqlHealthProcessor } from './daily/health/processor.js';
import { registerHealthCapabilityRoutes } from './daily/health-upload/capability-routes.js';
import type { SqlHealthCapabilities } from './daily/health-upload/sql-capabilities.js';
import type { SettingsStore } from './core/settings.js';
import { fallbackModelCatalogue, type ModelCatalogueReader } from './core/model-catalog.js';
import type { NowFeedEventHub, NowFeedStore, NowFeedUpdate } from './core/now.js';
import type { CredentialStatusStore } from './credentials/credential-status.js';
import { SystemHealthDiagnostics } from './core/system-health.js';
import type { runCodexRenewalOnce } from './credentials/codex-renewal.js';
import type { UsageStore } from './core/usage.js';
import type { BackgroundJobStore } from './database/background-job-store.js';
import type { SandboxHeartbeat } from './factory/heartbeat.js';
import type { ContainerAppScaler } from './operations/container-app-scale.js';
import { createSleepModule } from './operations/sleep.js';
import type { OwnerInteractionService } from './core/owner-interactions.js';
import type { AwayModeStore } from './core/away-mode.js';
import type { PhoneSessionStore } from './database/phone-session-store.js';
import type { TaskStatusNotificationStore } from './database/task-status-notification-store.js';
import type { GitHubIssueClient } from './github/issues.js';
import { recordIssueTaskProgress } from './factory/issues.js';
import { WorkspaceCommandBroker } from './core/workspace-commands.js';
import type { WorkspaceHtmlArtifactStore } from './database/workspace-html-artifact-store.js';
import type { ConversationAttachmentStore } from './database/conversation-attachment-store.js';
import type { ConversationSummaryStore } from './database/conversation-summary-store.js';
import { startConversationAttachmentCleanupJob } from './core/conversation-attachment-cleanup.js';
import { createTaskStatusNotificationHandler } from './factory/task-status-notifications.js';
import type { ModelDeploymentWorkflow } from './core/model-deployments.js';
import {
  createSystemSmokeReader, createSystemStatusReader, type SystemSmokeReader, type SystemStatusProbe,
  type SystemStatusReader,
} from './system-status.js';
import { registerWebSocketPlugin } from './websocket.js';
import { registerActivityKitRoutes, type ActivityKitServices } from './push/activitykit-routes.js';
import {
  registerApprovalNotificationRoutes,
  type ApprovalNotificationServices,
} from './push/approval-notifications.js';
import type { BrowserConfirmation } from './core/owner-interactions.js';

export interface BuildAppOptions {
  readonly activityKit?: ActivityKitServices;
  readonly approvalNotifications?: ApprovalNotificationServices;
  readonly notifyApproval?: (confirmation: BrowserConfirmation) => void;
  readonly managedRuntime?: import('./core/managed-runtime-routes.js').ManagedRuntimeServices;
  /** Supplied only after managed definition, settings and application-policy verification. */
  readonly conversationRuntimeTests?: import('./core/runtime-test-availability.js').ConversationRuntimeTestReader;
  readonly databaseStatus?: () => boolean;
  readonly auth?: TokenVerifier;
  readonly nutritionExportAuth?: import('./daily/nutrition-export/auth.js').NutritionExportCredentialVerifier;
  /** Default-off health upload composition; production supplies it only behind JARVIS_HEALTH_UPLOAD_ENABLED. */
  readonly healthUpload?: HealthUploadOptions;
  /** Owner session service; production supplies it only behind JARVIS_OWNER_SESSION_ENABLED. Ignored while the switch is off. */
  readonly ownerSessions?: OwnerSessionService;
  readonly healthProcessor?: Pick<SqlHealthProcessor, 'processNext'>;
  readonly healthCapabilities?: SqlHealthCapabilities;
  readonly modules?: readonly BackendModule[];
  readonly projectStore?: ProjectStore;
  readonly projectPolicyChanged?: (projectId: string) => Promise<void>;
  readonly releaseViewStore?: ReleaseViewStore;
  readonly releaseGraphReader?: ReleaseGraphReader;
  readonly projectRepositoryCreator?: RepositoryCreator;
  readonly toolCallStore?: ToolCallStore;
  readonly taskStore?: TaskStore;
  readonly githubAppTokenIssuer?: GitHubAppTokenIssuer;
  readonly githubIssueClient?: GitHubIssueClient;
  readonly issueProgressBoardUrl?: string;
  readonly factoryBoardReader?: FactoryBoardReader;
  readonly githubRepositoryCatalog?: GitHubRepositoryCatalog;
  readonly taskController?: TaskController;
  readonly eventHub?: TaskEventHub;
  readonly settingsStore?: SettingsStore;
  readonly modelCatalogue?: ModelCatalogueReader;
  readonly modelDeploymentWorkflow?: ModelDeploymentWorkflow | null;
  readonly credentialStatusStore?: CredentialStatusStore;
  readonly renewCodexCredential?: () => ReturnType<typeof runCodexRenewalOnce>;
  readonly usageStore?: UsageStore;
  readonly backgroundJobStore?: BackgroundJobStore;
  readonly onEmbeddingModelChanged?: (jobs: BackgroundJobRegistry) => Promise<void>;
  readonly nowFeedStore?: NowFeedStore;
  readonly nowEventHub?: NowFeedEventHub;
  readonly jarvisActivityHub?: JarvisActivityHub;
  readonly conversationStore?: ConversationStore;
  readonly conversationAttachments?: ConversationAttachmentStore;
  readonly conversationSummaryStore?: ConversationSummaryStore;
  readonly attachmentVision?: {
    (image: Buffer, contentType: string, signal: AbortSignal): Promise<string>;
  };
  readonly onConversationSessionEnded?: (sessionId: string) => void;
  readonly sandboxHeartbeat?: SandboxHeartbeat;
  readonly conversationAgent?: ConversationAgent;
  readonly reflexClassifier?: ReflexClassifier;
  /** Decides what a verified Dan reply means for a staged action. Defaults to the deterministic fast path only. */
  readonly approvalInterpreter?: ApprovalInterpreter;
  readonly browserAgent?: BrowserAgent;
  readonly containerAppScaler?: ContainerAppScaler | null;
  readonly ownerInteractions?: OwnerInteractionService | null;
  readonly awayModeStore?: AwayModeStore | null;
  readonly phoneSessionStore?: PhoneSessionStore | null;
  readonly taskStatusNotificationStore?: TaskStatusNotificationStore | null;
  readonly workspaceCommands?: WorkspaceCommandBroker;
  readonly workspaceHtmlArtifacts?: Pick<WorkspaceHtmlArtifactStore, 'read'>;
  readonly systemStatusReader?: SystemStatusReader;
  readonly vaultMirrorStatusReader?: import('./vault-mirror-status.js').VaultMirrorStatusReader;
  readonly systemSmokeProbes?: Partial<Record<SystemSmokeCheckId, SystemStatusProbe>>;
  readonly backendLogAuthorizationProbe?: BackendLogAuthorizationProbe;
}

declare module 'fastify' {
  interface FastifyRequest {
    requestStartedAt: number;
  }
  interface FastifyInstance {
    ownerObjectId: string;
    backendLogsConfigured: boolean;
    backendLogAuthorizationProbe: BackendLogAuthorizationProbe | null;
    ownerSessionConnections: OwnerSessionConnectionRegistry | null;
    databaseStatus: () => boolean;
    projectStore: ProjectStore | null;
    projectPolicyChanged: (projectId: string) => Promise<void>;
    releaseViewStore: ReleaseViewStore | null;
    releaseGraphReader: ReleaseGraphReader | null;
    projectRepositoryCreator: RepositoryCreator | null;
    toolCallStore: ToolCallStore | null;
    taskStore: TaskStore | null;
    githubAppTokenIssuer: GitHubAppTokenIssuer | null;
    githubIssueClient: GitHubIssueClient | null;
    factoryBoardReader: FactoryBoardReader;
    factoryBoardCache: FactoryBoardCache;
    publishFactoryBoardChange(projectId: string, origin: 'task_event' | 'github_webhook', reqId?: string): void;
    githubRepositoryCatalog: GitHubRepositoryCatalog | null;
    taskController: TaskController | null;
    eventHub: TaskEventHub;
    settingsStore: SettingsStore | null;
    modelCatalogue: ModelCatalogueReader;
    modelDeploymentWorkflow: ModelDeploymentWorkflow | null;
    credentialStatusStore: CredentialStatusStore | null;
    renewCodexCredential: (() => ReturnType<typeof runCodexRenewalOnce>) | null;
    usageStore: UsageStore | null;
    nowFeedStore: NowFeedStore | null;
    nowEventHub: NowFeedEventHub;
    jarvisActivityHub: JarvisActivityHub;
    conversationStore: ConversationStore | null;
    conversationAttachments: ConversationAttachmentStore | null;
    conversationSummaryStore: ConversationSummaryStore | null;
    attachmentVision: BuildAppOptions['attachmentVision'] | null;
    onConversationSessionEnded: (sessionId: string) => void;
    sandboxHeartbeat: SandboxHeartbeat | null;
    conversationAgent: ConversationAgent | null;
    conversationRuntimeTests: import('./core/runtime-test-availability.js').ConversationRuntimeTestReader | null;
    managedRuntime: import('./core/managed-runtime-routes.js').ManagedRuntimeServices | null;
    reflexClassifier: ReflexClassifier | null;
    approvalInterpreter: ApprovalInterpreter;
    browserAgent: BrowserAgent | null;
    ownerInteractions: OwnerInteractionService | null;
    notifyApproval: (confirmation: BrowserConfirmation) => void;
    awayModeStore: AwayModeStore | null;
    phoneSessionStore: PhoneSessionStore | null;
    taskStatusNotificationStore: TaskStatusNotificationStore | null;
    workspaceCommands: WorkspaceCommandBroker;
    workspaceHtmlArtifacts: Pick<WorkspaceHtmlArtifactStore, 'read'> | null;
    backgroundJobs: BackgroundJobRegistry;
    onEmbeddingModelChanged: ((jobs: BackgroundJobRegistry) => Promise<void>) | null;
    systemStatusReader: SystemStatusReader;
    vaultMirrorStatusReader: import('./vault-mirror-status.js').VaultMirrorStatusReader | null;
    systemHealthDiagnostics: SystemHealthDiagnostics;
    systemSmokeReader: SystemSmokeReader;
    shutdownConnections: Set<() => void | Promise<void>>;
    shutdownErrors: unknown[];
    isStopping: boolean;
  }
}

export function buildApp(config: BackendConfig, logger: Logger = createLogger(config), options: BuildAppOptions = {}) {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000,
    forceCloseConnections: 'idle',
  });
  const registerWebSocketShutdown = registerWebSocketPlugin(app);
  const origins = new Set([localWebOrigin, config.staticWebAppOrigin].filter((origin) => origin !== undefined));
  app.decorate('shutdownConnections', new Set<() => void | Promise<void>>());
  app.decorate('shutdownErrors', []);
  app.decorate('isStopping', false);
  app.addHook('preClose', async () => {
    app.isStopping = true;
    app.ownerSessionConnections?.close();
    // Stop accepting connections before draining streams; onClose runs only after HTTP drains.
    if (app.server.listening) app.server.close();
    const results = await Promise.allSettled([...app.shutdownConnections].map(async (close) => close()));
    for (const result of results) {
      if (result.status === 'rejected') app.shutdownErrors.push(result.reason);
    }
    app.shutdownConnections.clear();
    app.eventHub.close();
    app.nowEventHub.close();
    app.jarvisActivityHub.close();
  });
  // Fastify discards preClose errors; propagate drain failures after resource cleanup instead.
  app.addHook('onClose', async () => {
    if (app.shutdownErrors.length) throw app.shutdownErrors[0];
  });

  app.decorateRequest('requestStartedAt', 0);
  app.addHook('onRequest', async (request, reply) => {
    request.requestStartedAt = performance.now();
    request.log.info({
      method: request.method,
      ...(request.routeOptions.url === undefined ? {} : { route: request.routeOptions.url }),
    }, 'request.started');
    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      request.log.warn('request.origin_denied');
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });
  // Authenticate before CORS can finish OPTIONS requests in its onRequest hook.
  if (options.healthUpload?.buffer && options.healthUpload.buffer.owner !== ownerId(config.auth.ownerObjectId)) throw new Error('Health upload owner mismatch');
  if (config.ownerSessionEnabled && !options.ownerSessions) {
    throw new ConfigurationError('JARVIS_OWNER_SESSION_ENABLED requires the owner session service');
  }
  const ownerSessions = config.ownerSessionEnabled ? options.ownerSessions : undefined;
  app.decorate('ownerSessionConnections', ownerSessions
    ? new OwnerSessionConnectionRegistry({ verifier: ownerSessions })
    : null);
  installAuthentication(app, config, options.auth, options.nutritionExportAuth, options.healthUpload?.enabled === true, ownerSessions);
  app.decorate('ownerObjectId', config.auth.ownerObjectId);
  app.decorate('notifyApproval', options.notifyApproval ?? (() => {}));
  app.decorate('backendLogsConfigured', config.backendLogs !== undefined);
  app.decorate('backendLogAuthorizationProbe', options.backendLogAuthorizationProbe ?? null);
  app.decorate('awayModeStore', options.awayModeStore ?? null);
  app.register(cors, {
    origin: (origin, callback) => callback(null, origin === undefined || origins.has(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    credentials: false,
    strictPreflight: true,
  });
  app.register(multipart, {
    limits: { files: 1, fields: 0, parts: 1, fileSize: 20 * 1024 * 1024 },
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method: request.method,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, 'request.completed');
  });
  const systemStatusReader = options.systemStatusReader ??
    createSystemStatusReader({}, process.env.JARVIS_DEPLOYED_COMMIT);
  app.decorate('systemStatusReader', systemStatusReader);
  app.decorate('vaultMirrorStatusReader', options.vaultMirrorStatusReader ?? null);
  app.decorate('systemHealthDiagnostics', new SystemHealthDiagnostics());
  app.decorate('systemSmokeReader', createSystemSmokeReader(
    systemStatusReader,
    options.systemSmokeProbes ?? {},
  ));
  app.setErrorHandler((error, request, reply) => {
    const candidate = (error as { statusCode?: number }).statusCode;
    const statusCode = candidate && Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : 500;
    systemStatusReader.recordError(request.routeOptions.url, statusCode);
    request.log.error({
      ...safeErrorFields(error),
      statusCode,
      ...(request.routeOptions.url === undefined ? {} : { route: request.routeOptions.url }),
    }, 'request.failed');
    reply.code(statusCode).send({ error: statusCode < 500 ? 'Invalid request' : 'Internal server error' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  app.decorate('databaseStatus', options.databaseStatus ?? (() => false));
  app.decorate('projectStore', options.projectStore ?? null);
  app.decorate('projectPolicyChanged', options.projectPolicyChanged ?? (async () => {}));
  app.decorate('releaseViewStore', options.releaseViewStore ?? null);
  app.decorate('releaseGraphReader', options.releaseGraphReader ?? null);
  app.decorate('projectRepositoryCreator', options.projectRepositoryCreator ?? null);
  app.decorate('toolCallStore', options.toolCallStore ?? null);
  app.decorate('taskStore', options.taskStore ?? null);
  app.decorate('githubAppTokenIssuer', options.githubAppTokenIssuer ?? null);
  app.decorate('githubIssueClient', options.githubIssueClient ?? null);
  app.decorate('githubRepositoryCatalog', options.githubRepositoryCatalog ?? null);
  app.decorate('taskController', options.taskController ?? null);
  app.decorate('eventHub', options.eventHub ?? createEventHub<TaskEventMessage>());
  app.decorate('factoryBoardReader', options.factoryBoardReader ?? createGitHubFactoryBoardReader());
  app.decorate('factoryBoardCache', new FactoryBoardCache());
  app.decorate('nowFeedStore', options.nowFeedStore ?? null);
  app.decorate('nowEventHub', options.nowEventHub ?? createEventHub<NowFeedUpdate>());
  const factoryBoardVersions = new Map<string, number>();
  app.decorate('publishFactoryBoardChange', (
    projectId: string,
    origin: 'task_event' | 'github_webhook',
    reqId?: string,
  ) => {
    const version = (factoryBoardVersions.get(projectId) ?? 0) + 1;
    factoryBoardVersions.set(projectId, version);
    app.factoryBoardCache.invalidate(projectId);
    app.nowEventHub.publish({ type: 'board', projectId, version });
    app.log.info({
      origin,
      ...(/^[1-9]\d{0,18}$/u.test(projectId) ? { projectId } : {}),
      ...(Number.isSafeInteger(version) && version <= 1_000_000_000 ? { version } : {}),
      ...(reqId === undefined ? {} : { reqId }),
    }, 'factory.board_invalidated');
  });
  const unsubscribeFactoryBoardEvents = app.eventHub.subscribe((event) => {
    void (async () => {
      const task = await app.taskStore?.get(event.taskId, 0, 0);
      if (!task) throw new Error('Task project unavailable');
      app.publishFactoryBoardChange(task.projectId, 'task_event');
    })().catch((error: unknown) => app.log.warn(safeErrorFields(error), 'factory.board_task_event_failed'));
  });
  app.addHook('onClose', async () => { unsubscribeFactoryBoardEvents(); });
  app.decorate('jarvisActivityHub', options.jarvisActivityHub ??
    createEventHub<JarvisActivityEvent | JarvisVoiceWakeEvent | BackgroundJobEvent>());
  const backgroundJobs = new BackgroundJobRegistry(app.jarvisActivityHub, Date.now, options.backgroundJobStore);
  app.decorate('backgroundJobs', backgroundJobs);
  app.decorate('onEmbeddingModelChanged', options.onEmbeddingModelChanged ?? null);
  app.addHook('onReady', async () => { await backgroundJobs.initialize(); });
  registerActivityKitRoutes(app, options.activityKit);
  registerApprovalNotificationRoutes(app, options.approvalNotifications);
  app.decorate('onConversationSessionEnded', options.onConversationSessionEnded ?? (() => {}));
  const workspaceCommands = options.workspaceCommands ?? new WorkspaceCommandBroker();
  app.decorate('workspaceCommands', workspaceCommands);
  app.decorate('workspaceHtmlArtifacts', options.workspaceHtmlArtifacts ?? null);
  app.addHook('onClose', async () => { workspaceCommands.dispose(); });
  app.decorate('settingsStore', options.settingsStore ?? null);
  app.decorate('modelCatalogue', options.modelCatalogue ?? { read: async () => fallbackModelCatalogue() });
  app.decorate('modelDeploymentWorkflow', options.modelDeploymentWorkflow ?? null);
  app.decorate('credentialStatusStore', options.credentialStatusStore ?? null);
  app.decorate('renewCodexCredential', options.renewCodexCredential ?? null);
  app.decorate('usageStore', options.usageStore ?? null);
  app.decorate('conversationStore', options.conversationStore ?? null);
  app.decorate('conversationRuntimeTests', options.conversationRuntimeTests ?? null);
  app.decorate('managedRuntime', options.managedRuntime ?? null);
  app.decorate('conversationAttachments', options.conversationAttachments ?? null);
  app.decorate('conversationSummaryStore', options.conversationSummaryStore ?? null);
  if (options.conversationAttachments) {
    const store = options.conversationAttachments;
    let stopAttachmentCleanup: (() => void) | undefined;
    app.addHook('onClose', async () => { stopAttachmentCleanup?.(); });
    app.addHook('onReady', async () => {
      stopAttachmentCleanup = startConversationAttachmentCleanupJob(
        store,
        () => app.log.warn('conversation_attachments.cleanup_failed'),
      );
    });
  }
  app.decorate('attachmentVision', options.attachmentVision ?? null);
  app.decorate('sandboxHeartbeat', options.sandboxHeartbeat ?? null);
  if (options.sandboxHeartbeat) {
    app.addHook('onClose', async () => { await options.sandboxHeartbeat!.stop(); });
  }
  app.decorate('conversationAgent', options.conversationAgent ?? null);
  app.decorate('reflexClassifier', options.reflexClassifier ?? null);
  app.decorate('approvalInterpreter', options.approvalInterpreter ?? createApprovalInterpreter());
  app.decorate('browserAgent', options.browserAgent ?? null);
  app.decorate('ownerInteractions', options.ownerInteractions ?? null);
  app.decorate('phoneSessionStore', options.phoneSessionStore ?? null);
  app.decorate('taskStatusNotificationStore', options.taskStatusNotificationStore ?? null);
  const notifyTaskStatus = app.taskStatusNotificationStore && app.taskStore && app.conversationStore
    ? createTaskStatusNotificationHandler({
      tasks: app.taskStore,
      conversations: app.conversationStore,
      notifications: app.taskStatusNotificationStore,
      onError: () => app.log.warn('task_status_notification.failed'),
    })
    : undefined;
  const issueProgressQueues = new Map<string, Promise<void>>();
  const unsubscribeTaskEvents = app.eventHub.subscribe((event) => {
    const tasks = app.taskStore;
    const projects = app.projectStore;
    const github = app.githubIssueClient;
    if (github && tasks && projects &&
      (event.type === 'created' || event.type === 'pull_request_opened' || event.type === 'state_changed')) {
      const previous = issueProgressQueues.get(event.taskId) ?? Promise.resolve();
      const pending = previous.then(() => recordIssueTaskProgress({
          event,
          tasks,
          projects,
          github,
          ...(options.issueProgressBoardUrl ? { boardUrl: options.issueProgressBoardUrl } : {}),
        }))
        .catch(() => app.log.warn('github.issue_progress_failed'));
      issueProgressQueues.set(event.taskId, pending);
      void pending.finally(() => {
        if (issueProgressQueues.get(event.taskId) === pending) issueProgressQueues.delete(event.taskId);
      });
    }
    void (async () => {
      let away: boolean;
      app.nowEventHub.publish({ type: 'refresh' });
      try {
        away = ((await app.awayModeStore?.read())?.mode ?? 'present') !== 'present';
      } catch {
        app.log.warn('away_mode.task_route_failed');
        away = false;
      }

      const handled = await notifyTaskStatus?.(event) ?? false;
      if (!away || handled) return;

      const payload = event.payload;
      const nextState = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).to
        : undefined;
      if (event.type !== 'state_changed' || typeof nextState !== 'string' ||
        !['Ready', 'Running', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'].includes(nextState)) return;
      try {
        const kind = nextState === 'NeedsAttention' ? 'warning' : nextState === 'Done' ? 'success' : 'info';
        await app.ownerInteractions?.notify(kind, `Task ${event.taskId} is now ${nextState}.`);
      } catch {
        app.log.warn('task_status_notification.failed');
      }
    })();
  });
  app.addHook('onClose', async () => {
    unsubscribeTaskEvents();
    issueProgressQueues.clear();
  });
  if (options.healthUpload?.enabled === true) {
    const worker = options.healthProcessor ? new HealthProcessingWorker(options.healthProcessor, state => {
      if (state === 'retry') app.log.warn('daily.health_processing_retry');
    }) : undefined;
    if (worker) {
      app.addHook('onReady', async () => worker.start());
      app.shutdownConnections.add(() => worker.stop());
      app.addHook('onClose', async () => worker.stop());
    }
    const shutdown = new AbortController();
    app.shutdownConnections.add(() => shutdown.abort());
    app.register(registerHealthUploadRoutes,{ ...options.healthUpload,shutdownSignal: AbortSignal.any([
      shutdown.signal,...(options.healthUpload.shutdownSignal ? [options.healthUpload.shutdownSignal] : []),
    ]),wakeProcessing: () => worker?.wake() });
    if (options.healthCapabilities) app.register(registerHealthCapabilityRoutes,options.healthCapabilities);
  }
  // With the switch off these routes are not registered at all, so the paths answer 404.
  if (ownerSessions) app.register(registerOwnerSessionRoutes, { service: ownerSessions });
  registerModules(app, options.modules ?? [
    coreModule,
    conversationModule,
    factoryModule,
    createSleepModule(options.containerAppScaler ?? null),
  ]);
  registerWebSocketShutdown();
  return app;
}

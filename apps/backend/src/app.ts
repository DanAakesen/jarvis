import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from 'pino';
import type { JarvisActivityEvent, JarvisVoiceWakeEvent } from '@jarvis/contracts';
import { localWebOrigin, type BackendConfig } from './config.js';
import { createLogger } from './logging.js';
import { installAuthentication } from './auth/hook.js';
import type { TokenVerifier } from './auth/verify.js';
import { coreModule } from './core/index.js';
import { createEventHub } from './core/event-hub.js';
import type { JarvisActivityHub } from './core/activity.js';
import type { ToolCallStore } from './core/tool-calls.js';
import { conversationModule } from './core/conversation.js';
import type { ConversationStore } from './core/conversation-store.js';
import type { ConversationAgent } from './core/chat-agent.js';
import type { ReflexClassifier } from './core/reflex.js';
import type { BrowserAgent } from './core/browser-agent.js';
import { factoryModule } from './factory/index.js';
import type { TaskController, TaskEventHub, TaskEventMessage, TaskStore } from './factory/task-store.js';
import type { GitHubAppTokenIssuer, GitHubRepositoryCatalog } from './github-app.js';
import type { ProjectStore } from './factory/projects.js';
import type { ReleaseGraphReader, ReleaseViewStore } from './factory/release-view.js';
import type { RepositoryCreator } from './factory/new-project.js';
import { registerModules, type BackendModule } from './modules.js';
import type { SettingsStore } from './core/settings.js';
import type { NowFeedEventHub, NowFeedStore, NowFeedUpdate } from './core/now.js';
import type { CredentialStatusStore } from './credentials/credential-status.js';
import type { UsageStore } from './core/usage.js';
import type { SandboxHeartbeat } from './factory/heartbeat.js';
import type { ContainerAppScaler } from './operations/container-app-scale.js';
import { createSleepModule } from './operations/sleep.js';
import type { TeamsNotificationService } from './teams/service.js';
import type { AwayModeStore } from './core/away-mode.js';
import type { PhoneSessionStore } from './database/phone-session-store.js';
import { WorkspaceCommandBroker } from './core/workspace-commands.js';

export interface BuildAppOptions {
  readonly databaseStatus?: () => boolean;
  readonly auth?: TokenVerifier;
  readonly modules?: readonly BackendModule[];
  readonly projectStore?: ProjectStore;
  readonly releaseViewStore?: ReleaseViewStore;
  readonly releaseGraphReader?: ReleaseGraphReader;
  readonly projectRepositoryCreator?: RepositoryCreator;
  readonly toolCallStore?: ToolCallStore;
  readonly taskStore?: TaskStore;
  readonly githubAppTokenIssuer?: GitHubAppTokenIssuer;
  readonly githubRepositoryCatalog?: GitHubRepositoryCatalog;
  readonly taskController?: TaskController;
  readonly eventHub?: TaskEventHub;
  readonly settingsStore?: SettingsStore;
  readonly credentialStatusStore?: CredentialStatusStore;
  readonly usageStore?: UsageStore;
  readonly nowFeedStore?: NowFeedStore;
  readonly nowEventHub?: NowFeedEventHub;
  readonly jarvisActivityHub?: JarvisActivityHub;
  readonly conversationStore?: ConversationStore;
  readonly sandboxHeartbeat?: SandboxHeartbeat;
  readonly conversationAgent?: ConversationAgent;
  readonly reflexClassifier?: ReflexClassifier;
  readonly browserAgent?: BrowserAgent;
  readonly containerAppScaler?: ContainerAppScaler | null;
  readonly teamsNotifications?: TeamsNotificationService | null;
  readonly awayModeStore?: AwayModeStore | null;
  readonly phoneSessionStore?: PhoneSessionStore | null;
  readonly workspaceCommands?: WorkspaceCommandBroker;
}

declare module 'fastify' {
  interface FastifyInstance {
    ownerObjectId: string;
    databaseStatus: () => boolean;
    projectStore: ProjectStore | null;
    releaseViewStore: ReleaseViewStore | null;
    releaseGraphReader: ReleaseGraphReader | null;
    projectRepositoryCreator: RepositoryCreator | null;
    toolCallStore: ToolCallStore | null;
    taskStore: TaskStore | null;
    githubAppTokenIssuer: GitHubAppTokenIssuer | null;
    githubRepositoryCatalog: GitHubRepositoryCatalog | null;
    taskController: TaskController | null;
    eventHub: TaskEventHub;
    settingsStore: SettingsStore | null;
    credentialStatusStore: CredentialStatusStore | null;
    usageStore: UsageStore | null;
    nowFeedStore: NowFeedStore | null;
    nowEventHub: NowFeedEventHub;
    jarvisActivityHub: JarvisActivityHub;
    conversationStore: ConversationStore | null;
    sandboxHeartbeat: SandboxHeartbeat | null;
    conversationAgent: ConversationAgent | null;
    reflexClassifier: ReflexClassifier | null;
    browserAgent: BrowserAgent | null;
    teamsNotifications: TeamsNotificationService | null;
    awayModeStore: AwayModeStore | null;
    phoneSessionStore: PhoneSessionStore | null;
    workspaceCommands: WorkspaceCommandBroker;
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
  const origins = new Set([localWebOrigin, config.staticWebAppOrigin].filter((origin) => origin !== undefined));

  app.addHook('onRequest', async (request, reply) => {
    request.log.info({ method: request.method }, 'request.started');
    const origin = request.headers.origin;
    if (origin !== undefined && !origins.has(origin)) {
      request.log.warn('request.origin_denied');
      return reply.code(403).send({ error: 'Origin not allowed' });
    }
  });
  // Authenticate before CORS can finish OPTIONS requests in its onRequest hook.
  installAuthentication(app, config, options.auth);
  app.decorate('ownerObjectId', config.auth.ownerObjectId);
  app.decorate('awayModeStore', options.awayModeStore ?? null);
  app.register(cors, {
    origin: (origin, callback) => callback(null, origin === undefined || origins.has(origin)),
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Last-Event-ID'],
    credentials: false,
    strictPreflight: true,
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info({
      method: request.method,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, 'request.completed');
  });
  app.setErrorHandler((error, request, reply) => {
    const candidate = (error as { statusCode?: number }).statusCode;
    const statusCode = candidate && Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : 500;
    request.log.error({ statusCode }, 'request.failed');
    reply.code(statusCode).send({ error: statusCode < 500 ? 'Invalid request' : 'Internal server error' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  app.decorate('databaseStatus', options.databaseStatus ?? (() => false));
  app.decorate('projectStore', options.projectStore ?? null);
  app.decorate('releaseViewStore', options.releaseViewStore ?? null);
  app.decorate('releaseGraphReader', options.releaseGraphReader ?? null);
  app.decorate('projectRepositoryCreator', options.projectRepositoryCreator ?? null);
  app.decorate('toolCallStore', options.toolCallStore ?? null);
  app.decorate('taskStore', options.taskStore ?? null);
  app.decorate('githubAppTokenIssuer', options.githubAppTokenIssuer ?? null);
  app.decorate('githubRepositoryCatalog', options.githubRepositoryCatalog ?? null);
  app.decorate('taskController', options.taskController ?? null);
  app.decorate('eventHub', options.eventHub ?? createEventHub<TaskEventMessage>());
  app.decorate('nowFeedStore', options.nowFeedStore ?? null);
  app.decorate('nowEventHub', options.nowEventHub ?? createEventHub<NowFeedUpdate>());
  app.decorate('jarvisActivityHub', options.jarvisActivityHub ?? createEventHub<JarvisActivityEvent | JarvisVoiceWakeEvent>());
  const workspaceCommands = options.workspaceCommands ?? new WorkspaceCommandBroker();
  app.decorate('workspaceCommands', workspaceCommands);
  app.addHook('onClose', async () => { workspaceCommands.dispose(); });
  const unsubscribeTaskEvents = app.eventHub.subscribe((event) => {
    void (async () => {
      let state: Awaited<ReturnType<AwayModeStore['read']>> | undefined;
      try {
        state = await app.awayModeStore?.read();
      } catch {
        app.log.warn('away_mode.task_route_failed');
        return;
      }
      const away = state?.away ?? false;
      if (!away) {
        app.nowEventHub.publish({ type: 'refresh' });
        return;
      }

      const payload = event.payload;
      const nextState = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).to
        : undefined;
      if (event.type !== 'state_changed' || typeof nextState !== 'string' ||
        !['Ready', 'Running', 'Paused', 'NeedsAttention', 'Done', 'Cancelled'].includes(nextState) ||
        !app.teamsNotifications) return;
      try {
        const kind = nextState === 'NeedsAttention' ? 'warning' : nextState === 'Done' ? 'success' : 'info';
        await app.teamsNotifications.notify(kind, `Task ${event.taskId} is now ${nextState}.`);
      } catch {
        app.log.warn('away_mode.task_notification_failed');
      }
    })();
  });
  app.addHook('onClose', async () => { unsubscribeTaskEvents(); });
  app.decorate('settingsStore', options.settingsStore ?? null);
  app.decorate('credentialStatusStore', options.credentialStatusStore ?? null);
  app.decorate('usageStore', options.usageStore ?? null);
  app.decorate('conversationStore', options.conversationStore ?? null);
  app.decorate('sandboxHeartbeat', options.sandboxHeartbeat ?? null);
  if (options.sandboxHeartbeat) {
    app.addHook('onClose', async () => { await options.sandboxHeartbeat!.stop(); });
  }
  app.decorate('conversationAgent', options.conversationAgent ?? null);
  app.decorate('reflexClassifier', options.reflexClassifier ?? null);
  app.decorate('browserAgent', options.browserAgent ?? null);
  app.decorate('teamsNotifications', options.teamsNotifications ?? null);
  app.decorate('phoneSessionStore', options.phoneSessionStore ?? null);
  registerModules(app, options.modules ?? [
    coreModule,
    conversationModule,
    factoryModule,
    createSleepModule(options.containerAppScaler ?? null),
  ]);
  return app;
}

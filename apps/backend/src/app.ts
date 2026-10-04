import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from 'pino';
import { localWebOrigin, type BackendConfig } from './config.js';
import { createLogger } from './logging.js';
import { installAuthentication } from './auth/hook.js';
import type { TokenVerifier } from './auth/verify.js';
import { coreModule } from './core/index.js';
import { createEventHub } from './core/event-hub.js';
import type { ToolCallStore } from './core/tool-calls.js';
import { conversationModule } from './core/conversation.js';
import type { ConversationStore } from './core/conversation-store.js';
import type { ConversationAgent } from './core/chat-agent.js';
import { factoryModule } from './factory/index.js';
import type { TaskController, TaskEventHub, TaskEventMessage, TaskStore } from './factory/task-store.js';
import type { ProjectStore } from './factory/projects.js';
import { registerModules, type BackendModule } from './modules.js';
import type { SettingsStore } from './core/settings.js';
import type { NowFeedEventHub, NowFeedStore, NowFeedUpdate } from './core/now.js';
import type { CredentialStatusStore } from './credentials/credential-status.js';
import type { UsageStore } from './core/usage.js';
import type { SandboxHeartbeat } from './factory/heartbeat.js';
import type { ContainerAppScaler } from './operations/container-app-scale.js';
import { createSleepModule } from './operations/sleep.js';

export interface BuildAppOptions {
  readonly auth?: TokenVerifier;
  readonly modules?: readonly BackendModule[];
  readonly projectStore?: ProjectStore;
  readonly toolCallStore?: ToolCallStore;
  readonly taskStore?: TaskStore;
  readonly taskController?: TaskController;
  readonly eventHub?: TaskEventHub;
  readonly settingsStore?: SettingsStore;
  readonly credentialStatusStore?: CredentialStatusStore;
  readonly usageStore?: UsageStore;
  readonly nowFeedStore?: NowFeedStore;
  readonly nowEventHub?: NowFeedEventHub;
  readonly conversationStore?: ConversationStore;
  readonly sandboxHeartbeat?: SandboxHeartbeat;
  readonly conversationAgent?: ConversationAgent;
  readonly containerAppScaler?: ContainerAppScaler | null;
}

declare module 'fastify' {
  interface FastifyInstance {
    projectStore: ProjectStore | null;
    toolCallStore: ToolCallStore | null;
    taskStore: TaskStore | null;
    taskController: TaskController | null;
    eventHub: TaskEventHub;
    settingsStore: SettingsStore | null;
    credentialStatusStore: CredentialStatusStore | null;
    usageStore: UsageStore | null;
    nowFeedStore: NowFeedStore | null;
    nowEventHub: NowFeedEventHub;
    conversationStore: ConversationStore | null;
    sandboxHeartbeat: SandboxHeartbeat | null;
    conversationAgent: ConversationAgent | null;
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
  app.decorate('projectStore', options.projectStore ?? null);
  app.decorate('toolCallStore', options.toolCallStore ?? null);
  app.decorate('taskStore', options.taskStore ?? null);
  app.decorate('taskController', options.taskController ?? null);
  app.decorate('eventHub', options.eventHub ?? createEventHub<TaskEventMessage>());
  app.decorate('nowFeedStore', options.nowFeedStore ?? null);
  app.decorate('nowEventHub', options.nowEventHub ?? createEventHub<NowFeedUpdate>());
  const unsubscribeTaskEvents = app.eventHub.subscribe(() => app.nowEventHub.publish({ type: 'refresh' }));
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
  registerModules(app, options.modules ?? [
    coreModule,
    conversationModule,
    factoryModule,
    createSleepModule(options.containerAppScaler ?? null),
  ]);
  return app;
}

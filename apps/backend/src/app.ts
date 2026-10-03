import { randomUUID } from 'node:crypto';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import type { Logger } from 'pino';
import { localWebOrigin, type BackendConfig } from './config.js';
import { createLogger } from './logging.js';
import { installAuthentication } from './auth/hook.js';
import type { TokenVerifier } from './auth/verify.js';
import { coreModule } from './core/index.js';
import type { ToolCallStore } from './core/tool-calls.js';
import { factoryModule } from './factory/index.js';
import type { ProjectStore } from './factory/projects.js';
import { registerModules, type BackendModule } from './modules.js';

export interface BuildAppOptions {
  readonly auth?: TokenVerifier;
  readonly modules?: readonly BackendModule[];
  readonly projectStore?: ProjectStore;
  readonly toolCallStore?: ToolCallStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    projectStore: ProjectStore | null;
    toolCallStore: ToolCallStore | null;
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
    allowedHeaders: ['Authorization', 'Content-Type'],
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
  registerModules(app, options.modules ?? [coreModule, factoryModule]);
  return app;
}

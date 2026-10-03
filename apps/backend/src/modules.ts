import type { FastifyBaseLogger, FastifyInstance, FastifyPluginAsync, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import { createToolRegistry, type JarvisTool, type ToolRegistry } from './core/tool-registry.js';

export interface BackendModule {
  readonly id: string;
  readonly registerRoutes: FastifyPluginAsync;
  readonly tools: readonly JarvisTool[];
}

declare module 'fastify' {
  interface FastifyInstance {
    jarvisTools: ToolRegistry;
  }
}

/** Compose trusted, statically imported modules; never load modules from a request. */
export function registerModules<Logger extends FastifyBaseLogger>(
  app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>,
  modules: readonly BackendModule[],
): void {
  const ids = new Set<string>();
  for (const module of modules) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(module.id) || ids.has(module.id)) {
      throw new Error('Invalid or duplicate backend module ID');
    }
    ids.add(module.id);
  }
  // Validate every contribution before Fastify starts registering any routes.
  app.decorate('jarvisTools', createToolRegistry(modules));
  for (const module of modules) app.register(module.registerRoutes);
}

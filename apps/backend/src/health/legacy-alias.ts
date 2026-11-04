import type { FastifyInstance, RouteOptions } from 'fastify';

/**
 * Temporary alias for clients built before Daily was renamed to Health (iOS build 67 and earlier, installed Shortcuts).
 * Every /health/* route registered after this hook is also served at the same path under /daily/*, with identical
 * handlers, guards and limits. Remove this file and its single call in health/index.ts when the last build that
 * sends /daily requests is retired (see docs/decisions.md, "Daily renamed to Health").
 */
export const legacyDailyPrefix = '/daily/';
const healthPrefix = '/health/';

export function isLegacyDailyRequest(url: string | undefined): boolean {
  return url?.startsWith(legacyDailyPrefix) === true;
}

export function serveLegacyDailyAlias(app: FastifyInstance): void {
  app.addHook('onRoute', function (route: RouteOptions) {
    if (!route.url.startsWith(healthPrefix) || route.config?.jarvisHealthMcp || route.config?.jarvisHealthMcpMetadata) return;
    const methods = (Array.isArray(route.method) ? route.method : [route.method]).filter(method => method !== 'HEAD');
    if (methods.length === 0) return;
    this.route({ ...route, method: methods, url: legacyDailyPrefix + route.url.slice(healthPrefix.length) } as RouteOptions);
  });
}

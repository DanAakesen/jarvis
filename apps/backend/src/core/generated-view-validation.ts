import type { FastifyInstance } from 'fastify';

export function trustedBlobHostFromEnvironment(): string | undefined {
  const account = process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
  return account && /^[a-z0-9]{3,24}$/.test(account) ? `${account}.blob.core.windows.net` : undefined;
}

export function generatedViewValidationOptions(app: FastifyInstance) {
  const trustedBlobHost = trustedBlobHostFromEnvironment();
  return {
    ...(trustedBlobHost ? { trustedBlobHost } : {}),
    registeredTools: app.jarvisTools.list().map(({ name }) => name),
  };
}

/** Apple Maps data is resolved on the iPhone; only apple_maps creates the corresponding card. */
export function appleMapsGuidance(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  if ('operation' in input && input.operation === 'apple-maps') return 'Use apple_maps for a lookup on the iPhone.';
  const source = 'type' in input && input.type === 'view' && 'data' in input ? input.data : input;
  if (source && typeof source === 'object' && 'view' in source && source.view && typeof source.view === 'object' &&
      'renderer' in source.view && source.view.renderer === 'map') return 'Use apple_maps to show places and routes returned by the iPhone.';
  return undefined;
}

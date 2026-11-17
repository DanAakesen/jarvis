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

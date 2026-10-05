import type { FastifyInstance } from 'fastify';

export function generatedViewValidationOptions(app: FastifyInstance) {
  const account = process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
  const trustedBlobHost = account && /^[a-z0-9]{3,24}$/.test(account)
    ? `${account}.blob.core.windows.net`
    : undefined;
  return {
    ...(trustedBlobHost ? { trustedBlobHost } : {}),
    registeredTools: app.jarvisTools.list().map(({ name }) => name),
  };
}

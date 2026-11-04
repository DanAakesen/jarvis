import type { FastifyInstance } from 'fastify';
import { HealthCapabilityLifecycleError } from './capability-operation.js';
import type { SqlHealthCapabilities } from './sql-capabilities.js';

function denied(request: import('fastify').FastifyRequest, owner: string): boolean {
  const principal = request.principal;
  return !principal || 'kind' in principal || principal.objectId.toLowerCase() !== owner.toLowerCase();
}

function failureCode(error: unknown): number {
  return error instanceof HealthCapabilityLifecycleError
    ? error.code === 'invalid-input' ? 400 : error.code === 'conflict' ? 409 : 503
    : 503;
}

export async function registerHealthCapabilityRoutes(app: FastifyInstance,capabilities: SqlHealthCapabilities) {
  app.get('/api/health/upload-credential',async (request,reply) => {
    reply.header('Cache-Control','no-store');
    if (denied(request,app.ownerObjectId)) return reply.code(403).send({ error: 'Owner access required' });
    try { return await capabilities.status(AbortSignal.timeout(30000)); }
    catch { return reply.code(503).send({ error: 'Health credential status unavailable' }); }
  });
  app.post('/api/health/upload-credential',{
    schema: { body: { type: 'object',properties: { action: { type: 'string',enum: ['create','rotate','revoke'] } },required: ['action'],additionalProperties: false } },
  },async (request,reply) => {
    reply.header('Cache-Control','no-store');
    if (request.ownerSession) return reply.code(403).send({ error: 'Microsoft sign-in required' });
    if (denied(request,app.ownerObjectId)) return reply.code(403).send({ error: 'Owner access required' });
    const action = (request.body as { action: 'create' | 'rotate' | 'revoke' }).action;
    const signal = AbortSignal.timeout(30000);
    try {
      if (action === 'revoke') {
        const result = await capabilities.revokeCurrent(signal);
        return { state: result.state };
      }
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      const operation = capabilities.prepare({
        deviceId: 'health-auto-export',
        permissions: ['health-ingest','health-heartbeat'],
        expiresAt,
      });
      const result = action === 'create'
        ? await capabilities.create(operation,signal)
        : await capabilities.rotateCurrent(operation,signal);
      if (result.state !== 'issued') return reply.code(409).send({ error: 'Health credential changed' });
      const secret = await operation.useSecret(async token => token);
      return { state: action === 'create' ? 'created' : 'rotated',token: secret,expiresAt };
    } catch (error) {
      const status = failureCode(error);
      return reply.code(status).send({ error: status === 409 ? 'Health credential changed' : status === 400 ? 'Invalid request' : 'Health credential operation unavailable' });
    }
  });
}

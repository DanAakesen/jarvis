import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { AuthenticationDenied } from '../../auth/verify.js';
import { ToolFailure, ToolRefusal } from '../../core/tool-registry.js';
import { parseLiftCreate, parseLiftPatch } from '../lifts/lifts.js';
import type { LiftEntriesAccess } from '../lifts/lifts-store.js';
import { resolveHealthOwner } from '../owner.js';
import type { ApprovalModelPort } from '../../core/approval-interpreter.js';
import { createLiftCapture, LiftCaptureDeleted } from '../lifts/capture.js';

export function liftRoutes(access: LiftEntriesAccess, model?: ApprovalModelPort): FastifyPluginAsync {
  const capture = createLiftCapture(access, model);
  return async app => {
    const guard = async (request: FastifyRequest, reply: FastifyReply) => {
      resolveHealthOwner(request);
      if (request.agentPrincipal || request.healthConnectorPrincipal) throw new AuthenticationDenied(403);
      reply.header('Cache-Control', 'no-store');
      if (Object.keys(request.query as Record<string, unknown>).length) return reply.code(400).send({ error: 'Invalid lift request' });
    };
    const bounded = async <T>(request: FastifyRequest, reply: FastifyReply, work: (signal: AbortSignal) => Promise<T>) => {
      const controller = new AbortController();
      const cancel = () => { controller.abort(); };
      const disconnect = () => { if (!reply.raw.writableEnded) cancel(); };
      request.raw.once('aborted', cancel);
      reply.raw.once('close', disconnect);
      try { return await work(controller.signal); }
      catch (error) {
        if (error instanceof LiftCaptureDeleted) return reply.code(410).send({ error: error.message, code: 'lift_deleted' });
        if (error instanceof ToolRefusal) return reply.code(400).send({ error: error.message });
        if (error instanceof ToolFailure) return reply.code(503).send({ error: error.message });
        throw error;
      } finally {
        request.raw.off('aborted', cancel);
        reply.raw.off('close', disconnect);
      }
    };

    app.post('/health/lifts/capture', { bodyLimit: 16 * 1024, onRequest: guard }, async (request, reply) =>
      bounded(request, reply, signal => capture(request.body, request, signal)));

    app.post('/health/lifts', { bodyLimit: 1024, onRequest: guard }, async (request, reply) => {
      const parsed = parseLiftCreate(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => {
        const result = await access(request).create(parsed.value, signal);
        return reply.code(result.replayed ? 200 : 201).send(result);
      });
    });

    app.patch('/health/lifts/:id', { bodyLimit: 1024, onRequest: guard }, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(id)) return reply.code(400).send({ error: 'Invalid lift id' });
      const parsed = parseLiftPatch(request.body);
      if (!parsed.ok) return reply.code(400).send({ error: parsed.reason });
      return bounded(request, reply, async signal => {
        const entry = await access(request).update(id, parsed.patch, signal);
        return entry ? { entry } : reply.code(404).send({ error: 'Lift entry not found.' });
      });
    });

    app.delete('/health/lifts/:id', { onRequest: guard }, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/iu.test(id)) return reply.code(400).send({ error: 'Invalid lift id' });
      return bounded(request, reply, async signal => {
        const entry = await access(request).delete(id, signal);
        return entry ? { entry } : reply.code(404).send({ error: 'Lift entry not found.' });
      });
    });
  };
}

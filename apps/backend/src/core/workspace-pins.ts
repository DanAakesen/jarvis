import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  isGeneratedView,
  isWorkspacePin,
  workspacePinPutSchema,
  workspacePinResponseSchema,
  workspacePinsResponseSchema,
  workspaceViewIdSchema,
  type GeneratedView,
  type WorkspacePinsResponse,
} from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { WorkspacePinLimitExceeded, type WorkspacePinStore } from '../database/workspace-pin-store.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';

function requestLifecycle(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
  request.raw.once('aborted', abortOnRequest);
  reply.raw.once('close', abortOnClose);
  return {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
    dispose: () => {
      request.raw.removeListener('aborted', abortOnRequest);
      reply.raw.removeListener('close', abortOnClose);
    },
  };
}

function isOwner(request: FastifyRequest, app: FastifyInstance): boolean {
  return request.principal?.objectId.toLowerCase() === app.ownerObjectId.toLowerCase();
}

export function createWorkspacePinsModule(store: WorkspacePinStore): BackendModule {
  return {
    id: 'workspace-pins',
    tools: [],
    registerRoutes: async (app) => {
      app.get<{ Reply: {
        200: WorkspacePinsResponse;
        403: { error: string };
        499: { error: string };
        503: { error: string };
      } }>('/workspace/pins', {
        schema: { response: { 200: workspacePinsResponseSchema } },
      }, async (request, reply) => {
        if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          const pins = await store.list(app.ownerObjectId, lifecycle.signal);
          const options = generatedViewValidationOptions(app);
          if (pins.length > 20 || !pins.every((pin) => isWorkspacePin(pin, options))) {
            throw new Error('Stored workspace pins are invalid');
          }
          reply.header('Cache-Control', 'private, no-store');
          return { pins };
        } catch {
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_pins.list_failed');
          return reply.code(503).send({ error: 'Workspace pins are unavailable' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.put<{ Params: { viewId: string }; Body: { view: GeneratedView } }>('/workspace/pins/:viewId', {
        bodyLimit: 257 * 1024,
        schema: {
          params: {
            type: 'object',
            properties: { viewId: workspaceViewIdSchema },
            required: ['viewId'],
            additionalProperties: false,
          },
          body: workspacePinPutSchema,
          response: { 200: workspacePinResponseSchema },
        },
      }, async (request, reply) => {
        if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
        if (!isGeneratedView(request.body.view, generatedViewValidationOptions(app))) {
          return reply.code(400).send({ error: 'Invalid workspace view' });
        }
        const lifecycle = requestLifecycle(request, reply);
        try {
          const pin = await store.pin(app.ownerObjectId, request.params.viewId, request.body.view, lifecycle.signal);
          reply.header('Cache-Control', 'private, no-store');
          return { pin };
        } catch (error) {
          if (error instanceof WorkspacePinLimitExceeded) return reply.code(409).send({ error: 'Workspace pin limit reached' });
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_pins.pin_failed');
          return reply.code(503).send({ error: 'Workspace pin could not be saved' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.delete<{ Params: { viewId: string } }>('/workspace/pins/:viewId', {
        schema: {
          params: {
            type: 'object',
            properties: { viewId: workspaceViewIdSchema },
            required: ['viewId'],
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!isOwner(request, app)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          if (!await store.unpin(app.ownerObjectId, request.params.viewId, lifecycle.signal)) {
            return reply.code(404).send({ error: 'Workspace pin was not found' });
          }
          return reply.code(204).send();
        } catch {
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_pins.unpin_failed');
          return reply.code(503).send({ error: 'Workspace pin could not be removed' });
        } finally {
          lifecycle.dispose();
        }
      });
    },
  };
}

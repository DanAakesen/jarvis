import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WorkspaceArtifactNotFound } from '../database/workspace-artifact-store.js';

const artifactIdPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

function cancelledRequest(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
  request.raw.once('aborted', abortOnRequest);
  reply.raw.once('close', abortOnClose);
  return {
    signal: controller.signal,
    removeListeners: () => {
      request.raw.removeListener('aborted', abortOnRequest);
      reply.raw.removeListener('close', abortOnClose);
    },
  };
}

export function registerWorkspaceHtmlArtifactRoutes(app: FastifyInstance): void {
  app.get('/factory/workspace-artifacts/html', async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.workspaceArtifacts) return reply.code(503).send({ error: 'Workspace artifacts are unavailable' });
    const cancellation = cancelledRequest(request, reply);
    try {
      const artifacts = await app.workspaceArtifacts.listPinnedHtml(request.principal.objectId, cancellation.signal);
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return { artifacts };
    } catch {
      if (cancellation.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
      request.log.warn('workspace_artifact.html_list_failed');
      return reply.code(503).send({ error: 'Workspace artifacts are unavailable' });
    } finally {
      cancellation.removeListeners();
    }
  });

  app.get<{ Params: { artifactId: string } }>('/factory/workspace-artifacts/html/:artifactId', {
    schema: {
      params: {
        type: 'object',
        properties: { artifactId: { type: 'string', pattern: artifactIdPattern } },
        required: ['artifactId'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.workspaceArtifacts) return reply.code(503).send({ error: 'Workspace artifacts are unavailable' });
    const cancellation = cancelledRequest(request, reply);
    try {
      const artifact = await app.workspaceArtifacts.getHtml(
        request.params.artifactId,
        request.principal.objectId,
        cancellation.signal,
      );
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      return artifact;
    } catch (error) {
      if (error instanceof WorkspaceArtifactNotFound) return reply.code(404).send({ error: 'Workspace artifact was not found' });
      if (cancellation.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
      request.log.warn('workspace_artifact.html_read_failed');
      return reply.code(503).send({ error: 'Workspace artifact is unavailable' });
    } finally {
      cancellation.removeListeners();
    }
  });

  app.post<{ Params: { artifactId: string } }>('/factory/workspace-artifacts/html/:artifactId/pin', {
    schema: {
      params: {
        type: 'object',
        properties: { artifactId: { type: 'string', pattern: artifactIdPattern } },
        required: ['artifactId'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.workspaceArtifacts) return reply.code(503).send({ error: 'Workspace artifacts are unavailable' });
    const cancellation = cancelledRequest(request, reply);
    try {
      const artifact = await app.workspaceArtifacts.pinHtml(
        request.params.artifactId,
        request.principal.objectId,
        cancellation.signal,
      );
      reply.header('Cache-Control', 'private, no-store');
      return { artifact: { id: artifact.id, kind: artifact.kind, title: artifact.title, sources: artifact.sources,
        createdAt: artifact.createdAt, pinned: artifact.pinned } };
    } catch (error) {
      if (error instanceof WorkspaceArtifactNotFound) return reply.code(404).send({ error: 'Workspace artifact was not found' });
      if (cancellation.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
      request.log.warn('workspace_artifact.html_pin_failed');
      return reply.code(503).send({ error: 'Workspace artifact could not be pinned' });
    } finally {
      cancellation.removeListeners();
    }
  });

  app.delete<{ Params: { artifactId: string } }>('/factory/workspace-artifacts/html/:artifactId/pin', {
    schema: {
      params: {
        type: 'object',
        properties: { artifactId: { type: 'string', pattern: artifactIdPattern } },
        required: ['artifactId'],
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    if (!app.workspaceArtifacts) return reply.code(503).send({ error: 'Workspace artifacts are unavailable' });
    const cancellation = cancelledRequest(request, reply);
    try {
      await app.workspaceArtifacts.unpinHtml(
        request.params.artifactId,
        request.principal.objectId,
        cancellation.signal,
      );
      reply.header('Cache-Control', 'private, no-store');
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof WorkspaceArtifactNotFound) return reply.code(404).send({ error: 'Workspace artifact was not found' });
      if (cancellation.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
      request.log.warn('workspace_artifact.html_unpin_failed');
      return reply.code(503).send({ error: 'Workspace artifact could not be unpinned' });
    } finally {
      cancellation.removeListeners();
    }
  });
}

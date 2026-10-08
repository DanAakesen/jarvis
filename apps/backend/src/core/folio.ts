import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  folioDeleteSchema,
  folioItemSchema,
  folioOpenToolSchema,
  folioPatchSchema,
  folioSearchResponseSchema,
  folioSearchSchema,
  folioSearchToolSchema,
  isWorkspaceCommand,
  type FolioItem,
  type FolioPatch,
  type FolioSearch,
} from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import { FolioItemNotFound, FolioStore } from '../database/folio-store.js';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import { WorkspaceArtifactNotFound } from '../database/workspace-artifact-store.js';
import {
  WorkspaceHtmlArtifactNotFound,
  WorkspaceHtmlArtifactStore,
} from '../database/workspace-html-artifact-store.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './tool-registry.js';

const itemIdPattern = '^(?:research|html_app|image|knowledge_graph):[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function graphView(item: FolioItem, payload: { query: string; highlight: readonly string[] }) {
  return {
    version: 1 as const,
    title: item.title,
    renderer: 'knowledge-graph' as const,
    source: { id: 'knowledge_graph' as const, status: 'complete' as const, updatedAt: item.createdAt },
    data: { query: payload.query, highlight: [...payload.highlight] },
  };
}

function viewId(item: FolioItem, sourceId: string): string {
  if (item.kind === 'knowledge_graph') return `knowledge-graph-${sourceId.replaceAll('-', '')}`;
  return `${item.kind === 'image' ? 'image' : 'html'}-${sourceId.replaceAll('-', '')}`;
}

async function openItem(
  store: FolioStore,
  htmlArtifacts: WorkspaceHtmlArtifactStore,
  imageArtifacts: WorkspaceArtifactStore | undefined,
  request: FastifyRequest,
  id: string,
  signal: AbortSignal,
): Promise<FolioItem> {
  const ownerObjectId = request.server.ownerObjectId;
  const { item, sourceId, payload } = await store.get(ownerObjectId, id, signal);
  let view: Record<string, unknown>;
  if (item.kind === 'research' || item.kind === 'html_app') {
    await htmlArtifacts.read(sourceId, ownerObjectId, signal);
    view = {
      version: 1,
      title: item.title,
      renderer: 'html-app',
      source: { id: 'html_generation', status: 'complete', updatedAt: item.createdAt },
      data: { artifactId: sourceId },
      actions: [],
    };
  } else if (item.kind === 'image') {
    if (!imageArtifacts) throw new ToolFailure('Generated images are unavailable.');
    const url = await imageArtifacts.readUrl(sourceId, ownerObjectId, signal);
    view = {
      version: 1,
      title: item.title,
      renderer: 'image',
      source: { id: 'image_generation', status: 'complete', updatedAt: item.createdAt, reason: '' },
      data: { images: [{ url, alt: item.promptSummary }] },
      actions: [],
    };
  } else {
    if (!payload) throw new ToolFailure('The saved knowledge graph view is unavailable.');
    view = graphView(item, payload);
  }

  const activeViewId = viewId(item, sourceId);
  const existing = request.server.workspaceCommands.snapshot(ownerObjectId)
    ?.windows.some((window) => window.viewId === activeViewId) ?? false;
  const command = {
    commandId: randomUUID(),
    operation: existing ? 'update' as const : 'create' as const,
    viewId: activeViewId,
    view,
  };
  if (!isWorkspaceCommand(command, generatedViewValidationOptions(request.server))) {
    throw new ToolFailure('The saved Folio item could not be opened.');
  }
  await request.server.workspaceCommands.execute(ownerObjectId, command, signal);
  await request.server.workspaceCommands.execute(ownerObjectId, {
    commandId: randomUUID(),
    operation: 'focus',
    viewId: activeViewId,
  }, signal);
  return item;
}

function folioTools(
  store: FolioStore,
  htmlArtifacts: WorkspaceHtmlArtifactStore,
  imageArtifacts?: WorkspaceArtifactStore,
): JarvisTool[] {
  const authorizeTool = (request: FastifyRequest) => {
    if (request.agentPrincipal) return;
    if (request.principal?.objectId.toLowerCase() === request.server.ownerObjectId.toLowerCase()) return;
    throw new ToolRefusal('Folio access is not authorized.');
  };
  return [
    {
      name: 'folio_search',
      description: 'Search saved research reports, HTML apps, generated images, and knowledge graph views in the Folio.',
      inputSchema: folioSearchToolSchema,
      sensitive: true,
      async execute(input, request, signal) {
        authorizeTool(request);
        const filters = isObject(input) ? input as FolioSearch : {};
        const items = await store.search(request.server.ownerObjectId, filters, signal);
        return { items };
      },
    },
    {
      name: 'folio_open',
      description: 'Reopen a saved Folio item by id or a unique search phrase, such as “Ignite research”.',
      inputSchema: folioOpenToolSchema,
      sensitive: true,
      async execute(input, request, signal) {
        authorizeTool(request);
        if (!isObject(input)) throw new ToolRefusal('Choose a Folio item to open.');
        let id = input.id;
        if (id === undefined && typeof input.query === 'string') {
          const items = await store.search(request.server.ownerObjectId, { q: input.query }, signal);
          if (items.length === 0) throw new ToolRefusal('No Folio item matched that search.');
          if (items.length > 1) {
            throw new ToolRefusal(`Several Folio items match: ${items.slice(0, 5).map((item) => item.title).join('; ')}.`);
          }
          id = items[0]!.id;
        }
        if (typeof id !== 'string' || !new RegExp(itemIdPattern, 'u').test(id)) {
          throw new ToolRefusal('A valid Folio item id or search phrase is required.');
        }
        const item = await openItem(store, htmlArtifacts, imageArtifacts, request, id, signal);
        return { id: item.id, title: item.title, kind: item.kind, opened: true };
      },
    },
  ];
}

export function createFolioModule(
  store: FolioStore,
  htmlArtifacts: WorkspaceHtmlArtifactStore,
  imageArtifacts?: WorkspaceArtifactStore,
): BackendModule {
  return {
    id: 'folio',
    tools: folioTools(store, htmlArtifacts, imageArtifacts),
    registerRoutes: async (app: FastifyInstance) => {
      const isOwner = (request: FastifyRequest) =>
        request.principal?.objectId.toLowerCase() === app.ownerObjectId.toLowerCase();

      app.get<{ Querystring: FolioSearch }>('/folio', {
        schema: { querystring: folioSearchSchema, response: { 200: folioSearchResponseSchema } },
      }, async (request, reply) => {
        if (!isOwner(request)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          reply.header('Cache-Control', 'private, no-store');
          return { items: await store.search(app.ownerObjectId, request.query, lifecycle.signal) };
        } catch (error) {
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('folio.search_failed');
          return reply.code(503).send({ error: 'Folio is unavailable' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.post<{ Params: { id: string }; Body: Record<string, never> }>('/folio/:id/open', {
        schema: {
          params: {
            type: 'object', properties: { id: { type: 'string', pattern: itemIdPattern } },
            required: ['id'], additionalProperties: false,
          },
          body: { type: 'object', properties: {}, additionalProperties: false },
          response: { 200: folioItemSchema },
        },
      }, async (request, reply) => {
        if (!isOwner(request)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          const item = await openItem(store, htmlArtifacts, imageArtifacts, request, request.params.id, lifecycle.signal);
          reply.header('Cache-Control', 'no-store');
          return item;
        } catch (error) {
          if (error instanceof FolioItemNotFound || error instanceof WorkspaceHtmlArtifactNotFound ||
              error instanceof WorkspaceArtifactNotFound) return reply.code(404).send({ error: 'Folio item was not found' });
          if (error instanceof ToolRefusal) return reply.code(409).send({ error: error.message });
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('folio.open_failed');
          return reply.code(503).send({ error: 'Folio item could not be opened' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.patch<{ Params: { id: string }; Body: FolioPatch }>('/folio/:id', {
        schema: {
          params: {
            type: 'object', properties: { id: { type: 'string', pattern: itemIdPattern } },
            required: ['id'], additionalProperties: false,
          },
          body: folioPatchSchema,
          response: { 200: folioItemSchema },
        },
      }, async (request, reply) => {
        if (!isOwner(request)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          const item = await store.update(app.ownerObjectId, request.params.id, request.body, lifecycle.signal);
          reply.header('Cache-Control', 'no-store');
          return item;
        } catch (error) {
          if (error instanceof FolioItemNotFound) return reply.code(404).send({ error: 'Folio item was not found' });
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('folio.update_failed');
          return reply.code(503).send({ error: 'Folio item could not be updated' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.delete<{ Params: { id: string }; Body: { confirm: true } }>('/folio/:id', {
        schema: {
          params: {
            type: 'object', properties: { id: { type: 'string', pattern: itemIdPattern } },
            required: ['id'], additionalProperties: false,
          },
          body: folioDeleteSchema,
          response: { 200: { type: 'object', properties: { deleted: { const: true } }, required: ['deleted'], additionalProperties: false } },
        },
      }, async (request, reply) => {
        if (!isOwner(request)) return reply.code(403).send({ error: 'Forbidden' });
        const lifecycle = requestLifecycle(request, reply);
        try {
          await store.delete(app.ownerObjectId, request.params.id, lifecycle.signal);
          reply.header('Cache-Control', 'no-store');
          return { deleted: true as const };
        } catch (error) {
          if (error instanceof FolioItemNotFound) return reply.code(404).send({ error: 'Folio item was not found' });
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('folio.delete_failed');
          return reply.code(503).send({ error: 'Folio item could not be removed' });
        } finally {
          lifecycle.dispose();
        }
      });
    },
  };
}

export const folioSchemas = {
  item: folioItemSchema,
  search: folioSearchSchema,
  searchResponse: folioSearchResponseSchema,
  patch: folioPatchSchema,
  delete: folioDeleteSchema,
};

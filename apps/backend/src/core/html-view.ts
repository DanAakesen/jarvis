import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isWorkspaceCommand, type WorkspaceCommand } from '@jarvis/contracts';
import type { BackendModule } from '../modules.js';
import {
  WorkspaceHtmlArtifactNotFound,
  WorkspaceHtmlArtifactStore,
  type WorkspaceHtmlSource,
} from '../database/workspace-html-artifact-store.js';
import type { FolioStore } from '../database/folio-store.js';
import { validateHtmlApp } from './html-artifact-validation.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const maxHtmlCharacters = 512 * 1024;
const maxToolBodyBytes = 2 * 1024 * 1024;
const artifactIdPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const idSchema = { type: 'string', pattern: artifactIdPattern };
const createHtmlViewSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    html: { type: 'string', minLength: 1, maxLength: maxHtmlCharacters },
    sources: {
      type: 'array',
      maxItems: 50,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          url: { type: 'string', format: 'uri', maxLength: 2_048, pattern: '^https://' },
        },
        required: ['title', 'url'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'html', 'sources'],
  additionalProperties: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2_048 || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function requestController(request: { raw: { once: (event: string, listener: () => void) => void; removeListener: (event: string, listener: () => void) => void } },
  reply: { raw: { writableEnded: boolean; once: (event: string, listener: () => void) => void; removeListener: (event: string, listener: () => void) => void } }) {
  const controller = new AbortController();
  const abortOnRequest = () => controller.abort();
  const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
  request.raw.once('aborted', abortOnRequest);
  reply.raw.once('close', abortOnClose);
  return {
    signal: controller.signal,
    dispose: () => {
      request.raw.removeListener('aborted', abortOnRequest);
      reply.raw.removeListener('close', abortOnClose);
    },
  };
}

function htmlView(artifactId: string, title: string) {
  return {
    version: 1 as const,
    title,
    renderer: 'html-app' as const,
    source: { id: 'html_generation' as const, status: 'complete' as const, updatedAt: new Date().toISOString() },
    data: { artifactId },
    actions: [],
  };
}

function createHtmlViewTool(
  artifacts: WorkspaceHtmlArtifactStore,
  folio?: FolioStore,
): BackendModule['tools'][number] {
  return {
    name: 'create_html_view',
    description: 'Create a self-contained HTML/JavaScript app in the active workspace sandbox for richer visuals. Keep it within 512 KB and include up to 50 HTTPS sources used. The sandbox allows inline scripts and styles, img-src data: https:, and connect-src \'none\'; do not use external libraries, scripts, stylesheets or fetches. Draw charts or timelines with hand-written inline SVG or canvas.',
    inputSchema: createHtmlViewSchema,
    bodyLimit: maxToolBodyBytes,
    sensitive: true,
    async execute(input, request, signal) {
      if (!request.agentPrincipal) throw new ToolRefusal('Only Jarvis can create HTML workspace apps.');
      if (!isObject(input) || Object.keys(input).length !== 3 ||
          !validateHtmlApp(input.title, input.html, input.sources)) {
        throw new ToolRefusal('The HTML app must be a valid HTML document, at most 512 KB, with up to 50 HTTPS sources and no base element or script src.');
      }
      const ownerId = request.server.ownerObjectId;
      if (!request.server.workspaceCommands.isConnected(ownerId)) {
        throw new ToolRefusal('Open the signed-in conversation workspace before creating an HTML app.');
      }
      const artifact = await artifacts.create(
        ownerId,
        input.title as string,
        input.html,
        input.sources as WorkspaceHtmlSource[],
        signal,
      );
      await folio?.record(ownerId, {
        id: `html_app:${artifact.id}`,
        kind: 'html_app',
        sourceId: artifact.id,
        title: artifact.title,
        promptSummary: artifact.title,
        createdAt: artifact.createdAt,
      }, signal);
      const command: WorkspaceCommand = {
        commandId: randomUUID(),
        operation: 'create',
        viewId: `html-${artifact.id.replaceAll('-', '')}`,
        view: htmlView(artifact.id, artifact.title),
      };
      if (!isWorkspaceCommand(command)) {
        throw new ToolFailure(`HTML app ${artifact.id} was saved, but its workspace view was invalid.`);
      }
      try {
        await request.server.workspaceCommands.execute(ownerId, command, signal);
      } catch {
        throw new ToolFailure(`HTML app ${artifact.id} was saved, but the active workspace could not display it.`);
      }
      return { artifactId: artifact.id, confirmation: 'HTML app opened in the sandboxed workspace.' };
    },
  };
}

export function createHtmlViewModule(artifacts: WorkspaceHtmlArtifactStore, folio?: FolioStore): BackendModule {
  return {
    id: 'html-view',
    tools: [createHtmlViewTool(artifacts, folio)],
    registerRoutes: async (app: FastifyInstance) => {
      app.get<{ Params: { artifactId: string } }>('/factory/workspace-artifacts/html/:artifactId', {
        schema: {
          params: {
            type: 'object', properties: { artifactId: idSchema },
            required: ['artifactId'], additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
          return reply.code(404).send({ error: 'Workspace HTML artifact was not found' });
        }
        const lifecycle = requestController(request, reply);
        try {
          const artifact = await artifacts.read(request.params.artifactId, request.principal.objectId, lifecycle.signal);
          reply.header('Cache-Control', 'private, no-store')
            .header('Referrer-Policy', 'no-referrer')
            .header('X-Content-Type-Options', 'nosniff');
          return artifact;
        } catch (error) {
          if (error instanceof WorkspaceHtmlArtifactNotFound) {
            return reply.code(404).send({ error: 'Workspace HTML artifact was not found' });
          }
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_artifact.html_read_failed');
          return reply.code(503).send({ error: 'Workspace HTML artifact is unavailable' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.patch<{
        Params: { artifactId: string };
        Body: { pinned: boolean };
      }>('/factory/workspace-artifacts/html/:artifactId', {
        schema: {
          params: {
            type: 'object', properties: { artifactId: idSchema },
            required: ['artifactId'], additionalProperties: false,
          },
          body: {
            type: 'object',
            properties: { pinned: { type: 'boolean' } },
            required: ['pinned'], additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
          return reply.code(404).send({ error: 'Workspace HTML artifact was not found' });
        }
        const lifecycle = requestController(request, reply);
        try {
          const pinned = await artifacts.setPinned(
            request.params.artifactId, request.principal.objectId, request.body.pinned, lifecycle.signal,
          );
          reply.header('Cache-Control', 'private, no-store');
          return { pinned };
        } catch (error) {
          if (error instanceof WorkspaceHtmlArtifactNotFound) {
            return reply.code(404).send({ error: 'Workspace HTML artifact was not found' });
          }
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_artifact.html_pin_failed');
          return reply.code(503).send({ error: 'Workspace HTML artifact could not be updated' });
        } finally {
          lifecycle.dispose();
        }
      });

      app.post<{ Body: { url: string } }>('/factory/workspace-artifacts/html/open-url', {
        schema: {
          body: {
            type: 'object',
            properties: { url: { type: 'string', format: 'uri', maxLength: 2_048, pattern: '^https://' } },
            required: ['url'],
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!request.principal || request.principal.objectId.toLowerCase() !== app.ownerObjectId.toLowerCase()) {
          return reply.code(403).send({ error: 'Forbidden' });
        }
        if (!safeHttpsUrl(request.body.url)) return reply.code(400).send({ error: 'Invalid URL' });
        const pcOpen = app.jarvisTools.get('pc_open');
        if (!pcOpen) return reply.code(503).send({ error: 'Chrome opening is unavailable' });
        const lifecycle = requestController(request, reply);
        try {
          await pcOpen.execute({ target: 'url', value: request.body.url }, request, lifecycle.signal);
          reply.header('Cache-Control', 'no-store');
          return { opened: true };
        } catch {
          if (lifecycle.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_artifact.html_open_url_failed');
          return reply.code(503).send({ error: 'Chrome could not open the URL' });
        } finally {
          lifecycle.dispose();
        }
      });
    },
  };
}

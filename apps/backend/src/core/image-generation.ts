import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { isWorkspaceCommand, type WorkspaceCommand } from '@jarvis/contracts';
import type {
  CodexToolRequest,
  InvocationAccepted,
  InvocationSnapshot,
  RequestOptions,
} from '../foundry/client.js';
import { FoundryClientError } from '../foundry/client.js';
import type { BackendModule } from '../modules.js';
import {
  WorkspaceArtifactNotFound,
  workspaceImageSizeLimit,
  type WorkspaceArtifactStore,
} from '../database/workspace-artifact-store.js';
import type { FolioStore } from '../database/folio-store.js';
import { generatedViewValidationOptions } from './generated-view-validation.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const promptLengthLimit = 4096;
const uploadBodyLimit = 7_100_000;
const maxStatusRetries = 2;
const statusRetryDelayMs = 250;
const jobTimeoutMs = 270_000;
const pollIntervalMs = 1_000;
const inputSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', minLength: 1, maxLength: promptLengthLimit, pattern: '\\S' },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const;

interface CodexToolRunner {
  startCodexTool(request: CodexToolRequest, options?: RequestOptions): Promise<InvocationAccepted>;
  status(invocationId: string, options?: RequestOptions): Promise<InvocationSnapshot>;
  cancel(invocationId: string, options?: RequestOptions): Promise<unknown>;
  deleteSession(sessionId: string, options?: RequestOptions): Promise<void>;
}

export interface ImageGenerationOptions {
  readonly runner: CodexToolRunner;
  readonly artifacts: WorkspaceArtifactStore;
  readonly model: string;
  readonly folio?: FolioStore;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

interface UploadBody {
  uploadKey: string;
  contentType: string;
  image: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validArtifactResult(value: unknown, expectedId: string): value is {
  artifact_id: string;
  content_type: 'image/png' | 'image/jpeg';
  size_bytes: number;
} {
  return record(value) && value.artifact_id === expectedId &&
    (value.content_type === 'image/png' || value.content_type === 'image/jpeg') &&
    Number.isSafeInteger(value.size_bytes) && (value.size_bytes as number) > 0 &&
    (value.size_bytes as number) <= workspaceImageSizeLimit;
}

function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new FoundryClientError('aborted', 'codex-tool-status'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new FoundryClientError('aborted', 'codex-tool-status'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function retryableStatusError(error: unknown): boolean {
  return error instanceof FoundryClientError &&
    (error.kind === 'timeout' || error.kind === 'transport' ||
      error.kind === 'http' && (error.statusCode === 429 || (error.statusCode ?? 0) >= 500));
}

async function getStatus(
  runner: CodexToolRunner,
  invocationId: string,
  signal: AbortSignal,
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>,
): Promise<InvocationSnapshot> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runner.status(invocationId, { signal });
    } catch (error) {
      if (attempt >= maxStatusRetries || !retryableStatusError(error)) throw error;
      await wait(statusRetryDelayMs * (2 ** attempt), signal);
    }
  }
}

async function waitForJob(
  runner: CodexToolRunner,
  invocationId: string,
  signal: AbortSignal,
  timeoutAt: number,
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>,
  intervalMs: number,
): Promise<InvocationSnapshot> {
  for (;;) {
    signal.throwIfAborted();
    if (Date.now() >= timeoutAt) throw new ToolFailure('Image generation timed out.');
    const snapshot = await getStatus(runner, invocationId, signal, wait);
    if (['completed', 'failed', 'cancelled'].includes(snapshot.status)) return snapshot;
    const remaining = timeoutAt - Date.now();
    await wait(Math.min(intervalMs, remaining), signal);
  }
}

function imageView(url: string, at: string) {
  return {
    version: 1 as const,
    title: 'Generated image',
    renderer: 'image' as const,
    source: { id: 'image_generation' as const, status: 'complete' as const, updatedAt: at, reason: '' },
    data: { images: [{ url, alt: 'Generated image' }] },
    actions: [],
  };
}

function imageTool(options: ImageGenerationOptions): BackendModule['tools'][number] {
  const wait = options.wait ?? defaultWait;
  const timeoutMs = options.timeoutMs ?? jobTimeoutMs;
  const pollEveryMs = options.pollIntervalMs ?? pollIntervalMs;
  return {
    name: 'image_generation',
    description: 'Generate one image from Dan’s description using his ChatGPT/Codex subscription and open it in the active workspace.',
    inputSchema,
    sensitive: true,
    async execute(input, request, requestSignal) {
      if (!request.agentPrincipal) throw new ToolRefusal('Only Jarvis can generate images.');
      if (!record(input) || Object.keys(input).length !== 1 || typeof input.prompt !== 'string' ||
          !input.prompt.trim() || input.prompt.length > promptLengthLimit) {
        throw new ToolRefusal('The image prompt must contain 1–4096 characters.');
      }
      const ownerObjectId = request.server.ownerObjectId;
      if (!request.server.workspaceCommands.isConnected(ownerObjectId)) {
        throw new ToolRefusal('Open the signed-in conversation workspace before generating an image.');
      }

      const upload = options.artifacts.registerUpload(ownerObjectId);
      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = AbortSignal.any([requestSignal, timeoutController.signal]);
      let accepted: InvocationAccepted | undefined;
      let runnerFinished = false;
      try {
        accepted = await options.runner.startCodexTool({
          task: input.prompt,
          model: options.model,
          artifactUploadKey: upload.uploadKey,
        }, { signal });
        const completed = await waitForJob(
          options.runner,
          accepted.invocationId,
          signal,
          Date.now() + timeoutMs,
          wait,
          pollEveryMs,
        );
        runnerFinished = true;
        if (completed.status === 'failed') {
          if (completed.error === 'Codex usage limit reached') {
            throw new ToolFailure('Codex usage limit reached.');
          }
          throw new ToolFailure('Codex image generation failed. No image was saved.');
        }
        if (completed.status === 'cancelled') {
          throw new ToolFailure('Image generation was cancelled. No image was saved.');
        }
        if (!validArtifactResult(completed.result, upload.artifactId)) {
          throw new ToolFailure('Codex did not return a valid saved image artifact.');
        }
        const promptSummary = input.prompt.replace(/\s+/gu, ' ').trim();
        await options.folio?.record(ownerObjectId, {
          id: `image:${upload.artifactId}`,
          kind: 'image',
          sourceId: upload.artifactId,
          title: Array.from(promptSummary).slice(0, 200).join('') || 'Generated image',
          promptSummary: Array.from(promptSummary).slice(0, 500).join('') || 'Generated image',
          createdAt: new Date().toISOString(),
        }, signal);
        const url = await options.artifacts.readUrl(upload.artifactId, ownerObjectId, signal);
        const view = imageView(url, new Date().toISOString());
        const command: WorkspaceCommand = {
          commandId: randomUUID(),
          operation: 'create',
          viewId: `image-${upload.artifactId.replaceAll('-', '')}`,
          view,
        };
        if (!isWorkspaceCommand(command, generatedViewValidationOptions(request.server))) {
          throw new ToolFailure(`Image artifact ${upload.artifactId} was saved, but its workspace view was invalid.`);
        }
        try {
          await request.server.workspaceCommands.execute(ownerObjectId, command, signal);
        } catch {
          throw new ToolFailure(
            `Image artifact ${upload.artifactId} was saved, but the active workspace could not display it.`,
          );
        }
        return {
          artifactId: upload.artifactId,
          confirmation: `Generated image opened in the workspace. Artifact ID: ${upload.artifactId}.`,
        };
      } catch (error) {
        if (requestSignal.aborted) throw new ToolFailure('Image generation was cancelled.');
        if (timeoutController.signal.aborted) throw new ToolFailure('Image generation timed out.');
        if (error instanceof ToolFailure || error instanceof ToolRefusal) throw error;
        throw new ToolFailure('Image generation failed before an artifact could be shown.');
      } finally {
        clearTimeout(timeout);
        if (accepted) {
          if (!runnerFinished) {
            try {
              await options.runner.cancel(accepted.invocationId);
            } catch {
              request.log.warn('codex.image_cancel_failed');
            }
          }
          try {
            await options.runner.deleteSession(accepted.sessionId);
          } catch {
            request.log.warn('codex.image_session_cleanup_failed');
          }
        }
        options.artifacts.releaseUpload(upload.uploadKey);
      }
    },
  };
}

export function createImageGenerationModule(options: ImageGenerationOptions & {
  readonly artifacts: WorkspaceArtifactStore;
}): BackendModule {
  return {
    id: 'image-generation',
    tools: [imageTool(options)],
    registerRoutes: async (app: FastifyInstance) => {
      app.post<{ Body: UploadBody }>('/factory/workspace-artifacts/images', {
        config: { jarvisRunner: true },
        bodyLimit: uploadBodyLimit,
        schema: {
          body: {
            type: 'object',
            properties: {
              uploadKey: { type: 'string', minLength: 43, maxLength: 43, pattern: '^[A-Za-z0-9_-]{43}$' },
              contentType: { type: 'string', enum: ['image/png', 'image/jpeg'] },
              image: {
                type: 'string',
                minLength: 4,
                maxLength: Math.ceil(workspaceImageSizeLimit / 3) * 4,
                pattern: '^[A-Za-z0-9+/]+={0,2}$',
              },
            },
            required: ['uploadKey', 'contentType', 'image'],
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!request.runnerPrincipal) return reply.code(403).send({ error: 'Forbidden' });
        const bytes = Buffer.from(request.body.image, 'base64');
        if (bytes.toString('base64') !== request.body.image) {
          return reply.code(400).send({ error: 'Invalid image data' });
        }
        const controller = new AbortController();
        const abortOnRequest = () => controller.abort();
        const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
        request.raw.once('aborted', abortOnRequest);
        reply.raw.once('close', abortOnClose);
        try {
          const artifactId = await options.artifacts.upload(
            request.body.uploadKey,
            request.body.contentType,
            bytes,
            controller.signal,
          );
          reply.header('Cache-Control', 'no-store');
          return { artifactId };
        } catch {
          request.log.warn('workspace_artifact.image_upload_failed');
          return reply.code(503).send({ error: 'Workspace image upload failed' });
        } finally {
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
      });
      app.get<{ Params: { artifactId: string } }>('/factory/workspace-artifacts/images/:artifactId', {
        schema: {
          params: {
            type: 'object',
            properties: {
              artifactId: {
                type: 'string',
                pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
              },
            },
            required: ['artifactId'],
            additionalProperties: false,
          },
        },
      }, async (request, reply) => {
        if (!request.principal) return reply.code(403).send({ error: 'Forbidden' });
        const controller = new AbortController();
        const abortOnRequest = () => controller.abort();
        const abortOnClose = () => { if (!reply.raw.writableEnded) controller.abort(); };
        request.raw.once('aborted', abortOnRequest);
        reply.raw.once('close', abortOnClose);
        try {
          const url = await options.artifacts.readUrl(
            request.params.artifactId,
            request.principal.objectId,
            controller.signal,
          );
          reply.header('Cache-Control', 'private, no-store');
          reply.header('Referrer-Policy', 'no-referrer');
          return { url };
        } catch (error) {
          if (error instanceof WorkspaceArtifactNotFound) {
            return reply.code(404).send({ error: 'Workspace image was not found' });
          }
          if (controller.signal.aborted) return reply.code(499).send({ error: 'Request cancelled' });
          request.log.warn('workspace_artifact.image_read_failed');
          return reply.code(503).send({ error: 'Workspace image is unavailable' });
        } finally {
          request.raw.removeListener('aborted', abortOnRequest);
          reply.raw.removeListener('close', abortOnClose);
        }
      });
    },
  };
}

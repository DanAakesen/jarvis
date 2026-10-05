import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import { WorkspaceArtifactNotFound } from '../database/workspace-artifact-store.js';
import { loadConfig } from '../config.js';
import type { TokenVerifier } from '../auth/verify.js';
import { buildApp } from '../app.js';
import type { ToolCallStore } from './tool-calls.js';
import { coreModule } from './index.js';
import { createImageGenerationModule } from './image-generation.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const ownerId = config.auth.ownerObjectId;
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const appInstances: ReturnType<typeof buildApp>[] = [];
const authorization = (token: string) => ({ authorization: [['Bear', 'er'].join(''), token].join(' ') });

function appFor(artifacts: WorkspaceArtifactStore) {
  const auth: TokenVerifier = async (token) => {
    if (token === 'runner.e30.sig') return { kind: 'jarvis-runner', objectId: ownerId, tenantId: config.auth.tenantId };
    if (token === 'other.e30.sig') {
      return {
        objectId: '1b475880-a077-40cd-90b7-3278bfc45b5b',
        tenantId: config.auth.tenantId,
        displayName: 'Other',
      };
    }
    return { objectId: ownerId, tenantId: config.auth.tenantId, displayName: 'Dan' };
  };
  const module = createImageGenerationModule({
    runner: {
      startCodexTool: vi.fn(),
      status: vi.fn(),
      cancel: vi.fn(),
      deleteSession: vi.fn(),
    },
    artifacts,
    model: 'gpt-5.5',
  });
  const app = buildApp(config, undefined, { auth, modules: [module] });
  appInstances.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(appInstances.splice(0).map((app) => app.close()));
});

describe('image artifact routes', () => {
  it('accepts image uploads only from the authenticated runner', async () => {
    const upload = vi.fn(async () => artifactId);
    const artifacts = {
      registerUpload: vi.fn(),
      releaseUpload: vi.fn(),
      upload,
      readUrl: vi.fn(),
    } as unknown as WorkspaceArtifactStore;
    const app = appFor(artifacts);
    const body = { uploadKey: 'A'.repeat(43), contentType: 'image/png', image: Buffer.from('png').toString('base64') };

    const accepted = await app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/images',
      headers: authorization('runner.e30.sig'),
      payload: body,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ artifactId });
    expect(upload).toHaveBeenCalledWith(body.uploadKey, body.contentType, Buffer.from('png'), expect.any(AbortSignal));
    expect((await app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/images',
      headers: authorization('user.e30.sig'),
      payload: body,
    })).statusCode).toBe(403);
    expect((await app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/images',
      payload: body,
    })).statusCode).toBe(401);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('returns private artifact URLs only to their authenticated owner', async () => {
    const url = 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https';
    const readUrl = vi.fn(async (_id: string, userId: string) => {
      if (userId !== ownerId) throw new WorkspaceArtifactNotFound();
      return url;
    });
    const artifacts = {
      registerUpload: vi.fn(),
      releaseUpload: vi.fn(),
      upload: vi.fn(),
      readUrl,
    } as unknown as WorkspaceArtifactStore;
    const app = appFor(artifacts);

    const response = await app.inject({
      url: `/factory/workspace-artifacts/images/${artifactId}`,
      headers: authorization('user.e30.sig'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ url });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(readUrl).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));

    expect((await app.inject({
      url: `/factory/workspace-artifacts/images/${artifactId}`,
      headers: authorization('other.e30.sig'),
    })).statusCode).toBe(404);
    expect((await app.inject({
      url: `/factory/workspace-artifacts/images/${artifactId}`,
      headers: authorization('runner.e30.sig'),
    })).statusCode).toBe(403);
    expect((await app.inject({
      url: '/factory/workspace-artifacts/images/not-an-id',
      headers: authorization('user.e30.sig'),
    })).statusCode).toBe(400);
  });

  it('does not expose provider or storage errors from artifact routes', async () => {
    const artifacts = {
      registerUpload: vi.fn(),
      releaseUpload: vi.fn(),
      upload: vi.fn(async () => { throw new Error('storage credentials must not leak'); }),
      readUrl: vi.fn(async () => { throw new Error('database credentials must not leak'); }),
    } as unknown as WorkspaceArtifactStore;
    const app = appFor(artifacts);
    const body = { uploadKey: 'A'.repeat(43), contentType: 'image/png', image: Buffer.from('png').toString('base64') };

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/factory/workspace-artifacts/images',
      headers: authorization('runner.e30.sig'),
      payload: body,
    });
    expect(uploadResponse.statusCode).toBe(503);
    expect(uploadResponse.body).not.toContain('credentials');

    const readResponse = await app.inject({
      url: `/factory/workspace-artifacts/images/${artifactId}`,
      headers: authorization('user.e30.sig'),
    });
    expect(readResponse.statusCode).toBe(503);
    expect(readResponse.body).not.toContain('credentials');
  });

  it('persists only the successful image artifact reference, never its prompt or signed URL', async () => {
    const priorStorageAccount = process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
    process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT = 'jarvisstore';
    const artifacts = {
      registerUpload: vi.fn(() => ({ artifactId, uploadKey: 'A'.repeat(43) })),
      releaseUpload: vi.fn(),
      upload: vi.fn(),
      readUrl: vi.fn(async () => 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https'),
    } as unknown as WorkspaceArtifactStore;
    const runner = {
      startCodexTool: vi.fn(async () => ({
        invocationId: 'image-invocation', sessionId: 'image-session', status: 'queued', agent: 'codex',
      })),
      status: vi.fn(async () => ({
        invocationId: 'image-invocation',
        sessionId: 'image-session',
        status: 'completed',
        agent: 'codex',
        startedAt: 0,
        finishedAt: 1,
        events: [],
        result: { artifact_id: artifactId, content_type: 'image/png', size_bytes: 100 },
        error: null,
      })),
      cancel: vi.fn(async () => ({ status: 'cancelled' })),
      deleteSession: vi.fn(async () => {}),
    };
    const imageModule = createImageGenerationModule({ runner, artifacts, model: 'gpt-5.5', wait: async () => {} });
    const workspaceCommands = {
      isConnected: vi.fn(() => true),
      execute: vi.fn(async () => {}),
      dispose: vi.fn(),
    };
    const record = vi.fn(async () => {});
    const auth: TokenVerifier = async () => ({
      kind: 'jarvis-agent', objectId: ownerId, tenantId: config.auth.tenantId,
    });
    const app = buildApp(config, undefined, {
      auth,
      modules: [coreModule, imageModule],
      toolCallStore: { record } as unknown as ToolCallStore,
      workspaceCommands: workspaceCommands as never,
    });
    appInstances.push(app);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/tools/image_generation',
        headers: {
          ...authorization('agent.e30.sig'),
          'x-jarvis-message-id': '42',
        },
        payload: { prompt: 'a private generation prompt' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        tool: 'image_generation',
        outcome: 'ok',
        result: { artifactId },
      });
      expect(record).toHaveBeenCalledWith({
        messageId: '42',
        tool: 'image_generation',
        arguments: { redacted: true },
        result: { artifactId },
        outcome: 'ok',
      });
      expect(JSON.stringify(record.mock.calls[0]?.[0])).not.toContain('sig=');
      expect(JSON.stringify(record.mock.calls[0]?.[0])).not.toContain('sp=r');
      expect(JSON.stringify(record.mock.calls[0]?.[0])).not.toContain('private generation prompt');
    } finally {
      if (priorStorageAccount === undefined) delete process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
      else process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT = priorStorageAccount;
    }
  });
});

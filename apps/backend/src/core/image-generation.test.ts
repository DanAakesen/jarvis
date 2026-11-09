import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import { createImageGenerationModule } from './image-generation.js';
import { ToolFailure } from './tool-registry.js';
const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
function fixture(connected = true, timeoutMs = 270_000) {
  const generator = { generate: vi.fn(async (_prompt: string, _signal: AbortSignal) => { void _prompt; void _signal; return { contentType: 'image/png' as const, bytes: Buffer.from('image') }; }) };
  const artifacts = {
    registerUpload: vi.fn(() => ({ artifactId, uploadKey: 'A'.repeat(43) })),
    releaseUpload: vi.fn(), upload: vi.fn(async () => artifactId),
    readUrl: vi.fn(async () => 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https'),
  };
  const workspaceCommands = { isConnected: vi.fn(() => connected), execute: vi.fn(async () => {}) };
  const request = {
    agentPrincipal: { kind: 'jarvis-agent', objectId: ownerId, tenantId: ownerId },
    server: { ownerObjectId: ownerId, workspaceCommands, jarvisTools: { list: () => [{ name: 'image_generation' }] } },
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
  const tool = createImageGenerationModule({ generator, artifacts: artifacts as unknown as WorkspaceArtifactStore, timeoutMs }).tools[0]!;
  return { generator, artifacts, workspaceCommands, request, tool };
}
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('image generation tool', () => {
  it('saves the API image before displaying it and returns its durable reference', async () => {
    vi.stubEnv('TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT', 'jarvisstore');
    const s = fixture();
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).resolves.toEqual({
      artifactId, confirmation: `Generated image opened in the workspace. Artifact ID: ${artifactId}.`,
    });
    expect(s.generator.generate).toHaveBeenCalledOnce();
    expect(s.artifacts.upload).toHaveBeenCalledWith('A'.repeat(43), 'image/png', Buffer.from('image'), expect.any(AbortSignal));
    expect(s.workspaceCommands.execute).toHaveBeenCalledOnce();
    expect(s.artifacts.releaseUpload).toHaveBeenCalledWith('A'.repeat(43));
  });
  it('preserves the actionable API error and never saves a failed result', async () => {
    const s = fixture();
    s.generator.generate.mockRejectedValue(new ToolFailure('OpenAI rejected the image API credential.'));
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).rejects.toThrow('OpenAI rejected');
    expect(s.artifacts.upload).not.toHaveBeenCalled();
    expect(s.artifacts.releaseUpload).toHaveBeenCalledOnce();
  });
  it('does not repeat generation when display fails after saving', async () => {
    vi.stubEnv('TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT', 'jarvisstore');
    const s = fixture();
    s.workspaceCommands.execute.mockRejectedValue(new Error('disconnected'));
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).rejects.toThrow(`Image artifact ${artifactId} was saved`);
    expect(s.generator.generate).toHaveBeenCalledOnce();
  });
  it('reports a saved artifact if reading its URL fails', async () => {
    const s = fixture(); s.artifacts.readUrl.mockRejectedValue(new Error('storage'));
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).rejects.toThrow('Do not regenerate');
  });
  it('rejects invalid prompts and unauthenticated callers before generation', async () => {
    const s = fixture();
    await expect(s.tool.execute({ prompt: '' }, s.request, new AbortController().signal)).rejects.toThrow('prompt');
    delete s.request.agentPrincipal;
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).rejects.toThrow('Only Jarvis');
    expect(s.generator.generate).not.toHaveBeenCalled();
  });
  it('does not start paid generation without a connected workspace', async () => {
    const s = fixture(false);
    await expect(s.tool.execute({ prompt: 'a widget' }, s.request, new AbortController().signal)).rejects.toThrow('Open the signed-in');
    expect(s.generator.generate).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'timeout'])('propagates %s and releases the artifact registration', async mode => {
    vi.useFakeTimers();
    const s = fixture(true, 50); const controller = new AbortController();
    s.generator.generate.mockImplementation((_prompt, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const result = s.tool.execute({ prompt: 'a widget' }, s.request, controller.signal);
    const assertion = expect(result).rejects.toThrow(mode === 'cancel' ? 'cancelled' : 'timed out');
    if (mode === 'cancel') controller.abort(); else await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(s.artifacts.upload).not.toHaveBeenCalled();
    expect(s.artifacts.releaseUpload).toHaveBeenCalledOnce();
  });
});

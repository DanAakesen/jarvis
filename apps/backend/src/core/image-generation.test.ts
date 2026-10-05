import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvocationAccepted, InvocationSnapshot } from '../foundry/client.js';
import { FoundryClientError } from '../foundry/client.js';
import type { WorkspaceArtifactStore } from '../database/workspace-artifact-store.js';
import { createImageGenerationModule } from './image-generation.js';
import { confirmToolCall } from './tool-calls.js';

const ownerId = 'd5b41c2f-33f4-4b4f-9a52-09346e50c8dd';
const artifactId = '56a2b0bd-af47-46b5-8e15-c6e9a718ae93';
const accepted: InvocationAccepted = {
  invocationId: 'image-invocation',
  sessionId: 'image-session',
  status: 'queued',
  agent: 'codex',
};

function snapshot(
  status: InvocationSnapshot['status'],
  result: InvocationSnapshot['result'] = null,
  error: string | null = null,
): InvocationSnapshot {
  return {
    ...accepted,
    status,
    startedAt: 0,
    finishedAt: status === 'queued' || status === 'running' ? null : 1,
    events: [],
    result,
    error,
  };
}

function fixture(input: {
  statuses?: InvocationSnapshot[];
  timeoutMs?: number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  connected?: boolean;
} = {}) {
  const runner = {
    startCodexTool: vi.fn(async () => accepted),
    status: vi.fn(async () => input.statuses?.shift() ?? snapshot('completed', {
      artifact_id: artifactId,
      content_type: 'image/png',
      size_bytes: 100,
    })),
    cancel: vi.fn(async () => ({ status: 'cancelled' })),
    deleteSession: vi.fn(async () => {}),
  };
  const artifacts = {
    registerUpload: vi.fn(() => ({ artifactId, uploadKey: 'A'.repeat(43) })),
    releaseUpload: vi.fn(),
    readUrl: vi.fn(async () => 'https://jarvisstore.blob.core.windows.net/artifacts/image.png?sp=r&spr=https'),
  } as unknown as WorkspaceArtifactStore;
  const executeWorkspaceCommand = vi.fn(async (_owner: string, command: unknown) => {
    void command;
  });
  const workspaceCommands = {
    isConnected: vi.fn(() => input.connected ?? true),
    execute: executeWorkspaceCommand,
  };
  const request = {
    agentPrincipal: { kind: 'jarvis-agent', objectId: ownerId, tenantId: ownerId },
    server: {
      ownerObjectId: ownerId,
      workspaceCommands,
      jarvisTools: { list: () => [{ name: 'image_generation' }] },
    },
    log: { warn: vi.fn() },
  } as unknown as FastifyRequest;
  const wait = input.wait ?? vi.fn(async () => {});
  const module = createImageGenerationModule({
    runner,
    artifacts,
    model: 'gpt-5.5',
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    wait,
  });
  const tool = module.tools[0];
  if (!tool) throw new Error('Image-generation tool was not registered');
  return {
    tool,
    runner,
    artifacts,
    request,
    workspaceCommands,
    executeWorkspaceCommand,
    wait,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('image generation tool', () => {
  it('waits for completion, saves the artifact, opens a typed image view, and reports the reference', async () => {
    const previousStorageAccount = process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
    process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT = 'jarvisstore';
    const state = fixture({
      statuses: [
        snapshot('queued'),
        snapshot('completed', { artifact_id: artifactId, content_type: 'image/png', size_bytes: 100 }),
      ],
    });
    const prompt = 'an untrusted "prompt"; do not execute it';

    try {
      await expect(state.tool.execute({ prompt }, state.request, new AbortController().signal)).resolves.toEqual({
        artifactId,
        confirmation: `Generated image opened in the workspace. Artifact ID: ${artifactId}.`,
      });
    } finally {
      if (previousStorageAccount === undefined) delete process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT;
      else process.env.TASK_EVENT_ARCHIVE_STORAGE_ACCOUNT = previousStorageAccount;
    }

    expect(state.runner.startCodexTool).toHaveBeenCalledWith({
      task: prompt, model: 'gpt-5.5', artifactUploadKey: 'A'.repeat(43),
    }, { signal: expect.any(AbortSignal) });
    expect(state.runner.status).toHaveBeenCalledTimes(2);
    expect(state.artifacts.readUrl).toHaveBeenCalledWith(artifactId, ownerId, expect.any(AbortSignal));
    expect(state.executeWorkspaceCommand).toHaveBeenCalledOnce();
    expect(state.runner.deleteSession).toHaveBeenCalledWith('image-session');
    expect(state.runner.cancel).not.toHaveBeenCalled();
    expect((state.executeWorkspaceCommand.mock.calls[0]?.[1] as { view: { renderer: string } }).view.renderer)
      .toBe('image');
  });

  it.each([
    ['failed', snapshot('failed', null, 'Codex usage limit reached'), 'Codex usage limit reached.'],
    ['cancelled', snapshot('cancelled'), 'Image generation was cancelled. No image was saved.'],
  ] as const)('reports a %s terminal state without claiming success', async (_name, terminal, message) => {
    const state = fixture({ statuses: [terminal] });

    await expect(state.tool.execute({ prompt: 'draw a tree' }, state.request, new AbortController().signal))
      .rejects.toThrow(message);

    expect(state.artifacts.readUrl).not.toHaveBeenCalled();
    expect(state.executeWorkspaceCommand).not.toHaveBeenCalled();
  });

  it('retries only transient status reads with a bounded attempt count', async () => {
    const state = fixture();
    state.runner.status
      .mockRejectedValueOnce(new FoundryClientError('transport', 'codex-tool-status'))
      .mockRejectedValueOnce(new FoundryClientError('timeout', 'codex-tool-status'))
      .mockRejectedValueOnce(new FoundryClientError('transport', 'codex-tool-status'));

    await expect(state.tool.execute({ prompt: 'draw a tree' }, state.request, new AbortController().signal))
      .rejects.toThrow('Image generation failed before an artifact could be shown.');

    expect(state.runner.status).toHaveBeenCalledTimes(3);
    expect(state.wait).toHaveBeenNthCalledWith(1, 250, expect.any(AbortSignal));
    expect(state.wait).toHaveBeenNthCalledWith(2, 500, expect.any(AbortSignal));
    expect(state.runner.cancel).toHaveBeenCalledWith('image-invocation');
    expect(state.artifacts.readUrl).not.toHaveBeenCalled();
  });

  it('cancels the accepted job when the caller disconnects', async () => {
    let wake: (() => void) | undefined;
    const wait = (_milliseconds: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      wake = () => reject(new FoundryClientError('aborted', 'codex-tool-status'));
      signal.addEventListener('abort', wake, { once: true });
    });
    const state = fixture({ statuses: [snapshot('running')], wait });
    const controller = new AbortController();
    const execution = state.tool.execute({ prompt: 'draw a tree' }, state.request, controller.signal);
    await vi.waitFor(() => expect(wake).toBeDefined());
    controller.abort();

    await expect(execution).rejects.toThrow('Image generation was cancelled.');
    expect(state.runner.cancel).toHaveBeenCalledWith('image-invocation');
    expect(state.runner.deleteSession).toHaveBeenCalledWith('image-session');
  });

  it('times out the job and cancels the remote invocation', async () => {
    vi.useFakeTimers();
    const wait = (_milliseconds: number, signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new FoundryClientError('aborted', 'codex-tool-status')), { once: true });
    });
    const state = fixture({ statuses: [snapshot('running')], timeoutMs: 50, wait });
    const execution = state.tool.execute({ prompt: 'draw a tree' }, state.request, new AbortController().signal);
    const assertion = expect(execution).rejects.toThrow('Image generation timed out.');
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
    expect(state.runner.cancel).toHaveBeenCalledWith('image-invocation');
    expect(state.artifacts.readUrl).not.toHaveBeenCalled();
  });

  it('refuses disconnected workspaces and invalid runner artifacts', async () => {
    const disconnected = fixture({ connected: false });
    await expect(disconnected.tool.execute(
      { prompt: 'draw a tree' }, disconnected.request, new AbortController().signal,
    )).rejects.toThrow('Open the signed-in conversation workspace');
    expect(disconnected.runner.startCodexTool).not.toHaveBeenCalled();

    const invalid = fixture({
      statuses: [snapshot('completed', {
        artifact_id: '00000000-0000-4000-8000-000000000000',
        content_type: 'image/png',
        size_bytes: 100,
      })],
    });
    await expect(invalid.tool.execute(
      { prompt: 'draw a tree' }, invalid.request, new AbortController().signal,
    )).rejects.toThrow('Codex did not return a valid saved image artifact.');
    expect(invalid.executeWorkspaceCommand).not.toHaveBeenCalled();
  });

  it('returns the Codex usage-limit reason in the truthful tool confirmation', () => {
    expect(confirmToolCall('image_generation', 'error', {
      error: 'Codex usage limit reached.',
    })).toBe('Not done: image_generation failed. Codex usage limit reached.');
  });
});

import type { FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvocationAccepted, InvocationSnapshot } from '../foundry/client.js';
import { createWebResearchModule } from './web-research.js';
import { ToolFailure, ToolRefusal } from './tool-registry.js';

const accepted: InvocationAccepted = {
  invocationId: 'invocation-1',
  sessionId: 'session-1',
  status: 'queued',
  agent: 'codex',
};

function snapshot(overrides: Partial<InvocationSnapshot> = {}): InvocationSnapshot {
  return {
    ...accepted,
    startedAt: 0,
    finishedAt: null,
    events: [],
    result: null,
    error: null,
    ...overrides,
  };
}

function client(initial: InvocationSnapshot = snapshot()) {
  return {
    startCodexTool: vi.fn(async () => accepted),
    status: vi.fn(async () => initial),
    cancel: vi.fn(async () => ({ invocationId: accepted.invocationId, status: 'cancelled' as const })),
    deleteSession: vi.fn(async () => {}),
  };
}

function execute(
  runner: ReturnType<typeof client>,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
) {
  const module = createWebResearchModule(() => runner, 'gpt-5.5', options);
  return module.tools[0]!.execute(
    { query: 'Research this topic' }, {} as FastifyRequest, new AbortController().signal,
  );
}

afterEach(() => { vi.useRealTimers(); });

describe('web_research tool', () => {
  it('returns bounded source links and retrieval timestamps from partial research', async () => {
    const runner = client(snapshot({
      status: 'completed',
      finishedAt: 100,
      result: {
        answer: 'One page was inaccessible; these findings are based on the pages retrieved.',
        sources: [
          { title: 'First source', url: 'https://example.com/first' },
          { title: 'Second source', url: 'https://example.com/second' },
        ],
      },
    }));

    const result = await execute(runner) as {
      answer: string;
      sources: { title: string; url: string; retrievedAt: string }[];
    };

    expect(result.answer).toContain('One page was inaccessible');
    expect(result.answer).toContain('https://example.com/first');
    expect(result.sources).toHaveLength(2);
    expect(result.sources.every((source) => Number.isFinite(Date.parse(source.retrievedAt)))).toBe(true);
    expect(runner.startCodexTool).toHaveBeenCalledWith(
      'web_research', 'Research this topic', 'gpt-5.5', { signal: expect.any(AbortSignal) },
    );
    expect(runner.deleteSession).toHaveBeenCalledWith('session-1', { signal: expect.any(AbortSignal) });
    expect(runner.cancel).not.toHaveBeenCalled();
  });

  it('explicitly reports when the provider returns no sources', async () => {
    const runner = client(snapshot({
      status: 'completed',
      result: { answer: 'I could not retrieve supporting pages.', sources: [] },
    }));

    const result = await execute(runner) as { answer: string; sources: unknown[] };

    expect(result.answer).toContain('No sources were returned.');
    expect(result.sources).toEqual([]);
  });

  it('refuses results that exceed the source bound or contain fabricated unsafe URLs', async () => {
    const tooMany = Array.from({ length: 11 }, (_, index) => ({
      title: `Source ${index}`,
      url: `https://example.com/${index}`,
    }));
    const runner = client(snapshot({
      status: 'completed',
      result: { answer: 'Answer', sources: tooMany },
    }));
    await expect(execute(runner)).rejects.toBeInstanceOf(ToolFailure);

    const invalidUrlRunner = client(snapshot({
      status: 'completed',
      result: { answer: 'Answer', sources: [{ title: 'Example', url: 'javascript:alert(1)' }] },
    }));
    await expect(execute(invalidUrlRunner)).rejects.toBeInstanceOf(ToolFailure);
  });

  it('surfaces Codex usage limits as a visible refusal', async () => {
    const runner = client(snapshot({ status: 'failed', error: 'Codex usage limit reached' }));
    const result = execute(runner);

    await expect(result).rejects.toBeInstanceOf(ToolRefusal);
    await expect(result).rejects.toThrow('Codex usage limit reached.');
  });

  it('cancels and cleans up a runner invocation when its caller cancels', async () => {
    const runner = client();
    runner.status.mockImplementation((_invocationId, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const controller = new AbortController();
    const module = createWebResearchModule(() => runner, 'gpt-5.5', { timeoutMs: 100, pollIntervalMs: 1 });
    const pending = module.tools[0]!.execute(
      { query: 'Research this topic' }, {} as FastifyRequest, controller.signal,
    );
    setTimeout(() => controller.abort(), 1);

    await expect(pending).rejects.toThrow();
    expect(runner.cancel).toHaveBeenCalledWith('invocation-1', { signal: expect.any(AbortSignal) });
    expect(runner.deleteSession).toHaveBeenCalledWith('session-1', { signal: expect.any(AbortSignal) });
  });

  it('cancels an invocation that exceeds the overall research deadline', async () => {
    const runner = client(snapshot({ status: 'running' }));

    await expect(execute(runner, { timeoutMs: 5, pollIntervalMs: 1 })).rejects.toThrow(
      'Web research timed out.',
    );
    expect(runner.cancel).toHaveBeenCalledOnce();
    expect(runner.deleteSession).toHaveBeenCalledOnce();
  });
});

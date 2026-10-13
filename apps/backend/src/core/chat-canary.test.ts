import { describe, expect, it, vi } from 'vitest';
import { ChatAgentError, type ConversationAgent } from './chat-agent.js';
import { createChatCanaryProbe } from './chat-canary.js';

function agent(stream: ConversationAgent['stream']): ConversationAgent {
  return { stream };
}

function failingAgent(error: Error): ConversationAgent {
  return agent(() => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => { throw error; },
    }),
  }));
}

describe('chat canary probe', () => {
  it('accepts a non-empty reply from the system smoke path', async () => {
    const stream = vi.fn(async function* () { yield 'ok'; });
    const probe = createChatCanaryProbe(agent(stream));

    await expect(probe()).resolves.toMatchObject({ status: 'ok' });
    expect(stream).toHaveBeenCalledWith({
      messageId: '1',
      text: 'Reply with the single word ok.',
      language: 'en',
      smoke: true,
    }, '', expect.any(AbortSignal));
  });

  it('reports catalogue failures, empty replies, and other agent errors safely', async () => {
    const catalogueUnavailable = createChatCanaryProbe(
      failingAgent(new ChatAgentError('catalogue_unavailable')),
    );
    const empty = createChatCanaryProbe(agent(async function* () { yield '  \n'; }));
    const agentError = createChatCanaryProbe(
      failingAgent(new Error('provider response contains private data')),
    );

    await expect(catalogueUnavailable()).resolves.toMatchObject({
      status: 'down', reason: 'catalogue_unavailable',
    });
    await expect(empty()).resolves.toMatchObject({ status: 'down', reason: 'empty_reply' });
    await expect(agentError()).resolves.toMatchObject({ status: 'down', reason: 'agent_error' });
    expect(JSON.stringify(await agentError())).not.toContain('private data');
  });

  it('times out a stalled hosted-agent turn', async () => {
    vi.useFakeTimers();
    try {
      const stalled = agent(() => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<string>>(() => {}),
          return: async () => ({ done: true, value: undefined }),
        }),
      }));
      const probe = createChatCanaryProbe(stalled);
      const result = probe();
      await vi.advanceTimersByTimeAsync(45_000);
      await expect(result).resolves.toMatchObject({ status: 'down', reason: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches and coalesces calls for 60 seconds', async () => {
    let now = 0;
    const stream = vi.fn(async function* () { yield 'ok'; });
    const probe = createChatCanaryProbe(agent(stream), () => now);

    await Promise.all([probe(), probe()]);
    await probe();
    expect(stream).toHaveBeenCalledOnce();

    now = 60_000;
    await probe();
    expect(stream).toHaveBeenCalledTimes(2);
  });
});

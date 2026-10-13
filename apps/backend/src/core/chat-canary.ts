import {
  ChatAgentError,
  type ConversationAgent,
} from './chat-agent.js';
import type { SystemStatusProbe } from '../system-status.js';

const chatCanaryTimeoutMs = 45_000;
const chatCanaryCacheMs = 60_000;

function failure(reason: 'catalogue_unavailable' | 'timeout' | 'empty_reply' | 'agent_error') {
  return { status: 'down' as const, reason };
}

async function runChatCanary(agent: ConversationAgent | undefined) {
  if (!agent) return failure('agent_error');

  const controller = new AbortController();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let iterator: AsyncIterator<string> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new Error('Chat canary timed out'));
    }, chatCanaryTimeoutMs);
    timeout.unref?.();
  });

  try {
    iterator = agent.stream({
      messageId: '1',
      text: 'Reply with the single word ok.',
      language: 'en',
      smoke: true,
    }, '', controller.signal)[Symbol.asyncIterator]();
    let hasReply = false;
    while (true) {
      const result = await Promise.race([iterator.next(), deadline]);
      if (result.done) break;
      if (typeof result.value === 'string' && result.value.trim()) hasReply = true;
    }
    return hasReply ? { status: 'ok' as const } : failure('empty_reply');
  } catch (error) {
    if (timedOut) return failure('timeout');
    if (error instanceof ChatAgentError && error.code === 'catalogue_unavailable') {
      return failure('catalogue_unavailable');
    }
    return failure('agent_error');
  } finally {
    if (timeout) clearTimeout(timeout);
    if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => {});
  }
}

export function createChatCanaryProbe(
  agent: ConversationAgent | undefined,
  now: () => number = Date.now,
): SystemStatusProbe {
  let cachedAt = Number.NEGATIVE_INFINITY;
  let cached: Awaited<ReturnType<typeof runChatCanary>> | undefined;
  let pending: Promise<Awaited<ReturnType<typeof runChatCanary>>> | undefined;

  return async () => {
    if (pending) return pending;
    if (cached && now() - cachedAt < chatCanaryCacheMs) return cached;
    pending = runChatCanary(agent);
    try {
      cached = await pending;
      cachedAt = now();
      return cached;
    } finally {
      pending = undefined;
    }
  };
}

import { describe, expect, it, vi } from 'vitest';
import type { ConversationAgent } from './core/chat-agent.js';
import { createChatAcceptanceProbes } from './core/chat-canary.js';
import { createSystemSmokeReader, createSystemStatusReader, summarizeSystemStatus } from './system-status.js';
import { isSystemSmokeStatus, systemSmokeCheckIds } from '@jarvis/contracts';

const smokeCheckedAt = '2026-10-14T01:03:29.169Z';

function runChatSmoke(agent: ConversationAgent | undefined) {
  const now = () => Date.parse(smokeCheckedAt);
  return createSystemSmokeReader(
    createSystemStatusReader({}, undefined, now),
    createChatAcceptanceProbes(agent, now),
    now,
  ).run();
}

function expectSmokeFailures(
  report: Awaited<ReturnType<ReturnType<typeof createSystemSmokeReader>['run']>>,
  expected: Partial<Record<(typeof systemSmokeCheckIds)[number], readonly ['degraded' | 'down', string]>>,
) {
  expect(report.entries).toEqual(systemSmokeCheckIds.map((id) => {
    const [status, reason] = expected[id] ?? ['unknown', undefined];
    return {
      id,
      status,
      checkedAt: smokeCheckedAt,
      ...(reason ? { reason } : {}),
    };
  }));
  expect(isSystemSmokeStatus(report)).toBe(true);
}

describe('system status reader', () => {
  it('retains only allowlisted reasons for down and degraded smoke checks', async () => {
    const now = () => Date.parse(smokeCheckedAt);
    const smokeReader = createSystemSmokeReader(
      createSystemStatusReader({}, undefined, now),
      {
        chat_identity: async () => ({ status: 'degraded', reason: 'identity_reply' }),
        chat_no_timestamp: async () => ({ status: 'degraded', reason: 'capture_time_invented' }),
        chat_canary: async () => ({ status: 'down', reason: 'acceptance_check_failed' }),
        chat_capabilities: async () => ({ status: 'down', reason: 'private reply and tool arguments' }),
        chat_github_read: async () => ({ status: 'down', reason: 'capabilities_receipt_incomplete' }),
        research: async () => ({ status: 'down', reason: 'provider response contains private data' }),
      },
      now,
    );

    const report = await smokeReader.run();
    const entries = new Map(report.entries.map((entry) => [entry.id, entry]));

    expect(entries.get('chat_identity')).toMatchObject({ status: 'degraded', reason: 'identity_reply' });
    expect(entries.get('chat_no_timestamp')).toMatchObject({
      status: 'degraded', reason: 'capture_time_invented',
    });
    expect(entries.get('chat_canary')).toMatchObject({ status: 'down', reason: 'acceptance_check_failed' });
    expect(entries.get('chat_capabilities')).toEqual(expect.objectContaining({
      id: 'chat_capabilities', status: 'down',
    }));
    expect(entries.get('chat_capabilities')).not.toHaveProperty('reason');
    expect(entries.get('research')).toEqual(expect.objectContaining({ id: 'research', status: 'down' }));
    expect(entries.get('research')).not.toHaveProperty('reason');
    expect(report.entries.map(({ id }) => id)).toEqual(systemSmokeCheckIds);
    expect(isSystemSmokeStatus(report)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/private reply|tool arguments|provider response|capabilities_receipt_incomplete/u);
  });

  it('retains the actual canary missing-agent diagnostics with the complete contract shape', async () => {
    const report = await runChatSmoke(undefined);

    expectSmokeFailures(report, {
      chat_canary: ['down', 'agent_error'],
      chat_identity: ['degraded', 'agent_error'],
      chat_capabilities: ['down', 'agent_error'],
      chat_github_read: ['down', 'agent_error'],
      chat_jobs: ['down', 'agent_error'],
      chat_navigation: ['down', 'agent_error'],
      chat_no_timestamp: ['degraded', 'agent_error'],
      chat_plain_approval: ['down', 'agent_error'],
    });
    expect(JSON.stringify(report)).not.toMatch(/prompt|reply|private|provider/u);
  });

  it('retains a controlled stream failure reason across acceptance checks only', async () => {
    const agent: ConversationAgent = {
      stream: async function* () {
        yield '';
        throw new Error('provider failure contains private reply text');
      },
    };
    const report = await runChatSmoke(agent);

    expectSmokeFailures(report, {
      chat_canary: ['down', 'acceptance_check_failed'],
      chat_identity: ['degraded', 'agent_error'],
      chat_capabilities: ['down', 'agent_error'],
      chat_github_read: ['down', 'agent_error'],
      chat_jobs: ['down', 'agent_error'],
      chat_navigation: ['down', 'agent_error'],
      chat_no_timestamp: ['degraded', 'agent_error'],
      chat_plain_approval: ['down', 'agent_error'],
    });
    expect(JSON.stringify(report)).not.toMatch(/provider failure|private reply/u);
  });

  it('retains controlled prompt timeouts for each acceptance check and aborts the prompts', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const stalled: ConversationAgent = {
        stream: (_input, _owner, signal) => {
          signals.push(signal!);
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise<IteratorResult<string>>(() => {}),
              return: async () => ({ done: true, value: undefined }),
            }),
          };
        },
      };
      const reportPromise = runChatSmoke(stalled);
      await vi.advanceTimersByTimeAsync(25_000);
      const report = await reportPromise;

      expectSmokeFailures(report, {
        chat_canary: ['down', 'acceptance_check_failed'],
        chat_identity: ['degraded', 'timeout'],
        chat_capabilities: ['down', 'timeout'],
        chat_github_read: ['down', 'timeout'],
        chat_jobs: ['down', 'timeout'],
        chat_navigation: ['down', 'timeout'],
        chat_no_timestamp: ['degraded', 'timeout'],
        chat_plain_approval: ['down', 'timeout'],
      });
      expect(signals).toHaveLength(7);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches the subsystem checks and reports all requested entries', async () => {
    let now = Date.parse('2026-10-07T12:00:00.000Z');
    const database = vi.fn(async () => ({ status: 'ok' as const, details: { configured: true } }));
    const reader = createSystemStatusReader({ database }, 'a'.repeat(40), () => now, 1_000);

    const first = await reader.read();
    const second = await reader.read();

    expect(second).toBe(first);
    expect(database).toHaveBeenCalledOnce();
    expect(first.entries).toHaveLength(11);
    expect(first.entries[0]).toMatchObject({ id: 'database', status: 'ok', checkedAt: first.checkedAt });
    expect(first.entries.find(({ id }) => id === 'deployed_commit')).toMatchObject({
      status: 'ok', details: { commit: 'a'.repeat(40) },
    });
    expect(first.entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'ok', details: { occurredAt: null, route: null, statusCode: null },
    });
    expect(summarizeSystemStatus(first)).toBe('System status: 2 ok, 0 degraded, 0 down, 8 unknown.');

    now += 1_001;
    await reader.read();
    expect(database).toHaveBeenCalledTimes(2);
  });

  it('makes probe failures visible without returning provider error text', async () => {
    const reader = createSystemStatusReader({
      google: async () => { throw new Error('private provider response'); },
    }, undefined, () => Date.parse('2026-10-07T12:00:00.000Z'));
    const status = await reader.read();

    expect(status.entries.find(({ id }) => id === 'google')).toMatchObject({
      status: 'down', details: { reason: 'check_failed' },
    });
    expect(JSON.stringify(status)).not.toContain('private provider response');
  });

  it('invalidates the cached snapshot and records only a safe route template for server errors', async () => {
    let now = Date.parse('2026-10-07T12:00:00.000Z');
    const reader = createSystemStatusReader({}, undefined, () => now);
    const before = await reader.read();

    reader.recordError('/private/:id', 500);
    now += 1_000;
    const after = await reader.read();

    expect(after).not.toBe(before);
    expect(after.entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'degraded',
      details: {
        occurredAt: new Date(now - 1_000).toISOString(),
        route: '/private/:id',
        statusCode: 500,
      },
    });
    reader.recordError('/private?token=secret', 404);
    expect((await reader.read()).entries.find(({ id }) => id === 'last_error')).toMatchObject({
      status: 'degraded', details: { route: '/private/:id' },
    });
  });
});

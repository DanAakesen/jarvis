import { describe, expect, it, vi } from 'vitest';
import { createFoundryInvocationConversationAgent, type ConversationAgent } from './core/chat-agent.js';
import { createChatAcceptanceProbes } from './core/chat-canary.js';
import { assessVaultIndex, chatAgentFailureReasons, createSystemSmokeReader, createSystemStatusReader, summarizeSystemStatus, systemSmokeHttpResponse } from './system-status.js';
import { isSystemSmokeStatus, systemSmokeCheckIds } from '@jarvis/contracts';

const smokeCheckedAt = '2026-10-14T01:03:29.169Z';
const vaultStatusNow = Date.parse('2026-10-25T12:00:00.000Z');
const oldVaultChunks = {
  notes: 1,
  chunks: 2,
  embeddedChunks: 2,
  latestIndexedAt: new Date('2026-09-25T12:00:00.000Z'),
};

async function runChatSmoke(agent: ConversationAgent | undefined) {
  const now = () => Date.parse(smokeCheckedAt);
  const ownsTimers = !vi.isFakeTimers();
  if (ownsTimers) vi.useFakeTimers();
  const report = createSystemSmokeReader(
    createSystemStatusReader({}, undefined, now),
    createChatAcceptanceProbes(agent, now),
    now,
  ).run();
  try {
    if (ownsTimers) await vi.runAllTimersAsync();
    return await report;
  } finally {
    if (ownsTimers) vi.useRealTimers();
  }
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
  it('uses a verified no-op sync as fresh evidence when indexed chunks have not changed', () => {
    const result = assessVaultIndex(oldVaultChunks, {
      outcome: 'ok',
      latestAttemptAt: '2026-10-25T11:59:00.000Z',
      lastSuccessfulAt: '2026-10-25T11:59:30.000Z',
    }, vaultStatusNow);

    expect(result).toMatchObject({
      status: 'ok',
      details: {
        latestIndexedAt: '2026-09-25T12:00:00.000Z',
        latestSyncAttemptAt: '2026-10-25T11:59:00.000Z',
        lastSuccessfulSyncAt: '2026-10-25T11:59:30.000Z',
        syncOutcome: 'ok',
        syncFresh: true,
      },
    });
  });

  it('keeps incomplete embedding coverage degraded after a fresh sync', () => {
    expect(assessVaultIndex({ ...oldVaultChunks, embeddedChunks: 1 }, {
      outcome: 'ok',
      latestAttemptAt: '2026-10-25T11:59:00.000Z',
      lastSuccessfulAt: '2026-10-25T11:59:30.000Z',
    }, vaultStatusNow)).toMatchObject({
      status: 'degraded',
      details: { embeddingCoveragePercent: 50, syncFresh: true },
    });
  });

  it('keeps a failed latest attempt degraded without overwriting the last success', () => {
    expect(assessVaultIndex(oldVaultChunks, {
      outcome: 'error',
      latestAttemptAt: '2026-10-25T11:59:00.000Z',
      lastSuccessfulAt: '2026-10-25T11:00:00.000Z',
    }, vaultStatusNow)).toMatchObject({
      status: 'degraded',
      details: {
        syncOutcome: 'error',
        latestSyncAttemptAt: '2026-10-25T11:59:00.000Z',
        lastSuccessfulSyncAt: '2026-10-25T11:00:00.000Z',
      },
    });
  });

  it('does not infer success from existing chunks after process restart or without a sync', () => {
    expect(assessVaultIndex(oldVaultChunks, {
      outcome: 'pending', latestAttemptAt: null, lastSuccessfulAt: null,
    }, vaultStatusNow)).toMatchObject({
      status: 'unknown',
      details: {
        latestSyncAttemptAt: null,
        lastSuccessfulSyncAt: null,
        syncOutcome: 'pending',
        syncFresh: null,
      },
    });
  });

  it('ages the last successful sync rather than the latest changed chunk', () => {
    expect(assessVaultIndex({ ...oldVaultChunks, latestIndexedAt: new Date(vaultStatusNow) }, {
      outcome: 'ok',
      latestAttemptAt: '2026-10-24T11:59:00.000Z',
      lastSuccessfulAt: '2026-10-24T11:59:30.000Z',
    }, vaultStatusNow)).toMatchObject({
      status: 'degraded',
      details: { syncFresh: false },
    });
  });

  it('preserves the legacy HTTP smoke shape without mutating retained diagnostics', async () => {
    const now = () => Date.parse(smokeCheckedAt);
    const status = createSystemStatusReader({}, undefined, now);
    const report = await createSystemSmokeReader(status, {
      chat_identity: async () => ({ status: 'degraded', reason: 'identity_reply' }),
      chat_capabilities: async () => ({ status: 'down', reason: 'capabilities_discovery_missing' }),
      chat_no_timestamp: async () => ({ status: 'degraded', reason: 'capture_time_invented' }),
    }, now).run();
    const original = structuredClone(report);
    const wire = systemSmokeHttpResponse(report);

    expect(wire).toEqual({
      checkedAt: report.checkedAt,
      entries: report.entries.map(({ reason, ...entry }) => ({
        ...entry,
        ...(entry.status === 'down' && reason ? { reason } : {}),
      })),
    });
    expect(wire.entries.every((entry) => entry.reason === undefined || entry.status === 'down')).toBe(true);
    expect(isSystemSmokeStatus(wire)).toBe(true);
    expect(report).toEqual(original);
    expect(status.peek()?.smoke).toEqual(original);
    expect((await status.read()).smoke).toEqual(original);
  });

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

  it.each([...chatAgentFailureReasons, 'private_provider_detail', undefined])(
    'projects hosted SSE origin %s through the real canary and retained/HTTP report without payloads',
    async (code) => {
      const agent = createFoundryInvocationConversationAgent(
        'https://fixture.services.ai.azure.com/api/projects/fixture',
        'jarvis',
        async () => 'synthetic-token',
        vi.fn(async () => new Response(
          `event: error\ndata: ${JSON.stringify({ code, message: 'private provider detail', token: 'never-retain' })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        )),
      );
      const reason = code === undefined
        ? 'agent_error_code_missing'
        : chatAgentFailureReasons.has(code) ? code : 'agent_error_code_unlisted';
      const report = await runChatSmoke(agent);

      expectSmokeFailures(report, {
        chat_canary: ['down', code === 'rate_limit_exceeded' ? code : 'acceptance_check_failed'],
        chat_identity: ['degraded', reason],
        chat_capabilities: ['down', reason],
        chat_github_read: ['down', reason],
        chat_jobs: ['down', reason],
        chat_navigation: ['down', reason],
        chat_no_timestamp: ['degraded', reason],
        chat_plain_approval: ['down', reason],
      });
      const wire = systemSmokeHttpResponse(report);
      expect(wire.entries.find(({ id }) => id === 'chat_capabilities')).toMatchObject({ status: 'down', reason });
      expect(wire.entries.find(({ id }) => id === 'chat_identity')).not.toHaveProperty('reason');
      expect(isSystemSmokeStatus(wire)).toBe(true);
      expect(JSON.stringify({ report, wire })).not.toMatch(/private_provider_detail|private provider|never-retain|message|token/u);
    },
  );

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
      await vi.runAllTimersAsync();
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

import { describe, expect, it, vi } from 'vitest';
import type { ConversationAgent, ConversationAgentInput, ConversationAgentToolCall } from './chat-agent.js';
import { createChatAcceptanceProbes } from './chat-canary.js';

const prompts = [
  'who are you and what can you do?',
  'what can you do?',
  'what is in issue 700?',
  'what jobs are running?',
  'open the settings page',
  'What does the image show, and when was it captured?',
  'Please run the no-op test action. Ask me before running it.',
];

function passingAgent(
  override: (input: ConversationAgentInput) => { text: string; calls?: ConversationAgentToolCall[] } | undefined = () => undefined,
): ConversationAgent {
  const implementation: ConversationAgent['stream'] = async function* (input) {
    const changed = override(input);
    const defaultCalls: ConversationAgentToolCall[] = input.text === 'what can you do?' ? [{
      name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok',
      capabilities: ['Notes: vault_read, vault_search', 'Calendar: calendar_today_agenda', 'GitHub tools: github_read'],
    }] : input.text === 'what is in issue 700?' ? [{
      name: 'github_read', operation: 'issue_get', number: 700, outcome: 'ok', title: 'Camera preview behavior',
    }] : input.text === 'what jobs are running?' ? [{
      name: 'list_jobs', outcome: 'ok',
    }] : input.text === 'open the settings page' ? [{
      name: 'workspace_command', operation: 'navigate', page: 'settings', outcome: 'refused',
      refusal: 'No tab connected for the deployment smoke check.',
    }] : input.text === prompts[6] ? [{
      name: 'get_system_health', operation: 'confirmation_test', outcome: 'refused',
    }] : input.text === 'yes' ? [{
      name: 'get_system_health', operation: 'confirmation_test', outcome: 'ok', executed: true,
    }] : [];
    const calls = changed ? changed.calls ?? [] : defaultCalls;
    input.onAgentToolCalls?.(calls);
    yield changed?.text ?? (input.text === 'who are you and what can you do?'
      ? 'I am Jarvis, and I can help with your tools.'
      : input.text === 'what can you do?'
        ? 'I can help with notes, calendar, and GitHub tools.'
        : input.text === 'what is in issue 700?'
          ? 'Issue 700 is Camera preview behavior.'
          : input.text === 'what jobs are running?'
            ? 'There are no running jobs.'
            : input.text === 'open the settings page'
              ? 'I cannot open Settings because no tab is connected.'
              : input.text === prompts[6]
                ? 'I need your confirmation before running the no-op action.'
                : input.text === 'yes'
                  ? 'The no-op action is complete.'
                  : 'I cannot see an image, so I cannot say when it was captured.');
  };
  return { stream: vi.fn(implementation) };
}

function probes(agent: ConversationAgent, now?: () => number) {
  return createChatAcceptanceProbes(agent, now);
}

describe('post-deploy chat acceptance suite', () => {
  it('reports each scripted prompt as an independent passing check', async () => {
    const agent = passingAgent();
    const suite = probes(agent);
    const entries = await Promise.all(Object.entries(suite).map(async ([id, probe]) => [id, await probe!()] as const));

    expect(Object.fromEntries(entries)).toEqual({
      chat_identity: { status: 'ok' },
      chat_capabilities: { status: 'ok' },
      chat_github_read: { status: 'ok' },
      chat_jobs: { status: 'ok' },
      chat_navigation: { status: 'ok' },
      chat_no_timestamp: { status: 'ok' },
      chat_plain_approval: { status: 'ok' },
      chat_canary: { status: 'ok' },
    });
    expect(agent.stream).toHaveBeenCalledTimes(8);
    const inputs = vi.mocked(agent.stream).mock.calls.map(([input]) => input);
    expect(inputs.map(({ text }) => text)).toEqual(expect.arrayContaining(prompts));
    expect(inputs.find(({ text }) => text === 'yes')).toMatchObject({
      smoke: true,
      smokeApproval: true,
      smokeHistory: [
        { role: 'user', text: prompts[6] },
        { role: 'assistant', text: 'I need your confirmation before running the no-op action.' },
      ],
    });
    expect(inputs.every(({ smoke }) => smoke === true)).toBe(true);
  });

  it('fails the matching deterministic check when a required tool call is missing', async () => {
    const suite = probes(passingAgent((input) => input.text === 'what is in issue 700?'
      ? { text: 'Issue 700 is Camera preview behavior.' }
      : undefined));

    await expect(suite.chat_github_read!()).resolves.toMatchObject({
      status: 'down', reason: 'github_issue_unavailable',
    });
    await expect(suite.chat_canary!()).resolves.toMatchObject({
      status: 'down', reason: 'acceptance_check_failed',
    });
  });

  it.each([
    'I can help with Notes, calendars and GitHub tools',
    'I can help with a note, a calendar and GitHub tools',
  ])('accepts singular/plural category wording with successful discovery: %s', async (text) => {
    const agent = passingAgent((input) => input.text === prompts[1] ? {
      text,
      calls: [{
        name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok',
        capabilities: ['Notes: vault_read, vault_search', 'Calendar: calendar_today_agenda', 'GitHub tools: github_read'],
      }],
    } : undefined);
    const suite = probes(agent);

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'ok' });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'ok' });
    expect(agent.stream).toHaveBeenCalledTimes(8);
  });

  it.each([
    'I can help with calendars and GitHub tools',
    'I can help with Notes and GitHub tools',
    'I can help with Notes and calendars',
    'I can help with Notes, scheduling and GitHub tools',
    'I can help with Notes, calendarish and GitHub tools',
    'I can help with Notes, mycalendars and GitHub tools',
    'I can help with Notes, calendarsync and GitHub tools',
  ])('rejects missing categories, synonyms and partial calendar words: %s', async (text) => {
    const suite = probes(passingAgent((input) => input.text === prompts[1] ? {
      text,
      calls: [{
        name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok',
        capabilities: ['Notes: vault_read', 'Calendar: calendar_today_agenda', 'GitHub tools: github_read'],
      }],
    } : undefined));

    await expect(suite.chat_capabilities!()).resolves.toEqual({
      status: 'down', reason: 'capabilities_reply_incomplete',
    });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
  });

  it.each([
    { reason: 'capabilities_discovery_missing', calls: [] },
    {
      reason: 'capabilities_discovery_wrong',
      calls: [{ name: 'get_system_health', operation: 'health', outcome: 'ok' }],
    },
    {
      reason: 'capabilities_discovery_wrong',
      calls: [{ name: 'github_read', operation: 'list_capabilities', outcome: 'ok' }],
    },
    ...(['error', 'refused'] as const).map((outcome) => ({
      reason: 'capabilities_discovery_failed',
      calls: [{ name: 'get_system_health', operation: 'list_capabilities', outcome }],
    })),
    ...[
      [],
      ['Calendar: calendar_today_agenda', 'GitHub tools: github_read'],
      ['Notes: vault_read', 'GitHub tools: github_read'],
      ['Notes: vault_read', 'Calendar: calendar_today_agenda'],
      ['Notes: vault_read', 'Calendars: scheduling', 'GitHub tools: github_read'],
    ].map((capabilities) => ({
      reason: 'capabilities_receipt_incomplete',
      calls: [{ name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok', capabilities }],
    })),
  ])('keeps plural replies failing for $reason', async ({ reason, calls }) => {
    const suite = probes(passingAgent((input) => input.text === prompts[1] ? {
      text: 'I can help with Notes, calendars and GitHub tools',
      calls,
    } : undefined));

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
  });

  it.each([
    {
      reason: 'capabilities_discovery_missing',
      text: 'I can help with notes, calendar, and GitHub tools.',
      calls: [],
    },
    {
      reason: 'capabilities_discovery_wrong',
      text: 'I can help with notes, calendar, and GitHub tools.',
      calls: [{ name: 'get_system_health', operation: 'health', outcome: 'ok' }],
    },
    {
      reason: 'capabilities_discovery_failed',
      text: 'I can help with notes, calendar, and GitHub tools.',
      calls: [{ name: 'get_system_health', operation: 'list_capabilities', outcome: 'error' }],
    },
    {
      reason: 'capabilities_receipt_incomplete',
      text: 'I can help with notes, calendar, and GitHub tools.',
      calls: [{
        name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok',
        capabilities: ['Notes: vault_read', 'Calendar: calendar_today_agenda'],
      }],
    },
    {
      reason: 'capabilities_reply_incomplete',
      text: 'I can help with notes and calendar.',
      calls: [{
        name: 'get_system_health', operation: 'list_capabilities', outcome: 'ok',
        capabilities: ['Notes: vault_read', 'Calendar: calendar_today_agenda', 'GitHub tools: github_read'],
      }],
    },
  ] as const)('reports a content-free $reason diagnosis', async ({ reason, text, calls }) => {
    const suite = probes(passingAgent((input) => input.text === prompts[1] ? { text, calls: [...calls] } : undefined));

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
  });

  it('reports wording-only identity and missing-image timestamp failures as warnings', async () => {
    const suite = probes(passingAgent((input) => input.text === prompts[0]
      ? { text: 'I am a generic assistant named Jarvis.' }
      : input.text === prompts[5]
        ? { text: 'The image was captured at 12:34.' }
        : undefined));

    await expect(suite.chat_identity!()).resolves.toEqual({ status: 'degraded', reason: 'identity_reply' });
    await expect(suite.chat_no_timestamp!()).resolves.toEqual({
      status: 'degraded', reason: 'capture_time_invented',
    });
    await expect(suite.chat_canary!()).resolves.toMatchObject({ status: 'ok' });
  });

  it('coalesces concurrent report entries and caches one suite for 60 seconds', async () => {
    let now = 0;
    const agent = passingAgent();
    const suite = probes(agent, () => now);

    await Promise.all(Object.values(suite).map((probe) => probe!()));
    await suite.chat_jobs!();
    expect(agent.stream).toHaveBeenCalledTimes(8);

    now = 60_000;
    await suite.chat_jobs!();
    expect(agent.stream).toHaveBeenCalledTimes(16);
  });

  it('bounds a stalled prompt and returns a safe failure', async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const stalled: ConversationAgent = {
        stream: (_input, _owner, signal) => {
          signals.push(signal);
          return {
            [Symbol.asyncIterator]: () => ({
              next: () => new Promise<IteratorResult<string>>(() => {}),
              return: async () => ({ done: true, value: undefined }),
            }),
          };
        },
      };
      const suite = probes(stalled);
      const result = suite.chat_jobs!();
      await vi.advanceTimersByTimeAsync(25_000);
      await expect(result).resolves.toMatchObject({ status: 'down', reason: 'timeout' });
      await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason: 'timeout' });
      await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
      expect(signals).toHaveLength(7);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

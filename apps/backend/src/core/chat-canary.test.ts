import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChatAgentError,
  ChatAgentInvocationError,
  type ChatAgentInvocationReason,
  type ConversationAgent,
  type ConversationAgentInput,
  type ConversationAgentToolCall,
} from './chat-agent.js';
import { createChatAcceptanceProbes } from './chat-canary.js';
import { chatAgentFailureReasons, chatAgentInvocationReasons } from '../system-status.js';

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

async function probes(agent: ConversationAgent, now?: () => number) {
  const suite = createChatAcceptanceProbes(agent, now);
  const result = suite.chat_canary!();
  await vi.runAllTimersAsync();
  await result;
  return suite;
}

describe('post-deploy chat acceptance suite', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(['managed_policy_turn_failed', 'managed_policy_setup_failed', 'managed_response_failed'])(
    'retains only sanitized provider diagnostics for %s without replacing its fixed reason',
    async (reason) => {
      const error = new ChatAgentError(reason, undefined, {
        httpStatus: 400,
        code: 'invalid_request',
        param: 'reasoning.effort',
        exceptionType: 'BadRequestError',
        message: 'private provider text',
      });
      // Re-sanitize even if another caller adds untrusted fields after construction.
      Object.assign(error.providerCause!, { token: 'never-retain', param: 'unsafe\n' });
      const suite = await probes(passingAgent((input) => {
        if (input.text === prompts[0] || input.text === prompts[1]) throw error;
        return undefined;
      }));
      const providerCause = { httpStatus: 400, code: 'invalid_request', exceptionType: 'BadRequestError' };
      await expect(suite.chat_identity!()).resolves.toEqual({ status: 'degraded', reason, providerCause });
      await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason, providerCause });
      await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
      expect(JSON.stringify(await suite.chat_capabilities!())).not.toMatch(/private|message|token|unsafe/u);
    },
  );

  it.each(['context_unavailable', 'managed_provider_failure', 'private_provider_code'])(
    'drops provider diagnostics for unrelated failure %s',
    async (reason) => {
      const error = new ChatAgentError(reason);
      Object.assign(error, { providerCause: { httpStatus: 500, code: 'server_error' } });
      const suite = await probes(passingAgent((input) => {
        if (input.text === prompts[1]) throw error;
        return undefined;
      }));
      expect(await suite.chat_capabilities!()).not.toHaveProperty('providerCause');
    },
  );

  it('spaces every hosted call, including approval, and caps active calls at three', async () => {
    const base = passingAgent();
    const starts: number[] = [];
    let active = 0;
    let maximum = 0;
    const agent: ConversationAgent = {
      async *stream(input, owner, signal) {
        starts.push(Date.now());
        maximum = Math.max(maximum, ++active);
        try {
          await new Promise<void>((resolve) => { setTimeout(resolve, 24_500); });
          yield* base.stream(input, owner, signal);
        } finally {
          active--;
        }
      },
    };
    const suite = createChatAcceptanceProbes(agent);
    const result = suite.chat_canary!();
    await vi.advanceTimersByTimeAsync(23_999);
    expect(starts).toHaveLength(3);
    expect(maximum).toBe(3);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: 'ok' });
    expect(starts).toHaveLength(8);
    expect(maximum).toBe(3);
    expect(starts.slice(1).every((start, index) => start - starts[index]! >= 8_000)).toBe(true);
    expect(starts[7]! - starts[0]!).toBeGreaterThanOrEqual(56_000);
  });

  it.each([
    [undefined, 60_000],
    [45_000, 45_000],
    [0, 30_000],
    [600_000, 60_000],
    [Number.NaN, 60_000],
  ])('backs off once with hint %s bounded to %s ms', async (hint, wait) => {
    const attempts: number[] = [];
    const agent = passingAgent((input) => {
      if (input.text === prompts[1]) {
        attempts.push(Date.now());
        throw new ChatAgentError('rate_limit_exceeded', hint);
      }
      return undefined;
    });
    const suite = createChatAcceptanceProbes(agent);
    const result = suite.chat_capabilities!();
    await vi.advanceTimersByTimeAsync(8_000 + wait - 1);
    expect(attempts).toHaveLength(1);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual({ status: 'down', reason: 'rate_limit_exceeded' });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'rate_limit_exceeded' });
    expect(attempts).toHaveLength(2);
    expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(wait);
    expect(agent.stream).toHaveBeenCalledTimes(9);
  });

  it.each(['backend_unavailable', 'error_ratelimiterror', 'settings_http_429', 'private_code'])(
    'does not retry other hosted failures: %s', async (code) => {
      const agent = passingAgent((input) => {
        if (input.text === prompts[1]) throw new ChatAgentError(code);
        return undefined;
      });
      const suite = await probes(agent);
      await expect(suite.chat_canary!()).resolves.toMatchObject({ status: 'down' });
      expect(agent.stream).toHaveBeenCalledTimes(8);
    },
  );
  it('reports each scripted prompt as an independent passing check', async () => {
    const agent = passingAgent();
    const suite = await probes(agent);
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

  it('does not stringify transient acknowledgment boundaries in canary replies', async () => {
    const agent: ConversationAgent = {
      stream: vi.fn(async function* () {
        yield 'I am Jarvis, Dan’s broad personal AI assistant.';
        yield { type: 'acknowledgment', text: 'I will check the available tools.' };
        yield 'I can help with your tools.';
      }),
    };

    const suite = await probes(agent);
    await expect(suite.chat_identity!()).resolves.toEqual({ status: 'ok' });
  });

  it('fails the matching deterministic check when a required tool call is missing', async () => {
    const agent = passingAgent((input) => input.text === 'what is in issue 700?'
      ? { text: 'Issue 700 is Camera preview behavior.' }
      : undefined);
    const suite = await probes(agent);

    await expect(suite.chat_github_read!()).resolves.toMatchObject({
      status: 'down', reason: 'github_issue_unavailable',
    });
    await expect(suite.chat_canary!()).resolves.toMatchObject({
      status: 'down', reason: 'acceptance_check_failed',
    });
    // A completed reply that fails its assertion is never run again.
    expect(agent.stream).toHaveBeenCalledTimes(8);
  });

  it.each([...chatAgentFailureReasons])('retains the fixed hosted origin %s for only the failed prompt', async (code) => {
    const suite = await probes(passingAgent((input) => {
      if (input.text === prompts[1]) throw new ChatAgentError(code);
      return undefined;
    }));

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason: code });
    await expect(suite.chat_canary!()).resolves.toEqual({
      status: 'down', reason: code === 'rate_limit_exceeded' ? code : 'acceptance_check_failed',
    });
    await expect(suite.chat_plain_approval!()).resolves.toEqual({ status: 'ok' });
  });

  it.each([...chatAgentInvocationReasons].filter((reason) => !reason.startsWith('agent_error_code_')))(
    'retains the fixed backend-side failure %s for only the failed prompt',
    async (reason) => {
      const suite = await probes(passingAgent((input) => {
        if (input.text === prompts[2]) {
          throw new ChatAgentInvocationError('Chat agent failed', reason as ChatAgentInvocationReason);
        }
        return undefined;
      }));

      await expect(suite.chat_github_read!()).resolves.toEqual({ status: 'down', reason });
      await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
      await expect(suite.chat_jobs!()).resolves.toEqual({ status: 'ok' });
    },
  );

  it.each<[Error, string]>([
    [new ChatAgentError(undefined), 'agent_error_code_missing'],
    [new ChatAgentError('private_provider_detail'), 'agent_error_code_unlisted'],
    [new ChatAgentError('settings_http_418'), 'agent_error_code_unlisted'],
    [new ChatAgentError('capabilities_discovery_missing'), 'agent_error_code_unlisted'],
    [new ChatAgentError('settings_timeout\n::error::private'), 'agent_error_code_unlisted'],
    [new Error('settings_timeout'), 'agent_error'],
    [Object.assign(new Error('private provider detail'), { code: 'settings_timeout' }), 'agent_error'],
    [Object.assign(new Error('private provider detail'), { reason: 'agent_http_503' }), 'agent_error'],
    [new ChatAgentInvocationError('Chat agent failed', 'private_reason' as ChatAgentInvocationReason), 'agent_error'],
  ])('does not trust unknown codes, assertion codes or ordinary exception text: %s', async (error, reason) => {
    const suite = await probes(passingAgent((input) => {
      if (input.text === prompts[1]) throw error;
      return undefined;
    }));

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
  });

  it('retries a rate-limited check once and reports the passing second attempt', async () => {
    let failures = 0;
    const agent = passingAgent((input) => {
      if (input.text === prompts[1] && failures++ === 0) {
        throw new ChatAgentError('rate_limit_exceeded');
      }
      return undefined;
    });
    const suite = await probes(agent);
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
    expect(agent.stream).toHaveBeenCalledTimes(9);
    expect(vi.mocked(agent.stream).mock.calls.filter(([input]) => input.text === prompts[1])).toHaveLength(2);
  });

  it('never retries other invocation failures', async () => {
    let attempts = 0;
    const agent = passingAgent((input) => {
      if (input.text === prompts[1]) {
        throw new ChatAgentInvocationError(
          'Chat agent failed', attempts++ === 0 ? 'agent_http_503' : 'agent_request_failed',
        );
      }
      return undefined;
    });
    const suite = await probes(agent);

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason: 'agent_http_503' });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
    expect(agent.stream).toHaveBeenCalledTimes(8);
  });

  it('keeps a failing identity invocation as a warning without retrying', async () => {
    const agent = passingAgent((input) => {
      if (input.text === prompts[0]) {
        throw new ChatAgentInvocationError('Chat agent unavailable (HTTP 503)', 'agent_http_503');
      }
      return undefined;
    });
    const suite = await probes(agent);

    await expect(suite.chat_identity!()).resolves.toEqual({ status: 'degraded', reason: 'agent_http_503' });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'ok' });
    expect(agent.stream).toHaveBeenCalledTimes(8);
  });

  it('skips the second attempt once the first has used too much of the suite budget', async () => {
    let clock = 0;
    const agent = passingAgent((input) => {
      if (input.text === prompts[1]) {
        clock += 30_000;
        throw new ChatAgentInvocationError('Chat agent request failed', 'agent_request_failed');
      }
      return undefined;
    });
    const suite = await probes(agent, () => clock);

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason: 'agent_request_failed' });
    expect(agent.stream).toHaveBeenCalledTimes(8);
  });

  it('bounds a stalled rate-limit retry by its own call deadline', async () => {
    vi.useFakeTimers();
    try {
      const base = passingAgent();
      const approvalSignals: AbortSignal[] = [];
      const iterable = (next: () => Promise<IteratorResult<string>>): AsyncIterable<string> => ({
        [Symbol.asyncIterator]: () => ({ next, return: async () => ({ done: true, value: undefined }) }),
      });
      const agent: ConversationAgent = {
        stream: (input, owner, signal) => {
          if (input.text !== 'yes') return base.stream(input, owner, signal);
          approvalSignals.push(signal);
          return approvalSignals.length === 1
            ? iterable(() => Promise.reject(new ChatAgentError('rate_limit_exceeded')))
            : iterable(() => new Promise<IteratorResult<string>>((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new DOMException('Fixture cancelled', 'AbortError')), { once: true });
            }));
        },
      };
      const suite = createChatAcceptanceProbes(agent);
      const result = suite.chat_plain_approval!();
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ status: 'down', reason: 'timeout' });
      await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
      expect(approvalSignals).toHaveLength(2);
      expect(approvalSignals[1]!.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    const suite = await probes(agent);

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
    const suite = await probes(passingAgent((input) => input.text === prompts[1] ? {
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
    const suite = await probes(passingAgent((input) => input.text === prompts[1] ? {
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
    const suite = await probes(passingAgent((input) => input.text === prompts[1] ? { text, calls: [...calls] } : undefined));

    await expect(suite.chat_capabilities!()).resolves.toEqual({ status: 'down', reason });
    await expect(suite.chat_canary!()).resolves.toEqual({ status: 'down', reason: 'acceptance_check_failed' });
  });

  it('reports wording-only identity and missing-image timestamp failures as warnings', async () => {
    const suite = await probes(passingAgent((input) => input.text === prompts[0]
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
    const suite = await probes(agent, () => now);

    await Promise.all(Object.values(suite).map((probe) => probe!()));
    await suite.chat_jobs!();
    expect(agent.stream).toHaveBeenCalledTimes(8);

    now = 60_000;
    const refreshed = suite.chat_jobs!();
    await vi.runAllTimersAsync();
    await refreshed;
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
      const suite = createChatAcceptanceProbes(stalled);
      const result = suite.chat_jobs!();
      await vi.runAllTimersAsync();
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

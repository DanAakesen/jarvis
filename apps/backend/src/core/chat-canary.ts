import {
  ChatAgentError,
  type ConversationAgent,
  type ConversationAgentToolCall,
} from './chat-agent.js';
import type { SystemStatusProbe } from '../system-status.js';
import type { SystemSmokeCheckId, SystemStatusValue } from '@jarvis/contracts';

const chatCanaryTimeoutMs = 55_000;
const chatCanaryCacheMs = 60_000;
const perPromptTimeoutMs = 25_000;

type AcceptanceCheckId =
  | 'chat_identity'
  | 'chat_capabilities'
  | 'chat_github_read'
  | 'chat_jobs'
  | 'chat_navigation'
  | 'chat_no_timestamp'
  | 'chat_plain_approval';
type SuiteCheckId = AcceptanceCheckId | 'chat_canary';
type CheckResult = { readonly status: SystemStatusValue; readonly reason?: string };
type SuiteResult = Record<SuiteCheckId, CheckResult>;

const prompts = {
  chat_identity: 'who are you and what can you do?',
  chat_capabilities: 'what can you do?',
  chat_github_read: 'what is in issue 700?',
  chat_jobs: 'what jobs are running?',
  chat_navigation: 'open the settings page',
  chat_no_timestamp: 'What does the image show, and when was it captured?',
  chat_plain_approval: 'Please run the no-op test action. Ask me before running it.',
} satisfies Record<AcceptanceCheckId, string>;
const suiteIds = [...(Object.keys(prompts) as AcceptanceCheckId[]), 'chat_canary'] as const;

function failed(id: AcceptanceCheckId, reason: string): CheckResult {
  return { status: id === 'chat_identity' || id === 'chat_no_timestamp' ? 'degraded' : 'down', reason };
}

async function runPrompt(
  agent: ConversationAgent,
  text: string,
  signal: AbortSignal,
  options: {
    readonly smokeHistory?: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
    readonly smokeApproval?: boolean;
  } = {},
): Promise<{ readonly text: string; readonly toolCalls: readonly ConversationAgentToolCall[] }> {
  const output: string[] = [];
  let toolCalls: readonly ConversationAgentToolCall[] = [];
  const response = agent.stream({
    messageId: '1',
    text,
    language: 'en',
    smoke: true,
    ...options,
    onAgentToolCalls: (calls) => { toolCalls = calls; },
  }, '', signal);
  for await (const chunk of response) output.push(chunk);
  return { text: output.join(''), toolCalls };
}

function result(status: SystemStatusValue, reason?: string): CheckResult {
  return { status, ...(reason && status === 'down' ? { reason } : {}) };
}

function callFor(
  calls: readonly ConversationAgentToolCall[],
  name: string,
  operation?: string,
): ConversationAgentToolCall | undefined {
  return calls.find((call) => call.name === name && (operation === undefined || call.operation === operation));
}

async function checkPrompt(
  id: AcceptanceCheckId,
  agent: ConversationAgent,
  signal: AbortSignal,
): Promise<CheckResult> {
  try {
    const promptController = new AbortController();
    let rejectDeadline: ((error: Error) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });
    const onSuiteAbort = () => {
      promptController.abort();
      rejectDeadline?.(new Error('suite_timeout'));
    };
    const timeout = setTimeout(() => {
      promptController.abort();
      rejectDeadline?.(new Error('prompt_timeout'));
    }, perPromptTimeoutMs);
    timeout.unref?.();
    if (signal.aborted) onSuiteAbort();
    else signal.addEventListener('abort', onSuiteAbort, { once: true });
    let response: Awaited<ReturnType<typeof runPrompt>>;
    try {
      response = await Promise.race([runPrompt(agent, prompts[id], promptController.signal), deadline]);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onSuiteAbort);
    }
    const text = response.text.toLowerCase();
    switch (id) {
      case 'chat_identity':
        return /\bi\b/u.test(text) && /\bjarvis\b/u.test(text) && !/\bgeneric assistant\b/u.test(text)
          ? result('ok')
          : failed(id, 'identity_reply');
      case 'chat_capabilities': {
        const capabilities = callFor(response.toolCalls, 'get_system_health', 'list_capabilities');
        return capabilities?.outcome === 'ok' &&
          (capabilities.capabilities ?? []).some((value) => /\bnotes?\b/iu.test(value)) &&
          (capabilities.capabilities ?? []).some((value) => /\bcalendar\b/iu.test(value)) &&
          (capabilities.capabilities ?? []).some((value) => /\bgithub\b/iu.test(value)) &&
          /\bnotes?\b/u.test(text) && /\bcalendar\b/u.test(text) && /\bgithub\b/u.test(text)
          ? result('ok')
          : failed(id, 'capabilities_missing');
      }
      case 'chat_github_read': {
        const issue = callFor(response.toolCalls, 'github_read', 'issue_get');
        return issue?.outcome === 'ok' && issue.number === 700 && Boolean(issue.title) &&
          text.includes(issue.title!.toLowerCase())
          ? result('ok')
          : failed(id, 'github_issue_unavailable');
      }
      case 'chat_jobs': {
        const jobs = callFor(response.toolCalls, 'list_jobs');
        return jobs?.outcome === 'ok' ? result('ok') : failed(id, 'jobs_unavailable');
      }
      case 'chat_navigation': {
        const navigation = callFor(response.toolCalls, 'workspace_command', 'navigate');
        return navigation?.page === 'settings' && navigation.outcome === 'refused' &&
          /no tab connected/iu.test(navigation.refusal ?? '')
          ? result('ok')
          : failed(id, 'navigation_refusal_missing');
      }
      case 'chat_no_timestamp':
        return ![
          /\b(?:captured|taken|recorded|shot)\s+(?:at|on|around|in)\b/iu,
          /\b(?:captured|taken|recorded|shot)\s+(?:today|yesterday|this morning|last night|last week)\b/iu,
          /\b(?:captured|taken|recorded|shot)\s+(?:(?:about|around)\s+)?\d/iu,
          /\b\d{1,2}:\d{2}\b|\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/iu,
          /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b/iu,
          /\b\d+\s+(?:seconds?|minutes?|hours?|days?)\s+ago\b/iu,
          /\b(?:image|photo|picture)\s+(?:is\s+)?from\s+(?:today|yesterday|this morning|last night|last week)\b/iu,
        ].some((pattern) => pattern.test(response.text))
          ? result('ok')
          : failed(id, 'capture_time_invented');
      case 'chat_plain_approval': {
        const confirmationCalls = response.toolCalls.filter((call) =>
          call.name === 'get_system_health' && call.operation === 'confirmation_test');
        const first = await runPrompt(agent, 'yes', signal, {
          smokeHistory: [
            { role: 'user', text: prompts.chat_plain_approval },
            { role: 'assistant', text: response.text },
          ],
          smokeApproval: true,
        });
        const approved = callFor(first.toolCalls, 'get_system_health', 'confirmation_test');
        return !confirmationCalls.some((call) => call.outcome === 'ok') &&
          approved?.outcome === 'ok' && approved.executed === true
          ? result('ok')
          : failed(id, 'plain_approval_failed');
      }
      default:
        return failed(id, 'agent_error');
    }
  } catch (error) {
    return failed(id, error instanceof ChatAgentError && error.code === 'catalogue_unavailable'
      ? 'catalogue_unavailable'
      : error instanceof Error && error.message === 'prompt_timeout' ? 'timeout' : 'agent_error');
  }
}

async function runSuite(agent: ConversationAgent | undefined): Promise<SuiteResult> {
  const ids = Object.keys(prompts) as AcceptanceCheckId[];
  if (!agent) {
    return Object.fromEntries([
      ['chat_canary', result('down', 'agent_error')],
      ...ids.map((id) => [id, failed(id, 'agent_error')]),
    ]) as SuiteResult;
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('suite_timeout'));
    }, chatCanaryTimeoutMs);
    timeout.unref?.();
  });
  try {
    const checks = await Promise.race([
      Promise.all(ids.map(async (id) => [id, await checkPrompt(id, agent, controller.signal)] as const)),
      deadline,
    ]);
    const entries = Object.fromEntries(checks) as Record<AcceptanceCheckId, CheckResult>;
    const hasFailure = ids.some((id) => id !== 'chat_identity' && id !== 'chat_no_timestamp' &&
      entries[id].status !== 'ok');
    return { ...entries, chat_canary: hasFailure ? result('down', 'acceptance_check_failed') : result('ok') };
  } catch {
    controller.abort();
    return Object.fromEntries([
      ['chat_canary', result('down', 'timeout')],
      ...ids.map((id) => [id, failed(id, 'timeout')]),
    ]) as SuiteResult;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createChatAcceptanceProbes(
  agent: ConversationAgent | undefined,
  now: () => number = Date.now,
): Partial<Record<SystemSmokeCheckId, SystemStatusProbe>> {
  let cachedAt = Number.NEGATIVE_INFINITY;
  let cached: SuiteResult | undefined;
  let pending: Promise<SuiteResult> | undefined;
  const getResult = async (id: SuiteCheckId): Promise<CheckResult> => {
    if (!pending && cached && now() - cachedAt < chatCanaryCacheMs) return cached[id];
    pending ??= runSuite(agent);
    try {
      cached = await pending;
      cachedAt = now();
      return cached[id];
    } finally {
      pending = undefined;
    }
  };
  return Object.fromEntries(
    suiteIds
      .map((id) => [id, async () => getResult(id)]),
  ) as Partial<Record<SystemSmokeCheckId, SystemStatusProbe>>;
}

export function createChatCanaryProbe(
  agent: ConversationAgent | undefined,
  now: () => number = Date.now,
): SystemStatusProbe {
  return createChatAcceptanceProbes(agent, now).chat_canary!;
}

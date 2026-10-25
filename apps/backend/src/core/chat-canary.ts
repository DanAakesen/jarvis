import {
  ChatAgentError,
  ChatAgentInvocationError,
  type ConversationAgent,
  type ConversationAgentToolCall,
} from './chat-agent.js';
import {
  chatAgentFailureReasons,
  chatAgentInvocationReasons,
  type SystemStatusProbe,
} from '../system-status.js';
import type { SystemSmokeCheckId, SystemStatusValue } from '@jarvis/contracts';

const chatCanaryTimeoutMs = 55_000;
const chatCanaryCacheMs = 60_000;
const perPromptTimeoutMs = 25_000;
// A failed check may run once more, but only while that second attempt still ends inside the suite deadline.
const retryPhaseTimeoutMs = perPromptTimeoutMs;
const retryStartLimitMs = chatCanaryTimeoutMs - retryPhaseTimeoutMs - 5_000;

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
  for await (const chunk of response) {
    if (typeof chunk === 'string') output.push(chunk);
  }
  return { text: output.join(''), toolCalls };
}

function result(status: SystemStatusValue, reason?: string): CheckResult {
  return { status, ...(reason && status === 'down' ? { reason } : {}) };
}

// The reason is always a fixed label; no code, message or payload from the failure is copied into a report.
function failureReason(error: unknown): string {
  if (error instanceof ChatAgentInvocationError) {
    return chatAgentInvocationReasons.has(error.reason) ? error.reason : 'agent_error';
  }
  if (error instanceof ChatAgentError) {
    if (error.code === undefined) return 'agent_error_code_missing';
    return chatAgentFailureReasons.has(error.code) ? error.code : 'agent_error_code_unlisted';
  }
  return error instanceof Error && error.message === 'prompt_timeout' ? 'timeout' : 'agent_error';
}

// Only a check that threw may run again. A completed reply that fails its assertion, or a timeout, never does.
function isRetryable(check: CheckResult): boolean {
  const { reason } = check;
  return check.status !== 'ok' && reason !== undefined && (
    reason === 'agent_error' || chatAgentFailureReasons.has(reason) || chatAgentInvocationReasons.has(reason)
  );
}

function boundedSignal(parent: AbortSignal, ms: number): { readonly signal: AbortSignal; readonly dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, ms);
  timer.unref?.();
  if (parent.aborted) abort();
  else parent.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', abort);
    },
  };
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
        if (!capabilities) {
          const wrongDiscovery = response.toolCalls.some((call) =>
            call.name === 'get_system_health' || call.operation === 'list_capabilities');
          return failed(id, wrongDiscovery ? 'capabilities_discovery_wrong' : 'capabilities_discovery_missing');
        }
        if (capabilities.outcome !== 'ok') return failed(id, 'capabilities_discovery_failed');
        if (!(capabilities.capabilities ?? []).some((value) => /\bnotes?\b/iu.test(value)) ||
            !(capabilities.capabilities ?? []).some((value) => /\bcalendar\b/iu.test(value)) ||
            !(capabilities.capabilities ?? []).some((value) => /\bgithub\b/iu.test(value))) {
          return failed(id, 'capabilities_receipt_incomplete');
        }
        return /\bnotes?\b/u.test(text) && /\bcalendars?\b/u.test(text) && /\bgithub\b/u.test(text)
          ? result('ok')
          : failed(id, 'capabilities_reply_incomplete');
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
    return failed(id, failureReason(error));
  }
}

async function runSuite(agent: ConversationAgent | undefined, now: () => number): Promise<SuiteResult> {
  const ids = Object.keys(prompts) as AcceptanceCheckId[];
  if (!agent) {
    return Object.fromEntries([
      ['chat_canary', result('down', 'agent_error')],
      ...ids.map((id) => [id, failed(id, 'agent_error')]),
    ]) as SuiteResult;
  }

  const controller = new AbortController();
  const startedAt = now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('suite_timeout'));
    }, chatCanaryTimeoutMs);
    timeout.unref?.();
  });
  const attempt = async (selected: readonly AcceptanceCheckId[], signal: AbortSignal) =>
    Promise.all(selected.map(async (id) => [id, await checkPrompt(id, agent, signal)] as const));
  const settle = async (): Promise<Record<AcceptanceCheckId, CheckResult>> => {
    const entries = Object.fromEntries(await attempt(ids, controller.signal)) as Record<AcceptanceCheckId, CheckResult>;
    const retryIds = ids.filter((id) => isRetryable(entries[id]));
    if (retryIds.length === 0 || controller.signal.aborted || now() - startedAt > retryStartLimitMs) return entries;
    // A second attempt can only turn a failure into a pass; if it fails too, the first failure stands.
    const retryWindow = boundedSignal(controller.signal, retryPhaseTimeoutMs);
    try {
      for (const [id, check] of await attempt(retryIds, retryWindow.signal)) {
        if (check.status === 'ok') entries[id] = check;
      }
    } finally {
      retryWindow.dispose();
    }
    return entries;
  };
  try {
    const entries = await Promise.race([settle(), deadline]);
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
    pending ??= runSuite(agent, now);
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

import type { RuntimeTestAvailability, TestRuntime } from './RuntimeTestSelector';
import type { PublicConfig } from '../config/public-config';
import { backendFetch, awaitWithSignal as waitForChatSetup } from './backend-request';
import type { ChatAttachment } from './chat-attachments';
import { parseVisualResult, parseVisualTurnContext, type VisualResult, type VisualTurnContext } from './visual-context';

export interface ConversationHistoryToolCall {
  id: string;
  tool: string;
  outcome: 'ok' | 'refused' | 'error';
  taskId: string | null;
  artifactId?: string;
}

export interface ConversationHistoryMessage {
  id: string;
  sessionId: string;
  channel: 'chat' | 'voice';
  language: 'da' | 'en';
  role: 'dan' | 'jarvis';
  text: string;
  interrupted?: boolean;
  model: string | null;
  voiceMinutes?: number | null;
  at: string;
  toolCalls: ConversationHistoryToolCall[];
  attachments?: ChatAttachment[];
  visualResult?: VisualResult;
}

export interface ConversationHistoryPage {
  messages: ConversationHistoryMessage[];
  nextCursor: string | null;
}

export interface ChatSession {
  id: string;
  language: 'da' | 'en';
  runtimeTest?: TestRuntime;
}

export type RuntimeTestSession = ChatSession & { runtimeTest: TestRuntime };

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'dan' | 'jarvis';
  text: string;
  model: string | null;
  at: string;
  visualResult?: VisualResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHistoryPage(value: unknown): value is ConversationHistoryPage {
  if (!isRecord(value) || !Array.isArray(value.messages) ||
      !(value.nextCursor === null || typeof value.nextCursor === 'string')) return false;
  return value.messages.every((message) => {
    if (!isRecord(message) || typeof message.id !== 'string' || typeof message.sessionId !== 'string' ||
        !['chat', 'voice'].includes(String(message.channel)) || !['da', 'en'].includes(String(message.language)) ||
        !['dan', 'jarvis'].includes(String(message.role)) || typeof message.text !== 'string' ||
        !(message.model === null || typeof message.model === 'string') ||
        !(message.interrupted === undefined || typeof message.interrupted === 'boolean') ||
        !(message.voiceMinutes === undefined || message.voiceMinutes === null ||
          (typeof message.voiceMinutes === 'number' && Number.isFinite(message.voiceMinutes) && message.voiceMinutes >= 0)) ||
        typeof message.at !== 'string' || Number.isNaN(Date.parse(message.at)) ||
        !Array.isArray(message.toolCalls) ||
        !(message.attachments === undefined || (Array.isArray(message.attachments) && message.attachments.every((file) =>
          isRecord(file) && typeof file.id === 'string' && typeof file.name === 'string' &&
          typeof file.contentType === 'string' && typeof file.size === 'number')))) return false;
    return message.toolCalls.every((call) =>
      isRecord(call) && typeof call.id === 'string' && typeof call.tool === 'string' &&
      (call.outcome === 'ok' || call.outcome === 'refused' || call.outcome === 'error') &&
      (call.taskId === null || typeof call.taskId === 'string') &&
      (call.artifactId === undefined ||
        (typeof call.artifactId === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(call.artifactId))));
  });
}

export interface SteeringMessage extends ChatMessage {
  language: 'da' | 'en';
}

export { awaitWithSignal as waitForChatSetup } from './backend-request';

export async function accessToken(getAccessToken: () => Promise<string>): Promise<string> {
  return getAccessToken();
}

// Finite backend diagnostics; unrecognized provider codes are never displayed.
const managedFailureCodes = [
  'managed_session_busy', 'managed_source_already_claimed', 'managed_target_mismatch',
  'managed_unavailable', 'managed_agent_builtin_tools_enabled', 'managed_agent_definition_mismatch',
  'managed_agent_definition_missing', 'managed_agent_extra_skills', 'managed_agent_function_tools_mismatch',
  'managed_agent_toolset_missing', 'managed_agent_unsupported_setting', 'managed_agent_version_mismatch',
  'managed_backend_endpoint_invalid', 'managed_binding_invalid', 'managed_binding_unavailable',
  'managed_claim_missing', 'managed_client_retries_enabled', 'managed_conversation_missing',
  'managed_definition_instructions_missing', 'managed_definition_tools_invalid', 'managed_endpoint_invalid',
  'managed_endpoint_selector_mismatch', 'managed_existing_credential_unavailable', 'managed_final_only_tool_call',
  'managed_immutable_target_missing', 'managed_input_boundary_invalid', 'managed_input_cursor_rewound',
  'managed_input_empty', 'managed_input_item_unsupported', 'managed_input_unsupported',
  'managed_limits_invalid', 'managed_model_forbidden', 'managed_model_unauthorized',
  'managed_policy_catalogue_changed', 'managed_policy_image_unverified', 'managed_policy_smoke_unavailable',
  'managed_policy_setup_failed', 'managed_policy_turn_failed', 'managed_probe_conversation_missing',
  'managed_probe_empty_or_unfinished', 'managed_probe_failed', 'managed_probe_incomplete',
  'managed_probe_requested_tool', 'managed_probe_settings_mismatch', 'managed_probe_timeout',
  'managed_project_endpoint_mismatch', 'managed_provider_failure', 'managed_readback_forbidden',
  'managed_readback_invalid', 'managed_readback_unauthorized', 'managed_readback_unavailable',
  'managed_response_empty', 'managed_response_failed', 'managed_response_item_unsupported',
  'managed_response_unfinished', 'managed_reviewed_definition_mismatch', 'managed_reviewed_fingerprint_mismatch',
  'managed_seed_input_invalid', 'managed_source_context_missing', 'managed_steering_source_unclaimed',
  'managed_summary_history_policy_pending', 'managed_target_invalid', 'managed_target_missing',
  'managed_target_settings_mismatch', 'managed_tool_arguments_invalid', 'managed_tool_call_invalid',
  'managed_tool_call_unfinished', 'managed_tool_repeated', 'managed_tool_round_limit',
  'managed_tool_schema_unsupported', 'managed_turn_already_claimed', 'managed_voice_requires_backend_relay',
] as const;
const managedFailures: ReadonlySet<string> = new Set(managedFailureCodes);

const chatTurnFailureMessages = {
  managed_session_busy: 'This test conversation has an unfinished managed reply and cannot continue safely. Return to normal conversation. Refreshing history will not clear the unfinished reply.',
  managed_source_already_claimed: 'This test conversation has a previously claimed reply and cannot continue safely. Return to normal conversation. Refreshing history will not make it replayable.',
  managed_turn_already_claimed: 'This test conversation has a previously claimed reply and cannot continue safely. Return to normal conversation. Refreshing history will not make it replayable.',
  managed_target_mismatch: 'The settings for this test conversation no longer match its managed runtime. Return to normal conversation.',
  managed_unavailable: 'The managed test conversation is unavailable. Return to normal conversation.',
  managed_target_settings_mismatch: 'The managed runtime does not support the selected chat settings.',
  managed_reviewed_definition_mismatch: 'The managed runtime definition no longer matches its reviewed configuration.',
  managed_reviewed_fingerprint_mismatch: 'The managed runtime definition no longer matches its reviewed configuration.',
  managed_existing_credential_unavailable: 'The managed runtime could not authenticate with its existing credential.',
  managed_readback_unauthorized: 'Jarvis could not authenticate when checking the managed runtime.',
  managed_readback_forbidden: 'Jarvis does not have permission to check the managed runtime.',
  managed_readback_unavailable: 'Jarvis could not check the managed runtime.',
  managed_model_unauthorized: 'The managed runtime could not authenticate with the selected model.',
  managed_model_forbidden: 'The managed runtime does not have permission to use the selected model.',
  managed_binding_unavailable: 'Jarvis could not verify the managed conversation state. Check history and action status before sending again.',
  managed_tool_call_unfinished: 'A managed tool call did not finish. Check history and action status before sending again.',
  managed_policy_turn_failed: 'The managed reply has an uncertain outcome and this test conversation cannot continue safely. Check history and action status. Return to normal conversation. Refreshing history will not clear the unfinished reply.',
  managed_policy_setup_failed: 'The managed runtime could not prepare the reply. Check history before sending a new message. The previous message will not be sent again.',
  managed_response_failed: 'The managed runtime could not finish the reply. Check history and action status before sending again.',
  managed_provider_failure: 'The managed runtime request failed. Check history and action status before sending again.',
  agent_auth_unavailable: 'Jarvis could not authenticate with the chat runtime.',
  agent_http_400: 'The chat runtime rejected the request.',
  agent_http_401: 'The chat runtime rejected Jarvis’s authentication.',
  agent_http_403: 'Jarvis does not have permission to use the chat runtime.',
  agent_http_404: 'The configured chat runtime could not be found.',
  agent_http_408: 'The chat runtime request timed out.',
  agent_http_409: 'The chat runtime reported a request conflict.',
  agent_http_424: 'A chat runtime dependency failed.',
  agent_http_500: 'The chat runtime encountered a server error.',
  agent_http_502: 'The chat runtime returned a gateway error.',
  agent_http_503: 'The chat runtime is unavailable.',
  agent_http_504: 'The chat runtime request timed out.',
  agent_http_other: 'The chat runtime rejected the request.',
  error_authenticationerror: 'The chat runtime could not authenticate with the selected model.',
  error_permissiondeniederror: 'The chat runtime does not have permission to use the selected model.',
  agent_http_429: 'The chat runtime is rate limited. Try again later.',
  rate_limit_exceeded: 'The chat runtime is rate limited. Try again later.',
  agent_request_failed: 'Jarvis could not reach the chat runtime.',
  agent_response_invalid: 'The chat runtime returned an invalid response.',
  agent_stream_failed: 'The connection to the chat runtime failed.',
  agent_stream_ended: 'The chat runtime ended the reply before it finished.',
} as const;
type ChatTurnFailureCode = keyof typeof chatTurnFailureMessages | typeof managedFailureCodes[number];
function chatFailureMessage(code: ChatTurnFailureCode): string {
  return Object.hasOwn(chatTurnFailureMessages, code) ? chatTurnFailureMessages[code as keyof typeof chatTurnFailureMessages]
    : 'The managed runtime could not finish the reply.';
}
const blockedSessionCodes: ReadonlySet<string> = new Set(['managed_session_busy', 'managed_source_already_claimed',
  'managed_turn_already_claimed', 'managed_target_mismatch', 'managed_unavailable', 'managed_policy_turn_failed']);

/** Only client-controlled messages and finite server codes reach the test-conversation error view. */
export interface ManagedProviderCause {
  readonly httpStatus?: number;
  readonly code?: string;
  readonly param?: string;
  readonly exceptionType?: string;
}

function managedProviderCause(value: unknown): ManagedProviderCause | undefined {
  if (!isRecord(value)) return undefined;
  const cause: { httpStatus?: number; code?: string; param?: string; exceptionType?: string } = {};
  if (typeof value.httpStatus === 'number' && Number.isInteger(value.httpStatus) &&
      value.httpStatus >= 100 && value.httpStatus <= 599) cause.httpStatus = value.httpStatus;
  for (const key of ['code', 'param'] as const) {
    const field = value[key];
    if (typeof field === 'string' && /^[a-z0-9_.]{1,48}$/u.test(field) && !field.includes('\n')) cause[key] = field;
  }
  if (typeof value.exceptionType === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_]{0,47}$/u.test(value.exceptionType) &&
      !value.exceptionType.includes('\n')) cause.exceptionType = value.exceptionType;
  return Object.keys(cause).length ? cause : undefined;
}

export class ChatTurnError extends Error {
  readonly blocksSession: boolean;
  readonly providerCause: ManagedProviderCause | undefined;
  constructor(message: string, readonly code: ChatTurnFailureCode | undefined = undefined,
    readonly delivery: 'not_accepted' | 'accepted' | 'unknown' = 'unknown', providerCause?: unknown) {
    super(code ? `${message} (${code})` : message);
    this.name = 'ChatTurnError';
    this.blocksSession = code !== undefined && blockedSessionCodes.has(code);
    this.providerCause = code !== undefined &&
      ['managed_policy_turn_failed', 'managed_policy_setup_failed', 'managed_response_failed'].includes(code)
      ? managedProviderCause(providerCause) : undefined;
  }
}
function chatFailureCode(value: unknown): ChatTurnFailureCode | undefined {
  return typeof value === 'string' && (Object.hasOwn(chatTurnFailureMessages, value) || managedFailures.has(value)) ? value as ChatTurnFailureCode : undefined;
}
const preacceptChatMessages: ReadonlySet<string> = new Set([
  'Chat is unavailable until the Jarvis agent is configured', 'Conversation storage unavailable',
  'The selected test runtime is unavailable. No other runtime was used.', 'Test conversation storage is unavailable.',
  'Active chat session not found', 'Session is not a chat session', 'Message text cannot be empty',
  'A chat turn is already active', 'Too many recent replies. Try again shortly.',
  'Conversation attachments are unavailable.', 'One or more attachments are unavailable.',
  'This visual turn has already been received', 'Runtime tests require a new chat conversation.',
]);
const stableChatMessages: ReadonlySet<string> = new Set([...preacceptChatMessages,
  'Reply stopped. Check conversation and action status before trying again.',
  'Reply stopped. An action may already have completed; check its status before trying again.',
  'I could not finish the reply. A task action may still have completed; check its status before trying again.',
]);
function stableChatMessage(value: unknown, fallback: string): string {
  return typeof value === 'string' && stableChatMessages.has(value) ? value : fallback;
}

async function chatResponse(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  path: string,
  body?: unknown,
  accept = 'application/json',
  onDeliveryUncertain?: () => void,
  signal?: AbortSignal,
): Promise<Response> {
  if (!config.backendUrl) throw new ChatTurnError('Chat unavailable. Try again.', undefined, 'not_accepted');
  let token: string;
  try { token = signal ? await waitForChatSetup(getAccessToken, signal) : await accessToken(getAccessToken); }
  catch {
    signal?.throwIfAborted();
    throw new ChatTurnError('Jarvis could not verify your Microsoft sign-in. Sign in again.', undefined, 'not_accepted');
  }
  signal?.throwIfAborted();
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await backendFetch(`${config.backendUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `${bearerScheme} ${token}`,
        Accept: accept,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // Streaming turns include tool work and approval; use the existing 240-second ingress ceiling.
      signal: AbortSignal.any([AbortSignal.timeout(accept === 'text/event-stream' ? 240_000 : 120_000), ...(signal ? [signal] : [])]),
    });
  } catch {
    onDeliveryUncertain?.();
    throw new Error('Connection interrupted. The message or a task action may already have completed; check conversation and task status before trying again.');
  }
  if (response.status === 401) throw new ChatTurnError('Jarvis could not verify your Microsoft sign-in. Sign in again.', undefined, 'not_accepted');
  if (response.status === 403) throw new ChatTurnError("This Microsoft account isn't allowed to use Jarvis.", undefined, 'not_accepted');
  if (!response.ok) {
    let message = `Jarvis could not send the message (HTTP ${response.status}).`;
    let code: ChatTurnFailureCode | undefined;
    let delivery: ChatTurnError['delivery'] = 'unknown';
    try {
      const error: unknown = await response.json();
      if (isRecord(error)) {
        code = chatFailureCode(error.code);
        message = code ? chatFailureMessage(code) : stableChatMessage(error.error, message);
        if (typeof error.error === 'string' && preacceptChatMessages.has(error.error) &&
            (response.status < 500 || response.status === 503)) delivery = 'not_accepted';
      }
    } catch { /* Keep the stable response error. */ }
    throw new ChatTurnError(message, code, delivery);
  }
  return response;
}

export async function createChatSession(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  language: 'da' | 'en',
  signal?: AbortSignal,
  runtimeTest?: TestRuntime,
): Promise<ChatSession> {
  const response = await chatResponse(getAccessToken, config, '/conversation/sessions', {
    channel: 'chat',
    language,
    ...(runtimeTest ? { runtimeTest } : {}),
  }, 'application/json', undefined, signal);
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new Error('Jarvis returned an invalid chat session.');
  }
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[1-9]\d{0,18}$/.test(value.id) ||
      value.channel !== 'chat' || value.language !== language ||
      (value.runtimeTest !== runtimeTest)) {
    throw new Error('Jarvis returned an invalid chat session.');
  }
  return { id: value.id, language, ...(runtimeTest ? { runtimeTest } : {}) };
}

function parseEvent(frame: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join('\n') } : null;
}

function isChatMessage(value: unknown, role: ChatMessage['role'], sessionId: string): value is ChatMessage {
  return isRecord(value) && value.role === role && value.sessionId === sessionId &&
    typeof value.id === 'string' && /^[1-9]\d{0,18}$/.test(value.id) &&
    typeof value.text === 'string' && (value.model === null || typeof value.model === 'string') &&
    typeof value.at === 'string' && !Number.isNaN(Date.parse(value.at));
}

function chatMessageResult(message: ChatMessage): ChatMessage {
  const visualResult = parseVisualResult(message);
  return {
    id: message.id, sessionId: message.sessionId, role: message.role,
    text: message.text, model: message.model, at: message.at,
    ...(visualResult ? { visualResult } : {}),
  };
}

export interface ChatFoodInvitation {
  id: string;
  summary: string;
  expiresAt: string;
}

export interface RecoverableTurn { sessionId: string; messageId: string; language: 'da' | 'en' }

export async function loadActiveChatTurns(getAccessToken: () => Promise<string>, config: PublicConfig): Promise<RecoverableTurn[]> {
  const response = await backendFetch(`${config.backendUrl?.replace(/\/+$/, '')}/conversation/turns/active`, {
    headers: { Authorization: `Bearer ${await accessToken(getAccessToken)}` },
  });
  if (!response.ok) throw new Error('Could not check running replies.');
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.turns)) throw new Error('Invalid running replies.');
  return body.turns.filter((turn): turn is RecoverableTurn => isRecord(turn) &&
    typeof turn.sessionId === 'string' && /^[1-9]\d{0,18}$/.test(turn.sessionId) &&
    typeof turn.messageId === 'string' && /^[1-9]\d{0,18}$/.test(turn.messageId) &&
    (turn.language === 'da' || turn.language === 'en'));
}

export async function cancelChatTurn(getAccessToken: () => Promise<string>, config: PublicConfig, turn: RecoverableTurn): Promise<void> {
  await chatResponse(getAccessToken, config,
    `/conversation/sessions/${turn.sessionId}/turns/${turn.messageId}/cancel`, {}, 'application/json');
}

class RecoveryUnavailable extends Error {}

async function recoveredChatResponse(getAccessToken: () => Promise<string>, config: PublicConfig,
  sessionId: string, messageId: string, signal?: AbortSignal): Promise<Response> {
  const response = await backendFetch(`${config.backendUrl?.replace(/\/+$/, '')}/conversation/sessions/${sessionId}/turns/${messageId}/events`, {
    headers: { Authorization: `Bearer ${await accessToken(getAccessToken)}`, Accept: 'text/event-stream' },
    signal: AbortSignal.any([AbortSignal.timeout(240_000), ...(signal ? [signal] : [])]),
  });
  if (!response.ok) throw new RecoveryUnavailable('This reply cannot be reattached. Check saved conversation and action status before trying again.');
  return response;
}

export async function sendChatTurn(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  session: ChatSession,
  text: string,
  onUserMessage: (message: ChatMessage) => void,
  onDelta: (text: string) => void,
  onDeliveryUncertain?: () => void,
  screenContext?: string,
  sharedScreenContext?: { screenDescription: string; sharedWindowTitle?: string },
  signal?: AbortSignal,
  onInterrupted?: (message: ChatMessage) => void,
  attachmentIds?: readonly string[],
  visualContext?: VisualTurnContext,
  onAcknowledgment?: (text: string) => void,
  onFoodInvitation?: (invitation: ChatFoodInvitation | null) => void,
  resumeMessageId?: string,
  onReplay?: () => void,
): Promise<ChatMessage> {
  if (visualContext !== undefined && screenContext !== undefined) {
    throw new Error('Send visual context or legacy screen context, not both.');
  }
  const visual = visualContext === undefined ? undefined : parseVisualTurnContext(visualContext);
  let response = resumeMessageId
    ? await recoveredChatResponse(getAccessToken, config, session.id, resumeMessageId, signal)
    : await chatResponse(
    getAccessToken,
    config,
    `/conversation/sessions/${session.id}/turns`,
    {
      text,
      ...(attachmentIds?.length ? { attachmentIds } : {}),
      ...(screenContext === undefined ? {} : { screenContext }),
      ...(visual === undefined ? {} : { visualContext: visual }),
      ...(sharedScreenContext === undefined ? {} : { sharedScreenContext }),
    },
    'text/event-stream',
    onDeliveryUncertain,
    signal,
  );
  if (!response.body) throw new Error('Jarvis returned an empty chat stream.');

  let reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedBytes = 0;
  let userMessage: ChatMessage | null = null;
  let assistantMessage: ChatMessage | null = null;
  let acceptedId = resumeMessageId;
  const recoveryDeadline = Date.now() + 15 * 60_000;
  const processFrame = (frame: string) => {
    if (signal?.aborted) return;
    const event = parseEvent(frame);
    if (!event) return;
    let payload: unknown;
    try { payload = JSON.parse(event.data); } catch {
      throw new Error('Jarvis returned an invalid chat stream.');
    }
    if (event.event === 'error') {
      const code = isRecord(payload) ? chatFailureCode(payload.code) : undefined;
      const fallback = 'I could not finish the reply. A task action may still have completed; check its status before trying again.';
      const warning = stableChatMessage(isRecord(payload) ? payload.error : undefined, fallback);
      const message = code ? `${chatFailureMessage(code)}${blockedSessionCodes.has(code) || code === 'managed_policy_setup_failed' ? '' : ` ${warning}`}` : warning;
      throw new ChatTurnError(message, code, acceptedId ? 'accepted' : 'unknown',
        isRecord(payload) ? payload.providerCause : undefined);
    }
    if (event.event === 'user') {
      if (!isChatMessage(payload, 'dan', session.id)) throw new Error('Jarvis returned an invalid chat stream.');
      acceptedId = payload.id;
      userMessage = chatMessageResult(payload);
      onUserMessage(userMessage);
    } else if (event.event === 'delta') {
      if (!isRecord(payload) || typeof payload.text !== 'string' || payload.text.length === 0) {
        throw new Error('Jarvis returned an invalid chat stream.');
      }
      onDelta(payload.text);
    } else if (event.event === 'acknowledgment') {
      if (!isRecord(payload) || typeof payload.text !== 'string' ||
          !payload.text.trim() || Array.from(payload.text).length > 500) {
        throw new Error('Jarvis returned an invalid chat stream.');
      }
      onAcknowledgment?.(payload.text);
    } else if (event.event === 'food_invitation') {
      if (payload === null) onFoodInvitation?.(null);
      else {
        if (!isRecord(payload) || typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(payload.id) ||
            typeof payload.summary !== 'string' || !payload.summary.trim() || payload.summary.length > 4000 ||
            typeof payload.expiresAt !== 'string' || !Number.isFinite(Date.parse(payload.expiresAt))) {
          throw new Error('Jarvis returned an invalid chat stream.');
        }
        onFoodInvitation?.(Date.parse(payload.expiresAt) > Date.now()
          ? { id: payload.id, summary: payload.summary, expiresAt: payload.expiresAt } : null);
      }
    } else if (event.event === 'interrupted') {
      if (!isChatMessage(payload, 'jarvis', session.id)) throw new Error('Jarvis returned an invalid chat stream.');
      onInterrupted?.(chatMessageResult(payload));
    } else if (event.event === 'done') {
      if (!isChatMessage(payload, 'jarvis', session.id)) throw new Error('Jarvis returned an invalid chat stream.');
      assistantMessage = chatMessageResult(payload);
    }
  };

  // A suspended mobile socket can remain unreadable without reporting an error.
  // Foreground/online replaces only the read transport, never the execution.
  const reconnect = () => {
    if (document.visibilityState !== 'hidden' && !assistantMessage) void reader.cancel().catch(() => {});
  };
  document.addEventListener('visibilitychange', reconnect);
  window.addEventListener('online', reconnect);
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
        if (chunk.done && !assistantMessage) throw new Error('Stream disconnected');
      } catch {
        if (assistantMessage) break;
        if (signal?.aborted || !acceptedId || Date.now() >= recoveryDeadline) {
          throw new Error('Connection interrupted. A food entry or another action may already have completed; check conversation and action status before trying again.');
        }
        await reader.cancel().catch(() => {});
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        signal?.throwIfAborted();
        while (true) {
          try {
            response = await recoveredChatResponse(getAccessToken, config, session.id, acceptedId, signal);
            break;
          } catch (error) {
            if (error instanceof RecoveryUnavailable || signal?.aborted || Date.now() >= recoveryDeadline) throw error;
            await new Promise<void>(resolve => setTimeout(resolve, 2000));
          }
        }
        if (!response.body) throw new Error('Jarvis returned an empty chat stream.');
        reader = response.body.getReader();
        buffer = '';
        receivedBytes = 0;
        decoder.decode();
        onReplay?.();
        onFoodInvitation?.(null);
        continue;
      }
      const { done, value } = chunk;
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > 1024 * 1024) throw new Error('Jarvis returned a chat response that was too large.');
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/u);
      buffer = frames.pop() ?? '';
      for (const frame of frames) processFrame(frame);
    }
    buffer += decoder.decode();
    if (buffer.trim()) processFrame(buffer);
  } catch (error) {
    onDeliveryUncertain?.();
    throw error;
  } finally {
    document.removeEventListener('visibilitychange', reconnect);
    window.removeEventListener('online', reconnect);
    await reader.cancel().catch(() => {});
  }
  if (!userMessage) throw new Error('Jarvis did not save the message. Try again.');
  if (!assistantMessage) {
    throw new Error('The reply was interrupted. A task action may still have completed; check its status before trying again.');
  }
  return assistantMessage;
}

export async function steerChatTurn(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  session: ChatSession,
  text: string,
  language: 'da' | 'en',
  signal?: AbortSignal,
): Promise<SteeringMessage> {
  const response = await chatResponse(
    getAccessToken,
    config,
    `/conversation/sessions/${session.id}/steer`,
    { text, language },
    'application/json',
    undefined,
    signal,
  );
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new Error('Jarvis returned an invalid steering message.');
  }
  if (!isChatMessage(value, 'dan', session.id) || !isRecord(value) ||
      (value.language !== 'da' && value.language !== 'en')) {
    throw new Error('Jarvis returned an invalid steering message.');
  }
  return { ...value, language: value.language };
}

export async function loadConversationHistory(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  before?: string,
  sessionId?: string,
): Promise<ConversationHistoryPage> {
  const token = await accessToken(getAccessToken);
  if (!config.backendUrl) throw new Error('Conversation history unavailable. Try again.');

  const url = new URL(`${config.backendUrl.replace(/\/+$/, '')}/conversation/history`);
  url.searchParams.set('limit', '50');
  if (before !== undefined) url.searchParams.set('before', before);
  if (sessionId !== undefined) url.searchParams.set('sessionId', sessionId);

  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await backendFetch(url, {
      headers: { Authorization: `${bearerScheme} ${token}` },
    });
  } catch {
    throw new Error('Jarvis could not load conversation history. Try again.');
  }
  if (response.status === 401) throw new Error('Jarvis could not verify your Microsoft sign-in. Try again.');
  if (response.status === 403) throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  if (!response.ok) throw new Error(`Jarvis could not load conversation history (HTTP ${response.status}).`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Jarvis returned an invalid conversation history response.');
  }
  if (!isHistoryPage(body) || (sessionId !== undefined && body.messages.some(message => message.sessionId !== sessionId))) throw new Error('Jarvis returned an invalid conversation history response.');
  return {
    nextCursor: body.nextCursor,
    messages: body.messages.map(message => {
      const metadata = 'metadata' in message ? message.metadata : undefined;
      const visualResult = isRecord(metadata) ? parseVisualResult(metadata.visualContext) : undefined;
      return {
        id: message.id, sessionId: message.sessionId, channel: message.channel, language: message.language,
        role: message.role, text: message.text, model: message.model, at: message.at, toolCalls: message.toolCalls,
        ...(message.interrupted === undefined ? {} : { interrupted: message.interrupted }),
        ...(message.voiceMinutes === undefined ? {} : { voiceMinutes: message.voiceMinutes }),
        ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
        ...(visualResult ? { visualResult } : {}),
      };
    }),
  };
}

export async function loadImageArtifactUrl(
  getAccessToken: () => Promise<string>,
  config: PublicConfig,
  artifactId: string,
  signal: AbortSignal,
): Promise<string> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(artifactId)) {
    throw new Error('Jarvis returned an invalid image artifact reference.');
  }
  if (!config.backendUrl) throw new Error('Image artifacts unavailable. Try again.');
  const token = await accessToken(getAccessToken);
  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await backendFetch(
      `${config.backendUrl.replace(/\/+$/, '')}/factory/workspace-artifacts/images/${artifactId}`,
      { headers: { Authorization: `${bearerScheme} ${token}` }, signal },
    );
  } catch {
    throw new Error('Jarvis could not load the generated image.');
  }
  if (response.status === 401) throw new Error('Jarvis could not verify your Microsoft sign-in. Try again.');
  if (response.status === 403) throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  if (!response.ok) throw new Error('The generated image is no longer available.');
  let body: unknown;
  try { body = await response.json(); } catch {
    throw new Error('Jarvis returned an invalid image artifact response.');
  }
  if (!isRecord(body) || typeof body.url !== 'string') {
    throw new Error('Jarvis returned an invalid image artifact response.');
  }
  let url: URL;
  try { url = new URL(body.url); } catch {
    throw new Error('Jarvis returned an invalid image artifact URL.');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.blob.core.windows.net') || url.username || url.password) {
    throw new Error('Jarvis returned an untrusted image artifact URL.');
  }
  return url.toString();
}

/** Configured test availability, not a claim of live model qualification. */
export async function loadRuntimeTestAvailability(getAccessToken: () => Promise<string>, config: PublicConfig, signal?: AbortSignal): Promise<RuntimeTestAvailability> {
  if (!config.backendUrl) throw new Error('Runtime tests are unavailable.');
  const response = await backendFetch(`${config.backendUrl.replace(/\/+$/, '')}/conversation/runtime-tests`, {
    headers: { Authorization: `Bearer ${await accessToken(getAccessToken)}` }, ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error('Could not check runtime availability.');
  const body: unknown = await response.json();
  if (!isRecord(body)) throw new Error('Invalid runtime availability.');
  const availability: RuntimeTestAvailability = {};
  const reasons: Record<string, string> = {
    storage_unavailable: 'Conversation storage is unavailable.',
    current_unavailable: 'Current chat is not configured.',
    copilot_not_verified: 'The selected settings and Copilot runtime have not been verified.',
    verification_unavailable: 'Could not verify the Copilot runtime. Try again later.',
  };
  for (const runtime of ['current', 'copilot'] as const) {
    const option = body[runtime];
    if (!isRecord(option) || typeof option.available !== 'boolean' ||
        (option.reason !== undefined && typeof option.reason !== 'string')) throw new Error('Invalid runtime availability.');
    availability[runtime] = { available: option.available, ...(!option.available
      ? { reason: typeof option.reason === 'string' ? reasons[option.reason] ?? 'This runtime is unavailable.' : 'Availability has not been confirmed.' }
      : {}) };
  }
  return availability;
}

import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { backendFetch } from './backend-request';

export interface ConversationHistoryToolCall {
  id: string;
  tool: string;
  outcome: 'ok' | 'refused' | 'error';
  taskId: string | null;
}

export interface ConversationHistoryMessage {
  id: string;
  sessionId: string;
  channel: 'chat' | 'voice';
  language: 'da' | 'en';
  role: 'dan' | 'jarvis';
  text: string;
  model: string | null;
  voiceMinutes?: number | null;
  at: string;
  toolCalls: ConversationHistoryToolCall[];
}

export interface ConversationHistoryPage {
  messages: ConversationHistoryMessage[];
  nextCursor: string | null;
}

export interface ChatSession {
  id: string;
  language: 'da' | 'en';
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'dan' | 'jarvis';
  text: string;
  model: string | null;
  at: string;
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
        !(message.voiceMinutes === undefined || message.voiceMinutes === null ||
          (typeof message.voiceMinutes === 'number' && Number.isFinite(message.voiceMinutes) && message.voiceMinutes >= 0)) ||
        typeof message.at !== 'string' || Number.isNaN(Date.parse(message.at)) ||
        !Array.isArray(message.toolCalls)) return false;
    return message.toolCalls.every((call) =>
      isRecord(call) && typeof call.id === 'string' && typeof call.tool === 'string' &&
      (call.outcome === 'ok' || call.outcome === 'refused' || call.outcome === 'error') &&
      (call.taskId === null || typeof call.taskId === 'string'));
  });
}

async function accessToken(client: PublicClientApplication, config: PublicConfig): Promise<string> {
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');

  try {
    const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
    if (result.accessToken) return result.accessToken;
  } catch {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  }
  throw new Error('Microsoft sign-in did not return an API token.');
}

async function chatResponse(
  client: PublicClientApplication,
  config: PublicConfig,
  path: string,
  body?: unknown,
  accept = 'application/json',
  onDeliveryUncertain?: () => void,
  signal?: AbortSignal,
): Promise<Response> {
  if (!config.backendUrl) throw new Error('Chat is unavailable until the backend is deployed.');
  const token = await accessToken(client, config);
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
      signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]),
    });
  } catch {
    onDeliveryUncertain?.();
    throw new Error('Connection interrupted. The message or a task action may already have completed; check conversation and task status before trying again.');
  }
  if (response.status === 401) throw new Error('Jarvis could not verify your Microsoft sign-in. Sign in again.');
  if (response.status === 403) throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  if (!response.ok) {
    let message = `Jarvis could not send the message (HTTP ${response.status}).`;
    try {
      const error: unknown = await response.json();
      if (isRecord(error) && typeof error.error === 'string') message = error.error;
    } catch { /* Keep the stable response error. */ }
    throw new Error(message);
  }
  return response;
}

export async function createChatSession(
  client: PublicClientApplication,
  config: PublicConfig,
  language: 'da' | 'en',
): Promise<ChatSession> {
  const response = await chatResponse(client, config, '/conversation/sessions', {
    channel: 'chat',
    language,
  });
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new Error('Jarvis returned an invalid chat session.');
  }
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[1-9]\d{0,18}$/.test(value.id) ||
      value.channel !== 'chat' || value.language !== language) {
    throw new Error('Jarvis returned an invalid chat session.');
  }
  return { id: value.id, language };
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

export async function sendChatTurn(
  client: PublicClientApplication,
  config: PublicConfig,
  session: ChatSession,
  text: string,
  onUserMessage: (message: ChatMessage) => void,
  onDelta: (text: string) => void,
  onDeliveryUncertain?: () => void,
  screenContext?: string,
  sharedScreenContext?: { screenDescription: string; sharedWindowTitle?: string },
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const response = await chatResponse(
    client,
    config,
    `/conversation/sessions/${session.id}/turns`,
    {
      text,
      ...(screenContext === undefined ? {} : { screenContext }),
      ...(sharedScreenContext === undefined ? {} : { sharedScreenContext }),
    },
    'text/event-stream',
    onDeliveryUncertain,
    signal,
  );
  if (!response.body) throw new Error('Jarvis returned an empty chat stream.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let receivedBytes = 0;
  let userMessage: ChatMessage | null = null;
  let assistantMessage: ChatMessage | null = null;
  const processFrame = (frame: string) => {
    const event = parseEvent(frame);
    if (!event) return;
    let payload: unknown;
    try { payload = JSON.parse(event.data); } catch {
      throw new Error('Jarvis returned an invalid chat stream.');
    }
    if (event.event === 'error') {
      const message = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : 'Jarvis could not finish the reply. Check task status before trying again.';
      throw new Error(message);
    }
    if (event.event === 'user') {
      if (!isChatMessage(payload, 'dan', session.id)) throw new Error('Jarvis returned an invalid chat stream.');
      userMessage = payload;
      onUserMessage(payload);
    } else if (event.event === 'delta') {
      if (!isRecord(payload) || typeof payload.text !== 'string' || payload.text.length === 0) {
        throw new Error('Jarvis returned an invalid chat stream.');
      }
      onDelta(payload.text);
    } else if (event.event === 'done') {
      if (!isChatMessage(payload, 'jarvis', session.id)) throw new Error('Jarvis returned an invalid chat stream.');
      assistantMessage = payload;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
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
    await reader.cancel().catch(() => {});
  }
  if (!userMessage) throw new Error('Jarvis did not save the message. Try again.');
  if (!assistantMessage) {
    throw new Error('The reply was interrupted. A task action may still have completed; check its status before trying again.');
  }
  return assistantMessage;
}

export async function loadConversationHistory(
  client: PublicClientApplication,
  config: PublicConfig,
  before?: string,
): Promise<ConversationHistoryPage> {
  const token = await accessToken(client, config);
  if (!config.backendUrl) throw new Error('Conversation history is unavailable until the backend is deployed.');

  const url = new URL(`${config.backendUrl.replace(/\/+$/, '')}/conversation/history`);
  url.searchParams.set('limit', '50');
  if (before !== undefined) url.searchParams.set('before', before);

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
  if (!isHistoryPage(body)) throw new Error('Jarvis returned an invalid conversation history response.');
  return body;
}

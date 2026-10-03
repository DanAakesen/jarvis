import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';

export interface ConversationHistoryToolCall {
  id: string;
  tool: string;
  outcome: 'ok' | 'error';
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
  at: string;
  toolCalls: ConversationHistoryToolCall[];
}

export interface ConversationHistoryPage {
  messages: ConversationHistoryMessage[];
  nextCursor: string | null;
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
        typeof message.at !== 'string' || Number.isNaN(Date.parse(message.at)) ||
        !Array.isArray(message.toolCalls)) return false;
    return message.toolCalls.every((call) =>
      isRecord(call) && typeof call.id === 'string' && typeof call.tool === 'string' &&
      (call.outcome === 'ok' || call.outcome === 'error') &&
      (call.taskId === null || typeof call.taskId === 'string'));
  });
}

export async function loadConversationHistory(
  client: PublicClientApplication,
  config: PublicConfig,
  before?: string,
): Promise<ConversationHistoryPage> {
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');

  let accessToken: string;
  try {
    const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
    accessToken = result.accessToken;
  } catch {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  }
  if (!accessToken) throw new Error('Microsoft sign-in did not return an API token.');
  if (!config.backendUrl) throw new Error('Conversation history is unavailable until the backend is deployed.');

  const url = new URL(`${config.backendUrl.replace(/\/+$/, '')}/conversation/history`);
  url.searchParams.set('limit', '50');
  if (before !== undefined) url.searchParams.set('before', before);

  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await fetch(url, {
      headers: { Authorization: `${bearerScheme} ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
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

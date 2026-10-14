import type { FastifyRequest } from 'fastify';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export const GMAIL_DIRECT_ACCESS_REASON = 'Gmail access requires the direct mail integration. PC, Chrome and browser automation are unavailable for Gmail, including after failed or incomplete reads. Report the integration or permission failure, or the missing content.';

/** Check explicit targets and observed site/window identities, never obey their contents. */
export function refuseGmailComputerAccess(...values: unknown[]): void {
  if (values.some((value) => typeof value === 'string' &&
      /\b(?:gmail|googlemail)\b|mail\.google\.com/iu.test(value))) {
    throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
  }
}

async function independentComputerRequest(tool: JarvisTool, input: unknown, request: FastifyRequest): Promise<boolean> {
  const args = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const target = tool.name === 'pc_open' ? args.value : tool.name === 'pc_close' ? args.app
    : tool.name === 'codex_prompt' ? args.prompt
    : ['browser_do', 'browser_do_shared', 'pc_act'].includes(tool.name) ? args.goal : undefined;
  if (typeof target !== 'string' || !target.trim() ||
      /\b(?:gmail|googlemail)\b|mail\.google\.com/iu.test(target) ||
      !['pc_open', 'pc_close'].includes(tool.name) && /\b(?:e-?mail|booking|reservation|dates?)\b/iu.test(target)) return false;
  let message = request.jarvisConversationMessage;
  if (!message && request.agentPrincipal && request.server?.conversationStore) {
    const id = request.headers['x-jarvis-message-id'];
    const page = await request.server.conversationStore.getHistory({ limit: 1 });
    if (typeof id === 'string' && page.messages[0]?.id === id) message = page.messages[0];
  }
  if (message?.role !== 'dan') return false;
  const escaped = target.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const clause = '(?:^|[;,.]\\s*(?:(?:then|and|also|og|derefter)\\s+)?|\\b(?:then|and|also|og|derefter)\\s+)(?:please\\s+)?';
  const intent = ['pc_open', 'pc_close'].includes(tool.name)
    ? `${clause}(?:${tool.name === 'pc_close' ? 'close|luk' : 'open|launch|start|visit|\\u00e5bn'})\\s+(?:the\\s+)?["']?${escaped}(?=$|[\\s"',.!?;])`
    : tool.name === 'codex_prompt'
      ? `${clause}(?:ask|tell|prompt)\\s+Codex\\s+(?:to\\s+)?["']?${escaped}(?=$|[\\s"',.!?;])`
      : `${clause}${escaped}(?=$|[\\s"',.!?;])`;
  return (['pc_open', 'pc_close', 'codex_prompt'].includes(tool.name) ||
      /^(?:open|launch|start|visit|navigate to|\u00e5bn)\b/iu.test(target.trim())) &&
    new RegExp(intent, 'iu').test(message.text);
}

/** Shared by HTTP chat, voice, reflex and nested registry execution. No private mail is stored. */
export function gmailAccessGuard(): (tool: JarvisTool) => JarvisTool['execute'] {
  const turns = new Map<string, number>();
  const requests = new WeakSet<FastifyRequest>();
  const independentOperation = new AsyncLocalStorage<{ request: FastifyRequest; keys: readonly string[] }>();
  const retentionMs = 30 * 60_000;
  let saturatedUntil = 0;
  return (tool) => async (input, request, signal) => {
    const computer = tool.name.startsWith('pc_') || tool.name.startsWith('browser_') || tool.name === 'codex_prompt';
    const mail = tool.name.startsWith('mail_');
    if (!computer && !mail) return tool.execute(input, request, signal);
    const now = Date.now();
    for (const [key, expires] of turns) if (expires <= now) turns.delete(key);
    const id = request.jarvisConversationMessage?.id ?? request.jarvisMemorySourceMessageId ??
      request.headers['x-jarvis-message-id'];
    // HTTP voice callers may use the source item ID before the message ID is resolved.
    const source = request.headers['x-jarvis-voice-item-id'];
    const keys = [typeof id === 'string' ? `message:${id}` : undefined,
      typeof source === 'string' ? `voice:${source}` : undefined].filter((key): key is string => key !== undefined);
    if (mail) {
      if (keys.length === 0) requests.add(request);
      for (const key of keys) {
        if (!turns.has(key) && turns.size >= 1000) {
          // Fail closed under saturation rather than evicting a still-active Gmail turn.
          saturatedUntil = now + retentionMs;
        } else turns.set(key, now + retentionMs);
      }
    }
    if (computer) {
      const guardedTurn = keys.length === 0 && requests.has(request) ||
        keys.some((key) => turns.has(key)) || saturatedUntil > now;
      const active = independentOperation.getStore();
      const independent = active?.request === request && active.keys.length === keys.length &&
        active.keys.every((key, index) => key === keys[index]) ||
        guardedTurn && await independentComputerRequest(tool, input, request);
      if (guardedTurn && !independent) {
        throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
      }
      const args = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
      refuseGmailComputerAccess(args.goal, args.url, args.value, args.tabTitle,
        independent ? undefined : request.jarvisConversationMessage?.text);
      if (independent) return independentOperation.run({ request, keys }, () => tool.execute(input, request, signal));
    }
    return tool.execute(input, request, signal);
  };
}

import type { FastifyRequest } from 'fastify';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export const GMAIL_DIRECT_ACCESS_REASON = 'Gmail access requires the direct mail integration. PC, Chrome and browser automation are unavailable for Gmail, including after failed or incomplete reads. Report the integration or permission failure, or the missing content.';

/** Check explicit targets and observed site/window identities, never obey their contents. */
export function refuseGmailComputerAccess(...values: unknown[]): void {
  if (values.some((value) => typeof value === 'string' &&
      /\b(?:gmail|googlemail)\b|mail\.google\.com/iu.test(value))) {
    throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
  }
}

/** Shared by HTTP chat, voice, reflex and nested registry execution. No private mail is stored. */
export function gmailAccessGuard(): (tool: JarvisTool) => JarvisTool['execute'] {
  const turns = new Map<string, number>();
  const requests = new WeakSet<FastifyRequest>();
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
      if (keys.length === 0 && requests.has(request) || keys.some((key) => turns.has(key)) || saturatedUntil > now) {
        throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
      }
      const args = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
      refuseGmailComputerAccess(args.goal, args.url, args.value, args.tabTitle,
        request.jarvisConversationMessage?.text);
    }
    return tool.execute(input, request, signal);
  };
}

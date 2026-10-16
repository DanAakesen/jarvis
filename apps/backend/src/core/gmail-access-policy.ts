import type { FastifyRequest } from 'fastify';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ToolRefusal, type JarvisTool } from './tool-registry.js';

export const GMAIL_DIRECT_ACCESS_REASON = 'Gmail access requires the direct mail integration. PC, Chrome and browser automation are unavailable for Gmail, including after failed or incomplete reads. Report the integration or permission failure, or the missing content.';

function referencesGmail(value: unknown): boolean {
  return typeof value === 'string' && /\b(?:gmail|googlemail)\b|mail\.google\.com/iu.test(value);
}

/** Check explicit targets and observed site/window identities, never obey their contents. */
export function refuseGmailComputerAccess(...values: unknown[]): void {
  if (values.some(referencesGmail)) {
    throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
  }
}

function topLevelCommands(text: string): { text: string; unquoted: string }[] | undefined {
  const commands: { text: string; unquoted: string }[] = [];
  let start = 0;
  let unquoted = '';
  let closingQuote: string | undefined;
  const separators = /^(?:[,;]\s*(?:(?:then|and|also|og|derefter)\s+)?|\.\s+|\s+(?:then|derefter)\s+)/iu;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (closingQuote) {
      if (character === closingQuote) closingQuote = undefined;
      continue;
    }
    if (['"', "'", '\u201c', '\u2018'].includes(character) &&
        !(character === "'" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? '') &&
          /[\p{L}\p{N}]/u.test(text[index + 1] ?? ''))) {
      closingQuote = character === '\u201c' ? '\u201d' : character === '\u2018' ? '\u2019' : character;
      continue;
    }
    const separator = separators.exec(text.slice(index));
    if (separator) {
      commands.push({ text: text.slice(start, index).trim(), unquoted: unquoted.trim() });
      unquoted = '';
      index += separator[0].length - 1;
      start = index + 1;
    } else unquoted += character;
  }
  if (closingQuote) return undefined;
  commands.push({ text: text.slice(start).trim(), unquoted: unquoted.trim() });
  return commands;
}

function independentComputerRequest(
  tool: JarvisTool,
  input: unknown,
  message: FastifyRequest['jarvisConversationMessage'],
): boolean {
  const args = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const target = tool.name === 'pc_open' ? args.value : tool.name === 'pc_close' ? args.app
    : tool.name === 'codex_prompt' ? args.prompt
    : ['browser_do', 'browser_do_shared', 'pc_act'].includes(tool.name) ? args.goal : undefined;
  if (typeof target !== 'string' || !target.trim() ||
      referencesGmail(target) ||
      !['pc_open', 'pc_close'].includes(tool.name) && /\b(?:e-?mail|booking|reservation|dates?)\b/iu.test(target)) return false;
  if (message?.role !== 'dan') return false;
  const escaped = target.trim().replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const intent = ['pc_open', 'pc_close'].includes(tool.name)
    ? `(?:${tool.name === 'pc_close' ? 'close|luk' : 'open|launch|start|visit|\\u00e5bn'})\\s+(?:the\\s+)?["']?${escaped}["']?`
    : tool.name === 'codex_prompt'
      ? `(?:ask|tell|prompt)\\s+Codex\\s+(?:to\\s+)?["']?${escaped}["']?`
      : escaped;
  // Only complete, unambiguous command shapes can exempt a mail turn.
  const mail = '(?:please\\s+)?(?:read|check|find|search|l\\u00e6s|tjek|s\\u00f8g)\\s+(?:(?:my|the|min|mine)\\s+)?(?:gmail|(?:e-?)?mails?|inbox)';
  const separator = '(?:\\s*[,;]\\s*(?:(?:then|and|also|og|derefter)\\s+)?|\\s+(?:then|and|also|og|derefter)\\s+|\\.\\s+)';
  if (!['pc_open', 'pc_close', 'codex_prompt'].includes(tool.name) &&
      !/^(?:open|launch|start|visit|navigate to|\u00e5bn)\b/iu.test(target.trim())) return false;
  if (new RegExp(`^(?:${mail}${separator})?(?:please\\s+)?${intent}(?:${separator}${mail})?[.!?]?\\s*$`, 'iu')
    .test(message.text.trim())) return true;
  const commands = topLevelCommands(message.text.trim());
  if (commands?.length !== 2) return false;
  const computer = new RegExp(`^(?:please\\s+)?${intent}[.!?]?\\s*$`, 'iu');
  const mailTopic = (command: string) =>
    /^(?:please\s+)?(?:read|check|find|search|l\u00e6s|tjek|s\u00f8g)\s+/iu.test(command) &&
    /\b(?:gmail|(?:e-?)?mails?|inbox)\b/iu.test(command) &&
    !/\b(?:how\s+to|hvordan)\b/iu.test(command);
  return computer.test(commands[1]!.text) && mailTopic(commands[0]!.unquoted) ||
    computer.test(commands[0]!.text) && mailTopic(commands[1]!.unquoted);
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
    const active = independentOperation.getStore();
    const nestedIndependent = active?.request === request && active.keys.length === keys.length &&
      active.keys.every((key, index) => key === keys[index]);
    let message = request.jarvisConversationMessage;
    if (computer && !nestedIndependent && !message && request.agentPrincipal &&
        request.server?.conversationStore && typeof id === 'string') {
      const page = await request.server.conversationStore.getHistory({ limit: 1 });
      signal.throwIfAborted();
      let current = page.messages[0];
      if (current?.role === 'jarvis' && current.interrupted) {
        const previous = await request.server.conversationStore.getHistory({ limit: 1, before: current.id });
        signal.throwIfAborted();
        const sourceMessage = previous.messages[0];
        current = sourceMessage?.sessionId === current.sessionId ? sourceMessage : undefined;
      }
      if (!current || current.id !== id || current.role !== 'dan') {
        throw new ToolRefusal('The current Dan message could not be verified for computer use.');
      }
      message = current;
    }
    if (mail || computer && referencesGmail(message?.text)) {
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
      const independent = nestedIndependent ||
        guardedTurn && independentComputerRequest(tool, input, message);
      if (guardedTurn && !independent) {
        throw new ToolRefusal(GMAIL_DIRECT_ACCESS_REASON);
      }
      const args = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
      refuseGmailComputerAccess(args.goal, args.url, args.value, args.tabTitle,
        independent ? undefined : message?.text);
      if (independent) return independentOperation.run({ request, keys }, () => tool.execute(input, request, signal));
    }
    return tool.execute(input, request, signal);
  };
}

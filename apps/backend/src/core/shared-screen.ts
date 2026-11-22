/**
 * The page Dan is sharing, as the web chat sends it with a message (`sharedScreenContext`). The PI agent runs outside the chat request,
 * so the chat route keeps the page here under the stored message of the turn, and the tool dispatcher hands it to the tool calls the
 * PI door makes for that message. Only the chat route sets it; nothing a model writes can.
 */
export interface SharedScreenContext {
  readonly screenDescription: string;
  readonly sharedWindowTitle?: string;
}

const lifetimeMs = 10 * 60_000;
const maxKept = 32;
const kept = new Map<string, { readonly context: SharedScreenContext; readonly expiresAt: number }>();

export function rememberSharedScreen(messageId: string, context: SharedScreenContext): void {
  const now = Date.now();
  for (const [id, entry] of kept) if (entry.expiresAt <= now) kept.delete(id);
  if (!kept.has(messageId) && kept.size >= maxKept) kept.delete(kept.keys().next().value!);
  kept.set(messageId, { context, expiresAt: now + lifetimeMs });
}

export function sharedScreenForMessage(messageId: string): SharedScreenContext | undefined {
  const entry = kept.get(messageId);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    kept.delete(messageId);
    return undefined;
  }
  return entry.context;
}

export function forgetSharedScreen(messageId: string): void {
  kept.delete(messageId);
}

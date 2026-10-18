import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import type { OwnerInteractionService } from '../core/owner-interactions.js';
import { withPhoneConfirmationSession } from '../core/owner-interactions.js';

const phoneSessionIdPattern = /^[1-9]\d{0,18}$/u;

export async function executePhoneTool<T>({
  tool,
  sessionId,
  callerId,
  store,
  notifications,
  signal,
  execute,
}: {
  readonly tool: JarvisTool;
  readonly sessionId: string;
  readonly callerId: string;
  readonly store: PhoneSessionStore | null;
  readonly notifications: OwnerInteractionService | null;
  readonly signal: AbortSignal;
  readonly execute: () => Promise<T>;
}): Promise<T> {
  if (!phoneSessionIdPattern.test(sessionId) ||
      BigInt(sessionId) > 9_223_372_036_854_775_807n ||
      !await store?.isActive(sessionId, callerId)) {
    throw new ToolRefusal('This phone session is unavailable.');
  }
  if (tool.denyOnPhone === true) {
    throw new ToolRefusal('This tool is unavailable during phone calls. Use chat or browser voice.');
  }

  return withPhoneConfirmationSession(sessionId, async () => {
    if (tool.publicAllowedOnPhone !== true) {
      if (!notifications) throw new ToolRefusal('Jarvis approvals are unavailable.');
      await notifications.requestConfirmation(
        'other',
        `Allow ${tool.name} for this phone call?`,
        signal,
      );
    }
    return execute();
  });
}

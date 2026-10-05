import { ToolRefusal, type JarvisTool } from '../core/tool-registry.js';
import type { PhoneSessionStore } from '../database/phone-session-store.js';
import type { TeamsNotificationService } from '../teams/service.js';
import { withPhoneConfirmationSession } from '../teams/service.js';

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
  readonly notifications: TeamsNotificationService | null;
  readonly signal: AbortSignal;
  readonly execute: () => Promise<T>;
}): Promise<T> {
  if (!phoneSessionIdPattern.test(sessionId) ||
      BigInt(sessionId) > 9_223_372_036_854_775_807n ||
      !await store?.isActive(sessionId, callerId)) {
    throw new ToolRefusal('This phone session is unavailable.');
  }

  return withPhoneConfirmationSession(sessionId, async () => {
    if (tool.publicAllowedOnPhone !== true) {
      if (!notifications) throw new ToolRefusal('Teams approvals are unavailable.');
      await notifications.requestConfirmation(
        'other',
        `Allow ${tool.name} for this phone call?`,
        signal,
      );
    }
    return execute();
  });
}

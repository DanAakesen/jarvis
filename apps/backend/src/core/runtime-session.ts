import type { ConversationLanguage, ConversationSession } from './conversation-store.js';

/** Explicit new-session opt-in only. This value never grants tool or data access. */
export type RuntimeTest = 'current' | 'copilot';

export function parseRuntimeTest(value: unknown): RuntimeTest | undefined {
  if (value === undefined) return undefined;
  if (value === 'current' || value === 'copilot') return value;
  throw new TypeError('Invalid runtime test selection');
}

/** Existing sessions may omit the selection or repeat it, but never change it. */
export function assertRuntimeTestSelection(selected: RuntimeTest | undefined, requested: unknown): void {
  const parsed = parseRuntimeTest(requested);
  if (parsed !== undefined && parsed !== selected) throw new TypeError('Runtime test selection is immutable');
}

export interface RuntimeTestSession {
  readonly session: ConversationSession;
  readonly runtimeTest: RuntimeTest;
  /** Server-only opaque provider reference; never return this in a public session DTO. */
  readonly nativeConversationId: string | null;
}

export interface RuntimeSessionStore {
  /** ownerObjectId comes from authenticated server context, never request body identity. */
  createSession(input: { readonly ownerObjectId: string; readonly language: ConversationLanguage;
    readonly runtimeTest: RuntimeTest }): Promise<RuntimeTestSession>;
  getSession(ownerObjectId: string, sessionId: string): Promise<RuntimeTestSession | null>;
  /** Internal use only. CAS binding does not coordinate provider conversation creation or turns. */
  bindNativeConversation(ownerObjectId: string, sessionId: string, nativeConversationId: string): Promise<boolean>;
}

export function validateRuntimeSessionOwner(ownerObjectId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(ownerObjectId)) {
    throw new TypeError('Invalid runtime session owner');
  }
}

export function validateRuntimeSessionId(sessionId: string): void {
  if (!/^[1-9][0-9]{0,18}$/u.test(sessionId) || BigInt(sessionId) > 9223372036854775807n) {
    throw new TypeError('Invalid runtime session ID');
  }
}

export function validateNativeConversationId(value: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new TypeError('Invalid native conversation ID');
  }
}

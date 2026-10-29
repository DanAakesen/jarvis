import type { RuntimeTest } from './runtime-session.js';
import type { VisualContext } from './visual-context.js';

export type ConversationChannel = 'chat' | 'voice' | 'phone';
export type ConversationLanguage = 'da' | 'en';
export type ConversationRole = 'dan' | 'jarvis';

export interface ConversationSession {
  readonly id: string;
  readonly channel: ConversationChannel;
  readonly language: ConversationLanguage;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly runtimeTest?: RuntimeTest;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ConversationRole;
  readonly text: string;
  readonly model: string | null;
  readonly at: Date;
  readonly metadata?: { readonly visualContext: VisualContext };
}

export interface ConversationToolCall {
  readonly id: string;
  readonly tool: string;
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly taskId: string | null;
  readonly artifactId?: string;
}

export interface ConversationAttachmentReference {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
}

export interface ConversationHistoryMessage extends ConversationMessage {
  readonly channel: ConversationChannel;
  readonly language: ConversationLanguage;
  readonly interrupted: boolean;
  readonly voiceMinutes: number | null;
  readonly toolCalls: readonly ConversationToolCall[];
  readonly attachments: readonly ConversationAttachmentReference[];
}

export interface ConversationSteeringMessage {
  readonly id: string;
  readonly text: string;
  readonly language: ConversationLanguage;
}

export interface ConversationHistoryPage {
  readonly messages: readonly ConversationHistoryMessage[];
  readonly nextCursor: string | null;
}

export interface ConversationSearchInput {
  readonly query: string;
  readonly from?: Date;
  readonly toExclusive?: Date;
  readonly source?: ConversationChannel;
  readonly limit: number;
}

export interface ConversationStore {
  initialize?(): Promise<void>;
  createSession(input: {
    readonly channel: ConversationChannel;
    readonly language: ConversationLanguage;
    readonly runtimeTest?: RuntimeTest;
    readonly ownerObjectId?: string;
  }): Promise<ConversationSession>;
  getSession(sessionId: string): Promise<ConversationSession | null>;
  endSession(sessionId: string): Promise<boolean>;
  addMessage(input: {
    /** Cancels an uncommitted plain-text write; already committed messages remain history. */
    readonly signal?: AbortSignal;
    readonly sessionId: string;
    readonly role: ConversationRole;
    readonly text: string;
    readonly model: string | null;
    readonly language?: ConversationLanguage;
    readonly interrupted?: boolean;
    readonly sourceItemId?: string;
    readonly allowEndedSession?: boolean;
    readonly attachmentIds?: readonly string[];
    readonly attachmentOwnerObjectId?: string;
    readonly attachmentRetentionDays?: number;
    readonly visualContext?: VisualContext;
  }): Promise<ConversationMessage | null>;
  setVisualContext?(input: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly visualContext: VisualContext;
  }): Promise<boolean>;
  updateMessage?(messageId: string, text: string): Promise<ConversationMessage | null>;
  getDanMessageIdBySourceItemId(sourceItemId: string): Promise<string | null>;
  getMessageSessionId?(messageId: string): Promise<string | null>;
  getLatestDanMessageText?(sessionId: string): Promise<string | null>;
  /** Newest-first user chat text only; defaults to five messages and permits at most twenty. */
  readRecentUserMessages(limit?: number): Promise<string[]>;
  getHistory(input: {
    readonly limit: number;
    /** Route must authorize an explicit session target before calling. */
    readonly sessionId?: string;
    readonly before?: string;
  }): Promise<ConversationHistoryPage>;
  searchMessages?(
    input: ConversationSearchInput,
    signal: AbortSignal,
  ): Promise<import('@jarvis/contracts').ConversationSearchPage>;
  getDanMessagesAfter(input: {
    readonly sessionId: string;
    readonly after: string;
    readonly limit: number;
  }): Promise<readonly ConversationSteeringMessage[]>;
}

export class InvalidConversationAttachmentsError extends Error {
  constructor() {
    super('One or more attachments are unavailable.');
    this.name = 'InvalidConversationAttachmentsError';
  }
}

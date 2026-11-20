import type { RuntimeTest } from './runtime-session.js';
import type { ChatBlock } from '@jarvis/contracts';
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
  /** Structured content saved with an assistant reply; never changes after the reply is stored. */
  readonly blocks?: readonly ChatBlock[];
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
  endSession(sessionId: string, voiceUsage?: {
    /** Cumulative provider-reported live audio duration. */
    readonly providerVoiceSeconds?: number;
    /** Opt in only after a clean provider-confirmed voice terminal. Defaults to false. */
    readonly allowWallClockFallback?: boolean;
  }): Promise<boolean>;
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
    readonly blocks?: readonly ChatBlock[];
  }): Promise<ConversationMessage | null>;
  setVisualContext?(input: {
    readonly sessionId: string;
    readonly messageId: string;
    readonly visualContext: VisualContext;
  }): Promise<boolean>;
  updateMessage?(input: {
    readonly messageId: string;
    readonly sessionId: string;
    readonly role: ConversationRole;
    readonly text: string;
  }): Promise<ConversationMessage | null>;
  getDanMessageIdBySourceItemId(sourceItemId: string): Promise<string | null>;
  getMessageSessionId?(messageId: string): Promise<string | null>;
  getLatestDanMessageText?(sessionId: string): Promise<string | null>;
  /** The owner's own messages on every channel since a time, oldest first, at most 100. Used by the daily missed-capture audit. */
  readDanMessagesSince?(since: Date, limit: number): Promise<ReadonlyArray<{ readonly id: string; readonly text: string; readonly at: Date }>>;
  /** Newest-first user chat text only; defaults to five messages and permits at most twenty. */
  readRecentUserMessages(limit?: number): Promise<string[]>;
  getHistory(input: {
    readonly limit: number;
    /** Route must authorize an explicit session target before calling. */
    readonly sessionId?: string;
    readonly before?: string;
    /** UI feed only; internal context/source reads retain global history. */
    readonly excludeRuntimeTests?: boolean;
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

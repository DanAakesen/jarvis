export type ConversationChannel = 'chat' | 'voice' | 'phone';
export type ConversationLanguage = 'da' | 'en';
export type ConversationRole = 'dan' | 'jarvis';

export interface ConversationSession {
  readonly id: string;
  readonly channel: ConversationChannel;
  readonly language: ConversationLanguage;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface ConversationMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ConversationRole;
  readonly text: string;
  readonly model: string | null;
  readonly at: Date;
}

export interface ConversationToolCall {
  readonly id: string;
  readonly tool: string;
  readonly outcome: 'ok' | 'refused' | 'error';
  readonly taskId: string | null;
  readonly artifactId?: string;
}

export interface ConversationHistoryMessage extends ConversationMessage {
  readonly channel: ConversationChannel;
  readonly language: ConversationLanguage;
  readonly interrupted: boolean;
  readonly voiceMinutes: number | null;
  readonly toolCalls: readonly ConversationToolCall[];
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
  }): Promise<ConversationSession>;
  getSession(sessionId: string): Promise<ConversationSession | null>;
  endSession(sessionId: string): Promise<boolean>;
  addMessage(input: {
    readonly sessionId: string;
    readonly role: ConversationRole;
    readonly text: string;
    readonly model: string | null;
    readonly language?: ConversationLanguage;
    readonly interrupted?: boolean;
    readonly sourceItemId?: string;
    readonly allowEndedSession?: boolean;
  }): Promise<ConversationMessage | null>;
  updateMessage?(messageId: string, text: string): Promise<ConversationMessage | null>;
  getDanMessageIdBySourceItemId(sourceItemId: string): Promise<string | null>;
  getMessageSessionId?(messageId: string): Promise<string | null>;
  getLatestDanMessageText?(sessionId: string): Promise<string | null>;
  getHistory(input: {
    readonly limit: number;
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

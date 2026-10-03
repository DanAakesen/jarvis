export interface ToolCallRecord {
  readonly messageId: string;
  readonly tool: string;
  readonly arguments: unknown;
  readonly result: unknown;
  readonly outcome: 'ok' | 'error';
}

export interface ToolCallStore {
  record(call: ToolCallRecord): Promise<void>;
}

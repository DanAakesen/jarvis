export type TodoReceiptStatus = 'added' | 'skipped' | 'failed';

export interface TodoReceiptInput {
  itemId: string | null;
  dedupeKey: string;
  dayKey: string;
  runId: string;
  status: TodoReceiptStatus;
  reason: string | null;
  commitSha: string | null;
}

export interface TodoReceiptSummary {
  dedupeKey: string;
  added: boolean;
  skipped: boolean;
  failedAttempts: number;
}

export interface ProactiveTodoReceiptStore {
  list(dedupeKeys: readonly string[]): Promise<TodoReceiptSummary[]>;
  countAdded(dayKey: string): Promise<number>;
  insert(input: TodoReceiptInput): Promise<boolean>;
}

export function createMemoryProactiveTodoReceiptStore(): ProactiveTodoReceiptStore {
  const receipts: TodoReceiptInput[] = [];
  return {
    async list(dedupeKeys) {
      const requested = new Set(dedupeKeys);
      const summaries = new Map<string, TodoReceiptSummary>();
      for (const receipt of receipts) {
        if (!requested.has(receipt.dedupeKey)) continue;
        const summary = summaries.get(receipt.dedupeKey) ?? {
          dedupeKey: receipt.dedupeKey,
          added: false,
          skipped: false,
          failedAttempts: 0,
        };
        if (receipt.status === 'added') summary.added = true;
        else if (receipt.status === 'skipped') summary.skipped = true;
        else summary.failedAttempts += 1;
        summaries.set(receipt.dedupeKey, summary);
      }
      return [...summaries.values()];
    },
    async countAdded(dayKey) {
      return receipts.filter((receipt) => receipt.dayKey === dayKey && receipt.status === 'added').length;
    },
    async insert(input) {
      if (input.status === 'added' && receipts.some((receipt) =>
        receipt.status === 'added' && receipt.dedupeKey === input.dedupeKey)) return false;
      receipts.push({ ...input });
      return true;
    },
  };
}

import { randomUUID } from 'node:crypto';

export type AlertClass = 'deadline_24h' | 'calendar_clash' | 'travel_disruption';
export type AlertStatus = 'sent' | 'failed';

export interface AlertLedgerRow {
  id: string;
  alertKey: string;
  class: AlertClass;
  itemId: string;
  runId: string;
  dayKey: string;
  status: AlertStatus;
  reason: string | null;
  attempts: number;
  updatedAt: string;
}

export type AlertLedgerWrite = Omit<AlertLedgerRow, 'id' | 'attempts' | 'updatedAt'>;

export interface AlertLedgerStore {
  get(alertKey: string): Promise<AlertLedgerRow | undefined>;
  countSent(dayKey: string): Promise<number>;
  upsert(input: AlertLedgerWrite): Promise<AlertLedgerRow>;
}

export function createMemoryAlertLedgerStore(now: () => Date = () => new Date()): AlertLedgerStore {
  const entries = new Map<string, AlertLedgerRow>();
  return {
    async get(alertKey) {
      const row = entries.get(alertKey);
      return row ? { ...row } : undefined;
    },
    async countSent(dayKey) {
      return new Set([...entries.values()]
        .filter((row) => row.dayKey === dayKey && row.status === 'sent')
        .map(({ runId }) => runId)).size;
    },
    async upsert(input) {
      const existing = entries.get(input.alertKey);
      const row: AlertLedgerRow = {
        ...input,
        id: existing?.id ?? randomUUID(),
        attempts: Math.min(255, (existing?.attempts ?? 0) + 1),
        updatedAt: now().toISOString(),
      };
      entries.set(input.alertKey, row);
      return { ...row };
    },
  };
}

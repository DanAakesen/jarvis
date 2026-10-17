import type { DailySourceId } from '@jarvis/contracts';
import { createEventHub, type EventHub } from '../core/event-hub.js';

export interface DailyCommittedChange {
  owner: string;
  sources: readonly (DailySourceId | 'daily.feed')[];
}
export type DailyChanges = EventHub<DailyCommittedChange>;
export type DailyChangeSink = Pick<DailyChanges, 'publish'>;
export const createDailyChanges = (): DailyChanges => createEventHub<DailyCommittedChange>();

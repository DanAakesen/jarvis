import type { HealthSourceId } from '@jarvis/contracts';
import { createEventHub, type EventHub } from '../core/event-hub.js';

export interface HealthCommittedChange {
  owner: string;
  sources: readonly (HealthSourceId | 'daily.feed')[];
}
export type HealthChanges = EventHub<HealthCommittedChange>;
export type HealthChangeSink = Pick<HealthChanges, 'publish'>;
export const createHealthChanges = (): HealthChanges => createEventHub<HealthCommittedChange>();

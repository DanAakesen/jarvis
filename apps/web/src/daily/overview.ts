import { dailyQuerySources as sources, isDailyQuery, type DailyJson, type DailyQuery, type DailyQueryResult, type DailySourceId } from '@jarvis/contracts';
import { dailyRequest } from './presentation';

/** The result of reading one collection for the overview. A failure carries only safe, already-shown copy. */
export type DailyProbe =
  | { state: 'records' | 'none'; observedAt: string }
  | { state: 'failed'; message: string };

/** The ordinary first-page request cut to a single record: enough to learn whether anything is stored. */
export function dailyProbe(source: DailySourceId, period: { startDate: string; endDate: string }): DailyQuery | null {
  const request = dailyRequest(source, period);
  if (request === null) return null;
  const probe = 'limit' in request ? { ...request, limit: 1 } : request;
  return isDailyQuery(probe) ? probe : null;
}

function counted(value: DailyJson | undefined): boolean {
  return typeof value === 'number' && value > 0;
}

/**
 * Sync evidence always answers with one summary item, so an item alone proves nothing.
 * It holds records only when a feed, a phone contact or a retained upload is actually present.
 */
export function probeState(result: DailyQueryResult): 'records' | 'none' {
  const [item] = result.items;
  if (item === undefined) return 'none';
  if (result.source !== sources.sync) return 'records';
  const inbox = item.inbox;
  const retained = inbox !== null && typeof inbox === 'object' && !Array.isArray(inbox) ? inbox.retained : null;
  return (Array.isArray(item.feeds) && item.feeds.length > 0) || (item.heartbeat !== null && item.heartbeat !== undefined) || counted(retained)
    ? 'records' : 'none';
}

export type RowView =
  | { tone: 'checking'; label: 'Checking' }
  | { tone: 'records'; label: 'Has records' }
  | { tone: 'none'; label: 'None returned'; detail: string }
  | { tone: 'failed'; label: 'Could not read'; detail: string };

/**
 * What a row shows. A settled result stays visible while the next read runs, except a failure:
 * that read is being retried, so it shows as checking instead of repeating an old error.
 */
export function rowView(last: DailyProbe | undefined, pending: boolean, dated: boolean): RowView {
  if (last === undefined || (pending && last.state === 'failed')) return { tone: 'checking', label: 'Checking' };
  if (last.state === 'failed') return { tone: 'failed', label: 'Could not read', detail: last.message };
  if (last.state === 'records') return { tone: 'records', label: 'Has records' };
  return {
    tone: 'none', label: 'None returned',
    detail: `${dated ? 'No records in this period; older ones may exist. ' : 'No records are stored. '}This does not prove the original source is empty.`,
  };
}

/** One sentence for assistive technology once every collection has settled. */
export function overviewSummary(probes: readonly (DailyProbe | undefined)[]): string {
  const count = (state: DailyProbe['state']) => probes.filter(probe => probe?.state === state).length;
  const records = count('records'); const none = count('none'); const failed = count('failed');
  const total = probes.length;
  return `Checked ${total} ${total === 1 ? 'collection' : 'collections'}: ${records} with records, ${none} with none returned, ${failed} that could not be read.`;
}

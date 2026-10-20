import type { DailyJson, DailyQueryResult } from '@jarvis/contracts';

function record(value: DailyJson | undefined): Record<string, DailyJson> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function sourceCoverage(result: DailyQueryResult | undefined, refreshFailed: boolean) {
  const feeds = record(result?.items[0])?.feeds;
  const times = (Array.isArray(feeds) ? feeds : []).flatMap(feed => {
    const at = record(feed)?.processed_committed_at;
    return typeof at === 'string' && Number.isFinite(Date.parse(at)) ? [at] : [];
  });
  const at = times.sort((first, second) => Date.parse(second) - Date.parse(first))[0] ?? null;
  return [
    {
      label: 'Health uploads', at,
      status: at ? refreshFailed ? 'Stale' : 'Synced' : 'Not connected',
      note: at ? 'Last completed processing. Source freshness is unknown.' : 'No completed health-upload sync evidence is available.',
    },
    { label: 'Nutrition capture', at: null, status: 'Not connected', note: 'Nutrition capture sync status is not served by daily.sync; this does not mean there are no nutrition records.' },
    { label: 'Mail', at: null, status: 'Not connected', note: 'No Gmail attention source is served here.' },
    { label: 'Calendar', at: null, status: 'Not connected', note: 'No calendar attention source is served here.' },
  ];
}

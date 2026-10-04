import { useEffect, useSyncExternalStore } from 'react';
import { getDatabaseWaking, subscribeDatabaseStatus, watchDatabaseStatus } from './backend-request';

export function DatabaseWakeStatus({
  backendUrl,
  getAccessToken,
}: {
  backendUrl: string;
  getAccessToken: () => Promise<string>;
}) {
  const waking = useSyncExternalStore(subscribeDatabaseStatus, getDatabaseWaking);
  useEffect(() => watchDatabaseStatus(backendUrl, getAccessToken), [backendUrl, getAccessToken]);
  return waking ? <p className="database-wake-status" role="status">Waking Jarvis…</p> : null;
}

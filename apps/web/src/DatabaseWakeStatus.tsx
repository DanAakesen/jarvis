import { useEffect, useSyncExternalStore } from 'react';
import { getDatabaseWaking, subscribeDatabaseStatus, watchDatabaseStatus } from './backend-request';

/** Compact top-bar status: quiet while idle, visible and announced while the backend database wakes. */
export function DatabaseWakeStatus({
  backendUrl,
  getAccessToken,
}: {
  backendUrl: string;
  getAccessToken: () => Promise<string>;
}) {
  const waking = useSyncExternalStore(subscribeDatabaseStatus, getDatabaseWaking);
  useEffect(() => watchDatabaseStatus(backendUrl, getAccessToken), [backendUrl, getAccessToken]);
  return waking ? (
    <p className="database-wake-status topbar-status" role="status" title="Waking Jarvis…">
      <span className="topbar-status-mark" aria-hidden="true" />
      <span className="topbar-status-text">Waking Jarvis…</span>
    </p>
  ) : null;
}

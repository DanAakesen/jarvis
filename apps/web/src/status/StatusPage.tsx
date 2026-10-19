import { useEffect, useState } from 'react';
import { isSystemSmokeStatus, vaultMirrorStatusViewSchema, type SystemStatus, type SystemStatusEntry, type SystemStatusSubsystem, type SystemStatusValue } from '@jarvis/contracts';
import type { AreaProps } from '../areas';
import { awaitWithSignal, backendFetch } from '../backend-request';
import { StateMessage } from '../StateMessage';
import { formatDateTime } from '../format/date-time';
import { VaultMirrorRow } from './VaultMirrorRow';

const checks: Readonly<Record<SystemStatusSubsystem, string>> = {
  database: 'SQL database',
  'foundry.chat': 'Foundry chat',
  'foundry.voice': 'Foundry voice',
  'foundry.embeddings': 'Foundry embeddings',
  vault_index: 'Vault index',
  github_app: 'GitHub App',
  google: 'Google',
  pc_bridge: 'PC bridge',
  runner: 'Agent runner',
  deployed_commit: 'Backend commit',
  last_error: 'Last backend error',
};
const statuses: Record<SystemStatusValue, string> = { ok: 'OK', degraded: 'Degraded', down: 'Failing', unknown: 'Unknown' };
const staleAfterMs = 5 * 60_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTime(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function isStatusEntry(value: unknown): value is SystemStatusEntry {
  return isObject(value) && typeof value.id === 'string' && Object.hasOwn(checks, value.id) &&
    typeof value.status === 'string' && Object.hasOwn(statuses, value.status) && isTime(value.checkedAt) &&
    (value.details === undefined || (isObject(value.details) && Object.keys(value.details).length <= 50 &&
      Object.entries(value.details).every(([key, detail]) => key.length > 0 && key.length <= 100 &&
        (detail === null || typeof detail === 'boolean' ||
          (typeof detail === 'number' && Number.isFinite(detail)) ||
          (typeof detail === 'string' && detail.length <= 2_000)))));
}

function isSystemStatus(value: unknown): value is SystemStatus {
  return isObject(value) && isTime(value.checkedAt) && Array.isArray(value.entries) &&
    value.entries.length === Object.keys(checks).length && value.entries.every(isStatusEntry) &&
    new Set(value.entries.map(entry => entry.id)).size === Object.keys(checks).length &&
    (value.smoke === undefined || isSystemSmokeStatus(value.smoke)) &&
    (value.vaultMirror === undefined || vaultMirrorStatusViewSchema.safeParse(value.vaultMirror).success);
}

function readableKey(key: string): string {
  const text = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function reason(entry: SystemStatusEntry): string | undefined {
  if (typeof entry.details?.reason === 'string' && entry.details.reason.trim()) return readableKey(entry.details.reason);
  if (entry.details?.configured === false) return 'This check is not configured.';
  if (entry.status === 'unknown') return 'Runtime health is not established by this check.';
  if (entry.status === 'down') return entry.id === 'pc_bridge' && entry.details?.connected === false
    ? undefined : 'The check failed; no further reason was reported.';
  if (entry.status === 'degraded') return 'The check reports degraded status. See its recorded details.';
  return undefined;
}

function safeErrorMessage(error: string | undefined): string {
  if (error?.startsWith('Microsoft sign-in needs attention.')) {
    return 'Microsoft sign-in needs attention. Sign in again to read system status.';
  }
  if (error?.startsWith('The backend is not configured.')) {
    return 'The backend is not configured. System status is unavailable.';
  }
  if (error?.startsWith('System status timed out.')) return 'System status timed out. Try again.';
  if (error?.includes('invalid system status response') || error?.includes('incomplete or invalid')) {
    return 'The backend returned an invalid system status response.';
  }
  return 'System status could not be loaded. Try again.';
}

function StatusBadge({ value }: { value: SystemStatusValue }) {
  return <span className="system-status-badge" data-status={value}>{statuses[value]}</span>;
}

function CheckedAt({ value, now }: { value: string; now: number }) {
  return <span className="system-status-time">
    <time dateTime={value} title={formatDateTime(value)}>{formatDateTime(value)}</time>
    {now - Date.parse(value) >= staleAfterMs && <span className="system-status-stale">Stale</span>}
  </span>;
}

type Result = { backendUrl: string | null; data?: SystemStatus; error?: string; pending: boolean };

export function StatusPage({ backendUrl, getAccessToken }: AreaProps) {
  const [result, setResult] = useState<Result>({ backendUrl, pending: true });
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const current: Result = result.backendUrl === backendUrl ? result : { backendUrl, pending: true };

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30_000);
    setResult(previous => ({ backendUrl, pending: true,
      ...(previous.backendUrl === backendUrl && previous.data ? { data: previous.data } : {}),
    }));
    const load = async () => {
      try {
        if (!backendUrl) throw new Error('The backend is not configured. System status is unavailable.');
        let token: string;
        try {
          token = await awaitWithSignal(getAccessToken, controller.signal);
        } catch {
          throw new Error('Microsoft sign-in needs attention. Sign in again to read system status.');
        }
        const response = await backendFetch(`${backendUrl.replace(/\/+$/, '')}/status`, {
          headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(response.status === 401 || response.status === 403
            ? 'Microsoft sign-in needs attention. Sign in again to read system status.'
            : `System status is unavailable (HTTP ${response.status}). Try again.`);
        }
        let value: unknown;
        try { value = await awaitWithSignal(() => response.json(), controller.signal); } catch { throw new Error('The backend returned an invalid system status response.'); }
        if (!isSystemStatus(value)) throw new Error('The backend returned an incomplete or invalid system status response.');
        if (active && !controller.signal.aborted) {
          setNow(Date.now());
          setResult({ backendUrl, data: value, pending: false });
        }
      } catch (error) {
        if (active) setResult(previous => ({ backendUrl, pending: false,
          ...(previous.backendUrl === backendUrl && previous.data ? { data: previous.data } : {}),
          error: timedOut ? 'System status timed out. Try again.' :
            error instanceof TypeError ? 'Jarvis could not reach the backend. Try again.' :
              error instanceof Error ? error.message : 'System status could not be loaded. Try again.',
        }));
      } finally {
        window.clearTimeout(deadline);
      }
    };
    void load();
    return () => { active = false; window.clearTimeout(deadline); controller.abort(); };
  }, [backendUrl, getAccessToken, revision]);

  const { data, error, pending } = current;
  return <div className="status-page">
    <header className="system-status-header">
      <h1>Status</h1>
      <button className="secondary-button" type="button" disabled={pending} onClick={() => setRevision(value => value + 1)}>
        {pending ? 'Refreshing status...' : error ? 'Retry status' : 'Refresh status'}
      </button>
    </header>
    {error && (data
      ? <StateMessage variant="partial"
        message="The last status snapshot remains visible."
        detail="The latest refresh failed; this snapshot does not establish current health. Use Retry status to check again." />
      : <StateMessage variant="error" className="system-status-feedback" message={safeErrorMessage(error)} />)}
    {!data && pending && <StateMessage variant="loading" message="Loading system status" />}
    {!data && <VaultMirrorRow loading={pending} unavailable={!!error} now={now} />}
    {data && <>
      <p className="system-status-snapshot">
        {error ? 'Previous snapshot' : pending ? 'Refreshing the recorded snapshot' : 'Backend responded with a status snapshot'}.
        {' '}Checked <CheckedAt value={data.checkedAt} now={now} />.
        {' '}The backend caches checks for up to one minute.
      </p>
      <section className="system-status-panel" aria-labelledby="system-checks-heading" aria-busy={pending}>
        <h2 id="system-checks-heading">System checks</h2>
        <p className="system-status-note">Foundry checks describe configured deployments, not a live model turn. The last backend error is historical evidence, not a claim that the backend is currently failing.</p>
        <VaultMirrorRow value={data.vaultMirror} unavailable={!!error} now={now} />
        <ul className="system-status-list">
          {data.entries.map(entry => <li className="system-status-row" key={entry.id} aria-label={checks[entry.id]}>
            <div className="system-status-row-heading">
              <strong>{checks[entry.id]}</strong><StatusBadge value={entry.status} />
            </div>
            {reason(entry) && <p className="system-status-reason">{reason(entry)}</p>}
            {entry.id === 'pc_bridge' && <p className="system-status-reason">
              {entry.details?.connected === true ? 'Connected at check time.' :
                entry.details?.connected === false ? 'Disconnected at check time.' : 'Connection state was not reported.'}
              {typeof entry.details?.controlPaused === 'boolean' && (entry.details.controlPaused ? ' PC control is paused.' : ' PC control is not paused.')}
            </p>}
            <CheckedAt value={entry.checkedAt} now={now} />
            {entry.details && Object.keys(entry.details).length > 0 && <details className="system-status-details">
              <summary>Recorded details</summary>
              <dl>{Object.entries(entry.details).map(([key, value]) => <div key={key}>
                <dt>{readableKey(key)}</dt>
                <dd>{value === null ? 'Not reported' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value)}</dd>
              </div>)}</dl>
            </details>}
          </li>)}
        </ul>
      </section>
      <section className="system-status-panel" aria-labelledby="system-smoke-heading">
        <h2 id="system-smoke-heading">Recorded smoke check</h2>
        <p className="system-status-note">The latest report retained by the backend. It has no deployment ID or commit association; refreshing this page does not run smoke checks or model canaries.</p>
        {data.smoke ? <>
          <p className="system-status-snapshot">Checked <CheckedAt value={data.smoke.checkedAt} now={now} />.</p>
          <ul className="system-status-list">
            {data.smoke.entries.map(entry => <li className="system-status-row" key={entry.id} aria-label={`Smoke: ${readableKey(entry.id)}`}>
              <div className="system-status-row-heading"><strong>{readableKey(entry.id)}</strong><StatusBadge value={entry.status} /></div>
              {entry.status !== 'ok' && <p className="system-status-reason">{entry.reason ? readableKey(entry.reason) : 'No further reason was recorded for this result.'}</p>}
              <CheckedAt value={entry.checkedAt} now={now} />
            </li>)}
          </ul>
        </> : <p>Unavailable: the backend has no recorded smoke report. Reports are not retained across a backend restart.</p>}
      </section>
    </>}
  </div>;
}

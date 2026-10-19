import { useId, useState } from 'react';
import type { VaultMirrorStatus, VaultMirrorStatusView as VaultMirrorView } from '@jarvis/contracts';
import { formatDateTime } from '../format/date-time';

const reasons: Record<NonNullable<VaultMirrorStatus['reason']>, string> = {
  auth: 'Obsidian sign-in needs attention.',
  'policy-missing': 'The mirror policy is missing or invalid.',
  'repo-not-private': 'The vault repository is not private.',
  'pull-failed': 'The mirror could not download the latest notes.',
  'guard-tripped': 'The safety limits stopped this sync.',
  conflict: 'Some notes have conflicting changes.',
  'secret-match': 'A credential check blocked some notes.',
  'push-rejected': 'GitHub rejected the mirror update.',
  'upload-failed': 'The mirror could not save its state.',
  'state-corrupt': 'The saved mirror state could not be read.',
  timeout: 'The mirror run timed out.',
  unexpected: 'The mirror run failed unexpectedly.',
};
const states = {
  'not-set-up': 'Not set up',
  healthy: 'Healthy',
  stale: 'Stale',
  'needs-attention': 'Needs attention',
  failed: 'Failed',
  loading: 'Loading',
  'read-error': 'Read error',
} as const;
const countLabels = {
  approved: 'Approved',
  pushed: 'Pushed to GitHub',
  writtenBack: 'Written to Obsidian',
  deleted: 'Deleted',
  conflicts: 'Conflicts',
  skipped: 'Skipped',
  credentialMatches: 'Credential checks blocked',
  pendingWriteBack: 'Pending write-back',
  consecutiveFailures: 'Consecutive failures',
} as const;

function elapsed(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

export function VaultMirrorRow({ value, loading = false, unavailable = false, now }: {
  value?: VaultMirrorView | undefined;
  loading?: boolean;
  unavailable?: boolean;
  now: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const stateId = useId();
  const timeId = useId();
  const state = loading ? 'loading' : unavailable ? 'read-error' : !value ? 'not-set-up' :
    value.state === 'healthy' && value.lastSuccessAt && now - Date.parse(value.lastSuccessAt) > 30 * 60_000
      ? 'stale' : value.state;
  const tone = state === 'healthy' ? 'ok' : state === 'stale' || state === 'needs-attention' ? 'degraded' :
    state === 'failed' || state === 'read-error' ? 'down' : 'unknown';
  const showDetails = !loading && !unavailable && value && state !== 'read-error' && state !== 'not-set-up';
  return <div className="system-status-row vault-mirror-row" role="group" aria-label="Vault mirror">
    <button type="button" className="ghost-button vault-mirror-toggle" aria-label="Vault mirror details"
      aria-describedby={`${stateId} ${timeId}`}
      aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded(previous => !previous)}>
      <span className="vault-mirror-label"><span aria-hidden="true">{expanded ? '−' : '+'}</span><strong>Vault mirror</strong></span>
      <span id={stateId} className="system-status-badge" data-status={tone}>{states[state]}</span>
      <span id={timeId} className="system-status-time">
        {value?.writeBack === 'dry-run' && <><span>Dry-run</span>{' '}</>}
        {value?.lastSuccessAt
          ? <time dateTime={value.lastSuccessAt} title={formatDateTime(value.lastSuccessAt)}>Last success {elapsed(value.lastSuccessAt, now)}</time>
          : !loading && state !== 'not-set-up' && state !== 'read-error' ? 'No successful sync yet' : null}
      </span>
    </button>
    <div id={detailsId} className="system-status-details vault-mirror-details" hidden={!expanded}>
      {expanded && (showDetails ? <>
        {value.reason && <p className="system-status-reason">{reasons[value.reason]}</p>}
        <dl>
          {value.writeBack && <div><dt>Write-back</dt><dd>{value.writeBack === 'dry-run' ? 'Dry-run — not writing into Obsidian' : 'On'}</dd></div>}
          {value.counts && Object.entries(countLabels).map(([key, label]) => <div key={key}>
            <dt>{label}</dt><dd>{value.counts![key as keyof typeof countLabels]}</dd>
          </div>)}
        </dl>
        {!!value.conflictPaths?.length && <>
          <h3>Conflict paths</h3>
          <ul>{value.conflictPaths.slice(0, 10).map(path => <li key={path}>{path}</li>)}</ul>
        </>}
      </> : <p className="system-status-reason">
        {state === 'loading' ? 'Waiting for mirror status.' : state === 'not-set-up'
          ? 'No mirror status document yet.' : 'Mirror status could not be read. Try loading status again.'}
      </p>)}
    </div>
  </div>;
}

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
  'not-set-up': 'No status yet',
  healthy: 'Healthy',
  stale: 'Stale',
  'needs-attention': 'Needs attention',
  failed: 'Failed',
  loading: 'Loading',
  'read-error': 'Read error',
} as const;
const readReasons = {
  'backend-not-configured': 'This backend has no mirror-status storage reader configured. That does not establish whether the scheduled job exists.',
  'status-missing': 'No mirror status document has been written yet. That does not establish whether the scheduled job exists or ran.',
  'access-denied': 'The backend identity could not read the private mirror status document.',
  'timed-out': 'The mirror status read timed out.',
  invalid: 'The mirror status document is missing required evidence or is not valid.',
  unavailable: 'The mirror status document could not be read.',
} as const;
const guardReasons: Record<NonNullable<VaultMirrorView['guardReasons']>[number], string> = {
  'invalid-input': 'The planner received invalid input.',
  'max-changed-G': 'The per-run cap would be exceeded by changes to GitHub.',
  'max-changed-O': 'The per-run cap would be exceeded by changes to Obsidian.',
  'max-deletes-G': 'The delete cap would be exceeded in GitHub.',
  'max-deletes-O': 'The delete cap would be exceeded in Obsidian.',
  'base-deletion-ratio': 'The delete ratio safety limit was exceeded.',
  'empty-side': 'One complete side appears empty while the other has notes.',
  'missing-base-O': 'Obsidian is missing too much of the recorded base.',
  'missing-base-G': 'GitHub is missing too much of the recorded base.',
};
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
        {value?.lastRunAt
          ? <time dateTime={value.lastRunAt} title={formatDateTime(value.lastRunAt)}>Last run {elapsed(value.lastRunAt, now)}</time>
          : value?.lastSuccessAt
          ? <time dateTime={value.lastSuccessAt} title={formatDateTime(value.lastSuccessAt)}>Last success {elapsed(value.lastSuccessAt, now)}</time>
          : !loading && state !== 'not-set-up' && state !== 'read-error' ? 'No successful sync yet' : null}
      </span>
    </button>
    <div id={detailsId} className="system-status-details vault-mirror-details" hidden={!expanded}>
      {expanded && (showDetails ? <>
        {value.reason && <p className="system-status-reason">{reasons[value.reason]}</p>}
        {!!value.guardReasons?.length && <p className="system-status-reason">
          Safety guard: {value.guardReasons.map(reason => guardReasons[reason]).join(' ')}
        </p>}
        <dl>
          {value.lastRunAt && <div><dt>Last run</dt><dd>{formatDateTime(value.lastRunAt)}</dd></div>}
          {value.outcome && <div><dt>Last outcome</dt><dd>{readableOutcome(value.outcome)}</dd></div>}
          {value.lastSuccessAt && <div><dt>Last success</dt><dd>{formatDateTime(value.lastSuccessAt)}</dd></div>}
          {value.changedOnGitHub !== undefined && <div><dt>Proposed GitHub changes</dt><dd>{value.changedOnGitHub}</dd></div>}
          {value.changedOnObsidian !== undefined && <div><dt>Proposed Obsidian changes</dt><dd>{value.changedOnObsidian}</dd></div>}
          {value.deletedOnGitHub !== undefined && <div><dt>Proposed GitHub deletes</dt><dd>{value.deletedOnGitHub}</dd></div>}
          {value.deletedOnObsidian !== undefined && <div><dt>Proposed Obsidian deletes</dt><dd>{value.deletedOnObsidian}</dd></div>}
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
          ? value?.readReason ? readReasons[value.readReason] : 'No mirror status has been received yet. This alone does not prove the scheduled job is off.'
          : value?.readReason ? readReasons[value.readReason] : 'Mirror status could not be read. Try loading status again.'}
      </p>)}
    </div>
  </div>;
}

function readableOutcome(outcome: NonNullable<VaultMirrorView['outcome']>): string {
  switch (outcome) {
    case 'ok': return 'Completed';
    case 'ok-noop': return 'Completed with no changes';
    case 'skipped-busy': return 'Skipped because another run held the lease';
    case 'needs-attention': return 'Completed but needs attention';
    default: return outcome.charAt(0).toUpperCase() + outcome.slice(1);
  }
}

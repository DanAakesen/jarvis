import type { VaultMirrorStatus, VaultMirrorStatusView } from '@jarvis/contracts';
import type { FindingInput } from './store.js';
import { dayKey } from './time.js';

const ownerReasons: Record<NonNullable<VaultMirrorStatus['reason']> | 'needs-attention' | 'failed', string> = {
  auth: 'The vault mirror could not authenticate.',
  'policy-missing': 'The vault mirror policy is missing or invalid.',
  'repo-not-private': 'The vault mirror repository is not private.',
  'pull-failed': 'The vault mirror could not pull the latest changes.',
  'guard-tripped': 'A vault mirror safety guard stopped the run.',
  conflict: 'The vault mirror found conflicting changes.',
  'secret-match': 'The vault mirror blocked content matching a credential pattern.',
  'push-rejected': 'The vault mirror push was rejected.',
  'upload-failed': 'The vault mirror could not upload its results.',
  'state-corrupt': 'The vault mirror state is invalid.',
  timeout: 'The vault mirror run timed out.',
  unexpected: 'The vault mirror encountered an unexpected failure.',
  'needs-attention': 'The vault mirror needs your attention.',
  failed: 'The vault mirror run failed.',
};

export function vaultMirrorFinding(status: VaultMirrorStatusView, now: Date): FindingInput | undefined {
  if (status.state === 'not-set-up' || status.state === 'read-error') return undefined;
  const reason = status.state === 'needs-attention' || status.state === 'failed'
    ? status.reason ?? status.state
    : status.lastSuccessAt !== null && now.getTime() - Date.parse(status.lastSuccessAt) > 60 * 60_000
      ? 'stale' : undefined;
  if (!reason) return undefined;
  return {
    dedupeKey: `vault-mirror:${dayKey(now)}:${reason}`,
    title: 'Vault mirror needs attention',
    body: `${reason === 'stale'
      ? 'The vault mirror has not succeeded for over an hour.'
      : ownerReasons[reason]} Open System status and review the vault mirror.`,
    category: 'status',
    urgency: 'normal',
    dueAt: null,
    evidence: [],
    runId: null,
    language: 'en',
  };
}

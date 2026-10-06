export type CredentialName = 'codex-login' | 'copilot-token' | 'github-app-key' | 'github-app';
export type CredentialStatusValue = 'ok' | 'renew_soon' | 'failed' | 'unknown';

export interface CredentialStatus {
  name: CredentialName;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  lastCheckedAt?: string | null;
  status: CredentialStatusValue;
}

export interface CredentialStatusStore {
  list(): Promise<CredentialStatus[]>;
  updateGitHubAppStatus(status: 'ok' | 'failed', checkedAt: string): Promise<void>;
  acquireCodexRenewalLease(owner: string, leaseSeconds: number): Promise<boolean>;
  refreshCodexRenewalLease(owner: string, leaseSeconds: number): Promise<boolean>;
  updateCopilotStatus(
    status: CredentialStatusValue,
    expiresAt: string | null,
    lastRenewedAt: string | null,
  ): Promise<void>;
  completeCodexRenewal(
    owner: string,
    status: Exclude<CredentialStatusValue, 'unknown'>,
    expiresAt: string | null,
    lastRenewedAt: string | null,
    releaseLease?: boolean,
  ): Promise<void>;
}

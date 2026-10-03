export type CredentialName = 'codex-login' | 'copilot-token' | 'github-app-key';
export type CredentialStatusValue = 'ok' | 'renew_soon' | 'failed' | 'unknown';

export interface CredentialStatus {
  name: CredentialName;
  expiresAt: string | null;
  lastRenewedAt: string | null;
  status: CredentialStatusValue;
}

export interface CredentialStatusStore {
  list(): Promise<CredentialStatus[]>;
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

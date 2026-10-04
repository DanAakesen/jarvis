import type { DispatchClaim } from './dispatcher.js';

export type RecoveryClaimResult =
  | { kind: 'claimed'; task: DispatchClaim }
  | { kind: 'not-found' | 'invalid-transition' | 'unavailable' };

export interface TaskRecoveryStore {
  claimRecovery(taskId: string, owner: string, leaseSeconds: number): Promise<RecoveryClaimResult>;
  getRunningTaskForSession(sandbox: {
    sandboxSessionId: string;
    foundrySessionId: string;
    invocationId: string;
  }): Promise<string | null>;
}

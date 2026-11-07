import { createHash } from 'node:crypto';
import type { ManagedTargetReadback } from './managed-target-reader.js';

/** Bump when the trusted policy transport changes; prior activation then fails closed. */
export const MANAGED_POLICY_TRANSPORT_REVISION = 'jarvis-fresh-policy-v2';

export function managedPolicyCompatibilityReceipt(metadata: ManagedTargetReadback): string {
  const { target } = metadata;
  return createHash('sha256').update(JSON.stringify([
    MANAGED_POLICY_TRANSPORT_REVISION, metadata.projectEndpoint.replace(/\/+$/u, ''),
    target.agentName, target.version, target.fingerprint, target.model, target.effort,
  ]), 'utf8').digest('hex');
}

export function hasManagedPolicyCompatibility(metadata: ManagedTargetReadback, receipt?: string): boolean {
  return typeof receipt === 'string' && /^[0-9a-f]{64}$/u.test(receipt) &&
    receipt === managedPolicyCompatibilityReceipt(metadata);
}

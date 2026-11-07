import { hasManagedPolicyCompatibility } from './managed-policy-compatibility.js';
import type { ManagedTargetReadback } from './managed-target-reader.js';

/** A configured adapter is usable only after its definition and policy checks pass. */
export interface RuntimeTestAvailability {
  readonly available: boolean;
  readonly reason?: 'storage_unavailable' | 'current_unavailable' | 'copilot_not_configured' | 'copilot_not_verified' | 'copilot_policy_not_verified' | 'verification_unavailable';
}

export interface ConversationRuntimeTests {
  readonly current: RuntimeTestAvailability;
  readonly copilot: RuntimeTestAvailability;
}

export type ConversationRuntimeTestReader = () => Promise<ConversationRuntimeTests>;

/** Missing activation evidence is already decisive; do not wait for Foundry. */
export async function readCopilotRuntimeTest(input: {
  readonly receipt?: string | undefined;
  readonly readTarget: () => Promise<ManagedTargetReadback | null>;
}): Promise<RuntimeTestAvailability> {
  if (!input.receipt || !/^[0-9a-f]{64}$/u.test(input.receipt)) {
    return { available: false, reason: 'copilot_policy_not_verified' };
  }
  const metadata = await input.readTarget();
  if (!metadata) return { available: false, reason: 'copilot_not_verified' };
  return hasManagedPolicyCompatibility(metadata, input.receipt)
    ? { available: true } : { available: false, reason: 'copilot_policy_not_verified' };
}

export async function readRuntimeTests(input: {
  readonly storageAvailable: boolean;
  readonly currentAvailable: boolean;
  readonly readVerified?: ConversationRuntimeTestReader | null;
}): Promise<ConversationRuntimeTests> {
  if (!input.storageAvailable) return {
    current: { available: false, reason: 'storage_unavailable' },
    copilot: { available: false, reason: 'storage_unavailable' },
  };
  const current = input.currentAvailable
    ? { available: true }
    : { available: false, reason: 'current_unavailable' as const };
  if (!input.readVerified) return { current, copilot: { available: false, reason: 'copilot_not_configured' } };
  try {
    const verified = await input.readVerified();
    const copilot = verified?.copilot;
    if (copilot?.available === true) return { current, copilot: { available: true } };
    const reason = copilot?.reason;
    return { current, copilot: { available: false, reason: reason === 'copilot_not_verified' ||
      reason === 'copilot_policy_not_verified' || reason === 'verification_unavailable' ? reason : 'verification_unavailable' } };
  } catch {
    return { current, copilot: { available: false, reason: 'verification_unavailable' } };
  }
}

export function runtimeTestUnavailableMessage(option: RuntimeTestAvailability): string {
  return option.reason === 'copilot_policy_not_verified'
    ? 'Copilot has not passed the check for applying Jarvis’s instructions. Use Current.'
    : 'The selected test runtime is unavailable. No other runtime was used.';
}

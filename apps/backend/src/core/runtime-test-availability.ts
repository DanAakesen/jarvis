/** A configured adapter is usable only after its definition and policy checks pass. */
export interface RuntimeTestAvailability {
  readonly available: boolean;
  readonly reason?: 'storage_unavailable' | 'current_unavailable' | 'copilot_not_verified' | 'verification_unavailable';
}

export interface ConversationRuntimeTests {
  readonly current: RuntimeTestAvailability;
  readonly copilot: RuntimeTestAvailability;
}

export type ConversationRuntimeTestReader = () => Promise<ConversationRuntimeTests>;

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
  if (!input.readVerified) return { current, copilot: { available: false, reason: 'copilot_not_verified' } };
  try {
    const verified = await input.readVerified();
    const copilot = verified?.copilot;
    if (copilot?.available === true) return { current, copilot: { available: true } };
    const reason = copilot?.reason;
    return { current, copilot: { available: false, reason: reason === 'copilot_not_verified' ||
      reason === 'verification_unavailable' ? reason : 'verification_unavailable' } };
  } catch {
    return { current, copilot: { available: false, reason: 'verification_unavailable' } };
  }
}

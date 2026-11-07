import { describe, expect, it, vi } from 'vitest';
import { readCopilotRuntimeTest, readRuntimeTests } from './runtime-test-availability.js';
import { managedPolicyCompatibilityReceipt } from './managed-policy-compatibility.js';

describe('runtime test availability', () => {
  it.each([undefined, '', 'invalid'])('returns missing compatibility immediately without provider work: %s', async receipt => {
    const readTarget = vi.fn(() => new Promise<never>(() => {}));
    const result = await readRuntimeTests({ storageAvailable: true, currentAvailable: true,
      readVerified: async () => ({ current: { available: true },
        copilot: await readCopilotRuntimeTest({ receipt, readTarget }) }) });
    expect(result).toEqual({ current: { available: true },
      copilot: { available: false, reason: 'copilot_policy_not_verified' } });
    expect(readTarget).not.toHaveBeenCalled();
  });
  it('still verifies live target and settings with a receipt; stale evidence cannot enable Copilot', async () => {
    const metadata = { projectEndpoint: 'https://fixture.services.ai.azure.com/api/projects/p',
      target: { agentName: 'agent', version: '1', fingerprint: 'a'.repeat(64), model: 'gpt-6.1-terra', effort: 'high' },
      definition: {} };
    const receipt = managedPolicyCompatibilityReceipt(metadata);
    const readTarget = vi.fn().mockResolvedValueOnce(metadata).mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...metadata, target: { ...metadata.target, version: '2' } });
    expect(await readCopilotRuntimeTest({ receipt, readTarget })).toEqual({ available: true });
    expect(await readCopilotRuntimeTest({ receipt, readTarget })).toEqual({ available: false, reason: 'copilot_not_verified' });
    expect(await readCopilotRuntimeTest({ receipt, readTarget })).toEqual({ available: false, reason: 'copilot_policy_not_verified' });
    expect(readTarget).toHaveBeenCalledTimes(3);
  });
  it('requires storage even when a provider verifier says ready', async () => {
    const result = await readRuntimeTests({ storageAvailable: false, currentAvailable: true,
      readVerified: async () => ({ current: { available: true }, copilot: { available: true } }) });
    expect(result.current).toEqual({ available: false, reason: 'storage_unavailable' });
    expect(result.copilot).toEqual(result.current);
  });
  it('requires explicit managed verification while preserving configured Current', async () => {
    expect(await readRuntimeTests({ storageAvailable: true, currentAvailable: true })).toEqual({
      current: { available: true }, copilot: { available: false, reason: 'copilot_not_configured' },
    });
  });
  it('preserves the policy compatibility reason while leaving Current available', async () => {
    const result = await readRuntimeTests({ storageAvailable: true, currentAvailable: true,
      readVerified: async () => ({ current: { available: false }, copilot: { available: false, reason: 'copilot_policy_not_verified' } }) });
    expect(result.current.available).toBe(true);
    expect(result.copilot).toEqual({ available: false, reason: 'copilot_policy_not_verified' });
  });
  it('keeps a verifier failure content-free and fails closed', async () => {
    const result = await readRuntimeTests({ storageAvailable: true, currentAvailable: false,
      readVerified: async () => { throw new Error('Private provider payload'); } });
    expect(result).toEqual({ current: { available: false, reason: 'current_unavailable' },
      copilot: { available: false, reason: 'verification_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('Private');
  });
});

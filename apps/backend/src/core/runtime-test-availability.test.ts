import { describe, expect, it } from 'vitest';
import { readRuntimeTests } from './runtime-test-availability.js';

describe('runtime test availability', () => {
  it('requires storage even when a provider verifier says ready', async () => {
    const result = await readRuntimeTests({ storageAvailable: false, currentAvailable: true,
      readVerified: async () => ({ current: { available: true }, copilot: { available: true } }) });
    expect(result.current).toEqual({ available: false, reason: 'storage_unavailable' });
    expect(result.copilot).toEqual(result.current);
  });
  it('requires explicit managed verification while preserving configured Current', async () => {
    expect(await readRuntimeTests({ storageAvailable: true, currentAvailable: true })).toEqual({
      current: { available: true }, copilot: { available: false, reason: 'copilot_not_verified' },
    });
  });
  it('keeps a verifier failure content-free and fails closed', async () => {
    const result = await readRuntimeTests({ storageAvailable: true, currentAvailable: false,
      readVerified: async () => { throw new Error('Private provider payload'); } });
    expect(result).toEqual({ current: { available: false, reason: 'current_unavailable' },
      copilot: { available: false, reason: 'verification_unavailable' } });
    expect(JSON.stringify(result)).not.toContain('Private');
  });
});

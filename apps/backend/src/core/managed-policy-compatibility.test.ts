import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hasManagedPolicyCompatibility, managedPolicyCompatibilityReceipt, MANAGED_POLICY_TRANSPORT_REVISION } from './managed-policy-compatibility.js';
import { loadConfig } from '../config.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../.github/scripts/tests/fixtures/managed-policy-compatibility.json', import.meta.url), 'utf8'));
const metadata = { projectEndpoint: fixture.projectEndpoint, target: fixture.target, definition: {} };

describe('full-policy activation evidence', () => {
  it('agrees with the independently exercised Python canary/activation contract', () => {
    expect(MANAGED_POLICY_TRANSPORT_REVISION).toBe(fixture.policyTransportRevision);
    expect(managedPolicyCompatibilityReceipt(metadata)).toBe(fixture.receipt);
    expect(hasManagedPolicyCompatibility(metadata, fixture.receipt)).toBe(true);
  });
  it.each([undefined, '', 'unverified', 'a'.repeat(64), fixture.receipt.toUpperCase()])('fails closed without exact evidence: %s', receipt => {
    expect(hasManagedPolicyCompatibility(metadata, receipt)).toBe(false);
  });
  it.each(['agentName', 'version', 'fingerprint', 'model', 'effort'] as const)('invalidates evidence when %s changes even with an equal fingerprint', field => {
    const target = { ...metadata.target, [field]: field === 'fingerprint' ? 'b'.repeat(64) : 'changed' };
    expect(hasManagedPolicyCompatibility({ ...metadata, target }, fixture.receipt)).toBe(false);
  });
  it('binds the project endpoint and normalizes only its trailing slash', () => {
    expect(hasManagedPolicyCompatibility({ ...metadata, projectEndpoint: `${metadata.projectEndpoint}/` }, fixture.receipt)).toBe(true);
    expect(hasManagedPolicyCompatibility({ ...metadata, projectEndpoint: `${metadata.projectEndpoint}-other` }, fixture.receipt)).toBe(false);
  });
  it('keeps Current configuration usable with missing or malformed receipt', () => {
    for (const receipt of ['', 'unverified', 'private\ninvalid']) {
      const config = loadConfig({ FOUNDRY_COPILOT_POLICY_COMPATIBILITY: receipt });
      expect(config.foundryCopilotPolicyCompatibility).toBeUndefined();
    }
    expect(loadConfig({ FOUNDRY_COPILOT_POLICY_COMPATIBILITY: fixture.receipt }).foundryCopilotPolicyCompatibility).toBe(fixture.receipt);
  });
});

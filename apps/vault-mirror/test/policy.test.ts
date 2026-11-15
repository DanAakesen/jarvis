import { describe, expect, it } from 'vitest';
import { isApprovedPath, validatePolicy } from '../src/engine/index.js';
import { policyData } from './fixtures.js';

const validated = validatePolicy({ ...policyData, allowedRoots: ['Notes', '_agent-log', '_agent-activity'] });
if (!validated.success) throw new Error('policy-invalid');
const { policy } = validated;

describe('isApprovedPath', () => {
  it('approves a regular note', () => {
    expect(isApprovedPath(policy, 'Notes/Ideas.md')).toBe(true);
  });

  it.each([
    'Notes/_agent-log/2026-11-15.md',
    'Notes/_agent-log/README.md',
    'Notes/_agent-activity/2026-11-15.md',
    'Notes/_agent-activity/README.md',
    'Notes/_AGENT-ACTIVITY/Day.md',
    '_agent-log/README.md',
    '_agent-activity/README.md',
  ])('never publishes %s', (path) => {
    expect(isApprovedPath(policy, path)).toBe(false);
  });
});

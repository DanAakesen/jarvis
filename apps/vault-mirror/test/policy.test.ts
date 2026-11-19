import { describe, expect, it } from 'vitest';
import { isApprovedPath, planReconcile, validatePolicy } from '../src/engine/index.js';
import { fixture, policyData, record } from './fixtures.js';

const validated = validatePolicy({ ...policyData, allowedRoots: ['Notes', 'General', '_agent-activity'] });
if (!validated.success) throw new Error('policy-invalid');
const { policy } = validated;

describe('isApprovedPath', () => {
  it.each([
    'Notes/Ideas.md',
    'General/Archive/Agent activity log/2026-06-10.md',
  ])('approves %s', (path) => {
    expect(isApprovedPath(policy, path)).toBe(true);
  });

  it.each([
    '_agent-activity/README.md',
    'Notes/_agent-activity/2026-11-15.md',
    'Notes/_AGENT-ACTIVITY/Day.md',
  ])('never publishes %s', (path) => {
    expect(isApprovedPath(policy, path)).toBe(false);
  });

  it('keeps the exact fixed guard reason and proposed direction counts', () => {
    const { input, texts } = fixture();
    const ours = new Map(input.O);
    for (let index = 0; index < 26; index += 1) {
      const path = `Notes/backlog-${index}.md`;
      texts.O.set(path, 'new');
      ours.set(path, record('new'));
    }
    const plan = planReconcile({ ...input, O: ours });
    expect(plan.verdict).toBe('guard-tripped');
    expect(plan.counters.guardReasons).toEqual({ 'max-changed-G': 1 });
    expect(plan.counters.changedOnG).toBe(26);
    expect(plan.counters.changedOnO).toBe(0);
    expect(plan.actions).toEqual([]);
  });
});

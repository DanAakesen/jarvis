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

  it('batches ordinary differences instead of turning a per-run cap into a permanent backlog', () => {
    const { input, texts } = fixture();
    const ours = new Map(input.O);
    for (let index = 0; index < 26; index += 1) {
      const path = `Notes/backlog-${index}.md`;
      texts.O.set(path, 'new');
      ours.set(path, record('new'));
    }
    const plan = planReconcile({ ...input, O: ours });
    expect(plan.verdict).toBe('ok');
    expect(plan.counters.guardReasons).toEqual({});
    expect(plan.counters.changedOnG).toBe(26);
    expect(plan.counters.changedOnO).toBe(0);
    expect(plan.counters.deferredOnG).toBe(1);
    expect(plan.counters.deferredOnO).toBe(0);
    expect(plan.actions.filter(action => action.kind === 'createOnG')).toHaveLength(25);
  });

  it('resolves a no-base conflict immediately in Obsidian favour', () => {
    const { input } = fixture('Obsidian text', 'GitHub text');
    const plan = planReconcile(input);
    expect(plan.verdict).toBe('ok');
    expect(plan.counters.conflicts).toBe(0);
    expect(plan.counters.resolvedInObsidianFavor).toBe(1);
    expect(plan.actions.filter(action => action.kind === 'updateOnG')).toHaveLength(1);
    expect(plan.skipped).toEqual([]);
  });

  it('reconciles an 11-note Obsidian backlog and a conflict in one ordinary run', () => {
    const { input, texts } = fixture('Obsidian text', 'GitHub text');
    const github = new Map(input.G);
    for (let index = 0; index < 11; index += 1) {
      const path = `Notes/stable-${index}.md`;
      texts.G.set(path, 'updated from GitHub');
      github.set(path, record('updated from GitHub'));
    }
    const plan = planReconcile({ ...input, G: github });
    expect(plan.verdict).toBe('ok');
    expect(plan.counters.guardReasons).toEqual({});
    expect(plan.counters.changedOnO).toBe(11);
    expect(plan.counters.changedOnG).toBe(1);
    expect(plan.counters.pendingWriteBack).toBe(0);
    expect(plan.counters.deferredOnO).toBe(0);
    expect(plan.counters.resolvedInObsidianFavor).toBe(1);
    expect(plan.actions.filter(action => action.kind === 'updateOnO')).toHaveLength(11);
  });

  it('retains hard side-loss guards while batching ordinary work', () => {
    const { input } = fixture();
    const plan = planReconcile({ ...input, O: new Map() });
    expect(plan.verdict).toBe('guard-tripped');
    expect(plan.counters.guardReasons).toMatchObject({
      'empty-side': 1,
      'missing-base-O': 1,
      'base-deletion-ratio': 1,
    });
    expect(plan.actions).toEqual([]);
  });

  it('does not advance success when deletes are disabled but a delete is required', () => {
    const { input } = fixture();
    const ours = new Map(input.O);
    ours.delete('Notes/stable-0.md');
    const plan = planReconcile({
      ...input,
      O: ours,
      limits: { ...input.limits, maxDeletes: 0 },
    });
    expect(plan.verdict).toBe('guard-tripped');
    expect(plan.counters.guardReasons).toMatchObject({ 'max-deletes-G': 1 });
    expect(plan.actions).toEqual([]);
  });
});

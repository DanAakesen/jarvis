import { describe, expect, it } from 'vitest';
import { isApprovedPath, planReconcile } from '../src/engine/index.js';
import type { ReconcileInput } from '../src/engine/types.js';
import { apply, fixture, note, record } from './fixtures.js';

// Exhaust the finite model instead of introducing a property-test dependency.
const values = [undefined, '', 'base', 'ours', 'theirs', 'line\r\n'] as const;
const combinations = values.flatMap(o => values.flatMap(g => values.map(b => [o, g, b] as const)));
const writes = (input: ReconcileInput) => planReconcile(input).actions.filter(action =>
  action.kind !== 'recordBase' && action.kind !== 'forgetBase');

describe('exhaustive model properties (216 three-way states)', () => {
  it('convergence: applying a full plan yields no further actions', () => {
    for (const [o, g, b] of combinations) {
      const { input, texts } = fixture(o, g, b);
      const plan = planReconcile(input);
      expect(planReconcile(apply(input, texts, plan.actions)).actions).toEqual([]);
    }
  });
  it('crash convergence: replan after every single action, including before base persistence', () => {
    for (const [o, g, b] of combinations) {
      const planned = planReconcile(fixture(o, g, b).input);
      for (let crash = 0; crash <= planned.actions.length; crash++) {
        const { input, texts } = fixture(o, g, b);
        let recovered = apply(input, texts, planned.actions.slice(0, crash));
        const retry = planReconcile(recovered);
        recovered = apply(recovered, texts, retry.actions);
        expect(planReconcile(recovered).actions).toEqual([]);
      }
    }
  });
  it('dry-run never plans an Obsidian write (GitHub uploads remain enabled by contract)', () => {
    for (const [o, g, b] of combinations) {
      const { input } = fixture(o, g, b);
      expect(writes({ ...input, writeBack: 'dry-run' }).every(action => !action.kind.endsWith('OnO'))).toBe(true);
    }
  });
  it('no unapproved path ever appears in an action or a skip', () => {
    const excluded = ['Other/note.md', 'Notes/.hidden/note.md', '../root.md', 'Notes/private.md', 'Notes/item.txt'];
    for (const [o, g, b] of combinations) {
      const { input } = fixture(o, g, b);
      const O = new Map(input.O);
      const G = new Map(input.G);
      const B = new Map(input.B);
      for (const path of excluded) {
        O.set(path, record('ours')); G.set(path, record('theirs')); B.set(path, record('base'));
      }
      const plan = planReconcile({ ...input, O, G, B });
      expect([...plan.actions, ...plan.skipped].every(action =>
        isApprovedPath(input.policy, action.path) ||
        ('reason' in action && action.reason === 'windows-path'))).toBe(true);
    }
  });
  it('no path has opposing directional writes outside an explicit clean merge', () => {
    for (const [o, g, b] of combinations) {
      const actions = writes(fixture(o, g, b).input);
      const toG = new Set(actions.filter(action => action.kind.endsWith('OnG')).map(action => action.path));
      expect(actions.filter(action => action.kind.endsWith('OnO')).every(action => !toG.has(action.path))).toBe(true);
    }
  });
  it('no change is dropped: each changed version is propagated, retained, or skipped with a reason', () => {
    for (const [o, g, b] of combinations) {
      const { input, texts } = fixture(o, g, b);
      const plan = planReconcile(input);
      const result = apply(input, texts, plan.actions);
      const skipped = plan.skipped.some(entry => entry.path === note && entry.reason.length > 0);
      for (const [side, initial] of [['O', o], ['G', g]] as const) {
        if (initial === b) continue;
        if (skipped) continue;
        if (initial === undefined) {
          // A simultaneous edit wins over deletion, exactly as the decision table specifies.
          const other = side === 'O' ? g : o;
          expect(!result.O.has(note) && !result.G.has(note) ||
            (other !== b && other !== undefined && result.O.get(note)?.hash === record(other).hash &&
              result.G.get(note)?.hash === record(other).hash)).toBe(true);
        } else {
          expect([result.O.get(note)?.hash, result.G.get(note)?.hash]).toContain(record(initial).hash);
        }
      }
    }
  });
});

describe('clean-merge recovery properties', () => {
  // Synthetic independent line additions; union is an idempotent three-way merge.
  const additions = ['left', 'right', 'é', 'other'];
  it('merged changes converge after a crash after each write and each base action', () => {
    for (const left of additions) for (const right of additions) {
      const setup = () => {
        const data = fixture(`base\n${left}`, `base\n${right}`, 'base');
        const merge: ReconcileInput['merge'] = (_base, ours, theirs) => ({
          clean: true, text: [...new Set([...ours.split('\n'), ...theirs.split('\n')])].sort().join('\n'),
        });
        return { ...data, input: { ...data.input, merge } };
      };
      const original = planReconcile(setup().input);
      for (let crash = 0; crash <= original.actions.length; crash++) {
        const { input, texts } = setup();
        let recovered = apply(input, texts, original.actions.slice(0, crash));
        const retry = planReconcile(recovered);
        recovered = apply(recovered, texts, retry.actions);
        expect(planReconcile(recovered).actions).toEqual([]);
        for (const version of [left, right]) {
          expect(texts.O.get(note)).toContain(version);
          expect(texts.G.get(note)).toContain(version);
        }
      }
    }
  });
});

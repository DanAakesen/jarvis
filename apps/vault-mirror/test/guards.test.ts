import { describe, expect, it } from 'vitest';
import { planReconcile } from '../src/engine/index.js';
import { fixture, note, record } from './fixtures.js';

describe('whole-plan guards: write nothing', () => {
  it.each(['G', 'O'] as const)('maxChanged exceeded in direction %s', side => {
    const { input } = fixture(side === 'G' ? 'ours' : undefined, side === 'O' ? 'theirs' : undefined);
    const plan = planReconcile({ ...input, limits: { maxChanged: 0, maxDeletes: 3 } });
    expect(plan.actions).toEqual([]);
    expect(plan.verdict).toBe('guard-tripped');
    expect(plan.counters.guardReasons[`max-changed-${side}`]).toBe(1);
    if (side === 'O') expect(plan.counters.pendingWriteBack).toBe(1);
  });
  it.each(['G', 'O'] as const)('maxDeletes exceeded in direction %s', side => {
    const { input } = fixture(side === 'O' ? 'base' : undefined, side === 'G' ? 'base' : undefined, 'base');
    const plan = planReconcile({ ...input, limits: { maxChanged: 25, maxDeletes: 0 } });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.guardReasons[`max-deletes-${side}`]).toBe(1);
  });
  it('deletions above 10% of base paths', () => {
    const { input } = fixture(undefined, 'base', 'base');
    const B = new Map([[note, record('base')]]);
    const plan = planReconcile({ ...input, B });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.guardReasons['base-deletion-ratio']).toBe(1);
  });
  it('deletions exactly 10% and missing exactly 20% do not trip ratio guards', () => {
    const { input } = fixture(undefined, 'base', 'base');
    const B = new Map([...input.B].slice(0, 9)).set(note, record('base'));
    const plan = planReconcile({ ...input, B });
    expect(plan.counters.guardReasons).toEqual({});
    expect(plan.counters.deleted).toBe(1);
  });
  it.each(['O', 'G'] as const)('more than 20% of base paths missing on %s', side => {
    const { input } = fixture();
    const paths = [...input.B.keys()];
    const map = new Map(input[side]);
    for (const path of paths.slice(0, 9)) map.delete(path);
    const plan = planReconcile({ ...input, [side]: map });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.guardReasons[`missing-base-${side}`]).toBe(1);
  });
  it('exactly 20% missing is allowed when it is not a deletion', () => {
    const { input } = fixture();
    const O = new Map(input.O);
    const B = new Map(input.B);
    const keys = [...B.keys()].slice(0, 8);
    for (const path of keys) { O.delete(path); B.set(path, record('older')); }
    expect(planReconcile({ ...input, O, B }).counters.guardReasons).toEqual({});
  });
  it.each(['O', 'G'] as const)('one side empty with at least 10 approved files on %s', side => {
    const { input } = fixture();
    const plan = planReconcile({ ...input, B: new Map(), [side === 'O' ? 'G' : 'O']: new Map() });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.guardReasons['empty-side']).toBe(1);
  });
  it('nine files versus empty does not trip the empty-side guard', () => {
    const { input } = fixture();
    const O = new Map([...input.O].slice(0, 9));
    expect(planReconcile({ ...input, O, G: new Map(), B: new Map() }).verdict).toBe('ok');
  });
  it('limits are inclusive', () => {
    const { input } = fixture('ours');
    expect(planReconcile({ ...input, limits: { maxChanged: 1, maxDeletes: 0 } }).counters.guardReasons).toEqual({});
  });
  it.each([
    { maxChanged: 101, maxDeletes: 3 }, { maxChanged: 25, maxDeletes: 11 },
    { maxChanged: -1, maxDeletes: 3 }, { maxChanged: 1.5, maxDeletes: 3 },
    { maxChanged: 25, maxDeletes: NaN },
  ])('invalid or above-hard-cap limits fail closed: %j', limits => {
    const { input } = fixture('ours');
    const plan = planReconcile({ ...input, limits });
    expect(plan.actions).toEqual([]);
    expect(plan.counters.guardReasons['invalid-input']).toBe(1);
  });
  it('invalid supplied time fails closed', () => {
    expect(planReconcile({ ...fixture().input, now: NaN }).verdict).toBe('guard-tripped');
  });
  it('guard trip removes even recordBase/forgetBase and counts gated write-back', () => {
    const { input } = fixture('same', 'same');
    const G = new Map(input.G).set('Notes/new.md', record('new'));
    const plan = planReconcile({
      ...input, G, limits: { maxChanged: 0, maxDeletes: 0 },
      readContent: (side, path) => path === 'Notes/new.md' ? 'new' : input.readContent(side, path),
    });
    expect(plan.actions).toEqual([]);
    expect(plan.counters).toMatchObject({ pushed: 0, writtenBack: 0, pendingWriteBack: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { SessionLookupAdmission, type LookupAdmission } from './admission.js';
import { ownerSessionPolicy, type LookupAdmissionPolicy } from './config.js';

const shipped = ownerSessionPolicy.lookupAdmission;
const minute = 60_000;
const start = Date.parse('2026-10-22T12:00:00.000Z');

function setup(overrides: Partial<LookupAdmissionPolicy> = {}) {
  let current = start;
  const admission = new SessionLookupAdmission({ ...shipped, ...overrides }, () => new Date(current));
  return { admission, advance: (ms: number) => { current += ms; } };
}

function admitted(result: LookupAdmission) {
  if (!result.admitted) throw new Error(`Expected the lookup to be admitted, retry after ${result.retryAfterSeconds} s`);
  return result;
}

// A budget of one lookup that stays spent for an hour, so only the exemption can let an id through.
const spentBudget = { unverifiedBudget: { windowMs: 60 * minute, max: 1 } } satisfies Partial<LookupAdmissionPolicy>;

function spendBudget(admission: SessionLookupAdmission) {
  admitted(admission.admit('spender')).release();
  expect(admission.admit('refused')).toMatchObject({ admitted: false });
}

describe('session lookup admission', () => {
  describe('the budget for unfamiliar ids', () => {
    it('admits the budget and refuses the rest with the time until the window has room', () => {
      const { admission } = setup();
      for (let index = 0; index < shipped.unverifiedBudget.max; index += 1) admitted(admission.admit(`id-${index}`)).release();
      expect(admission.admit('one-more')).toEqual({ admitted: false, retryAfterSeconds: shipped.unverifiedBudget.windowMs / 1000 });
    });

    it('admits again once the oldest lookups have left the window', () => {
      const { admission, advance } = setup();
      for (let index = 0; index < shipped.unverifiedBudget.max; index += 1) admitted(admission.admit(`id-${index}`)).release();
      advance(minute - 1);
      expect(admission.admit('late')).toEqual({ admitted: false, retryAfterSeconds: 1 });
      advance(1);
      admitted(admission.admit('late')).release();
    });

    it('does not count a refused lookup, so a flood cannot extend its own throttling', () => {
      const { admission, advance } = setup();
      for (let index = 0; index < shipped.unverifiedBudget.max; index += 1) admitted(admission.admit(`id-${index}`)).release();
      advance(minute / 2);
      for (let index = 0; index < 1_000; index += 1) expect(admission.admit(`flood-${index}`)).toMatchObject({ admitted: false });
      advance(minute / 2);
      for (let index = 0; index < shipped.unverifiedBudget.max; index += 1) admitted(admission.admit(`next-${index}`)).release();
    });
  });

  describe('the cap on unfamiliar lookups in flight', () => {
    it('refuses beyond the cap with a fixed retry advice and spends no budget on a refused lookup', () => {
      const { admission } = setup();
      const cap = shipped.maxConcurrentUnverified;
      const held = Array.from({ length: cap }, (_unused, index) => admitted(admission.admit(`held-${index}`)));
      for (let index = 0; index < 100; index += 1) {
        expect(admission.admit(`refused-${index}`)).toEqual({ admitted: false, retryAfterSeconds: shipped.throttledRetryAfterSeconds });
      }
      for (const lookup of held) lookup.release();
      for (let index = 0; index < shipped.unverifiedBudget.max - cap; index += 1) admitted(admission.admit(`later-${index}`)).release();
      expect(admission.admit('over')).toMatchObject({ admitted: false, retryAfterSeconds: shipped.unverifiedBudget.windowMs / 1000 });
    });

    it('frees a slot when a lookup ends', () => {
      const { admission } = setup({ maxConcurrentUnverified: 2 });
      const first = admitted(admission.admit('a'));
      admitted(admission.admit('b'));
      expect(admission.admit('c')).toMatchObject({ admitted: false });
      first.release();
      admitted(admission.admit('c'));
    });

    it('frees a slot once however often release is called', () => {
      const { admission } = setup({ maxConcurrentUnverified: 1 });
      const first = admitted(admission.admit('a'));
      first.release();
      first.release();
      first.release();
      const second = admitted(admission.admit('b'));
      expect(admission.admit('c')).toMatchObject({ admitted: false });
      second.release();
    });
  });

  describe('recently verified ids', () => {
    it('pass the budget and the cap, so the owner is not throttled by a flood', () => {
      const { admission } = setup({ ...spentBudget, maxConcurrentUnverified: 1 });
      admission.verified('known');
      const stranger = admitted(admission.admit('stranger'));
      expect(admission.admit('another')).toMatchObject({ admitted: false });
      const held = Array.from({ length: 10 }, () => admitted(admission.admit('known')));
      for (const lookup of held) lookup.release();
      stranger.release();
    });

    it('still count towards the overall ceiling', () => {
      const { admission } = setup({ maxConcurrent: 3, maxConcurrentUnverified: 2 });
      admission.verified('known');
      const held = Array.from({ length: 3 }, () => admitted(admission.admit('known')));
      expect(admission.admit('known')).toEqual({ admitted: false, retryAfterSeconds: shipped.throttledRetryAfterSeconds });
      held[0]?.release();
      admitted(admission.admit('known')).release();
    });

    it('keep room beyond the unfamiliar lane while that lane is full', () => {
      const { admission } = setup();
      admission.verified('known');
      const flood = Array.from({ length: shipped.maxConcurrentUnverified }, (_unused, index) => admitted(admission.admit(`stranger-${index}`)));
      expect(admission.admit('one-more-stranger')).toMatchObject({ admitted: false });
      const room = shipped.maxConcurrent - shipped.maxConcurrentUnverified;
      const known = Array.from({ length: room }, () => admitted(admission.admit('known')));
      expect(admission.admit('known')).toMatchObject({ admitted: false });
      for (const lookup of [...flood, ...known]) lookup.release();
    });

    it('are only those that a verification added', () => {
      const { admission } = setup(spentBudget);
      spendBudget(admission);
      expect(admission.admit('never-verified')).toMatchObject({ admitted: false });
      admission.verified('verified');
      admitted(admission.admit('verified')).release();
    });

    it('fall back to the budget as soon as one is forgotten', () => {
      const { admission } = setup(spentBudget);
      admission.verified('one');
      admission.verified('two');
      admission.forget('one');
      admitted(admission.admit('two')).release();
      admitted(admission.admit('one')).release();
      expect(admission.admit('one')).toMatchObject({ admitted: false });
    });

    it('are limited in number and the least recently verified is dropped first', () => {
      const { admission } = setup({ ...spentBudget, recentlyVerifiedCapacity: 3 });
      spendBudget(admission);
      for (const id of ['a', 'b', 'c']) admission.verified(id);
      admission.verified('a');
      admission.verified('d');
      expect(admission.admit('b')).toMatchObject({ admitted: false });
      for (const id of ['a', 'c', 'd']) admitted(admission.admit(id)).release();
    });

    it('lapse after the time to live, which every successful verification starts afresh', () => {
      const { admission, advance } = setup({ ...spentBudget, recentlyVerifiedTtlMs: 10 * minute });
      spendBudget(admission);
      admission.verified('known');
      advance(10 * minute - 1);
      admitted(admission.admit('known')).release();
      admission.verified('known');
      advance(10 * minute - 1);
      admitted(admission.admit('known')).release();
      advance(1);
      expect(admission.admit('known')).toMatchObject({ admitted: false });
    });

    it('do not outlast the time to live because a lookup merely ran', () => {
      const { admission, advance } = setup({ ...spentBudget, recentlyVerifiedTtlMs: 10 * minute });
      spendBudget(admission);
      admission.verified('known');
      advance(6 * minute);
      admitted(admission.admit('known')).release();
      advance(4 * minute);
      expect(admission.admit('known')).toMatchObject({ admitted: false });
    });
  });

  describe('the shipped policy', () => {
    it('leaves room for recently verified sessions beyond the lane of unfamiliar ones', () => {
      expect(shipped.maxConcurrent).toBeGreaterThan(shipped.maxConcurrentUnverified);
    });

    it('holds positive whole numbers only', () => {
      const numbers = [
        shipped.unverifiedBudget.windowMs, shipped.unverifiedBudget.max, shipped.maxConcurrentUnverified, shipped.maxConcurrent,
        shipped.recentlyVerifiedCapacity, shipped.recentlyVerifiedTtlMs, shipped.throttledRetryAfterSeconds,
      ];
      for (const value of numbers) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    });

    it('is frozen, so no caller can loosen it at run time', () => {
      expect(Object.isFrozen(shipped)).toBe(true);
      expect(Object.isFrozen(shipped.unverifiedBudget)).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from './rate-limit.js';

const windows = [{ windowMs: 60_000, max: 5 }, { windowMs: 3_600_000, max: 30 }];

function clock() {
  let current = Date.parse('2026-10-22T12:00:00.000Z');
  return { now: () => new Date(current), advance: (ms: number) => { current += ms; } };
}

describe('sliding window rate limiter', () => {
  it('allows the limit inside a window and then says how long to wait', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter(windows, time.now);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.consume('owner')).toEqual({ allowed: true });
      time.advance(1_000);
    }
    expect(limiter.consume('owner')).toEqual({ allowed: false, retryAfterSeconds: 55 });
  });

  it('frees a slot as soon as the oldest hit leaves the window', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter(windows, time.now);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume('owner');
      time.advance(1_000);
    }
    time.advance(54_999);
    expect(limiter.consume('owner')).toEqual({ allowed: false, retryAfterSeconds: 1 });
    time.advance(1);
    expect(limiter.consume('owner')).toEqual({ allowed: true });
  });

  it('does not count a refused attempt against the caller', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter(windows, time.now);
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.consume('owner');
    for (let attempt = 0; attempt < 20; attempt += 1) expect(limiter.consume('owner').allowed).toBe(false);
    time.advance(60_000);
    for (let attempt = 0; attempt < 5; attempt += 1) expect(limiter.consume('owner')).toEqual({ allowed: true });
  });

  it('applies the hourly limit after the per-minute window has emptied', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter(windows, time.now);
    for (let minute = 0; minute < 6; minute += 1) {
      for (let attempt = 0; attempt < 5; attempt += 1) expect(limiter.consume('owner')).toEqual({ allowed: true });
      time.advance(60_000);
    }
    expect(limiter.consume('owner')).toEqual({ allowed: false, retryAfterSeconds: 3_240 });
    time.advance(3_240_000);
    expect(limiter.consume('owner')).toEqual({ allowed: true });
  });

  it('keeps separate counts per key', () => {
    const limiter = new SlidingWindowRateLimiter(windows, clock().now);
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.consume('first');
    expect(limiter.consume('first').allowed).toBe(false);
    expect(limiter.consume('second')).toEqual({ allowed: true });
  });

  it('never advises a wait shorter than one second', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter([{ windowMs: 1_000, max: 1 }], time.now);
    limiter.consume('owner');
    time.advance(999);
    expect(limiter.consume('owner')).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { createSessionLimits } from './session-limits.js';

describe('voice session limits', () => {
  it('ends after idle time unless the user is active, and always at the absolute cap', () => {
    let now = 0;
    const limits = createSessionLimits(() => now, 600_000, 1_800_000);
    now = 599_000;
    expect(limits.due()).toBeUndefined();
    limits.touch();
    now = 1_198_000;
    expect(limits.due()).toBeUndefined();
    now = 1_199_000;
    expect(limits.due(true)).toBeUndefined();
    expect(limits.due()).toBe('inactivity');
    now = 1_800_000;
    expect(limits.due(true)).toBe('max_duration');
  });
});

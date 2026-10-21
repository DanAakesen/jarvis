import { describe, expect, it } from 'vitest';
import { firstName, healthHeadline } from './greeting';

describe('health headline', () => {
  it.each([
    ['Alex Example', 'Alex'],
    ['  Alex   Example  ', 'Alex'],
    ['Example, Alex', 'Alex'],
    ['Alex', 'Alex'],
  ])('reads the first name from %j', (name, first) => {
    expect(firstName(name)).toBe(first);
    expect(healthHeadline(name)).toBe(`Hey ${first}`);
  });

  it.each([null, undefined, '', '   ', 'alex@example.invalid', 'x'.repeat(41)])('falls back to a plain headline for %j', name => {
    expect(firstName(name)).toBeNull();
    expect(healthHeadline(name)).toBe('Health');
  });

  it('never puts the word Daily in the headline', () => {
    expect(healthHeadline(null)).not.toMatch(/daily/iu);
  });
});

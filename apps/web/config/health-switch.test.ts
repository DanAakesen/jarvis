import { describe, expect, it } from 'vitest';
import { parseHealthEnabled } from './health-switch';

describe('Daily web switch', () => {
  it('is off when the build variable is absent or explicitly false', () => {
    expect(parseHealthEnabled(undefined)).toBe(false);
    expect(parseHealthEnabled('false')).toBe(false);
  });

  it('is on only for the exact string true', () => {
    expect(parseHealthEnabled('true')).toBe(true);
  });

  it.each(['', 'TRUE', 'True', '1', '0', 'yes', 'on', ' true', 'true ', 'enabled'])(
    'fails the build for an ambiguous value (%j) rather than guessing', (value) => {
      expect(() => parseHealthEnabled(value)).toThrow(/^VITE_HEALTH_ENABLED must be true or false$/);
    },
  );
});

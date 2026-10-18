import { describe, expect, it } from 'vitest';
import { parseDailyEnabled } from './daily-switch';

describe('Daily web switch', () => {
  it('is off when the build variable is absent or explicitly false', () => {
    expect(parseDailyEnabled(undefined)).toBe(false);
    expect(parseDailyEnabled('false')).toBe(false);
  });

  it('is on only for the exact string true', () => {
    expect(parseDailyEnabled('true')).toBe(true);
  });

  it.each(['', 'TRUE', 'True', '1', '0', 'yes', 'on', ' true', 'true ', 'enabled'])(
    'fails the build for an ambiguous value (%j) rather than guessing', (value) => {
      expect(() => parseDailyEnabled(value)).toThrow(/^VITE_DAILY_ENABLED must be true or false$/);
    },
  );
});

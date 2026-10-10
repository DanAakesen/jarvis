import { describe, expect, it } from 'vitest';
import { getSignInGreeting } from './sign-in-greeting';

describe('sign-in greeting', () => {
  it.each([
    [4, 'Good evening, Dan.'],
    [5, 'Good morning, Dan.'],
    [11, 'Good morning, Dan.'],
    [12, 'Good afternoon, Dan.'],
    [17, 'Good afternoon, Dan.'],
    [18, 'Good evening, Dan.'],
  ])('uses local hour %i', (hour, greeting) => {
    expect(getSignInGreeting(new Date(2026, 0, 1, hour))).toBe(greeting);
  });
});

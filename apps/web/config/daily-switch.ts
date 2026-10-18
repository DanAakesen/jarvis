/**
 * Build-time switch for the Daily area (VITE_DAILY_ENABLED). Absent means Daily is off and the web client is
 * unchanged. Only the exact strings "true" and "false" are valid: a typo fails the build instead of guessing.
 */
export function parseDailyEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('VITE_DAILY_ENABLED must be true or false');
}

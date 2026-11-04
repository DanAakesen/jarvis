/**
 * Build-time switch for the Health area (VITE_HEALTH_ENABLED; the retired VITE_DAILY_ENABLED is read only while the new name is absent). Absent means Health is off and the web client is
 * unchanged. Only the exact strings "true" and "false" are valid: a typo fails the build instead of guessing.
 */
export function parseHealthEnabled(value: string | undefined): boolean {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('VITE_HEALTH_ENABLED must be true or false');
}

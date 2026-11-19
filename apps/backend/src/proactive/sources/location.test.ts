import { describe, expect, it } from 'vitest';
import type { SettingsStore } from '../../core/settings.js';
import { createLocationSource } from './location.js';

const at = '2026-11-19T05:00:00.000Z';
const settingsStore = (values: Record<string, unknown>): SettingsStore => ({
  async read() {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
  },
  async write() {},
});

describe('independent coarse location source', () => {
  it('returns a bounded coarse fact with permission and observation time', async () => {
    const source = createLocationSource(settingsStore({
      'location.home_city': 'Copenhagen',
      'location.latitude': 55.67,
      'location.longitude': 12.56,
      'location.observed_at': at,
      'location.permission': 'granted',
    }));
    const result = await source.read({
      now: new Date(at),
      signal: new AbortController().signal,
      settings: {} as never,
    });
    expect(result).toMatchObject({
      source: 'location',
      state: 'ok',
      observedAt: at,
    });
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({ ref: 'location:device', kind: 'location' });
    expect(result.facts[0]!.text).toContain('coarse_about_1km');
    expect(result.facts[0]!.text).toContain('hotels');
  });

  it('shows denied and missing permission as unavailable, never as a fresh position', async () => {
    const denied = createLocationSource(settingsStore({
      'location.home_city': 'Copenhagen',
      'location.latitude': 55.67,
      'location.longitude': 12.56,
      'location.observed_at': at,
      'location.permission': 'denied',
    }));
    const missing = createLocationSource(settingsStore({}));
    const context = { now: new Date(at), signal: new AbortController().signal, settings: {} as never };
    await expect(denied.read(context)).resolves.toMatchObject({
      state: 'unavailable', reason: 'location_permission_denied', facts: [],
    });
    await expect(missing.read(context)).resolves.toMatchObject({
      state: 'unavailable', reason: 'location_permission_not_granted', facts: [],
    });
  });
});

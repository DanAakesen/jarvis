import { readSettings, type SettingsStore } from '../../core/settings.js';
import type { ProactiveSource } from '../types.js';

export const LOCATION_FRESHNESS_MS = 6 * 60 * 60_000;

/** Coarse, permissioned device context. It is independent from Weather and never implies a fresh device fix. */
export function createLocationSource(settingsStore?: SettingsStore): ProactiveSource {
  return {
    id: 'location',
    label: 'Location',
    async read({ now, signal }) {
      signal.throwIfAborted();
      if (!settingsStore) {
        return { source: 'location', state: 'unavailable', reason: 'not_connected', facts: [], observedAt: now.toISOString() };
      }
      const settings = (await readSettings(settingsStore)).location;
      if (settings.permission !== 'granted') {
        return {
          source: 'location',
          state: 'unavailable',
          reason: settings.permission === 'denied' || settings.permission === 'restricted'
            ? `location_permission_${settings.permission}`
            : 'location_permission_not_granted',
          facts: [],
          observedAt: settings.observedAt ?? now.toISOString(),
        };
      }
      if (!settings.city || settings.latitude === null || settings.longitude === null || settings.observedAt === null) {
        return {
          source: 'location',
          state: 'unavailable',
          reason: 'no_location',
          facts: [],
          observedAt: settings.observedAt ?? now.toISOString(),
        };
      }
      if (now.getTime() - Date.parse(settings.observedAt) > LOCATION_FRESHNESS_MS) {
        return {
          source: 'location',
          state: 'unavailable',
          reason: 'location_observation_stale',
          facts: [],
          observedAt: settings.observedAt,
        };
      }
      const text = JSON.stringify({
        city: settings.city,
        latitude: settings.latitude,
        longitude: settings.longitude,
        precision: 'coarse_about_1km',
        permission: settings.permission,
        supports: ['hotels', 'flights', 'driving', 'traffic', 'maps'],
        note: 'Use as a last observed device position, never as a live location assertion.',
      });
      return {
        source: 'location',
        state: 'ok',
        reason: null,
        observedAt: settings.observedAt,
        facts: [{
          ref: 'location:device',
          identity: 'location:device',
          kind: 'location',
          label: `Coarse device location near ${settings.city}`,
          text,
          observedAt: settings.observedAt,
        }],
      };
    },
  };
}

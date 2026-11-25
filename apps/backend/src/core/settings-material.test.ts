import { describe, expect, it } from 'vitest';
import { flattenSettings, readSettings, validateSettingsPatch } from './settings.js';

describe('native surface appearance', () => {
  it('round-trips independent percentages without replacing existing colours', async () => {
    const appearance = { gradient: 0, frost: 100, glass: 42 };
    const patch = { appearance };
    expect(validateSettingsPatch(patch)).toEqual(patch);
    const saved = Object.fromEntries(flattenSettings(patch).map(({ key, value }) => [key, value]));
    saved['appearance.accent'] = JSON.stringify('#ffb45c');
    const settings = await readSettings({ read: async () => saved, write: async () => {} });
    expect(settings.appearance).toMatchObject({ ...appearance, accent: '#ffb45c' });
  });

  it('stores the glow source independently of the custom colour and palette', async () => {
    const appearance = { 'card-glow': 'custom', 'card-glow-color': '#BA55CC' } as const;
    const patch = { appearance };
    expect(validateSettingsPatch(patch)).toEqual(patch);
    const values = Object.fromEntries(flattenSettings(patch).map(({ key, value }) => [key, value]));
    const saved = await readSettings({ read: async () => values, write: async () => {} });
    expect(saved.appearance).toMatchObject(appearance);
    for (const source of ['primary', 'secondary']) {
      expect(validateSettingsPatch({ appearance: { 'card-glow': source } })).toBeTruthy();
    }
    expect(validateSettingsPatch({ appearance: { 'card-glow': 'auto' } })).toBeNull();
    expect(validateSettingsPatch({ appearance: { 'card-glow-color': 'red' } })).toBeNull();
  });

  it.each(['light', 'dark', 'system'])('preserves %s display mode when the orb accent changes', async (theme) => {
    const values: Record<string, string> = { 'appearance.theme': JSON.stringify(theme) };
    for (const { key, value } of flattenSettings({ appearance: { accent: '#F54253' } })) {
      values[key] = value;
    }
    const saved = await readSettings({ read: async () => values, write: async () => {} });
    expect(saved.appearance).toMatchObject({ theme, accent: '#F54253' });
  });

  it('rejects invalid percentages for each slider', () => {
    for (const key of ['gradient', 'frost', 'glass']) {
      for (const value of [-1, 101, 10.5, '30', null]) {
        expect(validateSettingsPatch({ appearance: { [key]: value } })).toBeNull();
      }
    }
  });
});

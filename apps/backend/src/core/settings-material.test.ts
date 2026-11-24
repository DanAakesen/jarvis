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

  it('rejects invalid percentages for each slider', () => {
    for (const key of ['gradient', 'frost', 'glass']) {
      for (const value of [-1, 101, 10.5, '30', null]) {
        expect(validateSettingsPatch({ appearance: { [key]: value } })).toBeNull();
      }
    }
  });
});

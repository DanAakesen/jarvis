import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { coreModule } from './index.js';
import type { SettingsPatch } from './settings.js';
import { setThemeTool } from './theme.js';

const config = { ...loadConfig({}), logLevel: 'silent' as const };
const written: SettingsPatch[] = [];

const app = buildApp(config, undefined, {
  modules: [coreModule],
  auth: async () => ({ kind: 'jarvis-agent', objectId: 'b331004a-777a-4e53-b7b0-40bf9ab3b9ef', tenantId: config.auth.tenantId }),
  toolCallStore: { record: async () => {} },
  settingsStore: { read: async () => ({}), write: async (patch) => { written.push(patch); } },
});

beforeAll(async () => { await app.ready(); });
afterAll(async () => { await app.close(); });
beforeEach(() => { written.length = 0; });

/** One set_theme call through the real dispatcher, as Jarvis makes it. */
async function callTool(tokens: unknown) {
  const response = await app.inject({
    method: 'POST', url: '/tools/set_theme', payload: { tokens },
    headers: { authorization: ['Bearer', 'header.agent.signature'].join(' '), 'x-jarvis-message-id': '101' },
  });
  return response.json() as { outcome: string; result: { refused?: string } };
}

describe('set_theme glow and radius', () => {
  it.each([['glow', 0], ['radius', 0]])('accepts %s of 0 and stores 0', async (key, value) => {
    const answer = await callTool({ [key]: value });
    expect(answer).toMatchObject({ outcome: 'ok', result: { updated: true, tokens: { [key]: value } } });
    expect(written).toEqual([{ appearance: { [key]: value } }]);
  });

  it.each(['glow', 'radius'])('refuses a null %s instead of storing 0', async (key) => {
    const answer = await callTool({ [key]: null });
    expect(answer.outcome).toBe('refused');
    expect(answer.result.refused).toContain(`tokens.${key} must be a number, not null`);
    expect(written).toEqual([]);
  });

  it.each([{ glow: 1.5 }, { radius: 25 }])('still refuses %j as out of range', async (tokens) => {
    expect((await callTool(tokens)).outcome).toBe('refused');
    expect(written).toEqual([]);
  });

  it('leaves odd bodies to the schema instead of throwing', () => {
    for (const body of [null, 'text', [], {}, { tokens: 'dark' }, { tokens: [null] }, { tokens: { accent: null } }]) {
      expect(setThemeTool.validateInput?.(body)).toBe(true);
    }
  });
});

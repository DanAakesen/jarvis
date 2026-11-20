import { describe, expect, it } from 'vitest';
import { defaultAwayModeState } from '../core/away-mode.js';
import { defaultSettings } from '../core/settings.js';
import { buildPiContext, buildPiEnvironment } from './context.js';

const sub = '11111111-2222-4333-8444-555555555555';
const id = `/subscriptions/${sub}/resourceGroups/rg-jarvis/providers/Microsoft.App/containerApps/ca-jarvis-backend-abc123`;

describe('the PI environment note', () => {
  it('gives the Azure subscription and the Jarvis resource group from the backend\'s own resource ID, and the GitHub defaults', () => {
    const note = buildPiEnvironment({ BACKEND_CONTAINER_APP_RESOURCE_ID: id });
    expect(note).toContain(`subscription ID ${sub}`);
    expect(note).toContain('resource group "rg-jarvis"');
    expect(note).toContain('"ca-jarvis-backend-abc123"');
    expect(note).toContain('DanAakesen/jarvis');
    expect(note).toContain('DanAakesen/vault');
  });

  it('says nothing about Azure when the backend does not know where it runs, and ignores a malformed ID', () => {
    for (const env of [{}, { BACKEND_CONTAINER_APP_RESOURCE_ID: 'not-an-id' }, { BACKEND_CONTAINER_APP_RESOURCE_ID: id.replace('containerApps', 'sites') }]) {
      const note = buildPiEnvironment(env);
      expect(note).not.toContain('Azure:');
      expect(note).toContain('GitHub:');
    }
  });
});

describe('the trusted PI owner context', () => {
  it('carries Personal Memory capture policy and current owner-instruction authority', () => {
    const settings = {
      ...defaultSettings,
      memory: { ...defaultSettings.memory, automaticCapture: false },
      personality: {
        ...defaultSettings.personality,
        customInstructions: 'Prefer dry humour.',
      },
    };
    const context = buildPiContext(settings, defaultAwayModeState);
    expect(context).toContain('Personal Memory automatic capture: disabled');
    expect(context).toContain('explicit owner request to remember always uses Personal Memory');
    expect(context).toContain('current Dan message authorizes only its stated, resolved scope');
    expect(context).toContain('"Prefer dry humour."');
    expect(context).toContain('Apply the identity, tone, response style, custom instructions and current-mode instruction');
    expect(context).toContain('Voice changes only spoken delivery, never personality');
  });
});

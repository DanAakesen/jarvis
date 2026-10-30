import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const configured = { FOUNDRY_PROJECT_ENDPOINT: 'https://fixture.services.ai.azure.com/api/projects/fixture',
  JARVIS_CHAT_AGENT_NAME: 'jarvis', FOUNDRY_COPILOT_AGENT_NAME: 'jarvis-main-copilot-preview',
  FOUNDRY_COPILOT_AGENT_VERSION: '1', FOUNDRY_COPILOT_DEFINITION_SHA256: 'a'.repeat(64) };

describe('optional pinned Copilot target', () => {
  it('stays absent without configuration', () => {
    expect(loadConfig({}).foundryCopilot).toBeUndefined();
  });
  it('retains the current agent and selects no alternative model or region', () => {
    const result = loadConfig(configured);
    expect(result.foundryChatAgentName).toBe('jarvis');
    expect(result.foundryCopilot).toEqual({ agentName: 'jarvis-main-copilot-preview', version: '1', fingerprint: 'a'.repeat(64) });
  });
  it.each([
    { FOUNDRY_COPILOT_AGENT_VERSION: '' },
    { FOUNDRY_COPILOT_DEFINITION_SHA256: 'invalid' },
    { FOUNDRY_COPILOT_AGENT_NAME: 'jarvis' },
    { FOUNDRY_PROJECT_ENDPOINT: '' },
  ])('rejects incomplete or current-agent replacement configuration', patch => {
    expect(() => loadConfig({ ...configured, ...patch })).toThrow();
  });
});

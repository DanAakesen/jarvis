import { describe, expect, it } from 'vitest';
import { modelRoles } from '@jarvis/contracts';
import {
  MAX_AGENT_TOOLS,
  MAX_CATALOGUE_BYTES,
  MAX_TOOL_DESCRIPTION_CHARACTERS,
} from './tool-registry.js';
import { checkAgentContract } from './agent-contract.js';

function tool(name = 'valid_tool', overrides: Record<string, unknown> = {}) {
  return {
    name,
    description: 'A valid tool description.',
    inputSchema: { type: 'object' },
    ...overrides,
  };
}

function settings() {
  const roles = Object.fromEntries(modelRoles.map((role) => [role, {
    model: 'gpt-6-luna',
    reasoningEffort: 'none',
  }]));
  return {
    model: 'gpt-6-luna',
    reasoningEffort: 'none',
    roles,
    mode: 'present',
    awayMode: false,
    changedAt: null,
    personality: {
      tone: 'british_butler',
      responseStyle: 'concise',
      customInstructions: '',
      modeInstructions: { present: '', away: '', on_the_move: '' },
    },
    timeouts: { toolTimeoutSeconds: 30, longToolTimeoutSeconds: 320, backendHttpTimeoutSeconds: 10 },
    research: { timeoutSeconds: 305 },
    capabilityInstructions: 'Safe shared instructions.',
  };
}

describe('agent contract smoke check', () => {
  it('accepts a valid tool catalogue and agent settings payload', async () => {
    await expect(checkAgentContract([tool()], async () => settings())).resolves.toEqual({ status: 'ok' });
  });

  it.each([
    ['too many tools', Array.from({ length: MAX_AGENT_TOOLS + 1 }, (_, index) => tool(`tool_${index}`))],
    ['bad name', [tool('bad.name')]],
    ['duplicate name', [tool('duplicate'), tool('duplicate')]],
    ['empty description', [tool('empty_description', { description: '  ' })]],
    ['over-long description', [tool('long_description', {
      description: 'x'.repeat(MAX_TOOL_DESCRIPTION_CHARACTERS + 1),
    })]],
    ['non-object schema', [tool('invalid_schema', { inputSchema: { type: 'array' } })]],
    ['oversized catalogue', [tool('large_schema', {
      inputSchema: { type: 'object', properties: { large: { description: 'x'.repeat(MAX_CATALOGUE_BYTES) } } },
    })]],
  ])('reports down for %s without returning descriptor content', async (_name, tools) => {
    const result = await checkAgentContract(tools, async () => settings());
    expect(result.status).toBe('down');
    expect(result.reason).toEqual(expect.any(String));
    expect(result.reason).not.toContain('duplicate');
    expect(result.reason).not.toContain('bad.name');
  });

  it('reports malformed or unavailable settings with fixed safe reasons', async () => {
    await expect(checkAgentContract([tool()], async () => ({ mode: 'unsupported' }))).resolves.toEqual({
      status: 'down',
      reason: 'Agent settings have an invalid shape.',
    });
    await expect(checkAgentContract([tool()], async () => { throw new Error('private settings'); })).resolves.toEqual({
      status: 'down',
      reason: 'Agent settings could not be built.',
    });
  });
});

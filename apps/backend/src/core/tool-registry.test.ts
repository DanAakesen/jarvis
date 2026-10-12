import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createToolRegistry,
  MAX_AGENT_TOOLS,
  MAX_CATALOGUE_BYTES,
  MAX_TOOL_DESCRIPTION_CHARACTERS,
  type JarvisTool,
} from './tool-registry.js';

const limits = JSON.parse(readFileSync(
  new URL('../../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
)) as { maxTools: number; maxToolDescriptionCharacters: number; maxCatalogueBytes: number };

function tool(name: string, overrides: Partial<JarvisTool> = {}): JarvisTool {
  return {
    name,
    description: `Tool ${name}.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({}),
    ...overrides,
  };
}

function tools(count: number): JarvisTool[] {
  return Array.from({ length: count }, (_, index) => tool(`tool_${index}`));
}

describe('tool catalogue limits (the agent rejects the whole catalogue, and every chat turn, past these)', () => {
  it('keeps the backend limits identical to agents/jarvis/limits.json that the agent reads', () => {
    expect(MAX_AGENT_TOOLS).toBe(limits.maxTools);
    expect(MAX_TOOL_DESCRIPTION_CHARACTERS).toBe(limits.maxToolDescriptionCharacters);
    expect(MAX_CATALOGUE_BYTES).toBe(limits.maxCatalogueBytes);
  });

  it('accepts exactly the maximum number of tools across modules', () => {
    const registry = createToolRegistry([
      { id: 'a', tools: tools(MAX_AGENT_TOOLS - 10) },
      { id: 'b', tools: Array.from({ length: 10 }, (_, index) => tool(`other_${index}`)) },
    ]);
    expect(registry.list()).toHaveLength(MAX_AGENT_TOOLS);
  });

  it('refuses one tool more than the maximum with a message that says how to fix it', () => {
    expect(() => createToolRegistry([{ id: 'a', tools: tools(MAX_AGENT_TOOLS + 1) }]))
      .toThrow(/129 tools.*at most 128.*operation parameter/su);
  });

  it('refuses an over-long description and an oversized catalogue', () => {
    expect(() => createToolRegistry([{
      id: 'a', tools: [tool('long', { description: 'x'.repeat(MAX_TOOL_DESCRIPTION_CHARACTERS + 1) })],
    }])).toThrow(/long description exceeds/u);
    const wide = Array.from({ length: 12 }, (_, index) => tool(`wide_${index}`, {
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string', description: 'x'.repeat(100_000) } },
      },
    }));
    expect(() => createToolRegistry([{ id: 'a', tools: wide }])).toThrow(/bytes; the agent accepts at most/u);
  });
});

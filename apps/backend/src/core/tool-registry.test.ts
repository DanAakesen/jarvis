import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createToolRegistry,
  MAX_CATALOGUE_BYTES,
  MAX_TOOL_DESCRIPTION_CHARACTERS,
  type JarvisTool,
} from './tool-registry.js';

const limits = JSON.parse(readFileSync(
  new URL('../../../../agents/jarvis/limits.json', import.meta.url), 'utf8',
)) as { maxToolDescriptionCharacters: number; maxCatalogueBytes: number };

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

describe('tool catalogue validation', () => {
  it('keeps description and byte limits identical to agents/jarvis/limits.json', () => {
    expect(MAX_TOOL_DESCRIPTION_CHARACTERS).toBe(limits.maxToolDescriptionCharacters);
    expect(MAX_CATALOGUE_BYTES).toBe(limits.maxCatalogueBytes);
  });

  it.each([121, 129])('accepts all %i tools, including the former reserve and count boundaries', (count) => {
    const definitions = tools(count);
    const registry = createToolRegistry([{ id: 'a', tools: definitions }]);
    expect(registry.list()).toHaveLength(count);
    expect(registry.list().map(({ name }) => name)).toEqual(definitions.map(({ name }) => name));
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

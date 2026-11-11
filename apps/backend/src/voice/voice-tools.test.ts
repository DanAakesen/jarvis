import { describe, expect, it, vi } from 'vitest';
import { capabilityIndex } from '../core/capability-index.js';
import { createToolRegistry, type JarvisTool } from '../core/tool-registry.js';
import { createRealtimeSessionUpdate, executeLazyVoiceToolCall, type RealtimeFunctionCall } from './realtime.js';

const tool = (name: string, description: string, execute = vi.fn(async () => ({}))): JarvisTool => ({
  name, description, inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute,
});
const call = (name: string, input: unknown): RealtimeFunctionCall => ({
  type: 'response.function_call_arguments.done', name, call_id: `call_${name}`, arguments: JSON.stringify(input),
});

describe('tool lookup', () => {
  it('advertises only find_tools and call_tool and refuses a tool until find_tools returned it', async () => {
    const heavy = vi.fn(async () => ({}));
    const registry = createToolRegistry([{
      id: 'test',
      tools: [
        tool('list_tasks', 'List tasks.'),
        tool('workspace_command', 'Control Jarvis windows and pages.', heavy),
      ],
    }]);
    const advertised = createRealtimeSessionUpdate(registry, undefined, undefined, [], undefined, undefined,
      undefined, 'full', undefined, 'lazy').session.tools as { name: string }[];
    expect(advertised.map(({ name }) => name)).toEqual(['find_tools', 'call_tool']);
    expect(Buffer.byteLength(JSON.stringify(advertised))).toBeLessThan(1_500);
    expect(capabilityIndex(registry).length).toBeLessThanOrEqual(1_500);
    expect(capabilityIndex(registry)).toContain('workspace_command');

    const discovered = new Set<string>();
    const request = {} as never;
    const signal = new AbortController().signal;
    const refused = JSON.parse(await executeLazyVoiceToolCall(
      call('call_tool', { name: 'workspace_command', arguments: {} }), registry, request, signal, discovered));
    expect(refused.outcome).toBe('refused');
    expect(heavy).not.toHaveBeenCalled();

    const found = JSON.parse(await executeLazyVoiceToolCall(
      call('find_tools', { query: 'workspace windows' }), registry, request, signal, discovered));
    expect(found.outcome).toBe('ok');
    expect(found.result.tools.map((entry: { name: string }) => entry.name)).toEqual(['workspace_command']);
    expect(discovered.has('workspace_command')).toBe(true);
  });
});

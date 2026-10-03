import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { RegisteredTool, ToolRegistry } from '../core/tool-registry.js';
import {
  createEnglishSessionUpdate,
  executeRealtimeToolCall,
  ENGLISH_REALTIME_INSTRUCTIONS,
  ENGLISH_REALTIME_VOICE,
  type RealtimeFunctionCall,
} from './realtime.js';

const tool: RegisteredTool = {
  name: 'echo',
  description: 'Echo a string.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  execute: vi.fn(async (input) => input),
  moduleId: 'test',
};

const registry: ToolRegistry = {
  list: () => [tool],
  get: (name) => name === tool.name ? tool : undefined,
};

const call = (overrides: Partial<RealtimeFunctionCall> = {}): RealtimeFunctionCall => ({
  type: 'response.function_call_arguments.done',
  name: 'echo',
  call_id: 'call_1',
  arguments: '{"text":"hello"}',
  ...overrides,
});

describe('English realtime session', () => {
  it('configures the server-owned model voice and registry schemas', () => {
    const session = createEnglishSessionUpdate(registry).session;

    expect(session.instructions).toBe(ENGLISH_REALTIME_INSTRUCTIONS);
    expect(session.audio.output).toMatchObject({
      voice: ENGLISH_REALTIME_VOICE,
      voice_type: 'azure-standard',
      voice_locale: 'en-GB',
    });
    expect(session.tools).toEqual([{
      type: 'function',
      name: 'echo',
      description: 'Echo a string.',
      parameters: tool.inputSchema,
    }]);
  });

  it('validates and executes a registered tool, returning its result', async () => {
    const request = { validateInput: vi.fn(() => true) } as unknown as FastifyRequest;
    const signal = new AbortController().signal;

    await expect(executeRealtimeToolCall(call(), registry, request, signal)).resolves.toBe(
      JSON.stringify({ outcome: 'ok', result: { text: 'hello' } }),
    );
    expect(request.validateInput).toHaveBeenCalledWith({ text: 'hello' }, tool.inputSchema, 'body');
    expect(tool.execute).toHaveBeenCalledWith({ text: 'hello' }, request, signal);
  });

  it.each([
    ['invalid JSON', call({ arguments: '{' }), true],
    ['invalid schema', call({ arguments: '{"text":"hello"}' }), false],
    ['unregistered tool', call({ name: 'missing' }), true],
  ])('does not execute a tool with %s', async (_label, functionCall, valid) => {
    const request = { validateInput: vi.fn(() => valid) } as unknown as FastifyRequest;
    const execute = vi.mocked(tool.execute);
    execute.mockClear();

    await expect(executeRealtimeToolCall(functionCall, registry, request, new AbortController().signal))
      .resolves.toBe(JSON.stringify({ outcome: 'error', result: { error: 'Tool execution failed' } }));
    expect(execute).not.toHaveBeenCalled();
  });
});

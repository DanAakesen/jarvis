import type { FastifyRequest } from 'fastify';

export interface JarvisTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Persist only outcome metadata for tools whose arguments or results contain private data. */
  readonly sensitive?: boolean;
  /** The core dispatcher supplies validated input, the request and a cancellation signal. */
  readonly execute: (input: unknown, request: FastifyRequest, signal: AbortSignal) => Promise<unknown>;
}

/**
 * Thrown by a tool that deliberately declines an action. The reason is shown to
 * Dan, so it must be safe to expose; any other thrown error is reported as a failure.
 */
export class ToolRefusal extends Error {
  constructor(reason: string) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed || trimmed.length > 500) throw new TypeError('Invalid tool refusal reason');
    super(trimmed);
    this.name = 'ToolRefusal';
  }
}

/** A sanitized failure detail that is safe to show the user without provider internals. */
export class ToolFailure extends Error {
  constructor(reason: string) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed || trimmed.length > 500) throw new TypeError('Invalid tool failure reason');
    super(trimmed);
    this.name = 'ToolFailure';
  }
}

export interface RegisteredTool extends JarvisTool {
  readonly moduleId: string;
}

/** Read-only after composition; this catalogue does not expose an HTTP dispatcher. */
export interface ToolRegistry {
  list(): readonly RegisteredTool[];
  get(name: string): RegisteredTool | undefined;
}

function freezeSchema(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeSchema(child);
    Object.freeze(value);
  }
}

export function createToolRegistry(modules: readonly { id: string; tools: readonly JarvisTool[] }[]): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();
  for (const module of modules) {
    for (const tool of module.tools) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || !tool.description.trim() || tools.has(tool.name)) {
        throw new Error('Invalid or duplicate Jarvis tool');
      }
      if (tool.inputSchema.type !== 'object' || typeof tool.execute !== 'function') {
        throw new Error('Invalid Jarvis tool contract');
      }
      const inputSchema = structuredClone(tool.inputSchema);
      freezeSchema(inputSchema);
      tools.set(tool.name, Object.freeze({ ...tool, inputSchema, moduleId: module.id }));
    }
  }
  const catalogue = Object.freeze([...tools.values()]);
  return Object.freeze({ list: () => catalogue, get: (name: string) => tools.get(name) });
}

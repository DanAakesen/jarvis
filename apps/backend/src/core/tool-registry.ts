import type { FastifyRequest } from 'fastify';
import { gmailAccessGuard } from './gmail-access-policy.js';

export interface JarvisTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Persist only outcome metadata for tools whose arguments or results contain private data. */
  readonly sensitive?: boolean;
  /** The reflex may execute this tool directly after a high-confidence, no-confirmation decision. */
  readonly reflexSafe?: boolean;
  /** Phone sessions may execute this tool without a P7-03 Teams approval. */
  readonly publicAllowedOnPhone?: boolean;
  /** Refuse phone calls before approval, even when the tool is otherwise public. */
  readonly denyOnPhone?: boolean;
  readonly bodyLimit?: number;
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

/**
 * The agent rejects the whole catalogue (and therefore every chat turn) when it exceeds these limits,
 * and the model API caps tools per request. agents/jarvis/limits.json is the single source; a test
 * fails if these constants drift from it.
 */
export const MAX_AGENT_TOOLS = 128;
export const MAX_TOOL_DESCRIPTION_CHARACTERS = 4_000;
export const MAX_CATALOGUE_BYTES = 1024 * 1024;

export function createToolRegistry(modules: readonly { id: string; tools: readonly JarvisTool[] }[]): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();
  const guardGmailAccess = gmailAccessGuard();
  for (const module of modules) {
    for (const tool of module.tools) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || !tool.description.trim() || tools.has(tool.name)) {
        throw new Error('Invalid or duplicate Jarvis tool');
      }
      if (tool.inputSchema.type !== 'object' || typeof tool.execute !== 'function') {
        throw new Error('Invalid Jarvis tool contract');
      }
      if (tool.description.length > MAX_TOOL_DESCRIPTION_CHARACTERS) {
        throw new Error(`Jarvis tool ${tool.name} description exceeds ${MAX_TOOL_DESCRIPTION_CHARACTERS} characters`);
      }
      const inputSchema = structuredClone(tool.inputSchema);
      freezeSchema(inputSchema);
      tools.set(tool.name, Object.freeze({ ...tool, execute: guardGmailAccess(tool), inputSchema, moduleId: module.id }));
    }
  }
  if (tools.size > MAX_AGENT_TOOLS) {
    throw new Error(
      `Jarvis tool catalogue has ${tools.size} tools; the agent and model accept at most ${MAX_AGENT_TOOLS}. ` +
      'Merge related tools into one tool with an operation parameter instead of adding more.',
    );
  }
  const catalogueBytes = Buffer.byteLength(JSON.stringify([...tools.values()].map(({ name, description, inputSchema }) => ({
    name, description, inputSchema,
  }))));
  if (catalogueBytes > MAX_CATALOGUE_BYTES) {
    throw new Error(`Jarvis tool catalogue is ${catalogueBytes} bytes; the agent accepts at most ${MAX_CATALOGUE_BYTES}.`);
  }
  const catalogue = Object.freeze([...tools.values()]);
  return Object.freeze({ list: () => catalogue, get: (name: string) => tools.get(name) });
}

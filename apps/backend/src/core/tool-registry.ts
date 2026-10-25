import type { FastifyInstance, FastifyRequest } from 'fastify';
import { gmailAccessGuard } from './gmail-access-policy.js';

export interface JarvisTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /** Non-authorizing execution semantics shared with chat and voice capability adapters. */
  readonly execution?: ToolExecutionMetadata;
  /** Persist only outcome metadata for tools whose arguments or results contain private data. */
  readonly sensitive?: boolean;
  /** The reflex may execute this tool directly after a high-confidence, no-confirmation decision. */
  readonly reflexSafe?: boolean;
  /** Phone sessions may execute this tool without a P7-03 Teams approval. */
  readonly publicAllowedOnPhone?: boolean;
  /** Refuse phone calls before approval, even when the tool is otherwise public. */
  readonly denyOnPhone?: boolean;
  readonly bodyLimit?: number;
  /**
   * Names the concrete problem when the arguments fail schema validation, so a refusal tells the model what to
   * fix. The text must be value-free (static wording, enumerations, counts and known property names only):
   * it reaches the model and the logs. Return undefined when nothing concrete can be said.
   */
  readonly explainInvalidInput?: (input: unknown, app: FastifyInstance) => string | undefined;
  /** Validates raw tool JSON before Fastify's AJV type coercion. */
  readonly validateInput?: (input: unknown) => boolean;
  /** The core dispatcher supplies validated input, the request and a cancellation signal. */
  readonly execute: (input: unknown, request: FastifyRequest, signal: AbortSignal) => Promise<unknown>;
}

export type ToolEffect = 'read' | 'action' | 'unclassified';

export interface ToolExecutionMetadata {
  readonly defaultEffect: ToolEffect;
  readonly operation?: {
    readonly field: string;
    readonly effects: Readonly<Record<string, Exclude<ToolEffect, 'unclassified'>>>;
  };
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

function validExecutionMetadata(value: unknown): value is ToolExecutionMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  if (Object.keys(metadata).some((key) => !['defaultEffect', 'operation'].includes(key))) return false;
  if (!['read', 'action', 'unclassified'].includes(String(metadata.defaultEffect))) return false;
  if (metadata.operation === undefined) return true;
  if (!metadata.operation || typeof metadata.operation !== 'object' || Array.isArray(metadata.operation)) {
    return false;
  }
  const operation = metadata.operation as Record<string, unknown>;
  if (Object.keys(operation).some((key) => !['field', 'effects'].includes(key))) return false;
  if (typeof operation.field !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(operation.field) ||
      !operation.effects || typeof operation.effects !== 'object' || Array.isArray(operation.effects)) return false;
  const effects = Object.entries(operation.effects);
  return effects.length > 0 && effects.every(([name, effect]) =>
    /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(name) && (effect === 'read' || effect === 'action'));
}

/** agents/jarvis/limits.json is the single source; a test fails if these limits drift from it. */
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
      if (tool.execution !== undefined && !validExecutionMetadata(tool.execution)) {
        throw new Error('Invalid Jarvis tool execution metadata');
      }
      if (tool.description.length > MAX_TOOL_DESCRIPTION_CHARACTERS) {
        throw new Error(`Jarvis tool ${tool.name} description exceeds ${MAX_TOOL_DESCRIPTION_CHARACTERS} characters`);
      }
      const inputSchema = structuredClone(tool.inputSchema);
      freezeSchema(inputSchema);
      const execution = tool.execution === undefined ? undefined : structuredClone(tool.execution);
      if (execution) freezeSchema(execution);
      tools.set(tool.name, Object.freeze({
        ...tool, execute: guardGmailAccess(tool), inputSchema, ...(execution ? { execution } : {}),
        moduleId: module.id,
      }));
    }
  }
  const catalogueBytes = Buffer.byteLength(JSON.stringify([...tools.values()].map(({ name, description, inputSchema, execution }) => ({
    name, description, inputSchema, ...(execution ? { execution } : {}),
  }))));
  if (catalogueBytes > MAX_CATALOGUE_BYTES) {
    throw new Error(`Jarvis tool catalogue is ${catalogueBytes} bytes; the agent accepts at most ${MAX_CATALOGUE_BYTES}.`);
  }
  const catalogue = Object.freeze([...tools.values()]);
  return Object.freeze({ list: () => catalogue, get: (name: string) => tools.get(name) });
}

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isBrainOnlyTool } from '../pi/brain/policy.js';
import { gmailAccessGuard } from './gmail-access-policy.js';

// Kept as HTTP compatibility endpoints for older clients, but no longer
// advertised to the assistant as part of normal owner-request execution.
const legacyConfirmationTools = new Set([
  'get_pending_issue', 'confirm_create_issue', 'confirm_project_archive',
  'calendar_get_pending_change', 'calendar_confirm_change', 'mail_confirm_action',
]);
const situationActivationTools = new Set(['situation_read', 'situation_lookup', 'situation_commit', 'situation_patch']);
export function isSituationActivationTool(name: string): boolean {
  return situationActivationTools.has(name);
}
export function isCurrentAssistantTool(name: string): boolean {
  // The brain's own tools exist for background wakes only; chat and voice never see them.
  return !legacyConfirmationTools.has(name) && !isBrainOnlyTool(name) && !isSituationActivationTool(name);
}

/** A background wake sees everything chat does, plus the brain's own tools. */
export function isWakeTool(name: string): boolean {
  return !legacyConfirmationTools.has(name);
}

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
  readonly completion?: ToolCompletionContract | undefined;
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
export type ToolCompletionOperation =
  | 'read' | 'create' | 'update' | 'delete' | 'send' | 'open' | 'start' | 'generic';
export type ToolCompletionDomain =
  | 'calendar' | 'mail' | 'weather' | 'notes' | 'tasks' | 'health' | 'memory' | 'github' | 'azure'
  | 'web' | 'factory' | 'pc' | 'workspace' | 'jobs' | 'settings' | 'generic';

export interface ToolCompletionContract {
  readonly domain: ToolCompletionDomain;
  readonly operation: ToolCompletionOperation |
    ((args: Record<string, unknown>) => ToolCompletionOperation);
  readonly acceptedRequestOperations?: readonly ToolCompletionOperation[] | undefined;
  readonly requestTargetFields: readonly string[];
  readonly resultTargetFields: readonly string[];
  readonly evaluate: (args: Record<string, unknown>, result: unknown) => boolean;
}

export interface CompiledToolExecutionContract extends ToolCompletionContract {
  readonly executionId: string;
}

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
  readonly completion?: CompiledToolExecutionContract | undefined;
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

function schemaPropertyNames(value: unknown, output = new Set<string>(), depth = 0): ReadonlySet<string> {
  if (depth > 8 || value === null || typeof value !== 'object' || Array.isArray(value)) return output;
  const record = value as Record<string, unknown>;
  const properties = record.properties;
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const name of Object.keys(properties)) output.add(name);
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else'] as const) {
    const branch = record[keyword];
    if (Array.isArray(branch)) for (const child of branch) schemaPropertyNames(child, output, depth + 1);
    else schemaPropertyNames(branch, output, depth + 1);
  }
  return output;
}

const completionActionWords = new Set([
  'add', 'archive', 'assign', 'cancel', 'capture', 'close', 'complete', 'correct', 'create', 'delete', 'dispatch',
  'edit', 'forget', 'generate', 'manage', 'merge', 'move', 'open', 'pause', 'pin', 'publish', 'remember', 'remove',
  'rename', 'renew', 'reply', 'restore', 'resume', 'retry', 'revoke', 'save', 'schedule', 'send', 'set', 'start',
  'steer', 'stop', 'update', 'write',
]);
const completionActionTools = new Set([
  'browser_do', 'browser_do_shared', 'pc_act', 'pc_browser_act', 'codex_prompt', 'workspace_command',
  'mail_confirm_action', 'calendar_confirm_change', 'inbox_nudge_style', 'inbox_capture_credential',
  'owner_reminders', 'proactive_item_feedback', 'watch_for', 'stop_watching_for',
  'health_food', 'health_food_review', 'health_saved_food', 'health_nutrition_targets',
  'health_coach_profile', 'health_meal_preference', 'health_recovery_period',
  'health_nutrition_history', 'health_coach_status', 'gym_lifts', 'gym_sessions',
]);
const completionDomains = new Set<ToolCompletionDomain>([
  'calendar', 'mail', 'weather', 'notes', 'tasks', 'health', 'memory', 'github', 'azure',
  'web', 'factory', 'pc', 'workspace', 'jobs', 'settings', 'generic',
]);
const completionOperations = new Set<ToolCompletionOperation>([
  'read', 'create', 'update', 'delete', 'send', 'open', 'start', 'generic',
]);

function actionContractRequired(tool: {
  readonly name: string;
  readonly execution?: ToolExecutionMetadata | undefined;
}): boolean {
  if (completionActionTools.has(tool.name) || tool.execution?.defaultEffect === 'action') return true;
  if (tool.execution?.operation &&
      Object.values(tool.execution.operation.effects).includes('action')) return true;
  return tool.name.split(/[_-]+/u).some(word => completionActionWords.has(word));
}

/** agents/jarvis/limits.json is the single source; a test fails if these limits drift from it. */
export const MAX_TOOL_DESCRIPTION_CHARACTERS = 4_000;
export const MAX_CATALOGUE_BYTES = 1024 * 1024;

export function createToolRegistry(modules: readonly { id: string; tools: readonly JarvisTool[] }[]): ToolRegistry {
  const tools = new Map<string, RegisteredTool>();
  const executionIds = new Set<string>();
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
      const completionSource = tool.completion;
      const actionRequired = actionContractRequired({ name: tool.name, execution });
      if (actionRequired && !completionSource) {
        throw new Error(`Action tool ${tool.name} is missing PI completion contract`);
      }
      if (completionSource) {
        const propertyNames = schemaPropertyNames(tool.inputSchema);
        const validFields = (fields: readonly string[]) => fields.every(field =>
          /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field)) && new Set(fields).size === fields.length;
        if (!completionDomains.has(completionSource.domain) ||
            typeof completionSource.operation !== 'string' && typeof completionSource.operation !== 'function' ||
            typeof completionSource.operation === 'string' && !completionOperations.has(completionSource.operation) ||
            actionRequired && typeof completionSource.operation === 'string' && completionSource.operation === 'read' ||
            !Array.isArray(completionSource.requestTargetFields) ||
            !Array.isArray(completionSource.resultTargetFields) ||
            !validFields(completionSource.requestTargetFields) ||
            !validFields(completionSource.resultTargetFields) ||
            typeof completionSource.evaluate !== 'function' ||
            completionSource.acceptedRequestOperations !== undefined &&
              (!Array.isArray(completionSource.acceptedRequestOperations) ||
                completionSource.acceptedRequestOperations.some(operation => !completionOperations.has(operation)))) {
          throw new Error(`Invalid PI completion contract for ${tool.name}`);
        }
        if (completionSource.requestTargetFields.some(field => !propertyNames.has(field))) {
          throw new Error(`PI completion request fields diverge from ${tool.name}`);
        }
        if (execution?.operation && !completionSource.requestTargetFields.includes(execution.operation.field)) {
          throw new Error(`PI completion operation field is missing from ${tool.name}`);
        }
        const staticOperation = typeof completionSource.operation === 'string'
          ? completionSource.operation
          : undefined;
        if (execution?.defaultEffect === 'read' && staticOperation !== undefined &&
            staticOperation !== 'read' ||
            execution?.defaultEffect === 'action' && staticOperation === 'read') {
          throw new Error(`PI completion contract diverges from tool execution for ${tool.name}`);
        }
        if (execution?.operation) {
          for (const [value, effect] of Object.entries(execution.operation.effects)) {
            const operation = typeof completionSource.operation === 'function'
              ? completionSource.operation({ [execution.operation.field]: value })
              : completionSource.operation;
            if (!completionOperations.has(operation) ||
                (effect === 'read' ? operation !== 'read' : operation === 'read')) {
              throw new Error(`PI completion contract diverges from tool execution for ${tool.name}`);
            }
          }
        }
      }
      const executionId = `${module.id}:${tool.name}`;
      if (executionIds.has(executionId)) throw new Error(`Duplicate PI completion execution ID ${executionId}`);
      executionIds.add(executionId);
      const completion = completionSource ? Object.freeze({
        ...completionSource,
        requestTargetFields: Object.freeze([...completionSource.requestTargetFields]),
        resultTargetFields: Object.freeze([...completionSource.resultTargetFields]),
        ...(completionSource.acceptedRequestOperations
          ? { acceptedRequestOperations: Object.freeze([...completionSource.acceptedRequestOperations]) }
          : {}),
        executionId,
      }) satisfies CompiledToolExecutionContract : undefined;
      tools.set(tool.name, Object.freeze({
        ...tool, execute: guardGmailAccess(tool), inputSchema, ...(execution ? { execution } : {}),
        moduleId: module.id, completion,
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

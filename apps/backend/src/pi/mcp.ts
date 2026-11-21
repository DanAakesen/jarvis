import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { piMcpPath, type PiAuth } from '../auth/pi-credential.js';
import {
  createToolRegistry, isCurrentAssistantTool, isSituationActivationTool, isWakeTool, toolSchemaFieldNames,
  type JarvisTool, type RegisteredTool, type ToolCompletionContract, type ToolCompletionOperation,
  type ToolRegistry,
} from '../core/tool-registry.js';
import {
  normalizeCompletionText, remoteTerminalReceipt, terminalFailure,
} from '../core/tool-completion.js';
import { azureToolPrefix, githubToolPrefix, type RemoteMcpBridge } from './remote-mcp.js';
import { searchJarvisTools, shortenToolDescription } from './tool-search.js';
import { piTurnPattern, type PiTurnRegistry } from './turns.js';
import type { PiSituationService } from './situation.js';
import type { SourceId } from '../proactive/types.js';
import { completionDispatchAllowed, completionEvidence, toolEffect } from './completion.js';
import { piConnectionInventory } from './capabilities.js';
import {
  azureActionSpecs, githubActionSpecs, type RemoteActionSpec,
} from './remote-action-contracts.js';

const maxFullResults = 3;
const maxOtherResults = 5;
const maxResultCharacters = 200_000;
const notFound = 'Unknown tool, or not looked up yet. Call find_tools first, then call_tool. Nothing was done.';
const unknownTurn = 'This turn is not active, so nothing was done. Use the exact turn reference from the current message.';

const turn = z.string().regex(piTurnPattern, 'The turn reference is the jt- value from the current message.');
const findSchema = z.object({ turn, query: z.string().min(2).max(100) }).strict();
const callSchema = z.object({
  turn,
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u),
  arguments: z.record(z.string(), z.unknown()),
}).strict();

function text(value: unknown, isError = false): CallToolResult {
  const body = JSON.stringify(value);
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text', text: body }] };
}

class AmbiguousRemoteTool extends Error {}

const remoteReadVerbs = new Set([
  'check', 'compare', 'diff', 'download', 'find', 'get', 'list', 'lookup', 'read', 'search', 'status', 'view',
]);
const remoteActionVerbs = new Map<string, ToolCompletionOperation>([
  ['add', 'create'], ['archive', 'delete'], ['approve', 'update'], ['assign', 'update'],
  ['cancel', 'delete'], ['close', 'delete'], ['comment', 'send'], ['create', 'create'],
  ['delete', 'delete'], ['dispatch', 'start'], ['dismiss', 'update'], ['edit', 'update'],
  ['fork', 'create'], ['label', 'update'], ['mark', 'update'], ['merge', 'update'],
  ['modify', 'update'], ['move', 'update'], ['open', 'open'], ['pin', 'update'],
  ['publish', 'send'], ['push', 'update'], ['ready', 'update'], ['remove', 'delete'], ['rename', 'update'],
  ['reopen', 'update'], ['reply', 'send'], ['rerun', 'start'], ['resolve', 'update'],
  ['restore', 'open'], ['resume', 'start'], ['retry', 'start'], ['revoke', 'delete'],
  ['run', 'start'], ['send', 'send'], ['set', 'update'], ['start', 'start'],
  ['stop', 'delete'], ['submit', 'send'], ['trigger', 'start'], ['unassign', 'update'],
  ['unpin', 'update'], ['update', 'update'], ['upload', 'create'],
]);
const selectorFields = ['method', 'operation', 'action'] as const;

function remoteOperationFromWords(words: readonly string[]): ToolCompletionOperation | undefined {
  if (words.includes('write') ||
      words.includes('create') && words.includes('update')) return undefined;
  const firstAction = words.find(word => remoteActionVerbs.has(word));
  if (firstAction) {
    if (firstAction === 'add' && words.some(word => word === 'comment' || word === 'reply')) return 'send';
    return remoteActionVerbs.get(firstAction);
  }
  return words.some(word => remoteReadVerbs.has(word)) ? 'read' : undefined;
}

function remoteSelector(
  schema: unknown,
  staticOperation?: ToolCompletionOperation,
): {
  readonly field: typeof selectorFields[number];
  readonly choices: ReadonlyMap<string, ToolCompletionOperation>;
} | undefined {
  let result: { field: typeof selectorFields[number]; values: Set<string> } | undefined;
  const visit = (value: unknown, depth = 0) => {
    if (depth > 8 || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const properties = record.properties;
    if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
      for (const field of selectorFields) {
        const definition = (properties as Record<string, unknown>)[field];
        if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
        const candidate = definition as Record<string, unknown>;
        const values = new Set<string>();
        if (typeof candidate.const === 'string') values.add(normalizeCompletionText(candidate.const));
        if (Array.isArray(candidate.enum)) {
          for (const entry of candidate.enum) {
            if (typeof entry === 'string') values.add(normalizeCompletionText(entry));
          }
        }
        if (result && result.field !== field) throw new AmbiguousRemoteTool('multiple operation selectors');
        const merged = result?.values ?? new Set<string>();
        for (const entry of values) merged.add(entry);
        result = { field, values: merged };
      }
    }
    for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
      const branches = record[keyword];
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, depth + 1);
    }
  };
  visit(schema);
  if (!result) return undefined;
  if (result.values.size === 0) throw new AmbiguousRemoteTool(`${result.field} has no closed choices`);
  const choices = new Map<string, ToolCompletionOperation>();
  for (const value of result.values) {
    const normalizedValue = normalizeCompletionText(value);
    const direct = normalizedValue === 'post' && staticOperation
      ? staticOperation
      : remoteOperationFromWords(normalizedValue.split(/[\s_-]+/u));
    if (!direct) throw new AmbiguousRemoteTool(`${result.field} value ${value} is ambiguous`);
    choices.set(value, direct);
  }
  return { field: result.field, choices };
}

function schemaSelectorValues(
  schema: unknown,
  field: typeof selectorFields[number],
  depth = 0,
): ReadonlySet<string> {
  if (depth > 8 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return new Set();
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  const output = new Set<string>();
  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    const definition = (properties as Record<string, unknown>)[field];
    if (definition && typeof definition === 'object' && !Array.isArray(definition)) {
      const candidate = definition as Record<string, unknown>;
      if (typeof candidate.const === 'string') output.add(normalizeCompletionText(candidate.const));
      if (Array.isArray(candidate.enum)) {
        for (const value of candidate.enum) {
          if (typeof value === 'string') output.add(normalizeCompletionText(value));
        }
      }
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = record[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      for (const value of schemaSelectorValues(branch, field, depth + 1)) output.add(value);
    }
  }
  return output;
}

function schemaRequiredFields(schema: unknown, depth = 0): ReadonlySet<string> {
  if (depth > 8 || !schema || typeof schema !== 'object' || Array.isArray(schema)) return new Set();
  const record = schema as Record<string, unknown>;
  const output = new Set<string>();
  if (Array.isArray(record.required)) {
    for (const field of record.required) {
      if (typeof field === 'string') output.add(field);
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const branches = record[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      for (const field of schemaRequiredFields(branch, depth + 1)) output.add(field);
    }
  }
  return output;
}

function actionSpecFor(bridge: RemoteMcpBridge, exactName: string): RemoteActionSpec | undefined {
  if (bridge.prefix === githubToolPrefix) return githubActionSpecs[exactName];
  if (bridge.prefix === azureToolPrefix) return azureActionSpecs[exactName];
  return undefined;
}

function validateActionSpecSchema(
  tool: RegisteredTool,
  actionSpec: RemoteActionSpec,
): void {
  const fields = toolSchemaFieldNames(tool.inputSchema);
  if (!actionSpec.identityFields.some(field => fields.has(field))) {
    throw new AmbiguousRemoteTool(`${tool.name} has no authoritative identity field in its schema`);
  }
  if (actionSpec.identityFields.includes('owner') &&
      actionSpec.identityFields.includes('repo') &&
      (!fields.has('owner') || !fields.has('repo'))) {
    throw new AmbiguousRemoteTool(`${tool.name} has an incomplete repository identity schema`);
  }
  if (!actionSpec.selector) return;
  if (!fields.has(actionSpec.selector.field)) {
    throw new AmbiguousRemoteTool(`${tool.name} is missing its exact ${actionSpec.selector.field} selector`);
  }
  const schemaValues = schemaSelectorValues(tool.inputSchema, actionSpec.selector.field);
  for (const value of schemaValues) {
    if (!actionSpec.selector.choices[value]) {
      throw new AmbiguousRemoteTool(`${tool.name} has an uncovered ${actionSpec.selector.field} value ${value}`);
    }
  }
  if (schemaValues.size > 0) {
    for (const value of Object.keys(actionSpec.selector.choices)) {
      if (!schemaValues.has(value)) {
        throw new AmbiguousRemoteTool(
          `${tool.name} is missing the exact ${actionSpec.selector.field} value ${value}`,
        );
      }
    }
  }
}

function remoteOperationFromSchema(
  bridge: RemoteMcpBridge,
  tool: RegisteredTool,
): {
  readonly operation: (args: Record<string, unknown>) => ToolCompletionOperation;
  readonly accepted?: readonly ToolCompletionOperation[];
  readonly identityFields?: readonly string[];
  readonly resultIdentityFields?: readonly string[];
  readonly identityMatches?: readonly (readonly string[])[];
  readonly identityFiles?: boolean;
  readonly requestPayloadFields?: readonly string[];
  readonly acceptsRequestOperation?: (
    args: Record<string, unknown>,
    operation: ToolCompletionOperation,
  ) => boolean;
  readonly requiredIdentityFields?: (
    args: Record<string, unknown>,
  ) => readonly string[];
  readonly receipt?: (args: Record<string, unknown>, result: unknown) => boolean;
} {
  const words = normalizeCompletionText(tool.name.slice(bridge.prefix.length)).split(/[_-]+/u).filter(Boolean);
  const exactName = normalizeCompletionText(tool.name.slice(bridge.prefix.length));
  const staticOperation = remoteOperationFromWords(words);
  const actionSpec = actionSpecFor(bridge, exactName);
  if (actionSpec) {
    validateActionSpecSchema(tool, actionSpec);
    const operationFor = (args: Record<string, unknown>) =>
      typeof actionSpec.operation === 'function'
        ? actionSpec.operation(args)
        : actionSpec.operation;
    const schemaRequiredIdentities = [...schemaRequiredFields(tool.inputSchema)]
      .filter(field => actionSpec.identityFields.includes(field));
    const requiredIdentityFields = actionSpec.requiredIdentityFields ??
      (() => schemaRequiredIdentities);
    return {
      operation: operationFor,
      ...(actionSpec.accepted ? { accepted: actionSpec.accepted } : {}),
      requestPayloadFields: [...toolSchemaFieldNames(tool.inputSchema)].filter(field => {
        if (actionSpec.identityFields.includes(field) || field === actionSpec.selector?.field) {
          return false;
        }
        return field === 'files' ? actionSpec.identityFiles === true : true;
      }),
      acceptsRequestOperation: (args, requestOperation) => {
        if (requestOperation === operationFor(args)) return true;
        return actionSpec.requestOperations?.(args).includes(requestOperation) ??
          actionSpec.accepted?.includes(requestOperation) ??
          false;
      },
      requiredIdentityFields,
      identityFields: actionSpec.identityFields,
      ...(actionSpec.resultIdentityFields ? { resultIdentityFields: actionSpec.resultIdentityFields } : {}),
      ...(actionSpec.identityMatches ? { identityMatches: actionSpec.identityMatches } : {}),
      ...(actionSpec.identityFiles ? { identityFiles: true } : {}),
      receipt: actionSpec.receipt,
    };
  }
  const selector = remoteSelector(tool.inputSchema, staticOperation);
  if (staticOperation !== 'read' && (!selector || [...selector.choices.values()].some(value => value !== 'read'))) {
    const provider = bridge.prefix === githubToolPrefix ? 'GitHub' :
      bridge.prefix === azureToolPrefix ? 'Azure' : bridge.label;
    throw new AmbiguousRemoteTool(`${tool.name} has no provider-exact ${provider} action contract`);
  }
  if (!selector) {
    if (staticOperation === 'read') return { operation: () => 'read' };
    throw new AmbiguousRemoteTool(`${tool.name} has no exact operation selector`);
  }
  return {
    operation: args => {
      const selected = normalizeCompletionText(String(args[selector.field] ?? ''));
      return selector.choices.get(selected) ?? 'generic';
    },
  };
}

const remoteIdentityFields = new Set([
  'id', 'item', 'itemId', 'item_id', 'issue', 'issueNumber', 'issue_number',
  'pullNumber', 'pull_number', 'number', 'commentId', 'comment_id', 'discussionNumber',
  'discussion_number', 'automation_id', 'group_id', 'taskId', 'task_id', 'jobId', 'job_id',
  'runId', 'run_id', 'release_id', 'tag_name', 'sha', 'path', 'branch', 'ref', 'head', 'base',
  'workflow', 'workflow_id', 'repository', 'repo', 'owner', 'resourceId', 'resource_id',
  'resourceGroup', 'resource-group', 'resourceName', 'resource-name', 'resource', 'name',
  'subscription', 'webtest-resource', 'workspace', 'container', 'containerapp',
  'url', 'label',
]);

function remoteIdentityKey(key: string): boolean {
  return remoteIdentityFields.has(key);
}

function canonicalRemoteIdentity(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'owner' || key === 'repo' || key === 'repository') return value.toLowerCase();
  if (['subscription', 'resource-group', 'resourceGroup', 'webtest-resource', 'resourceName'].includes(key)) {
    return value.toLowerCase();
  }
  if (key === 'branch' || key === 'ref' || key === 'head' || key === 'base') {
    return value.replace(/^refs\/heads\//u, '');
  }
  if (key === 'path') return value.replace(/^\.\/+/u, '');
  return value;
}

function canonicalRemoteRepository(identities: Record<string, unknown>): void {
  const owner = typeof identities.owner === 'string' ? identities.owner : undefined;
  const repo = typeof identities.repo === 'string' ? identities.repo : undefined;
  if (owner && repo) identities.repository = `${owner}/${repo}`.toLowerCase();
  if (typeof identities.repository === 'string') identities.repository = identities.repository.toLowerCase();
}

function canonicalAzureResourceIdentity(identities: Record<string, unknown>): void {
  if (typeof identities.id !== 'string') return;
  const match = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/[^/]+\/[^/]+\/([^/]+)(?:\/.*)?$/iu
    .exec(identities.id);
  if (!match) return;
  identities.subscription ??= match[1]!.toLowerCase();
  identities['resource-group'] ??= match[2]!.toLowerCase();
  identities.resourceName ??= match[3]!.toLowerCase();
}

function remoteRequestIdentities(
  operation: (args: Record<string, unknown>) => ToolCompletionOperation,
  args: Record<string, unknown>,
  identityFields?: readonly string[],
  identityFiles = false,
): Record<string, unknown> {
  if (operation(args) === 'read') {
    const readTargets: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (!remoteIdentityKey(key)) continue;
      readTargets[key] = canonicalRemoteIdentity(key, value);
    }
    canonicalRemoteRepository(readTargets);
    canonicalAzureResourceIdentity(readTargets);
    return readTargets;
  }
  const identities: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (identityFields ? identityFields.includes(key) : remoteIdentityKey(key)) {
      identities[key] = canonicalRemoteIdentity(key, value);
    }
  }
  if (identityFiles && Array.isArray(args.files)) {
    identities.paths = args.files.flatMap(file =>
      file && typeof file === 'object' && !Array.isArray(file) &&
      typeof (file as Record<string, unknown>).path === 'string'
        ? [canonicalRemoteIdentity('path', (file as Record<string, unknown>).path)]
        : []);
  }
  canonicalRemoteRepository(identities);
  return identities;
}

function collectRemoteResultIdentities(
  value: unknown,
  output: Record<string, unknown> = {},
  depth = 0,
  identityFields?: readonly string[],
  identityFiles = false,
): Record<string, unknown> {
  if (depth > 5) return output;
  if (Array.isArray(value)) {
    for (const child of value) {
      collectRemoteResultIdentities(child, output, depth + 1, identityFields, identityFiles);
    }
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (identityFiles && ['files', 'paths'].includes(key) && Array.isArray(child)) {
      const paths = child.flatMap(entry => {
        const path = typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).path
            : undefined;
        return typeof path === 'string' ? [canonicalRemoteIdentity('path', path)] : [];
      });
      if (paths.length > 0) output.paths = [...new Set([...(Array.isArray(output.paths) ? output.paths : []), ...paths])];
    }
    if ((identityFields ? identityFields.includes(key) : remoteIdentityKey(key)) &&
        !Object.hasOwn(output, key) &&
        (typeof child === 'string' || typeof child === 'number')) {
      output[key] = canonicalRemoteIdentity(key, child);
    }
    collectRemoteResultIdentities(child, output, depth + 1, identityFields, identityFiles);
  }
  canonicalRemoteRepository(output);
  return output;
}

function containsRemoteCollection(value: unknown, depth = 0): boolean {
  if (depth > 5 || !value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  return Object.values(value as Record<string, unknown>).some(child =>
    containsRemoteCollection(child, depth + 1));
}

function collectRemoteResultIdentityRows(
  value: unknown,
  identityFields?: readonly string[],
  identityFiles = false,
  depth = 0,
): Record<string, unknown>[] {
  if (depth > 5) return [];
  if (Array.isArray(value)) {
    return value.flatMap(child =>
      collectRemoteResultIdentityRows(child, identityFields, identityFiles, depth + 1));
  }
  if (!value || typeof value !== 'object') return [];
  const own: Record<string, unknown> = {};
  const nested: Record<string, unknown>[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (identityFiles && ['files', 'paths'].includes(key) && Array.isArray(child)) {
      const paths = child.flatMap(entry => {
        const path = typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).path
            : undefined;
        return typeof path === 'string' ? [canonicalRemoteIdentity('path', path)] : [];
      });
      if (paths.length > 0) own.paths = [...new Set(paths)];
    }
    if ((identityFields ? identityFields.includes(key) : remoteIdentityKey(key)) &&
        (typeof child === 'string' || typeof child === 'number')) {
      own[key] = canonicalRemoteIdentity(key, child);
    }
    if (child && typeof child === 'object') {
      nested.push(...collectRemoteResultIdentityRows(
        child, identityFields, identityFiles, depth + 1,
      ));
    }
  }
  canonicalRemoteRepository(own);
  canonicalAzureResourceIdentity(own);
  if (nested.length === 0) {
    return !containsRemoteCollection(value) && Object.keys(own).length > 0 ? [own] : [];
  }
  return nested.map(row => {
    const merged = { ...own, ...row };
    canonicalRemoteRepository(merged);
    canonicalAzureResourceIdentity(merged);
    return merged;
  });
}

function remoteIdentitiesConsistent(
  request: Record<string, unknown>,
  result: Record<string, unknown>,
  identityMatches: readonly (readonly string[])[] = [],
): boolean {
  for (const [key, requested] of Object.entries(request)) {
    const returned = result[key];
    if (returned === undefined) continue;
    if (Array.isArray(requested) && Array.isArray(returned)) {
      const wanted = new Set(requested.map(String));
      const found = new Set(returned.map(String));
      if (wanted.size !== found.size || [...wanted].some(value => !found.has(value))) return false;
      continue;
    }
    if (String(requested) !== String(returned)) return false;
  }
  return identityMatches.every(group => {
    const requested = group.map(key => request[key]).find(value => value !== undefined);
    const returned = group.map(key => result[key]).find(value => value !== undefined);
    return requested === undefined || returned === undefined || String(requested) === String(returned);
  });
}

function compileRemoteTools(
  bridge: RemoteMcpBridge,
  tools: readonly RegisteredTool[],
): { readonly tools: readonly RegisteredTool[]; readonly rejected: readonly string[] } {
  const domain = bridge.prefix === githubToolPrefix ? 'github' as const
    : bridge.prefix === azureToolPrefix ? 'azure' as const : 'generic' as const;
  const compiled: RegisteredTool[] = [];
  const rejected: string[] = [];
  for (const tool of tools) {
    try {
      const operationSpec = remoteOperationFromSchema(bridge, tool);
      const operation = operationSpec.operation;
      const completion: ToolCompletionContract = {
        domain,
        operation,
        ...(operationSpec.acceptsRequestOperation
          ? { acceptsRequestOperation: operationSpec.acceptsRequestOperation }
          : {}),
        ...(operationSpec.accepted ? { acceptedRequestOperations: operationSpec.accepted } : {}),
        requestTargetFields: [...toolSchemaFieldNames(tool.inputSchema)].filter(field =>
          remoteIdentityKey(field) || ['files', 'query', 'q', 'search', 'term'].includes(field)),
        ...(operationSpec.requestPayloadFields
          ? { requestPayloadFields: operationSpec.requestPayloadFields }
          : {}),
        resultTargetFields: [
          'id', 'number', 'issueNumber', 'issue_number', 'pullNumber', 'pull_number', 'repository',
          'repo', 'owner', 'resourceId', 'resource_id', 'resourceGroup', 'resourceName', 'url',
          'html_url', 'path', 'sha', 'commit', 'branch', 'ref', 'runId', 'jobId',
          'name',
        ],
        requestIdentities: args => {
          const required = operationSpec.requiredIdentityFields?.(args) ?? [];
          if (required.some(field => args[field] === undefined || args[field] === '')) return {};
          return remoteRequestIdentities(
            operation, args, operationSpec.identityFields, operationSpec.identityFiles,
          );
        },
        resultIdentities: result => collectRemoteResultIdentityRows(
          result,
          operationSpec.resultIdentityFields ?? operationSpec.identityFields,
          operationSpec.identityFiles,
        ),
        evaluate: (args, result) => {
          const required = operationSpec.requiredIdentityFields?.(args) ?? [];
          if (required.some(field => args[field] === undefined || args[field] === '')) return false;
          const requested = remoteRequestIdentities(
            operation, args, operationSpec.identityFields, operationSpec.identityFiles,
          );
          const returned = collectRemoteResultIdentities(
            result, {}, 0, operationSpec.resultIdentityFields ?? operationSpec.identityFields,
            operationSpec.identityFiles,
          );
          return remoteIdentitiesConsistent(
            requested, returned, operationSpec.identityMatches,
          ) &&
            !terminalFailure(result) &&
            (operationSpec.receipt
              ? operationSpec.receipt(args, result)
              : remoteTerminalReceipt(operation(args), args, result));
        },
      };
      const contracted: JarvisTool = { ...tool, completion };
      compiled.push(...createToolRegistry([{ id: `remote:${bridge.prefix}`, tools: [contracted] }]).list());
    } catch (error) {
      if (!(error instanceof AmbiguousRemoteTool)) throw error;
      rejected.push(tool.name);
    }
  }
  return { tools: compiled, rejected };
}

/** Chat never shows the capability-discovery operation selector; the voice and chat catalogues stay aligned. */
function shapeSchema(tool: RegisteredTool): unknown {
  if (tool.name !== 'get_system_health') return tool.inputSchema;
  const { properties, ...rest } = tool.inputSchema as { properties?: Record<string, unknown> };
  return { ...rest, properties: Object.fromEntries(Object.entries(properties ?? {}).filter(([name]) => name !== 'operation')) };
}

function providerPrefixNeeded(query: string, prefix: string): boolean {
  const value = query.normalize('NFKC').toLocaleLowerCase('en-US');
  if (value.includes(prefix)) return true;
  if (prefix === azureToolPrefix) {
    return /\b(?:azure|az|subscription|resource|resources|resource group|container app|ressource|ressourcer|ressourcegruppe|abonnement)\b/iu.test(value);
  }
  if (prefix === githubToolPrefix) {
    return /\b(?:github|git-hub|gh|repository|repo|issue|issues|pull request|pull requests|workflow|workflows|code search|kode|arbejdsgang|arbejdsflow)\b/iu.test(value);
  }
  return false;
}

const providerNeeded = (query: string, bridge: RemoteMcpBridge): boolean => providerPrefixNeeded(query, bridge.prefix);

/**
 * The Jarvis tools as an MCP server for the PI agent. It is a thin door, not a second tool system: find_tools ranks the
 * same catalogue chat and voice use, and call_tool runs the chosen tool through the normal `/tools/:name` route, so
 * argument validation, refusals, approvals, receipts and activity events are the ones every other caller gets.
 * Authority is the per-turn reference (see turns.ts): the owner message and session come from the server-side grant,
 * never from anything the model writes.
 */
export function createPiMcpRoutes(options: {
  readonly registry: PiTurnRegistry;
  readonly auth: PiAuth;
  readonly situation?: PiSituationService | undefined;
  readonly bridges?: readonly RemoteMcpBridge[] | undefined;
}): FastifyPluginAsync {
  const { registry, auth } = options;
  const bridges = options.bridges ?? [];

  /** The Deploy smoke may read one GitHub issue and list Azure resources, as the old smoke role did, and nothing else. */
  function smokeMayCall(name: string, args: Record<string, unknown>): boolean {
    if (name.startsWith(githubToolPrefix)) return name === `${githubToolPrefix}issue_read` && args.issue_number === 700 && args.method === 'get';
    return name.startsWith(azureToolPrefix) && /^[a-z_]*list[a-z_]*$/u.test(name.slice(azureToolPrefix.length));
  }

  function automaticSources(name: string, args: Record<string, unknown>): readonly SourceId[] {
    if (name.startsWith('calendar_')) return ['calendar'];
    if (name.startsWith('mail_')) return ['mail'];
    if (name === 'weather') return ['weather'];
    if (name.startsWith('memory_')) return ['memory'];
    if (name.startsWith('health_nutrition_') || name.startsWith('health_food') ||
        name.startsWith('health_meal') || name === 'health_saved_food') return ['nutrition'];
    if (name === 'health_query' || name === 'health_show') {
      const requested = typeof args.source === 'string' ? args.source : '';
      return requested.includes('nutrition') ? ['nutrition'] : ['health'];
    }
    if (name.startsWith('health_')) return ['health'];
    if (name.startsWith('vault_task_')) return ['todos'];
    if (name === 'vault_search' || name === 'vault_read') return ['notes'];
    const factoryTools = [
      'get_work_status', 'list_projects', 'update_project', 'archive_project', 'list_tasks', 'get_task',
      'list_releases', 'get_release', 'get_deployment_status', 'create_task', 'set_task_model',
      'retry_task', 'steer_task',
    ];
    if (factoryTools.includes(name) || name.startsWith(githubToolPrefix)) return ['factory'];
    return [];
  }

  const sourceAllowed = (name: string, args: Record<string, unknown>, disabled: ReadonlySet<string>): boolean => {
    const sources = automaticSources(name, args);
    return sources.length === 0 || sources.some((source) => !disabled.has(source));
  };
  const turnSignalFor = (
    grant: NonNullable<ReturnType<PiTurnRegistry['resolve']>>,
    requestSignal: AbortSignal,
    serverSignal: AbortSignal,
  ) => AbortSignal.any([grant.signal, requestSignal, serverSignal]);
  const disabledFor = async (signal: AbortSignal): Promise<ReadonlySet<string>> => {
    const service = options.situation;
    if (!service) return new Set();
    const current = typeof service.policy === 'function'
      ? await service.policy(signal)
      : await service.read(signal);
    return new Set(current.disabledSources);
  };

  async function callRemote(bridge: RemoteMcpBridge, tool: RegisteredTool, args: Record<string, unknown>, grant: NonNullable<ReturnType<PiTurnRegistry['resolve']>>, signal: AbortSignal): Promise<CallToolResult> {
    const name = tool.name;
    if (grant.smoke === true && !smokeMayCall(name, args)) {
      grant.results.push({ tool: name, outcome: 'refused' });
      return text({ tool: name, outcome: 'refused', result: { refused: 'The smoke may only read one GitHub issue and list Azure resources. Nothing was done.' } });
    }
    if (!completionDispatchAllowed(grant.completion, tool, args, grant.bindings, grant.brain !== undefined)) {
      grant.results.push({ tool: name, outcome: 'refused' });
      return text({
        tool: name, outcome: 'refused',
        result: { refused: 'This action does not match the exact requested operation and trusted target. Nothing was sent.' },
      });
    }
    const done = await bridge.call(name, args, signal);
    grant.results.push({ tool: name, outcome: done.outcome });
    if (done.outcome === 'ok') {
      if (toolEffect(tool, args) === 'action') grant.actions.count += 1;
      const binding = completionEvidence(tool, args, done.result);
      const evidence = completionEvidence(grant.completion, tool, args, done.result, grant.bindings);
      if (evidence) grant.evidence.push(evidence);
      else if (grant.brain && binding && binding.kind !== 'retrieved') grant.evidence.push(binding);
      else if (!((grant.completion.contextual || grant.completion.requiresTrustedContext) &&
          binding?.kind === 'retrieved')) grant.unverified.count += 1;
      if (binding?.kind === 'retrieved') grant.bindings.push(binding);
    }
    const body = JSON.stringify(done.result);
    const result = body.length > maxResultCharacters
      ? { truncated: true, preview: body.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' } : done.result;
    return text({ tool: name, outcome: done.outcome, result }, done.outcome === 'error');
  }

  function buildServer(app: FastifyInstance, signal: AbortSignal): McpServer {
    const server = new McpServer({ name: 'jarvis', version: '1.0.0' });
    server.registerTool('find_tools', {
      title: 'Find Jarvis tools',
      description: 'Jarvis tools are not listed. Look one up by a few English or Danish keywords naming what the thing is (azure resource, github issue, calendar, note, kalender, opgave, noter) to get its description and argument schema, then use call_tool. Exact tool names are ranked first. The compact otherMatches entries can also be called by exact name in this turn. Local matches return without waiting for an unrelated remote catalogue. A provider-specific result that is still starting includes continuation: call find_tools again in this turn with that exact query. Dan’s PC tools (pc_, browser_do) are there for when he asks me to use his PC. Pass the turn reference from the current message.',
      inputSchema: findSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: 'find_tools', outcome: 'refused', result: { refused: unknownTurn } }, true);
      let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
      if (grant.brain && options.situation) {
        try { disabled = await disabledFor(
          turnSignalFor(grant, ctx.mcpReq.signal, signal),
        ); }
        catch {
          return text({ tool: 'find_tools', outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
        }
      }
      // Only a provider named by the request is loaded. It gets the bridge's bounded wait while unrelated/local-only searches
      // never wait on it; a catalogue that is still cold returns an explicit same-turn continuation.
      const turnSignal = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      const selectedBridges = bridges.filter(bridge => providerNeeded(input.query, bridge));
      const catalogues = await Promise.all(selectedBridges.map(async (bridge) => {
        const tools = await bridge.tools(turnSignal);
        return { bridge, tools, status: bridge.status() };
      }));
      const azure = catalogues.find(({ bridge }) => bridge.prefix === azureToolPrefix);
      if (azure) {
        grant.azure.catalogue = azure.status.state === 'ready' && azure.tools.length === 0 ? 'empty' : azure.status.state;
      } else if (!bridges.some(({ prefix }) => prefix === azureToolPrefix) &&
          providerPrefixNeeded(input.query, azureToolPrefix)) {
        grant.azure.catalogue = 'not_configured';
      }
      const compiledRemote = catalogues.map(({ bridge, tools }) => ({
        bridge,
        ...compileRemoteTools(bridge, tools),
      }));
      const remoteTools = compiledRemote.flatMap(({ tools }) => tools);
      const rejectedRemoteTools = compiledRemote.flatMap(({ rejected }) => rejected);
      for (const tool of remoteTools) grant.remoteTools.set(tool.name, tool);
      const catalogue: ToolRegistry = remoteTools.length === 0 ? app.jarvisTools : {
        list: () => [...app.jarvisTools.list(), ...remoteTools],
        get: (name) => app.jarvisTools.get(name) ?? remoteTools.find((tool) => tool.name === name),
      };
      const visible = (name: string) => {
        const local = grant.brain
          ? isWakeTool(name)
          : isCurrentAssistantTool(name) || isSituationActivationTool(name);
        return local && (!grant.brain || sourceAllowed(name, {}, disabled));
      };
      const matches = searchJarvisTools(catalogue, input.query, visible);
      // A server that is still loading, or could not be loaded, has no tools in the catalogue. Say which, so the model never
      // reports a server it simply has not heard from yet as "not attached".
      const notes = (noMatch: boolean) => {
        const lines = [
          ...(noMatch ? ['No matching tool. Say so plainly.'] : []),
          ...(rejectedRemoteTools.length > 0
            ? [`Provider tools with no unambiguous operation selector were not offered: ${rejectedRemoteTools.join(', ')}.`]
            : []),
          ...catalogues.flatMap(({ bridge, status }) => {
            if (status.state === 'starting') return [`${bridge.label} tools are still loading (the server wakes from sleep and can take a minute or two). Search again shortly; ${bridge.label} is attached, just not loaded yet.`];
            if (status.state === 'stale') return [`${bridge.label} is using its last loaded tool list because the refresh failed (${status.reason}). Do not present it as freshly verified; retry if the needed tool is missing.`];
            if (status.state === 'unreachable') return [`${bridge.label} could not be reached (${status.reason}). Say so plainly; do not claim to have looked.`];
            return [];
          }),
        ];
        return lines.length > 0 ? { note: lines.join(' ') } : {};
      };
      const full = matches.slice(0, maxFullResults);
      const other = matches.slice(maxFullResults, maxFullResults + maxOtherResults);
      for (const tool of [...full, ...other]) grant.discovered.add(tool.name);
      const loadingProviders = catalogues.filter(({ status }) => status.state === 'starting');
      return text({
        tool: 'find_tools', outcome: 'ok', result: {
          connections: piConnectionInventory(bridges),
          tools: full.map(tool => ({ name: tool.name, description: tool.description, parameters: shapeSchema(tool) })),
          otherMatches: matches.slice(maxFullResults, maxFullResults + maxOtherResults)
            .map(tool => ({ name: tool.name, description: shortenToolDescription(tool.description) })),
          ...(rejectedRemoteTools.length > 0 ? {
            providerContractErrors: rejectedRemoteTools.map(name => ({
              tool: name,
              error: 'No authoritative provider operation and identity contract is available. The tool was withheld.',
            })),
          } : {}),
          ...(loadingProviders.length > 0 ? {
            continuation: {
              action: 'find_tools',
              query: input.query,
              providers: loadingProviders.map(({ bridge }) => bridge.label),
              instruction: 'This exact provider catalogue is still loading. Continue this same turn with find_tools using this query instead of answering without the requested capability.',
            },
          } : {}),
          ...notes(matches.length === 0),
        },
      });
    });
    server.registerTool('call_tool', {
      title: 'Run a Jarvis tool',
      description: 'Run a tool that find_tools returned in tools or otherMatches, with its exact name and arguments that follow its schema. The server rechecks visibility, source policy and the turn. Pass the turn reference from the current message. Report what the result says, never more.',
      inputSchema: callSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    }, async (input, ctx) => {
      const grant = registry.resolve(input.turn);
      if (!grant) return text({ tool: input.name, outcome: 'refused', result: { refused: unknownTurn } }, true);
      if (grant.brain) {
        let disabled: ReadonlySet<string> = new Set<string>(grant.activation?.disabledSources ?? []);
        if (options.situation) {
          try { disabled = await disabledFor(
            turnSignalFor(grant, ctx.mcpReq.signal, signal),
          ); }
          catch {
            return text({ tool: input.name, outcome: 'error', result: { error: 'The automatic source policy could not be verified. Nothing was read.' } }, true);
          }
        }
        if (!sourceAllowed(input.name, input.arguments, disabled)) {
          grant.results.push({ tool: input.name, outcome: 'refused' });
          return text({
            tool: input.name, outcome: 'refused',
            result: { refused: 'That source is disabled in Proactive settings. Nothing was read.' },
          });
        }
      }
      const azureRequested = input.name.startsWith(azureToolPrefix);
      if (azureRequested) grant.azure.attempts += 1;
      const bridge = bridges.find((candidate) => input.name.startsWith(candidate.prefix));
      const visibleRemote = grant.brain ? isWakeTool(input.name) : isCurrentAssistantTool(input.name) || isSituationActivationTool(input.name);
      const remoteTool = grant.remoteTools.get(input.name);
      if (bridge && visibleRemote && remoteTool && grant.discovered.has(input.name)) {
        return callRemote(bridge, remoteTool, input.arguments, grant, AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]));
      }
      const tool = app.jarvisTools.get(input.name);
      const visible = tool && (grant.brain
        ? isWakeTool(tool.name)
        : isCurrentAssistantTool(tool.name) || isSituationActivationTool(tool.name));
      if (!tool || !visible || !grant.discovered.has(tool.name)) {
        if (azureRequested) grant.azure.undiscoveredRefusals += 1;
        return text({ tool: input.name, outcome: 'refused', result: { refused: notFound } });
      }
      if (!completionDispatchAllowed(
        grant.completion, tool, input.arguments, grant.bindings, grant.brain !== undefined,
      )) {
        grant.results.push({ tool: tool.name, outcome: 'refused' });
        return text({
          tool: tool.name, outcome: 'refused',
          result: { refused: 'This action does not match the exact requested operation and trusted target. Nothing was changed.' },
        });
      }
      const abort = AbortSignal.any([signal, grant.signal, ctx.mcpReq.signal]);
      try {
        const response = await app.inject({
          method: 'POST',
          url: `/tools/${tool.name}`,
          headers: {
            authorization: `Bearer ${auth.dispatch.token}`,
            'content-type': 'application/json',
            // The stored owner message of this turn, from the grant. A brain wake has no owner message: it carries its run id.
            ...(grant.smoke === true ? { 'x-jarvis-smoke': 'true' }
              : grant.brain ? { 'x-jarvis-pi': 'wake', 'x-jarvis-brain': grant.brain.runId }
                : { 'x-jarvis-pi': 'turn', 'x-jarvis-message-id': grant.messageId }),
            ...(grant.activation ? { 'x-jarvis-activation': grant.activation.id } : {}),
          },
          payload: JSON.stringify(input.arguments),
          signal: abort,
        });
        if (response.statusCode !== 200) {
          grant.results.push({ tool: tool.name, outcome: 'error' });
          return text({ tool: tool.name, outcome: 'error', result: { error: 'The tool could not run. Nothing is confirmed as done.' } }, true);
        }
        const serialized = response.body;
        const parsed = JSON.parse(serialized) as { outcome?: unknown; result?: unknown };
        const outcome = parsed.outcome === 'ok' || parsed.outcome === 'refused' ? parsed.outcome : 'error';
        grant.results.push({ tool: tool.name, outcome });
        if (outcome === 'ok') {
          const binding = completionEvidence(tool, input.arguments, parsed.result);
          const evidence = completionEvidence(grant.completion, tool, input.arguments, parsed.result, grant.bindings);
          if (evidence) grant.evidence.push(evidence);
          else if (grant.brain && binding && binding.kind !== 'retrieved') grant.evidence.push(binding);
          else if (!((grant.completion.contextual || grant.completion.requiresTrustedContext) &&
              binding?.kind === 'retrieved')) grant.unverified.count += 1;
          if (binding?.kind === 'retrieved') grant.bindings.push(binding);
          if (toolEffect(tool, input.arguments) === 'action') grant.actions.count += 1;
        }
        if (serialized.length > maxResultCharacters) {
          return text({
            tool: tool.name, outcome, truncated: true,
            result: { preview: serialized.slice(0, maxResultCharacters), note: 'The result was too long; this is its start.' },
          });
        }
        return { ...(parsed.outcome === 'error' ? { isError: true } : {}), content: [{ type: 'text', text: serialized }] };
      } catch {
        grant.results.push({ tool: tool.name, outcome: 'error' });
        return text({ tool: tool.name, outcome: 'error', result: { error: 'The tool could not run. Nothing is confirmed as done.' } }, true);
      }
    });
    return server;
  }

  return async (app) => {
    app.route({
      method: ['POST', 'GET', 'DELETE'], url: piMcpPath,
      bodyLimit: 256 * 1024,
      onRequest: async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        // Only the managed agent's credential reaches this route; a browser or another service never does.
        if (!request.piMcpAccess) return reply.code(403).send({ error: 'Forbidden' });
        if (request.headers.origin !== undefined || Object.keys(request.query as Record<string, unknown>).length > 0) {
          return reply.code(400).send({ error: 'Invalid PI connector request' });
        }
      },
      handler: async (request, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const disconnect = () => { if (!reply.raw.writableEnded) abort(); };
        request.raw.once('aborted', abort);
        reply.raw.once('close', disconnect);
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000)]);
        const handler = createMcpHandler(() => buildServer(app, signal));
        try {
          reply.hijack();
          const incoming = Object.assign(request.raw, { method: request.method, url: request.url });
          await toNodeHandler(handler)(incoming, reply.raw, request.body);
        } finally {
          request.raw.off('aborted', abort);
          reply.raw.off('close', disconnect);
        }
      },
    });
  };
}

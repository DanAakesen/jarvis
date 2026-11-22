import { isDeepStrictEqual } from 'node:util';
import { PI_PREVIEW_HEADER } from '../pi/definition.js';
import { normalizeFoundryProjectEndpoint } from '../voice/live-protocol.js';
import { isPiCall } from './pi-authority.js';
import { FOUNDRY_AGENT_SCOPE } from './chat-agent.js';
import { readFoundryObject } from './managed-target-reader.js';
import { ToolFailure, ToolRefusal, type JarvisTool } from './tool-registry.js';

type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields => value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {};
const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const idField = { type: 'string', pattern: id.source };
const operations = ['list', 'list_versions', 'read', 'create_version', 'activate'] as const;
type Operation = typeof operations[number];
interface AgentInput {
  operation: Operation;
  agent?: string;
  version?: string;
  expectedServingVersion?: string;
  expectedLatestVersion?: string;
  instructions?: string;
  model?: string;
  after?: string;
  limit?: number;
  offset?: number;
}
const operationFields: Record<Operation, readonly (keyof AgentInput)[]> = {
  list: ['after', 'limit'], list_versions: ['agent', 'after', 'limit'], read: ['agent', 'version', 'offset'],
  create_version: ['agent', 'expectedServingVersion', 'expectedLatestVersion', 'instructions', 'model'],
  activate: ['agent', 'expectedServingVersion', 'version'],
};

function versionId(raw: unknown): string | null {
  const value = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
  return typeof value === 'string' && id.test(value) ? value : null;
}

function selection(agent: Fields) {
  const latest = fields(agent.versions).latest;
  const latestVersion = versionId(fields(latest).version ?? latest);
  const rules = fields(fields(agent.agent_endpoint).version_selector).version_selection_rules;
  if (rules == null || (Array.isArray(rules) && !rules.length)) return { latestVersion, servingVersion: latestVersion, pinned: false };
  const rule = Array.isArray(rules) && rules.length === 1 ? fields(rules[0]) : {};
  const fullTraffic = rule.type === 'FixedRatio' && rule.traffic_percentage === 100;
  const pinned = fullTraffic ? versionId(rule.agent_version) : null;
  const followsLatest = fullTraffic && rule.agent_version === '@latest';
  return { latestVersion, servingVersion: followsLatest ? latestVersion : pinned, pinned: pinned !== null };
}

function readyForPin(version: Fields): boolean {
  // The v1 agent.version object has no lifecycle field. Preview versions can also report creating or failed.
  return version.draft !== true && (version.status === 'active' || (version.status === undefined && version.object === 'agent.version'));
}

function protectedBlock(instructions: unknown): string | null {
  if (typeof instructions !== 'string') return null;
  const start = 'KEEP THIS BLOCK: backend tool contract (start)';
  const end = 'KEEP THIS BLOCK: backend tool contract (end)';
  const i = instructions.indexOf(start), j = instructions.indexOf(end);
  if (i === -1 && j === -1) return null;
  if (i < 0 || j < i || instructions.lastIndexOf(start) !== i || instructions.lastIndexOf(end) !== j) {
    throw new ToolRefusal('The protected backend tool contract has incomplete or repeated markers.');
  }
  return instructions.slice(i, j + end.length);
}

export function createFoundryAgentAdmin(options: {
  projectEndpoint: string;
  managedAgents?: readonly string[];
  getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  fetch?: typeof fetch;
}) {
  const endpoint = normalizeFoundryProjectEndpoint(options.projectEndpoint);
  const fetcher = options.fetch ?? fetch;
  const busy = new Set<string>();
  return async (input: AgentInput, callerSignal: AbortSignal) => {
    const { operation, agent, version, after, expectedServingVersion, expectedLatestVersion } = input;
    const allowed = operationFields[operation];
    if (!allowed || Object.keys(input).some(k => k !== 'operation' && !allowed.includes(k as keyof AgentInput))) {
      throw new ToolRefusal('Arguments must match the selected Foundry operation.');
    }
    if (operation !== 'list' && (!agent || !id.test(agent))) throw new ToolRefusal('Supply a valid Foundry agent name.');
    const write = operation === 'create_version' || operation === 'activate';
    if (write && !expectedServingVersion) throw new ToolRefusal('Read the agent and supply its expectedServingVersion.');
    if (operation === 'activate' && !version) throw new ToolRefusal('Supply the version to activate.');
    if (operation === 'create_version' && (!expectedLatestVersion || (input.instructions === undefined && !input.model))) {
      throw new ToolRefusal('Creating a version needs the latest version and new instructions or a deployed model name.');
    }
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(30_000)]);
    const token = await options.getToken(FOUNDRY_AGENT_SCOPE, signal);
    if (!token || /[\r\n]/u.test(token)) throw new ToolFailure('Foundry identity is unavailable.');
    const base = agent ? '/agents/' + encodeURIComponent(agent) : '/agents';
    const versions = base + '/versions';
    const ownership = agent && options.managedAgents?.includes(agent)
      ? { modelContract: 'The release definition also owns this agent model. Update the repository model contract for a lasting model change.' }
      : {};
    const readVersion = async (key: string) => {
      const entry = await request(versions + '/' + encodeURIComponent(key));
      if (entry.name !== agent || versionId(entry.version) !== key || !Object.keys(fields(entry.definition)).length) {
        throw new ToolFailure('Foundry version readback did not match the requested agent and version.');
      }
      return entry;
    };
    async function request(path: string, method = 'GET', body?: Fields, query?: URLSearchParams) {
      const url = new URL(endpoint + path);
      url.search = (query ?? new URLSearchParams()).toString();
      url.searchParams.set('api-version', 'v1');
      const response = await fetcher(url, {
        method, signal, redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + token, Accept: 'application/json',
          'Foundry-Features': PI_PREVIEW_HEADER + ',AgentEndpoints=V1Preview',
          ...(body ? { 'Content-Type': method === 'PATCH' ? 'application/merge-patch+json' : 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ToolFailure('Foundry returned HTTP ' + response.status + '. Read the current state before retrying a write.');
      }
      return readFoundryObject(response, signal);
    }
    async function pin(key: string) {
      await request(base, 'PATCH', { agent_endpoint: { version_selector: {
        version_selection_rules: [{ type: 'FixedRatio', agent_version: key, traffic_percentage: 100 }],
      } } });
      const state = selection(await request(base));
      if (!state.pinned || state.servingVersion !== key) throw new ToolFailure('Foundry did not verify the requested version pin.');
      return state;
    }
    if (operation === 'list' || operation === 'list_versions') {
      const query = new URLSearchParams({ limit: String(input.limit ?? 10) });
      if (after) query.set('after', after);
      const page = await request(operation === 'list' ? base : versions, 'GET', undefined, query);
      if (!Array.isArray(page.data)) throw new ToolFailure('Foundry returned an invalid list.');
      if (page.has_more === true && (typeof page.last_id !== 'string' || !page.last_id)) throw new ToolFailure('Foundry omitted the cursor for the next page.');
      const entries = page.data.map((value: unknown) => {
        const item = fields(value);
        return operation === 'list' ? { name: item.name, ...selection(item) } :
          { name: item.name, version: item.version, status: item.status, kind: fields(item.definition).kind };
      });
      return { entries, hasMore: page.has_more === true, nextCursor: page.has_more === true ? page.last_id : null };
    }
    if (write && busy.has(agent!)) throw new ToolRefusal('A version change for this agent is already running. Read it back shortly.');
    if (write) busy.add(agent!);
    try {
      const state = selection(await request(base));
      if (operation === 'read') {
        const key = version ?? state.servingVersion;
        if (!key) throw new ToolRefusal('This agent has multiple or unknown serving versions. Supply a specific version.');
        const item = await readVersion(key);
        const definition = fields(item.definition);
        const text = typeof definition.instructions === 'string' ? definition.instructions : '';
        const offset = input.offset ?? 0, end = offset + 8000;
        return { agent, version: key, ...state, ...ownership, status: item.status, kind: definition.kind, model: definition.model,
          instructions: text.slice(offset, end), nextOffset: end < text.length ? end : null };
      }
      if (operation === 'activate' && state.pinned && state.servingVersion === version) {
        const selected = await readVersion(version!);
        if (!readyForPin(selected)) throw new ToolRefusal('The pinned version is not active in Foundry.');
        return { agent, ...state, ...ownership, status: selected.status };
      }
      if (!state.servingVersion || state.servingVersion !== expectedServingVersion) {
        throw new ToolRefusal('Serving version changed or uses split traffic. Read the agent again.');
      }
      const source = await readVersion(state.servingVersion);
      const definition = fields(source.definition);
      if (operation === 'activate') {
        const target = await readVersion(version!);
        if (!readyForPin(target)) throw new ToolRefusal('The target version is not active in Foundry yet.');
        if (protectedBlock(fields(target.definition).instructions) !== protectedBlock(definition.instructions)) {
          throw new ToolRefusal('Activating this version would change the protected backend tool contract.');
        }
        if (!isDeepStrictEqual(selection(await request(base)), state)) throw new ToolRefusal('Agent routing changed. Read it again.');
        return { agent, ...await pin(version!), ...ownership, status: target.status };
      }
      if (!['prompt', 'voice'].includes(String(definition.kind))) throw new ToolRefusal('Instructions and models can be edited on prompt and voice agent definitions.');
      const next = { ...definition, ...(input.instructions !== undefined ? { instructions: input.instructions } : {}), ...(input.model ? { model: input.model } : {}) };
      if (protectedBlock(next.instructions) !== protectedBlock(definition.instructions)) throw new ToolRefusal('Preserve the protected backend tool contract exactly.');
      if (!state.latestVersion) throw new ToolRefusal('Foundry did not identify the latest version. Read the versions before editing.');
      if (state.latestVersion !== expectedLatestVersion) {
        // A response can be lost after the version was created. Return it only if the complete requested definition matches.
        const latest = await readVersion(state.latestVersion);
        if (isDeepStrictEqual(latest.definition, next)) return { agent, version: state.latestVersion, status: latest.status, ...state, ...ownership };
        throw new ToolRefusal('Latest version changed. Read it before creating another.');
      }
      if (isDeepStrictEqual(next, definition)) return { agent, version: state.servingVersion, status: source.status, ...state, ...ownership };
      if (!isDeepStrictEqual(selection(await request(base)), state)) throw new ToolRefusal('Agent routing changed. Read it again.');
      // A project following latest would start using a new version on POST. Keep the current version serving until activation.
      if (!state.pinned) await pin(state.servingVersion);
      const created = await request(versions, 'POST', {
        definition: next, ...(source.metadata ? { metadata: source.metadata } : {}),
        ...(typeof source.description === 'string' ? { description: source.description } : {}),
      });
      const createdId = versionId(created.version);
      if (!createdId) throw new ToolFailure('Foundry accepted the write without a readable version. List versions before retrying.');
      const item = await readVersion(createdId);
      const final = selection(await request(base));
      if (!isDeepStrictEqual(item.definition, next) || final.servingVersion !== state.servingVersion || !final.pinned) {
        throw new ToolFailure('Version ' + createdId + ' was created. Its definition or serving pin could not be verified.');
      }
      return { agent, version: createdId, status: item.status, ...final, ...ownership };
    } finally { if (write) busy.delete(agent!); }
  };
}
export type FoundryAgentAdmin = ReturnType<typeof createFoundryAgentAdmin>;

export const manageFoundryAgentTool: JarvisTool = {
  name: 'manage_foundry_agent',
  description: 'Show Foundry agents, list versions, read instructions or model, create a version with edited instructions or a deployed model, or activate a version when Dan asks. Read the serving and latest versions before editing.',
  sensitive: true, denyOnPhone: true,
  inputSchema: { type: 'object', additionalProperties: false, required: ['operation'], properties: {
    operation: { type: 'string', enum: operations }, agent: idField, version: idField,
    expectedServingVersion: idField, expectedLatestVersion: idField,
    instructions: { type: 'string', maxLength: 131072, description: 'Complete replacement text, including any protected backend tool contract unchanged.' },
    model: idField, limit: { type: 'integer', minimum: 1, maximum: 20 }, after: { type: 'string', minLength: 1, maxLength: 512 },
    offset: { type: 'integer', minimum: 0, maximum: 1000000, description: 'Continue reading instructions from nextOffset.' },
  } },
  execute(input, request, signal) {
    const owner = request.principal?.objectId.toLowerCase() === request.server.ownerObjectId.toLowerCase();
    if (!owner && !isPiCall(request)) throw new ToolRefusal('Foundry administration requires the project owner.');
    const admin = request.server.foundryAgentAdmin;
    if (!admin) throw new ToolRefusal('Foundry agent administration is unavailable.');
    return admin(input as AgentInput, signal);
  },
};

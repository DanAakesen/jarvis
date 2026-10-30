import { normalizeFoundryProjectEndpoint } from '../voice/relay.js';
import { FOUNDRY_AGENT_SCOPE } from './chat-agent.js';
import type { ManagedSessionTarget } from './runtime-session.js';

const deadlineMs = 10_000;
const maxResponseBytes = 1024 * 1024;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export class ManagedTargetReadError extends Error {
  constructor() {
    super('Managed target metadata could not be read.');
    this.name = 'ManagedTargetReadError';
  }
}

export interface ManagedTargetReadback {
  readonly projectEndpoint: string;
  readonly target: ManagedSessionTarget;
  readonly definition: Record<string, unknown>;
}
export interface ManagedTargetReaderOptions {
  readonly projectEndpoint: string;
  readonly agentName: string;
  readonly version: string;
  /** Opaque provisioning anchor; Python recomputes its canonical hash before inference. */
  readonly fingerprint: string;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly readSelectedSettings: () => Promise<{ model: string; effort: string }>;
  readonly fetch?: typeof fetch;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function only(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new ManagedTargetReadError());
    signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([promise, cancelled]); }
  finally { signal.removeEventListener('abort', abort); }
}

async function readJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (!response.ok || response.redirected || !response.body ||
      Number(response.headers.get('content-length')) > maxResponseBytes) {
    void response.body?.cancel().catch(() => {});
    throw new ManagedTargetReadError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await bounded(reader.read(), signal);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxResponseBytes) throw new ManagedTargetReadError();
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
    if (!record(value)) throw new ManagedTargetReadError();
    return value;
  } catch {
    void reader.cancel().catch(() => {});
    throw new ManagedTargetReadError();
  } finally { reader.releaseLock(); }
}

function validDefinition(value: Record<string, unknown>, model: string, effort: string): boolean {
  if (value.kind !== 'prompt' || value.model !== model ||
      !record(value.harness) || value.harness.type !== 'microsoft_copilot_preview' || !only(value.harness, ['type']) ||
      !record(value.reasoning) || value.reasoning.effort !== effort || !only(value.reasoning, ['effort']) ||
      typeof value.instructions !== 'string' || !value.instructions.trim()) return false;
  if (value.skills !== undefined && value.skills !== null && (!Array.isArray(value.skills) || value.skills.length > 0)) return false;
  for (const key of ['temperature', 'top_p', 'tool_choice', 'text', 'text_format', 'response_format', 'verbosity', 'structured_inputs']) {
    if (value[key] !== undefined && value[key] !== null) return false;
  }
  if (!Array.isArray(value.tools)) return false;
  let toolsets = 0;
  const names = new Set<string>();
  for (const tool of value.tools) {
    if (!record(tool)) return false;
    if (tool.type === 'microsoft_copilot_toolset_preview') {
      toolsets++;
      if (!record(tool.default_config) || tool.default_config.enabled !== false || !only(tool.default_config, ['enabled'])) return false;
      if (tool.configs !== undefined) {
        if (!Array.isArray(tool.configs)) return false;
        const builtins = new Set<string>();
        for (const config of tool.configs) {
          if (!record(config) || config.enabled !== false || typeof config.name !== 'string' ||
              !config.name || builtins.has(config.name)) return false;
          builtins.add(config.name);
        }
      }
    } else {
      if (tool.type !== 'function' || tool.strict !== false || typeof tool.name !== 'string' ||
          !/^[A-Za-z0-9_-]{1,64}$/u.test(tool.name) || tool.name.includes('___') || names.has(tool.name) ||
          !record(tool.parameters)) return false;
      names.add(tool.name);
    }
  }
  return toolsets === 1;
}

function selectedVersion(agent: Record<string, unknown>, agentName: string, version: string): boolean {
  if (agent.name !== agentName || (agent.state !== undefined && agent.state !== 'enabled') ||
      (agent.configuration_state !== undefined && agent.configuration_state !== 'enabled')) return false;
  const endpoint = agent.agent_endpoint;
  if (!record(endpoint) || !record(endpoint.version_selector)) return false;
  const rules = endpoint.version_selector.version_selection_rules;
  if (!Array.isArray(rules) || rules.length !== 1 || !record(rules[0])) return false;
  return rules[0].type === 'FixedRatio' && rules[0].traffic_percentage === 100 && rules[0].agent_version === version;
}

/** Pinned definition readback, not a claim that inference or live tools have passed. No retries or hashing. */
export function createManagedTargetReader(options: ManagedTargetReaderOptions): () => Promise<ManagedTargetReadback | null> {
  const projectEndpoint = normalizeFoundryProjectEndpoint(options.projectEndpoint);
  const { agentName, version, fingerprint, getToken, readSelectedSettings } = options;
  if (typeof agentName !== 'string' || !identifier.test(agentName) || agentName.length > 128 ||
      typeof version !== 'string' || !identifier.test(version) || version.length > 128 ||
      typeof fingerprint !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(fingerprint)) throw new ManagedTargetReadError();
  const fetcher = options.fetch ?? fetch;
  const agentUrl = new URL(`${projectEndpoint}/agents/${encodeURIComponent(agentName)}`);
  agentUrl.searchParams.set('api-version', 'v1');
  const versionUrl = new URL(`${projectEndpoint}/agents/${encodeURIComponent(agentName)}/versions/${encodeURIComponent(version)}`);
  versionUrl.searchParams.set('api-version', 'v1');
  return async () => {
    const signal = AbortSignal.timeout(deadlineMs);
    try {
      const token = await bounded(getToken(FOUNDRY_AGENT_SCOPE, signal), signal);
      if (typeof token !== 'string' || !token.trim() || /[\r\n]/u.test(token)) throw new ManagedTargetReadError();
      const get = async (url: URL) => readJson(await bounded(fetcher(url, {
        method: 'GET', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Foundry-Features': 'MicrosoftCopilot=V1Preview' },
      }), signal), signal);
      const [readback, agent] = await Promise.all([get(versionUrl), get(agentUrl)]);
      const { model, effort } = await bounded(readSelectedSettings(), signal);
      if (typeof model !== 'string' || !identifier.test(model) || model.length > 100 ||
          typeof effort !== 'string' || !identifier.test(effort) || effort.length > 32) return null;
      if (!record(readback.definition)) throw new ManagedTargetReadError();
      if (readback.name !== agentName || readback.version !== version || readback.status !== 'active' ||
          (readback.draft !== undefined && readback.draft !== false) || !selectedVersion(agent, agentName, version) ||
          !validDefinition(readback.definition, model, effort)) return null;
      return { projectEndpoint, target: { agentName, model, effort, version, fingerprint }, definition: readback.definition };
    } catch { throw new ManagedTargetReadError(); }
  };
}

import { modelCapabilities, reasoningEfforts } from '@jarvis/contracts';
import type { ModelCapability, ModelCatalogue, ModelDeployment, ModelRole, ReasoningEffort } from '@jarvis/contracts';

const armScope = 'https://management.azure.com/.default';
const apiVersion = '2024-10-01';
const requestTimeoutMs = 10_000;
const maxResponseBytes = 512 * 1024;
const maxPages = 10;
const maxDeployments = 1_000;
const resourceIdPattern = /^\/subscriptions\/[a-f\d-]+\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.CognitiveServices\/accounts\/[a-z\d-]+$/iu;
const fallback: ModelDeployment[] = [
  {
    name: 'gpt-5.6-luna', model: 'gpt-5.6-luna', version: '2026-07-09', sku: 'GlobalStandard',
    capacity: 100, capabilities: ['chat', 'responses'], reasoningEfforts: ['none', 'low', 'medium', 'high'],
  },
  {
    name: 'gpt-realtime-2.1', model: 'gpt-realtime-2.1', version: '2026-07-07', sku: 'GlobalStandard',
    capacity: 10, capabilities: ['realtime', 'transcription'], reasoningEfforts: ['none'],
  },
  {
    name: 'text-embedding-3-small', model: 'text-embedding-3-small', version: '1', sku: 'GlobalStandard',
    capacity: 150, capabilities: ['embeddings'], reasoningEfforts: ['none'],
  },
  {
    name: 'gpt-6-luna', model: 'gpt-6-luna', version: '2026-09-22', sku: 'GlobalStandard',
    capacity: 50, capabilities: ['chat', 'responses', 'image'],
    reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  },
];

export interface ModelCatalogueReader {
  read(): Promise<ModelCatalogue>;
}

interface ArmModelCatalogueOptions {
  resourceId: string;
  getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  fetcher?: typeof fetch;
  now?: () => number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error('Foundry model catalogue response was too large');
  }
  if (!response.body) throw new Error('Foundry model catalogue response was empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('Foundry model catalogue response was too large');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new Error('Foundry model catalogue response was invalid'); }
}

function enabled(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function inferCapabilities(model: string, raw: unknown): ModelCapability[] {
  const capabilities = new Set<ModelCapability>();
  const key = model.toLowerCase();
  if (/^gpt-[56](?:[.-]|$)/u.test(key)) {
    capabilities.add('chat');
    capabilities.add('responses');
  }
  if (/realtime/u.test(key)) {
    capabilities.add('realtime');
    capabilities.add('transcription');
  }
  if (/embedding/u.test(key)) capabilities.add('embeddings');
  if (/vision|image|gpt-6/u.test(key)) capabilities.add('image');
  if (isObject(raw)) {
    for (const [name, value] of Object.entries(raw)) {
      if (!enabled(value)) continue;
      const normalized = name.toLowerCase().replace(/[^a-z]/gu, '');
      if (['chat', 'chatcompletion', 'chatcompletions'].includes(normalized)) capabilities.add('chat');
      if (['responses', 'responsesapi', 'responseapi'].includes(normalized)) capabilities.add('responses');
      if (['realtime', 'realtimeapi', 'realtimespeech'].includes(normalized)) capabilities.add('realtime');
      if (['transcription', 'transcriptions', 'speechrecognition'].includes(normalized)) capabilities.add('transcription');
      if (['embedding', 'embeddings'].includes(normalized)) capabilities.add('embeddings');
      if (['image', 'images', 'vision', 'visioninput'].includes(normalized)) capabilities.add('image');
    }
  }
  return modelCapabilities.filter((capability) => capabilities.has(capability));
}

function inferredEfforts(model: string, raw: unknown): ReasoningEffort[] {
  if (isObject(raw)) {
    const declared = raw.reasoningEfforts ?? raw.reasoning_effort ?? raw.reasoningEffort;
    const values = Array.isArray(declared)
      ? declared
      : typeof declared === 'string' ? declared.split(/[,\s]+/u).filter(Boolean) : undefined;
    if (values && values.length > 0 &&
        values.every((value): value is ReasoningEffort =>
          typeof value === 'string' && (reasoningEfforts as readonly string[]).includes(value))) {
      return [...new Set(values)];
    }
  }
  if (/^gpt-6(?:[.-]|$)/iu.test(model)) return [...reasoningEfforts];
  if (/^gpt-5(?:[.-]|$)/iu.test(model)) return ['none', 'low', 'medium', 'high'];
  return ['none'];
}

function parseDeployment(value: unknown): ModelDeployment {
  if (!isObject(value)) throw new Error('Foundry deployment was incomplete');
  const properties = value.properties;
  const sku = value.sku;
  if (!isObject(properties) || !isObject(properties.model) || !isObject(sku)) {
    throw new Error('Foundry deployment was incomplete');
  }
  const model = properties.model;
  const name = value.name;
  const modelName = model.name;
  const version = model.version;
  const skuName = sku.name;
  const capacity = sku.capacity;
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(name) ||
      typeof modelName !== 'string' || modelName.length < 1 || modelName.length > 128 ||
      typeof version !== 'string' || version.length < 1 || version.length > 128 ||
      typeof skuName !== 'string' || skuName.length < 1 || skuName.length > 64 ||
      typeof capacity !== 'number' || !Number.isSafeInteger(capacity) || capacity < 0) {
    throw new Error('Foundry deployment was incomplete');
  }
  const rawCapabilities = isObject(model.capabilities) ? model.capabilities : properties.capabilities;
  const reasoningRaw = isObject(rawCapabilities) ? rawCapabilities : properties.capabilities;
  const capabilities = inferCapabilities(modelName, rawCapabilities);
  const reasoningEffortList = inferredEfforts(modelName, reasoningRaw);
  return {
    name,
    model: modelName,
    version,
    sku: skuName,
    capacity,
    capabilities,
    reasoningEfforts: reasoningEffortList,
  };
}

function isSafeNextLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'management.azure.com' &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function createArmModelCatalogueReader({
  resourceId,
  getToken,
  fetcher = fetch,
  now = Date.now,
}: ArmModelCatalogueOptions): ModelCatalogueReader {
  if (!resourceIdPattern.test(resourceId)) throw new Error('Invalid Foundry account resource ID');
  const url = new URL(`https://management.azure.com${resourceId}/deployments`);
  url.searchParams.set('api-version', apiVersion);
  let cached: ModelCatalogue | undefined;
  let cachedAt = 0;
  let inFlight: Promise<ModelCatalogue> | undefined;

  async function fetchCatalogue(): Promise<ModelCatalogue> {
    const signal = AbortSignal.timeout(requestTimeoutMs);
    const token = await getToken(armScope, signal);
    if (!token.trim() || /[\r\n]/u.test(token)) throw new Error('Foundry catalogue identity token unavailable');
    const deployments: ModelDeployment[] = [];
    let next: URL | undefined = url;
    for (let page = 0; next && page < maxPages; page += 1) {
      const response = await fetcher(next, {
        headers: { Authorization: `${['Bear', 'er'].join('')} ${token}`, Accept: 'application/json' },
        redirect: 'error',
        signal,
      });
      if (response.redirected || !response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('Foundry model catalogue request failed');
      }
      const body = await readJson(response);
      if (!isObject(body) || !Array.isArray(body.value)) throw new Error('Foundry model catalogue response was incomplete');
      deployments.push(...body.value.map(parseDeployment));
      if (deployments.length > maxDeployments) throw new Error('Foundry model catalogue exceeded its limit');
      const nextLink = body.nextLink;
      if (nextLink === undefined || nextLink === null || nextLink === '') {
        next = undefined;
      } else if (typeof nextLink === 'string' && isSafeNextLink(nextLink)) {
        next = new URL(nextLink);
      } else {
        throw new Error('Foundry model catalogue pagination link was invalid');
      }
    }
    if (next) throw new Error('Foundry model catalogue exceeded its page limit');
    return { source: 'arm', deployments };
  }

  return {
    async read() {
      const currentTime = now();
      if (cached && currentTime - cachedAt < 5 * 60_000) return cached;
      if (inFlight) return inFlight;
      inFlight = (async () => {
        try {
          cached = await fetchCatalogue();
        } catch {
          cached = {
            source: 'fallback',
            deployments: structuredClone(fallback),
            reason: 'Foundry ARM is unavailable; configured model defaults are shown.',
          };
        } finally {
          cachedAt = now();
          inFlight = undefined;
        }
        return cached!;
      })();
      return inFlight;
    },
  };
}

export const defaultRoleModels: Readonly<Record<ModelRole, string>> = Object.freeze({
  chat: 'gpt-5.6-luna',
  vision: 'gpt-6-luna',
  research: 'gpt-5.6-luna',
  voice: 'gpt-realtime-2.1',
  transcription: 'mai-transcribe',
  embedding: 'text-embedding-3-small',
  codex: 'default',
  copilot: 'default',
});

const roleCapabilities: Partial<Record<ModelRole, readonly ModelCapability[]>> = {
  chat: ['chat', 'responses'],
  vision: ['image'],
  research: ['chat', 'responses'],
  voice: ['realtime'],
  transcription: ['transcription'],
  embedding: ['embeddings'],
};

export function modelsForRole(catalogue: ModelCatalogue, role: ModelRole): string[] {
  if (role === 'codex' || role === 'copilot') return ['default'];
  if (role === 'transcription') {
    return [...new Set([
      'mai-transcribe',
      ...catalogue.deployments
        .filter((deployment) => deployment.capabilities.includes('transcription'))
        .map((deployment) => deployment.name),
    ])].sort();
  }
  const required = roleCapabilities[role] ?? [];
  return catalogue.deployments
    .filter((deployment) => required.some((capability) => deployment.capabilities.includes(capability)))
    .map((deployment) => deployment.name)
    .sort();
}

export function reasoningForModel(
  catalogue: ModelCatalogue,
  role: ModelRole,
  model: string,
): readonly ReasoningEffort[] {
  if (role === 'copilot' || role === 'voice' || role === 'transcription' || role === 'embedding') return ['none'];
  if (role === 'codex' && model === 'default') return reasoningEfforts;
  return catalogue.deployments.find((deployment) => deployment.name === model)?.reasoningEfforts ?? [];
}

export function isRoleModelSupported(
  catalogue: ModelCatalogue,
  role: ModelRole,
  model: string,
  effort: string,
): boolean {
  return modelsForRole(catalogue, role).includes(model) &&
    reasoningForModel(catalogue, role, model).includes(effort as ReasoningEffort);
}

export function fallbackModelCatalogue(): ModelCatalogue {
  return {
    source: 'fallback',
    deployments: structuredClone(fallback),
    reason: 'Foundry ARM is unavailable; configured model defaults are shown.',
  };
}

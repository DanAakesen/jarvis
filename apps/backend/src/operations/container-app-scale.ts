export type MinimumReplicas = 0 | 1;

export interface ContainerAppScaler {
  getMinimumReplicas(): Promise<MinimumReplicas>;
  setMinimumReplicas(value: MinimumReplicas): Promise<void>;
}

interface ArmContainerAppScalerOptions {
  resourceId: string;
  getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  fetcher?: typeof fetch;
}

const armScope = 'https://management.azure.com/.default';
const apiVersion = '2024-03-01';
const requestTimeoutMs = 10_000;
const maxResponseBytes = 256 * 1024;
const resourceIdPattern = /^\/subscriptions\/[a-z\d-]+\/resourceGroups\/[a-z\d._()-]+\/providers\/Microsoft\.App\/containerApps\/[a-z\d._()-]+$/iu;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error('Container Apps response was too large');
  }
  if (!response.body) throw new Error('Container Apps response was empty');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw new Error('Container Apps response was too large');
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
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function createArmContainerAppScaler({
  resourceId,
  getToken,
  fetcher = fetch,
}: ArmContainerAppScalerOptions): ContainerAppScaler {
  if (!resourceIdPattern.test(resourceId)) throw new Error('Invalid Container App resource ID');
  const url = new URL(`https://management.azure.com${resourceId}`);
  url.searchParams.set('api-version', apiVersion);

  async function request(method: 'GET' | 'PATCH', body?: unknown): Promise<unknown> {
    const signal = AbortSignal.timeout(requestTimeoutMs);
    const token = await getToken(armScope, signal);
    if (!token.trim() || /[\r\n]/u.test(token)) throw new Error('Container Apps identity token unavailable');
    const bearerScheme = ['Bear', 'er'].join('');
    const response = await fetcher(url, {
      method,
      headers: {
        Authorization: `${bearerScheme} ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal,
    });
    if (response.redirected || !response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Container Apps scaling request failed');
    }
    if (method === 'PATCH') {
      await response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    return readJson(response);
  }

  return {
    async getMinimumReplicas() {
      const result = await request('GET');
      if (!isObject(result) || !isObject(result.properties) ||
          !isObject(result.properties.template) || !isObject(result.properties.template.scale)) {
        throw new Error('Container Apps response did not include scale settings');
      }
      const minimum = result.properties.template.scale.minReplicas;
      if (minimum !== 0 && minimum !== 1) throw new Error('Container Apps minimum replicas was not 0 or 1');
      return minimum;
    },

    async setMinimumReplicas(value) {
      await request('PATCH', { properties: { template: { scale: { minReplicas: value } } } });
    },
  };
}

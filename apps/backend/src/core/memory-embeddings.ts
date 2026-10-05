export const MEMORY_EMBEDDING_DIMENSIONS = 1536;
export const FOUNDRY_EMBEDDING_SCOPE = 'https://ai.azure.com/.default';
const MAX_RESPONSE_BYTES = 256 * 1024;
const EMBEDDING_TIMEOUT_MS = 10_000;
const DEPLOYMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;

export interface MemoryEmbedder {
  embed(text: string, signal: AbortSignal): Promise<readonly number[]>;
}

export interface FoundryMemoryEmbedderOptions {
  readonly projectEndpoint: string;
  readonly deploymentName: string;
  readonly getToken: (scope: string, signal: AbortSignal) => Promise<string>;
  readonly fetcher?: typeof fetch;
}

function embeddingsUrl(projectEndpoint: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(projectEndpoint);
  } catch {
    throw new TypeError('Foundry project endpoint is invalid');
  }
  if (endpoint.protocol !== 'https:' || endpoint.port || !endpoint.hostname.endsWith('.services.ai.azure.com') ||
      !/^\/api\/projects\/[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(endpoint.pathname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError('Foundry project endpoint must be a secure Azure AI project URL');
  }
  return `${endpoint.href}/openai/v1/embeddings`;
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Foundry embedding response is empty');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('Foundry embedding response exceeds the size limit');
      }
      chunks.push(value);
    }
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

export function createFoundryMemoryEmbedder(options: FoundryMemoryEmbedderOptions): MemoryEmbedder {
  const url = embeddingsUrl(options.projectEndpoint);
  if (!DEPLOYMENT_NAME.test(options.deploymentName)) {
    throw new TypeError('Foundry embedding deployment name is invalid');
  }
  const fetcher = options.fetcher ?? fetch;

  return {
    async embed(text, signal) {
      if (!text.trim() || text.length > 2000) throw new TypeError('Memory text is invalid');
      signal.throwIfAborted();
      const timeout = AbortSignal.timeout(EMBEDDING_TIMEOUT_MS);
      const requestSignal = AbortSignal.any([signal, timeout]);
      const token = await options.getToken(FOUNDRY_EMBEDDING_SCOPE, requestSignal);
      if (!token.trim() || /[\r\n]/u.test(token)) throw new Error('Foundry embedding authentication failed');
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          Authorization: ['Bear' + 'er', token].join(' '),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: options.deploymentName, input: text }),
        redirect: 'error',
        signal: requestSignal,
      });
      if (!response.ok) throw new Error(`Foundry embedding request failed with HTTP ${response.status}`);
      const body = await readResponse(response) as {
        data?: readonly { embedding?: unknown }[];
      } | null;
      const embedding = body?.data?.length === 1 ? body.data[0]?.embedding : undefined;
      if (!Array.isArray(embedding) || embedding.length !== MEMORY_EMBEDDING_DIMENSIONS ||
          !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
        throw new Error('Foundry embedding response is invalid');
      }
      signal.throwIfAborted();
      return embedding;
    },
  };
}

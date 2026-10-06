const graphRoot = 'https://graph.microsoft.com/v1.0/';
const maxResponseBytes = 512 * 1024;
const authorizationScheme = 'Bearer';

export interface GraphClient {
  get(path: string, signal: AbortSignal): Promise<unknown>;
  post(path: string, body: unknown, signal: AbortSignal): Promise<unknown>;
}

interface GraphClientOptions {
  readonly getToken: (signal: AbortSignal) => Promise<string>;
  readonly fetcher?: (input: URL, init: RequestInit) => Promise<Response>;
}

async function readJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error('Microsoft Graph response exceeded the size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Microsoft Graph response was empty');

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) {
        await reader.cancel();
        throw new Error('Microsoft Graph response exceeded the size limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
  } catch {
    throw new Error('Microsoft Graph returned an invalid response');
  }
}

export function createGraphClient({ getToken, fetcher = fetch }: GraphClientOptions): GraphClient {
  async function request(method: 'GET' | 'POST', path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    let token: string;
    try {
      token = await getToken(signal);
    } catch {
      throw Object.assign(new Error('Microsoft Graph credentials are unavailable'), { kind: 'auth' });
    }
    if (!token) throw Object.assign(new Error('Microsoft Graph credentials are unavailable'), { kind: 'auth' });

    const url = new URL(path, graphRoot);
    if (url.origin !== 'https://graph.microsoft.com' || !url.pathname.startsWith('/v1.0/')) {
      throw new Error('Invalid Microsoft Graph request path');
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: {
          authorization: `${authorizationScheme} ${token}`,
          accept: 'application/json',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
        signal,
        redirect: 'error',
      });
    } catch {
      const kind = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'timeout' : 'aborted') : 'transport';
      throw Object.assign(new Error('Microsoft Graph request failed'), { kind });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Microsoft Graph request failed'), { kind: 'http', statusCode: response.status });
    }
    return readJson(response);
  }

  return {
    get: (path, signal) => request('GET', path, undefined, signal),
    post: (path, body, signal) => request('POST', path, body, signal),
  };
}

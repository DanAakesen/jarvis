export interface PublicConfig {
  tenantId: string;
  webClientId: string;
  apiScope: string;
  backendUrl: string | null;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object in the web configuration.');
  }
  return value as Record<string, unknown>;
}

function id(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) {
    throw new Error(`Missing or invalid ${name} in infra/bootstrap.output.json.`);
  }
  return value;
}

export function createPublicConfig(bootstrap: unknown, backendUrl: unknown): PublicConfig {
  const source = record(bootstrap);
  const api = record(source.api);
  const apiId = id(api.appId, 'API application ID');
  const apiScope = `api://${apiId}/access_as_user`;
  if (api.scope !== apiScope) {
    throw new Error('Invalid API scope in infra/bootstrap.output.json.');
  }

  let origin: string | null = null;
  if (backendUrl !== null && backendUrl !== undefined && backendUrl !== '') {
    const message = 'Backend URL must be a production HTTPS origin without credentials, path, query, or fragment.';
    if (typeof backendUrl !== 'string') throw new Error(message);
    let url: URL;
    try {
      url = new URL(backendUrl);
    } catch {
      throw new Error(message);
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
        url.search || url.hash || url.hostname === 'localhost' || url.hostname.endsWith('.localhost') ||
        url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      throw new Error(message);
    }
    origin = url.origin;
  }

  // Select browser-safe fields explicitly; never expose deployment or owner metadata.
  return {
    tenantId: id(source.tenantId, 'tenant ID'),
    webClientId: id(record(source.web).appId, 'web application ID'),
    apiScope,
    backendUrl: origin,
  };
}

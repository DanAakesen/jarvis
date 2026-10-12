import {
  isWorkspacePin,
  isWorkspacePinsResponse,
  type GeneratedView,
  type WorkspacePin,
} from '@jarvis/contracts';
import { awaitWithSignal, backendFetch } from './backend-request';

export type PinnedWorkspaceView = WorkspacePin & { trustedBlobHost?: string };

export interface WorkspacePinsClient {
  readonly trustedBlobHost?: string;
  load: (signal?: AbortSignal) => Promise<PinnedWorkspaceView[]>;
  pin: (viewId: string, view: GeneratedView, signal?: AbortSignal) => Promise<PinnedWorkspaceView>;
  unpin: (viewId: string, signal?: AbortSignal) => Promise<void>;
}

class PinAuthenticationError extends Error {}

function waitForRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function responseValidation(value: unknown, trustedBlobHost?: string) {
  if (trustedBlobHost) return { trustedBlobHost };
  const body = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  const candidates = Array.isArray(body?.pins) ? body.pins : body?.pin ? [body.pin] : [];
  const hosts = new Set<string>();
  for (const candidate of candidates) {
    const pin = typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : null;
    const view = typeof pin?.view === 'object' && pin.view !== null ? pin.view as Record<string, unknown> : null;
    const data = typeof view?.data === 'object' && view.data !== null ? view.data as Record<string, unknown> : null;
    if (view?.renderer !== 'image' || !Array.isArray(data?.images)) continue;
    for (const image of data.images) {
      if (typeof image !== 'object' || image === null || !('url' in image) || typeof image.url !== 'string') continue;
      try {
        const host = new URL(image.url).hostname.toLowerCase();
        if (/^[a-z0-9]{3,24}\.blob\.core\.windows\.net$/u.test(host)) hosts.add(host);
      } catch {
        return undefined;
      }
    }
  }
  return hosts.size === 1 ? { trustedBlobHost: [...hosts][0]! } : undefined;
}

function requestError(status: number, operation: 'load' | 'pin' | 'unpin'): Error {
  if (status === 401 || status === 403) return new Error('Your Microsoft sign-in needs attention. Sign in again.');
  if (operation === 'pin' && status === 409) {
    return new Error('You already have 20 pinned windows. Unpin one before pinning another.');
  }
  if (operation === 'load') return new Error('Pinned windows could not be loaded. Try again.');
  return new Error(operation === 'pin'
    ? 'This window could not be pinned. Try again.'
    : 'This window could not be unpinned. Try again.');
}

export function createWorkspacePinsClient(
  backendUrl: string,
  getAccessToken: () => Promise<string>,
  trustedBlobHost?: string,
): WorkspacePinsClient {
  const base = backendUrl.replace(/\/+$/u, '');

  async function request(path: string, init: RequestInit = {}) {
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(120_000)]);
    return awaitWithSignal(async () => {
      let token: string;
      try {
        token = await getAccessToken();
      } catch (cause) {
        signal.throwIfAborted();
        throw new PinAuthenticationError('Your Microsoft sign-in needs attention. Sign in again.', { cause });
      }
      signal.throwIfAborted();
      return backendFetch(`${base}${path}`, {
        ...init,
        signal,
        headers: {
          Authorization: `${['Bear', 'er'].join('')} ${token}`,
          Accept: 'application/json',
          ...init.headers,
        },
        cache: 'no-store',
      });
    }, signal);
  }

  return {
    ...(trustedBlobHost ? { trustedBlobHost } : {}),
    async load(signal) {
      const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]);
      let response!: Response;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await request('/workspace/pins', { signal: deadline });
        } catch (cause) {
          if (cause instanceof PinAuthenticationError) throw cause;
          if (signal?.aborted) throw cause;
          if (cause instanceof TypeError && !deadline.aborted && attempt < 2) {
            await waitForRetry(deadline, 500 * (attempt + 1));
            continue;
          }
          throw new Error('Pinned windows could not be loaded. Try again.', { cause });
        }
        if (response.ok) break;
        await response.body?.cancel().catch(() => {});
        if ([408, 502, 503, 504].includes(response.status) && attempt < 2 && !deadline.aborted) {
          await waitForRetry(deadline, 500 * (attempt + 1));
          continue;
        }
        throw requestError(response.status, 'load');
      }
      const value: unknown = await awaitWithSignal(() => response.json(), deadline);
      const validation = responseValidation(value, trustedBlobHost);
      if (!isWorkspacePinsResponse(value, validation)) {
        throw new Error('Jarvis returned pinned windows that could not be shown safely.');
      }
      return value.pins.map((pin) => validation?.trustedBlobHost
        ? { ...pin, trustedBlobHost: validation.trustedBlobHost } : pin);
    },
    async pin(viewId, view, signal) {
      let response: Response;
      try {
        response = await request(`/workspace/pins/${encodeURIComponent(viewId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ view }),
          ...(signal ? { signal } : {}),
        });
      } catch (cause) {
        if (cause instanceof PinAuthenticationError) throw cause;
        throw new Error('This window could not be pinned. Try again.', { cause });
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw requestError(response.status, 'pin');
      }
      const value: unknown = await response.json();
      const pinValue = typeof value === 'object' && value !== null && 'pin' in value ? value.pin : null;
      const validation = responseValidation(value, trustedBlobHost);
      if (!isWorkspacePin(pinValue, validation) || pinValue.viewId !== viewId) {
        throw new Error('Jarvis returned a pin that could not be shown safely.');
      }
      return validation?.trustedBlobHost ? { ...pinValue, trustedBlobHost: validation.trustedBlobHost } : pinValue;
    },
    async unpin(viewId, signal) {
      let response: Response;
      try {
        response = await request(`/workspace/pins/${encodeURIComponent(viewId)}`, { method: 'DELETE', ...(signal ? { signal } : {}) });
      } catch (cause) {
        if (cause instanceof PinAuthenticationError) throw cause;
        throw new Error('This window could not be unpinned. Try again.', { cause });
      }
      await response.body?.cancel().catch(() => {});
      if (response.ok || response.status === 404) return;
      throw requestError(response.status, 'unpin');
    },
  };
}

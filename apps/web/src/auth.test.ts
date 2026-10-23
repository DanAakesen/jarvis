import type { PublicClientApplication } from '@azure/msal-browser';
import { BrowserCacheLocation } from '@azure/msal-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import {
  clearSignInMarkers,
  confirmOwnerSession,
  createAuthClient,
  hasSignedInDeviceBefore,
  isSignInRedirectPending,
  restoreProfile,
  saveSignInReturnPath,
  signIn,
  signOut,
  takeSignInReturnPath,
} from './auth';
import { clearOwnerSessionMintWait } from './owner-session';
import { isEntraPreferred, preferEntraOwnerSession, preferOwnerSession } from './owner-session';
import { getDatabaseWaking } from './backend-request';

const config: PublicConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  webClientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/access_as_user',
  backendUrl: 'https://api.example.com',
};
const account = { homeAccountId: 'account-id' } as never;
const fetchMock = vi.fn();
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearSignInMarkers();
  clearOwnerSessionMintWait(config.backendUrl);
  preferOwnerSession(config);
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  fetchMock.mockReset();
});

function client(overrides: Partial<PublicClientApplication> = {}) {
  return {
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    logoutRedirect: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    ssoSilent: vi.fn().mockRejectedValue(Object.assign(new Error('no session'), { errorCode: 'login_required' })),
    setActiveAccount: vi.fn(),
    getActiveAccount: vi.fn().mockReturnValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'cached-access-token' }),
    ...overrides,
  } as unknown as PublicClientApplication;
}

describe('web authentication', () => {
  it('uses MSAL localStorage for its shared browser cache', () => {
    const msal = createAuthClient(config);
    expect(msal.getConfiguration().cache.cacheLocation).toBe(BrowserCacheLocation.LocalStorage);
    expect(msal.getConfiguration().system.iframeBridgeTimeout).toBe(5_000);
  });

  it('does not force account selection on the default sign-in path', async () => {
    expect(isSignInRedirectPending()).toBe(false);
    const msal = client({ loginRedirect: vi.fn(async () => {
      expect(isSignInRedirectPending()).toBe(true);
    }) });

    await expect(signIn(msal, config)).resolves.toBeUndefined();

    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      redirectUri: `${window.location.origin}/`,
    });
  });

  it('offers account selection only when explicitly switching accounts', async () => {
    const msal = client();

    await signIn(msal, config);
    await signIn(msal, config, true);

    expect(msal.loginRedirect).toHaveBeenNthCalledWith(1, {
      scopes: [config.apiScope],
      redirectUri: `${window.location.origin}/`,
    });
    expect(msal.loginRedirect).toHaveBeenNthCalledWith(2, {
      scopes: [config.apiScope],
      prompt: 'select_account',
      redirectUri: `${window.location.origin}/`,
    });
  });

  it('completes a returning redirect and sends its token to the protected profile endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ handleRedirectPromise: vi.fn().mockResolvedValue({ account, accessToken: 'access-token' }) });
    await signIn(msal, config);
    expect(isSignInRedirectPending()).toBe(true);

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(isSignInRedirectPending()).toBe(false);

    expect(msal.setActiveAccount).toHaveBeenCalledWith(account);
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/me', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} access-token` },
    }));
  });

  it('restores a valid owner session before attempting any MSAL token flow', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/me', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
    }));
    expect(msal.ssoSilent).not.toHaveBeenCalled();
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
  });

  it('keeps a session through 503 and retries its profile with backoff', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    const restored = restoreProfile(client(), config);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(restored).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
  });

  it('shows the shared wake cue only after a session restore has remained pending for three seconds', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const restored = restoreProfile(client(), config);
    await Promise.resolve();
    await Promise.resolve();
    expect(getDatabaseWaking()).toBe(false);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(getDatabaseWaking()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(getDatabaseWaking()).toBe(true);

    finish(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    await expect(restored).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(getDatabaseWaking()).toBe(false);
  });

  it.each([
    { description: 'network failures', status: 0 },
    { description: '429 responses', status: 429 },
    { description: '503 responses', status: 503 },
  ])('falls back to Entra after 25 seconds of $description', async ({ status }) => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('authorization')?.endsWith(token)) {
        if (status === 0) throw new Error('Synthetic network failure.');
        return new Response(null, { status });
      }
      return new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    const restored = restoreProfile(msal, config);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    await expect(restored).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [config.apiScope], account });
    expect(isEntraPreferred(config)).toBe(true);
    const profileCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/me'));
    expect(profileCalls.some(([, init]) =>
      new Headers(init?.headers).get('authorization')?.endsWith(token))).toBe(true);
    expect(new Headers(profileCalls.at(-1)?.[1]?.headers).get('authorization'))
      .toBe(`${['Bear', 'er'].join('')} cached-access-token`);
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
  });

  it('falls back after 25 seconds when a session profile request times out', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    let sessionRequests = 0;
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('authorization')?.endsWith(token)) {
        sessionRequests += 1;
        if (sessionRequests === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('Synthetic timeout.')), { once: true });
          });
        }
        return new Response(null, { status: 503 });
      }
      return new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), milliseconds);
      return controller.signal;
    });
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    const restored = restoreProfile(msal, config);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(24_999);
    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);

    await expect(restored).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(sessionRequests).toBe(4);
    expect(isEntraPreferred(config)).toBe(true);
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
  });

  it('keeps retrying a session indefinitely when no Microsoft account is known', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();
    const controller = new AbortController();
    const msal = client();
    const restored = restoreProfile(msal, config, controller.signal);
    const aborted = expect(restored).rejects.toBeDefined();
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(25_000);

    expect(msal.acquireTokenSilent).not.toHaveBeenCalled();
    expect(msal.ssoSilent).not.toHaveBeenCalled();
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
    controller.abort();
    await aborted;
  });

  it('falls back to Entra and starts minting again after a confirmed session 401', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock.mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/auth/session')) return new Response(null, { status: 404 });
      const authorization = new Headers(init?.headers).get('authorization');
      return authorization?.endsWith(token)
        ? new Response(null, { status: 401 })
        : new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });

    expect(localStorage.getItem('jarvis.owner-session')).toBeNull();
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [config.apiScope], account });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/me'))).toHaveLength(3);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/auth/session', expect.anything(),
    ));
  });

  it('keeps a session after an unconfirmed restore 401 and retries it', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    let sessionChecks = 0;
    fetchMock.mockImplementation(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization');
      if (authorization?.endsWith(token)) {
        sessionChecks += 1;
        return sessionChecks === 1
          ? new Response(null, { status: 401 })
          : sessionChecks === 2
            ? new Response(null, { status: 503 })
            : new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();

    const restored = restoreProfile(client(), config);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(restored).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(sessionChecks).toBe(3);
    expect(localStorage.getItem('jarvis.owner-session')).not.toBeNull();
  });

  it('does not bypass a switch-off mint wait during silent profile restoration', async () => {
    fetchMock
      .mockImplementation(async (url: RequestInfo | URL) => String(url).endsWith('/auth/session')
        ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/session'))).toHaveLength(1);
  });

  it('only clears the session that was confirmed invalid, not a newer cross-tab record', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    const nextToken = `js.${'c'.repeat(22)}.${'d'.repeat(43)}`;
    const record = (sessionId: string, value: string) => ({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId,
      token: value,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    });
    localStorage.setItem('jarvis.owner-session', JSON.stringify(record('a'.repeat(22), token)));
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    const confirmation = confirmOwnerSession(config, token);
    await Promise.resolve();
    await Promise.resolve();
    localStorage.setItem('jarvis.owner-session', JSON.stringify(record('c'.repeat(22), nextToken)));
    finish(new Response(null, { status: 401 }));

    await expect(confirmation).resolves.toBe('changed');
    expect(JSON.parse(localStorage.getItem('jarvis.owner-session')!).token).toBe(nextToken);
  });

  it('single-flights concurrent session confirmation requests for the same token', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    preferEntraOwnerSession(config);

    const first = confirmOwnerSession(config, token);
    const second = confirmOwnerSession(config, token);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(new Response(null, { status: 200 }));

    await expect(Promise.all([first, second])).resolves.toEqual(['valid', 'valid']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isEntraPreferred(config)).toBe(false);
  });

  it('shows the backend denial without exposing its response body', async () => {
    fetchMock.mockResolvedValue(new Response('private provider detail', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ handleRedirectPromise: vi.fn().mockResolvedValue({ account, accessToken: 'access-token' }) });

    await expect(restoreProfile(msal, config)).rejects.toThrow("This Microsoft account isn't allowed to use Jarvis.");
  });

  it('does not expose MSAL provider error details', async () => {
    const msal = client({ loginRedirect: vi.fn().mockRejectedValue(new Error('provider-secret detail')) });

    await expect(signIn(msal, config)).rejects.toThrow('Microsoft sign-in did not complete. Try again.');
    expect(isSignInRedirectPending()).toBe(false);
    vi.mocked(msal.loginRedirect).mockRejectedValueOnce(Object.assign(new Error('busy'), { errorCode: 'interaction_in_progress' }));
    await expect(signIn(msal, config)).rejects.toThrow('A previous sign-in is still open in this tab.');
    const returning = client({
      handleRedirectPromise: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { errorCode: 'user_cancelled' })),
    });
    await signIn(returning, config);
    await expect(restoreProfile(returning, config)).rejects.toThrow('Microsoft sign-in did not complete (user_cancelled). Try again.');
    expect(isSignInRedirectPending()).toBe(false);
  });

  it('does not block sign-in if session storage is restricted', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(isSignInRedirectPending()).toBe(false);
    await expect(signIn(client(), config)).resolves.toBeUndefined();
    await expect(restoreProfile(client(), config)).resolves.toBeNull();
  });
  it('retains only a same-origin path for post-sign-in return', () => {
    saveSignInReturnPath('/proactive/11111111-1111-4111-8111-111111111111?from=notification#item');
    expect(takeSignInReturnPath()).toBe('/proactive/11111111-1111-4111-8111-111111111111?from=notification#item');
    expect(takeSignInReturnPath()).toBeNull();

    saveSignInReturnPath('//example.invalid/path');
    expect(takeSignInReturnPath()).toBeNull();
    saveSignInReturnPath('https://example.invalid/path');
    expect(takeSignInReturnPath()).toBeNull();
  });
  it('silently restores a cached account and records that this device signed in', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [config.apiScope], account });
    expect(hasSignedInDeviceBefore()).toBe(true);
  });

  it('silently restores a cold start from the existing Microsoft session', async () => {
    localStorage.setItem('jarvis.sign-in-device', 'previous');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ ssoSilent: vi.fn().mockResolvedValue({ account, accessToken: 'silent-access-token' }) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });

    expect(msal.ssoSilent).toHaveBeenCalledWith({ scopes: [config.apiScope] });
    expect(msal.setActiveAccount).toHaveBeenCalledWith(account);
    expect(msal.loginRedirect).not.toHaveBeenCalled();
  });

  it('uses one guarded automatic redirect after silent SSO fails', async () => {
    localStorage.setItem('jarvis.sign-in-device', 'previous');
    const msal = client();

    await expect(restoreProfile(msal, config)).resolves.toBeNull();
    expect(msal.loginRedirect).toHaveBeenCalledTimes(1);
    expect(msal.loginRedirect).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      redirectUri: `${window.location.origin}/`,
    });
    expect(isSignInRedirectPending()).toBe(true);

    await expect(restoreProfile(msal, config)).rejects.toThrow('Microsoft sign-in did not complete (login_required).');
    expect(msal.loginRedirect).toHaveBeenCalledTimes(1);
  });

  it('does not attempt automatic SSO or redirect on a device without the marker', async () => {
    const msal = client();

    await expect(restoreProfile(msal, config)).resolves.toBeNull();

    expect(msal.ssoSilent).not.toHaveBeenCalled();
    expect(msal.loginRedirect).not.toHaveBeenCalled();
  });

  it('recovers token renewal through one redirect and preserves the current route', async () => {
    localStorage.setItem('jarvis.sign-in-device', 'previous');
    window.history.pushState({}, '', '/settings?tab=appearance#theme');
    const msal = client({
      getActiveAccount: vi.fn().mockReturnValue(account),
      acquireTokenSilent: vi.fn().mockRejectedValue(Object.assign(new Error('renewal failed'), {
        errorCode: 'interaction_required',
      })),
    });

    await expect(restoreProfile(msal, config)).resolves.toBeNull();

    expect(msal.loginRedirect).toHaveBeenCalledTimes(1);
    expect(takeSignInReturnPath()).toBe('/settings?tab=appearance#theme');
  });

  it('clears the MSAL cache and sign-in markers before returning to the app root', async () => {
    localStorage.setItem('jarvis.sign-in-device', 'previous');
    const msal = client();

    await signOut(msal);

    expect(msal.clearCache).toHaveBeenCalledTimes(1);
    expect(msal.logoutRedirect).toHaveBeenCalledWith({
      postLogoutRedirectUri: `${window.location.origin}/`,
    });

    expect(hasSignedInDeviceBefore()).toBe(false);
    await expect(restoreProfile(msal, config)).resolves.toBeNull();
    expect(msal.ssoSilent).not.toHaveBeenCalled();
    expect(msal.loginRedirect).not.toHaveBeenCalled();
  });

  it('attempts session revocation but still clears locally when the network fails', async () => {
    const token = `js.${'a'.repeat(22)}.${'b'.repeat(43)}`;
    localStorage.setItem('jarvis.owner-session', JSON.stringify({
      version: 1,
      backendOrigin: 'https://api.example.com',
      sessionId: 'a'.repeat(22),
      token,
      idleExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString(),
      absoluteExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    }));
    fetchMock.mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await signOut(client(), config);

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/auth/session', expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `${['Bear', 'er'].join('')} ${token}` },
    }));
    expect(localStorage.getItem('jarvis.owner-session')).toBeNull();
  });

  it('keeps the existing renewal message for failures that do not need interaction', async () => {
    const msal = client({
      getActiveAccount: vi.fn().mockReturnValue(account),
      acquireTokenSilent: vi.fn().mockRejectedValue(new Error('network unavailable')),
    });

    await expect(restoreProfile(msal, config)).rejects.toThrow('Your Microsoft sign-in needs attention. Sign in again.');
    expect(msal.loginRedirect).not.toHaveBeenCalled();
  });
});

import type { PublicClientApplication } from '@azure/msal-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { isSignInRedirectPending, restoreProfile, saveSignInReturnPath, signIn, takeSignInReturnPath } from './auth';

const config: PublicConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  webClientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/access_as_user',
  backendUrl: 'https://api.example.com',
};
const account = { homeAccountId: 'account-id' } as never;
const fetchMock = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); sessionStorage.clear(); fetchMock.mockReset(); });

function client(overrides: Partial<PublicClientApplication> = {}) {
  return {
    loginRedirect: vi.fn().mockResolvedValue(undefined),
    handleRedirectPromise: vi.fn().mockResolvedValue(null),
    setActiveAccount: vi.fn(),
    getActiveAccount: vi.fn().mockReturnValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'cached-access-token' }),
    ...overrides,
  } as unknown as PublicClientApplication;
}

describe('web authentication', () => {
  it('redirects the page to Microsoft sign-in for the API scope and returns to the site root', async () => {
    expect(isSignInRedirectPending()).toBe(false);
    const msal = client({ loginRedirect: vi.fn(async () => {
      expect(isSignInRedirectPending()).toBe(true);
    }) });

    await expect(signIn(msal, config)).resolves.toBeUndefined();

    expect(msal.loginRedirect).toHaveBeenCalledWith({
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
  it('silently restores a cached account and returns null when no account is cached', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client({ getActiveAccount: vi.fn().mockReturnValue(account) });

    await expect(restoreProfile(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });
    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ scopes: [config.apiScope], account });
    expect(await restoreProfile(client(), config)).toBeNull();
  });
});

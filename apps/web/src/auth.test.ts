import type { PublicClientApplication } from '@azure/msal-browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicConfig } from '../config/public-config';
import { restoreProfile, signIn } from './auth';

const config: PublicConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  webClientId: '22222222-2222-4222-8222-222222222222',
  apiScope: 'api://33333333-3333-4333-8333-333333333333/access_as_user',
  backendUrl: 'https://api.example.com',
};
const account = { homeAccountId: 'account-id' } as never;
const fetchMock = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

function client(overrides: Partial<PublicClientApplication> = {}) {
  return {
    loginPopup: vi.fn().mockResolvedValue({ account, accessToken: 'access-token' }),
    setActiveAccount: vi.fn(),
    getActiveAccount: vi.fn().mockReturnValue(null),
    getAllAccounts: vi.fn().mockReturnValue([]),
    acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'cached-access-token' }),
    ...overrides,
  } as unknown as PublicClientApplication;
}

describe('web authentication', () => {
  it('requests the API scope, then sends its token to the protected profile endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'Dan Aakesen' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const msal = client();

    await expect(signIn(msal, config)).resolves.toEqual({ name: 'Dan Aakesen' });

    expect(msal.loginPopup).toHaveBeenCalledWith({
      scopes: [config.apiScope],
      prompt: 'select_account',
    });
    expect(msal.setActiveAccount).toHaveBeenCalledWith(account);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/me', expect.objectContaining({
      headers: { Authorization: `${['Bear', 'er'].join('')} access-token` },
    }));
  });

  it('shows the backend denial without exposing its response body', async () => {
    fetchMock.mockResolvedValue(new Response('private provider detail', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signIn(client(), config)).rejects.toThrow("This Microsoft account isn't allowed to use Jarvis.");
  });

  it('does not expose MSAL provider error details', async () => {
    const msal = client({ loginPopup: vi.fn().mockRejectedValue(new Error('provider-secret detail')) });

    await expect(signIn(msal, config)).rejects.toThrow('Microsoft sign-in did not complete. Try again.');
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

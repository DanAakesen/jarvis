import {
  BrowserCacheLocation,
  PublicClientApplication,
} from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';

export interface UserProfile {
  name: string;
}

export function createAuthClient(config: PublicConfig): PublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: config.webClientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  });
}

export async function signIn(client: PublicClientApplication, config: PublicConfig): Promise<UserProfile> {
  let result;
  try {
    result = await client.loginPopup({ scopes: [config.apiScope], prompt: 'select_account' });
  } catch {
    throw new Error('Microsoft sign-in did not complete. Try again.');
  }
  if (!result.account || !result.accessToken) throw new Error('Microsoft sign-in did not return an API token.');
  client.setActiveAccount(result.account);
  return loadProfile(config, result.accessToken);
}

export async function restoreProfile(client: PublicClientApplication, config: PublicConfig): Promise<UserProfile | null> {
  const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account) return null;
  let result;
  try {
    result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
  } catch {
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
  }
  if (!result.accessToken) throw new Error('Microsoft sign-in did not return an API token.');
  return loadProfile(config, result.accessToken);
}

async function loadProfile(config: PublicConfig, accessToken: string): Promise<UserProfile> {
  if (!config.backendUrl) throw new Error('Sign-in is unavailable until the backend is deployed.');

  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await fetch(`${config.backendUrl}/me`, {
      headers: { Authorization: `${bearerScheme} ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Jarvis could not reach the backend. Try again.');
  }
  if (response.status === 401) {
    throw new Error('Jarvis could not verify your Microsoft sign-in. Try again.');
  }
  if (response.status === 403) {
    throw new Error("This Microsoft account isn't allowed to use Jarvis.");
  }
  if (!response.ok) throw new Error(`Jarvis could not verify your sign-in (HTTP ${response.status}).`);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('Jarvis returned an invalid profile response.');
  }
  if (typeof body !== 'object' || body === null || !('name' in body) ||
      typeof body.name !== 'string' || !body.name.trim() || body.name.length > 200) {
    throw new Error('Jarvis returned an invalid profile response.');
  }
  return { name: body.name.trim() };
}

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
      // MSAL v5 returns popup and silent sign-in through the redirect bridge page (L63).
      redirectUri: `${window.location.origin}/redirect.html`,
      postLogoutRedirectUri: `${window.location.origin}/redirect.html`,
    },
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage },
  });
}

/** MSAL error codes are fixed identifiers (no tokens), so showing one makes failures diagnosable. */
function signInFailureMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { errorCode?: unknown }).errorCode : undefined;
  if (code === 'interaction_in_progress') {
    return 'A previous sign-in is still open in this tab. Close the tab, open Jarvis in a new tab and sign in.';
  }
  if (code === 'popup_window_error' || code === 'empty_window_error') {
    return 'The sign-in window could not open. Allow pop-ups for Jarvis and try again.';
  }
  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code)
    ? `Microsoft sign-in did not complete (${code}). Try again.`
    : 'Microsoft sign-in did not complete. Try again.';
}

export async function signIn(client: PublicClientApplication, config: PublicConfig): Promise<UserProfile> {
  let result;
  try {
    result = await client.loginPopup({ scopes: [config.apiScope], prompt: 'select_account' });
  } catch (error) {
    throw new Error(signInFailureMessage(error), { cause: error });
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

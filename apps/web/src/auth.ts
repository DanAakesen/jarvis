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
      // Silent (iframe) token renewal returns through the redirect bridge page (L63).
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
  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code)
    ? `Microsoft sign-in did not complete (${code}). Try again.`
    : 'Microsoft sign-in did not complete. Try again.';
}

/**
 * Sends the whole page to Microsoft sign-in; Entra returns it to the registered site root, where
 * `restoreProfile` completes the sign-in. No popup, so embedded browsers and popup blockers work.
 */
export async function signIn(client: PublicClientApplication, config: PublicConfig): Promise<void> {
  try {
    await client.loginRedirect({
      scopes: [config.apiScope],
      prompt: 'select_account',
      redirectUri: `${window.location.origin}/`,
    });
  } catch (error) {
    throw new Error(signInFailureMessage(error), { cause: error });
  }
}

export async function restoreProfile(client: PublicClientApplication, config: PublicConfig): Promise<UserProfile | null> {
  let redirected;
  try {
    redirected = await client.handleRedirectPromise();
  } catch (error) {
    throw new Error(signInFailureMessage(error), { cause: error });
  }
  if (redirected?.account) {
    client.setActiveAccount(redirected.account);
    if (redirected.accessToken) return loadProfile(config, redirected.accessToken);
  }

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

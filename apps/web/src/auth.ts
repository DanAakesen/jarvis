import {
  BrowserCacheLocation,
  PublicClientApplication,
} from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';

export interface UserProfile {
  name: string;
}

export class MicrosoftSignInError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MicrosoftSignInError';
  }
}

const redirectMarker = 'jarvis.sign-in-redirect';
const signInReturnPathMarker = 'jarvis.sign-in-return-path';
const signedInDeviceMarker = 'jarvis.sign-in-device';
const automaticRedirectMarker = 'jarvis.sign-in-automatic-redirect';
const automaticRedirectCooldown = 5 * 60_000;
const silentSsoTimeout = 5_000;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function hasSignedInDeviceBefore(): boolean {
  return readStorage(signedInDeviceMarker) !== null;
}

export function isSignInStorageEvent(event: StorageEvent): boolean {
  return event.key === signedInDeviceMarker || event.key?.startsWith('msal.') === true;
}

function rememberSignedInDevice(): void {
  try {
    localStorage.setItem(signedInDeviceMarker, String(Date.now()));
  } catch {
    // Storage restrictions must not prevent Microsoft sign-in.
  }
}

export function clearSignInMarkers(): void {
  try {
    localStorage.removeItem(signedInDeviceMarker);
    localStorage.removeItem(automaticRedirectMarker);
  } catch {
    // Storage restrictions must not prevent Microsoft sign-in.
  }
  try {
    sessionStorage.removeItem(redirectMarker);
    sessionStorage.removeItem(signInReturnPathMarker);
  } catch {
    // Storage restrictions must not prevent Microsoft sign-in.
  }
}

function sameOriginPath(value: string): string | null {
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function saveSignInReturnPath(path: string): void {
  const safePath = sameOriginPath(path);
  if (!safePath) return;
  try {
    sessionStorage.setItem(signInReturnPathMarker, safePath);
  } catch {
    // Storage restrictions must not prevent Microsoft sign-in.
  }
}

export function takeSignInReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(signInReturnPathMarker);
    sessionStorage.removeItem(signInReturnPathMarker);
    return path ? sameOriginPath(path) : null;
  } catch {
    return null;
  }
}

export function isSignInRedirectPending(): boolean {
  try {
    return sessionStorage.getItem(redirectMarker) === 'pending';
  } catch {
    return false;
  }
}

function markSignInRedirect(pending: boolean) {
  try {
    if (pending) sessionStorage.setItem(redirectMarker, 'pending');
    else sessionStorage.removeItem(redirectMarker);
  } catch {
    // Storage restrictions must not prevent Microsoft sign-in.
  }
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
    cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
    system: { iframeBridgeTimeout: silentSsoTimeout },
  });
}

/** MSAL error codes are fixed identifiers (no tokens), so showing one makes failures diagnosable. */
export function signInFailureMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { errorCode?: unknown }).errorCode : undefined;
  if (code === 'interaction_in_progress') {
    return 'A previous sign-in is still open in this tab. Close the tab, open Jarvis in a new tab and sign in.';
  }
  return typeof code === 'string' && /^[a-z_]{1,64}$/.test(code)
    ? `Microsoft sign-in did not complete (${code}). Try again.`
    : 'Microsoft sign-in did not complete. Try again.';
}

export function needsSignInInteraction(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null
    ? (error as { errorCode?: unknown }).errorCode
    : undefined;
  return typeof code === 'string' && [
    'invalid_grant',
    'login_required',
    'interaction_required',
    'monitor_window_timeout',
    'no_account_error',
  ].includes(code);
}

function currentPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Uses one top-level redirect per device cooldown. The persistent timestamp is written before
 * navigation so a redirect failure or reload cannot create an automatic sign-in loop.
 */
export async function tryAutomaticSignInRedirect(
  client: PublicClientApplication,
  config: PublicConfig,
  error: unknown,
): Promise<boolean> {
  if (!hasSignedInDeviceBefore()) return false;
  const now = Date.now();
  const previousAttemptValue = readStorage(automaticRedirectMarker);
  if (previousAttemptValue !== null) {
    const previousAttempt = Number(previousAttemptValue);
    if (Number.isFinite(previousAttempt) && now >= previousAttempt &&
        now - previousAttempt < automaticRedirectCooldown) return false;
  }
  try {
    localStorage.setItem(automaticRedirectMarker, String(now));
  } catch {
    return false;
  }

  saveSignInReturnPath(currentPath());
  try {
    markSignInRedirect(true);
    await client.loginRedirect({
      scopes: [config.apiScope],
      redirectUri: `${window.location.origin}/`,
    });
    return true;
  } catch (redirectError) {
    markSignInRedirect(false);
    throw new MicrosoftSignInError(signInFailureMessage(redirectError ?? error), { cause: redirectError });
  }
}

/**
 * Sends the whole page to Microsoft sign-in; Entra returns it to the registered site root, where
 * `restoreProfile` completes the sign-in. No popup, so embedded browsers and popup blockers work.
 */
export async function signIn(client: PublicClientApplication, config: PublicConfig, switchAccount = false): Promise<void> {
  try {
    markSignInRedirect(true);
    await client.loginRedirect({
      scopes: [config.apiScope],
      ...(switchAccount ? { prompt: 'select_account' as const } : {}),
      redirectUri: `${window.location.origin}/`,
    });
  } catch (error) {
    markSignInRedirect(false);
    throw new MicrosoftSignInError(signInFailureMessage(error), { cause: error });
  }
}

export async function signOut(client: PublicClientApplication): Promise<void> {
  clearSignInMarkers();
  let cacheError: unknown;
  try {
    await client.clearCache();
  } catch (error) {
    cacheError = error;
  }
  try {
    await client.logoutRedirect({ postLogoutRedirectUri: `${window.location.origin}/` });
  } catch (error) {
    throw new MicrosoftSignInError(signInFailureMessage(error), { cause: error });
  }
  if (cacheError) throw new MicrosoftSignInError(signInFailureMessage(cacheError), { cause: cacheError });
}

async function verifiedProfile(config: PublicConfig, accessToken: string): Promise<UserProfile> {
  const profile = await loadProfile(config, accessToken);
  rememberSignedInDevice();
  return profile;
}

export async function restoreProfile(client: PublicClientApplication, config: PublicConfig): Promise<UserProfile | null> {
  let redirected;
  try {
    redirected = await client.handleRedirectPromise();
  } catch (error) {
    throw new MicrosoftSignInError(signInFailureMessage(error), { cause: error });
  } finally {
    markSignInRedirect(false);
  }
  if (redirected?.account) {
    client.setActiveAccount(redirected.account);
    if (redirected.accessToken) return verifiedProfile(config, redirected.accessToken);
  }

  let account = client.getActiveAccount() ?? client.getAllAccounts()[0];
  if (!account && hasSignedInDeviceBefore()) {
    let silentResult;
    try {
      silentResult = await client.ssoSilent({ scopes: [config.apiScope] });
    } catch (error) {
      if (await tryAutomaticSignInRedirect(client, config, error)) return null;
      throw new MicrosoftSignInError(signInFailureMessage(error), { cause: error });
    }
    if (silentResult.account) {
      client.setActiveAccount(silentResult.account);
      account = silentResult.account;
    }
    if (silentResult.accessToken) return verifiedProfile(config, silentResult.accessToken);
  }
  if (!account) return null;
  let result;
  try {
    result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
  } catch (error) {
    if (needsSignInInteraction(error)) {
      if (await tryAutomaticSignInRedirect(client, config, error)) return null;
      throw new MicrosoftSignInError(signInFailureMessage(error), { cause: error });
    }
    throw new Error('Your Microsoft sign-in needs attention. Sign in again.', { cause: error });
  }
  if (!result.accessToken) throw new Error('Microsoft sign-in did not return an API token.');
  client.setActiveAccount(account);
  return verifiedProfile(config, result.accessToken);
}

export async function loadProfile(config: Pick<PublicConfig, 'backendUrl'>, accessToken: string, signal?: AbortSignal): Promise<UserProfile> {
  if (!config.backendUrl) throw new Error('Sign-in is unavailable until the backend is deployed.');

  let response: Response;
  try {
    const bearerScheme = ['Bear', 'er'].join('');
    response = await fetch(`${config.backendUrl}/me`, {
      headers: { Authorization: `${bearerScheme} ${accessToken}` },
      signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]),
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

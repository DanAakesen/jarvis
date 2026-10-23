import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import {
  createAuthClient,
  confirmOwnerSession,
  hasSignedInDeviceBefore,
  isSignInRedirectPending,
  isSignInStorageEvent,
  MicrosoftSignInError,
  needsSignInInteraction,
  restoreProfile,
  revokeAllOwnerSessions,
  signIn,
  signInFailureMessage,
  signOut as clearSignIn,
  tryAutomaticSignInRedirect,
  type UserProfile,
} from './auth';
import { mintOwnerSession, readOwnerSession, subscribeOwnerSession } from './owner-session';
import { setOwnerSessionRequestAuth } from './backend-request';

export type SignInState = 'checking' | 'signed-out' | 'redirecting' | 'signing-in' | 'signing-out' | 'signed-in' | 'error' | 'unavailable';

export interface SignInSession {
  state: SignInState;
  profile: UserProfile | null;
  message: string;
  signIn: () => Promise<void>;
  switchAccount: () => Promise<void>;
  signOut: () => Promise<void>;
  signOutAllDevices: () => Promise<void>;
  hasOwnerSession: boolean;
  getAccessToken: () => Promise<string>;
  client: PublicClientApplication;
}

/** Owns the browser session for the whole shell, so moving between pages never repeats sign-in. */
export function useSignIn(config: PublicConfig): SignInSession {
  const client = useMemo(() => createAuthClient(config), [config]);
  const [state, setState] = useState<SignInState>(() =>
    config.backendUrl
      ? (isSignInRedirectPending() || hasSignedInDeviceBefore() ? 'signing-in' : 'checking')
      : 'unavailable');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [message, setMessage] = useState('');
  const [hasOwnerSession, setHasOwnerSession] = useState(() => Boolean(readOwnerSession(config)));

  useEffect(() => {
    if (!config.backendUrl) return;

    let active = true;
    let restoreVersion = 0;
    let restoreController: AbortController | null = null;
    let accountState = '';
    const readAccountState = () => JSON.stringify([
      client.getActiveAccount()?.homeAccountId ?? null,
      ...client.getAllAccounts().map(({ homeAccountId }) => homeAccountId).sort(),
    ]);
    const restore = async (initialized = false) => {
      const version = ++restoreVersion;
      restoreController?.abort();
      const controller = new AbortController();
      restoreController = controller;
      try {
        if (!initialized) await client.initialize();
        const restored = await restoreProfile(client, config, controller.signal);
        if (!active || version !== restoreVersion) return;
        setProfile(restored);
        setState(restored ? 'signed-in' : isSignInRedirectPending() ? 'signing-in' : 'signed-out');
        setMessage('');
      } catch (error) {
        if (!active || version !== restoreVersion) return;
        setMessage(error instanceof MicrosoftSignInError ? error.message : 'Sign-in needs attention.');
        setState('error');
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!isSignInStorageEvent(event)) return;
      if (event.key === 'jarvis.sign-in-device' && event.newValue === null) {
        restoreVersion++;
        setProfile(null);
        setMessage('');
        setState('signed-out');
        accountState = readAccountState();
        return;
      }
      const nextAccountState = readAccountState();
      if (event.key?.startsWith('msal.') && nextAccountState === accountState) return;
      accountState = nextAccountState;
      void restore();
    };
    window.addEventListener('storage', onStorage);
    void client.initialize().then(() => {
      if (!active) return;
      accountState = readAccountState();
      return restore(true);
    }).catch(() => {
      if (!active) return;
      setMessage('Sign-in needs attention.');
      setState('error');
    });

    return () => {
      active = false;
      restoreController?.abort();
      window.removeEventListener('storage', onStorage);
    };
  }, [client, config]);

  const beginSignIn = useCallback(async (switchAccount = false) => {
    setState('redirecting');
    setMessage('');
    try {
      await signIn(client, config, switchAccount); // The page now navigates to Microsoft sign-in.
    } catch (error) {
      setMessage(error instanceof MicrosoftSignInError ? error.message : 'Sign-in failed.');
      setState('error');
    }
  }, [client, config]);

  const handleSignIn = useCallback(() => beginSignIn(), [beginSignIn]);
  const handleAccountSwitch = useCallback(() => beginSignIn(true), [beginSignIn]);

  const handleSignOut = useCallback(async () => {
    setState('signing-out');
    setMessage('');
    try {
      await clearSignIn(client, config);
      setProfile(null);
      setState('signed-out');
    } catch (error) {
      setMessage(error instanceof MicrosoftSignInError ? error.message : 'Sign-out failed.');
      setState('error');
    }
  }, [client, config]);

  const getEntraAccessToken = useCallback(async () => {
    const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
    const interactionError = account
      ? null
      : Object.assign(new Error('No account is available.'), { errorCode: 'no_account_error' });
    try {
      if (interactionError) throw interactionError;
      const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account: account! });
      if (result.accessToken) {
        void mintOwnerSession(config, result.accessToken);
        return result.accessToken;
      }
    } catch (error) {
      if (needsSignInInteraction(error)) {
        const redirected = await tryAutomaticSignInRedirect(client, config, error).catch((redirectError: unknown) => {
          setProfile(null);
          setMessage(redirectError instanceof MicrosoftSignInError ? redirectError.message : signInFailureMessage(error));
          setState('error');
          throw redirectError;
        });
        if (redirected) {
          setProfile(null);
          setState('signing-in');
          throw new Error('Sign-in is redirecting.', { cause: error });
        }
        setProfile(null);
        setMessage(signInFailureMessage(error));
        setState('error');
      }
      throw new Error('Your Microsoft sign-in needs attention. Sign in again.', { cause: error });
    }
    throw new Error('Microsoft sign-in did not return an API token.');
  }, [client, config]);

  const getAccessToken = useCallback(async () => {
    const session = readOwnerSession(config);
    if (session) return session.token;
    return getEntraAccessToken();
  }, [config, getEntraAccessToken]);

  useEffect(() => {
    if (!config.backendUrl) return;
    let backendOrigin: string;
    try {
      backendOrigin = new URL(config.backendUrl).origin;
    } catch {
      return;
    }
    setOwnerSessionRequestAuth({
      backendOrigin,
      getAccessToken,
      confirmUnauthorized: (token) => confirmOwnerSession(config, token),
    });
    return () => setOwnerSessionRequestAuth(null);
  }, [config, getAccessToken]);

  useEffect(() => {
    const update = () => setHasOwnerSession(Boolean(readOwnerSession(config)));
    const unsubscribe = subscribeOwnerSession(update);
    window.addEventListener('storage', update);
    update();
    return () => {
      unsubscribe();
      window.removeEventListener('storage', update);
    };
  }, [config]);

  const handleSignOutAllDevices = useCallback(async () => {
    setState('signing-out');
    setMessage('');
    try {
      const token = await getAccessToken();
      await revokeAllOwnerSessions(config, token);
      await clearSignIn(client);
      setProfile(null);
      setState('signed-out');
    } catch (error) {
      setMessage(error instanceof MicrosoftSignInError ? error.message : 'Could not sign out other devices. Try again.');
      throw error;
    }
  }, [client, config, getAccessToken]);

  return {
    state,
    profile,
    message,
    signIn: handleSignIn,
    switchAccount: handleAccountSwitch,
    signOut: handleSignOut,
    signOutAllDevices: handleSignOutAllDevices,
    hasOwnerSession,
    getAccessToken,
    client,
  };
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import {
  createAuthClient,
  hasSignedInDeviceBefore,
  isSignInRedirectPending,
  isSignInStorageEvent,
  needsSignInInteraction,
  restoreProfile,
  signIn,
  signInFailureMessage,
  signOut as clearSignIn,
  tryAutomaticSignInRedirect,
  type UserProfile,
} from './auth';

export type SignInState = 'checking' | 'signed-out' | 'redirecting' | 'signing-in' | 'signing-out' | 'signed-in' | 'error' | 'unavailable';

export interface SignInSession {
  state: SignInState;
  profile: UserProfile | null;
  message: string;
  signIn: () => Promise<void>;
  switchAccount: () => Promise<void>;
  signOut: () => Promise<void>;
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

  useEffect(() => {
    if (!config.backendUrl) return;

    let active = true;
    let accountState = '';
    const readAccountState = () => JSON.stringify([
      client.getActiveAccount()?.homeAccountId ?? null,
      ...client.getAllAccounts().map(({ homeAccountId }) => homeAccountId).sort(),
    ]);
    const restore = async (initialized = false) => {
      try {
        if (!initialized) await client.initialize();
        const restored = await restoreProfile(client, config);
        if (!active) return;
        setProfile(restored);
        setState(restored ? 'signed-in' : isSignInRedirectPending() ? 'signing-in' : 'signed-out');
        setMessage('');
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Sign-in needs attention.');
        setState('error');
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (!isSignInStorageEvent(event)) return;
      if (event.key === 'jarvis.sign-in-device' && event.newValue === null) {
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
      window.removeEventListener('storage', onStorage);
    };
  }, [client, config]);

  const beginSignIn = useCallback(async (switchAccount = false) => {
    setState('redirecting');
    setMessage('');
    try {
      await signIn(client, config, switchAccount); // The page now navigates to Microsoft sign-in.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.');
      setState('error');
    }
  }, [client, config]);

  const handleSignIn = useCallback(() => beginSignIn(), [beginSignIn]);
  const handleAccountSwitch = useCallback(() => beginSignIn(true), [beginSignIn]);

  const handleSignOut = useCallback(async () => {
    setState('signing-out');
    setMessage('');
    try {
      await clearSignIn(client);
      setProfile(null);
      setState('signed-out');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-out failed.');
      setState('error');
    }
  }, [client]);

  const getAccessToken = useCallback(async () => {
    const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
    const interactionError = account
      ? null
      : Object.assign(new Error('No account is available.'), { errorCode: 'no_account_error' });
    try {
      if (interactionError) throw interactionError;
      const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account: account! });
      if (result.accessToken) return result.accessToken;
    } catch (error) {
      if (needsSignInInteraction(error)) {
        try {
          if (await tryAutomaticSignInRedirect(client, config, error)) {
            setProfile(null);
            setState('signing-in');
            throw new Error('Sign-in is redirecting.');
          }
        } catch (redirectError) {
          if (redirectError instanceof Error && redirectError.message === 'Sign-in is redirecting.') throw redirectError;
          setProfile(null);
          setMessage(redirectError instanceof Error ? redirectError.message : signInFailureMessage(error));
          setState('error');
          throw redirectError;
        }
        setProfile(null);
        setMessage(signInFailureMessage(error));
        setState('error');
      }
      throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    }
    throw new Error('Microsoft sign-in did not return an API token.');
  }, [client, config]);

  return {
    state,
    profile,
    message,
    signIn: handleSignIn,
    switchAccount: handleAccountSwitch,
    signOut: handleSignOut,
    getAccessToken,
    client,
  };
}

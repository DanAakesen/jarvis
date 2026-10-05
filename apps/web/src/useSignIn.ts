import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicClientApplication } from '@azure/msal-browser';
import type { PublicConfig } from '../config/public-config';
import { createAuthClient, restoreProfile, signIn, type UserProfile } from './auth';

export type SignInState = 'checking' | 'signed-out' | 'signing-in' | 'signed-in' | 'error' | 'unavailable';

export interface SignInSession {
  state: SignInState;
  profile: UserProfile | null;
  message: string;
  signIn: () => Promise<void>;
  getAccessToken: () => Promise<string>;
  client: PublicClientApplication;
}

/** Owns the browser session for the whole shell, so moving between pages never repeats sign-in. */
export function useSignIn(config: PublicConfig): SignInSession {
  const client = useMemo(() => createAuthClient(config), [config]);
  const [state, setState] = useState<SignInState>(config.backendUrl ? 'checking' : 'unavailable');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!config.backendUrl) return;

    let active = true;
    void client.initialize().catch(() => {
      throw new Error('Microsoft sign-in could not be initialized. Try again.');
    }).then(async () => {
      const restored = await restoreProfile(client, config);
      if (!active) return;
      setProfile(restored);
      setState(restored ? 'signed-in' : 'signed-out');
    }).catch((error: unknown) => {
      if (!active) return;
      setMessage(error instanceof Error ? error.message : 'Jarvis could not verify your sign-in. Try again.');
      setState('error');
    });

    return () => { active = false; };
  }, [client, config]);

  const handleSignIn = useCallback(async () => {
    setState('signing-in');
    setMessage('');
    try {
      await signIn(client, config); // The page now navigates to Microsoft sign-in.
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Jarvis could not verify your sign-in. Try again.');
      setState('error');
    }
  }, [client, config]);

  const getAccessToken = useCallback(async () => {
    const account = client.getActiveAccount() ?? client.getAllAccounts()[0];
    if (!account) throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    try {
      const result = await client.acquireTokenSilent({ scopes: [config.apiScope], account });
      if (result.accessToken) return result.accessToken;
    } catch {
      throw new Error('Your Microsoft sign-in needs attention. Sign in again.');
    }
    throw new Error('Microsoft sign-in did not return an API token.');
  }, [client, config]);

  return { state, profile, message, signIn: handleSignIn, getAccessToken, client };
}

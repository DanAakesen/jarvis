import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicConfig } from '../config/public-config';
import { createAuthClient, restoreProfile, signIn, type UserProfile } from './auth';

export type SignInState = 'checking' | 'signed-out' | 'signing-in' | 'signed-in' | 'error' | 'unavailable';

export interface SignInSession {
  state: SignInState;
  profile: UserProfile | null;
  message: string;
  signIn: () => Promise<void>;
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
      const signedInProfile = await signIn(client, config);
      setProfile(signedInProfile);
      setState('signed-in');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Jarvis could not verify your sign-in. Try again.');
      setState('error');
    }
  }, [client, config]);

  return { state, profile, message, signIn: handleSignIn };
}

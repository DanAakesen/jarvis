import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { createAuthClient, restoreProfile, signIn, type UserProfile } from './auth';
import { ConversationHistory } from './ConversationHistory';
import './ConversationHistory.css';

type SignInState = 'checking' | 'signed-out' | 'signing-in' | 'signed-in' | 'error' | 'unavailable';

function Home({ config }: { config: PublicConfig }) {
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

  async function handleSignIn() {
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
  }

  if (state === 'signed-in' && profile) {
    return (
      <section aria-labelledby="welcome-heading">
        <h1 id="welcome-heading">Welcome, {profile.name}</h1>
        <p>Your conversation with Jarvis appears below.</p>
        <ConversationHistory client={client} config={config} />
      </section>
    );
  }

  const pending = state === 'checking' || state === 'signing-in';
  return (
    <section aria-labelledby="welcome-heading">
      <h1 id="welcome-heading">Jarvis is taking shape</h1>
      <p>Your personal AI platform starts here. Sign in with your Microsoft account to continue.</p>
      <button className="primary-button" type="button" onClick={handleSignIn} disabled={pending || state === 'unavailable'}>
        {state === 'signing-in' ? 'Signing in…' : state === 'error' ? 'Try another Microsoft account' : 'Sign in with Microsoft'}
      </button>
      <p className="sign-in-status" role={state === 'error' ? 'alert' : 'status'} aria-live="polite">
        {state === 'checking' && 'Checking for an existing sign-in…'}
        {state === 'signed-out' && 'Not signed in.'}
        {state === 'signing-in' && 'Waiting for Microsoft sign-in and backend verification…'}
        {state === 'unavailable' && 'Sign-in is unavailable until the backend is deployed.'}
        {state === 'error' && message}
      </p>
    </section>
  );
}

export function App({ config = __JARVIS_CONFIG__ }: { config?: PublicConfig }) {
  return (
    <div className="app">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label="Jarvis home">Jarvis</Link>
      </header>
      <main id="content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={
            <Home config={config} />
          } />
          <Route path="*" element={
            <section aria-labelledby="missing-heading">
              <h1 id="missing-heading">Page not found</h1>
              <p>This address does not have a page in Jarvis.</p>
              <Link className="home-link" to="/">Return to Jarvis</Link>
            </section>
          } />
        </Routes>
      </main>
    </div>
  );
}

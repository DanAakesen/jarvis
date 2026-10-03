import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SignInSession } from './useSignIn';

export function SignInPage({ session }: { session: SignInSession }) {
  const { state, message } = session;
  const pending = state === 'checking' || state === 'signing-in';
  return (
    <section aria-labelledby="welcome-heading">
      <h1 id="welcome-heading">Jarvis is taking shape</h1>
      <p>Your personal AI platform starts here. Sign in with your Microsoft account to continue.</p>
      <button className="primary-button" type="button" onClick={() => { void session.signIn(); }} disabled={pending || state === 'unavailable'}>
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

export function NotFoundPage() {
  return (
    <section aria-labelledby="missing-heading">
      <h1 id="missing-heading">Page not found</h1>
      <p>This address does not have a page in Jarvis.</p>
      <Link className="home-link" to="/">Return to Jarvis</Link>
    </section>
  );
}

/** A page whose route exists but whose data and actions arrive with a later task. */
export function PendingPage({ title, children, back }: {
  title: string;
  children: ReactNode;
  back?: { to: string; label: string };
}) {
  return (
    <section aria-labelledby="page-heading">
      <h1 id="page-heading">{title}</h1>
      <p>{children}</p>
      {back && <Link className="home-link" to={back.to}>{back.label}</Link>}
    </section>
  );
}

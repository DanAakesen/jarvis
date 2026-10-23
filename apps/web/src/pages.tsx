import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { SignInSession } from './useSignIn';
import { Loader } from './Loader';
import { getSignInGreeting } from './sign-in-greeting';
import { saveSignInReturnPath } from './auth';
import { DatabaseWakeCue } from './DatabaseWakeStatus';
import { getDatabaseWaking, subscribeDatabaseStatus } from './backend-request';

export function SignInPage({ session }: { session: SignInSession }) {
  const location = useLocation();
  const { state, message } = session;
  const waking = useSyncExternalStore(subscribeDatabaseStatus, getDatabaseWaking);
  if (state === 'checking' || state === 'signing-in' || state === 'signing-out') {
    const text = state === 'signing-in' ? 'Signing you in' : state === 'signing-out' ? 'Signing you out' : 'Loading';
    return (
      <section className="signin signin-loading" aria-busy="true">
        {state !== 'signing-out' && session.hasOwnerSession && waking
          ? <DatabaseWakeCue />
          : <Loader variant="text" size="inline" text={text} label={text} />}
      </section>
    );
  }

  const pending = state === 'redirecting';
  const unavailable = state === 'unavailable';
  const beginSignIn = () => {
    saveSignInReturnPath(`${location.pathname}${location.search}${location.hash}`);
    void session.signIn();
  };
  const switchAccount = () => {
    saveSignInReturnPath(`${location.pathname}${location.search}${location.hash}`);
    void session.switchAccount();
  };
  return (
    <section className="signin" aria-labelledby="welcome-heading">
      <h1 id="welcome-heading">{getSignInGreeting()}</h1>
      {state === 'error' && <p className="signin-error" role="alert">{message || 'Sign-in failed.'}</p>}
      <button className="signin-button luminous-glass" type="button" onClick={beginSignIn}
        disabled={pending || unavailable} aria-label={pending ? 'Redirecting' : 'Sign in with Microsoft'} aria-busy={pending}
        aria-describedby={unavailable ? 'signin-unavailable' : undefined}>
        {pending
          ? <Loader variant="text" size="inline" announce={false} text="Redirecting" label="Redirecting" />
          : state === 'error' ? 'Retry' : 'Sign in'}
      </button>
      <button className="secondary-button" type="button" onClick={switchAccount}
        disabled={pending || unavailable} aria-label="Use a different Microsoft account" aria-busy={pending}
        aria-describedby={unavailable ? 'signin-unavailable' : undefined}>
        Use a different account
      </button>
      {unavailable && (
        <span className="visually-hidden" id="signin-unavailable">Sign-in is unavailable until the backend is configured.</span>
      )}
    </section>
  );
}

export function NotFoundPage() {
  return (
    <section className="panel" aria-labelledby="missing-heading">
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

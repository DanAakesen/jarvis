import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { SignInSession } from './useSignIn';
import { Loader } from './Loader';
import { getSignInGreeting } from './sign-in-greeting';

export function SignInPage({ session }: { session: SignInSession }) {
  const { state, message } = session;
  if (state === 'checking') {
    return (
      <section className="signin signin-loading" aria-busy="true">
        <Loader className="signin-loader" variant="core" size="inline" label="Checking for an existing sign-in…" />
      </section>
    );
  }

  const pending = state === 'signing-in';
  const unavailable = state === 'unavailable';
  return (
    <section className="signin" aria-labelledby="welcome-heading">
      <h1 id="welcome-heading">{getSignInGreeting()}</h1>
      {state === 'error' && <p className="signin-error" role="alert">{message || 'Sign-in failed.'}</p>}
      <button className="signin-button luminous-glass" type="button" onClick={() => { void session.signIn(); }}
        disabled={pending || unavailable} aria-label="Sign in with Microsoft" aria-busy={pending}
        aria-describedby={unavailable ? 'signin-unavailable' : undefined}>
        <span className="signin-mark" aria-hidden="true" />
        {state === 'error' ? 'Retry' : 'Sign in'}
        {pending && <Loader variant="core" size="inline" announce={false} label="Opening Microsoft sign-in…" />}
      </button>
      {unavailable && (
        <span className="visually-hidden" id="signin-unavailable">Sign-in is unavailable until the backend is configured.</span>
      )}
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

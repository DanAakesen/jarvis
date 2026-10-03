import { Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { areas } from './areas';
import { JarvisPage } from './JarvisPage';
import { NotFoundPage, SignInPage } from './pages';
import { SettingsPage } from './SettingsPage';
import { useSignIn, type SignInSession } from './useSignIn';

function Shell({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="app">
      <a className="skip-link" href="#content">Skip to content</a>
      <header className="app-header">
        <Link className="brand" to="/" aria-label="Jarvis home">Jarvis</Link>
        {signedIn && (
          <>
            <nav className="area-links" aria-label="Areas">
              {areas.map((area) => (
                <NavLink key={area.id} className="nav-link" to={`/${area.path}`}>{area.label}</NavLink>
              ))}
            </nav>
            <NavLink className="nav-link" to="/settings">Settings</NavLink>
          </>
        )}
      </header>
      <main id="content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

/** Every Jarvis page needs Dan's verified session; until then the page shows sign-in instead. */
function RequireSignIn({ session }: { session: SignInSession }) {
  return session.state === 'signed-in' && session.profile ? <Outlet /> : <SignInPage session={session} />;
}

export function App({ config = __JARVIS_CONFIG__ }: { config?: PublicConfig }) {
  const session = useSignIn(config);
  const signedIn = session.state === 'signed-in' && session.profile !== null;

  return (
    <Routes>
      <Route element={<Shell signedIn={signedIn} />}>
        <Route element={<RequireSignIn session={session} />}>
          <Route index element={
            <JarvisPage name={session.profile?.name ?? ''} client={session.client} config={config} />
          } />
          {areas.map(({ id, path, Component }) => (
            <Route key={id} path={`${path}/*`} element={<Component />} />
          ))}
          <Route path="settings" element={<SettingsPage backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

import { useRef, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';
import { areas } from './areas';
import { ContextPanel, ContextPanelProvider } from './ContextPanel';
import { useContextPanel } from './context-panel-state';
import { DatabaseWakeStatus } from './DatabaseWakeStatus';
import { JarvisPage } from './JarvisPage';
import { NotFoundPage, SignInPage } from './pages';
import { SettingsPage } from './SettingsPage';
import { ThemePreferenceProvider } from './theme-preference';
import { useSignIn, type SignInSession } from './useSignIn';

type ShellIconName = 'home' | 'factory' | 'usage' | 'navigation' | 'screen' | 'camera' | 'context' | 'settings' | 'close';

function ShellIcon({ name }: { name: ShellIconName }) {
  const common = { 'aria-hidden': true as const, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'home':
      return <svg {...common}><path d="m3 10 9-7 9 7" /><path d="M5 9v12h14V9M9 21v-7h6v7" /></svg>;
    case 'factory':
      return <svg {...common}><path d="M3 21V9l6 3V8l6 4V5h6v16Z" /><path d="M7 17h1m4 0h1m4 0h1m-10-4h1m4 0h1m4-8h1" /></svg>;
    case 'usage':
      return <svg {...common}><path d="M4 20V11m5 9V5m5 15v-7m5 7V8" /><path d="M2 21h20" /></svg>;
    case 'navigation':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m-3-11h1m-1 4h1" /></svg>;
    case 'screen':
      return <svg {...common}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></svg>;
    case 'camera':
      return <svg {...common}><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v10H2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'context':
      return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 1 1-3.4 0v-.2A1.7 1.7 0 0 0 8 17.4l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 4.4 12H4.2a1.7 1.7 0 1 1 0-3.4h.2A1.7 1.7 0 0 0 5.6 5.7l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1A1.7 1.7 0 0 0 11 2.1v-.2a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.5 3Z" /></svg>;
    case 'close':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
}

function UnavailableControl({ id, label, explanation, icon }: {
  id: string;
  label: string;
  explanation: string;
  icon: 'screen' | 'camera';
}) {
  return (
    <div className="topbar-feature" title={explanation}>
      <button className="topbar-feature-button" type="button" disabled aria-label={label} aria-describedby={id}>
        <ShellIcon name={icon} />
      </button>
      <span id={id} className="visually-hidden">{explanation}</span>
    </div>
  );
}

function Shell({ signedIn, config, session }: { signedIn: boolean; config: PublicConfig; session: SignInSession }) {
  return (
    <ContextPanelProvider>
      <ShellLayout signedIn={signedIn} config={config} session={session} />
    </ContextPanelProvider>
  );
}

function ShellLayout({ signedIn, config, session }: { signedIn: boolean; config: PublicConfig; session: SignInSession }) {
  const { pathname } = useLocation();
  const navigationToggle = useRef<HTMLButtonElement>(null);
  const contextPanel = useContextPanel();
  const [navigationOpen, setNavigationOpen] = useState(() => (
    typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 701px)').matches
  ));
  const activeArea = areas.find(({ path }) => pathname.startsWith(`/${path}`));
  const settingsActive = pathname.startsWith('/settings');
  const areaLabel = settingsActive ? 'Settings' : activeArea?.label ?? 'Jarvis';
  const navigationItems = activeArea?.navigation ?? [{ label: 'Conversation', path: '/' }];

  function closeNavigation() {
    navigationToggle.current?.focus();
    setNavigationOpen(false);
  }

  return (
    <div className={`app app-shell${signedIn ? '' : ' app-signed-out'}`} data-navigation-open={signedIn && navigationOpen} data-context-open={signedIn && contextPanel.isOpen}>
      <a className="skip-link" href="#content">Skip to content</a>
      {signedIn && (
        <nav className="area-rail" aria-label="Areas">
          <button
            ref={navigationToggle}
            className="rail-button navigation-toggle"
            type="button"
            aria-label={navigationOpen ? 'Collapse area navigation' : 'Expand area navigation'}
            aria-expanded={navigationOpen}
            aria-controls="area-navigation"
            onClick={() => setNavigationOpen((open) => !open)}
          >
            <ShellIcon name="navigation" />
          </button>
          <NavLink className="rail-link" to="/" end aria-label="Conversation">
            <ShellIcon name="home" /><span className="visually-hidden">Jarvis</span>
          </NavLink>
          {areas.map((area) => (
            <NavLink key={area.id} className="rail-link" to={`/${area.path}`} aria-label={area.label} onClick={() => setNavigationOpen(true)}>
              <ShellIcon name={area.id === 'factory' ? 'factory' : 'usage'} /><span className="visually-hidden">{area.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
      {signedIn && (
        <aside id="area-navigation" className="area-sidebar" hidden={!navigationOpen}>
          <div className="sidebar-heading">
            <span>{areaLabel}</span>
            <button className="sidebar-close" type="button" aria-label="Close area navigation" onClick={closeNavigation}>
              <ShellIcon name="close" />
            </button>
          </div>
          <nav aria-label={activeArea?.label ?? 'Jarvis'}>
            {navigationItems.map((item) => (
              <NavLink key={item.path} className="sidebar-link" to={item.path} end={item.path === '/'} onClick={() => {
                if (window.matchMedia?.('(max-width: 700px)').matches) closeNavigation();
              }}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
      )}
      <header className="app-topbar">
        <div className="topbar-context">
          <Link className="brand" to="/" aria-label="Jarvis home">Jarvis</Link>
          {signedIn && <><span className="topbar-separator" aria-hidden="true">/</span><span className="topbar-area-label">{areaLabel}</span></>}
        </div>
        {signedIn && (
          <div className="topbar-actions">
            <UnavailableControl id="screen-share-status" label="Share screen" explanation="Unavailable until screen sharing is built." icon="screen" />
            <UnavailableControl id="camera-status" label="Camera" explanation="Unavailable until camera support is built." icon="camera" />
            <button
              id="context-panel-toggle"
              className="topbar-icon-button"
              type="button"
              aria-label="Toggle contextual panel"
              aria-expanded={contextPanel.isOpen}
              aria-controls="context-panel"
              onClick={contextPanel.toggle}
            >
              <ShellIcon name="context" />
            </button>
            <NavLink className="settings-link" to="/settings" aria-label="Settings">
              <ShellIcon name="settings" /><span className="settings-label">Settings</span>
            </NavLink>
          </div>
        )}
      </header>
      <main id="content" className="shell-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="bottom-bar">
        {signedIn && config.backendUrl && (
          <DatabaseWakeStatus backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
        )}
      </footer>
      {signedIn && <ContextPanel closeIcon={<ShellIcon name="close" />} />}
    </div>
  );
}

/** Every Jarvis page needs Dan's verified session; until then the page shows sign-in instead. */
function RequireSignIn({ session }: { session: SignInSession }) {
  return session.state === 'signed-in' && session.profile ? <Outlet /> : <SignInPage session={session} />;
}

// Vite inlines __JARVIS_CONFIG__ as an object literal. Read it once: a new object per render
// recreated the MSAL client and re-ran sign-in restore in a loop (L65).
const defaultConfig: PublicConfig = __JARVIS_CONFIG__;

export function App({ config = defaultConfig }: { config?: PublicConfig }) {
  const session = useSignIn(config);
  const signedIn = session.state === 'signed-in' && session.profile !== null;

  return (
    <ThemePreferenceProvider key={signedIn ? 'signed-in' : 'signed-out'}
      enabled={signedIn} backendUrl={config.backendUrl} getAccessToken={session.getAccessToken}>
      <Routes>
        <Route element={<Shell signedIn={signedIn} config={config} session={session} />}>
          <Route element={<RequireSignIn session={session} />}>
            <Route index element={
              <JarvisPage
                name={session.profile?.name ?? ''}
                client={session.client}
                config={config}
                getAccessToken={session.getAccessToken}
              />
            } />
            {areas.map(({ id, path, Component }) => (
              <Route key={id} path={`${path}/*`} element={
                <Component backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />
              } />
            ))}
            <Route path="settings" element={<SettingsPage backendUrl={config.backendUrl} getAccessToken={session.getAccessToken} />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ThemePreferenceProvider>
  );
}

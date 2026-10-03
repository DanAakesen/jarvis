import { Link, Route, Routes } from 'react-router-dom';
import type { PublicConfig } from '../config/public-config';

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
            <section aria-labelledby="welcome-heading">
              <h1 id="welcome-heading">Jarvis is taking shape</h1>
              <p>Your personal AI platform starts here. Conversation and the Software Factory are still being built.</p>
              <dl className="setup-status">
                <div><dt>Sign-in</dt><dd>Not available yet</dd></div>
                <div><dt>Backend</dt><dd>{config.backendUrl
                  ? 'Address configured; connection has not been checked'
                  : 'Waiting for the first deployment'}</dd></div>
              </dl>
            </section>
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
